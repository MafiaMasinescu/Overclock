import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type { TaskAllocationState, TaskInstanceState } from "../core/types.ts";
import { addMicrodollars, microdollarsToUsd, usdToMicrodollars } from "../economy/money.ts";
import { formatTaskInstanceId, secondsToTaskTicks } from "./taskState.ts";

export type TaskCommandHandlers = Pick<
  CommandHandlerRegistry,
  "ACCEPT_TASK" | "ALLOCATE_TASK" | "SET_TASK_HOLD" | "ABANDON_TASK"
>;

const REJECTIONS = {
  invalidSystem: { code: "INVALID_SYSTEM", messageKey: "errors.invalid-system" },
  slotLimit: { code: "TASK_SLOT_LIMIT", messageKey: "errors.task-slot-limit" },
  taskNotActive: { code: "TASK_NOT_ACTIVE", messageKey: "errors.task-not-active" },
  requirementMissing: (reason: string): CommandHandlerRejection => ({
    code: "TASK_REQUIREMENT_MISSING",
    messageKey: "errors.task-requirement-missing",
    parameters: { reason },
  }),
} as const;

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function occupiedSlotCount(instances: Readonly<Record<string, TaskInstanceState>>): number {
  let occupied = 0;
  for (const instance of Object.values(instances)) {
    if (
      instance.status === "accepted" ||
      instance.status === "active" ||
      instance.status === "hold"
    ) {
      occupied += 1;
    }
  }
  return occupied;
}

function activeSharesRemainAvailable(
  instances: Readonly<Record<string, TaskInstanceState>>,
  excludedTaskId: string,
  allocation: Readonly<TaskAllocationState>,
): boolean {
  const requestedModuleIds = new Set(allocation.clusterModuleIds);
  const activeShares = new Map<string, number>();
  for (const instance of Object.values(instances)) {
    if (
      instance.id === excludedTaskId ||
      instance.status !== "active" ||
      instance.allocation === null
    ) {
      continue;
    }
    for (const moduleId of instance.allocation.clusterModuleIds) {
      if (!requestedModuleIds.has(moduleId)) continue;
      activeShares.set(
        moduleId,
        (activeShares.get(moduleId) ?? 0) + instance.allocation.requestedShare,
      );
    }
  }
  return [...activeShares.values()].every((share) => share + allocation.requestedShare <= 1);
}

function exactAllocationDecision(
  allocation: Readonly<TaskAllocationState> | null,
  clusterModuleIds: readonly string[],
  requestedShare: number,
): boolean {
  return (
    allocation !== null &&
    allocation.requestedShare === requestedShare &&
    allocation.clusterModuleIds.length === clusterModuleIds.length &&
    allocation.clusterModuleIds.every((moduleId, index) => moduleId === clusterModuleIds[index])
  );
}

function resolveTask(content: ContentBundle, definitionId: string) {
  return Object.hasOwn(content.tasks, definitionId) ? content.tasks[definitionId] : undefined;
}

function taskRequirement(reason: string): CommandHandlerRejection {
  return REJECTIONS.requirementMissing(reason);
}

