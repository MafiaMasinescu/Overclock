import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { calculateEnergyCostUsd } from "../../src/sim/economy/money.ts";
import {
  allocatePowerDelivery,
  calculateSourcePortCapacityWatts,
} from "../../src/sim/power/powerAllocation.ts";
import {
  calculateFacilityPower,
  createPowerTickSystems,
} from "../../src/sim/power/facilityPower.ts";
import {
  calculateModulePowerDemand,
  calculatePowerDemand,
} from "../../src/sim/power/powerDemand.ts";
import { createDirtyPowerState, validatePowerState } from "../../src/sim/power/powerState.ts";
import { createPowerTopology } from "../../src/sim/power/powerTopology.ts";
import { applyPowerOperationalTransitions } from "../../src/sim/power/powerTransitions.ts";

const content = loadContentBundle();
const SOURCE = "module-power-distribution";
const COMPUTE = "module-vacuum-tube-logic";
const CONTROL = "module-control-unit";
const MEMORY = "module-accumulator-register";
const INTERCONNECT = "module-data-relay";
const IO = "module-punch-card-reader";
const COOLING = "module-air-mover";
const ROOM_COOLING = "module-room-cooling";

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

function route(
  id: string,
  sourceId: string,
  sinkId: string,
  options: {
    capacity?: number;
    sourcePortId?: string;
    sinkPortId?: string;
    sinkDefinitionId?: string;
    kind?: "power" | "data";
  } = {},
): RouteState {
  const sinkPortId =
    options.sinkPortId ??
    content.modules[options.sinkDefinitionId ?? COMPUTE]?.ports.find(
      (port) => port.kind === "power-in",
    )?.id ??
    "power-in-west";
  return {
    id,
    kind: options.kind ?? "power",
    from: {
      moduleInstanceId: sourceId,
      portId: options.sourcePortId ?? "power-out-east",
    },
    to: {
      moduleInstanceId: sinkId,
      portId: sinkPortId,
    },
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    capacityPerSecond: options.capacity ?? 18_000,
    congestionRatio: 0,
  };
}

function stateWith(
  modules: readonly ModuleInstanceState[],
  routes: readonly RouteState[] = [],
  contractedPowerWatts = 24_000,
): GameState {
  const state = createInitialGameState({ content, seed: "task-6-power" });
  state.facility.contractedPowerWatts = contractedPowerWatts;
  state.facility.modules = Object.fromEntries(modules.map((item) => [item.id, item]));
  state.facility.routes = Object.fromEntries(routes.map((item) => [item.id, item]));
  state.facility.power = createDirtyPowerState(contractedPowerWatts);
  return state;
}

function calculate(state: GameState) {
  return calculateFacilityPower(state, content);
}

function definition(definitionId: string) {
  const value = content.modules[definitionId];
  if (value === undefined) throw new Error(`Missing module definition fixture: ${definitionId}`);
  return value;
}

describe("power demand", () => {
  test("uses load demand for ready modules, idle demand for starting modules, and zero for shutdown", () => {
    expect(calculateModulePowerDemand(module("ready", COMPUTE), definition(COMPUTE))).toEqual({
      moduleInstanceId: "ready",
      requestedPowerWatts: 1_450,
      minimumPowerWatts: 650,
    });
    expect(
      calculateModulePowerDemand(
        module("starting", COMPUTE, { startupTicksRemaining: 2 }),
        definition(COMPUTE),
      ),
    ).toMatchObject({ requestedPowerWatts: 650, minimumPowerWatts: 650 });
    expect(
      calculateModulePowerDemand(
        module("shutdown", COMPUTE, { operationalState: "shutdown" }),
        definition(COMPUTE),
      ),
    ).toMatchObject({ requestedPowerWatts: 0, minimumPowerWatts: 0 });
  });

  test("scales demand by bin efficiency without watt quantization and rejects invalid ratios", () => {
    const scaled = calculateModulePowerDemand(
      module("scaled", COMPUTE, { binEfficiencyRatio: 1.2 }),
      definition(COMPUTE),
    );
    expect(scaled.requestedPowerWatts).toBe(1_450 / 1.2);
    expect(scaled.minimumPowerWatts).toBe(650 / 1.2);

    for (const ratio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        calculateModulePowerDemand(
          module("invalid", COMPUTE, { binEfficiencyRatio: ratio }),
          definition(COMPUTE),
        ),
      ).toThrow("Bin efficiency ratio must be finite and positive");
    }
  });

  test("constructs demand records in stable module-ID order", () => {
    const modules = {
      z: module("z", IO),
      a: module("a", COMPUTE),
    };
    expect(Object.keys(calculatePowerDemand(modules, content))).toEqual(["a", "z"]);
  });
});

