import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { runReplay } from "../../sim/replay/replayRunner.ts";
import type { ReplayRecordingArtifact } from "../../sim/replay/replayContracts.ts";
import type { GameState } from "../../sim/core/types.ts";
import { calculateCampaignTicksPerYear } from "../../sim/campaign/campaignDomain.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import {
  createDefaultBotRunConfiguration,
  MAXIMUM_FORCED_DEADTIME_TICKS,
  type BotPolicyParameters,
  type BotBlockerEpisode,
  type BotRunConfiguration,
  type BotWaitEpisode,
  type BotWaitSummary,
  type MilestoneBotPolicyId,
  type MilestoneBotReport,
  type MilestoneRecord,
} from "./botContracts.ts";
import {
  policyParametersFor,
  selectBaselineDecision,
  type BotDecision,
  type BotPolicyRuntimeFacts,
} from "./baselinePolicy.ts";
import { createMilestonePolicyResearchGraph } from "./policyGraph.ts";
import {
  createReplayCommandDriver,
  BotExecutionError,
  type ReplayCommandDriver,
} from "./replayCommandDriver.ts";
import {
  createTemplateExecutor,
  type MilestoneTemplateId,
  type TemplateExecutor,
} from "./templateExecutor.ts";
import { observeMilestones } from "./milestoneObserver.ts";
import {
  initialBlockingTracker,
  updateBlockingTracker,
  type BlockingTracker,
} from "./blockerAnalysis.ts";
import {
  createProgressProjection,
  hashProgressProjection,
  updateHardLockProgressAnchor,
  type HardLockProgressAnchor,
} from "./progressProjection.ts";
import { buildMilestoneBotReport, validateMilestoneBotReport } from "./botReport.ts";
import { canEnterBoost, countShutdownTransitions } from "./strategyGuards.ts";

export interface MilestoneBotRunOptions {
  readonly content: ContentBundle;
  readonly seed: string;
  readonly policyId?: MilestoneBotPolicyId;
  readonly configuration?: BotRunConfiguration;
}

export interface MilestoneBotRunResult {
  readonly report: MilestoneBotReport;
  readonly artifact: ReplayRecordingArtifact;
}

interface WaitAccumulator {
  readonly productive: BotWaitEpisode[];
  readonly forced: BotWaitEpisode[];
}

export interface PostDecisionAdvanceOptions {
  readonly decisionKind: BotDecision["kind"];
  readonly decisionIntervalTicks: number;
  readonly remainingRunTicks: number;
  readonly remainingBenchmarkTicks: number | null;
}

export function calculatePostDecisionAdvanceTicks({
  decisionKind,
  decisionIntervalTicks,
  remainingRunTicks,
  remainingBenchmarkTicks,
}: PostDecisionAdvanceOptions): number {
  if (decisionKind === "advance" || decisionKind === "terminal" || remainingRunTicks <= 0) return 0;
  return Math.min(
    decisionIntervalTicks,
    remainingRunTicks,
    remainingBenchmarkTicks ?? remainingRunTicks,
  );
}

function emptyWaitAccumulator(): WaitAccumulator {
  return { productive: [], forced: [] };
}

function appendWait(
  accumulator: WaitAccumulator,
  kind: "productive" | "forced-deadtime",
  start: number,
  end: number,
  evidence: Record<string, string | number | boolean | null>,
): void {
  if (end <= start) return;
  const episodes = kind === "productive" ? accumulator.productive : accumulator.forced;
  const last = episodes.at(-1);
  if (last?.kind === kind && last.endedAtTick === start) {
    episodes[episodes.length - 1] = {
      ...last,
      endedAtTick: end,
      durationTicks: end - last.startedAtTick,
    };
  } else {
    episodes.push({
      kind,
      startedAtTick: start,
      endedAtTick: end,
      durationTicks: end - start,
      evidence,
    });
  }
}

function waitSummary(episodes: readonly BotWaitEpisode[]): BotWaitSummary {
  return {
    totalTicks: episodes.reduce((total, episode) => total + episode.durationTicks, 0),
    maximumContiguousTicks: episodes.reduce(
      (maximum, episode) => Math.max(maximum, episode.durationTicks),
      0,
    ),
    episodeCount: episodes.length,
    episodes,
  };
}

function activeTemplate(executor: TemplateExecutor): MilestoneTemplateId {
  return executor.getAppliedTemplateIds().at(-1) ?? "starter-serial";
}

