import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
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

  test("still rejects structurally corrupted persisted power before the next production tick", () => {
    const core = createCore(createStartupBoundaryState());
    core.step();
    const corrupted = core.getStateForSave();
    const routeResult = corrupted.facility.power.byRoute["route-power"];
    if (routeResult === undefined) throw new Error("Missing persisted route result fixture.");
    routeResult.deliveredPowerWatts = 701;
    routeResult.utilizationRatio = 701 / 700;
    const failing = createCore(corrupted);
    const before = failing.getStateForSave();

    expect(() => failing.step()).toThrow(
      "Simulator invariant violation at tick 1 during stage calculate-power-demand-and-delivery",
    );
    expect(failing.getStateForSave()).toEqual(before);
    expect(failing.tick).toBe(1);
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

  test("rolls back the complete tick, transitions, power results, and RNG on invalid input state", () => {
    const state = createState();
    state.facility.power.totalRequestedPowerWatts = 1;
    const core = createCore(state);
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(
      "Simulator invariant violation at tick 0 during stage calculate-power-demand-and-delivery",
    );

    const after = core.getStateForSave();
    expect(after).toEqual(before);
    expect(after.tick).toBe(0);
    expect(after.rngState).toBe(before.rngState);
    expect(after.facility.modules["sink"]?.startupTicksRemaining).toBe(2);
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
