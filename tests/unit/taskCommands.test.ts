import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createTaskCommandHandlers } from "../../src/sim/tasks/taskCommands.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
} from "../performance/thermalFixture.ts";

const content = loadContentBundle();

function commandId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function module(
  id: string,
  definitionId: string,
  operationalState: ModuleInstanceState["operationalState"] = "online",
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    operationalState,
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function createState(): GameState {
  const state = createInitialGameState({ content, seed: "task-command-fixture" });
  state.facility.modules = {
    compute: module("compute", "module-vacuum-tube-logic"),
    memory: module("memory", "module-accumulator-register"),
  };
  return state;
}

function createCore(state = createState()): SimCore {
  return new SimCore({ initialState: state, commandHandlers: createTaskCommandHandlers(content) });
}

function process(
  core: SimCore,
  sequence: number,
  command: Readonly<Record<string, unknown>> & { readonly kind: SimCommand["kind"] },
) {
  core.enqueue({ ...command, commandId: commandId(sequence), source: "player" } as SimCommand);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected command result.");
  return result;
}

function accept(core: SimCore, sequence: number, definitionId: string): string {
  expect(process(core, sequence, { kind: "ACCEPT_TASK", definitionId })).toMatchObject({
    accepted: true,
  });
  return `task-instance-${String(sequence).padStart(8, "0")}`;
}

describe("Task command handlers", () => {
  test("accepts an offered Task with deterministic initialized lifecycle state", () => {
    const core = new SimCore({
      initialState: createInitialGameState({ content, seed: "task-command-accept" }),
      commandHandlers: createTaskCommandHandlers(content),
    });

    core.enqueue({
      commandId: "00000000-0000-4000-8000-000000000001",
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: "task-ballistic-table-verification",
    });

    expect(core.processPendingCommands()).toEqual([
      {
        commandId: "00000000-0000-4000-8000-000000000001",
        accepted: true,
        appliedAtTick: 0,
      },
    ]);
    expect(core.getStateForSave().tasks).toMatchObject({
      nextTaskInstanceSequence: 2,
      offers: ["task-census-tabulation-service"],
      instances: {
        "task-instance-00000001": {
          id: "task-instance-00000001",
          definitionId: "task-ballistic-table-verification",
          status: "accepted",
          acceptedAtTick: 0,
          deadlineTick: 2_100,
          currentPhaseIndex: 0,
          phaseCompletedOperations: 0,
          totalCompletedOperations: 0,
          allocation: null,
          accruedPayoutUsd: 0,
          serviceWindowCompliant: null,
        },
      },
    });
  });

  test.each([
    { name: "unknown definition", definitionId: "task-missing", code: "TASK_REQUIREMENT_MISSING" },
    {
      name: "not offered definition",
      definitionId: "task-wiring-layout-study",
      code: "TASK_REQUIREMENT_MISSING",
    },
  ])("rejects acceptance for $name atomically", ({ definitionId, code }) => {
    const core = createCore();
    const before = hashCanonicalState(core.getStateForSave());

    expect(process(core, 2, { kind: "ACCEPT_TASK", definitionId })).toMatchObject({
      accepted: false,
      code,
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("rejects offer-year, prerequisite, existing-instance, and slot-capacity acceptance failures", () => {
    const early = createState();
    early.campaign.currentYear = 1945;
    const earlyCore = createCore(early);
    expect(
      process(earlyCore, 3, {
        kind: "ACCEPT_TASK",
        definitionId: "task-ballistic-table-verification",
      }),
    ).toMatchObject({ code: "TASK_REQUIREMENT_MISSING", parameters: { reason: "offer-year" } });

    const prerequisite = createState();
    prerequisite.tasks.offers = ["task-wiring-layout-study"];
    const prerequisiteCore = createCore(prerequisite);
    expect(
      process(prerequisiteCore, 4, {
        kind: "ACCEPT_TASK",
        definitionId: "task-wiring-layout-study",
      }),
    ).toMatchObject({
      code: "TASK_REQUIREMENT_MISSING",
      parameters: { reason: "research-prerequisite" },
    });

    const core = createCore();
    accept(core, 5, "task-ballistic-table-verification");
    expect(
      process(core, 6, { kind: "ACCEPT_TASK", definitionId: "task-ballistic-table-verification" }),
    ).toMatchObject({
      code: "TASK_REQUIREMENT_MISSING",
      parameters: { reason: "existing-instance" },
    });
    accept(core, 7, "task-census-tabulation-service");
    const state = core.getStateForSave();
    state.tasks.offers = ["task-wiring-layout-study"];
    state.research.statuses["research-stable-power-distribution"] = "completed";
    core.replaceState(state);
    expect(
      process(core, 8, { kind: "ACCEPT_TASK", definitionId: "task-wiring-layout-study" }),
    ).toMatchObject({ code: "TASK_SLOT_LIMIT" });
  });

  test("allocates sorted support and Compute modules, activates accepted tasks, and accepts exact no-ops", () => {
    const core = createCore();
    const id = accept(core, 1, "task-ballistic-table-verification");
    expect(
      process(core, 2, {
        kind: "ALLOCATE_TASK",
        taskInstanceId: id,
        clusterModuleIds: ["memory", "compute"],
        requestedShare: 1,
      }),
    ).toMatchObject({ accepted: true });
    const allocated = core.getStateForSave().tasks.instances[id];
    expect(allocated).toMatchObject({
      status: "active",
      allocation: {
        clusterModuleIds: ["compute", "memory"],
        requestedShare: 1,
        deliveredUsefulComputeFlops: 0,
      },
    });
    const before = hashCanonicalState(core.getStateForSave());
    expect(
      process(core, 3, {
        kind: "ALLOCATE_TASK",
        taskInstanceId: id,
        clusterModuleIds: ["compute", "memory"],
        requestedShare: 1,
      }),
    ).toMatchObject({ accepted: true });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test.each([
    {
      name: "unknown task",
      taskInstanceId: "missing",
      clusterModuleIds: ["compute"],
      requestedShare: 1,
      code: "TASK_NOT_ACTIVE",
    },
    {
      name: "empty cluster",
      taskInstanceId: "task-instance-00000001",
      clusterModuleIds: [],
      requestedShare: 1,
      code: "TASK_REQUIREMENT_MISSING",
    },
    {
      name: "duplicate module",
      taskInstanceId: "task-instance-00000001",
      clusterModuleIds: ["compute", "compute"],
      requestedShare: 1,
      code: "TASK_REQUIREMENT_MISSING",
    },
    {
      name: "missing module",
      taskInstanceId: "task-instance-00000001",
      clusterModuleIds: ["missing"],
      requestedShare: 1,
      code: "TASK_REQUIREMENT_MISSING",
    },
    {
      name: "no Compute module",
      taskInstanceId: "task-instance-00000001",
      clusterModuleIds: ["memory"],
      requestedShare: 1,
      code: "TASK_REQUIREMENT_MISSING",
    },
    {
      name: "invalid share",
      taskInstanceId: "task-instance-00000001",
      clusterModuleIds: ["compute"],
      requestedShare: 0,
      code: "TASK_REQUIREMENT_MISSING",
    },
  ])(
    "rejects allocation $name atomically",
    ({ taskInstanceId, clusterModuleIds, requestedShare, code }) => {
      const core = createCore();
      accept(core, 1, "task-ballistic-table-verification");
      const before = hashCanonicalState(core.getStateForSave());
      expect(
        process(core, 2, {
          kind: "ALLOCATE_TASK",
          taskInstanceId,
          clusterModuleIds,
          requestedShare,
        }),
      ).toMatchObject({ accepted: false, code });
      expect(hashCanonicalState(core.getStateForSave())).toBe(before);
    },
  );

  test("enforces active shares, excludes the task being reallocated, and releases held share", () => {
    const core = createCore();
    const first = accept(core, 1, "task-ballistic-table-verification");
    const second = accept(core, 2, "task-census-tabulation-service");
    process(core, 3, {
      kind: "ALLOCATE_TASK",
      taskInstanceId: first,
      clusterModuleIds: ["compute"],
      requestedShare: 0.5,
    });
    process(core, 4, {
      kind: "ALLOCATE_TASK",
      taskInstanceId: second,
      clusterModuleIds: ["compute"],
      requestedShare: 0.5,
    });
    expect(
      process(core, 5, {
        kind: "ALLOCATE_TASK",
        taskInstanceId: first,
        clusterModuleIds: ["compute"],
        requestedShare: 0.75,
      }),
    ).toMatchObject({ code: "TASK_REQUIREMENT_MISSING", parameters: { reason: "share-capacity" } });
    process(core, 6, { kind: "SET_TASK_HOLD", taskInstanceId: first, hold: true });
    expect(
      process(core, 7, {
        kind: "ALLOCATE_TASK",
        taskInstanceId: first,
        clusterModuleIds: ["compute"],
        requestedShare: 1,
      }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, 8, { kind: "SET_TASK_HOLD", taskInstanceId: first, hold: false }),
    ).toMatchObject({ code: "TASK_REQUIREMENT_MISSING" });
  });

  test("rejects accepted-to-active allocation overcommit as a recoverable atomic failure", () => {
    const core = createCore();
    const first = accept(core, 1, "task-ballistic-table-verification");
    const second = accept(core, 2, "task-census-tabulation-service");
    process(core, 3, {
      kind: "ALLOCATE_TASK",
      taskInstanceId: first,
      clusterModuleIds: ["compute"],
      requestedShare: 0.75,
    });
    const before = hashCanonicalState(core.getStateForSave());

    expect(
      process(core, 4, {
        kind: "ALLOCATE_TASK",
        taskInstanceId: second,
        clusterModuleIds: ["compute"],
        requestedShare: 0.5,
      }),
    ).toMatchObject({
      accepted: false,
      code: "TASK_REQUIREMENT_MISSING",
      parameters: { reason: "share-capacity" },
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("allows offline clusters, provides idempotent hold changes, and retains allocation on abandonment", () => {
    const state = createState();
    state.facility.modules["compute"] = module("compute", "module-vacuum-tube-logic", "offline");
    const core = createCore(state);
    const id = accept(core, 1, "task-ballistic-table-verification");
    process(core, 2, {
      kind: "ALLOCATE_TASK",
      taskInstanceId: id,
      clusterModuleIds: ["compute"],
      requestedShare: 1,
    });
    expect(
      process(core, 3, { kind: "SET_TASK_HOLD", taskInstanceId: id, hold: true }),
    ).toMatchObject({ accepted: true });
    const held = hashCanonicalState(core.getStateForSave());
    expect(
      process(core, 4, { kind: "SET_TASK_HOLD", taskInstanceId: id, hold: true }),
    ).toMatchObject({ accepted: true });
    expect(hashCanonicalState(core.getStateForSave())).toBe(held);
    expect(process(core, 5, { kind: "ABANDON_TASK", taskInstanceId: id })).toMatchObject({
      accepted: true,
    });
    expect(core.getStateForSave().tasks.instances[id]).toMatchObject({
      status: "abandoned",
      allocation: { deliveredUsefulComputeFlops: 0 },
    });
  });

  test.each(["accepted", "active", "hold"] as const)(
    "abandons a %s task with debt-safe microdollar accounting",
    (status) => {
      const core = createCore();
      const id = accept(core, 1, "task-ballistic-table-verification");
      if (status !== "accepted") {
        process(core, 2, {
          kind: "ALLOCATE_TASK",
          taskInstanceId: id,
          clusterModuleIds: ["compute"],
          requestedShare: 1,
        });
        if (status === "hold")
          process(core, 3, { kind: "SET_TASK_HOLD", taskInstanceId: id, hold: true });
      }
      const before = core.getStateForSave();
      expect(process(core, 4, { kind: "ABANDON_TASK", taskInstanceId: id })).toMatchObject({
        accepted: true,
      });
      const after = core.getStateForSave();
      expect(after.economy.cashUsd).toBe(before.economy.cashUsd - 900);
      expect(after.economy.totalExpenseUsd).toBe(before.economy.totalExpenseUsd + 900);
      expect(after.economy.lastTickExpenseUsd).toBe(before.economy.lastTickExpenseUsd);
      expect(after.rngState).toBe(before.rngState);
    },
  );

  test("command-only Task changes preserve tick, progress, deadline, payouts, and RNG", () => {
    const core = createCore();
    const before = core.getStateForSave();
    const id = accept(core, 1, "task-ballistic-table-verification");
    process(core, 2, {
      kind: "ALLOCATE_TASK",
      taskInstanceId: id,
      clusterModuleIds: ["compute"],
      requestedShare: 1,
    });
    const after = core.getStateForSave();
    expect(after.tick).toBe(before.tick);
    expect(after.rngState).toBe(before.rngState);
    expect(after.tasks.instances[id]).toMatchObject({
      phaseCompletedOperations: 0,
      totalCompletedOperations: 0,
      accruedPayoutUsd: 0,
      deadlineTick: 2_100,
    });
    expect(after.economy.totalIncomeUsd).toBe(before.economy.totalIncomeUsd);
  });

  test("zeros changed delivery during command-only processing and recalculates it on the next real tick", () => {
    const state = createTask9PerformanceFixture("task-command-compute-recalculation");
    const events: string[] = [];
    const core = new SimCore({
      initialState: state,
      commandHandlers: createTaskCommandHandlers(thermalPerformanceContent),
      tickSystems: {
        ...createPowerTickSystems(thermalPerformanceContent),
        ...createThermalTickSystems(thermalPerformanceContent),
        ...createOverclockTickSystems(thermalPerformanceContent),
        ...createComputeTickSystems(thermalPerformanceContent, {
          onComputeResultCacheEvent(event) {
            events.push(event);
          },
        }),
      },
    });
    core.step();
    const taskId = "task-9-serial";
    const previousTick = core.tick;
    expect(
      process(core, 1, {
        kind: "ALLOCATE_TASK",
        taskInstanceId: taskId,
        clusterModuleIds: ["thermal-003"],
        requestedShare: 0.4,
      }),
    ).toMatchObject({ accepted: true });
    expect(core.tick).toBe(previousTick);
    expect(
      core.getStateForSave().tasks.instances[taskId]?.allocation?.deliveredUsefulComputeFlops,
    ).toBe(0);

    core.step();
    expect(core.getStateForSave().facility.compute.byTask[taskId]?.requestedShare).toBe(0.4);
    expect(events).toEqual(["calculated", "calculated"]);
  });
});
