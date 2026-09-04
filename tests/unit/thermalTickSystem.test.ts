import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type {
  GameState,
  ModuleInstanceState,
  ModulePowerDeliveryState,
  ThermalTileState,
} from "../../src/sim/core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../../src/sim/core/tickSystems.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { calculateEnergyCostUsd } from "../../src/sim/economy/money.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";

const content = loadContentBundle();

function withoutCompute(state: GameState): object {
  const facility = Object.fromEntries(
    Object.entries(state.facility).filter(([key]) => key !== "compute"),
  );
  const campaign = Object.fromEntries(
    Object.entries(state.campaign).filter(([key]) => key !== "reputation"),
  );
  const tasks = Object.fromEntries(
    Object.entries(state.tasks).filter(([key]) => key !== "nextTaskInstanceSequence"),
  );
  return { ...state, campaign, tasks, facility };
}

function module(
  id: string,
  definitionId = "module-data-relay",
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

function delivery(
  id: string,
  deliveredPowerWatts: number,
  minimumPowerWatts = 0,
): ModulePowerDeliveryState {
  return {
    moduleInstanceId: id,
    requestedPowerWatts: deliveredPowerWatts,
    minimumPowerWatts,
    deliveredPowerWatts,
    powerFactor: 1,
    limitingReason: "none",
  };
}

function cleanPower(state: GameState, deliveries: readonly ModulePowerDeliveryState[] = []): void {
  const totalDeliveredPowerWatts = deliveries.reduce(
    (total, item) => total + item.deliveredPowerWatts,
    0,
  );
  state.facility.power = {
    layoutRevision: state.facility.liveLayoutRevision,
    totalRequestedPowerWatts: deliveries.reduce(
      (total, item) => total + item.requestedPowerWatts,
      0,
    ),
    totalDeliveredPowerWatts,
    headroomWatts: state.facility.contractedPowerWatts - totalDeliveredPowerWatts,
    energyCostUsdThisTick: calculateEnergyCostUsd(
      totalDeliveredPowerWatts,
      0.1,
      state.economy.energyPriceUsdPerKwh,
    ),
    byModule: Object.fromEntries(deliveries.map((item) => [item.moduleInstanceId, item])),
    byRoute: {},
  };
}

function thermalTiles(state: GameState): readonly ThermalTileState[] {
  return state.facility.thermalTiles;
}

function basicState(seed = "thermal-tick"): GameState {
  const state = createInitialGameState({ content, seed });
  cleanPower(state);
  return state;
}

function thermalCore(
  state = basicState(),
  options: Parameters<typeof createThermalTickSystems>[1] = {},
  extraSystems: TickSystemRegistry = {},
  commandHandlers = {},
): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers,
    tickSystems: { ...extraSystems, ...createThermalTickSystems(content, options) },
  });
}

function powerThermalCore(
  state: GameState,
  options: Parameters<typeof createThermalTickSystems>[1] = {},
  commandHandlers = {},
): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers,
    tickSystems: {
      ...createPowerTickSystems(content),
      ...createThermalTickSystems(content, options),
    },
  });
}