function moduleIdsForKeys(executor: TemplateExecutor, keys: readonly string[]): readonly string[] {
  const mapping = executor.getModuleMapping();
  const ids = keys.map((key) => mapping[key]);
  if (ids.some((id) => id === undefined))
    throw new Error("Policy referenced a missing symbolic module.");
  return ids as readonly string[];
}

function findNewTaskId(before: Readonly<GameState>, after: Readonly<GameState>): string {
  const previous = new Set(Object.keys(before.tasks.instances));
  const additions = Object.keys(after.tasks.instances).filter((id) => !previous.has(id));
  if (additions.length !== 1 || additions[0] === undefined)
    throw new Error("Task acceptance did not allocate exactly one instance.");
  return additions[0];
}

function executeDecision(
  decision: BotDecision,
  driver: ReplayCommandDriver,
  executor: TemplateExecutor,
  policy: BotPolicyParameters,
  runtime: {
    appliedTemplateIds: MilestoneTemplateId[];
    moduleMapping: Readonly<Record<string, string>>;
  },
): void {
  switch (decision.kind) {
    case "apply-template": {
      const result = executor.applyTemplate(decision.templateId);
      runtime.appliedTemplateIds = [...executor.getAppliedTemplateIds()];
      runtime.moduleMapping = executor.getModuleMapping();
      if (result.addedModuleIds.length === 0) throw new Error("Template applied without modules.");
      return;
    }
    case "save-blueprint":
      driver.submitGameplayCommand({
        kind: "SAVE_BLUEPRINT",
        name: decision.name,
        selectedModuleIds: [...decision.selectedModuleIds],
      });
      return;
    case "start-benchmark": {
      const ids = executor.resolveClusterRole(activeTemplate(executor), decision.clusterRole);
      const profileIds =
        decision.profileModuleSymbolicKeys === undefined
          ? ids
          : moduleIdsForKeys(executor, decision.profileModuleSymbolicKeys);
      driver.submitGameplayCommand({
        kind: "SET_OVERCLOCK_PROFILE",
        moduleInstanceIds: [...profileIds],
        profile: decision.profile,
      });
      driver.submitGameplayCommand({
        kind: "START_BENCHMARK",
        benchmarkId: decision.benchmarkId,
        clusterModuleIds: [...ids],
      });
      return;
    }
    case "set-overclock": {
      const ids = moduleIdsForKeys(executor, decision.moduleSymbolicKeys);
      if (ids.length > 0)
        driver.submitGameplayCommand({
          kind: "SET_OVERCLOCK_PROFILE",
          moduleInstanceIds: [...ids],
          profile: decision.profile,
        });
      return;
    }
    case "start-research":
      driver.submitGameplayCommand({
        kind: "START_RESEARCH",
        nodeId: decision.nodeId,
        reservedComputeShare: decision.reservedComputeShare,
      });
      return;
    case "accept-and-allocate-task": {
      const template = activeTemplate(executor);
      const before = driver.getDetachedState();
      driver.submitGameplayCommand({ kind: "ACCEPT_TASK", definitionId: decision.definitionId });
      const accepted = driver.getDetachedState();
      const taskInstanceId = findNewTaskId(before, accepted);
      const ids = executor.resolveClusterRole(template, decision.clusterRole);
      driver.submitGameplayCommand({
        kind: "ALLOCATE_TASK",
        taskInstanceId,
        clusterModuleIds: [...ids],
        requestedShare: decision.requestedShare,
      });
      return;
    }
    case "allocate-active-task":
      driver.submitGameplayCommand({
        kind: "ALLOCATE_TASK",
        taskInstanceId: decision.taskInstanceId,
        clusterModuleIds: [...decision.clusterModuleIds],
        requestedShare: decision.requestedShare,
      });
      return;
    case "advance":
      driver.advanceTicks(decision.ticks);
      return;
    case "terminal":
      return;
  }
  void policy;
}

function terminalFromFailure(error: unknown): MilestoneBotReport["status"] {
  if (error instanceof BotExecutionError) return "command-rejected";
  return "policy-error";
}

function replayStatus(
  status: ReturnType<typeof runReplay>,
): "matched" | "matched-fatal" | "not-run" {
  return status.status === "matched"
    ? "matched"
    : status.status === "matched-fatal"
      ? "matched-fatal"
      : "not-run";
}

