import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { microdollarsToUsd } from "../../src/sim/economy/money.ts";
import type {
  ActiveBenchmarkState,
  BenchmarkDefinitionId,
  BenchmarkResult,
  GameState,
  ModuleComputeResultState,
  ModuleInstanceState,
} from "../../src/sim/core/types.ts";
import {
  advanceBenchmarkRun,
  calculateBenchmarkTickSample,
  compareBenchmarkResults,
  selectBestBenchmarkRun,
  validateFreshBenchmarkAdvance,
} from "../../src/sim/benchmarks/benchmarkDomain.ts";

const MODULE_ONE = "module-instance-00000001";
const MODULE_TWO = "module-instance-00000002";

function peakId(): BenchmarkDefinitionId {
  return "benchmark-peak-throughput";
}

function sustainedId(): BenchmarkDefinitionId {
  return "benchmark-sustained-stability";
}

function moduleState(id: string): ModuleInstanceState {
  return {
    id,
    definitionId: "module-vacuum-tube-logic",
    position: { x: id === MODULE_ONE ? 0 : 3, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function computeResult(
  id: string,
  overrides: Partial<ModuleComputeResultState> = {},
): ModuleComputeResultState {
  const base: ModuleComputeResultState = {
    moduleInstanceId: id,
    requestedFrequencyRatio: 1,
    operationalRatio: 1,
    theoreticalComputeFlops: id === MODULE_ONE ? 100 : 200,
    powerFactor: id === MODULE_ONE ? 0.5 : 0.75,
    thermalFactor: id === MODULE_ONE ? 0.8 : 0.5,
    retryRate: id === MODULE_ONE ? 0.25 : 0.05,
    invalidSampleRate: id === MODULE_ONE ? 0.1 : 0.2,
    stabilityFactor: id === MODULE_ONE ? 0.65 : 0.75,
    availableComputeFlops: id === MODULE_ONE ? 20 : 60,
  };
  return { ...base, ...overrides };
}

function createActive(benchmarkId = peakId()): ActiveBenchmarkState {
  return {
    runId: "benchmark-run-00000001",
    benchmarkId,
    startedAtTick: 7,
    elapsedTicks: 0,
    clusterModuleIds: [MODULE_ONE, MODULE_TWO],
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
    overclockSummary: {
      [MODULE_ONE]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      [MODULE_TWO]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    },
  };
}

function createBenchmarkState(benchmarkId = peakId()): {
  state: GameState;
  active: ActiveBenchmarkState;
} {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "benchmark-domain" });
  state.facility.modules = {
    [MODULE_ONE]: moduleState(MODULE_ONE),
    [MODULE_TWO]: moduleState(MODULE_TWO),
  };
  state.facility.nextModuleInstanceSequence = 3;
  state.facility.compute = {
    layoutRevision: 0,
    thermalRevision: 0,
    byModule: {
      [MODULE_TWO]: computeResult(MODULE_TWO),
      [MODULE_ONE]: computeResult(MODULE_ONE),
    },
    byTask: {},
    research: null,
    totalTheoreticalComputeFlops: 300,
    totalAvailableComputeFlops: 80,
    totalAllocatedUsefulComputeFlops: 0,
  };
  state.facility.power = {
    layoutRevision: 0,
    totalRequestedPowerWatts: 160,
    totalDeliveredPowerWatts: 130,
    headroomWatts: 42,
    energyCostUsdThisTick: 0.000001,
    byModule: {},
    byRoute: {},
  };
  state.facility.thermalTiles = [
    { position: { x: 0, y: 0 }, temperatureC: -8 },
    { position: { x: 1, y: 0 }, temperatureC: -2 },
    { position: { x: 2, y: 0 }, temperatureC: -6 },
  ];
  state.research.statuses["research-high-frequency-clock"] = "completed";
  const active = createActive(benchmarkId);
  state.benchmarks.active = active;
  state.benchmarks.nextBenchmarkRunSequence = 2;
  return { state, active };
}

function peakDefinition() {
  const definition = loadContentBundle().era.benchmarkDefinitions.find(({ id }) => id === peakId());
  if (definition === undefined) throw new Error("Missing peak benchmark definition.");
  return definition;
}

function sustainedDefinition() {
  const definition = loadContentBundle().era.benchmarkDefinitions.find(
    ({ id }) => id === sustainedId(),
  );
  if (definition === undefined) throw new Error("Missing sustained benchmark definition.");
  return definition;
}

function resultFor(
  benchmarkId: BenchmarkDefinitionId,
  overrides: Partial<BenchmarkResult> = {},
): BenchmarkResult {
  const result: BenchmarkResult = {
    runId: "benchmark-run-00000001",
    benchmarkId,
    clusterModuleIds: [MODULE_ONE, MODULE_TWO],
    passed: true,
    startedAtTick: 7,
    durationTicks: benchmarkId === peakId() ? 150 : 1_200,
    averageUsefulComputeFlops: benchmarkId === peakId() ? 12_500 : 9_000,
    peakUsefulComputeFlops: benchmarkId === peakId() ? 13_000 : 9_500,
    peakPowerWatts: 130,
    averagePowerWatts: 100,
    maxTemperatureC: benchmarkId === peakId() ? 86 : 74,
    minimumPowerHeadroomWatts: 42,
    retryRate: benchmarkId === peakId() ? 0.1 : 0.03,
    validSampleRate: benchmarkId === peakId() ? 0.9 : 0.98,
    costUsd: 0.000001,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {
      [MODULE_ONE]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      [MODULE_TWO]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    },
  };
  return { ...result, ...overrides };
}

describe("pure Benchmark tick sampling", () => {
  test("uses selected-module available Compute and weighted stability in supplied order", () => {
    const { state, active } = createBenchmarkState();

    const sample = calculateBenchmarkTickSample(active, state);

    expect(sample.totalWeight).toBe(115);
    expect(sample.sampleUsefulComputeFlops).toBe(80);
    expect(sample.sampleRetryRate).toBe((40 * 0.25 + 75 * 0.05) / 115);
    expect(sample.sampleInvalidRate).toBe((40 * 0.1 + 75 * 0.2) / 115);
    expect(sample.sampleValidRate).toBe(1 - (40 * 0.1 + 75 * 0.2) / 115);
  });

  test("samples only a single selected module without resorting or using unselected results", () => {
    const { state, active } = createBenchmarkState();
    active.clusterModuleIds = [MODULE_ONE];
    active.overclockSummary = {
      [MODULE_ONE]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    };
    state.facility.compute.byModule[MODULE_ONE] = computeResult(MODULE_ONE, {
      availableComputeFlops: 7,
    });

    const sample = calculateBenchmarkTickSample(active, state);

    expect(sample.sampleUsefulComputeFlops).toBe(7);
    expect(sample.sampleRetryRate).toBe(0.25);
    expect(sample.sampleValidRate).toBe(0.9);
  });

  test("uses facility-wide telemetry, supports negative temperatures and latches shutdown", () => {
    const { state, active } = createBenchmarkState();
    state.facility.modules[MODULE_TWO] = {
      ...moduleState(MODULE_TWO),
      operationalState: "shutdown",
    };

    const sample = calculateBenchmarkTickSample(active, state);

    expect(sample.totalDeliveredPowerWatts).toBe(130);
    expect(sample.headroomWatts).toBe(42);
    expect(sample.energyCostUsdThisTick).toBe(0.000001);
    expect(sample.maxTemperatureC).toBe(-2);
    expect(sample.shutdownObserved).toBe(true);
  });

  test("returns exactly zero retry and valid rates when total weight is zero", () => {
    const { state, active } = createBenchmarkState();
    state.facility.compute.byModule[MODULE_ONE] = computeResult(MODULE_ONE, {
      theoreticalComputeFlops: 0,
      powerFactor: 0,
      thermalFactor: 0,
      availableComputeFlops: 0,
    });
    state.facility.compute.byModule[MODULE_TWO] = computeResult(MODULE_TWO, {
      theoreticalComputeFlops: 0,
      powerFactor: 0,
      thermalFactor: 0,
      availableComputeFlops: 0,
    });

    const sample = calculateBenchmarkTickSample(active, state);

    expect(sample.totalWeight).toBe(0);
    expect(sample.sampleRetryRate).toBe(0);
    expect(sample.sampleValidRate).toBe(0);
  });

  test.each([
    ["NaN", { availableComputeFlops: Number.NaN }],
    ["Infinity", { theoreticalComputeFlops: Number.POSITIVE_INFINITY }],
    ["negative zero", { retryRate: -0 }],
  ])("rejects %s Compute inputs", (_name, overrides) => {
    const { state, active } = createBenchmarkState();
    state.facility.compute.byModule[MODULE_ONE] = computeResult(MODULE_ONE, overrides);

    expect(() => calculateBenchmarkTickSample(active, state)).toThrow();
  });

  test("does not mutate state or reorder the active cluster", () => {
    const { state, active } = createBenchmarkState();
    const before = structuredClone(state);

    calculateBenchmarkTickSample(active, state);

    expect(active.clusterModuleIds).toEqual([MODULE_ONE, MODULE_TWO]);
    expect(state).toEqual(before);
  });
});

describe("pure Benchmark advancement and completion", () => {
  test("takes the first sample in the start tick and does not complete early", () => {
    const { state, active } = createBenchmarkState();

    const calculation = advanceBenchmarkRun(active, state, loadContentBundle());

    expect(calculation.result.benchmarks.active?.elapsedTicks).toBe(1);
    expect(calculation.result.benchmarks.history).toHaveLength(0);
    expect(calculation.result.completedResult).toBeNull();
  });

  test("completes Peak at exactly 150 samples and appends one immutable result", () => {
    const { state, active } = createBenchmarkState();
    active.elapsedTicks = 149;
    active.accumulatedUsefulComputeFlops = 149 * 12_500;
    active.peakUsefulComputeFlops = 12_500;
    active.accumulatedPowerWatts = 149 * 100;
    active.peakPowerWatts = 100;
    active.maxTemperatureC = 86;
    active.minimumPowerHeadroomWatts = 42;
    active.accumulatedValidSampleRate = 149;
    active.accumulatedCostUsd = 0.000149;

    const calculation = advanceBenchmarkRun(active, state, loadContentBundle());
    const result = calculation.result.completedResult;

    expect(result?.durationTicks).toBe(150);
    expect(result?.averageUsefulComputeFlops).toBe((149 * 12_500 + 80) / 150);
    expect(calculation.result.benchmarks.active).toBeNull();
    expect(calculation.result.benchmarks.history).toHaveLength(1);
    expect(calculation.result.benchmarks.bestRunByBenchmark[peakId()]).toBeUndefined();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(calculation.result.benchmarks)).toBe(true);
  });

  test("completes Sustained at exactly 1,200 samples and rejects late advancement", () => {
    const { state, active } = createBenchmarkState(sustainedId());
    active.elapsedTicks = 1_199;
    active.accumulatedUsefulComputeFlops = 1_199 * 9_000;
    active.peakUsefulComputeFlops = 9_000;
    active.accumulatedPowerWatts = 1_199 * 100;
    active.peakPowerWatts = 100;
    active.maxTemperatureC = 74;
    active.minimumPowerHeadroomWatts = 42;
    active.accumulatedValidSampleRate = 1_199;
    active.accumulatedCostUsd = 0.001199;

    const calculation = advanceBenchmarkRun(active, state, loadContentBundle());

    expect(calculation.result.completedResult?.durationTicks).toBe(1_200);
    expect(calculation.result.completedResult?.validSampleRate).toBe(
      (1_199 + (1 - (40 * 0.1 + 75 * 0.2) / 115)) / 1_200,
    );

    active.elapsedTicks = 1_200;
    expect(() => advanceBenchmarkRun(active, state, loadContentBundle())).toThrow();
  });

  test("appends a passing result and updates bestRunByBenchmark", () => {
    const { state, active } = createBenchmarkState();
    state.facility.compute.byModule[MODULE_ONE] = computeResult(MODULE_ONE, {
      theoreticalComputeFlops: 12_500,
      powerFactor: 1,
      thermalFactor: 1,
      retryRate: 0,
      invalidSampleRate: 0,
      stabilityFactor: 1,
      availableComputeFlops: 12_500,
    });
    state.facility.compute.byModule[MODULE_TWO] = computeResult(MODULE_TWO, {
      theoreticalComputeFlops: 0,
      powerFactor: 0,
      thermalFactor: 0,
      retryRate: 0,
      invalidSampleRate: 0,
      stabilityFactor: 1,
      availableComputeFlops: 0,
    });
    active.elapsedTicks = 149;
    active.accumulatedUsefulComputeFlops = 149 * 12_500;
    active.peakUsefulComputeFlops = 12_500;
    active.accumulatedPowerWatts = 149 * 100;
    active.peakPowerWatts = 100;
    active.maxTemperatureC = -2;
    active.minimumPowerHeadroomWatts = 42;
    active.accumulatedValidSampleRate = 149;
    active.accumulatedCostUsd = 0.000149;

    const calculation = advanceBenchmarkRun(active, state, loadContentBundle());

    expect(calculation.result.completedResult?.passed).toBe(true);
    expect(calculation.result.benchmarks.bestRunByBenchmark[peakId()]).toBe(active.runId);
    expect(calculation.result.benchmarks.history[0]?.passed).toBe(true);
  });

  test("accumulates cost through microdollar helpers without mutating the input", () => {
    const { state, active } = createBenchmarkState();
    active.accumulatedCostUsd = 0.000001;
    const before = structuredClone(active);

    const calculation = advanceBenchmarkRun(active, state, loadContentBundle());

    expect(calculation.result.benchmarks.active?.accumulatedCostUsd).toBe(0.000002);
    expect(active).toEqual(before);
  });

  test("rejects microdollar accumulation overflow", () => {
    const { state, active } = createBenchmarkState();
    active.accumulatedCostUsd = microdollarsToUsd(Number.MAX_SAFE_INTEGER);

    expect(() => advanceBenchmarkRun(active, state, loadContentBundle())).toThrow();
  });

  test("validates same-generation inputs and isolates the private witness", () => {
    const { state, active } = createBenchmarkState();
    const content = loadContentBundle();
    const calculation = advanceBenchmarkRun(active, state, content);

    expect(
      validateFreshBenchmarkAdvance(state, content, calculation.result, calculation.witness),
    ).toEqual([]);
    expect(Object.isFrozen(calculation.witness)).toBe(true);
    expect(Object.isFrozen(calculation.witness.expected)).toBe(true);
    expect(JSON.stringify(calculation.result)).not.toContain("witness");
    expect(JSON.parse(JSON.stringify(calculation.result))).toEqual(calculation.result);

    const changedState = structuredClone(state);
    changedState.facility.compute = structuredClone(state.facility.compute);
    expect(
      validateFreshBenchmarkAdvance(changedState, content, calculation.result, calculation.witness),
    ).not.toEqual([]);

    active.elapsedTicks = 1;
    expect(
      validateFreshBenchmarkAdvance(state, content, calculation.result, calculation.witness),
    ).not.toEqual([]);

    const contradictory = {
      ...calculation.result,
      benchmarks: { ...calculation.result.benchmarks, active: null },
    };
    expect(
      validateFreshBenchmarkAdvance(state, content, contradictory, calculation.witness),
    ).not.toEqual([]);
  });
});

