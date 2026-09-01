import type {
  ContentBundle,
  DeepReadonly,
  TaskDefinition,
} from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type {
  CampaignState,
  EconomyState,
  GameState,
  ResearchState,
  TaskComputeResultState,
  TaskInstanceState,
  TaskSystemState,
} from "../core/types.ts";
import { addMicrodollars, microdollarsToUsd, usdToMicrodollars } from "../economy/money.ts";
import { secondsToTaskTicks } from "./taskState.ts";

const OPERATIONS_PER_TICK_PER_FLOP = 0.1;

export interface TaskProgressCalculation {
  readonly appliedOperations: number;
  readonly compliantThisTick: boolean;
}

export interface TaskAdvancementResult {
  readonly tasks: TaskSystemState;
  readonly campaign: CampaignState;
  readonly research: ResearchState;
  readonly economy: EconomyState;
  readonly incomeUsdThisTick: number;
  readonly changed: {
    readonly tasks: boolean;
    readonly campaign: boolean;
    readonly research: boolean;
    readonly economy: boolean;
  };
}

interface TaskAdvanceWitness {
  readonly expected: TaskAdvancementResult;
  readonly content: ContentBundle;
  readonly tasks: GameState["tasks"];
  readonly compute: GameState["facility"]["compute"];
  readonly campaign: GameState["campaign"];
  readonly research: GameState["research"];
  readonly economy: GameState["economy"];
  readonly tick: number;
}

