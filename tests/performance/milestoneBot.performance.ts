import { cpus, platform, release } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createTask9PerformanceFixture } from "./thermalFixture.ts";
import { calculateCampaignYearForCompletedTick } from "../../src/sim/campaign/campaignDomain.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { createReplayRecorder } from "../../src/sim/replay/replayRecorder.ts";
import { executeReplayEntry } from "../../src/sim/replay/replayRunner.ts";
import { parseReplayLog } from "../../src/sim/replay/replaySchema.ts";
import { createMilestonePolicyResearchGraph } from "../../src/devtools/milestoneBot/policyGraph.ts";
import {
  policyParametersFor,
  selectBaselineDecision,
} from "../../src/devtools/milestoneBot/baselinePolicy.ts";
import {
  assertValidBotRunConfiguration,
  createDefaultBotRunConfiguration,
  type MilestoneBotPolicyId,
} from "../../src/devtools/milestoneBot/botContracts.ts";
import { validateMilestoneBotReport } from "../../src/devtools/milestoneBot/botReport.ts";
import { validateAllBuildTemplates } from "../../src/devtools/milestoneBot/buildTemplateValidation.ts";
import { createReplayCommandDriver } from "../../src/devtools/milestoneBot/replayCommandDriver.ts";
import { createTemplateExecutor } from "../../src/devtools/milestoneBot/templateExecutor.ts";
import { observeMilestones } from "../../src/devtools/milestoneBot/milestoneObserver.ts";
import {
  updateBlockingTracker,
  initialBlockingTracker,
} from "../../src/devtools/milestoneBot/blockerAnalysis.ts";
import { runMilestoneBot } from "../../src/devtools/milestoneBot/milestoneBotRunner.ts";
import { createMilestoneBotComparisonReport } from "../../src/devtools/milestoneBot/strategyComparison.ts";

const content = loadContentBundle();
const seed = "task-15-strategy-comparison-v1";
const configuration = createDefaultBotRunConfiguration();
const policies: readonly MilestoneBotPolicyId[] = [
  "baseline-balanced",
  "conservative-thermal",
  "aggressive-boost",
];