function createRuntimeFacts(
  executor: TemplateExecutor,
  lastAcceptedAction: string | null,
  runtime: { readonly boostStableTicks: number; readonly boostExitObserved: boolean },
  blockingBottleneckObserved: boolean,
  currentBlockingReasonCode: string | null,
): BotPolicyRuntimeFacts {
  const appliedTemplateIds = executor.getAppliedTemplateIds();
  const currentTemplateId = appliedTemplateIds.at(-1);
  return {
    appliedTemplateIds,
    moduleMapping: executor.getModuleMapping(),
    blueprintSelectionModuleIds:
      currentTemplateId === undefined
        ? Object.freeze([])
        : executor.resolveClusterRole(currentTemplateId, "blueprint-selection"),
    taskPrimaryModuleIds:
      currentTemplateId === undefined
        ? Object.freeze([])
        : executor.resolveClusterRole(currentTemplateId, "task-primary"),
    lastAcceptedAction,
    blockingBottleneckObserved,
    currentBlockingReasonCode,
    boostStableTicks: runtime.boostStableTicks,
    boostExitObserved: runtime.boostExitObserved,
  };
}

function updateBoostRuntime(
  runtime: {
    boostWasActive: boolean;
    boostExitObserved: boolean;
    boostStableTicks: number;
    lastObservedTick: number;
  },
  state: Readonly<GameState>,
  content: ContentBundle,
  moduleMapping: Readonly<Record<string, string>>,
  requiredTicks: number,
): void {
  if (state.tick <= runtime.lastObservedTick) return;
  const targetIds = Object.values(moduleMapping).filter((id) => {
    const module = state.facility.modules[id];
    return module !== undefined && content.modules[module.definitionId]?.overclockable === true;
  });
  const activeBoost = targetIds.some(
    (id) => state.facility.modules[id]?.overclock.profile === "boost",
  );
  const elapsed = state.tick - runtime.lastObservedTick;
  if (runtime.boostWasActive && !activeBoost) {
    runtime.boostExitObserved = true;
    runtime.boostStableTicks = 0;
  } else if (runtime.boostExitObserved && !activeBoost) {
    const task = Object.values(state.tasks.instances).find(
      (candidate) =>
        candidate.status === "active" &&
        candidate.definitionId !== "task-census-tabulation-service",
    );
    const stabilityMinimum =
      task === undefined
        ? 0
        : (content.tasks[task.definitionId]?.phases[task.currentPhaseIndex]?.stabilityMinimum ?? 0);
    const stable = canEnterBoost({ state, content, moduleIds: targetIds, stabilityMinimum });
    runtime.boostStableTicks = stable
      ? Math.min(requiredTicks, runtime.boostStableTicks + elapsed)
      : 0;
  }
  if (activeBoost) {
    runtime.boostWasActive = true;
    if (runtime.boostExitObserved) {
      runtime.boostExitObserved = false;
      runtime.boostStableTicks = 0;
    }
  }
  runtime.lastObservedTick = state.tick;
}

function updateRuntimeMetrics(
  metrics: {
    shutdownTransitions: number;
    maximumTemperatureC: number;
    minimumStabilityFactor: number;
  },
  previous: Readonly<GameState> | null,
  state: Readonly<GameState>,
): void {
  metrics.shutdownTransitions += countShutdownTransitions(previous, state);
  for (const tile of state.facility.thermalTiles) {
    metrics.maximumTemperatureC = Math.max(metrics.maximumTemperatureC, tile.temperatureC);
  }
  for (const module of Object.values(state.facility.overclock.byModule)) {
    metrics.minimumStabilityFactor = Math.min(
      metrics.minimumStabilityFactor,
      module.stabilityFactor,
    );
  }
}

function failedTaskExists(state: Readonly<GameState>): boolean {
  return Object.values(state.tasks.instances).some((task) => task.status === "failed");
}

function failedBenchmarkExists(state: Readonly<GameState>): boolean {
  return state.benchmarks.history.some((run) => !run.passed);
}

