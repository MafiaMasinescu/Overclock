import { describe, expect, test } from "vitest";

import { createBenchmarkCommandHandlers } from "../../src/sim/benchmarks/benchmarkCommands.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { BenchmarkResult, GameState, OverclockSettings } from "../../src/sim/core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../../src/sim/core/tickSystems.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createResearchTickSystems } from "../../src/sim/research/facilityResearch.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import {
  createTaskBenchmarkTickSystems,
  createTaskTickSystems,
} from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import { createThermalPerformanceFixture } from "../performance/thermalFixture.ts";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";

const content = loadContentBundle();
const MODULE_ID = "module-instance-00000008";
const PEAK_ID = "benchmark-peak-throughput";
const SUSTAINED_ID = "benchmark-sustained-stability";
const FINAL_RESEARCH_ID = "research-transistor-theory";

function overclockFor(state: Readonly<GameState>, moduleId = MODULE_ID): OverclockSettings {
  const module = state.facility.modules[moduleId];
  if (module === undefined) throw new Error(`Missing integration module ${moduleId}.`);
  return { ...module.overclock };
}

function activeBenchmark(
  state: GameState,
  benchmarkId = SUSTAINED_ID,
  elapsedTicks = 0,
): NonNullable<GameState["benchmarks"]["active"]> {
  return {
    runId: "benchmark-run-00000001",
    benchmarkId,
    startedAtTick: state.tick,
    elapsedTicks,
    clusterModuleIds: [MODULE_ID],
    accumulatedUsefulComputeFlops: elapsedTicks === 0 ? 0 : 20_000 * elapsedTicks,
    peakUsefulComputeFlops: elapsedTicks === 0 ? 0 : 20_000,
    accumulatedPowerWatts: elapsedTicks === 0 ? 0 : 10 * elapsedTicks,
    peakPowerWatts: elapsedTicks === 0 ? 0 : 10,
    maxTemperatureC: elapsedTicks === 0 ? null : state.facility.ambientTemperatureC,
    minimumPowerHeadroomWatts: elapsedTicks === 0 ? null : 0,
    accumulatedRetryRate: 0,
    accumulatedValidSampleRate: elapsedTicks,
    accumulatedCostUsd: 0,
    shutdownObserved: false,
    overclockSummary: { [MODULE_ID]: overclockFor(state) },
  };
}

function benchmarkState(benchmarkId = SUSTAINED_ID, elapsedTicks = 0): GameState {
  const state = createThermalPerformanceFixture(`task-benchmark-${benchmarkId}-${elapsedTicks}`);
  canonicalizeModuleIds(state);
  state.tasks.instances = {};
  state.tasks.offers = [];
  if (benchmarkId === PEAK_ID) {
    state.research.statuses["research-high-frequency-clock"] = "completed";
  }
  state.benchmarks.active = activeBenchmark(state, benchmarkId, elapsedTicks);
  state.benchmarks.nextBenchmarkRunSequence = 2;
  return state;
}

function systems(
  options: Parameters<typeof createTaskBenchmarkTickSystems>[1] = {},
): TickSystemRegistry {
  return {
    ...createPowerTickSystems(content),
    ...createThermalTickSystems(content),
    ...createOverclockTickSystems(content),
    ...createComputeTickSystems(content),
    ...createTaskBenchmarkTickSystems(content, options),
    ...createResearchTickSystems(content),
  };
}

function preparedState(seed: string): GameState {
  const state = createThermalPerformanceFixture(seed);
  canonicalizeModuleIds(state);
  state.tasks.instances = {};
  state.tasks.offers = [];
  const core = new SimCore({
    initialState: state,
    tickSystems: {
      ...createPowerTickSystems(content),
      ...createThermalTickSystems(content),
      ...createOverclockTickSystems(content),
      ...createComputeTickSystems(content),
      ...createTaskTickSystems(content),
    },
  });
  core.step();
  return core.getStateForSave();
}

function withActiveBenchmark(state: GameState, benchmarkId = SUSTAINED_ID): GameState {
  state.benchmarks.active = activeBenchmark(state, benchmarkId);
  state.benchmarks.nextBenchmarkRunSequence = Math.max(
    state.benchmarks.nextBenchmarkRunSequence,
    2,
  );
  if (benchmarkId === PEAK_ID) {
    state.research.statuses["research-high-frequency-clock"] = "completed";
  }
  return state;
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
  state.facility.nextModuleInstanceSequence = sourceIds.length + 1;
}

function validPeakResult(runId: string): BenchmarkResult {
  return {
    runId,
    benchmarkId: PEAK_ID,
    clusterModuleIds: [MODULE_ID],
    passed: true,
    startedAtTick: 0,
    durationTicks: 150,
    averageUsefulComputeFlops: 20_000,
    peakUsefulComputeFlops: 20_000,
    peakPowerWatts: 10,
    averagePowerWatts: 10,
    maxTemperatureC: 20,
    minimumPowerHeadroomWatts: 50_000,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: { [MODULE_ID]: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 } },
  };
}

