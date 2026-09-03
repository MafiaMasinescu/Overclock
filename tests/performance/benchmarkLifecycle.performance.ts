import { cpus, release } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createBenchmarkCommandHandlers } from "../../src/sim/benchmarks/benchmarkCommands.ts";
import {
  advanceBenchmarkRun,
  calculateBenchmarkTickSample,
  clearBenchmarkAdvanceEvidence,
  validateFreshBenchmarkAdvance,
} from "../../src/sim/benchmarks/benchmarkDomain.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { BenchmarkResult, GameState, OverclockSettings } from "../../src/sim/core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistration,
  TickSystemRegistry,
} from "../../src/sim/core/tickSystems.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createResearchTickSystems } from "../../src/sim/research/facilityResearch.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import { microdollarsToUsd, usdToMicrodollars } from "../../src/sim/economy/money.ts";
import {
  assertValidActiveBenchmarkState,
  assertValidContentAwareActiveBenchmarkState,
} from "../../src/sim/benchmarks/benchmarkState.ts";
import { assertValidStoredResearchState } from "../../src/sim/research/researchState.ts";
import { assertValidStoredTaskState } from "../../src/sim/tasks/taskState.ts";
import { createTask9PerformanceFixture } from "./thermalFixture.ts";
import {
  createTaskBenchmarkTickSystems,
  createTaskTickSystems,
} from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";

const content = loadContentBundle();
const WARMUPS = 100;
const PURE_SAMPLES = 1_000;
const PRODUCTION_SAMPLES = 200;
const TRANSITION_SAMPLES = 200;
const COMPLETION_SAMPLES = 200;
const HISTORY_SIZE_PER_BENCHMARK = 50;
const PEAK_ID = "benchmark-peak-throughput";
const SUSTAINED_ID = "benchmark-sustained-stability";

interface Summary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly sampleCount: number;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): Summary {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    sampleCount: samples.length,
  };
}