describe("power topology and allocation", () => {
  test("indexes only live power routes in stable route-ID order", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith(
      [source, sink],
      [route("z-power", source.id, sink.id), route("a-data", source.id, sink.id, { kind: "data" })],
    );

    const topology = createPowerTopology(state.facility, content);
    expect(topology.powerRouteIds).toEqual(["z-power"]);
    expect(topology.incomingRouteIdsByModule).toEqual({ sink: ["z-power"] });
    expect(calculate(state).power.byRoute["a-data"]).toBeUndefined();
  });

  test("scales finite source-output capacity by clamped source Power Factor", () => {
    expect(calculateSourcePortCapacityWatts(18_000, 0.5)).toBe(9_000);
    expect(calculateSourcePortCapacityWatts(18_000, 2)).toBe(18_000);
    expect(() => calculateSourcePortCapacityWatts(Number.POSITIVE_INFINITY, 1)).toThrow();
  });

  test("delivers a directly supplied source and one routed sink without double counting", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith([source, sink], [route("route-power", source.id, sink.id)]);
    const result = calculate(state);

    expect(result.power.byModule["source"]).toMatchObject({
      requestedPowerWatts: 240,
      deliveredPowerWatts: 240,
      powerFactor: 1,
      limitingReason: "none",
    });
    expect(result.power.byModule["sink"]).toMatchObject({
      requestedPowerWatts: 1_450,
      deliveredPowerWatts: 1_450,
      powerFactor: 1,
      limitingReason: "none",
    });
    expect(result.power.totalDeliveredPowerWatts).toBe(1_690);
    expect(result.power.byRoute["route-power"]).toEqual({
      routeId: "route-power",
      deliveredPowerWatts: 1_450,
      utilizationRatio: 1_450 / 18_000,
    });
  });

  test("distinguishes missing routes from routes whose source is unavailable", () => {
    const source = module("source", SOURCE, {
      startupTicksRemaining: 1,
      operationalState: "starting",
    });
    const missing = module("missing", COMPUTE);
    const unavailable = module("unavailable", COMPUTE);
    const result = calculate(
      stateWith([source, missing, unavailable], [route("route-u", source.id, unavailable.id)]),
    );

    expect(result.power.byModule["missing"]?.limitingReason).toBe("missing-route");
    expect(result.power.byModule["unavailable"]?.limitingReason).toBe("source-unavailable");
    expect(result.power.byRoute["route-u"]?.deliveredPowerWatts).toBe(0);
  });

  test("reports contracted-capacity before route-capacity when delivery is short", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const limited = calculate(
      stateWith(
        [source, sink],
        [route("route-limited", source.id, sink.id, { capacity: 800 })],
        740,
      ),
    );
    expect(limited.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 500,
      limitingReason: "contracted-capacity",
    });

    const routeLimited = calculate(
      stateWith([source, sink], [route("route-limited", source.id, sink.id, { capacity: 800 })]),
    );
    expect(routeLimited.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 800,
      limitingReason: "route-capacity",
    });
  });

  test("enforces shared source-output and sink-input capacities across multiple routes", () => {
    const source = module("source", SOURCE);
    const sharedSourceSinks = Array.from({ length: 4 }, (_, index) =>
      module(`source-sink-${index}`, ROOM_COOLING, { binEfficiencyRatio: 0.1 }),
    );
    const sharedSource = calculate(
      stateWith(
        [source, ...sharedSourceSinks],
        sharedSourceSinks.map((sink, index) =>
          route(`route-${index}`, source.id, sink.id, {
            capacity: 18_000,
            sinkDefinitionId: ROOM_COOLING,
          }),
        ),
        30_000,
      ),
    );
    expect(
      Object.values(sharedSource.power.byRoute).reduce(
        (total, result) => total + result.deliveredPowerWatts,
        0,
      ),
    ).toBe(18_000);

    const sourceB = module("source-b", SOURCE);
    const sharedSinkModule = module("sink-a", COMPUTE, { binEfficiencyRatio: 0.5 });
    const sharedSink = calculate(
      stateWith(
        [source, sourceB, sharedSinkModule],
        [
          route("route-a", source.id, sharedSinkModule.id, { capacity: 18_000 }),
          route("route-b", sourceB.id, sharedSinkModule.id, { capacity: 18_000 }),
        ],
      ),
    );
    expect(sharedSink.power.byModule["sink-a"]?.deliveredPowerWatts).toBe(1_800);
    const routeA = sharedSink.power.byRoute["route-a"];
    const routeB = sharedSink.power.byRoute["route-b"];
    if (routeA === undefined || routeB === undefined)
      throw new Error("Missing shared-route result.");
    expect(routeA.deliveredPowerWatts + routeB.deliveredPowerWatts).toBe(1_800);
  });

  test("combines multiple routes for one sink in route-ID order and handles zero-capacity routes", () => {
    const sourceA = module("source-a", SOURCE);
    const sourceB = module("source-b", SOURCE);
    const sink = module("sink", COMPUTE);
    const result = calculate(
      stateWith(
        [sourceA, sourceB, sink],
        [
          route("route-c", sourceB.id, sink.id, { capacity: 0 }),
          route("route-b", sourceB.id, sink.id, { capacity: 1_000 }),
          route("route-a", sourceA.id, sink.id, { capacity: 600 }),
        ],
      ),
    );

    expect(result.power.byRoute["route-c"]).toEqual({
      routeId: "route-c",
      deliveredPowerWatts: 0,
      utilizationRatio: 0,
    });
    expect(result.power.byRoute["route-a"]?.deliveredPowerWatts).toBe(600);
    expect(result.power.byRoute["route-b"]?.deliveredPowerWatts).toBe(850);
    expect(result.power.byModule["sink"]?.limitingReason).toBe("none");
  });

  test.each([
    { name: "cooling", definitionId: COOLING, minimum: 80 },
    { name: "memory", definitionId: MEMORY, minimum: 260 },
    { name: "control", definitionId: CONTROL, minimum: 320 },
    { name: "compute", definitionId: COMPUTE, minimum: 650 },
    { name: "interconnect", definitionId: INTERCONNECT, minimum: 90 },
    { name: "io", definitionId: IO, minimum: 210 },
  ])("includes $name in its fixed priority tier", ({ definitionId, minimum }) => {
    const source = module("source", SOURCE);
    const target = module("target", definitionId);
    const result = calculate(
      stateWith(
        [source, target],
        [route("route-target", source.id, target.id, { sinkDefinitionId: definitionId })],
        240 + minimum,
      ),
    );
    expect(result.power.byModule["target"]?.deliveredPowerWatts).toBe(minimum);
  });

  test("allocates cooling before memory, memory before compute, and compute before I/O", () => {
    const source = module("source", SOURCE);
    const cooling = module("cooling", COOLING);
    const memory = module("memory", MEMORY);
    const compute = module("compute", COMPUTE);
    const io = module("io", IO);
    const modules = [source, cooling, memory, compute, io];
    const routes = modules
      .slice(1)
      .map((sink) =>
        route(`route-${sink.id}`, source.id, sink.id, { sinkDefinitionId: sink.definitionId }),
      );
    const result = calculate(stateWith(modules, routes, 240 + 420 + 520 + 100));

    expect(result.power.byModule["cooling"]?.deliveredPowerWatts).toBe(420);
    expect(result.power.byModule["memory"]?.deliveredPowerWatts).toBe(520);
    expect(result.power.byModule["compute"]?.deliveredPowerWatts).toBe(100);
    expect(result.power.byModule["io"]?.deliveredPowerWatts).toBe(0);
  });

  test("runs the minimum pass before remaining demand and uses stable IDs inside a tier", () => {
    const source = module("source", SOURCE);
    const first = module("compute-a", COMPUTE);
    const second = module("compute-z", COMPUTE);
    const routes = [route("route-a", source.id, first.id), route("route-z", source.id, second.id)];

    const minimumOnly = calculate(stateWith([source, second, first], routes, 240 + 1_300));
    expect(minimumOnly.power.byModule["compute-a"]?.deliveredPowerWatts).toBe(650);
    expect(minimumOnly.power.byModule["compute-z"]?.deliveredPowerWatts).toBe(650);

    const remaining = calculate(stateWith([source, second, first], routes, 240 + 2_100));
    expect(remaining.power.byModule["compute-a"]?.deliveredPowerWatts).toBe(1_450);
    expect(remaining.power.byModule["compute-z"]?.deliveredPowerWatts).toBe(650);
  });

  test("exposes the pure topology and allocator independently", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith([source, sink], [route("route", source.id, sink.id)]);
    const demand = calculatePowerDemand(state.facility.modules, content);
    const topology = createPowerTopology(state.facility, content);
    const allocation = allocatePowerDelivery(state.facility, demand, topology, content);

    expect(allocation.byModule["sink"]?.deliveredPowerWatts).toBe(1_450);
    expect(allocation.byRoute["route"]?.deliveredPowerWatts).toBe(1_450);
  });
});