export function createTaskCommandHandlers(content: ContentBundle): TaskCommandHandlers {
  return Object.freeze({
    ACCEPT_TASK({ state }, command) {
      const definition = resolveTask(content, command.definitionId);
      if (definition === undefined) return taskRequirement("unknown-definition");
      if (
        Object.values(state.tasks.instances).some(
          (instance) => instance.definitionId === definition.id,
        )
      ) {
        return taskRequirement("existing-instance");
      }
      if (!state.tasks.offers.includes(definition.id)) return taskRequirement("not-offered");
      if (definition.offerYear > state.campaign.currentYear) return taskRequirement("offer-year");
      if (
        !definition.prerequisiteResearchIds.every(
          (researchId) => state.research.statuses[researchId] === "completed",
        )
      ) {
        return taskRequirement("research-prerequisite");
      }
      if (occupiedSlotCount(state.tasks.instances) >= state.tasks.activeSlotCount) {
        return REJECTIONS.slotLimit;
      }
      const sequence = state.tasks.nextTaskInstanceSequence;
      if (!isPositiveSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) {
        return REJECTIONS.invalidSystem;
      }
      const id = formatTaskInstanceId(sequence);
      if (Object.hasOwn(state.tasks.instances, id)) return REJECTIONS.invalidSystem;

      const deadlineTick =
        definition.deadlineSeconds === null
          ? null
          : state.tick + secondsToTaskTicks(definition.deadlineSeconds, "Task deadline");
      state.tasks.instances[id] = {
        id,
        definitionId: definition.id,
        status: "accepted",
        acceptedAtTick: state.tick,
        deadlineTick,
        currentPhaseIndex: 0,
        phaseCompletedOperations: 0,
        totalCompletedOperations: 0,
        allocation: null,
        accruedPayoutUsd: 0,
        serviceWindowCompliant: definition.type === "service" ? true : null,
      };
      state.tasks.offers = state.tasks.offers.filter((offerId) => offerId !== definition.id);
      state.tasks.nextTaskInstanceSequence = sequence + 1;
    },

    ALLOCATE_TASK({ state }, command) {
      const instance = state.tasks.instances[command.taskInstanceId];
      if (
        instance === undefined ||
        instance.status === "completed" ||
        instance.status === "failed" ||
        instance.status === "abandoned"
      ) {
        return REJECTIONS.taskNotActive;
      }
      const clusterModuleIds = [...command.clusterModuleIds].toSorted(compareStableStrings);
      if (clusterModuleIds.length === 0) return taskRequirement("empty-cluster");
      if (
        clusterModuleIds.some(
          (moduleId, index) => index > 0 && moduleId === clusterModuleIds[index - 1],
        )
      ) {
        return taskRequirement("duplicate-module");
      }
      const modules = clusterModuleIds.map((moduleId) => state.facility.modules[moduleId]);
      if (modules.some((module) => module === undefined)) return taskRequirement("missing-module");
      if (
        !modules.some(
          (module) =>
            module !== undefined &&
            (content.modules[module.definitionId]?.baseComputeFlops ?? 0) > 0,
        )
      ) {
        return taskRequirement("no-compute-module");
      }
      if (
        !Number.isFinite(command.requestedShare) ||
        command.requestedShare <= 0 ||
        command.requestedShare > 1 ||
        Object.is(command.requestedShare, -0)
      ) {
        return taskRequirement("requested-share");
      }
      if (exactAllocationDecision(instance.allocation, clusterModuleIds, command.requestedShare)) {
        return;
      }
      const allocation = {
        clusterModuleIds,
        requestedShare: command.requestedShare,
        deliveredUsefulComputeFlops: 0,
      };
      if (
        (instance.status === "accepted" || instance.status === "active") &&
        !activeSharesRemainAvailable(state.tasks.instances, instance.id, allocation)
      ) {
        return taskRequirement("share-capacity");
      }
      state.tasks.instances[instance.id] = {
        ...instance,
        status: instance.status === "accepted" ? "active" : instance.status,
        allocation,
      };
    },

    SET_TASK_HOLD({ state }, command) {
      const instance = state.tasks.instances[command.taskInstanceId];
      if (instance === undefined || instance.status === "accepted") return REJECTIONS.taskNotActive;
      if (
        instance.status === "completed" ||
        instance.status === "failed" ||
        instance.status === "abandoned"
      ) {
        return REJECTIONS.taskNotActive;
      }
      if (command.hold) {
        if (instance.status === "hold") return;
        if (instance.allocation === null) return REJECTIONS.taskNotActive;
        state.tasks.instances[instance.id] = {
          ...instance,
          status: "hold",
          allocation: { ...instance.allocation, deliveredUsefulComputeFlops: 0 },
        };
        return;
      }
      if (instance.status === "active") return;
      if (instance.allocation === null) return REJECTIONS.taskNotActive;
      if (!activeSharesRemainAvailable(state.tasks.instances, instance.id, instance.allocation)) {
        return taskRequirement("share-capacity");
      }
      state.tasks.instances[instance.id] = {
        ...instance,
        status: "active",
        allocation: { ...instance.allocation, deliveredUsefulComputeFlops: 0 },
      };
    },

    ABANDON_TASK({ state }, command) {
      const instance = state.tasks.instances[command.taskInstanceId];
      if (
        instance === undefined ||
        (instance.status !== "accepted" &&
          instance.status !== "active" &&
          instance.status !== "hold")
      ) {
        return REJECTIONS.taskNotActive;
      }
      const definition = resolveTask(content, instance.definitionId);
      if (definition === undefined) return REJECTIONS.invalidSystem;
      try {
        const penaltyMicrodollars = usdToMicrodollars(definition.abandonPenaltyUsd);
        const cashMicrodollars = addMicrodollars(
          usdToMicrodollars(state.economy.cashUsd),
          -penaltyMicrodollars,
        );
        const expenseMicrodollars = addMicrodollars(
          usdToMicrodollars(state.economy.totalExpenseUsd),
          penaltyMicrodollars,
        );
        state.tasks.instances[instance.id] = {
          ...instance,
          status: "abandoned",
          allocation:
            instance.allocation === null
              ? null
              : { ...instance.allocation, deliveredUsefulComputeFlops: 0 },
          serviceWindowCompliant: null,
        };
        state.economy.cashUsd = microdollarsToUsd(cashMicrodollars);
        state.economy.totalExpenseUsd = microdollarsToUsd(expenseMicrodollars);
      } catch (error: unknown) {
        if (error instanceof RangeError) return REJECTIONS.invalidSystem;
        throw error;
      }
    },
  });
}