export interface TaskAdvancementCalculation {
  readonly result: TaskAdvancementResult;
  /** Same-transaction evidence; never store this in authoritative state. */
  readonly witness: TaskAdvanceWitness;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function stableRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(record).toSorted()) {
    const value = record[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function cloneAllocation(
  allocation: TaskInstanceState["allocation"],
): TaskInstanceState["allocation"] {
  if (
    allocation !== null &&
    Object.isFrozen(allocation) &&
    Object.isFrozen(allocation.clusterModuleIds)
  ) {
    return allocation;
  }
  return allocation === null
    ? null
    : {
        clusterModuleIds: [...allocation.clusterModuleIds],
        requestedShare: allocation.requestedShare,
        deliveredUsefulComputeFlops: allocation.deliveredUsefulComputeFlops,
      };
}

function cloneTasks(tasks: Readonly<TaskSystemState>): TaskSystemState {
  const instances: Record<string, TaskInstanceState> = {};
  for (const taskId of Object.keys(tasks.instances).toSorted()) {
    const instance = tasks.instances[taskId];
    if (instance === undefined) continue;
    instances[taskId] = { ...instance, allocation: cloneAllocation(instance.allocation) };
  }
  return {
    activeSlotCount: tasks.activeSlotCount,
    nextTaskInstanceSequence: tasks.nextTaskInstanceSequence,
    offers: [...tasks.offers],
    instances,
  };
}

function cloneCampaign(campaign: Readonly<CampaignState>): CampaignState {
  return { ...campaign };
}

function cloneResearch(research: Readonly<ResearchState>): ResearchState {
  return {
    ...research,
    statuses: stableRecord(research.statuses),
    active: research.active === null ? null : { ...research.active },
    evidenceTags: [...research.evidenceTags],
  };
}

function cloneEconomy(economy: Readonly<EconomyState>): EconomyState {
  return { ...economy };
}

function retainFrozenOrClone<T extends object>(value: T, clone: () => T): T {
  return Object.isFrozen(value) ? value : clone();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameAllocation(
  left: TaskInstanceState["allocation"],
  right: TaskInstanceState["allocation"],
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.requestedShare === right.requestedShare &&
      left.deliveredUsefulComputeFlops === right.deliveredUsefulComputeFlops &&
      sameStrings(left.clusterModuleIds, right.clusterModuleIds))
  );
}

function sameInstance(left: TaskInstanceState, right: TaskInstanceState): boolean {
  return (
    left.id === right.id &&
    left.definitionId === right.definitionId &&
    left.status === right.status &&
    left.acceptedAtTick === right.acceptedAtTick &&
    left.deadlineTick === right.deadlineTick &&
    left.currentPhaseIndex === right.currentPhaseIndex &&
    left.phaseCompletedOperations === right.phaseCompletedOperations &&
    left.totalCompletedOperations === right.totalCompletedOperations &&
    left.accruedPayoutUsd === right.accruedPayoutUsd &&
    left.serviceWindowCompliant === right.serviceWindowCompliant &&
    sameAllocation(left.allocation, right.allocation)
  );
}

function sameTasks(left: TaskSystemState, right: TaskSystemState): boolean {
  const leftIds = Object.keys(left.instances).toSorted();
  const rightIds = Object.keys(right.instances).toSorted();
  return (
    left.activeSlotCount === right.activeSlotCount &&
    left.nextTaskInstanceSequence === right.nextTaskInstanceSequence &&
    sameStrings(left.offers, right.offers) &&
    sameStrings(leftIds, rightIds) &&
    leftIds.every((id) => {
      const leftTask = left.instances[id];
      const rightTask = right.instances[id];
      return leftTask !== undefined && rightTask !== undefined && sameInstance(leftTask, rightTask);
    })
  );
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

function resolveDefinition(
  content: ContentBundle,
  definitionId: string,
): DeepReadonly<TaskDefinition> {
  const definition = content.tasks[definitionId];
  if (definition === undefined)
    throw new Error(`Task references unknown definition ${definitionId}.`);
  return definition;
}

function mergeEvidenceTags(existing: readonly string[], rewards: readonly string[]): string[] {
  return [...new Set([...existing, ...rewards])].toSorted();
}

function addPayout(
  instance: TaskInstanceState,
  payoutUsd: number,
  accounting: {
    cashMicrodollars: number;
    incomeMicrodollars: number;
    tickIncomeMicrodollars: number;
  },
): void {
  const payoutMicrodollars = usdToMicrodollars(payoutUsd);
  accounting.cashMicrodollars = addMicrodollars(accounting.cashMicrodollars, payoutMicrodollars);
  accounting.incomeMicrodollars = addMicrodollars(
    accounting.incomeMicrodollars,
    payoutMicrodollars,
  );
  accounting.tickIncomeMicrodollars = addMicrodollars(
    accounting.tickIncomeMicrodollars,
    payoutMicrodollars,
  );
  instance.accruedPayoutUsd = microdollarsToUsd(
    addMicrodollars(usdToMicrodollars(instance.accruedPayoutUsd), payoutMicrodollars),
  );
}

function isTerminal(status: TaskInstanceState["status"]): boolean {
  return status === "completed" || status === "failed" || status === "abandoned";
}

function taskResultFor(
  state: Readonly<GameState>,
  task: Readonly<TaskInstanceState>,
): TaskComputeResultState | undefined {
  return state.facility.compute.byTask[task.id];
}

function assertCurrentTaskResult(
  task: Readonly<TaskInstanceState>,
  result: TaskComputeResultState | undefined,
): asserts result is TaskComputeResultState {
  if (
    result?.taskInstanceId !== task.id ||
    result.taskDefinitionId !== task.definitionId ||
    result.phaseIndex !== task.currentPhaseIndex
  ) {
    throw new Error(`Task ${task.id} requires a current Task 9 result before advancement.`);
  }
}

/**
 * Reconciles content offers without creating instances. Research status is read from the supplied
 * state, so a later research stage naturally exposes new offers on the next real tick.
 */
export function reconcileTaskOffers(state: Readonly<GameState>, content: ContentBundle): string[] {
  const instantiatedDefinitions = new Set(
    Object.values(state.tasks.instances).map((instance) => instance.definitionId),
  );
  const eligible = Object.values(content.tasks).filter(
    (definition) =>
      !instantiatedDefinitions.has(definition.id) &&
      definition.offerYear <= state.campaign.currentYear &&
      definition.prerequisiteResearchIds.every(
        (researchId) => state.research.statuses[researchId] === "completed",
      ),
  );
  return eligible
    .toSorted(
      (left, right) => left.sortOrder - right.sortOrder || compareStableStrings(left.id, right.id),
    )
    .map((definition) => definition.id);
}

/** Calculates only this task's current-tick progress and service compliance. */
export function calculateTaskProgress(
  task: Readonly<TaskInstanceState>,
  definition: DeepReadonly<TaskDefinition>,
  result: Readonly<TaskComputeResultState> | undefined,
): TaskProgressCalculation {
  if (task.status !== "active") return { appliedOperations: 0, compliantThisTick: false };
  if (task.allocation === null) {
    throw new Error(`Active task ${task.id} requires an allocation before advancement.`);
  }
  assertCurrentTaskResult(task, result);
  const phase = definition.phases[task.currentPhaseIndex];
  if (phase === undefined) throw new Error(`Task ${task.id} references an invalid current phase.`);
  assertFiniteNonnegative(
    task.allocation.deliveredUsefulComputeFlops,
    "Task delivered Useful Compute",
  );
  assertFiniteNonnegative(task.phaseCompletedOperations, "Task phase progress");
  if (task.phaseCompletedOperations > phase.operations) {
    throw new RangeError("Task phase progress exceeds the phase operations.");
  }
  const compliantThisTick =
    result.runnable &&
    result.meetsStabilityMinimum &&
    task.allocation.deliveredUsefulComputeFlops > 0;
  if (!result.runnable || !result.meetsStabilityMinimum) {
    return { appliedOperations: 0, compliantThisTick };
  }
  const rawOperations = task.allocation.deliveredUsefulComputeFlops * OPERATIONS_PER_TICK_PER_FLOP;
  if (!Number.isFinite(rawOperations) || rawOperations < 0) {
    throw new RangeError("Task raw operations must be finite and nonnegative.");
  }
  const remainingOperations = phase.operations - task.phaseCompletedOperations;
  return {
    appliedOperations: Math.min(rawOperations, remainingOperations),
    compliantThisTick,
  };
}

function applyCompletionRewards(
  task: TaskInstanceState,
  definition: DeepReadonly<TaskDefinition>,
  campaign: CampaignState,
  research: ResearchState,
  accounting: {
    cashMicrodollars: number;
    incomeMicrodollars: number;
    tickIncomeMicrodollars: number;
  },
): void {
  addPayout(task, definition.payoutUsd, accounting);
  const reputation = campaign.reputation + definition.reputationReward;
  const researchData = research.researchData + definition.researchDataReward;
  assertFiniteNonnegative(reputation, "Task completion reputation");
  assertFiniteNonnegative(researchData, "Task completion Research Data");
  campaign.reputation = reputation;
  research.researchData = researchData;
  research.evidenceTags = mergeEvidenceTags(research.evidenceTags, definition.evidenceTagRewards);
}

function applyServiceWindow(
  task: TaskInstanceState,
  definition: DeepReadonly<TaskDefinition>,
  tick: number,
  previousWindowCompliant: boolean | null,
  compliantThisTick: boolean,
  accounting: {
    cashMicrodollars: number;
    incomeMicrodollars: number;
    tickIncomeMicrodollars: number;
  },
): void {
  if (definition.type !== "service") return;
  if (previousWindowCompliant === null) {
    throw new Error(
      `Nonterminal service task ${task.id} must have service-window compliance state.`,
    );
  }
  if (definition.periodicPayoutSeconds === null) {
    throw new Error(`Service task ${task.id} lacks a periodic payout interval.`);
  }
  const intervalTicks = secondsToTaskTicks(
    definition.periodicPayoutSeconds,
    "Task payout interval",
  );
  if (task.acceptedAtTick === null) throw new Error(`Task ${task.id} lacks its acceptance tick.`);
  const nextWindowCompliant = previousWindowCompliant && compliantThisTick;
  const closesWindow = (tick - task.acceptedAtTick + 1) % intervalTicks === 0;
  if (!closesWindow) {
    task.serviceWindowCompliant = isTerminal(task.status) ? null : nextWindowCompliant;
    return;
  }
  if (nextWindowCompliant) addPayout(task, definition.periodicPayoutUsd, accounting);
  task.serviceWindowCompliant = isTerminal(task.status) ? null : true;
}

function advanceInstance(
  task: TaskInstanceState,
  definition: DeepReadonly<TaskDefinition>,
  state: Readonly<GameState>,
  accounting: {
    cashMicrodollars: number;
    incomeMicrodollars: number;
    tickIncomeMicrodollars: number;
  },
  applyRewards: (task: TaskInstanceState, definition: DeepReadonly<TaskDefinition>) => void,
): void {
  if (isTerminal(task.status)) return;
  if (task.deadlineTick !== null && state.tick >= task.deadlineTick) {
    task.status = "failed";
    task.serviceWindowCompliant = null;
    return;
  }

  const previousWindowCompliant = task.serviceWindowCompliant;
  const progress = calculateTaskProgress(task, definition, taskResultFor(state, task));
  if (task.status === "active") {
    const phase = definition.phases[task.currentPhaseIndex];
    if (phase === undefined)
      throw new Error(`Task ${task.id} references an invalid current phase.`);
    task.phaseCompletedOperations += progress.appliedOperations;
    task.totalCompletedOperations += progress.appliedOperations;
    if (
      !Number.isFinite(task.phaseCompletedOperations) ||
      !Number.isFinite(task.totalCompletedOperations)
    ) {
      throw new RangeError("Task progress overflowed.");
    }
    if (task.phaseCompletedOperations === phase.operations) {
      if (task.currentPhaseIndex + 1 < definition.phases.length) {
        task.currentPhaseIndex += 1;
        task.phaseCompletedOperations = 0;
      } else {
        task.status = "completed";
        applyRewards(task, definition);
      }
    }
  }

  if (definition.type === "service") {
    applyServiceWindow(
      task,
      definition,
      state.tick,
      previousWindowCompliant,
      progress.compliantThisTick,
      accounting,
    );
  } else if (task.status === "completed") {
    task.serviceWindowCompliant = null;
  }
}

/**
 * Pure Task lifecycle advancement. The returned patch is detached and frozen; its witness remains
 * private same-transaction evidence for a future production stage to validate without recalculation.
 */
export function advanceTaskSystem(
  state: Readonly<GameState>,
  content: ContentBundle,
): TaskAdvancementCalculation {
  const tasks = cloneTasks(state.tasks);
  let campaign: CampaignState | undefined;
  let research: ResearchState | undefined;
  const accounting = {
    cashMicrodollars: usdToMicrodollars(state.economy.cashUsd),
    incomeMicrodollars: usdToMicrodollars(state.economy.totalIncomeUsd),
    tickIncomeMicrodollars: 0,
  };
  const applyRewards = (
    task: TaskInstanceState,
    definition: DeepReadonly<TaskDefinition>,
  ): void => {
    campaign ??= cloneCampaign(state.campaign);
    research ??= cloneResearch(state.research);
    applyCompletionRewards(task, definition, campaign, research, accounting);
  };
  tasks.offers = reconcileTaskOffers(state, content);

  for (const taskId of Object.keys(tasks.instances).toSorted()) {
    const task = tasks.instances[taskId];
    if (task === undefined) continue;
    advanceInstance(
      task,
      resolveDefinition(content, task.definitionId),
      state,
      accounting,
      applyRewards,
    );
  }
  if (research !== undefined) {
    research.evidenceTags = [...new Set(research.evidenceTags)].toSorted();
  }
  const nextCampaign =
    campaign ?? retainFrozenOrClone(state.campaign, () => cloneCampaign(state.campaign));
  const nextResearch =
    research ?? retainFrozenOrClone(state.research, () => cloneResearch(state.research));
  const nextCashUsd = microdollarsToUsd(accounting.cashMicrodollars);
  const nextTotalIncomeUsd = microdollarsToUsd(accounting.incomeMicrodollars);
  const economyChanged =
    nextCashUsd !== state.economy.cashUsd || nextTotalIncomeUsd !== state.economy.totalIncomeUsd;
  const economy = economyChanged
    ? {
        ...state.economy,
        cashUsd: nextCashUsd,
        totalIncomeUsd: nextTotalIncomeUsd,
      }
    : retainFrozenOrClone(state.economy, () => cloneEconomy(state.economy));

  const changed = {
    tasks: !sameTasks(tasks, state.tasks),
    campaign:
      nextCampaign.currentYear !== state.campaign.currentYear ||
      nextCampaign.objectiveKey !== state.campaign.objectiveKey ||
      nextCampaign.transistorRevealed !== state.campaign.transistorRevealed ||
      nextCampaign.verticalSliceCompleted !== state.campaign.verticalSliceCompleted ||
      nextCampaign.reputation !== state.campaign.reputation,
    research:
      nextResearch.researchData !== state.research.researchData ||
      !sameStrings(nextResearch.evidenceTags, state.research.evidenceTags),
    economy: economyChanged,
  };

  const result = deepFreeze({
    tasks,
    campaign: nextCampaign,
    research: nextResearch,
    economy,
    incomeUsdThisTick: microdollarsToUsd(accounting.tickIncomeMicrodollars),
    changed,
  });
  const witness = Object.freeze({
    expected: result,
    content,
    tasks: state.tasks,
    compute: state.facility.compute,
    campaign: state.campaign,
    research: state.research,
    economy: state.economy,
    tick: state.tick,
  });
  return Object.freeze({ result, witness });
}

/** Validates exact calculation evidence and all authoritative inputs without recalculating tasks. */
export function validateFreshTaskAdvance(
  state: Readonly<GameState>,
  content: ContentBundle,
  result: Readonly<TaskAdvancementResult>,
  witness: Readonly<TaskAdvanceWitness>,
): string[] {
  try {
    if (
      witness.content !== content ||
      witness.tasks !== state.tasks ||
      witness.compute !== state.facility.compute ||
      witness.campaign !== state.campaign ||
      witness.research !== state.research ||
      witness.economy !== state.economy ||
      witness.tick !== state.tick
    ) {
      return ["Task advancement inputs changed before candidate-state validation."];
    }
    return result === witness.expected
      ? []
      : ["Task advancement candidate does not match detached exact calculation evidence."];
  } catch (error: unknown) {
    return [error instanceof Error ? error.message : "Task advancement validation failed."];
  }
}
