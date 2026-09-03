import { describe, expect, test } from "vitest";

import {
  ContentValidationError,
  loadContentBundle,
  validateContent,
} from "../../src/content/loader/contentLoader.ts";
import {
  createRawContentPack,
  type RawContentPack,
} from "../../src/content/loader/rawContentPack.ts";
import type { BenchmarkResult, GameState } from "../../src/sim/core/types.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  assertValidContentAwareBenchmarkState,
  validateContentAwareBenchmarkState,
  validateStoredBenchmarkState,
} from "../../src/sim/benchmarks/benchmarkState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { parseSimCommand } from "../../src/sim/commands/commandSchema.ts";
import type { CommandRejectionCode } from "../../src/sim/commands/contracts.ts";

function clonePack(): RawContentPack {
  return structuredClone(createRawContentPack());
}

function benchmarkDefinitionAt(pack: RawContentPack, index: number) {
  const benchmark = pack.era.era.benchmarkDefinitions[index];
  if (benchmark === undefined) throw new Error(`Missing benchmark fixture at ${index}.`);
  return benchmark;
}

function activeBenchmarkAt(state: GameState) {
  const active = state.benchmarks.active;
  if (active === null) throw new Error("Expected an active benchmark fixture.");
  return active;
}

function expectContentRejected(mutate: (pack: RawContentPack) => void): ContentValidationError {
  const pack = clonePack();
  mutate(pack);
  expect(() => validateContent(pack)).toThrow(ContentValidationError);
  try {
    validateContent(pack);
  } catch (error: unknown) {
    return error as ContentValidationError;
  }
  throw new Error("Expected content validation to fail.");
}

function validResult(runId = "benchmark-run-00000001"): BenchmarkResult {
  return {
    runId,
    benchmarkId: "benchmark-peak-throughput",
    clusterModuleIds: ["module-instance-00000001"],
    passed: true,
    startedAtTick: 0,
    durationTicks: 150,
    averageUsefulComputeFlops: 12_500,
    peakUsefulComputeFlops: 12_500,
    peakPowerWatts: 100,
    averagePowerWatts: 100,
    maxTemperatureC: 40,
    minimumPowerHeadroomWatts: 20,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {
      "module-instance-00000001": { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    },
  };
}

function computeModuleState() {
  return {
    id: "module-instance-00000001",
    definitionId: "module-vacuum-tube-logic",
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    operationalState: "online" as const,
    overclock: { profile: "balanced" as const, frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function activeState(): GameState {
  const state = createInitialGameState({ content: loadContentBundle(), seed: "benchmark-state" });
  state.facility.modules = { "module-instance-00000001": computeModuleState() };
  state.facility.nextModuleInstanceSequence = 2;
  state.benchmarks.nextBenchmarkRunSequence = 2;
  state.research.statuses["research-high-frequency-clock"] = "completed";
  state.benchmarks.active = {
    runId: "benchmark-run-00000001",
    benchmarkId: "benchmark-peak-throughput",
    startedAtTick: 0,
    elapsedTicks: 0,
    clusterModuleIds: ["module-instance-00000001"],
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
    overclockSummary: { "module-instance-00000001": { ...computeModuleState().overclock } },
  };
  return state;
}

describe("Benchmark content foundations", () => {
  test("loads the two gated benchmark definitions without changing supplied numeric values", () => {
    const content = loadContentBundle();

    expect(content.era.benchmarkDefinitions).toMatchObject([
      {
        id: "benchmark-peak-throughput",
        type: "peak",
        durationSeconds: 15,
        targetAverageUsefulComputeFlops: 12_500,
        minimumValidSampleRate: 0.9,
        maximumRetryRate: 0.1,
        maximumTemperatureC: 86,
        requiredFeatureIds: ["peak-benchmark"],
      },
      {
        id: "benchmark-sustained-stability",
        type: "sustained",
        durationSeconds: 120,
        targetAverageUsefulComputeFlops: 9_000,
        minimumValidSampleRate: 0.98,
        maximumRetryRate: 0.03,
        maximumTemperatureC: 74,
        requiredFeatureIds: [],
      },
    ]);
  });

  test.each([
    [
      "duplicate feature IDs",
      (pack: RawContentPack) =>
        (benchmarkDefinitionAt(pack, 0).requiredFeatureIds = ["peak-benchmark", "peak-benchmark"]),
    ],
    [
      "unordered feature IDs",
      (pack: RawContentPack) =>
        (benchmarkDefinitionAt(pack, 0).requiredFeatureIds = ["z-feature", "a-feature"]),
    ],
    [
      "missing Research provider",
      (pack: RawContentPack) =>
        (benchmarkDefinitionAt(pack, 0).requiredFeatureIds = ["feature-without-provider"]),
    ],
    [
      "peak feature contract",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).requiredFeatureIds = []),
    ],
    [
      "sustained feature contract",
      (pack: RawContentPack) =>
        (benchmarkDefinitionAt(pack, 1).requiredFeatureIds = ["peak-benchmark"]),
    ],
    [
      "duplicate benchmark type",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 1).type = "peak"),
    ],
  ])("rejects %s", (_name, mutate) => {
    expectContentRejected(mutate);
  });

  test.each([
    [
      "duration zero",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).durationSeconds = 0),
    ],
    [
      "duration fractional",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).durationSeconds = 1.5),
    ],
    [
      "duration unsafe tick product",
      (pack: RawContentPack) =>
        (benchmarkDefinitionAt(pack, 0).durationSeconds = Number.MAX_SAFE_INTEGER),
    ],
    [
      "target zero",
      (pack: RawContentPack) =>
        (benchmarkDefinitionAt(pack, 0).targetAverageUsefulComputeFlops = 0),
    ],
    [
      "minimum valid sample zero",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).minimumValidSampleRate = 0),
    ],
    [
      "minimum valid sample above one",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).minimumValidSampleRate = 1.000001),
    ],
    [
      "retry rate one",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).maximumRetryRate = 1),
    ],
    [
      "temperature at ambient",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).maximumTemperatureC = 22),
    ],
    [
      "temperature above balancing",
      (pack: RawContentPack) => (benchmarkDefinitionAt(pack, 0).maximumTemperatureC = 251),
    ],
  ])("rejects %s", (_name, mutate) => {
    expectContentRejected(mutate);
  });
});