function hasNearTermEligibilityTransition(
  state: Readonly<GameState>,
  content: ContentBundle,
  horizonTicks: number,
): boolean {
  const nextYearTick =
    (state.campaign.currentYear - content.era.startYear + 1) *
    calculateCampaignTicksPerYear(content);
  if (nextYearTick > state.tick && nextYearTick - state.tick <= horizonTicks) return true;
  if (state.research.active !== null || state.benchmarks.active !== null) return true;
  if (
    Object.values(state.tasks.instances).some(
      (task) => task.status === "active" || task.status === "hold",
    )
  )
    return true;
  return Object.values(state.facility.modules).some(
    (module) => module.startupTicksRemaining > 0 || module.cooldownTicksRemaining > 0,
  );
}

function assertValidRunOptions(value: unknown): asserts value is MilestoneBotRunOptions {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Milestone bot run options must be a plain object.");
  }
  const allowed = new Set(["content", "seed", "policyId", "configuration"]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    !keys.includes("content") ||
    !keys.includes("seed")
  ) {
    throw new TypeError("Milestone bot run options contain unexpected or missing keys.");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError("Milestone bot run options must contain data properties only.");
    }
  }
}

export function runMilestoneBot(options: MilestoneBotRunOptions): MilestoneBotRunResult {
  assertValidRunOptions(options);
  const {
    content,
    seed,
    policyId = "baseline-balanced",
    configuration = createDefaultBotRunConfiguration(),
  } = options;
  const graph = createMilestonePolicyResearchGraph(content);
  const policy = policyParametersFor(policyId);
  const driver = createReplayCommandDriver({
    content,
    seed,
    configuration,
  });
  const executor = createTemplateExecutor({ content, driver });
  const initial = driver.getDetachedState();
  const initialRngState = initial.rngState;
  const runtime = {
    appliedTemplateIds: [] as MilestoneTemplateId[],
    moduleMapping: Object.freeze({}) as Readonly<Record<string, string>>,
    boostWasActive: false,
    boostExitObserved: false,
    boostStableTicks: 0,
    lastObservedTick: initial.tick,
  };
  const waits = emptyWaitAccumulator();
  let records: readonly MilestoneRecord[] = [];
  let previousState: GameState | null = null;
  let blockerTracker: BlockingTracker = initialBlockingTracker;
  const blockers: BotBlockerEpisode[] = [];
  let status: MilestoneBotReport["status"];
  let lastAcceptedAction: string | null = null;
  let pendingWaitStart: HardLockProgressAnchor | null = null;
  const runtimeMetrics = {
    shutdownTransitions: 0,
    maximumTemperatureC: initial.facility.ambientTemperatureC,
    minimumStabilityFactor: 1,
  };
  updateRuntimeMetrics(runtimeMetrics, null, initial);

  try {
    driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
    records = observeMilestones({
      content,
      state: initial,
      previousState: null,
      previousRecords: {},
      decisionIntervalTicks: configuration.decisionIntervalTicks,
    });
    for (;;) {
      const state = driver.getDetachedState();
      updateBoostRuntime(
        runtime,
        state,
        content,
        runtime.moduleMapping,
        policy.boostReentryStabilizationTicks,
      );
      updateRuntimeMetrics(runtimeMetrics, previousState, state);
      if (failedTaskExists(state)) {
        status = "task-failed";
        break;
      }
      if (failedBenchmarkExists(state)) {
        status = "benchmark-failed";
        break;
      }
      if (state.tick >= configuration.maximumRunTicks) {
        status = state.campaign.verticalSliceCompleted ? "completed" : "time-limit";
        break;
      }
      const nextBlocker = updateBlockingTracker(
        blockerTracker,
        state,
        configuration.blockingBottleneckWindowTicks,
        content,
      );
      blockerTracker = nextBlocker.tracker;
      if (nextBlocker.episode !== undefined) blockers.push(nextBlocker.episode);
      records = observeMilestones({
        content,
        state,
        previousState,
        previousRecords: Object.fromEntries(records.map((record) => [record.id, record])),
        decisionIntervalTicks: configuration.decisionIntervalTicks,
        ...(nextBlocker.occurrence === undefined
          ? {}
          : { blockingOccurrence: nextBlocker.occurrence }),
      });
      if (state.campaign.verticalSliceCompleted) {
        status = "completed";
        break;
      }
      const decision = selectBaselineDecision({
        state,
        content,
        graph,
        policy,
        runtime: createRuntimeFacts(
          executor,
          lastAcceptedAction,
          runtime,
          records.some(
            (record) => record.id === "first-blocking-bottleneck" && record.status === "observed",
          ),
          blockerTracker.reported ? (blockerTracker.cause?.reasonCode ?? null) : null,
        ),
      });
      if (decision.kind === "terminal") {
        status = decision.status;
        break;
      }
      const before = driver.getDetachedState();
      const beforeHash = hashProgressProjection(
        createProgressProjection(before, runtime.appliedTemplateIds),
      );
      executeDecision(decision, driver, executor, policy, runtime);
      if (decision.kind !== "advance") lastAcceptedAction = decision.kind;
      const afterAction = driver.getDetachedState();
      updateRuntimeMetrics(runtimeMetrics, before, afterAction);
      if (decision.kind !== "advance") {
        records = observeMilestones({
          content,
          state: afterAction,
          previousState: before,
          previousRecords: Object.fromEntries(records.map((record) => [record.id, record])),
          decisionIntervalTicks: configuration.decisionIntervalTicks,
        });
      }
      if (decision.kind === "advance") {
        const afterHash = hashProgressProjection(
          createProgressProjection(afterAction, runtime.appliedTemplateIds),
        );
        appendWait(
          waits,
          afterHash === beforeHash ? "forced-deadtime" : "productive",
          before.tick,
          afterAction.tick,
          { reasonCode: decision.reasonCode },
        );
        pendingWaitStart = updateHardLockProgressAnchor(pendingWaitStart, {
          beforeTick: before.tick,
          beforeHash,
          afterTick: afterAction.tick,
          afterHash,
        });
      } else {
        pendingWaitStart = null;
      }
      // For a direct advance, the next observation compares the state before
      // the wait with the state after it. Non-advance decisions may receive an
      // automatic wait below, so their comparison point is the post-command
      // state before that automatic wait.
      previousState = decision.kind === "advance" ? before : afterAction;
      let remainingBenchmarkTicks: number | null = null;
      if (afterAction.benchmarks.active !== null) {
        const definition = content.era.benchmarkDefinitions.find(
          (candidate) => candidate.id === afterAction.benchmarks.active?.benchmarkId,
        );
        remainingBenchmarkTicks =
          definition === undefined
            ? configuration.decisionIntervalTicks
            : Math.max(
                1,
                definition.durationSeconds * 10 - afterAction.benchmarks.active.elapsedTicks,
              );
      }
      const postDecisionAdvanceTicks = calculatePostDecisionAdvanceTicks({
        decisionKind: decision.kind,
        decisionIntervalTicks: configuration.decisionIntervalTicks,
        remainingRunTicks: configuration.maximumRunTicks - afterAction.tick,
        remainingBenchmarkTicks,
      });
      if (postDecisionAdvanceTicks > 0) driver.advanceTicks(postDecisionAdvanceTicks);
      updateRuntimeMetrics(runtimeMetrics, afterAction, driver.getDetachedState());
      const currentAfterAction = driver.getDetachedState();
      if (
        pendingWaitStart !== null &&
        currentAfterAction.tick - pendingWaitStart.tick >= configuration.hardLockWindowTicks &&
        !hasNearTermEligibilityTransition(
          currentAfterAction,
          content,
          MAXIMUM_FORCED_DEADTIME_TICKS,
        )
      ) {
        status = "hard-lock";
        break;
      }
    }
  } catch (error: unknown) {
    status = terminalFromFailure(error);
  }

  const finalState = driver.getDetachedState();
  updateRuntimeMetrics(runtimeMetrics, previousState, finalState);
  const artifact = driver.finishReplay();
  const replay = runReplay({ content, initialState: artifact.initialState, log: artifact.log });
  const verification = replayStatus(replay);
  if (status === "completed" && verification !== "matched") status = "policy-error";
  if (verification === "matched-fatal" && status !== "command-rejected") status = "invariant-fatal";
  const report = buildMilestoneBotReport({
    policyId,
    seed,
    content,
    initialRngState,
    state: finalState,
    artifact,
    replayVerification: verification,
    milestones: records,
    blockers,
    productiveWait: waitSummary(waits.productive),
    forcedDeadtime: waitSummary(waits.forced),
    commandSummary: driver.getCommandSummary(),
    status,
    moduleShutdownTransitionCount: runtimeMetrics.shutdownTransitions,
    maximumTemperatureC: runtimeMetrics.maximumTemperatureC,
    minimumStabilityFactor: runtimeMetrics.minimumStabilityFactor,
  });
  validateMilestoneBotReport(report);
  return detachAndFreezeReplayData({ report, artifact });
}
