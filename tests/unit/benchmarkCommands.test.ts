import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createBenchmarkCommandHandlers } from "../../src/sim/benchmarks/benchmarkCommands.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type {
  GameState,
  ModuleInstanceState,
  TaskInstanceState,
} from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const PEAK = "benchmark-peak-throughput";
const SUSTAINED = "benchmark-sustained-stability";
const COMPUTE_ID = "module-instance-00000001";
const SECOND_COMPUTE_ID = "module-instance-00000002";

function commandId(sequence: number): string {
  return `71000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function module(
  id: string,
  operationalState: ModuleInstanceState["operationalState"] = "online",
): ModuleInstanceState {
  return {
    id,
    definitionId: "module-vacuum-tube-logic",
    position: { x: 0, y: 0 },
    rotation: 0,
    operationalState,
    overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function baseState(): GameState {
  const state = createInitialGameState({ content, seed: "benchmark-command-tests" });
  state.facility.modules = { [COMPUTE_ID]: module(COMPUTE_ID) };
  return state;
}

function startCommand(
  sequence: number,
  benchmarkId = SUSTAINED,
  clusterModuleIds = [COMPUTE_ID],
  expectedTick?: number,
): Extract<SimCommand, { kind: "START_BENCHMARK" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "START_BENCHMARK",
    benchmarkId,
    clusterModuleIds,
    ...(expectedTick === undefined ? {} : { expectedTick }),
  };
}

function cancelCommand(
  sequence: number,
  expectedTick?: number,
): Extract<SimCommand, { kind: "CANCEL_BENCHMARK" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "CANCEL_BENCHMARK",
    ...(expectedTick === undefined ? {} : { expectedTick }),
  };
}

function createCore(state = baseState()): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers: createBenchmarkCommandHandlers(content),
  });
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected one command result.");
  return result;
}

function expectRequirement(result: ReturnType<typeof process>, reason: string): void {
  expect(result).toMatchObject({
    accepted: false,
    code: "BENCHMARK_REQUIREMENT_MISSING",
    parameters: { reason },
  });
}

function activeTask(state: GameState, status: TaskInstanceState["status"]): void {
  state.tasks.offers = state.tasks.offers.filter(
    (definitionId) => definitionId !== "task-ballistic-table-verification",
  );
  state.tasks.nextTaskInstanceSequence = 2;
  state.tasks.instances["task-instance-00000001"] = {
    id: "task-instance-00000001",
    definitionId: "task-ballistic-table-verification",
    status,
    acceptedAtTick: 0,
    deadlineTick: null,
    currentPhaseIndex: 0,
    phaseCompletedOperations: 0,
    totalCompletedOperations: 0,
    allocation:
      status === "accepted"
        ? null
        : {
            clusterModuleIds: [COMPUTE_ID],
            requestedShare: 0.5,
            deliveredUsefulComputeFlops: 0,
          },
    accruedPayoutUsd: 0,
    serviceWindowCompliant: null,
  };
}

describe("Benchmark command handlers", () => {
  test("accepts baseline Sustained and creates the exact initialized run", () => {
    const core = createCore();

    expect(process(core, startCommand(1))).toEqual({
      commandId: commandId(1),
      accepted: true,
      appliedAtTick: 0,
    });
    expect(core.getStateForSave().benchmarks).toEqual({
      nextBenchmarkRunSequence: 2,
      active: {
        runId: "benchmark-run-00000001",
        benchmarkId: SUSTAINED,
        startedAtTick: 0,
        elapsedTicks: 0,
        clusterModuleIds: [COMPUTE_ID],
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
        overclockSummary: { [COMPUTE_ID]: module(COMPUTE_ID).overclock },
      },
      history: [],
      bestRunByBenchmark: {},
    });
  });

  test.each([
    ["unknown-definition", "benchmark-missing", "unknown-definition"],
    ["feature-locked", PEAK, "feature-locked"],
  ])("rejects %s before later checks", (_label, benchmarkId, reason) => {
    const core = createCore();
    const before = hashCanonicalState(core.getStateForSave());

    const result = process(core, startCommand(1, benchmarkId));

    expectRequirement(result, reason);
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("checks active Benchmark before unknown definition", () => {
    const state = baseState();
    const core = createCore(state);
    expect(process(core, startCommand(1))).toMatchObject({ accepted: true });
    const before = core.getStateForSave();

    const result = process(core, startCommand(2, "benchmark-missing"));

    expect(result).toMatchObject({ accepted: false, code: "BENCHMARK_ALREADY_ACTIVE" });
    expect(core.getStateForSave()).toEqual(before);
  });

  test.each([
    [
      "active-research",
      (state: GameState) => {
        state.research.statuses["research-stable-power-distribution"] = "active";
        state.research.active = {
          nodeId: "research-stable-power-distribution",
          startedAtTick: 0,
          completedOperations: 0,
          reservedComputeShare: 0.1,
        };
      },
    ],
    [
      "active-task",
      (state: GameState) => {
        activeTask(state, "active");
      },
    ],
  ])("rejects a %s conflict", (reason, configure) => {
    const state = baseState();
    configure(state);
    const core = createCore(state);

    expectRequirement(process(core, startCommand(1)), reason);
  });

  test("allows an accepted or held Task to coexist", () => {
    for (const status of ["accepted", "hold"] as const) {
      const state = baseState();
      activeTask(state, status);
      const core = createCore(state);
      expect(process(core, startCommand(1))).toMatchObject({ accepted: true });
    }
  });

  test.each([
    ["empty-cluster", []],
    ["duplicate-module", [COMPUTE_ID, COMPUTE_ID]],
    ["missing-module", ["module-instance-00000002"]],
    ["non-compute-module", ["module-instance-00000003"]],
  ])("rejects a %s cluster atomically", (reason, clusterModuleIds) => {
    const state = baseState();
    state.facility.modules["module-instance-00000003"] = module("module-instance-00000003");
    state.facility.modules["module-instance-00000003"].definitionId = "module-accumulator-register";
    const core = createCore(state);
    const before = hashCanonicalState(core.getStateForSave());

    expectRequirement(process(core, startCommand(1, SUSTAINED, clusterModuleIds)), reason);
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
    expect(core.getStateForSave().rngState).toBe(state.rngState);
  });

  test("canonicalizes a valid cluster and accepts offline, starting, and shutdown modules", () => {
    for (const operationalState of ["offline", "starting", "shutdown"] as const) {
      const state = baseState();
      state.facility.modules[COMPUTE_ID] = module(COMPUTE_ID, operationalState);
      state.facility.modules[SECOND_COMPUTE_ID] = module(SECOND_COMPUTE_ID, "online");
      const core = createCore(state);

      expect(
        process(core, startCommand(1, SUSTAINED, [SECOND_COMPUTE_ID, COMPUTE_ID])),
      ).toMatchObject({
        accepted: true,
      });
      expect(core.getStateForSave().benchmarks.active?.clusterModuleIds).toEqual([
        COMPUTE_ID,
        SECOND_COMPUTE_ID,
      ]);
    }
  });

  test("does not require current Compute results before starting", () => {
    const core = createCore();
    expect(core.getStateForSave().facility.compute.byModule).toEqual({});
    expect(process(core, startCommand(1))).toMatchObject({ accepted: true });
  });

  test("captures exact requested overclock settings without charging or mutating lifecycle state", () => {
    const state = baseState();
    const before = hashCanonicalState(state);
    const selectedModule = state.facility.modules[COMPUTE_ID];
    if (selectedModule === undefined) throw new Error("Expected selected module fixture.");
    const settings = selectedModule.overclock;
    const core = createCore(state);

    expect(process(core, startCommand(1))).toMatchObject({ accepted: true });
    const active = core.getStateForSave().benchmarks.active;
    expect(active?.overclockSummary[COMPUTE_ID]).toEqual(settings);
    expect(core.getStateForSave().economy).toEqual(state.economy);
    expect(core.getStateForSave().facility.modules[COMPUTE_ID]?.operationalState).toBe("online");
    expect(core.getStateForSave().rngState).toBe(state.rngState);
    expect(state.benchmarks.active).toBeNull();
    expect(state.benchmarks.nextBenchmarkRunSequence).toBe(1);
    expect(hashCanonicalState(core.getStateForSave())).not.toBe(before);
  });

  test("consumes sequences monotonically and cancellation does not create history", () => {
    const core = createCore();
    expect(process(core, startCommand(1))).toMatchObject({ accepted: true });
    expect(process(core, cancelCommand(2))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().benchmarks).toMatchObject({
      nextBenchmarkRunSequence: 2,
      active: null,
      history: [],
      bestRunByBenchmark: {},
    });
    expect(process(core, startCommand(3))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().benchmarks.active?.runId).toBe("benchmark-run-00000002");
  });

  test("rejects repeated start and cancellation without an active run", () => {
    const core = createCore();
    expect(process(core, cancelCommand(1))).toMatchObject({
      accepted: false,
      code: "BENCHMARK_NOT_ACTIVE",
    });
    expect(process(core, startCommand(2))).toMatchObject({ accepted: true });
    const before = hashCanonicalState(core.getStateForSave());
    expect(process(core, startCommand(3))).toMatchObject({
      accepted: false,
      code: "BENCHMARK_ALREADY_ACTIVE",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("rejects exhausted sequences as INVALID_SYSTEM", () => {
    const state = baseState();
    state.benchmarks.nextBenchmarkRunSequence = Number.MAX_SAFE_INTEGER;
    const core = createCore(state);

    expect(process(core, startCommand(1))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
  });

  test("preserves FIFO command semantics, expectedTick, step(0), and earlier commits", () => {
    const core = createCore();
    core.enqueue(startCommand(1, SUSTAINED, [COMPUTE_ID], 1));
    expect(core.step(0)).toMatchObject({ ticksExecuted: 0, startTick: 0, endTick: 0 });
    expect(core.getStateForSave().benchmarks.active).toBeNull();

    core.enqueue(startCommand(2, SUSTAINED, [COMPUTE_ID], 0));
    core.enqueue(cancelCommand(3, 0));
    core.enqueue(startCommand(4, SUSTAINED, [COMPUTE_ID], 0));
    expect(core.processPendingCommands()).toMatchObject([
      { accepted: false, code: "STALE_TICK" },
      { accepted: true },
      { accepted: true },
      { accepted: true },
    ]);
    expect(core.getStateForSave().benchmarks.active?.runId).toBe("benchmark-run-00000002");
  });

  test("protects retained command references and replacement/save validation", () => {
    const core = createCore();
    const command = startCommand(1, SUSTAINED, [COMPUTE_ID]);
    core.enqueue(command);
    command.clusterModuleIds.reverse();
    command.clusterModuleIds.push(SECOND_COMPUTE_ID);
    expect(core.processPendingCommands()[0]).toMatchObject({ accepted: true });
    expect(core.getStateForSave().benchmarks.active?.clusterModuleIds).toEqual([COMPUTE_ID]);

    const saved = core.getStateForSave();
    core.replaceState(saved);
    saved.benchmarks.nextBenchmarkRunSequence = 0;
    expect(() => {
      core.replaceState(saved);
    }).toThrow(/benchmark state/i);
  });

  test("serializes commands, results, and state without RNG or witness data", () => {
    const core = createCore();
    const command = startCommand(1);
    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
    expect(JSON.parse(JSON.stringify(core.processPendingCommands()))).toEqual([]);
    core.enqueue(command);
    const results = core.processPendingCommands();
    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
    expect(JSON.stringify(core.getStateForSave())).not.toContain("witness");
  });
});