describe("Benchmark state foundations", () => {
  test("initializes the complete empty state with sequence one", () => {
    const state = createInitialGameState({
      content: loadContentBundle(),
      seed: "benchmark-initial",
    });

    expect(state.benchmarks).toEqual({
      nextBenchmarkRunSequence: 1,
      active: null,
      history: [],
      bestRunByBenchmark: {},
    });
    expect(validateStoredBenchmarkState(state)).toEqual([]);
  });

  test("accepts a sampled active run and the complete historical result shape", () => {
    const state = activeState();
    const result = validResult("benchmark-run-00000002");
    activeBenchmarkAt(state).elapsedTicks = 1;
    activeBenchmarkAt(state).maxTemperatureC = 40;
    activeBenchmarkAt(state).minimumPowerHeadroomWatts = 20;
    activeBenchmarkAt(state).accumulatedUsefulComputeFlops = 12_500;
    activeBenchmarkAt(state).peakUsefulComputeFlops = 12_500;
    activeBenchmarkAt(state).accumulatedPowerWatts = 100;
    activeBenchmarkAt(state).peakPowerWatts = 100;
    activeBenchmarkAt(state).accumulatedValidSampleRate = 1;
    state.benchmarks.history = [result];
    state.benchmarks.bestRunByBenchmark = { "benchmark-peak-throughput": result.runId };
    state.benchmarks.nextBenchmarkRunSequence = 3;

    expect(validateStoredBenchmarkState(state)).toEqual([]);
  });

  test.each([
    ["next sequence zero", (state: GameState) => (state.benchmarks.nextBenchmarkRunSequence = 0)],
    [
      "next sequence unsafe",
      (state: GameState) =>
        (state.benchmarks.nextBenchmarkRunSequence = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["negative elapsed ticks", (state: GameState) => (activeBenchmarkAt(state).elapsedTicks = -1)],
    [
      "nonfinite accumulator",
      (state: GameState) =>
        (activeBenchmarkAt(state).accumulatedPowerWatts = Number.POSITIVE_INFINITY),
    ],
    [
      "negative accumulated cost",
      (state: GameState) => (activeBenchmarkAt(state).accumulatedCostUsd = -0.000001),
    ],
    ["one null extrema", (state: GameState) => (activeBenchmarkAt(state).maxTemperatureC = 40)],
    [
      "malformed run ID",
      (state: GameState) => (activeBenchmarkAt(state).runId = "benchmark-run-1"),
    ],
    ["sequence reuse", (state: GameState) => (state.benchmarks.nextBenchmarkRunSequence = 1)],
    [
      "duplicate history ID",
      (state: GameState) => (state.benchmarks.history = [validResult(), validResult()]),
    ],
    [
      "invalid reason order",
      (state: GameState) => {
        const result = validResult();
        result.failureReasons = ["shutdown", "average-compute"];
        result.passed = false;
        state.benchmarks.history = [result];
      },
    ],
    [
      "passed/reason contradiction",
      (state: GameState) => {
        const result = validResult();
        result.failureReasons = ["average-compute"];
        state.benchmarks.history = [result];
      },
    ],
    [
      "dangling best result",
      (state: GameState) => {
        state.benchmarks.nextBenchmarkRunSequence = 2;
        state.benchmarks.bestRunByBenchmark = {
          "benchmark-peak-throughput": "benchmark-run-00000001",
        };
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const state = activeState();
    mutate(state);
    expect(validateStoredBenchmarkState(state).length).toBeGreaterThan(0);
  });

  test("content-aware validation checks active cluster and overclock coverage", () => {
    const state = activeState();
    expect(validateContentAwareBenchmarkState(state, loadContentBundle())).toEqual([]);

    delete activeBenchmarkAt(state).overclockSummary["module-instance-00000001"];
    expect(
      validateContentAwareBenchmarkState(state, loadContentBundle()).map(({ path }) => path),
    ).toContain("benchmarks.active.overclockSummary");
  });

  test("rejects an active run at its exact completion boundary", () => {
    const state = activeState();
    activeBenchmarkAt(state).elapsedTicks = 150;

    expect(
      validateContentAwareBenchmarkState(state, loadContentBundle()).map(({ path }) => path),
    ).toContain("benchmarks.active.elapsedTicks");
  });

  test("historical modules may be absent from the current facility", () => {
    const state = createInitialGameState({
      content: loadContentBundle(),
      seed: "historical-module",
    });
    state.benchmarks.history = [
      { ...validResult(), clusterModuleIds: ["module-instance-99999999"], overclockSummary: {} },
    ];
    state.benchmarks.bestRunByBenchmark = {
      "benchmark-peak-throughput": "benchmark-run-00000001",
    };
    state.benchmarks.nextBenchmarkRunSequence = 2;

    expect(validateContentAwareBenchmarkState(state, loadContentBundle())).toEqual([]);
  });

  test("rejects active Task and Research while a benchmark is running", () => {
    const state = activeState();
    state.research.active = {
      nodeId: "research-high-frequency-clock",
      startedAtTick: 0,
      completedOperations: 0,
      reservedComputeShare: 0.2,
    };
    expect(
      validateContentAwareBenchmarkState(state, loadContentBundle()).map(({ path }) => path),
    ).toContain("research.active");
  });

  test("wires stored validation into construction, save, and replacement", () => {
    const state = activeState();
    state.benchmarks.nextBenchmarkRunSequence = 0;

    expect(() => new SimCore({ initialState: state })).toThrow(/benchmark state/i);
    const valid = activeState();
    const core = new SimCore({ initialState: valid });
    const saved = core.getStateForSave();
    saved.benchmarks.nextBenchmarkRunSequence = 0;
    expect(() => {
      core.replaceState(saved);
    }).toThrow(/benchmark state/i);
  });

  test("keeps the public command contract reserved but unhandled", () => {
    const command = parseSimCommand({
      commandId: "00000000-0000-4000-8000-000000000001",
      source: "player",
      kind: "CANCEL_BENCHMARK",
    });
    expect(command.kind).toBe("CANCEL_BENCHMARK");
    const codes: CommandRejectionCode[] = [
      "BENCHMARK_NOT_ACTIVE",
      "BENCHMARK_CONFIGURATION_LOCKED",
      "BENCHMARK_ALREADY_ACTIVE",
      "BENCHMARK_REQUIREMENT_MISSING",
    ];
    expect(codes).toHaveLength(4);
    const core = new SimCore({
      initialState: createInitialGameState({
        content: loadContentBundle(),
        seed: "reserved-command",
      }),
    });
    core.enqueue({ ...command, commandId: "00000000-0000-4000-8000-000000000002" });
    expect(core.processPendingCommands()[0]).toMatchObject({
      accepted: false,
      code: "COMMAND_NOT_AVAILABLE",
    });
  });

  test("localizes the reserved benchmark rejection keys in both languages", () => {
    const content = loadContentBundle();
    expect(content.locales.en.errors["benchmark-not-active"]).toBe("No benchmark is active.");
    expect(content.locales.ro.errors["benchmark-not-active"]).toBe(
      "Niciun benchmark nu este activ.",
    );
    expect(content.locales.en.errors["benchmark-configuration-locked"]).toContain("locked");
    expect(content.locales.ro.errors["benchmark-configuration-locked"]).toContain("blocată");
  });

  test("survives JSON round-trip and remains deeply frozen through the authoritative boundary", () => {
    const state = createInitialGameState({ content: loadContentBundle(), seed: "benchmark-json" });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    const core = new SimCore({ initialState: state });
    const saved = core.getStateForSave();
    expect(Object.isFrozen(saved.benchmarks)).toBe(false);
    expect(
      Object.isFrozen(
        (
          core as unknown as { authoritativeState: { readInternal(): GameState } }
        ).authoritativeState.readInternal().benchmarks,
      ),
    ).toBe(true);
  });

  test("assert wrapper reports malformed benchmark state", () => {
    const state = activeState();
    activeBenchmarkAt(state).accumulatedUsefulComputeFlops = Number.NaN;
    expect(() => {
      assertValidContentAwareBenchmarkState(state, loadContentBundle());
    }).toThrow(/benchmark state/i);
  });
});