describe("power-owned operational transitions", () => {
  test("accepts exact minimum power, pauses startup below it, and preserves cooldown", () => {
    const starting = module("starting", COMPUTE, {
      operationalState: "starting",
      startupTicksRemaining: 2,
      cooldownTicksRemaining: 7,
    });
    const atMinimum = applyPowerOperationalTransitions(
      { starting },
      {
        starting: {
          moduleInstanceId: "starting",
          requestedPowerWatts: 650,
          minimumPowerWatts: 650,
          deliveredPowerWatts: 650,
          powerFactor: 1,
          limitingReason: "none",
        },
      },
    );
    expect(atMinimum["starting"]).toMatchObject({
      operationalState: "starting",
      startupTicksRemaining: 1,
      cooldownTicksRemaining: 7,
    });

    const below = applyPowerOperationalTransitions(
      { starting },
      {
        starting: {
          moduleInstanceId: "starting",
          requestedPowerWatts: 650,
          minimumPowerWatts: 650,
          deliveredPowerWatts: 649,
          powerFactor: 649 / 650,
          limitingReason: "contracted-capacity",
        },
      },
    );
    expect(below["starting"]).toMatchObject({
      operationalState: "brownout",
      startupTicksRemaining: 2,
      cooldownTicksRemaining: 7,
    });
  });

  test("automatically starts offline modules, completes multi-tick startup, and recovers brownout", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE, {
      operationalState: "offline",
      startupTicksRemaining: 2,
    });
    const initial = stateWith([source, sink], [route("route", source.id, sink.id)]);
    const first = calculate(initial);
    expect(first.modules["sink"]).toMatchObject({
      operationalState: "starting",
      startupTicksRemaining: 1,
    });

    const secondState = structuredClone(initial);
    secondState.facility.modules = structuredClone(first.modules);
    const second = calculate(secondState);
    expect(second.modules["sink"]).toMatchObject({
      operationalState: "online",
      startupTicksRemaining: 0,
    });

    const brownout = stateWith(
      [source, module("sink", COMPUTE, { operationalState: "brownout", startupTicksRemaining: 1 })],
      [route("route", source.id, "sink")],
    );
    expect(calculate(brownout).modules["sink"]).toMatchObject({
      operationalState: "online",
      startupTicksRemaining: 0,
    });
  });

  test("keeps partial-above-minimum modules online and preserves shutdown", () => {
    const source = module("source", SOURCE);
    const partial = module("partial", COMPUTE);
    const shutdown = module("shutdown", IO, { operationalState: "shutdown" });
    const result = calculate(
      stateWith(
        [source, partial, shutdown],
        [
          route("route-partial", source.id, partial.id),
          route("route-shutdown", source.id, shutdown.id),
        ],
        240 + 700,
      ),
    );
    expect(result.modules["partial"]?.operationalState).toBe("online");
    expect(result.power.byModule["partial"]?.powerFactor).toBe(700 / 1_450);
    expect(result.modules["shutdown"]?.operationalState).toBe("shutdown");
    expect(result.power.byModule["shutdown"]).toMatchObject({
      requestedPowerWatts: 0,
      deliveredPowerWatts: 0,
      powerFactor: 0,
      limitingReason: "shutdown",
    });
  });

  test("does not let a source supply routes until the tick after startup completes", () => {
    const source = module("source", SOURCE, {
      operationalState: "starting",
      startupTicksRemaining: 1,
    });
    const sink = module("sink", COMPUTE);
    const initial = stateWith([source, sink], [route("route", source.id, sink.id)]);
    const completionTick = calculate(initial);
    expect(completionTick.modules["source"]).toMatchObject({
      operationalState: "online",
      startupTicksRemaining: 0,
    });
    expect(completionTick.power.byModule["sink"]?.limitingReason).toBe("source-unavailable");

    const followingState = structuredClone(initial);
    followingState.facility.modules = structuredClone(completionTick.modules);
    const followingTick = calculate(followingState);
    expect(followingTick.power.byModule["sink"]?.deliveredPowerWatts).toBe(1_450);
  });
});