function format(summary: Summary): string {
  return `median=${summary.medianMs.toFixed(4)} ms, p95=${summary.p95Ms.toFixed(4)} ms, max=${summary.maximumMs.toFixed(4)} ms, samples=${summary.sampleCount}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalizeModuleIds(state: GameState): void {
  const sourceIds = Object.keys(state.facility.modules).toSorted();
  const ids = Object.fromEntries(
    sourceIds.map((sourceId, index) => [
      sourceId,
      `module-instance-${String(index + 1).padStart(8, "0")}`,
    ]),
  );
  const moduleId = (sourceId: string): string => ids[sourceId] ?? sourceId;
  state.facility.modules = Object.fromEntries(
    Object.entries(state.facility.modules).map(([sourceId, module]) => [
      moduleId(sourceId),
      { ...module, id: moduleId(sourceId) },
    ]),
  );
  state.facility.routes = Object.fromEntries(
    Object.entries(state.facility.routes).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        from: { ...route.from, moduleInstanceId: moduleId(route.from.moduleInstanceId) },
        to: { ...route.to, moduleInstanceId: moduleId(route.to.moduleInstanceId) },
      },
    ]),
  );
  state.facility.power.byModule = Object.fromEntries(
    Object.entries(state.facility.power.byModule).map(([sourceId, delivery]) => [
      moduleId(sourceId),
      { ...delivery, moduleInstanceId: moduleId(delivery.moduleInstanceId) },
    ]),
  );
  state.facility.overclock.byModule = Object.fromEntries(
    Object.entries(state.facility.overclock.byModule).map(([sourceId, result]) => [
      moduleId(sourceId),
      { ...result, moduleInstanceId: moduleId(result.moduleInstanceId) },
    ]),
  );
  state.facility.compute.byModule = Object.fromEntries(
    Object.entries(state.facility.compute.byModule).map(([sourceId, result]) => [
      moduleId(sourceId),
      { ...result, moduleInstanceId: moduleId(result.moduleInstanceId) },
    ]),
  );
  state.facility.nextModuleInstanceSequence = sourceIds.length + 1;
}

function baseFixture(seed: string, benchmarkId?: string): GameState {
  const state = createTask9PerformanceFixture(seed);
  canonicalizeModuleIds(state);
  state.tasks.instances = {};
  state.tasks.offers = [];
  if (benchmarkId === PEAK_ID) {
    state.research.statuses["research-high-frequency-clock"] = "completed";
  }
  return state;
}

function fullSystems(includeBenchmark = true): TickSystemRegistry {
  return {
    ...createPowerTickSystems(content),
    ...createThermalTickSystems(content),
    ...createOverclockTickSystems(content),
    ...createComputeTickSystems(content),
    ...(includeBenchmark
      ? createTaskBenchmarkTickSystems(content)
      : createTaskTickSystems(content)),
    ...createResearchTickSystems(content),
  };
}

function preparedState(seed: string, benchmarkId?: string): GameState {
  const state = baseFixture(seed, benchmarkId);
  const core = new SimCore({ initialState: state, tickSystems: fullSystems() });
  core.step(5);
  return core.getStateForSave();
}

function selectedCluster(state: Readonly<GameState>): string[] {
  const cluster = Object.keys(state.facility.modules)
    .toSorted()
    .filter((moduleId) => {
      const module = state.facility.modules[moduleId];
      const definition = module === undefined ? undefined : content.modules[module.definitionId];
      return definition !== undefined && definition.baseComputeFlops > 0;
    });
  if (cluster.length === 0) throw new Error("Benchmark fixture has no compute-capable modules.");
  return cluster.slice(0, Math.min(cluster.length, 4));
}

function activeBenchmark(
  state: GameState,
  benchmarkId: string,
  elapsedTicks = 0,
  runId = "benchmark-run-00000001",
): NonNullable<GameState["benchmarks"]["active"]> {
  const clusterModuleIds = selectedCluster(state);
  const overclockSummary: Record<string, OverclockSettings> = {};
  for (const moduleId of clusterModuleIds) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) throw new Error(`Missing Benchmark fixture module ${moduleId}.`);
    overclockSummary[moduleId] = { ...module.overclock };
  }
  return {
    runId,
    benchmarkId,
    startedAtTick: state.tick,
    elapsedTicks,
    clusterModuleIds,
    accumulatedUsefulComputeFlops: 0,
    peakUsefulComputeFlops: 0,
    accumulatedPowerWatts: 0,
    peakPowerWatts: 0,
    maxTemperatureC: null,
    minimumPowerHeadroomWatts: null,
    accumulatedRetryRate: 0,
    accumulatedValidSampleRate: 0,
    accumulatedCostUsd: 0,
    shutdownObserved: false,
    overclockSummary,
  };
}

function activeState(seed: string, benchmarkId = SUSTAINED_ID): GameState {
  const state = preparedState(seed, benchmarkId);
  state.benchmarks.nextBenchmarkRunSequence = 2;
  state.benchmarks.active = activeBenchmark(state, benchmarkId);
  deepFreeze(state.facility);
  deepFreeze(state.benchmarks);
  return state;
}

function measure(operation: () => void, warmups: number, samples: number): Summary {
  for (let warmup = 0; warmup < warmups; warmup += 1) operation();
  const values: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const start = process.hrtime.bigint();
    operation();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function measurePureAdvance(): Summary {
  const state = activeState("benchmark-pure-advance");
  const active = state.benchmarks.active;
  if (active === null) throw new Error("Pure Benchmark fixture is inactive.");
  return measure(
    () => {
      const calculation = advanceBenchmarkRun(active, state, content);
      clearBenchmarkAdvanceEvidence(calculation.witness);
    },
    WARMUPS,
    PURE_SAMPLES,
  );
}

function measurePureSample(): Summary {
  const state = activeState("benchmark-pure-sample");
  const active = state.benchmarks.active;
  if (active === null) throw new Error("Pure Benchmark sample fixture is inactive.");
  return measure(
    () => {
      calculateBenchmarkTickSample(active, state);
    },
    WARMUPS,
    PURE_SAMPLES,
  );
}

function measureActiveValidation(): {
  readonly stored: Summary;
  readonly contentAware: Summary;
  readonly task: Summary;
  readonly research: Summary;
} {
  const state = activeState("benchmark-validation-cost");
  return {
    stored: measure(
      () => {
        assertValidActiveBenchmarkState(state);
      },
      WARMUPS,
      PURE_SAMPLES,
    ),
    contentAware: measure(
      () => {
        assertValidContentAwareActiveBenchmarkState(state, content);
      },
      WARMUPS,
      PURE_SAMPLES,
    ),
    task: measure(
      () => {
        assertValidStoredTaskState(state);
      },
      WARMUPS,
      PURE_SAMPLES,
    ),
    research: measure(
      () => {
        assertValidStoredResearchState(state);
      },
      WARMUPS,
      PURE_SAMPLES,
    ),
  };
}

function measureCombinedAdvance(): Summary {
  let state = activeState("benchmark-combined-advance");
  const registration = createTaskBenchmarkTickSystems(content)["advance-tasks-and-benchmarks"];
  if (registration === undefined || typeof registration === "function") {
    throw new Error("Benchmark combined diagnostic requires a structural stage registration.");
  }
  const runtime = registration.createRuntime();
  if (runtime.executionMode !== "structural-sharing") {
    throw new Error("Benchmark combined diagnostic requires structural sharing.");
  }
  const rng = createSeededRngFromState(state.rngState);
  const run = (): void => {
    const next = runtime.run({
      state,
      rng,
    });
    state = {
      ...next,
      tick: next.tick + 1,
      clock: { ...next.clock, simulatedSeconds: (next.tick + 1) / 10 },
    };
  };
  return measure(run, WARMUPS, PURE_SAMPLES);
}

function createProductionCore(seed: string, benchmarkId = SUSTAINED_ID): SimCore {
  return new SimCore({ initialState: activeState(seed, benchmarkId), tickSystems: fullSystems() });
}

function measureFullProduction(): Summary {
  const core = createProductionCore("benchmark-full-production");
  core.step(WARMUPS);
  const values: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function measureFullProductionWithoutBenchmark(): Summary {
  const core = new SimCore({
    initialState: preparedState("benchmark-full-production-baseline"),
    tickSystems: fullSystems(false),
  });
  core.step(WARMUPS);
  const values: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function timedStage(
  registration: TickSystemRegistration | undefined,
  timings: number[],
): TickSystemRegistration {
  if (registration === undefined || typeof registration === "function") {
    throw new Error("Benchmark production timing requires a structural stage factory.");
  }
  return {
    createRuntime() {
      const runtime = registration.createRuntime();
      if (runtime.executionMode !== "structural-sharing") {
        throw new Error("Benchmark production timing requires a structural stage runtime.");
      }
      return {
        ...runtime,
        run(context: StructuralSharingTickSystemContext): GameState {
          const start = process.hrtime.bigint();
          const result = runtime.run(context);
          timings.push(elapsedMs(start));
          return result;
        },
      };
    },
  };
}

function measureStageTimings(): {
  readonly benchmark: Summary;
  readonly research: Summary;
} {
  const benchmark: number[] = [];
  const research: number[] = [];
  const registry = fullSystems();
  const core = new SimCore({
    initialState: activeState("benchmark-stage-timings"),
    tickSystems: {
      ...registry,
      "advance-tasks-and-benchmarks": timedStage(
        registry["advance-tasks-and-benchmarks"],
        benchmark,
      ),
      "advance-research": timedStage(registry["advance-research"], research),
    },
  });
  core.step(WARMUPS);
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) core.step();
  return { benchmark: summarize(benchmark), research: summarize(research) };
}

function seededCompletionState(
  seed: string,
  benchmarkId: string,
  fail = false,
): { readonly state: GameState; readonly durationTicks: number } {
  const state = preparedState(seed, benchmarkId);
  const definition = content.era.benchmarkDefinitions.find(({ id }) => id === benchmarkId);
  if (definition === undefined)
    throw new Error(`Unknown Benchmark fixture definition ${benchmarkId}.`);
  const durationTicks = definition.durationSeconds * 10;
  const initial = activeBenchmark(state, benchmarkId);
  state.benchmarks.nextBenchmarkRunSequence = 2;
  state.benchmarks.active = initial;
  const sample = calculateBenchmarkTickSample(initial, state);
  const elapsedTicks = durationTicks - 1;
  state.benchmarks.active = {
    ...initial,
    elapsedTicks,
    accumulatedUsefulComputeFlops: fail ? 0 : sample.sampleUsefulComputeFlops * elapsedTicks,
    peakUsefulComputeFlops: fail ? 0 : sample.sampleUsefulComputeFlops,
    accumulatedPowerWatts: fail ? 0 : sample.totalDeliveredPowerWatts * elapsedTicks,
    peakPowerWatts: fail ? 0 : sample.totalDeliveredPowerWatts,
    maxTemperatureC: fail ? definition.maximumTemperatureC + 1 : sample.maxTemperatureC,
    minimumPowerHeadroomWatts: sample.headroomWatts,
    accumulatedRetryRate: fail ? elapsedTicks : sample.sampleRetryRate * elapsedTicks,
    accumulatedValidSampleRate: fail ? 0 : sample.sampleValidRate * elapsedTicks,
    accumulatedCostUsd: fail
      ? 0
      : microdollarsToUsd(usdToMicrodollars(sample.energyCostUsdThisTick) * elapsedTicks),
    shutdownObserved: fail,
  };
  return { state: deepFreeze(state), durationTicks };
}

function measureCompletion(seed: string, benchmarkId: string, fail = false): Summary {
  const { state, durationTicks } = seededCompletionState(seed, benchmarkId, fail);
  return measure(
    () => {
      const active = state.benchmarks.active;
      if (active === null) throw new Error("Completion fixture is inactive.");
      const calculation = advanceBenchmarkRun(active, state, content);
      if (calculation.result.completedResult === null) {
        throw new Error(`Benchmark did not complete at ${durationTicks} ticks.`);
      }
      if (
        validateFreshBenchmarkAdvance(state, content, calculation.result, calculation.witness)
          .length > 0
      ) {
        throw new Error("Benchmark completion witness validation failed.");
      }
      clearBenchmarkAdvanceEvidence(calculation.witness);
    },
    WARMUPS,
    COMPLETION_SAMPLES,
  );
}

function measureFreshWitness(): Summary {
  const state = activeState("benchmark-witness");
  const calculations = Array.from({ length: TRANSITION_SAMPLES }, () => {
    const active = state.benchmarks.active;
    if (active === null) throw new Error("Witness fixture is inactive.");
    return advanceBenchmarkRun(active, state, content);
  });
  for (const calculation of calculations) {
    if (
      validateFreshBenchmarkAdvance(state, content, calculation.result, calculation.witness)
        .length > 0
    ) {
      throw new Error("Benchmark witness warm-up validation failed.");
    }
  }
  const summary = measure(
    () => {
      const calculation = calculations[0];
      if (calculation === undefined) throw new Error("Benchmark witness fixture is empty.");
      if (
        validateFreshBenchmarkAdvance(state, content, calculation.result, calculation.witness)
          .length > 0
      ) {
        throw new Error("Benchmark witness validation failed.");
      }
    },
    WARMUPS,
    TRANSITION_SAMPLES,
  );
  for (const calculation of calculations) clearBenchmarkAdvanceEvidence(calculation.witness);
  return summary;
}

function commandId(prefix: string, index: number): string {
  return `12000000-0000-4000-8000-${prefix.charCodeAt(0).toString().padStart(4, "0")}${String(index).padStart(8, "0")}`;
}

function measureStartCommands(): Summary {
  const state = preparedState("benchmark-start-command", SUSTAINED_ID);
  state.benchmarks.nextBenchmarkRunSequence = 1;
  state.benchmarks.active = null;
  const cluster = selectedCluster(state);
  const run = (index: number, collect: boolean): number | undefined => {
    const core = new SimCore({
      initialState: state,
      commandHandlers: createBenchmarkCommandHandlers(content),
    });
    core.enqueue({
      commandId: commandId("s", index),
      source: "debug",
      kind: "START_BENCHMARK",
      benchmarkId: SUSTAINED_ID,
      clusterModuleIds: cluster,
    });
    const start = process.hrtime.bigint();
    const [result] = core.processPendingCommands();
    if (result?.accepted !== true) throw new Error("Benchmark START diagnostic was rejected.");
    return collect ? elapsedMs(start) : undefined;
  };
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) run(warmup, false);
  const samples: number[] = [];
  for (let sample = 0; sample < TRANSITION_SAMPLES; sample += 1) {
    const elapsed = run(WARMUPS + sample, true);
    if (elapsed === undefined) throw new Error("Benchmark START measurement omitted a sample.");
    samples.push(elapsed);
  }
  return summarize(samples);
}

function measureCancelCommands(): Summary {
  const state = activeState("benchmark-cancel-command");
  const run = (index: number, collect: boolean): number | undefined => {
    const core = new SimCore({
      initialState: state,
      commandHandlers: createBenchmarkCommandHandlers(content),
    });
    core.enqueue({
      commandId: commandId("c", index),
      source: "debug",
      kind: "CANCEL_BENCHMARK",
    });
    const start = process.hrtime.bigint();
    const [result] = core.processPendingCommands();
    if (result?.accepted !== true) throw new Error("Benchmark CANCEL diagnostic was rejected.");
    return collect ? elapsedMs(start) : undefined;
  };
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) run(warmup, false);
  const samples: number[] = [];
  for (let sample = 0; sample < TRANSITION_SAMPLES; sample += 1) {
    const elapsed = run(WARMUPS + sample, true);
    if (elapsed === undefined) throw new Error("Benchmark CANCEL measurement omitted a sample.");
    samples.push(elapsed);
  }
  return summarize(samples);
}

function benchmarkResult(runId: string, benchmarkId: string, index: number): BenchmarkResult {
  const clusterModuleIds = ["module-instance-00000008"];
  const [firstModuleId] = clusterModuleIds;
  if (firstModuleId === undefined) throw new Error("Benchmark history fixture requires a cluster.");
  return {
    runId,
    benchmarkId,
    clusterModuleIds,
    passed: true,
    startedAtTick: index,
    durationTicks: benchmarkId === PEAK_ID ? 150 : 1_200,
    averageUsefulComputeFlops: 20_000 + index,
    peakUsefulComputeFlops: 20_000 + index,
    peakPowerWatts: 10,
    averagePowerWatts: 10,
    maxTemperatureC: 20,
    minimumPowerHeadroomWatts: 50_000,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {
      [firstModuleId]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    },
  };
}

function historyState(seed: string): GameState {
  const state = preparedState(seed);
  const history: BenchmarkResult[] = [];
  let sequence = 1;
  for (const benchmarkId of [PEAK_ID, SUSTAINED_ID]) {
    for (let index = 0; index < HISTORY_SIZE_PER_BENCHMARK; index += 1) {
      history.push(
        benchmarkResult(`benchmark-run-${String(sequence).padStart(8, "0")}`, benchmarkId, index),
      );
      sequence += 1;
    }
  }
  state.benchmarks = {
    nextBenchmarkRunSequence: sequence,
    active: null,
    history,
    bestRunByBenchmark: {
      [PEAK_ID]: history[HISTORY_SIZE_PER_BENCHMARK - 1]?.runId ?? "",
      [SUSTAINED_ID]: history.at(-1)?.runId ?? "",
    },
  };
  return deepFreeze(state);
}

function measureColdConstruction(): Summary {
  const state = historyState("benchmark-cold-construction");
  return measure(
    () => {
      new SimCore({ initialState: state, tickSystems: fullSystems() });
    },
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function measureStateReplacement(): Summary {
  const state = historyState("benchmark-state-replacement");
  const core = new SimCore({ initialState: state, tickSystems: fullSystems() });
  return measure(
    () => {
      core.replaceState(state);
    },
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

const pureSample = measurePureSample();
const pureAdvance = measurePureAdvance();
const activeValidation = measureActiveValidation();
const combinedAdvance = measureCombinedAdvance();
const fullProduction = measureFullProduction();
const fullProductionWithoutBenchmark = measureFullProductionWithoutBenchmark();
const stageTimings = measureStageTimings();
const peakCompletion = measureCompletion("benchmark-peak-completion", PEAK_ID);
const sustainedCompletion = measureCompletion("benchmark-sustained-completion", SUSTAINED_ID);
const failedCompletion = measureCompletion("benchmark-failed-completion", SUSTAINED_ID, true);
const freshWitness = measureFreshWitness();
const startCommands = measureStartCommands();
const cancelCommands = measureCancelCommands();
const coldConstruction = measureColdConstruction();
const stateReplacement = measureStateReplacement();

console.log("Task 12.6 audited Benchmark diagnostic");
console.log(
  "fixture: audited dense 24 x 16 Task 7/8/9 production fixture, at least 75% occupied tiles, mixed footprints and rotations, real Power routes and shared contention, local airflow and extraction, nonuniform temperatures, Overclock stability, Useful Compute, Task and Research stages, plus valid Peak and Sustained Benchmark definitions.",
);
console.log(`pure Benchmark sample and active-run advancement: ${format(pureAdvance)}`);
console.log(`pure Benchmark sample only: ${format(pureSample)}`);
console.log(`active Benchmark stored validation only: ${format(activeValidation.stored)}`);
console.log(
  `active Benchmark content-aware validation only: ${format(activeValidation.contentAware)}`,
);
console.log(`stored Task validation only: ${format(activeValidation.task)}`);
console.log(`stored Research validation only: ${format(activeValidation.research)}`);
console.log(`combined Task plus Benchmark advancement: ${format(combinedAdvance)}`);
console.log(`complete production tick with active Benchmark: ${format(fullProduction)}`);
console.log(
  `complete production tick without active Benchmark (diagnostic baseline): ${format(fullProductionWithoutBenchmark)}`,
);
console.log(`combined stage internal timing: ${format(stageTimings.benchmark)}`);
console.log(`Research stage internal timing: ${format(stageTimings.research)}`);
console.log(`Peak completion path: ${format(peakCompletion)}`);
console.log(`Sustained completion path: ${format(sustainedCompletion)}`);
console.log(`failed multi-reason completion: ${format(failedCompletion)}`);
console.log(`exact fresh-witness validation: ${format(freshWitness)}`);
console.log(`START_BENCHMARK command path: ${format(startCommands)}`);
console.log(`CANCEL_BENCHMARK command path: ${format(cancelCommands)}`);
console.log(`cold construction with realistic history: ${format(coldConstruction)}`);
console.log(`state replacement with realistic history: ${format(stateReplacement)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT.`,
);
console.log(
  `warm-up: ${WARMUPS} unmeasured iterations per path; fixture creation and diagnostic setup are excluded; no timed sample is filtered. Command paths include enqueue/process but exclude core construction, as in the existing lifecycle diagnostics.`,
);
console.log(
  `hard i7-2600 gates: pure p95 < 0.10 ms=${pureAdvance.p95Ms < 0.1 ? "PASS" : "FAIL"}; combined p95 < 0.25 ms=${combinedAdvance.p95Ms < 0.25 ? "PASS" : "FAIL"}; complete production p95 < 4 ms=${fullProduction.p95Ms < 4 ? "PASS" : "FAIL"}.`,
);
if (pureAdvance.p95Ms >= 0.1 || combinedAdvance.p95Ms >= 0.25 || fullProduction.p95Ms >= 4) {
  throw new Error("Task 12.6 Benchmark hard performance gate failed.");
}
