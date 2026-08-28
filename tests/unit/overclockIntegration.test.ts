import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { calculateFacilityPower } from "../../src/sim/power/facilityPower.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { assertValidStoredPowerState } from "../../src/sim/power/powerState.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import { createOverclockCommandHandlers } from "../../src/sim/overclock/overclockCommands.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";

const content = loadContentBundle();

function module(
  id: string,
  definitionId = "module-vacuum-tube-logic",
  overrides: Partial<ModuleInstanceState> = {},
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
    ...overrides,
  };
}

function stateWithModules(
  modules: Record<string, ModuleInstanceState>,
  seed = "overclock-integration",
): GameState {
  const state = createInitialGameState({ content, seed });
  state.facility.modules = modules;
  return state;
}

function commandId(sequence: number): string {
  return `88000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function profileCommand(
  sequence: number,
  moduleInstanceIds: string[],
  profile: "eco" | "balanced" | "boost",
): Extract<SimCommand, { kind: "SET_OVERCLOCK_PROFILE" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "SET_OVERCLOCK_PROFILE",
    moduleInstanceIds,
    profile,
  };
}

function manualCommand(
  sequence: number,
  moduleInstanceIds: string[],
  frequencyRatio: number,
  voltageRatio: number,
): Extract<SimCommand, { kind: "SET_MANUAL_OVERCLOCK" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "SET_MANUAL_OVERCLOCK",
    moduleInstanceIds,
    frequencyRatio,
    voltageRatio,
  };
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected command result.");
  return result;
}

describe("Task 8.4 Overclock integration", () => {
  test("registers the approved transactional command and lifecycle factories", () => {
    const content = loadContentBundle();

    expect(createOverclockCommandHandlers(content)).toHaveProperty("SET_OVERCLOCK_PROFILE");
    expect(createOverclockTickSystems(content)).toHaveProperty(
      "apply-throttling-stability-and-shutdown",
    );
  });

  test("applies exact Manual settings atomically and dirties only the Overclock result", () => {
    const first = module("first");
    const second = module("second", "module-arithmetic-unit", { position: { x: 1, y: 0 } });
    const core = new SimCore({
      initialState: stateWithModules({ second, first }),
      commandHandlers: createOverclockCommandHandlers(content),
    });
    const before = core.getStateForSave();

    expect(
      process(core, manualCommand(1, ["second", "first"], 1.1234567, 1.0987654)),
    ).toMatchObject({
      accepted: true,
    });

    const after = core.getStateForSave();
    expect(after.facility.modules["first"]?.overclock).toEqual({
      profile: "manual",
      frequencyRatio: 1.1234567,
      voltageRatio: 1.0987654,
    });
    expect(after.facility.modules["second"]?.overclock).toEqual(
      after.facility.modules["first"]?.overclock,
    );
    expect(after.facility.power).toEqual(before.facility.power);
    expect(after.facility.thermalTiles).toEqual(before.facility.thermalTiles);
    expect(after.facility.thermalRevision).toBe(before.facility.thermalRevision);
    expect(after.facility.overclock).toEqual({
      layoutRevision: null,
      thermalRevision: null,
      byModule: {},
    });
    expect(after.rngState).toBe(before.rngState);
  });

  test("applies every preset and inclusive Manual boundary in every operational state", () => {
    const modules = Object.fromEntries(
      (["offline", "starting", "online", "brownout", "shutdown"] as const).map(
        (operationalState, index) => [
          operationalState,
          module(operationalState, "module-vacuum-tube-logic", {
            position: { x: index, y: 0 },
            operationalState,
            startupTicksRemaining: operationalState === "starting" ? 3 : 0,
            cooldownTicksRemaining: operationalState === "shutdown" ? 7 : 0,
          }),
        ],
      ),
    );
    const core = new SimCore({
      initialState: stateWithModules(modules, "overclock-command-boundaries"),
      commandHandlers: createOverclockCommandHandlers(content),
    });
    const targetIds = Object.keys(modules).toSorted();
    const initialRngState = core.getStateForSave().rngState;

    for (const [sequence, profile, expected] of [
      [20, "eco", { profile: "eco", frequencyRatio: 0.8, voltageRatio: 0.9 }],
      [21, "balanced", { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 }],
      [22, "boost", { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 }],
    ] as const) {
      expect(process(core, profileCommand(sequence, targetIds, profile))).toMatchObject({
        accepted: true,
      });
      for (const targetId of targetIds) {
        expect(core.getStateForSave().facility.modules[targetId]?.overclock).toEqual(expected);
      }
    }

    const { manual } = content.balancing.overclock;
    for (const [sequence, frequencyRatio, voltageRatio] of [
      [23, manual.frequencyRatioMin, manual.voltageRatioMin],
      [24, manual.frequencyRatioMax, manual.voltageRatioMax],
    ] as const) {
      expect(
        process(core, manualCommand(sequence, targetIds, frequencyRatio, voltageRatio)),
      ).toMatchObject({ accepted: true });
      for (const targetId of targetIds) {
        expect(core.getStateForSave().facility.modules[targetId]?.overclock).toEqual({
          profile: "manual",
          frequencyRatio,
          voltageRatio,
        });
      }
    }

    const final = core.getStateForSave();
    for (const operationalState of [
      "offline",
      "starting",
      "online",
      "brownout",
      "shutdown",
    ] as const) {
      expect(final.facility.modules[operationalState]?.operationalState).toBe(operationalState);
    }
    expect(final.rngState).toBe(initialRngState);
  });

  test("rejects invalid, unknown, unsupported, and Design Mode targets without partial mutation", () => {
    const eligible = module("eligible");
    const unsupported = module("unsupported", "module-data-relay", { position: { x: 1, y: 0 } });
    const core = new SimCore({
      initialState: stateWithModules({ eligible, unsupported }),
      commandHandlers: createOverclockCommandHandlers(content),
    });
    const before = core.getStateForSave();

    expect(process(core, profileCommand(2, [], "boost"))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(process(core, profileCommand(3, ["eligible", "eligible"], "boost"))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(process(core, profileCommand(4, ["eligible", "missing"], "boost"))).toMatchObject({
      accepted: false,
      code: "OVERCLOCK_TARGET_INVALID",
    });
    expect(process(core, profileCommand(5, ["eligible", "unsupported"], "boost"))).toMatchObject({
      accepted: false,
      code: "OVERCLOCK_UNSUPPORTED",
    });
    expect(process(core, manualCommand(51, ["eligible"], 1.41, 1.1))).toMatchObject({
      accepted: false,
      code: "OVERCLOCK_OUT_OF_RANGE",
    });
    expect(core.getStateForSave()).toEqual(before);

    const inDesignMode = core.getStateForSave();
    inDesignMode.facility.designDraft = {
      revision: 0,
      modules: structuredClone(inDesignMode.facility.modules),
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    core.replaceState(inDesignMode);
    expect(process(core, profileCommand(6, ["eligible"], "boost"))).toMatchObject({
      accepted: false,
      code: "OVERCLOCK_UNAVAILABLE_IN_DESIGN_MODE",
    });
  });

  test("keeps exact no-ops stable and applies same-tick accepted commands in FIFO order", () => {
    const core = new SimCore({
      initialState: stateWithModules({ eligible: module("eligible") }),
      commandHandlers: createOverclockCommandHandlers(content),
    });
    const before = core.getStateForSave();

    expect(process(core, profileCommand(7, ["eligible"], "balanced"))).toMatchObject({
      accepted: true,
    });
    expect(core.getStateForSave()).toEqual(before);

    core.enqueue(manualCommand(8, ["eligible"], 1.2, 1.1));
    core.enqueue(profileCommand(9, ["eligible"], "eco"));
    expect(core.processPendingCommands()).toEqual([
      { commandId: commandId(8), accepted: true, appliedAtTick: 0 },
      { commandId: commandId(9), accepted: true, appliedAtTick: 0 },
    ]);
    expect(core.getStateForSave().facility.modules["eligible"]?.overclock).toEqual({
      profile: "eco",
      frequencyRatio: 0.8,
      voltageRatio: 0.9,
    });
  });

  test("preserves retained settings, keeps new modules Balanced, and dirties Overclock on Design Apply", () => {
    const retained = module("retained", "module-vacuum-tube-logic", {
      overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
    });
    const state = stateWithModules({ retained }, "overclock-design-apply");
    state.inventory.stacks["module-data-relay"] = {
      definitionId: "module-data-relay",
      quantity: 1,
      averageAcquisitionCostUsd: 1,
    };
    const core = new SimCore({
      initialState: state,
      commandHandlers: {
        ...createDesignModeCommandHandlers(content),
        ...createOverclockCommandHandlers(content),
      },
      tickSystems: createOverclockTickSystems(content),
    });
    core.step();
    expect(core.getStateForSave().facility.overclock.layoutRevision).toBe(0);

    expect(
      process(core, { commandId: commandId(10), source: "player", kind: "ENTER_DESIGN_MODE" }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, {
        commandId: commandId(11),
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: "module-data-relay",
        position: { x: 2, y: 0 },
        rotation: 0,
      }),
    ).toMatchObject({ accepted: true });
    const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
    if (preview.status !== "ready") throw new Error("Expected a ready Design Apply preview.");
    expect(
      process(core, {
        commandId: commandId(12),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.draftRevision,
        acceptedCostUsd: preview.netCostUsd,
        acceptedDowntimeTicks: preview.downtimeTicks,
      }),
    ).toMatchObject({ accepted: true });

    const after = core.getStateForSave();
    expect(after.facility.modules["retained"]?.overclock).toEqual({
      profile: "boost",
      frequencyRatio: 1.25,
      voltageRatio: 1.1,
    });
    const added = Object.values(after.facility.modules).find(
      (candidate) => candidate.definitionId === "module-data-relay",
    );
    expect(added?.overclock).toEqual({ profile: "balanced", frequencyRatio: 1, voltageRatio: 1 });
    expect(after.facility.overclock).toEqual({
      layoutRevision: null,
      thermalRevision: null,
      byModule: {},
    });
  });

  test("runs the lifecycle only on real ticks and commits current-temperature shutdown after Power history", () => {
    const hot = module("hot");
    const state = stateWithModules({ hot }, "overclock-shutdown");
    const definition = content.modules[hot.definitionId];
    if (definition === undefined) throw new Error("Missing Overclock fixture definition.");
    state.facility.thermalTiles[0] = {
      position: { x: 0, y: 0 },
      temperatureC: definition.thermal.shutdownC,
    };
    const powerBefore = structuredClone(state.facility.power);
    const core = new SimCore({
      initialState: state,
      tickSystems: createOverclockTickSystems(content),
    });

    expect(core.step(0).ticksExecuted).toBe(0);
    expect(core.getStateForSave().facility.modules["hot"]?.operationalState).toBe("online");
    core.step();

    const after = core.getStateForSave();
    expect(after.facility.modules["hot"]).toMatchObject({
      operationalState: "shutdown",
      cooldownTicksRemaining: definition.cooldownTicks,
    });
    expect(after.facility.overclock.byModule["hot"]).toMatchObject({
      sampledTemperatureC: definition.thermal.shutdownC,
      thermalFactor: 0,
      stabilityFactor: 0,
      shutdownReason: "thermal",
    });
    expect(after.facility.power).toEqual(powerBefore);
  });

  test("keeps shutdown-crossing Power history and makes Power demand zero on the following production tick", () => {
    const logic = module("logic");
    const state = stateWithModules({ logic }, "overclock-production-boundary");
    const definition = content.modules[logic.definitionId];
    if (definition === undefined)
      throw new Error("Missing production-boundary fixture definition.");
    state.facility.thermalTiles[0] = {
      position: { x: 0, y: 0 },
      temperatureC: 200,
    };
    const tickSystems = {
      ...createPowerTickSystems(content),
      ...createThermalTickSystems(content),
      ...createOverclockTickSystems(content),
    };
    const core = new SimCore({ initialState: state, tickSystems });

    core.step();
    const crossing = core.getStateForSave();
    expect(crossing.facility.modules["logic"]?.operationalState).toBe("shutdown");
    expect(crossing.facility.power.byModule["logic"]?.requestedPowerWatts).toBeGreaterThan(0);
    expect(() => new SimCore({ initialState: crossing, tickSystems })).not.toThrow();

    core.step();
    expect(core.getStateForSave().facility.power.byModule["logic"]).toMatchObject({
      requestedPowerWatts: 0,
      minimumPowerWatts: 0,
      deliveredPowerWatts: 0,
      limitingReason: "shutdown",
    });
  });

  test("recovers a safe shutdown module to offline with full startup and clears its reason", () => {
    const shutdown = module("shutdown", "module-control-unit", {
      operationalState: "shutdown",
      cooldownTicksRemaining: 1,
      startupTicksRemaining: 0,
    });
    const state = stateWithModules({ shutdown }, "overclock-recovery");
    const definition = content.modules[shutdown.definitionId];
    if (definition === undefined) throw new Error("Missing recovery fixture definition.");
    state.facility.thermalTiles[0] = {
      position: { x: 0, y: 0 },
      temperatureC: definition.thermal.warningMaxC,
    };
    const core = new SimCore({
      initialState: state,
      tickSystems: createOverclockTickSystems(content),
    });

    core.step();

    expect(core.getStateForSave().facility.modules["shutdown"]).toMatchObject({
      operationalState: "offline",
      cooldownTicksRemaining: 0,
      startupTicksRemaining: definition.startupTicks,
    });
    expect(
      core.getStateForSave().facility.overclock.byModule["shutdown"]?.shutdownReason,
    ).toBeNull();
  });

  test("accepts structurally valid historical Power after a later thermal shutdown", () => {
    const source = module("source", "module-power-distribution");
    const calculationInput = stateWithModules({ source }, "overclock-power-history");
    const result = calculateFacilityPower(calculationInput, content);
    const historical = structuredClone(calculationInput);
    historical.facility.modules = {
      ...result.modules,
      source: {
        ...(result.modules["source"] ?? source),
        operationalState: "shutdown",
        cooldownTicksRemaining: 1,
      },
    };
    historical.facility.power = result.power;

    expect(() => {
      assertValidStoredPowerState(historical, content);
    }).not.toThrow();
  });

  test("uses only a private topology cache and recalculates a complete result each real tick", () => {
    const events: string[] = [];
    const state = stateWithModules({ eligible: module("eligible") }, "overclock-cache");
    const systems = createOverclockTickSystems(content, {
      onTopologyCacheEvent: (event) => {
        events.push(event);
      },
    });
    const registration = systems["apply-throttling-stability-and-shutdown"];
    if (registration === undefined || typeof registration === "function") {
      throw new Error("Expected an Overclock runtime factory.");
    }
    const runtime = registration.createRuntime();
    if (runtime.executionMode !== "structural-sharing")
      throw new Error("Expected structural sharing.");
    const rng = createSeededRngFromState(state.rngState);

    const first = runtime.run({ state, rng });
    const second = runtime.run({ state: first, rng });

    expect(events).toEqual(["rebuild", "hit"]);
    expect(second.facility.overclock).not.toBe(first.facility.overclock);
    expect(second.rngState).toBe(state.rngState);
    expect(JSON.parse(JSON.stringify(second))).toEqual(second);
    expect(Object.hasOwn(second.facility, "overclockRuntime")).toBe(false);
  });

  test("rolls back lifecycle and Overclock output when a later production stage fails", () => {
    const hot = module("hot");
    const state = stateWithModules({ hot }, "overclock-stage-rollback");
    const definition = content.modules[hot.definitionId];
    if (definition === undefined) throw new Error("Missing rollback fixture definition.");
    state.facility.thermalTiles[0] = {
      position: { x: 0, y: 0 },
      temperatureC: definition.thermal.shutdownC,
    };
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        ...createOverclockTickSystems(content),
        "calculate-theoretical-and-useful-compute": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run() {
                throw new Error("forced downstream failure");
              },
            };
          },
        },
      },
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(
      expect.objectContaining({ stage: "calculate-theoretical-and-useful-compute", tick: 0 }),
    );

    expect(core.getStateForSave()).toEqual(before);
  });
});