describe("facility power result and validation", () => {
  test("calculates empty-facility totals, headroom, layout revision, and route coverage", () => {
    const state = stateWith([], [], 123);
    const result = calculate(state);
    expect(result.power).toEqual({
      layoutRevision: 0,
      totalRequestedPowerWatts: 0,
      totalDeliveredPowerWatts: 0,
      headroomWatts: 123,
      energyCostUsdThisTick: 0,
      byModule: {},
      byRoute: {},
    });
  });

  test("uses Task 4 energy-cost quantization for exactly 0.1 simulated seconds without economy mutation", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith([source, sink], [route("route", source.id, sink.id)]);
    state.economy.cashUsd = 123;
    state.economy.lastTickExpenseUsd = 7;
    state.economy.totalExpenseUsd = 11;
    const beforeEconomy = structuredClone(state.economy);
    const result = calculate(state);

    expect(result.power.energyCostUsdThisTick).toBe(calculateEnergyCostUsd(1_690, 0.1, 0.042));
    expect(state.economy).toEqual(beforeEconomy);
  });

  test("validates dirty and calculated states and reports key, total, headroom, and route-flow corruption", () => {
    const dirty = stateWith([]);
    expect(validatePowerState(dirty, content)).toEqual([]);

    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith([source, sink], [route("route", source.id, sink.id)]);
    const result = calculate(state);
    state.facility.modules = result.modules;
    state.facility.power = result.power;
    expect(validatePowerState(state, content)).toEqual([]);

    state.facility.power.totalDeliveredPowerWatts += 1;
    state.facility.power.headroomWatts += 1;
    const corruptedRoute = state.facility.power.byRoute["route"];
    if (corruptedRoute === undefined) throw new Error("Missing route result fixture.");
    corruptedRoute.deliveredPowerWatts = 20_000;
    expect(validatePowerState(state, content).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "facility.power.totalDeliveredPowerWatts",
        "facility.power.headroomWatts",
        "facility.power.byRoute.route.deliveredPowerWatts",
      ]),
    );
  });

  test("rejects inconsistent Power Factors and route flow that does not match sink delivery", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith([source, sink], [route("route", source.id, sink.id)]);
    const result = calculate(state);
    state.facility.modules = result.modules;
    state.facility.power = result.power;
    const corruptedModule = state.facility.power.byModule["sink"];
    const corruptedRoute = state.facility.power.byRoute["route"];
    if (corruptedModule === undefined || corruptedRoute === undefined) {
      throw new Error("Missing calculated power fixture.");
    }
    corruptedModule.powerFactor = 0.5;
    corruptedRoute.deliveredPowerWatts = 1_000;
    corruptedRoute.utilizationRatio = 1_000 / 18_000;

    expect(validatePowerState(state, content).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "facility.power.byModule.sink.powerFactor",
        "facility.power.byModule.sink.deliveredPowerWatts",
      ]),
    );
  });

  test("rejects delivery above contracted capacity and minimum power above requested power", () => {
    const source = module("source", SOURCE);
    const state = stateWith([source]);
    const result = calculate(state);
    state.facility.modules = result.modules;
    state.facility.power = result.power;
    state.facility.contractedPowerWatts = 200;
    state.facility.power.headroomWatts = 0;
    const corruptedSource = state.facility.power.byModule["source"];
    if (corruptedSource === undefined) throw new Error("Missing source power result fixture.");
    corruptedSource.minimumPowerWatts = 241;

    expect(validatePowerState(state, content).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "facility.power.totalDeliveredPowerWatts",
        "facility.power.byModule.source.minimumPowerWatts",
      ]),
    );
  });

  test("rejects routed output from a source that completed startup this tick and non-owned module changes", () => {
    const source = module("source", SOURCE);
    const sink = module("sink", COMPUTE);
    const state = stateWith([source, sink], [route("route", source.id, sink.id)]);
    const previousModules = structuredClone(state.facility.modules);
    previousModules["source"] = module("source", SOURCE, {
      operationalState: "starting",
      startupTicksRemaining: 1,
    });
    const result = calculate(state);
    state.facility.modules = result.modules;
    state.facility.power = result.power;
    const corruptedSink = state.facility.modules["sink"];
    if (corruptedSink === undefined) throw new Error("Missing sink module fixture.");
    corruptedSink.binComputeRatio = 2;

    expect(validatePowerState(state, content, previousModules).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "facility.power.byRoute.route.deliveredPowerWatts",
        "facility.modules.sink",
      ]),
    );
  });

  test("rejects limiting reasons that violate the stable precedence", () => {
    const missing = module("missing", COMPUTE);
    const state = stateWith([missing]);
    const result = calculate(state);
    state.facility.modules = result.modules;
    state.facility.power = result.power;
    const missingResult = state.facility.power.byModule["missing"];
    if (missingResult === undefined) throw new Error("Missing module power result fixture.");
    missingResult.limitingReason = "contracted-capacity";

    expect(validatePowerState(state, content).map((issue) => issue.path)).toContain(
      "facility.power.byModule.missing.limitingReason",
    );
  });

  test("registers only the approved production stage", () => {
    expect(Object.keys(createPowerTickSystems(content))).toEqual([
      "calculate-power-demand-and-delivery",
    ]);
  });

  test("is independent of module and route record insertion order", () => {
    const source = module("source", SOURCE);
    const sinkA = module("sink-a", COMPUTE);
    const sinkB = module("sink-b", COOLING);
    const routes = [route("route-z", source.id, sinkA.id), route("route-a", source.id, sinkB.id)];
    const ordered = stateWith([source, sinkA, sinkB], routes, 2_000);
    const reversed = stateWith([sinkB, sinkA, source], routes.toReversed(), 2_000);
    expect(calculate(reversed)).toEqual(calculate(ordered));
  });
});