function commandId(sequence: number): string {
  return `77000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected command result.");
  return result;
}

describe("thermal production stages", () => {
  test("runs heat generation before thermal update in the fixed stage order", () => {
    const stages: string[] = [];
    const core = thermalCore(basicState(), { onStageEvent: (stage) => stages.push(stage) });

    core.step();

    expect(stages).toEqual(["calculate-heat-generation", "update-thermal-state"]);
  });

  test("reuses only unchanged validated Power inputs on warm thermal ticks", () => {
    const validationEvents: string[] = [];
    const core = thermalCore(basicState(), {
      onPowerValidationCacheEvent: (event) => validationEvents.push(event),
    });

    core.step();
    core.step();

    expect(validationEvents).toEqual(["validated", "hit"]);
  });

  test("revalidates a changed Power identity instead of using the warm cache", () => {
    let workloadRuns = 0;
    const core = thermalCore(
      basicState(),
      {},
      {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                workloadRuns += 1;
                if (workloadRuns === 1) return state;
                return {
                  ...state,
                  facility: {
                    ...state.facility,
                    power: { ...state.facility.power, totalRequestedPowerWatts: 1 },
                  },
                };
              },
            };
          },
        },
      },
    );

    core.step();

    expect(() => core.step()).toThrow(
      expect.objectContaining({ stage: "calculate-heat-generation", tick: 1 }),
    );
  });

  test("revalidates changed Overclock module inputs instead of using the warm cache", () => {
    const validationEvents: string[] = [];
    let workloadRuns = 0;
    const state = basicState("thermal-overclock-cache");
    const logic = module("logic", "module-vacuum-tube-logic");
    state.facility.modules = { logic };
    cleanPower(state, [delivery(logic.id, 0)]);
    const core = thermalCore(
      state,
      { onPowerValidationCacheEvent: (event) => validationEvents.push(event) },
      {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                workloadRuns += 1;
                if (workloadRuns !== 2) return candidate;
                const current = candidate.facility.modules["logic"];
                if (current === undefined) throw new Error("Missing thermal Overclock fixture.");
                return {
                  ...candidate,
                  facility: {
                    ...candidate.facility,
                    modules: {
                      ...candidate.facility.modules,
                      logic: {
                        ...current,
                        overclock: {
                          profile: "boost" as const,
                          frequencyRatio: 1.25,
                          voltageRatio: 1.1,
                        },
                      },
                    },
                  },
                };
              },
            };
          },
        },
      },
    );

    core.step();
    core.step();

    expect(validationEvents).toEqual(["validated", "validated"]);
    expect(core.getStateForSave().rngState).toBe(state.rngState);
  });

  test("uses current-tick Power without a workload stage", () => {
    const state = createInitialGameState({ content, seed: "thermal-current-power" });
    const source = module("source", "module-power-distribution", {
      operationalState: "offline",
      startupTicksRemaining: 0,
    });
    state.facility.modules = { source };
    const core = powerThermalCore(state);

    core.step();

    const result = core.getStateForSave();
    expect(result.facility.power.byModule["source"]?.deliveredPowerWatts).toBeGreaterThan(0);
    expect(result.facility.modules["source"]?.operationalState).toBe("online");
    expect(result.facility.thermalTiles.some((tile) => tile.temperatureC > 22)).toBe(true);
  });

  test("reuses warm topology and rebuilds lazily after replacement", () => {
    const events: string[] = [];
    const core = thermalCore(basicState(), { onTopologyCacheEvent: (event) => events.push(event) });

    core.step();
    core.step();
    const replacement = core.getStateForSave();
    core.replaceState(replacement);
    core.step();

    expect(events.filter((event) => event === "rebuild")).toHaveLength(2);
    expect(events.filter((event) => event === "hit")).toHaveLength(1);
  });

  test("does not run thermal work for draft commands, command-only processing, or step(0)", () => {
    const events: string[] = [];
    const state = basicState();
    state.inventory.stacks["module-data-relay"] = {
      definitionId: "module-data-relay",
      quantity: 1,
      averageAcquisitionCostUsd: 1,
    };
    const core = thermalCore(
      state,
      { onTopologyCacheEvent: (event) => events.push(event) },
      {},
      createDesignModeCommandHandlers(content),
    );
    core.step();
    const afterWarm = [...events];

    expect(
      process(core, { commandId: commandId(1), source: "player", kind: "ENTER_DESIGN_MODE" }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, {
        commandId: commandId(2),
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: "module-data-relay",
        position: { x: 0, y: 0 },
        rotation: 0,
      }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, { commandId: commandId(3), source: "player", kind: "UNDO_DESIGN" }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, { commandId: commandId(4), source: "player", kind: "REDO_DESIGN" }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, { commandId: commandId(5), source: "player", kind: "CANCEL_DESIGN" }),
    ).toMatchObject({ accepted: true });
    expect(core.step(0).ticksExecuted).toBe(0);

    expect(events).toEqual(afterWarm);
  });

  test("preserves temperatures across Apply and rebuilds topology on the following real tick", () => {
    const state = basicState("thermal-apply");
    const removed = module("removed", "module-data-relay", { position: { x: 0, y: 0 } });
    const added = module("added", "module-data-relay", { position: { x: 3, y: 0 } });
    state.facility.modules = { removed };
    state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
    state.facility.designDraft = {
      revision: 1,
      modules: { added },
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    state.economy.cashUsd = 500;
    const events: string[] = [];
    const core = powerThermalCore(
      state,
      { onTopologyCacheEvent: (event) => events.push(event) },
      createDesignModeCommandHandlers(content),
    );
    core.step();
    const beforeApply = core.getStateForSave();
    const preview = calculateDesignApplyPreview(beforeApply, content);
    if (preview.status !== "ready") throw new Error("Expected ready Design Apply preview.");

    expect(
      process(core, {
        commandId: commandId(5),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.draftRevision,
        acceptedCostUsd: preview.netCostUsd,
        acceptedDowntimeTicks: preview.downtimeTicks,
      }),
    ).toMatchObject({ accepted: true });
    expect(thermalTiles(core.getStateForSave())).toEqual(thermalTiles(beforeApply));
    const eventsBeforeTick = [...events];

    core.step();

    expect(events.slice(eventsBeforeTick.length)).toContain("rebuild");
  });

  test("rejects missing and stale pending generation before state mutation", () => {
    const state = basicState("thermal-pending");
    const systems = createThermalTickSystems(content);
    const generationRegistration = systems["calculate-heat-generation"];
    const updateRegistration = systems["update-thermal-state"];
    if (
      generationRegistration === undefined ||
      updateRegistration === undefined ||
      typeof generationRegistration === "function" ||
      typeof updateRegistration === "function"
    ) {
      throw new Error("Expected both thermal runtime factories.");
    }
    const generate = generationRegistration.createRuntime();
    const update = updateRegistration.createRuntime();
    const rng = createSeededRngFromState(state.rngState);

    if (
      update.executionMode !== "structural-sharing" ||
      generate.executionMode !== "structural-sharing"
    ) {
      throw new Error("Expected structural-sharing thermal runtimes.");
    }
    expect(() => update.run({ state, rng })).toThrow();
    generate.run({ state, rng });
    const stale = { ...state, facility: { ...state.facility, liveLayoutRevision: 1 } };
    expect(() => update.run({ state: stale, rng })).toThrow();
  });

  test("rolls back Power and thermal branches when stage one rejects invalid state", () => {
    const state = createInitialGameState({ content, seed: "thermal-stage-one-rollback" });
    const source = module("source", "module-power-distribution");
    state.facility.modules = { source };
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        ...createPowerTickSystems(content),
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                return {
                  ...candidate,
                  facility: { ...candidate.facility, ambientTemperatureC: Number.NaN },
                };
              },
            };
          },
        },
        ...createThermalTickSystems(content),
      },
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(
      expect.objectContaining({ stage: "calculate-heat-generation", tick: 0 }),
    );
    expect(core.getStateForSave()).toEqual(before);
  });

  test("rejects revision-matching malformed Power before thermal generation", () => {
    const state = basicState("thermal-invalid-power-rollback");
    state.facility.modules = { source: module("source", "module-power-distribution") };
    cleanPower(state, [delivery("source", 240, 90)]);
    const power = state.facility.power.byModule["source"];
    if (power === undefined) throw new Error("Expected source Power delivery.");
    state.facility.power.byModule["source"] = { ...power, requestedPowerWatts: 1 };
    const core = thermalCore(state);
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(
      expect.objectContaining({ stage: "calculate-heat-generation", tick: 0 }),
    );
    expect(core.getStateForSave()).toEqual(before);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rolls back thermal stage two invalid numeric balancing %s",
    (coefficient) => {
      const invalidContent: ContentBundle = {
        ...content,
        balancing: {
          ...content.balancing,
          thermal: { ...content.balancing.thermal, heatToTemperatureCoefficient: coefficient },
        },
      };
      const state = basicState("thermal-stage-two-rollback");
      state.facility.modules = { source: module("source", "module-power-distribution") };
      cleanPower(state, [delivery("source", 240, 90)]);
      const core = new SimCore({
        initialState: state,
        tickSystems: createThermalTickSystems(invalidContent),
      });
      const before = core.getStateForSave();

      expect(() => core.step()).toThrow(
        expect.objectContaining({ stage: "update-thermal-state", tick: 0 }),
      );
      expect(core.getStateForSave()).toEqual(before);
    },
  );

  test("increments revision for exact sub-epsilon change and shares unchanged thermal tiles", () => {
    const state = basicState("thermal-revision");
    state.facility.modules = { source: module("source", "module-power-distribution") };
    state.facility.extractionCapacityWatts = 1_000;
    cleanPower(state, [delivery("source", 240, 90)]);
    let beforeTiles: readonly ThermalTileState[] | undefined;
    let afterTiles: readonly ThermalTileState[] | undefined;
    let beforeEconomy: GameState["economy"] | undefined;
    let afterEconomy: GameState["economy"] | undefined;
    const core = thermalCore(
      state,
      {},
      {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                beforeTiles = candidate.facility.thermalTiles;
                beforeEconomy = candidate.economy;
                return candidate;
              },
            };
          },
        },
        "calculate-theoretical-and-useful-compute": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                afterTiles = candidate.facility.thermalTiles;
                afterEconomy = candidate.economy;
                return candidate;
              },
            };
          },
        },
      },
    );

    core.step();
    const once = core.getStateForSave();
    const firstBeforeTiles = beforeTiles;
    const firstAfterTiles = afterTiles;
    core.step();
    const twice = core.getStateForSave();

    expect(once.facility.thermalRevision).toBe(1);
    expect(twice.facility.thermalRevision).toBe(2);
    expect(once.facility.thermalTiles[0]?.temperatureC).toBeGreaterThan(22);
    expect(once.facility.thermalTiles[0]?.temperatureC).toBeLessThan(22.05);
    expect(firstAfterTiles).not.toBe(firstBeforeTiles);
    expect(firstAfterTiles?.[10]).toBe(firstBeforeTiles?.[10]);
    expect(firstAfterTiles?.[0]?.position).toBe(firstBeforeTiles?.[0]?.position);
    expect(afterEconomy).toBe(beforeEconomy);
  });

  test("preserves no-change thermal identities, never consumes RNG, and freezes retained results", () => {
    let beforeTiles: readonly ThermalTileState[] | undefined;
    let afterTiles: readonly ThermalTileState[] | undefined;
    let retainedState: GameState | undefined;
    const state = basicState("thermal-no-change");
    const initialRng = state.rngState;
    const core = thermalCore(
      state,
      {},
      {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                beforeTiles = candidate.facility.thermalTiles;
                return candidate;
              },
            };
          },
        },
        "calculate-theoretical-and-useful-compute": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                afterTiles = candidate.facility.thermalTiles;
                retainedState = candidate;
                return candidate;
              },
            };
          },
        },
      },
    );

    core.step();

    expect(afterTiles).toBe(beforeTiles);
    expect(core.getStateForSave().facility.thermalRevision).toBe(0);
    expect(core.getStateForSave().rngState).toBe(initialRng);
    expect(JSON.parse(JSON.stringify(core.getStateForSave()))).toEqual(core.getStateForSave());
    expect(Object.hasOwn(core.getStateForSave().facility, "pending")).toBe(false);
    if (retainedState === undefined) throw new Error("Expected retained runtime candidate.");
    const retainedTile = retainedState.facility.thermalTiles[0];
    if (retainedTile === undefined) throw new Error("Expected retained thermal tile.");
    try {
      retainedTile.temperatureC = 99;
    } catch {
      // Freezing is the accepted retained-reference protection.
    }
    expect(core.getStateForSave().facility.thermalTiles[0]?.temperatureC).toBe(22);
  });

  test("preserves Task 7/8 projections and records the Task 10.1 full-state compatibility vector", () => {
    const firstState = basicState("thermal-deterministic");
    firstState.facility.modules = { source: module("source", "module-power-distribution") };
    firstState.facility.extractionCapacityWatts = 1_000;
    cleanPower(firstState, [delivery("source", 240, 90)]);
    const secondState = structuredClone(firstState);
    const first = thermalCore(firstState);
    const second = new SimCore({
      initialState: secondState,
      tickSystems: {
        ...createThermalTickSystems(content),
        ...createOverclockTickSystems(content),
      },
    });

    first.step(100);
    second.step(100);

    const Task7State = first.getStateForSave();
    const Task8State = second.getStateForSave();
    const Task7WithoutCompute = withoutCompute(Task7State);
    const Task8WithoutCompute = withoutCompute(Task8State);
    expect(
      hashCanonicalState({
        ...Task7WithoutCompute,
        blueprints: { records: Task7State.blueprints.records },
      }),
    ).toBe("aa48404b98aa1e48");
    expect(
      hashCanonicalState({
        ...Task8WithoutCompute,
        blueprints: { records: Task8State.blueprints.records },
      }),
    ).toBe("62fc84b28af4a39c");
    expect(
      hashCanonicalState({
        ...Task7State,
        blueprints: { records: Task7State.blueprints.records },
      }),
    ).toBe("40a2e2270c2ba2bc");
    expect(
      hashCanonicalState({
        ...Task8State,
        blueprints: { records: Task8State.blueprints.records },
      }),
    ).toBe("97acfaa5ef64627e");
    expect(hashCanonicalState(withoutCompute(Task7State))).toBe("bd238ff22638cf12");
    expect(Task8State.facility.modules).toEqual(Task7State.facility.modules);
    expect(Task8State.facility.power).toEqual(Task7State.facility.power);
    expect(Task8State.facility.thermalTiles).toEqual(Task7State.facility.thermalTiles);
    expect(Task8State.facility.thermalRevision).toBe(Task7State.facility.thermalRevision);
    expect(hashCanonicalState(withoutCompute(Task8State))).toBe("9cb4b360875645b2");
    expect(hashCanonicalState(Task7State)).toBe("6d75663a8cd48776");
    expect(hashCanonicalState(Task8State)).toBe("5d370ba135412aec");
  });
});
