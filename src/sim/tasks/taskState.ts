import type {
  ContentBundle,
  DeepReadonly,
  TaskDefinition,
} from "../../content/schemas/contentSchemas.ts";
import { isMicrodollarAlignedUsd } from "../economy/money.ts";
import type { GameState, TaskInstanceState, TaskStatus } from "../core/types.ts";

export interface TaskStateIssue {
  readonly path: string;
  readonly message: string;
}

const NONTERMINAL_STATUSES = ["accepted", "active", "hold"] as const;
const TERMINAL_STATUSES = ["completed", "failed", "abandoned"] as const;
const TASK_STATUSES: readonly TaskStatus[] = [...NONTERMINAL_STATUSES, ...TERMINAL_STATUSES];

function pushIf(issues: TaskStateIssue[], condition: boolean, path: string, message: string): void {
  if (condition) issues.push({ path, message });
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isStableDistinctOrder(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function isDistinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function formatTaskInstanceId(sequence: number): string {
  if (!isPositiveSafeInteger(sequence)) {
    throw new RangeError("Task instance sequence must be a positive safe integer.");
  }
  return `task-instance-${String(sequence).padStart(8, "0")}`;
}

function parseTaskInstanceSequence(id: string): number | null {
  const match = /^task-instance-(\d{8,})$/.exec(id);
  if (match?.[1] === undefined) return null;
  const sequence = Number(match[1]);
  return isPositiveSafeInteger(sequence) && formatTaskInstanceId(sequence) === id ? sequence : null;
}

export function secondsToTaskTicks(seconds: number, label: string): number {
  const durationTicks = seconds * 10;
  if (!Number.isFinite(seconds) || seconds <= 0 || !isPositiveSafeInteger(durationTicks)) {
    throw new RangeError(`${label} must convert to an exact positive safe integer tick count.`);
  }
  return durationTicks;
}

function validateAllocation(
  instance: Readonly<TaskInstanceState>,
  path: string,
  issues: TaskStateIssue[],
): void {
  const allocation = instance.allocation;
  if (instance.status === "accepted") {
    pushIf(
      issues,
      allocation !== null,
      `${path}.allocation`,
      "accepted instances must not allocate modules",
    );
    return;
  }
  if (instance.status === "active" || instance.status === "hold") {
    pushIf(
      issues,
      allocation === null,
      `${path}.allocation`,
      "active and hold instances require an allocation",
    );
  }
  if (allocation === null) return;
  pushIf(
    issues,
    allocation.clusterModuleIds.length === 0 || !isStableDistinctOrder(allocation.clusterModuleIds),
    `${path}.allocation.clusterModuleIds`,
    "must contain stable-sorted distinct module IDs",
  );
  pushIf(
    issues,
    !Number.isFinite(allocation.requestedShare) ||
      allocation.requestedShare <= 0 ||
      allocation.requestedShare > 1 ||
      Object.is(allocation.requestedShare, -0),
    `${path}.allocation.requestedShare`,
    "must be finite and in (0, 1]",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(allocation.deliveredUsefulComputeFlops),
    `${path}.allocation.deliveredUsefulComputeFlops`,
    "must be finite and nonnegative",
  );
}

function validateInstance(
  instance: Readonly<TaskInstanceState>,
  key: string,
  issues: TaskStateIssue[],
): number | null {
  const path = `tasks.instances.${key}`;
  pushIf(issues, instance.id !== key, `${path}.id`, "must match its record key");
  const sequence = parseTaskInstanceSequence(instance.id);
  pushIf(issues, instance.definitionId.length === 0, `${path}.definitionId`, "must be nonempty");
  pushIf(
    issues,
    !TASK_STATUSES.includes(instance.status),
    `${path}.status`,
    "must be a lifecycle status",
  );
  pushIf(
    issues,
    instance.status === "offered",
    `${path}.status`,
    "offered definitions are not instances",
  );
  pushIf(
    issues,
    instance.acceptedAtTick === null || !isNonnegativeSafeInteger(instance.acceptedAtTick),
    `${path}.acceptedAtTick`,
    "must be a nonnegative safe integer",
  );
  pushIf(
    issues,
    instance.deadlineTick !== null && !isNonnegativeSafeInteger(instance.deadlineTick),
    `${path}.deadlineTick`,
    "must be null or a nonnegative safe integer",
  );
  pushIf(
    issues,
    !isNonnegativeSafeInteger(instance.currentPhaseIndex),
    `${path}.currentPhaseIndex`,
    "must be a nonnegative safe integer",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(instance.phaseCompletedOperations),
    `${path}.phaseCompletedOperations`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(instance.totalCompletedOperations),
    `${path}.totalCompletedOperations`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(instance.accruedPayoutUsd) ||
      !isMicrodollarAlignedUsd(instance.accruedPayoutUsd),
    `${path}.accruedPayoutUsd`,
    "must be a finite nonnegative microdollar-aligned USD value",
  );
  pushIf(
    issues,
    instance.serviceWindowCompliant !== null &&
      typeof instance.serviceWindowCompliant !== "boolean",
    `${path}.serviceWindowCompliant`,
    "must be boolean or null",
  );
  validateAllocation(instance, path, issues);
  return sequence;
}

export function validateStoredTaskState(state: Readonly<GameState>): TaskStateIssue[] {
  const issues: TaskStateIssue[] = [];
  const { tasks } = state;
  pushIf(
    issues,
    !isPositiveSafeInteger(tasks.nextTaskInstanceSequence),
    "tasks.nextTaskInstanceSequence",
    "must be a positive safe integer",
  );
  pushIf(
    issues,
    !isNonnegativeSafeInteger(tasks.activeSlotCount),
    "tasks.activeSlotCount",
    "must be a nonnegative safe integer slot capacity",
  );
  pushIf(issues, !isDistinct(tasks.offers), "tasks.offers", "must contain unique definition IDs");
  const definitionIds = new Set<string>();
  let occupiedSlots = 0;
  const activeShares = new Map<string, number>();
  let maximumSequence = 0;

  for (const taskId of Object.keys(tasks.instances).toSorted()) {
    const instance = tasks.instances[taskId];
    if (instance === undefined) continue;
    const path = `tasks.instances.${taskId}`;
    const sequence = validateInstance(instance, taskId, issues);
    if (sequence !== null) maximumSequence = Math.max(maximumSequence, sequence);
    pushIf(
      issues,
      definitionIds.has(instance.definitionId),
      `${path}.definitionId`,
      "must have one instance per definition",
    );
    definitionIds.add(instance.definitionId);
    pushIf(
      issues,
      tasks.offers.includes(instance.definitionId),
      `${path}.definitionId`,
      "must not also be offered",
    );
    if ((NONTERMINAL_STATUSES as readonly string[]).includes(instance.status)) occupiedSlots += 1;
    if (instance.status === "active" && instance.allocation !== null) {
      for (const moduleId of instance.allocation.clusterModuleIds) {
        activeShares.set(
          moduleId,
          (activeShares.get(moduleId) ?? 0) + instance.allocation.requestedShare,
        );
      }
    }
  }

  pushIf(
    issues,
    maximumSequence >= tasks.nextTaskInstanceSequence,
    "tasks.nextTaskInstanceSequence",
    "must exceed every generated task instance sequence",
  );
  pushIf(
    issues,
    occupiedSlots > tasks.activeSlotCount,
    "tasks.activeSlotCount",
    "is exceeded by nonterminal instances",
  );
  for (const [moduleId, share] of activeShares) {
    pushIf(
      issues,
      share > 1,
      `tasks.activeShares.${moduleId}`,
      "active requested shares must not exceed one per module",
    );
  }
  pushIf(
    issues,
    !isFiniteNonnegative(state.campaign.reputation),
    "campaign.reputation",
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(state.research.researchData),
    "research.researchData",
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isStableDistinctOrder(state.research.evidenceTags),
    "research.evidenceTags",
    "must use stable-sorted unique evidence tags",
  );
  return issues;
}

function validateContentAwareInstance(
  state: Readonly<GameState>,
  content: ContentBundle,
  instance: Readonly<TaskInstanceState>,
  task: DeepReadonly<TaskDefinition>,
  path: string,
  issues: TaskStateIssue[],
): void {
  const phase = task.phases[instance.currentPhaseIndex];
  pushIf(issues, phase === undefined, `${path}.currentPhaseIndex`, "must identify a defined phase");
  if (phase !== undefined) {
    const priorOperations = task.phases
      .slice(0, instance.currentPhaseIndex)
      .reduce((total, candidate) => total + candidate.operations, 0);
    pushIf(
      issues,
      instance.phaseCompletedOperations > phase.operations,
      `${path}.phaseCompletedOperations`,
      "must not exceed the current phase operations",
    );
    pushIf(
      issues,
      instance.totalCompletedOperations !== priorOperations + instance.phaseCompletedOperations,
      `${path}.totalCompletedOperations`,
      "must equal completed prior phases plus current phase progress",
    );
  }
  const totalOperations = task.phases.reduce((total, candidate) => total + candidate.operations, 0);
  pushIf(
    issues,
    instance.totalCompletedOperations > totalOperations,
    `${path}.totalCompletedOperations`,
    "must not exceed the task total operations",
  );
  const expectedDeadline =
    task.deadlineSeconds === null || instance.acceptedAtTick === null
      ? null
      : instance.acceptedAtTick + secondsToTaskTicks(task.deadlineSeconds, "Task deadline");
  pushIf(
    issues,
    instance.deadlineTick !== expectedDeadline,
    `${path}.deadlineTick`,
    "must match content and acceptance tick",
  );
  const serviceNonterminal =
    task.type === "service" &&
    (NONTERMINAL_STATUSES as readonly string[]).includes(instance.status);
  pushIf(
    issues,
    serviceNonterminal && typeof instance.serviceWindowCompliant !== "boolean",
    `${path}.serviceWindowCompliant`,
    "must be boolean for a nonterminal service instance",
  );
  pushIf(
    issues,
    !serviceNonterminal && instance.serviceWindowCompliant !== null,
    `${path}.serviceWindowCompliant`,
    "must be null for non-service or terminal instances",
  );
  if (instance.allocation !== null) {
    const liveModules = instance.allocation.clusterModuleIds
      .map((moduleId) => state.facility.modules[moduleId])
      .filter((module): module is NonNullable<typeof module> => module !== undefined);
    if (liveModules.length === instance.allocation.clusterModuleIds.length) {
      const hasPositiveCompute = liveModules.some(
        (module) => (content.modules[module.definitionId]?.baseComputeFlops ?? 0) > 0,
      );
      pushIf(
        issues,
        !hasPositiveCompute,
        `${path}.allocation.clusterModuleIds`,
        "must include a positive-base-compute module when every allocation module is live",
      );
    }
  }
}

export function validateContentAwareTaskState(
  state: Readonly<GameState>,
  content: ContentBundle,
): TaskStateIssue[] {
  const issues = validateStoredTaskState(state);
  for (const taskId of Object.keys(state.tasks.instances).toSorted()) {
    const instance = state.tasks.instances[taskId];
    if (instance === undefined) continue;
    const task = content.tasks[instance.definitionId];
    const path = `tasks.instances.${taskId}`;
    pushIf(
      issues,
      parseTaskInstanceSequence(instance.id) === null,
      `${path}.id`,
      "must use the canonical generated task-instance ID",
    );
    if (task === undefined) {
      issues.push({ path: `${path}.definitionId`, message: "must reference known task content" });
      continue;
    }
    validateContentAwareInstance(state, content, instance, task, path, issues);
  }
  for (const definitionId of state.tasks.offers) {
    const task = content.tasks[definitionId];
    const path = `tasks.offers.${definitionId}`;
    if (task === undefined) {
      issues.push({ path, message: "must reference known task content" });
      continue;
    }
    const prerequisitesComplete = task.prerequisiteResearchIds.every(
      (researchId) => state.research.statuses[researchId] === "completed",
    );
    pushIf(
      issues,
      task.offerYear > state.campaign.currentYear || !prerequisitesComplete,
      path,
      "must be currently eligible from campaign year and completed prerequisites",
    );
  }
  const expectedOfferOrder = [...state.tasks.offers].toSorted((left, right) => {
    const leftTask = content.tasks[left];
    const rightTask = content.tasks[right];
    const compareIds = left < right ? -1 : left > right ? 1 : 0;
    if (leftTask === undefined || rightTask === undefined) return compareIds;
    return leftTask.sortOrder - rightTask.sortOrder || compareIds;
  });
  pushIf(
    issues,
    expectedOfferOrder.some((definitionId, index) => state.tasks.offers[index] !== definitionId),
    "tasks.offers",
    "must use the stable content sort order",
  );
  return issues;
}

export function assertValidStoredTaskState(state: Readonly<GameState>): void {
  const issues = validateStoredTaskState(state);
  if (issues.length > 0) {
    throw new Error(
      `Invalid task state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}