interface Measurement {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function summarize(values: readonly number[]): Measurement {
  const sorted = values.toSorted((left, right) => left - right);
  const percentile = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  return {
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maximumMs: sorted.at(-1) ?? 0,
    samples: values.length,
  };
}

function measure(operation: () => void, samples: number, warmups = 100): Measurement {
  for (let index = 0; index < warmups; index += 1) operation();
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = process.hrtime.bigint();
    operation();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function runPolicy(
  policyId: MilestoneBotPolicyId,
): ReturnType<typeof runMilestoneBot> & { readonly wallClockMs: number } {
  const start = process.hrtime.bigint();
  const result = runMilestoneBot({ content, seed, policyId, configuration });
  return { ...result, wallClockMs: elapsedMs(start) };
}

function createAuditedProductionCore(index: number) {
  return createProductionSimCore({
    content,
    initialState: createAuditedProductionState(index),
  });
}

function createAuditedProductionState(index: number): GameState {
  const state = createTask9PerformanceFixture(`task-15-performance-${index}`);
  // The existing dense Task 14 diagnostic fixture uses the same audited
  // facility geometry but removes lifecycle consumers so a production tick
  // measures the full pipeline without an intentionally stale Task 9 result.
  state.tasks.instances = {};
  state.tasks.offers = [];
  return state;
}

function createAuditedRecordingFixture(index: number) {
  const recorder = createReplayRecorder({
    content,
    initialState: createAuditedProductionState(index),
  });
  recorder.perform({ kind: "step", ticks: 1 });
  recorder.perform({ kind: "step", ticks: 1 });
  recorder.perform({ kind: "step", ticks: 1 });
  recorder.perform({ kind: "step", ticks: 1 });
  const artifact = recorder.finish();
  const log = parseReplayLog(artifact.log);
  const entry = log.entries[3];
  if (entry === undefined) throw new Error("Audited replay fixture is missing its measured entry.");
  return { artifact, entry };
}

function commandKinds(result: ReturnType<typeof runMilestoneBot>): readonly string[] {
  return result.artifact.log.entries.flatMap((entry) =>
    entry.operation.kind === "enqueue" ? [entry.operation.command.kind] : [],
  );
}

function reportSummary(
  result: ReturnType<typeof runMilestoneBot> & { readonly wallClockMs: number },
) {
  const report = result.report;
  return {
    policyId: report.policyId,
    status: report.status,
    finalTick: report.finalTick,
    simulatedMinutes: report.finalSimulatedSeconds / 60,
    replayVerification: report.replayVerification,
    milestones: report.milestones,
    blockers: report.blockers,
    productiveWait: report.productiveWait,
    forcedDeadtime: report.forcedDeadtime,
    completedTaskIds: report.completedTaskIds,
    completedResearchIds: report.completedResearchIds,
    passedBenchmarkIds: report.passedBenchmarkIds,
    savedBlueprintIds: report.savedBlueprintIds,
    finalCashUsd: report.finalCashUsd,
    totalIncomeUsd: report.totalIncomeUsd,
    totalExpenseUsd: report.totalExpenseUsd,
    moduleShutdownTransitionCount: report.moduleShutdownTransitionCount,
    maximumTemperatureC: report.maximumTemperatureC,
    minimumStabilityFactor: report.minimumStabilityFactor,
    commandSummary: report.commandSummary,
    replayEntryCount: report.replayEntryCount,
    replayTickCount: report.replayTickCount,
    initialRngState: report.initialRngState,
    finalRngState: report.finalRngState,
    finalStateHash: report.finalStateHash,
    replayHash: report.replayHash,
    reportHash: report.reportHash,
    wallClockMs: result.wallClockMs,
    forbiddenCommandPresent: commandKinds(result).some(
      (kind) => kind === "DEBUG_ADD_CASH" || kind === "DEBUG_ADD_RESEARCH_DATA",
    ),
  };
}

function main(): void {
  assertValidBotRunConfiguration(configuration);
  const templateIssues = validateAllBuildTemplates(content);
  if (templateIssues.length > 0)
    throw new Error(`Template validation failed: ${JSON.stringify(templateIssues)}`);

  const initial = createInitialGameState({ content, seed });
  const graph = createMilestonePolicyResearchGraph(content);
  const auditedProductionCores = Array.from({ length: 200 }, (_, index) =>
    createAuditedProductionCore(index),
  );
  const auditedRecordingRecorders = Array.from({ length: 200 }, (_, index) => {
    const recorder = createReplayRecorder({
      content,
      initialState: createAuditedProductionState(index),
    });
    recorder.perform({ kind: "step", ticks: 1 });
    recorder.perform({ kind: "step", ticks: 1 });
    return recorder;
  });
  const auditedPlaybackFixtures = Array.from({ length: 200 }, (_, index) => {
    const fixture = createAuditedRecordingFixture(index);
    const core = createProductionSimCore({ content, initialState: fixture.artifact.initialState });
    const parsedLog = parseReplayLog(fixture.artifact.log);
    const first = parsedLog.entries[0];
    const second = parsedLog.entries[1];
    const third = parsedLog.entries[2];
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("Audited playback fixture is incomplete.");
    executeReplayEntry(core, first);
    executeReplayEntry(core, second);
    executeReplayEntry(core, third);
    return { core, entry: fixture.entry };
  });
  const measurements = {
    campaignWarmNoChange: measure(
      () => calculateCampaignYearForCompletedTick(1946, 1, content),
      1_000,
    ),
    campaignTransition: measure(
      () => calculateCampaignYearForCompletedTick(1946, 12_000, content),
      200,
    ),
    policyDecision: measure(
      () =>
        selectBaselineDecision({
          state: initial,
          content,
          graph,
          policy: policyParametersFor("baseline-balanced"),
          runtime: {
            appliedTemplateIds: [],
            moduleMapping: {},
            blueprintSelectionModuleIds: [],
            lastAcceptedAction: null,
          },
        }),
      1_000,
    ),
    milestoneObservation: measure(
      () =>
        observeMilestones({
          content,
          state: initial,
          previousState: null,
          decisionIntervalTicks: 10,
        }),
      1_000,
    ),
    blockerEvaluation: measure(
      () => updateBlockingTracker(initialBlockingTracker, initial, 100, content),
      1_000,
    ),
    templateValidation: measure(() => validateAllBuildTemplates(content), 1_000),
    starterTemplateExecution: measure(() => {
      const driver = createReplayCommandDriver({ content, seed });
      driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
      createTemplateExecutor({ content, driver }).applyTemplate("starter-serial");
    }, 50),
    productionTick: (() => {
      let index = 0;
      for (const core of auditedProductionCores) core.step(2);
      return measure(
        () => {
          const core = auditedProductionCores[index % auditedProductionCores.length];
          if (core === undefined) throw new Error("Audited production fixture is empty.");
          core.step(1);
          index += 1;
        },
        200,
        0,
      );
    })(),
    replayRecordingTick: (() => {
      let index = 0;
      return measure(
        () => {
          const recorder = auditedRecordingRecorders[index % auditedRecordingRecorders.length];
          if (recorder === undefined) throw new Error("Audited recording fixture is empty.");
          recorder.perform({ kind: "step", ticks: 1 });
          index += 1;
        },
        200,
        0,
      );
    })(),
    replayPlaybackTick: (() => {
      let index = 0;
      return measure(
        () => {
          const fixture = auditedPlaybackFixtures[index % auditedPlaybackFixtures.length];
          if (fixture === undefined) throw new Error("Audited playback fixture is empty.");
          executeReplayEntry(fixture.core, fixture.entry);
          index += 1;
        },
        200,
        0,
      );
    })(),
  };

  const results = policies.map(runPolicy);
  const duplicateBaseline = runPolicy("baseline-balanced");
  const comparison = createMilestoneBotComparisonReport(
    results.map((result) => result.report),
    content,
    seed,
  );
  const reports = results.map(reportSummary);
  const failures: string[] = [];
  for (const result of results) {
    if (result.report.replayVerification !== "matched")
      failures.push(
        `${result.report.policyId}: replay verification ${result.report.replayVerification}`,
      );
    try {
      validateMilestoneBotReport(result.report);
    } catch {
      failures.push(`${result.report.policyId}: report hash or structure mismatch`);
    }
    if (reportSummary(result).forbiddenCommandPresent)
      failures.push(`${result.report.policyId}: forbidden debug grant command present`);
  }
  if (results[0]?.report.status !== "completed")
    failures.push(`baseline status is ${results[0]?.report.status ?? "missing"}`);
  const baseline = results[0]?.report;
  if (baseline !== undefined) {
    const milestone = (id: string) => baseline.milestones.find((entry) => entry.id === id);
    const observedInside = (id: string, minimumTick: number, maximumTick: number): boolean => {
      const occurrence = milestone(id)?.occurrence;
      if (occurrence?.kind === "exact") {
        return occurrence.tick >= minimumTick && occurrence.tick <= maximumTick;
      }
      if (occurrence?.kind === "observed-between") {
        return occurrence.afterTick >= minimumTick && occurrence.atOrBeforeTick <= maximumTick;
      }
      return false;
    };
    const exactAt = (id: string, tick: number): boolean => {
      const occurrence = milestone(id)?.occurrence;
      return occurrence?.kind === "exact" && occurrence.tick === tick;
    };
    if (!observedInside("first-task-completed", 1_200, 1_800))
      failures.push("baseline first Task completion is outside 1,200..1,800 ticks");
    if (!observedInside("first-blocking-bottleneck", 2_400, 3_600))
      failures.push("baseline first blocking bottleneck is outside 2,400..3,600 ticks");
    if (!observedInside("first-blueprint-saved", 6_000, 9_000))
      failures.push("baseline first Blueprint is outside 6,000..9,000 ticks");
    if (!observedInside("vertical-slice-completed", 27_000, 45_000))
      failures.push("baseline completion is outside 27,000..45,000 ticks");
    if (milestone("transistor-revealed")?.status !== "observed")
      failures.push("baseline did not reveal the transistor");
    if (!exactAt("year-1947", 12_000))
      failures.push("baseline 1947 transition is not exact at tick 12,000");
    if (!exactAt("year-1948", 24_000))
      failures.push("baseline 1948 transition is not exact at tick 24,000");
    for (const benchmarkId of ["benchmark-sustained-stability", "benchmark-peak-throughput"]) {
      if (!baseline.passedBenchmarkIds.includes(benchmarkId))
        failures.push(`baseline did not pass ${benchmarkId}`);
    }
    if (baseline.savedBlueprintIds.length === 0) failures.push("baseline did not save a Blueprint");
    if (baseline.forcedDeadtime.maximumContiguousTicks > 3_000)
      failures.push("baseline maximum forced deadtime exceeds 3,000 ticks");
    if (baseline.initialRngState !== baseline.finalRngState) failures.push("baseline consumed RNG");
  }
  if (duplicateBaseline.report.reportHash !== results[0]?.report.reportHash)
    failures.push("baseline duplicate report hash mismatch");
  if (duplicateBaseline.report.replayHash !== results[0]?.report.replayHash)
    failures.push("baseline duplicate replay hash mismatch");
  if (duplicateBaseline.report.finalStateHash !== results[0]?.report.finalStateHash)
    failures.push("baseline duplicate final state hash mismatch");

  const host = {
    cpu: cpus()[0]?.model ?? "unknown",
    os: `${platform()} ${release()}`,
    node: process.version,
    buildMode: process.env["NODE_ENV"] ?? "development",
    warmups: 100,
  };
  const targetHost = host.cpu.toLowerCase().includes("i7-2600");
  if (targetHost) {
    if (measurements.campaignWarmNoChange.p95Ms >= 0.02)
      failures.push("campaign warm no-change p95 gate failed");
    if (measurements.policyDecision.p95Ms >= 0.5)
      failures.push("pure bot decision p95 gate failed");
    if (measurements.productionTick.p95Ms >= 4) failures.push("production tick p95 gate failed");
    if (measurements.replayRecordingTick.p95Ms >= 5)
      failures.push("Replay recording production tick p95 gate failed");
    if (measurements.replayPlaybackTick.p95Ms >= 5)
      failures.push("Replay playback p95 gate failed");
  }

  console.log(
    JSON.stringify(
      {
        seed,
        contentHash: hashSimulationContent(content),
        configuration,
        host: { ...host, targetHost },
        measurements,
        policies: reports,
        comparison,
        duplicateBaseline: reportSummary(duplicateBaseline),
        initialStateHash: hashCanonicalState(initial),
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exitCode = 1;
}

main();