describe("Benchmark pass/fail comparison", () => {
  test("uses inclusive equality for every Peak threshold", () => {
    const result = resultFor(peakId());

    expect(compareBenchmarkResults(result, peakDefinition())).toEqual({
      passed: true,
      failureReasons: [],
    });
  });

  test("uses inclusive equality for every Sustained threshold", () => {
    const result = resultFor(sustainedId());

    expect(compareBenchmarkResults(result, sustainedDefinition())).toEqual({
      passed: true,
      failureReasons: [],
    });
  });

  test.each([
    ["average-compute", { averageUsefulComputeFlops: 12_499 }],
    ["valid-sample-rate", { validSampleRate: 0.899 }],
    ["retry-rate", { retryRate: 0.101 }],
    ["maximum-temperature", { maxTemperatureC: 86.001 }],
    ["shutdown", { shutdownObserved: true }],
  ])("records individual %s failures", (reason, overrides) => {
    const result = resultFor(peakId(), overrides);

    expect(compareBenchmarkResults(result, peakDefinition())).toEqual({
      passed: false,
      failureReasons: [reason],
    });
  });

  test("records multiple failures in the fixed contract order", () => {
    const result = resultFor(peakId(), {
      averageUsefulComputeFlops: 1,
      validSampleRate: 0,
      retryRate: 1,
      maxTemperatureC: 100,
      shutdownObserved: true,
    });

    expect(compareBenchmarkResults(result, peakDefinition())).toEqual({
      passed: false,
      failureReasons: [
        "average-compute",
        "valid-sample-rate",
        "retry-rate",
        "maximum-temperature",
        "shutdown",
      ],
    });
  });

  test("permits shutdown only for definitions that explicitly allow it", () => {
    const definition = { ...peakDefinition(), allowShutdowns: true };
    const result = resultFor(peakId(), { shutdownObserved: true });

    expect(compareBenchmarkResults(result, definition)).toEqual({
      passed: true,
      failureReasons: [],
    });
  });

  test.each([
    ["NaN", { averageUsefulComputeFlops: Number.NaN }],
    ["Infinity", { maxTemperatureC: Number.POSITIVE_INFINITY }],
    ["negative zero", { costUsd: -0 }],
  ])("rejects %s result metrics", (_name, overrides) => {
    expect(() =>
      compareBenchmarkResults(resultFor(peakId(), overrides), peakDefinition()),
    ).toThrow();
  });
});

