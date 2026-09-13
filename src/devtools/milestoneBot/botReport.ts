import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { ReplayRecordingArtifact } from "../../sim/replay/replayContracts.ts";
import { hashCanonicalState } from "../../sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import type { GameState } from "../../sim/core/types.ts";
import {
  hashReportProjection,
  type BotCommandSummary,
  type BotBlockerEpisode,
  type BotWaitSummary,
  type MilestoneBotReport,
  type MilestoneRecord,
  type MilestoneBotPolicyId,
} from "./botContracts.ts";

function sortedCompleted(
  ids: readonly string[],
  content: ContentBundle,
  kind: "research" | "task",
): readonly string[] {
  return ids.toSorted((left, right) => {
    const leftOrder =
      kind === "research" ? content.research[left]?.sortOrder : content.tasks[left]?.sortOrder;
    const rightOrder =
      kind === "research" ? content.research[right]?.sortOrder : content.tasks[right]?.sortOrder;
    return (
      (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER) ||
      (left < right ? -1 : left > right ? 1 : 0)
    );
  });
}

function replayTickCount(artifact: ReplayRecordingArtifact): number {
  return artifact.log.entries.reduce(
    (total, entry) => total + (entry.operation.kind === "step" ? entry.operation.ticks : 0),
    0,
  );
}

function defaultWaitSummary(): BotWaitSummary {
  return { totalTicks: 0, maximumContiguousTicks: 0, episodeCount: 0, episodes: [] };
}

export interface MilestoneBotReportInput {
  readonly policyId: MilestoneBotPolicyId;
  readonly seed: string;
  readonly content: ContentBundle;
  readonly initialRngState: number;
  readonly state: Readonly<GameState>;
  readonly artifact: ReplayRecordingArtifact;
  readonly replayVerification: "matched" | "matched-fatal" | "not-run";
  readonly milestones: readonly MilestoneRecord[];
  readonly blockers?: readonly BotBlockerEpisode[];
  readonly productiveWait?: BotWaitSummary;
  readonly forcedDeadtime?: BotWaitSummary;
  readonly commandSummary: BotCommandSummary;
  readonly status: MilestoneBotReport["status"];
  readonly moduleShutdownTransitionCount?: number;
  readonly maximumTemperatureC?: number;
  readonly minimumStabilityFactor?: number;
}

export function buildMilestoneBotReport(input: MilestoneBotReportInput): MilestoneBotReport {
  const { state, artifact } = input;
  const temperatures = state.facility.thermalTiles.map((tile) => tile.temperatureC);
  const maximumTemperatureC = Math.max(
    input.maximumTemperatureC ?? Number.NEGATIVE_INFINITY,
    ...temperatures,
    state.facility.ambientTemperatureC,
  );
  const stabilityValues = Object.values(state.facility.overclock.byModule).map(
    (module) => module.stabilityFactor,
  );
  const minimumStabilityFactor = Math.min(input.minimumStabilityFactor ?? 1, ...stabilityValues, 1);
  const completedTaskIds = sortedCompleted(
    Object.values(state.tasks.instances)
      .filter((task) => task.status === "completed")
      .map((task) => task.definitionId),
    input.content,
    "task",
  );
  const completedResearchIds = sortedCompleted(
    Object.entries(state.research.statuses)
      .filter(([, status]) => status === "completed")
      .map(([id]) => id),
    input.content,
    "research",
  );
  const passedBenchmarkIds = state.benchmarks.history
    .filter((run) => run.passed)
    .map((run) => run.benchmarkId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .toSorted();
  const savedBlueprintIds = Object.keys(state.blueprints.records).toSorted();
  const withoutHash: Omit<MilestoneBotReport, "reportHash"> = {
    reportVersion: 1,
    policyId: input.policyId,
    seed: input.seed,
    simulationContentHash: hashSimulationContent(input.content),
    status: input.status,
    initialRngState: input.initialRngState,
    finalRngState: state.rngState,
    finalTick: state.tick,
    finalSimulatedSeconds: state.clock.simulatedSeconds,
    commandSummary: input.commandSummary,
    replayEntryCount: artifact.log.entries.length,
    replayTickCount: replayTickCount(artifact),
    replayVerification: input.replayVerification,
    milestones: input.milestones,
    blockers: input.blockers ?? [],
    productiveWait: input.productiveWait ?? defaultWaitSummary(),
    forcedDeadtime: input.forcedDeadtime ?? defaultWaitSummary(),
    completedTaskIds,
    completedResearchIds,
    passedBenchmarkIds,
    savedBlueprintIds,
    finalCashUsd: state.economy.cashUsd,
    totalIncomeUsd: state.economy.totalIncomeUsd,
    totalExpenseUsd: state.economy.totalExpenseUsd,
    moduleShutdownTransitionCount: input.moduleShutdownTransitionCount ?? 0,
    maximumTemperatureC,
    minimumStabilityFactor,
    finalStateHash: hashCanonicalState(state),
    replayHash: hashCanonicalState(artifact.log),
  };
  return detachAndFreezeReplayData({
    ...withoutHash,
    reportHash: hashReportProjection(withoutHash),
  });
}

export function validateMilestoneBotReport(report: MilestoneBotReport): void {
  if (report.milestones.length === 0)
    throw new TypeError("Milestone bot report has no milestones.");
  if (!Number.isSafeInteger(report.finalTick) || report.finalTick < 0)
    throw new TypeError("Milestone bot final tick is invalid.");
  const { reportHash, ...projection } = report;
  if (reportHash !== hashReportProjection(projection))
    throw new TypeError("Milestone bot report hash is invalid.");
}
