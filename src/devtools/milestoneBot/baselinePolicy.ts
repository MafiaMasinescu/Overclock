import type {
  ContentBundle,
  DeepReadonly,
  ResearchNodeDefinition,
  TaskDefinition,
} from "../../content/schemas/contentSchemas.ts";
import { isFeatureUnlocked } from "../../sim/research/researchDomain.ts";
import type { GameState, TaskInstanceState } from "../../sim/core/types.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import type { BotPolicyParameters, MilestoneBotPolicyId } from "./botContracts.ts";
import { DEFAULT_BOT_RUN_CONFIGURATION, freezeBotPolicyParameters } from "./botContracts.ts";
import type { MilestonePolicyResearchGraph } from "./policyGraph.ts";
import { taskProducesRequiredEvidence } from "./policyGraph.ts";
import { canEnterBoost, mustExitBoost } from "./strategyGuards.ts";

export type BotDecision =
  | {
      readonly kind: "apply-template";
      readonly templateId: "starter-serial" | "expanded-balanced" | "cooled-benchmark";
      readonly reasonCode: string;
    }
  | {
      readonly kind: "save-blueprint";
      readonly name: string;
      readonly selectedModuleIds: readonly string[];
      readonly reasonCode: string;
    }
  | {
      readonly kind: "start-benchmark";
      readonly benchmarkId: string;
      readonly clusterRole: "benchmark-sustained" | "benchmark-peak";
      readonly profile: "eco" | "balanced" | "boost";
      readonly profileModuleSymbolicKeys?: readonly string[];
      readonly reasonCode: string;
    }
  | {
      readonly kind: "set-overclock";
      readonly profile: "eco" | "balanced" | "boost";
      readonly moduleSymbolicKeys: readonly string[];
      readonly reasonCode: string;
    }
  | {
      readonly kind: "start-research";
      readonly nodeId: string;
      readonly reservedComputeShare: number;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "accept-and-allocate-task";
      readonly definitionId: string;
      readonly clusterRole: "task-primary";
      readonly requestedShare: number;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "allocate-active-task";
      readonly taskInstanceId: string;
      readonly clusterModuleIds: readonly string[];
      readonly requestedShare: number;
      readonly reasonCode: string;
    }
  | { readonly kind: "advance"; readonly ticks: number; readonly reasonCode: string }
  | {
      readonly kind: "terminal";
      readonly status: "completed" | "hard-lock" | "time-limit" | "policy-error";
      readonly reasonCode: string;
      readonly evidence: Record<string, string | number | boolean | null>;
    };

export interface BotPolicyRuntimeFacts {
  readonly appliedTemplateIds: readonly (
    "starter-serial" | "expanded-balanced" | "cooled-benchmark"
  )[];
  readonly moduleMapping: Readonly<Record<string, string>>;
  readonly blueprintSelectionModuleIds: readonly string[];
  readonly taskPrimaryModuleIds?: readonly string[];
  readonly lastAcceptedAction: string | null;
  readonly blockingBottleneckObserved?: boolean;
  readonly currentBlockingReasonCode?: string | null;
  readonly boostStableTicks?: number;
  readonly boostExitObserved?: boolean;
}

export interface ResearchSelection {
  readonly node: DeepReadonly<ResearchNodeDefinition>;
  readonly reservedComputeShare: number;
  readonly tuple: readonly (number | string)[];
}

export interface TaskSelection {
  readonly task: DeepReadonly<TaskDefinition>;
  readonly tuple: readonly (number | string)[];
}