function startSustainedCommand() {
  return {
    commandId: "73000000-0000-4000-8000-000000000001",
    source: "player" as const,
    kind: "START_BENCHMARK" as const,
    benchmarkId: SUSTAINED_ID,
    clusterModuleIds: [MODULE_ID],
  };
}

describe("combined Task and Benchmark production stage", () => {
  test("registers the shared stage exactly once and preserves Task-only compatibility", () => {
    const combined = createTaskBenchmarkTickSystems(content);
    const taskOnly = createTaskTickSystems(content);
    expect(Object.keys(combined)).toEqual(["advance-tasks-and-benchmarks"]);
    expect(Object.keys(taskOnly)).toEqual(["advance-tasks-and-benchmarks"]);
    expect(combined["advance-tasks-and-benchmarks"]).toBeDefined();
  });

  test("uses current-tick Compute for the first Benchmark sample after Task", () => {
    const events: string[] = [];
    const state = benchmarkState();
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        ...createPowerTickSystems(content),
        ...createThermalTickSystems(content),
        ...createOverclockTickSystems(content),
        ...createComputeTickSystems(content, {
          onFacilityCalculation: () => events.push("compute"),
        }),
        ...createTaskBenchmarkTickSystems(content, {
          onTaskAdvance: () => events.push("task"),
          onBenchmarkAdvance: () => events.push("benchmark"),
        }),
      },
    });

    core.step();

    const after = core.getStateForSave();
    const compute = after.facility.compute.byModule[MODULE_ID];
    const active = after.benchmarks.active;
    expect(events).toEqual(["compute", "task", "benchmark"]);
    expect(compute).toBeDefined();
    expect(active?.elapsedTicks).toBe(1);
    expect(active?.accumulatedUsefulComputeFlops).toBe(compute?.availableComputeFlops);
  });

  test("starts and samples in the same tick, then completes at exact Peak and Sustained boundaries", () => {
    const startState = preparedState("same-tick-start");
    startState.benchmarks.active = null;
    startState.benchmarks.nextBenchmarkRunSequence = 1;
    const startCore = new SimCore({
      initialState: startState,
      commandHandlers: createBenchmarkCommandHandlers(content),
      tickSystems: systems(),
    });
    startCore.enqueue(startSustainedCommand());
    const stepResult = startCore.step();
    expect(stepResult.commandResults[0]).toMatchObject({ accepted: true, appliedAtTick: 1 });
    expect(startCore.getStateForSave().benchmarks.active?.elapsedTicks).toBe(1);

    const peak = preparedState("exact-peak");
    withActiveBenchmark(peak, PEAK_ID);
    peak.benchmarks.active = activeBenchmark(peak, PEAK_ID, 149);
    const peakCore = new SimCore({
      initialState: peak,
      tickSystems: createTaskBenchmarkTickSystems(content),
    });
    peakCore.step();
    expect(peakCore.getStateForSave().benchmarks.active).toBeNull();
    expect(peakCore.getStateForSave().benchmarks.history).toHaveLength(1);
    expect(peakCore.getStateForSave().benchmarks.history[0]?.durationTicks).toBe(150);

    const sustained = preparedState("exact-sustained");
    sustained.benchmarks.active = activeBenchmark(sustained, SUSTAINED_ID, 1_199);
    sustained.benchmarks.nextBenchmarkRunSequence = 2;
    const sustainedCore = new SimCore({
      initialState: sustained,
      tickSystems: createTaskBenchmarkTickSystems(content),
    });
    sustainedCore.step();
    expect(sustainedCore.getStateForSave().benchmarks.active).toBeNull();
    expect(sustainedCore.getStateForSave().benchmarks.history[0]?.durationTicks).toBe(1_200);
  });

  test("makes a completed Benchmark visible to Research in the same tick", () => {
    const state = preparedState("research-visibility");
    state.research.statuses["research-delay-line-memory"] = "completed";
    state.research.statuses["research-blueprint-documentation"] = "completed";
    state.research.statuses["research-high-frequency-clock"] = "completed";
    state.research.evidenceTags = ["evidence-semiconductor-effect"];
    state.benchmarks.history = [validPeakResult("benchmark-run-00000002")];
    state.benchmarks.bestRunByBenchmark = { [PEAK_ID]: "benchmark-run-00000002" };
    state.benchmarks.nextBenchmarkRunSequence = 3;
    state.benchmarks.active = activeBenchmark(state, SUSTAINED_ID, 1_199);

    const core = new SimCore({
      initialState: state,
      tickSystems: systems(),
    });
    core.step();

    const after = core.getStateForSave();
    expect(after.benchmarks.history).toHaveLength(2);
    expect(after.benchmarks.history[1]?.passed).toBe(true);
    expect(after.research.statuses[FINAL_RESEARCH_ID]).toBe("available");
  });

  test("does not unlock Research for a failed completed Benchmark", () => {
    const state = preparedState("research-failure");
    state.research.statuses["research-delay-line-memory"] = "completed";
    state.research.statuses["research-blueprint-documentation"] = "completed";
    state.research.statuses["research-high-frequency-clock"] = "completed";
    state.research.evidenceTags = ["evidence-semiconductor-effect"];
    state.benchmarks.history = [validPeakResult("benchmark-run-00000002")];
    state.benchmarks.bestRunByBenchmark = { [PEAK_ID]: "benchmark-run-00000002" };
    state.benchmarks.nextBenchmarkRunSequence = 3;
    const active = activeBenchmark(state, SUSTAINED_ID, 1_199);
    active.accumulatedUsefulComputeFlops = 0;
    active.peakUsefulComputeFlops = 0;
    active.accumulatedValidSampleRate = 0;
    state.benchmarks.active = active;

    const core = new SimCore({ initialState: state, tickSystems: systems() });
    core.step();

    const after = core.getStateForSave();
    expect(after.benchmarks.history[1]?.passed).toBe(false);
    expect(after.benchmarks.bestRunByBenchmark[SUSTAINED_ID]).toBeUndefined();
    expect(after.research.statuses[FINAL_RESEARCH_ID]).toBe("locked");
  });

  test("rolls back Benchmark when Task calculation fails", () => {
    const state = benchmarkState();
    const before = canonicalSerialize(state);
    const core = new SimCore({
      initialState: state,
      tickSystems: systems({
        onTaskAdvance: () => {
          throw new Error("task failure");
        },
      }),
    });

    expect(() => core.step()).toThrow(/advance-tasks-and-benchmarks/);
    expect(canonicalSerialize(core.getStateForSave())).toBe(canonicalSerialize(state));
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("rolls back same-tick Task changes when Benchmark calculation fails", () => {
    const state = benchmarkState();
    const before = canonicalSerialize(state);
    const core = new SimCore({
      initialState: state,
      tickSystems: systems({
        onBenchmarkAdvance: () => {
          throw new Error("benchmark failure");
        },
      }),
    });

    expect(() => core.step()).toThrow(/advance-tasks-and-benchmarks/);
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("preserves Benchmark branch identity when inactive and reuses history while warm", () => {
    const inactive = preparedState("inactive-identity");
    inactive.benchmarks.active = null;
    const inactiveRuntime = createTaskBenchmarkTickSystems(content)["advance-tasks-and-benchmarks"];
    if (typeof inactiveRuntime === "function" || inactiveRuntime === undefined) {
      throw new Error("Expected a combined stage factory.");
    }
    const inactiveSystem = inactiveRuntime.createRuntime();
    if (inactiveSystem.executionMode !== "structural-sharing") {
      throw new Error("Expected structural stage.");
    }
    const inactiveResult = inactiveSystem.run({
      state: inactive,
      rng: createSeededRngFromState(inactive.rngState),
    });
    expect(inactiveResult.benchmarks).toBe(inactive.benchmarks);

    const active = withActiveBenchmark(preparedState("warm-active"));
    const runtime = createTaskBenchmarkTickSystems(content)["advance-tasks-and-benchmarks"];
    if (typeof runtime === "function" || runtime === undefined) throw new Error("Missing factory.");
    const system = runtime.createRuntime();
    if (system.executionMode !== "structural-sharing")
      throw new Error("Expected structural stage.");
    Object.freeze(active.benchmarks.history);
    Object.freeze(active.benchmarks.bestRunByBenchmark);
    const result = system.run({ state: active, rng: createSeededRngFromState(active.rngState) });
    expect(result.benchmarks.history).toBe(active.benchmarks.history);
    expect(result.benchmarks.bestRunByBenchmark).toBe(active.benchmarks.bestRunByBenchmark);
    expect(result.benchmarks.active).not.toBe(active.benchmarks.active);
  });

  test("rejects later Benchmark-owned replacement and leaves the pre-tick state committed", () => {
    const state = benchmarkState();
    const malicious: TickSystemRegistry = {
      ...systems(),
      "emit-events": {
        createRuntime() {
          return {
            executionMode: "structural-sharing" as const,
            run({ state: current }: StructuralSharingTickSystemContext) {
              return { ...current, benchmarks: { ...current.benchmarks, history: [] } };
            },
          };
        },
      },
    };
    const before = canonicalSerialize(state);
    const core = new SimCore({ initialState: state, tickSystems: malicious });
    expect(() => core.step()).toThrow(/emit-events/);
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("rejects later mutable-stage Benchmark history mutation with the same rollback boundary", () => {
    const state = withActiveBenchmark(preparedState("mutable-history-replacement"));
    const malicious: TickSystemRegistry = {
      ...systems(),
      "emit-events": ({ state: current }) => {
        current.benchmarks = { ...current.benchmarks, active: null };
      },
    };
    const before = canonicalSerialize(state);
    const core = new SimCore({ initialState: state, tickSystems: malicious });
    expect(() => core.step()).toThrow(/emit-events/);
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("rolls back a Benchmark accumulator overflow without committing the Task candidate", () => {
    const state = withActiveBenchmark(preparedState("benchmark-overflow"));
    const active = state.benchmarks.active;
    const compute = state.facility.compute.byModule[MODULE_ID];
    if (active === null || compute === undefined)
      throw new Error("Overflow fixture is incomplete.");
    active.elapsedTicks = 1;
    active.maxTemperatureC = state.facility.ambientTemperatureC;
    active.minimumPowerHeadroomWatts = 0;
    active.accumulatedUsefulComputeFlops = Number.MAX_VALUE;
    state.facility.compute.byModule[MODULE_ID] = {
      ...compute,
      theoreticalComputeFlops: Number.MAX_VALUE,
      powerFactor: 1,
      thermalFactor: 1,
      retryRate: 0,
      invalidSampleRate: 0,
      stabilityFactor: 1,
      availableComputeFlops: Number.MAX_VALUE,
    };
    state.facility.compute.totalTheoreticalComputeFlops = Number.MAX_VALUE;
    state.facility.compute.totalAvailableComputeFlops = Number.MAX_VALUE;
    const before = canonicalSerialize(state);
    const core = new SimCore({
      initialState: state,
      tickSystems: createTaskBenchmarkTickSystems(content),
    });
    expect(() => core.step()).toThrow(/advance-tasks-and-benchmarks/);
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("does not consume RNG during the combined stage", () => {
    const state = benchmarkState();
    const before = state.rngState;
    const core = new SimCore({ initialState: state, tickSystems: systems() });
    core.step();
    expect(core.getStateForSave().rngState).toBe(before);
  });

  test("command-only processing, step(0), and cancellation take no Benchmark sample", () => {
    const state = preparedState("command-only");
    state.benchmarks.active = null;
    const core = new SimCore({
      initialState: state,
      commandHandlers: createBenchmarkCommandHandlers(content),
      tickSystems: systems(),
    });
    core.enqueue(startSustainedCommand());
    expect(core.processPendingCommands()[0]).toMatchObject({ accepted: true });
    expect(core.getStateForSave().benchmarks.active?.elapsedTicks).toBe(0);
    expect(core.step(0).ticksExecuted).toBe(0);
    expect(core.getStateForSave().benchmarks.active?.elapsedTicks).toBe(0);
    core.enqueue({
      commandId: "73000000-0000-4000-8000-000000000002",
      source: "player",
      kind: "CANCEL_BENCHMARK",
    });
    expect(core.processPendingCommands()[0]).toMatchObject({ accepted: true });
    expect(core.getStateForSave().benchmarks.history).toHaveLength(0);
  });

  test("retains prior completed ticks after an injected fatal combined-stage failure", () => {
    const state = benchmarkState();
    const core = new SimCore({
      initialState: state,
      tickSystems: systems({
        onBenchmarkAdvance: () => {
          throw new Error("fatal");
        },
      }),
    });
    const before = core.getStateForSave();
    expect(() => core.step()).toThrow();
    expect(core.getStateForSave().tick).toBe(before.tick);
    expect(core.getStateForSave().clock).toEqual(before.clock);
  });

  test("keeps Task-only tests on the original single-stage factory", () => {
    const state = createInitialGameState({ content, seed: "task-only-compatibility" });
    const factory = createTaskTickSystems(content);
    const registration = factory["advance-tasks-and-benchmarks"];
    expect(registration).toBeDefined();
    expect(state.benchmarks.active).toBeNull();
  });

  test("preserves exact final serialization for a deterministic completed run", () => {
    const state = preparedState("final-hash");
    state.benchmarks.active = activeBenchmark(state, SUSTAINED_ID, 1_199);
    state.benchmarks.nextBenchmarkRunSequence = 2;
    const core = new SimCore({
      initialState: state,
      tickSystems: createTaskBenchmarkTickSystems(content),
    });
    core.step();
    const result = core.getStateForSave();
    expect(hashCanonicalState(result)).toBe(
      hashCanonicalState(JSON.parse(canonicalSerialize(result))),
    );
    expect(result.benchmarks.history).toHaveLength(1);
  });
});
