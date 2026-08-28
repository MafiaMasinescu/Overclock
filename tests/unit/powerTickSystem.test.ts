import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import type { StructuralSharingTickSystemContext } from "../../src/sim/core/tickSystems.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import {
  createPowerTickSystems,
  type PowerResultCacheEvent,
  type PowerTopologyCacheEvent,
} from "../../src/sim/power/facilityPower.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();

function module(
  id: string,
  definitionId: string,
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

function powerRoute(sourceId: string, sinkId: string): RouteState {
  return {
    id: "route-power",
    kind: "power",
    from: { moduleInstanceId: sourceId, portId: "power-out-east" },
    to: { moduleInstanceId: sinkId, portId: "power-in-west" },
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    capacityPerSecond: 1_800,
    congestionRatio: 0,
  };
}

function createState(): GameState {
  const state = createInitialGameState({ content, seed: "task-6-tick" });
  const source = module("source", "module-power-distribution");
  const sink = module("sink", "module-vacuum-tube-logic", {
    operationalState: "offline",
    startupTicksRemaining: 2,
    cooldownTicksRemaining: 9,
  });
  state.facility.modules = { source, sink };
  state.facility.routes = { "route-power": powerRoute(source.id, sink.id) };
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  return state;
}

function createCore(state = createState()): SimCore {
  return new SimCore({ initialState: state, tickSystems: createPowerTickSystems(content) });
}

function createStartupBoundaryState(): GameState {
  const state = createInitialGameState({ content, seed: "task-6-startup-boundary" });
  state.facility.thermalTiles = [];
  const source = module("source", "module-power-distribution", {
    operationalState: "starting",
    startupTicksRemaining: 1,
  });
  const sink = module("sink", "module-vacuum-tube-logic");
  const route = powerRoute(source.id, sink.id);
  route.capacityPerSecond = 700;
  state.facility.modules = { source, sink };
  state.facility.routes = { [route.id]: route };
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  return state;
}

describe("production power tick system", () => {
  test("keeps step(0) a complete no-op and processPendingCommands command-only", () => {
    const core = createCore();
    const before = canonicalSerialize(core.getStateForSave());

    expect(core.processPendingCommands()).toEqual([]);
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
    expect(core.step(0)).toMatchObject({ ticksExecuted: 0, startTick: 0, endTick: 0 });
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("steps manually while paused, calculates power, and consumes no RNG", () => {
    const core = createCore();
    const before = core.getStateForSave();
    expect(before.clock.paused).toBe(true);

    core.step();

    const after = core.getStateForSave();
    expect(after.tick).toBe(1);
    expect(after.facility.power.layoutRevision).toBe(after.facility.liveLayoutRevision);
    expect(after.facility.power.byModule["source"]?.deliveredPowerWatts).toBe(240);
    expect(after.facility.power.byModule["sink"]?.deliveredPowerWatts).toBe(650);
    expect(after.facility.modules["sink"]).toMatchObject({
      operationalState: "starting",
      startupTicksRemaining: 1,
      cooldownTicksRemaining: 9,
    });
    expect(after.rngState).toBe(before.rngState);
  });

  test("produces identical results for grouped and separate multi-tick stepping", () => {
    const grouped = createCore();
    const separate = createCore();
    grouped.step(4);
    for (let tick = 0; tick < 4; tick += 1) separate.step();

    expect(grouped.getStateForSave()).toEqual(separate.getStateForSave());
  });

  test("accepts the historical startup result and supplies routes on the following production tick", () => {
    const core = createCore(createStartupBoundaryState());
    const initial = core.getStateForSave();

    const firstStep = core.step();
    const afterFirst = core.getStateForSave();
    expect(firstStep).toMatchObject({ startTick: 0, endTick: 1, ticksExecuted: 1 });
    expect(afterFirst.facility.modules["source"]).toMatchObject({
      operationalState: "online",
      startupTicksRemaining: 0,
    });
    expect(afterFirst.facility.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 0,
      powerFactor: 0,
      limitingReason: "source-unavailable",
    });

    const firstHash = hashCanonicalState(afterFirst);
    const secondStep = core.step();
    const afterSecond = core.getStateForSave();
    expect(secondStep).toMatchObject({ startTick: 1, endTick: 2, ticksExecuted: 1 });
    expect(afterSecond.facility.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 700,
      powerFactor: 700 / 1_450,
      limitingReason: "route-capacity",
    });
    expect(afterSecond.facility.power.byRoute["route-power"]).toEqual({
      routeId: "route-power",
      deliveredPowerWatts: 700,
      utilizationRatio: 1,
    });
    expect(afterSecond.rngState).toBe(initial.rngState);
    expect(hashCanonicalState(afterSecond)).not.toBe(firstHash);
  });

  test("recalculates after startup completion, then reuses only the stable third-tick result", () => {
    const topologyEvents: PowerTopologyCacheEvent[] = [];
    const resultEvents: PowerResultCacheEvent[] = [];
    const state = createStartupBoundaryState();
    const route = state.facility.routes["route-power"];
    if (route === undefined) throw new Error("Missing stable-cache route fixture.");
    route.capacityPerSecond = 100;
    const core = new SimCore({
      initialState: state,
      tickSystems: createPowerTickSystems(content, {
        onTopologyCacheEvent(event) {
          topologyEvents.push(event);
        },
        onPowerResultCacheEvent(event) {
          resultEvents.push(event);
        },
      }),
    });
    const initialRng = core.getStateForSave().rngState;

    core.step();
    const afterFirst = core.getStateForSave();
    expect(afterFirst.tick).toBe(1);
    expect(afterFirst.facility.modules["source"]).toMatchObject({
      operationalState: "online",
      startupTicksRemaining: 0,
    });
    expect(afterFirst.facility.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 0,
      limitingReason: "source-unavailable",
    });

    core.step();
    const afterSecond = core.getStateForSave();
    expect(afterSecond.tick).toBe(2);
    expect(afterSecond.facility.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 100,
      limitingReason: "route-capacity",
    });

    core.step();
    const afterThird = core.getStateForSave();
    expect(afterThird.tick).toBe(3);
    expect(afterThird.facility.power).toEqual(afterSecond.facility.power);
    expect(topologyEvents).toEqual(["clear", "rebuild", "hit", "hit"]);
    expect(resultEvents).toEqual(["calculated", "calculated", "reused"]);
    expect(afterFirst.rngState).toBe(initialRng);
    expect(afterSecond.rngState).toBe(initialRng);
    expect(afterThird.rngState).toBe(initialRng);
  });

  test("recalculates on the tick after an authoritative Overclock setting change", () => {
    const resultEvents: PowerResultCacheEvent[] = [];
    let workloadRuns = 0;
    const state = createStartupBoundaryState();
    const route = state.facility.routes["route-power"];
    if (route === undefined) throw new Error("Missing Overclock cache route fixture.");
    route.capacityPerSecond = 100;
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        ...createPowerTickSystems(content, {
          onPowerResultCacheEvent(event) {
            resultEvents.push(event);
          },
        }),
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                workloadRuns += 1;
                if (workloadRuns !== 3) return state;
                const sink = state.facility.modules["sink"];
                if (sink === undefined) throw new Error("Missing Overclock cache sink fixture.");
                return {
                  ...state,
                  facility: {
                    ...state.facility,
                    modules: {
                      ...state.facility.modules,
                      sink: {
                        ...sink,
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
    });

    core.step();
    core.step();
    core.step();
    const beforeRecalculation = core.getStateForSave();
    const previousRequested =
      beforeRecalculation.facility.power.byModule["sink"]?.requestedPowerWatts;

    core.step();
    const afterRecalculation = core.getStateForSave();

    expect(resultEvents).toEqual(["calculated", "calculated", "reused", "calculated"]);
    expect(afterRecalculation.facility.power.byModule["sink"]?.requestedPowerWatts).toBeGreaterThan(
      previousRequested ?? 0,
    );
    expect(afterRecalculation.rngState).toBe(beforeRecalculation.rngState);
  });

  test("accepts a structurally valid historical Power result without reinterpreting later Overclock settings", () => {
    const original = createCore(createStartupBoundaryState());
    original.step();
    const historical = original.getStateForSave();
    const sink = historical.facility.modules["sink"];
    if (sink === undefined) throw new Error("Missing historical Overclock fixture.");
    const changedSettings: GameState = {
      ...historical,
      facility: {
        ...historical.facility,
        modules: {
          ...historical.facility.modules,
          sink: {
            ...sink,
            overclock: {
              profile: "boost" as const,
              frequencyRatio: 1.25,
              voltageRatio: 1.1,
            },
          },
        },
      },
    };

    expect(
      () =>
        new SimCore({
          initialState: changedSettings,
          tickSystems: createPowerTickSystems(content),
        }),
    ).not.toThrow();
  });

  test("rejects an internally contradictory stored shutdown Power result", () => {
    const original = createCore(createStartupBoundaryState());
    original.step();
    const contradictory = original.getStateForSave();
    const delivery = contradictory.facility.power.byModule["sink"];
    if (delivery === undefined) throw new Error("Missing shutdown validation fixture.");
    delivery.limitingReason = "shutdown";

    expect(
      () =>
        new SimCore({
          initialState: contradictory,
          tickSystems: createPowerTickSystems(content),
        }),
    ).toThrow(/shutdown result must have zero demand and delivery/);
  });

  test("accepts a persisted startup-completion result across a cold lifecycle boundary", () => {
    const first = createCore(createStartupBoundaryState());
    first.step();
    const persisted = first.getStateForSave();

    const resumed = createCore(persisted);
    const secondStep = resumed.step();
    const afterSecond = resumed.getStateForSave();

    expect(secondStep).toMatchObject({ startTick: 1, endTick: 2, ticksExecuted: 1 });
    expect(afterSecond.facility.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 700,
      limitingReason: "route-capacity",
    });
    expect(afterSecond.rngState).toBe(persisted.rngState);
  });

  test.each([
    {
      name: "brownout",
      expectedState: "brownout",
      configure(state: GameState) {
        state.facility.contractedPowerWatts = 240;
        state.facility.power = createDirtyPowerState(240);
      },
    },
    {
      name: "recovery",
      expectedState: "online",
      configure(state: GameState) {
        const sink = state.facility.modules["sink"];
        if (sink === undefined) throw new Error("Missing recovery sink fixture.");
        sink.operationalState = "brownout";
        sink.startupTicksRemaining = 0;
      },
    },
    {
      name: "shutdown",
      expectedState: "shutdown",
      configure(state: GameState) {
        const sink = state.facility.modules["sink"];
        if (sink === undefined) throw new Error("Missing shutdown sink fixture.");
        sink.operationalState = "shutdown";
        sink.startupTicksRemaining = 0;
      },
    },
    {
      name: "cooldown preservation",
      expectedState: "online",
      configure(state: GameState) {
        const sink = state.facility.modules["sink"];
        if (sink === undefined) throw new Error("Missing cooldown sink fixture.");
        sink.operationalState = "online";
        sink.startupTicksRemaining = 0;
        sink.cooldownTicksRemaining = 7;
      },
    },
  ])("does not reinterpret the stored $name generation at a lifecycle boundary", (testCase) => {
    const state = createState();
    testCase.configure(state);
    const first = createCore(state);
    first.step();
    const persisted = first.getStateForSave();
    expect(persisted.facility.modules["sink"]?.operationalState).toBe(testCase.expectedState);

    const resumed = createCore(persisted);
    resumed.step();

    expect(resumed.tick).toBe(2);
    expect(resumed.getStateForSave().rngState).toBe(persisted.rngState);
  });

  test("rejects structurally corrupted persisted power at the lifecycle boundary", () => {
    const core = createCore(createStartupBoundaryState());
    core.step();
    const corrupted = core.getStateForSave();
    const routeResult = corrupted.facility.power.byRoute["route-power"];
    if (routeResult === undefined) throw new Error("Missing persisted route result fixture.");
    routeResult.deliveredPowerWatts = 701;
    routeResult.utilizationRatio = 701 / 700;
    expect(() => createCore(corrupted)).toThrow("Invalid power state");
  });

  test("ignores draft modules and routes while preserving the complete draft", () => {
    const state = createState();
    state.facility.designDraft = {
      revision: 3,
      modules: {},
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    const beforeDraft = structuredClone(state.facility.designDraft);
    const core = createCore(state);

    core.step();

    const after = core.getStateForSave();
    expect(after.facility.power.byModule).toHaveProperty("source");
    expect(after.facility.power.byModule).toHaveProperty("sink");
    expect(after.facility.designDraft).toEqual(beforeDraft);
  });

  test("rejects invalid dirty Power input at the lifecycle boundary", () => {
    const state = createState();
    state.facility.power.totalRequestedPowerWatts = 1;

    expect(() => createCore(state)).toThrow("Invalid power state");
  });

  test("rolls back finite-arithmetic failures without changing a previously committed tick", () => {
    const core = createCore();
    core.step();
    const committed = core.getStateForSave();
    const invalid = structuredClone(committed);
    const invalidSink = invalid.facility.modules["sink"];
    if (invalidSink === undefined) throw new Error("Missing invalid sink fixture.");
    invalidSink.binEfficiencyRatio = 0;
    invalid.facility.power = createDirtyPowerState(invalid.facility.contractedPowerWatts);
    const failing = createCore(invalid);
    const beforeFailure = failing.getStateForSave();

    expect(() => failing.step()).toThrow();
    expect(failing.getStateForSave()).toEqual(beforeFailure);
    expect(committed.tick).toBe(1);
  });

  test("keeps calculated power state canonically serializable and hashable", () => {
    const core = createCore();
    core.step(2);
    const state = core.getStateForSave();

    expect(JSON.parse(canonicalSerialize(state))).toEqual(state);
    expect(hashCanonicalState(state)).toMatch(/^[0-9a-f]{16}$/);
  });
});