export const BOT_POLICY_PARAMETERS: Readonly<Record<MilestoneBotPolicyId, BotPolicyParameters>> =
  Object.freeze({
    "baseline-balanced": freezeBotPolicyParameters({
      policyId: "baseline-balanced",
      allowInfiniteService: false,
      idleProfile: "balanced",
      taskProfile: "balanced",
      sustainedProfile: "balanced",
      peakProfile: "boost",
      researchShareWithoutTask: 1,
      researchShareWithFiniteTask: 0.35,
      researchShareWithService: 0.5,
      prioritizeTemplateUpgrade: true,
      boostEntryTemperatureMarginC: 0,
      boostExitTemperatureMarginC: 2,
      boostReentryStabilizationTicks: 100,
    }),
    "conservative-thermal": freezeBotPolicyParameters({
      policyId: "conservative-thermal",
      allowInfiniteService: false,
      idleProfile: "eco",
      taskProfile: "balanced",
      sustainedProfile: "balanced",
      peakProfile: "boost",
      researchShareWithoutTask: 1,
      researchShareWithFiniteTask: 0.35,
      researchShareWithService: 0.5,
      prioritizeTemplateUpgrade: true,
      boostEntryTemperatureMarginC: 5,
      boostExitTemperatureMarginC: 4,
      boostReentryStabilizationTicks: 100,
    }),
    "aggressive-boost": freezeBotPolicyParameters({
      policyId: "aggressive-boost",
      allowInfiniteService: false,
      idleProfile: "balanced",
      taskProfile: "boost",
      sustainedProfile: "balanced",
      peakProfile: "boost",
      researchShareWithoutTask: 1,
      researchShareWithFiniteTask: 0.35,
      researchShareWithService: 0.5,
      prioritizeTemplateUpgrade: true,
      boostEntryTemperatureMarginC: 0,
      boostExitTemperatureMarginC: 2,
      boostReentryStabilizationTicks: 100,
    }),
  });

function activeTasks(state: Readonly<GameState>): readonly TaskInstanceState[] {
  return Object.values(state.tasks.instances).filter(
    (instance) => instance.status === "active" || instance.status === "hold",
  );
}

function finiteActiveTask(state: Readonly<GameState>): TaskInstanceState | undefined {
  return activeTasks(state).find(
    (instance) =>
      state.tasks.instances[instance.id]?.definitionId !== "task-census-tabulation-service",
  );
}

function requestedTaskShare(state: Readonly<GameState>): number {
  let share = 0;
  for (const instance of activeTasks(state)) {
    if (instance.status !== "active" || instance.allocation === null) continue;
    share += instance.allocation.requestedShare;
  }
  return share;
}

export function calculateResearchReservedShare(
  node: DeepReadonly<ResearchNodeDefinition>,
  state: Readonly<GameState>,
): { readonly share: number | null; readonly blocker: string | null } {
  const finiteTask = finiteActiveTask(state);
  const activeService = activeTasks(state).some(
    (instance) =>
      state.tasks.instances[instance.id]?.definitionId === "task-census-tabulation-service" &&
      instance.status === "active",
  );
  const requested =
    finiteTask !== undefined
      ? Math.max(node.minimumComputeShare, 0.35)
      : activeService
        ? Math.max(node.minimumComputeShare, 0.5)
        : 1;
  const remaining = Math.max(0, 1 - requestedTaskShare(state));
  const share = Math.min(requested, remaining);
  if (share < node.minimumComputeShare) return { share: null, blocker: "task-slot" };
  return { share: share === 0 ? 0 : share, blocker: null };
}

function hasResearchPrerequisites(
  node: DeepReadonly<ResearchNodeDefinition>,
  state: Readonly<GameState>,
): boolean {
  return (
    node.prerequisites.every((id) => state.research.statuses[id] === "completed") &&
    node.requiredEvidenceTags.every((tag) => state.research.evidenceTags.includes(tag)) &&
    node.requiredBenchmarkIds.every((id) =>
      state.benchmarks.history.some((run) => run.benchmarkId === id && run.passed),
    )
  );
}

function hasResearchResources(
  node: DeepReadonly<ResearchNodeDefinition>,
  state: Readonly<GameState>,
): boolean {
  return (
    state.economy.cashUsd >= node.cashCostUsd &&
    state.research.researchData >= node.researchDataCost
  );
}

export function isResearchEligibilityReconciliationPending(
  node: DeepReadonly<ResearchNodeDefinition>,
  state: Readonly<GameState>,
): boolean {
  return (
    state.research.statuses[node.id] === "locked" &&
    hasResearchPrerequisites(node, state) &&
    hasResearchResources(node, state)
  );
}