describe("Benchmark best-run selection", () => {
  test.each([
    ["Peak average Compute", peakId(), "averageUsefulComputeFlops", true],
    ["Peak peak Compute", peakId(), "peakUsefulComputeFlops", true],
    ["Peak valid rate", peakId(), "validSampleRate", true],
    ["Peak retry rate", peakId(), "retryRate", false],
    ["Peak average Power", peakId(), "averagePowerWatts", false],
    ["Peak headroom", peakId(), "minimumPowerHeadroomWatts", true],
    ["Peak temperature", peakId(), "maxTemperatureC", false],
    ["Peak cost", peakId(), "costUsd", false],
    ["Sustained average Compute", sustainedId(), "averageUsefulComputeFlops", true],
    ["Sustained retry rate", sustainedId(), "retryRate", false],
    ["Sustained valid rate", sustainedId(), "validSampleRate", true],
    ["Sustained average Power", sustainedId(), "averagePowerWatts", false],
    ["Sustained headroom", sustainedId(), "minimumPowerHeadroomWatts", true],
    ["Sustained temperature", sustainedId(), "maxTemperatureC", false],
    ["Sustained cost", sustainedId(), "costUsd", false],
    ["Sustained peak Compute", sustainedId(), "peakUsefulComputeFlops", true],
  ])("uses the %s comparator key", (_name, benchmarkId, field, higherIsBetter) => {
    const definition = benchmarkId === peakId() ? peakDefinition() : sustainedDefinition();
    const metric = field as keyof BenchmarkResult;
    const baseline =
      metric === "costUsd"
        ? 0.00001
        : metric === "validSampleRate"
          ? benchmarkId === peakId()
            ? 0.9
            : 0.98
          : metric === "retryRate"
            ? benchmarkId === peakId()
              ? 0.1
              : 0.03
            : (resultFor(benchmarkId)[metric] as number);
    const delta =
      metric === "costUsd" || metric === "validSampleRate" || metric === "retryRate" ? 0.000001 : 1;
    const earlier = resultFor(benchmarkId, {
      runId: "benchmark-run-00000001",
      [metric]: baseline,
    });
    const later = resultFor(benchmarkId, {
      runId: "benchmark-run-00000002",
      [metric]: higherIsBetter ? baseline + delta : baseline - delta,
    });

    expect(compareBenchmarkResults(later, earlier, definition)).toBeGreaterThan(0);
    expect(selectBestBenchmarkRun([earlier, later], definition)?.runId).toBe(later.runId);
  });

  test("retains the earlier run on an exact tie and ignores failed runs", () => {
    const definition = peakDefinition();
    const earlier = resultFor(peakId(), { runId: "benchmark-run-00000001" });
    const later = resultFor(peakId(), { runId: "benchmark-run-00000002" });
    const failed = resultFor(peakId(), {
      runId: "benchmark-run-00000003",
      passed: false,
      failureReasons: ["average-compute"],
      averageUsefulComputeFlops: 99_999,
      peakUsefulComputeFlops: 100_000,
    });

    expect(selectBestBenchmarkRun([earlier, later, failed], definition)?.runId).toBe(earlier.runId);
  });

  test("does not select a passed result for another benchmark", () => {
    const result = resultFor(sustainedId());

    expect(selectBestBenchmarkRun([result], peakDefinition())).toBeUndefined();
  });
});
