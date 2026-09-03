import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createBenchmarkCommandHandlers } from "../../src/sim/benchmarks/benchmarkCommands.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInventoryEconomyCommandHandlers } from "../../src/sim/economy/inventoryTransactions.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore, type SimCoreCommandHandlerRegistry } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { createOverclockCommandHandlers } from "../../src/sim/overclock/overclockCommands.ts";
import { createResearchCommandHandlers } from "../../src/sim/research/researchCommands.ts";
import { createTaskCommandHandlers } from "../../src/sim/tasks/taskCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const SUSTAINED = "benchmark-sustained-stability";
const MODULE_ID = "module-instance-00000001";
const SECOND_MODULE_ID = "module-instance-00000002";
const RESEARCH_ID = "research-stable-power-distribution";

function commandId(sequence: number): string {
  return `72000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function module(
  id: string,
  position = { x: 0, y: 0 },
  overclock: ModuleInstanceState["overclock"] = {
    profile: "balanced",
    frequencyRatio: 1,
    voltageRatio: 1,
  },
): ModuleInstanceState {
  return {
    id,
    definitionId: "module-vacuum-tube-logic",
    position,
    rotation: 0,
    operationalState: "online",
    overclock,
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function baseState(): GameState {
  const state = createInitialGameState({ content, seed: "benchmark-guard-tests" });
  state.facility.modules = {
    [MODULE_ID]: module(MODULE_ID),
    [SECOND_MODULE_ID]: module(SECOND_MODULE_ID, { x: 3, y: 0 }),
  };
  state.research.researchData = 100;
  return state;
}

function handlers(): SimCoreCommandHandlerRegistry {
  return {
    ...createBenchmarkCommandHandlers(content),
    ...createDesignModeCommandHandlers(content),
    ...createInventoryEconomyCommandHandlers(content),
    ...createOverclockCommandHandlers(content),
    ...createResearchCommandHandlers(content),
    ...createTaskCommandHandlers(content),
  };
}

function createCore(state = baseState()): SimCore {
  return new SimCore({ initialState: state, commandHandlers: handlers() });
}

function startBenchmark(sequence: number): Extract<SimCommand, { kind: "START_BENCHMARK" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "START_BENCHMARK",
    benchmarkId: SUSTAINED,
    clusterModuleIds: [MODULE_ID],
  };
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected one command result.");
  return result;
}

function expectLocked(result: ReturnType<typeof process>): void {
  expect(result).toMatchObject({
    accepted: false,
    code: "BENCHMARK_CONFIGURATION_LOCKED",
    messageKey: "errors.benchmark-configuration-locked",
  });
}

function acceptTask(core: SimCore, sequence: number): void {
  expect(
    process(core, {
      commandId: commandId(sequence),
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: "task-ballistic-table-verification",
    }),
  ).toMatchObject({ accepted: true });
}

function allocateTask(core: SimCore, sequence: number): ReturnType<typeof process> {
  return process(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "ALLOCATE_TASK",
    taskInstanceId: "task-instance-00000001",
    clusterModuleIds: [MODULE_ID],
    requestedShare: 0.5,
  });
}

function setHold(core: SimCore, sequence: number, hold: boolean): ReturnType<typeof process> {
  return process(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "SET_TASK_HOLD",
    taskInstanceId: "task-instance-00000001",
    hold,
  });
}

describe("Benchmark configuration and workload guards", () => {
  test.each(["SET_OVERCLOCK_PROFILE", "SET_MANUAL_OVERCLOCK"] as const)(
    "rejects %s while a Benchmark is active",
    (kind) => {
      const core = createCore();
      expect(process(core, startBenchmark(1))).toMatchObject({ accepted: true });
      const result = process(
        core,
        kind === "SET_OVERCLOCK_PROFILE"
          ? {
              commandId: commandId(2),
              source: "player",
              kind,
              moduleInstanceIds: [MODULE_ID],
              profile: "boost",
            }
          : {
              commandId: commandId(2),
              source: "player",
              kind,
              moduleInstanceIds: [MODULE_ID],
              frequencyRatio: 1.1,
              voltageRatio: 1.05,
            },
      );
      expectLocked(result);
    },
  );

  test("allows an overclock change before a same-batch start and captures it", () => {
    const core = createCore();
    core.enqueue({
      commandId: commandId(1),
      source: "player",
      kind: "SET_MANUAL_OVERCLOCK",
      moduleInstanceIds: [MODULE_ID],
      frequencyRatio: 1.1,
      voltageRatio: 1.05,
    });
    core.enqueue(startBenchmark(2));

    expect(core.processPendingCommands()).toMatchObject([{ accepted: true }, { accepted: true }]);
    expect(core.getStateForSave().benchmarks.active?.overclockSummary[MODULE_ID]).toEqual({
      profile: "manual",
      frequencyRatio: 1.1,
      voltageRatio: 1.05,
    });
  });

  test("rejects APPLY_DESIGN while active but permits draft editing", () => {
    const core = createCore();
    expect(process(core, startBenchmark(1))).toMatchObject({ accepted: true });
    expect(
      process(core, {
        commandId: commandId(2),
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    ).toMatchObject({ accepted: true });
    const beforeLiveModules = core.getStateForSave().facility.modules;
    expect(
      process(core, {
        commandId: commandId(3),
        source: "player",
        kind: "MOVE_MODULE",
        moduleInstanceId: MODULE_ID,
        position: { x: 1, y: 0 },
      }),
    ).toMatchObject({ accepted: true });
    expectLocked(
      process(core, {
        commandId: commandId(4),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: 1,
        acceptedCostUsd: 0,
        acceptedDowntimeTicks: 0,
      }),
    );
    const after = core.getStateForSave();
    expect(after.facility.modules).toEqual(beforeLiveModules);
    expect(after.facility.liveLayoutRevision).toBe(0);
    expect(after.facility.designDraft).not.toBeNull();
  });

  test("rejects START_RESEARCH while active", () => {
    const core = createCore();
    expect(process(core, startBenchmark(1))).toMatchObject({ accepted: true });
    expectLocked(
      process(core, {
        commandId: commandId(2),
        source: "player",
        kind: "START_RESEARCH",
        nodeId: RESEARCH_ID,
        reservedComputeShare: 0.1,
      }),
    );
  });

  test("rejects activation and resume, but permits allocation on a held Task", () => {
    const core = createCore();
    acceptTask(core, 1);
    expect(allocateTask(core, 2)).toMatchObject({ accepted: true });
    expect(setHold(core, 3, true)).toMatchObject({ accepted: true });
    expect(process(core, startBenchmark(4))).toMatchObject({ accepted: true });

    expect(allocateTask(core, 5)).toMatchObject({ accepted: true });
    expectLocked(setHold(core, 6, false));
    expect(core.getStateForSave().tasks.instances["task-instance-00000001"]?.status).toBe("hold");
  });

  test("permits Task acceptance and abandonment while active", () => {
    const core = createCore();
    expect(process(core, startBenchmark(1))).toMatchObject({ accepted: true });
    acceptTask(core, 2);
    expect(
      process(core, {
        commandId: commandId(3),
        source: "player",
        kind: "ABANDON_TASK",
        taskInstanceId: "task-instance-00000001",
      }),
    ).toMatchObject({ accepted: true });
    expect(core.getStateForSave().tasks.instances["task-instance-00000001"]?.status).toBe(
      "abandoned",
    );
  });

  test("preserves FIFO matrix: allocation before start rejects start, start before allocation rejects allocation", () => {
    const first = createCore();
    acceptTask(first, 1);
    first.enqueue(allocateTaskCommand(2));
    first.enqueue(startBenchmark(3));
    expect(first.processPendingCommands()).toMatchObject([
      { accepted: true },
      { accepted: false, code: "BENCHMARK_REQUIREMENT_MISSING" },
    ]);

    const second = createCore();
    acceptTask(second, 4);
    second.enqueue(startBenchmark(5));
    second.enqueue(allocateTaskCommand(6));
    expect(second.processPendingCommands()).toMatchObject([
      { accepted: true },
      { accepted: false, code: "BENCHMARK_CONFIGURATION_LOCKED" },
    ]);
  });

  test("preserves Research/Benchmark FIFO in both orders", () => {
    const first = createCore();
    first.enqueue({
      commandId: commandId(1),
      source: "player",
      kind: "START_RESEARCH",
      nodeId: RESEARCH_ID,
      reservedComputeShare: 0.1,
    });
    first.enqueue(startBenchmark(2));
    expect(first.processPendingCommands()).toMatchObject([
      { accepted: true },
      { accepted: false, code: "BENCHMARK_REQUIREMENT_MISSING" },
    ]);

    const second = createCore();
    second.enqueue(startBenchmark(3));
    second.enqueue({
      commandId: commandId(4),
      source: "player",
      kind: "START_RESEARCH",
      nodeId: RESEARCH_ID,
      reservedComputeShare: 0.1,
    });
    expect(second.processPendingCommands()).toMatchObject([
      { accepted: true },
      { accepted: false, code: "BENCHMARK_CONFIGURATION_LOCKED" },
    ]);
  });

  test("allows cancellation followed by a same-batch configuration change", () => {
    const core = createCore();
    core.enqueue(startBenchmark(1));
    core.enqueue({ commandId: commandId(2), source: "player", kind: "CANCEL_BENCHMARK" });
    core.enqueue({
      commandId: commandId(3),
      source: "player",
      kind: "SET_OVERCLOCK_PROFILE",
      moduleInstanceIds: [MODULE_ID],
      profile: "boost",
    });
    expect(core.processPendingCommands()).toMatchObject([
      { accepted: true },
      { accepted: true },
      { accepted: true },
    ]);
    expect(core.getStateForSave().benchmarks.active).toBeNull();
    expect(core.getStateForSave().benchmarks.nextBenchmarkRunSequence).toBe(2);
    expect(core.getStateForSave().facility.modules[MODULE_ID]?.overclock.profile).toBe("boost");
  });

  test("rejects atomically without changing Benchmark state, hashes, tick, clock, or RNG", () => {
    const core = createCore();
    expect(process(core, startBenchmark(1))).toMatchObject({ accepted: true });
    const before = core.getStateForSave();
    const beforeHash = hashCanonicalState(before);
    const result = process(core, {
      commandId: commandId(2),
      source: "player",
      kind: "SET_MANUAL_OVERCLOCK",
      moduleInstanceIds: [MODULE_ID],
      frequencyRatio: 1.1,
      voltageRatio: 1.05,
    });
    expectLocked(result);
    const after = core.getStateForSave();
    expect(after).toEqual(before);
    expect(hashCanonicalState(after)).toBe(beforeHash);
    expect(after.tick).toBe(before.tick);
    expect(after.clock).toEqual(before.clock);
    expect(after.rngState).toBe(before.rngState);
  });
});

function allocateTaskCommand(sequence: number): Extract<SimCommand, { kind: "ALLOCATE_TASK" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "ALLOCATE_TASK",
    taskInstanceId: "task-instance-00000001",
    clusterModuleIds: [MODULE_ID],
    requestedShare: 0.5,
  };
}