export function compareResearchSelectionTuple(
  left: ResearchSelection,
  right: ResearchSelection,
): number {
  for (let index = 0; index < left.tuple.length; index += 1) {
    const a = left.tuple[index];
    const b = right.tuple[index];
    if (typeof a === "number" && typeof b === "number" && a !== b) return a - b;
    if (typeof a === "string" && typeof b === "string" && a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function selectNextResearch(
  state: Readonly<GameState>,
  content: ContentBundle,
  graph: MilestonePolicyResearchGraph,
): ResearchSelection | undefined {
  if (state.research.active !== null || state.benchmarks.active !== null) return undefined;
  const offeredTasks = new Set(state.tasks.offers);
  const completedEvidence = new Set(state.research.evidenceTags);
  const offeredBlueprintEvidenceTaskExists = graph.nodes.some(
    (node) =>
      (graph.distanceToFirstBlueprint[node.id] ?? Number.MAX_SAFE_INTEGER) <
        Number.MAX_SAFE_INTEGER &&
      state.research.statuses[node.id] !== "completed" &&
      node.requiredEvidenceTags.some(
        (tag) =>
          !completedEvidence.has(tag) &&
          (graph.evidenceTasks[tag] ?? []).some((taskId) => offeredTasks.has(taskId)),
      ),
  );
  if (offeredBlueprintEvidenceTaskExists) return undefined;
  const candidates: ResearchSelection[] = [];
  for (const node of graph.nodes) {
    if (
      state.research.statuses[node.id] !== "available" ||
      !hasResearchPrerequisites(node, state) ||
      !hasResearchResources(node, state)
    )
      continue;
    const reserved = calculateResearchReservedShare(node, state);
    if (reserved.share === null) continue;
    const evidenceTaskRank = Object.values(content.tasks).some(
      (task) =>
        offeredTasks.has(task.id) &&
        taskProducesRequiredEvidence(task, graph, state.research.statuses),
    )
      ? 0
      : 1;
    candidates.push({
      node,
      reservedComputeShare: reserved.share,
      tuple: [
        node.mandatory ? 0 : 1,
        graph.distanceToFirstBlueprint[node.id] ?? Number.MAX_SAFE_INTEGER,
        graph.distanceToFinal[node.id] ?? Number.MAX_SAFE_INTEGER,
        evidenceTaskRank,
        node.sortOrder,
        node.id,
      ],
    });
  }
  return candidates.toSorted(compareResearchSelectionTuple)[0];
}

function phaseOperations(task: DeepReadonly<TaskDefinition>): number {
  return task.phases.reduce((total, phase) => total + phase.operations, 0);
}

function projectedDeadlineTick(
  task: DeepReadonly<TaskDefinition>,
  state: Readonly<GameState>,
): number {
  return task.deadlineSeconds === null
    ? Number.MAX_SAFE_INTEGER
    : state.tick + Math.round(task.deadlineSeconds * 10);
}

export function compareTaskSelectionTuple(left: TaskSelection, right: TaskSelection): number {
  for (let index = 0; index < left.tuple.length; index += 1) {
    const a = left.tuple[index];
    const b = right.tuple[index];
    if (typeof a === "number" && typeof b === "number" && a !== b) return a - b;
    if (typeof a === "string" && typeof b === "string" && a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function selectNextTask(
  state: Readonly<GameState>,
  content: ContentBundle,
  graph: MilestonePolicyResearchGraph,
  allowInfiniteService = false,
): TaskSelection | undefined {
  const activeFinite = finiteActiveTask(state);
  if (activeFinite !== undefined) return undefined;
  const instantiated = new Set(
    Object.values(state.tasks.instances).map((instance) => instance.definitionId),
  );
  const candidates: TaskSelection[] = [];
  for (const task of Object.values(content.tasks)) {
    if (
      !state.tasks.offers.includes(task.id) ||
      instantiated.has(task.id) ||
      (!allowInfiniteService && task.id === "task-census-tabulation-service") ||
      (task.type === "service" && !allowInfiniteService)
    )
      continue;
    const evidence = taskProducesRequiredEvidence(task, graph, state.research.statuses) ? 0 : 1;
    const reachable = graph.nodes.filter(
      (node) =>
        node.mandatory &&
        state.research.statuses[node.id] !== "completed" &&
        node.requiredEvidenceTags.some((tag) => task.evidenceTagRewards.includes(tag)),
    ).length;
    candidates.push({
      task,
      tuple: [
        evidence,
        -reachable,
        -task.researchDataReward,
        phaseOperations(task),
        projectedDeadlineTick(task, state),
        task.sortOrder,
        task.id,
      ],
    });
  }
  return candidates.toSorted(compareTaskSelectionTuple)[0];
}

function templateApplied(
  state: Readonly<GameState>,
  facts: BotPolicyRuntimeFacts,
  templateId: "starter-serial" | "expanded-balanced" | "cooled-benchmark",
): boolean {
  return (
    facts.appliedTemplateIds.includes(templateId) ||
    (templateId === "starter-serial" && Object.keys(state.facility.modules).length > 0)
  );
}

function overclockableModuleEntries(
  state: Readonly<GameState>,
  content: ContentBundle,
  runtime: BotPolicyRuntimeFacts,
): readonly { readonly key: string; readonly id: string }[] {
  return Object.entries(runtime.moduleMapping)
    .flatMap(([key, id]) => {
      const module = state.facility.modules[id];
      return module !== undefined && content.modules[module.definitionId]?.overclockable === true
        ? [{ key, id }]
        : [];
    })
    .toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

function activeTaskStabilityMinimum(state: Readonly<GameState>, content: ContentBundle): number {
  const task = finiteActiveTask(state);
  if (task === undefined) return 0;
  const definition = content.tasks[task.definitionId];
  return definition?.phases[task.currentPhaseIndex]?.stabilityMinimum ?? 0;
}

export function selectBaselineDecision({
  state,
  content,
  graph,
  policy,
  runtime,
}: {
  readonly state: Readonly<GameState>;
  readonly content: ContentBundle;
  readonly graph: MilestonePolicyResearchGraph;
  readonly policy: BotPolicyParameters;
  readonly runtime: BotPolicyRuntimeFacts;
}): BotDecision {
  if (state.campaign.verticalSliceCompleted) {
    return {
      kind: "terminal",
      status: "completed",
      reasonCode: "vertical-slice-completed",
      evidence: { tick: state.tick },
    };
  }
  if (state.benchmarks.active !== null) {
    return {
      kind: "advance",
      ticks: DEFAULT_BOT_RUN_CONFIGURATION.decisionIntervalTicks,
      reasonCode: "benchmark-in-progress",
    };
  }
  if (Object.keys(state.facility.modules).length === 0) {
    return { kind: "apply-template", templateId: "starter-serial", reasonCode: "empty-facility" };
  }
  if (
    policy.prioritizeTemplateUpgrade &&
    !templateApplied(state, runtime, "expanded-balanced") &&
    state.research.statuses["research-stable-power-distribution"] === "completed"
  ) {
    const wiringStudy = Object.values(state.tasks.instances).find(
      (task) => task.definitionId === "task-wiring-layout-study",
    );
    if (wiringStudy === undefined && state.tasks.offers.includes("task-wiring-layout-study")) {
      // Let the real workload expose the starter layout's capacity limit before
      // preemptively installing the upgrade that resolves it.
    } else if (wiringStudy?.status === "active" && runtime.blockingBottleneckObserved !== true) {
      return {
        kind: "advance",
        ticks: DEFAULT_BOT_RUN_CONFIGURATION.decisionIntervalTicks,
        reasonCode: "observe-arithmetic-capacity-bottleneck",
      };
    } else {
      return {
        kind: "apply-template",
        templateId: "expanded-balanced",
        reasonCode: "arithmetic-capacity-required",
      };
    }
  }
  const allocatedTask = finiteActiveTask(state);
  if (
    allocatedTask?.allocation !== null &&
    allocatedTask !== undefined &&
    runtime.taskPrimaryModuleIds !== undefined &&
    (allocatedTask.allocation.clusterModuleIds.length !== runtime.taskPrimaryModuleIds.length ||
      allocatedTask.allocation.clusterModuleIds.some(
        (id, index) => id !== runtime.taskPrimaryModuleIds?.[index],
      ))
  ) {
    return {
      kind: "allocate-active-task",
      taskInstanceId: allocatedTask.id,
      clusterModuleIds: runtime.taskPrimaryModuleIds,
      requestedShare: allocatedTask.allocation.requestedShare,
      reasonCode: "template-capacity-reallocation",
    };
  }
  if (
    policy.prioritizeTemplateUpgrade &&
    !templateApplied(state, runtime, "cooled-benchmark") &&
    state.research.statuses["research-vacuum-tube-reliability"] === "completed" &&
    state.research.statuses["research-delay-line-memory"] === "completed"
  ) {
    return {
      kind: "apply-template",
      templateId: "cooled-benchmark",
      reasonCode: "cooling-required",
    };
  }
  if (
    isFeatureUnlocked("subassembly-blueprints", state.research, content) &&
    Object.keys(state.blueprints.records).length === 0 &&
    runtime.blueprintSelectionModuleIds.length > 0
  ) {
    return {
      kind: "save-blueprint",
      name: "BOT Starter Subassembly",
      selectedModuleIds: runtime.blueprintSelectionModuleIds,
      reasonCode: "first-blueprint",
    };
  }
  if (
    state.research.active === null &&
    finiteActiveTask(state) === undefined &&
    runtime.appliedTemplateIds.includes("cooled-benchmark")
  ) {
    const sustained = content.era.benchmarkDefinitions.find(
      (benchmark) => benchmark.type === "sustained",
    );
    const peak = content.era.benchmarkDefinitions.find((benchmark) => benchmark.type === "peak");
    if (
      sustained !== undefined &&
      !state.benchmarks.history.some((run) => run.benchmarkId === sustained.id && run.passed)
    ) {
      return {
        kind: "start-benchmark",
        benchmarkId: sustained.id,
        clusterRole: "benchmark-sustained",
        profile: policy.sustainedProfile,
        reasonCode: "sustained-before-peak",
      };
    }
    if (
      peak !== undefined &&
      state.benchmarks.history.some((run) => run.benchmarkId === sustained?.id && run.passed) &&
      !state.benchmarks.history.some((run) => run.benchmarkId === peak.id && run.passed) &&
      isFeatureUnlocked("peak-benchmark", state.research, content)
    ) {
      return {
        kind: "start-benchmark",
        benchmarkId: peak.id,
        clusterRole: "benchmark-peak",
        profile: policy.peakProfile,
        profileModuleSymbolicKeys: ["arithmetic-5"],
        reasonCode: "peak-after-sustained",
      };
    }
  }
  const firstBlueprintNode = content.research[graph.firstBlueprintNodeId];
  if (
    firstBlueprintNode !== undefined &&
    isResearchEligibilityReconciliationPending(firstBlueprintNode, state)
  ) {
    return {
      kind: "advance",
      ticks: DEFAULT_BOT_RUN_CONFIGURATION.decisionIntervalTicks,
      reasonCode: "research-eligibility-reconciliation",
    };
  }
  const research = selectNextResearch(state, content, graph);
  if (research !== undefined) {
    return {
      kind: "start-research",
      nodeId: research.node.id,
      reservedComputeShare: research.reservedComputeShare,
      reasonCode: "critical-research",
    };
  }
  const task = selectNextTask(state, content, graph, policy.allowInfiniteService);
  if (task !== undefined) {
    return {
      kind: "accept-and-allocate-task",
      definitionId: task.task.id,
      clusterRole: "task-primary",
      requestedShare: Math.max(0.1, 1 - requestedTaskShare(state)),
      reasonCode: "critical-task",
    };
  }
  const currentTask = finiteActiveTask(state);
  const overclockable = overclockableModuleEntries(state, content, runtime);
  const targetIds = overclockable.map(({ id }) => id);
  const targetKeys = overclockable.map(({ key }) => key);
  const targetState = {
    state,
    content,
    moduleIds: targetIds,
    stabilityMinimum: activeTaskStabilityMinimum(state, content),
  };
  const currentProfiles = targetIds.map((id) => state.facility.modules[id]?.overclock.profile);
  const deadlineRiskBoost = runtime.currentBlockingReasonCode === "deadline-risk";
  if (
    currentTask !== undefined &&
    (policy.taskProfile === "boost" || deadlineRiskBoost) &&
    targetIds.length > 0
  ) {
    if (currentProfiles.some((profile) => profile === "boost") && mustExitBoost(targetState)) {
      return {
        kind: "set-overclock",
        profile: "balanced",
        moduleSymbolicKeys: targetKeys,
        reasonCode: "boost-exit-guard",
      };
    }
    const alreadyBoost = currentProfiles.every((profile) => profile === "boost");
    const stabilized =
      runtime.boostExitObserved !== true ||
      (runtime.boostStableTicks ?? 0) >= policy.boostReentryStabilizationTicks;
    if (!alreadyBoost && stabilized && canEnterBoost(targetState)) {
      return {
        kind: "set-overclock",
        profile: "boost",
        moduleSymbolicKeys: targetKeys,
        reasonCode: deadlineRiskBoost ? "deadline-risk-boost" : "aggressive-task-boost",
      };
    }
  }
  if (
    currentTask === undefined &&
    state.research.active === null &&
    policy.idleProfile === "eco" &&
    targetIds.length > 0 &&
    currentProfiles.some((profile) => profile !== "eco")
  ) {
    return {
      kind: "set-overclock",
      profile: "eco",
      moduleSymbolicKeys: targetKeys,
      reasonCode: "conservative-idle-profile",
    };
  }
  return {
    kind: "advance",
    ticks: DEFAULT_BOT_RUN_CONFIGURATION.decisionIntervalTicks,
    reasonCode: "productive-wait",
  };
}

export function policyParametersFor(policyId: MilestoneBotPolicyId): BotPolicyParameters {
  return BOT_POLICY_PARAMETERS[policyId];
}

export function validateBotDecision(decision: BotDecision): void {
  if (decision.kind === "advance" && (!Number.isSafeInteger(decision.ticks) || decision.ticks <= 0))
    throw new TypeError("Bot advance decision requires positive ticks.");
  if (
    decision.kind === "start-benchmark" &&
    decision.profileModuleSymbolicKeys !== undefined &&
    (decision.profileModuleSymbolicKeys.length === 0 ||
      new Set(decision.profileModuleSymbolicKeys).size !==
        decision.profileModuleSymbolicKeys.length)
  )
    throw new TypeError("Benchmark profile targets must be nonempty and unique.");
  if (
    decision.kind === "start-research" &&
    (!Number.isFinite(decision.reservedComputeShare) ||
      decision.reservedComputeShare <= 0 ||
      decision.reservedComputeShare > 1)
  )
    throw new TypeError("Research share is outside 0..1.");
  if (
    decision.kind === "accept-and-allocate-task" &&
    (!Number.isFinite(decision.requestedShare) ||
      decision.requestedShare <= 0 ||
      decision.requestedShare > 1)
  )
    throw new TypeError("Task share is outside 0..1.");
  if (
    decision.kind === "allocate-active-task" &&
    (!Number.isFinite(decision.requestedShare) ||
      decision.requestedShare <= 0 ||
      decision.requestedShare > 1 ||
      decision.clusterModuleIds.length === 0)
  )
    throw new TypeError("Task reallocation is invalid.");
  if (decision.kind === "terminal") return;
  if (!Object.hasOwn(decision, "reasonCode") || decision.reasonCode.length === 0)
    throw new TypeError("Bot decisions require a stable reason code.");
}

export function freezeDecision(decision: BotDecision): BotDecision {
  validateBotDecision(decision);
  return detachAndFreezeReplayData(decision);
}
