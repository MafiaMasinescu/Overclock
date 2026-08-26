import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { TickSystemFactory } from "../../src/sim/core/tickSystems.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { calculateEnergyCostUsd } from "../../src/sim/economy/money.ts";
import {
  calculateFacilityPower,
  createPowerTickSystems,
  type PowerResultCacheEvent,
  type PowerTopologyCacheEvent,
} from "../../src/sim/power/facilityPower.ts";
import { assertValidPowerState, createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import {
  allocatePowerDelivery,
  createPowerAllocationScratch,
} from "../../src/sim/power/powerAllocation.ts";
import { calculatePowerDemand } from "../../src/sim/power/powerDemand.ts";
import {
  assertValidPowerTickResult,
  createPowerTickValidationScratch,
} from "../../src/sim/power/powerTickValidation.ts";
import { createPowerTopology } from "../../src/sim/power/powerTopology.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();

function module(id: string, definitionId: string): ModuleInstanceState {
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
  };
}

function route(sourceId: string, sinkId: string): RouteState {
  return {
    id: "route-power",
    kind: "power",
    from: { moduleInstanceId: sourceId, portId: "power-out-east" },
    to: { moduleInstanceId: sinkId, portId: "power-in-west" },
    path: [],
    capacityPerSecond: 1_800,
    congestionRatio: 0,
  };
}

function createState(seed: string): GameState {
  const state = createInitialGameState({ content, seed });
  state.facility.thermalTiles = [];
  const source = module("source", "module-power-distribution");
  const sink = module("sink", "module-vacuum-tube-logic");
  state.facility.modules = { source, sink };
  state.facility.routes = { "route-power": route(source.id, sink.id) };
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  return state;
}

function createEmptyDesignState(seed: string): GameState {
  const state = createInitialGameState({ content, seed });
  state.facility.thermalTiles = [];
  state.inventory.stacks["module-data-relay"] = {
    definitionId: "module-data-relay",
    quantity: 1,
    averageAcquisitionCostUsd: 700,
  };
  return state;
}

function processCommands(core: SimCore, commands: readonly Parameters<SimCore["enqueue"]>[0][]) {
  for (const command of commands) core.enqueue(command);
  return core.processPendingCommands();
}

function expectNoDerivedRuntimeContainers(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(ArrayBuffer.isView(value)).toBe(false);
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeInstanceOf(Set);
  for (const child of Object.values(value)) expectNoDerivedRuntimeContainers(child);
}

describe("Task 6.1 Power topology cache lifecycle", () => {
  test("reuses unchanged topology while keeping one cache per SimCore", () => {
    const events: PowerTopologyCacheEvent[] = [];
    const resultEvents: PowerResultCacheEvent[] = [];
    const tickSystems = createPowerTickSystems(content, {
      onTopologyCacheEvent(event) {
        events.push(event);
      },
      onPowerResultCacheEvent(event) {
        resultEvents.push(event);
      },
    });
    const first = new SimCore({ initialState: createState("cache-owner-a"), tickSystems });
    const second = new SimCore({ initialState: createState("cache-owner-b"), tickSystems });

    first.step();
    const coldPower = first.getStateForSave().facility.power;
    first.step();
    const stablePower = first.getStateForSave().facility.power;
    first.step();
    const warmPower = first.getStateForSave().facility.power;
    second.step();

    expect(events).toEqual(["clear", "clear", "rebuild", "hit", "hit", "rebuild"]);
    expect(resultEvents).toEqual(["calculated", "calculated", "reused", "calculated"]);
    expect(stablePower).toEqual(coldPower);
    expect(warmPower).toEqual(stablePower);
  });

  test("invalidates only when the live layout revision changes", () => {
    const events: PowerTopologyCacheEvent[] = [];
    const core = new SimCore({
      initialState: createState("cache-revision"),
      commandHandlers: {
        SET_GUIDANCE_MODE({ state }) {
          state.facility.liveLayoutRevision += 1;
          state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
        },
      },
      tickSystems: createPowerTickSystems(content, {
        onTopologyCacheEvent(event) {
          events.push(event);
        },
      }),
    });
    core.step();
    core.enqueue({
      commandId: "61000000-0000-4000-8000-000000000001",
      source: "debug",
      kind: "SET_GUIDANCE_MODE",
      mode: "engineering",
    });

    core.step();
    core.step();

    expect(events).toEqual(["clear", "rebuild", "rebuild", "hit"]);
  });

  test("clears explicitly on state replacement and rebuilds from the replacement", () => {
    const events: PowerTopologyCacheEvent[] = [];
    const core = new SimCore({
      initialState: createState("cache-before-replacement"),
      tickSystems: createPowerTickSystems(content, {
        onTopologyCacheEvent(event) {
          events.push(event);
        },
      }),
    });
    core.step();
    const replacement = createState("cache-after-replacement");

    core.replaceState(replacement);
    core.step();

    expect(events).toEqual(["clear", "rebuild", "clear", "rebuild"]);
    expect(core.tick).toBe(1);
    expect(core.getStateForSave().seed).toBe("cache-after-replacement");
  });

  test("cache history cannot change authoritative serialization or hashes", () => {
    const reusedRegistry = createPowerTickSystems(content);
    const warmed = new SimCore({
      initialState: createState("cache-hash"),
      tickSystems: reusedRegistry,
    });
    const cold = new SimCore({
      initialState: createState("cache-hash"),
      tickSystems: createPowerTickSystems(content),
    });

    warmed.step();
    warmed.step();
    cold.step(2);
    const warmedState = warmed.getStateForSave();
    const coldState = cold.getStateForSave();

    expect(canonicalSerialize(warmedState)).toBe(canonicalSerialize(coldState));
    expect(hashCanonicalState(warmedState)).toBe(hashCanonicalState(coldState));
  });

  test("draft edit, undo, redo, cancel, and command-only processing do not invalidate", () => {
    const events: PowerTopologyCacheEvent[] = [];
    const core = new SimCore({
      initialState: createEmptyDesignState("draft-cache-stability"),
      commandHandlers: createDesignModeCommandHandlers(content),
      tickSystems: createPowerTickSystems(content, {
        onTopologyCacheEvent(event) {
          events.push(event);
        },
      }),
    });
    core.step();

    expect(
      processCommands(core, [
        {
          commandId: "61000000-0000-4000-8000-000000000010",
          source: "player",
          kind: "ENTER_DESIGN_MODE",
        },
        {
          commandId: "61000000-0000-4000-8000-000000000011",
          source: "player",
          kind: "PLACE_MODULE",
          definitionId: "module-data-relay",
          position: { x: 0, y: 0 },
          rotation: 0,
        },
        {
          commandId: "61000000-0000-4000-8000-000000000012",
          source: "player",
          kind: "UNDO_DESIGN",
        },
        {
          commandId: "61000000-0000-4000-8000-000000000013",
          source: "player",
          kind: "REDO_DESIGN",
        },
        {
          commandId: "61000000-0000-4000-8000-000000000014",
          source: "player",
          kind: "CANCEL_DESIGN",
        },
      ]).every((result) => result.accepted),
    ).toBe(true);
    expect(events).toEqual(["clear", "rebuild"]);

    core.step();

    expect(events).toEqual(["clear", "rebuild", "hit"]);
  });

  test("a changed Apply invalidates topology at the following Power tick", () => {
    const events: PowerTopologyCacheEvent[] = [];
    const core = new SimCore({
      initialState: createEmptyDesignState("apply-cache-invalidation"),
      commandHandlers: createDesignModeCommandHandlers(content),
      tickSystems: createPowerTickSystems(content, {
        onTopologyCacheEvent(event) {
          events.push(event);
        },
      }),
    });
    core.step();
    const editResults = processCommands(core, [
      {
        commandId: "61000000-0000-4000-8000-000000000020",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      },
      {
        commandId: "61000000-0000-4000-8000-000000000021",
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: "module-data-relay",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
    ]);
    expect(editResults.every((result) => result.accepted)).toBe(true);
    const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
    if (preview.status !== "ready") throw new Error("Expected ready Apply preview fixture.");

    const [applyResult] = processCommands(core, [
      {
        commandId: "61000000-0000-4000-8000-000000000022",
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.draftRevision,
        acceptedCostUsd: preview.netCostUsd,
        acceptedDowntimeTicks: preview.downtimeTicks,
      },
    ]);
    expect(applyResult?.accepted).toBe(true);
    expect(events).toEqual(["clear", "rebuild"]);

    core.step();

    expect(events).toEqual(["clear", "rebuild", "rebuild"]);
  });

  test.each([
    {
      name: "source operational and startup state",
      change(state: Readonly<GameState>): GameState {
        const source = state.facility.modules["source"];
        if (source === undefined) throw new Error("Missing source cache fixture.");
        return {
          ...state,
          facility: {
            ...state.facility,
            modules: {
              ...state.facility.modules,
              source: { ...source, operationalState: "starting", startupTicksRemaining: 1 },
            },
          },
        };
      },
    },
    {
      name: "cooldown state",
      change(state: Readonly<GameState>): GameState {
        const source = state.facility.modules["source"];
        if (source === undefined) throw new Error("Missing cooldown cache fixture.");
        return {
          ...state,
          facility: {
            ...state.facility,
            modules: {
              ...state.facility.modules,
              source: { ...source, cooldownTicksRemaining: source.cooldownTicksRemaining + 1 },
            },
          },
        };
      },
    },
    {
      name: "requested demand",
      change(state: Readonly<GameState>): GameState {
        const sink = state.facility.modules["sink"];
        if (sink === undefined) throw new Error("Missing demand cache fixture.");
        return {
          ...state,
          facility: {
            ...state.facility,
            modules: {
              ...state.facility.modules,
              sink: { ...sink, binEfficiencyRatio: sink.binEfficiencyRatio * 2 },
            },
          },
        };
      },
    },
    {
      name: "module branch identity",
      change(state: Readonly<GameState>): GameState {
        return {
          ...state,
          facility: { ...state.facility, modules: { ...state.facility.modules } },
        };
      },
    },
    {
      name: "contracted capacity",
      change(state: Readonly<GameState>): GameState {
        return {
          ...state,
          facility: {
            ...state.facility,
            contractedPowerWatts: state.facility.contractedPowerWatts + 1,
          },
        };
      },
    },
    {
      name: "energy price",
      change(state: Readonly<GameState>): GameState {
        return {
          ...state,
          economy: {
            ...state.economy,
            energyPriceUsdPerKwh: state.economy.energyPriceUsdPerKwh + 1,
          },
        };
      },
    },
    {
      name: "route and live-layout revision",
      change(state: Readonly<GameState>): GameState {
        const powerRoute = state.facility.routes["route-power"];
        if (powerRoute === undefined) throw new Error("Missing route cache fixture.");
        return {
          ...state,
          facility: {
            ...state.facility,
            routes: {
              ...state.facility.routes,
              "route-power": {
                ...powerRoute,
                capacityPerSecond: powerRoute.capacityPerSecond + 1,
              },
            },
            liveLayoutRevision: state.facility.liveLayoutRevision + 1,
            power: createDirtyPowerState(state.facility.contractedPowerWatts),
          },
        };
      },
    },
  ])("invalidates the result cache after $name changes", (testCase) => {
    let changed = false;
    const resultEvents: PowerResultCacheEvent[] = [];
    const inputMutationFactory: TickSystemFactory = {
      createRuntime() {
        return {
          executionMode: "structural-sharing",
          run({ state }) {
            if (changed || state.tick === 0) return state;
            changed = true;
            return testCase.change(state);
          },
        };
      },
    };
    const core = new SimCore({
      initialState: createState(`cache-input-${testCase.name}`),
      tickSystems: {
        "rebuild-dirty-connectivity": inputMutationFactory,
        ...createPowerTickSystems(content, {
          onPowerResultCacheEvent(event) {
            resultEvents.push(event);
          },
        }),
      },
    });

    core.step();
    core.step();

    expect(resultEvents).toEqual(["calculated", "calculated"]);
  });
});

describe("Task 6.1 structural-sharing tick transactions", () => {
  test("shares unchanged branches and freezes every newly committed branch", () => {
    let previousInventory: GameState["inventory"] | undefined;
    let sawSharedInventory = false;
    let retainedUnlockedIds: string[] | undefined;
    const factory: TickSystemFactory = {
      createRuntime() {
        return {
          executionMode: "structural-sharing",
          run({ state }) {
            if (previousInventory !== undefined) {
              sawSharedInventory = state.inventory === previousInventory;
            }
            previousInventory = state.inventory;
            const unlockedIds = [...state.achievements.unlockedIds, `tick-${state.tick}`];
            retainedUnlockedIds = unlockedIds;
            return {
              ...state,
              achievements: {
                ...state.achievements,
                unlockedIds,
              },
            };
          },
        };
      },
    };
    const core = new SimCore({
      initialState: createState("structural-sharing"),
      tickSystems: { "emit-events": factory },
    });

    core.step(2);
    expect(sawSharedInventory).toBe(true);
    if (retainedUnlockedIds === undefined) throw new Error("Missing retained branch fixture.");
    const retained = retainedUnlockedIds;
    expect(() => retained.push("late-mutation")).toThrow();
    expect(core.getStateForSave().achievements.unlockedIds).toEqual(["tick-0", "tick-1"]);
  });

  test("ordinary production Power ticks do not clone the complete GameState", () => {
    const core = new SimCore({
      initialState: createState("no-production-clone"),
      tickSystems: createPowerTickSystems(content),
    });
    const originalStructuredClone = globalThis.structuredClone;
    let cloneCalls = 0;
    globalThis.structuredClone = <T>(value: T, options?: StructuredSerializeOptions): T => {
      cloneCalls += 1;
      return originalStructuredClone(value, options);
    };

    try {
      core.step();
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }

    expect(cloneCalls).toBe(0);
  });

  test("deep-freezes descendants of a newly shallow-frozen branch", () => {
    let retainedUnlockedIds: string[] | undefined;
    const factory: TickSystemFactory = {
      createRuntime() {
        return {
          executionMode: "structural-sharing",
          run({ state }) {
            const unlockedIds = ["shallow-frozen-branch"];
            retainedUnlockedIds = unlockedIds;
            return {
              ...state,
              achievements: Object.freeze({ ...state.achievements, unlockedIds }),
            };
          },
        };
      },
    };
    const core = new SimCore({
      initialState: createState("shallow-freeze-hardening"),
      tickSystems: { "emit-events": factory },
    });

    core.step();

    if (retainedUnlockedIds === undefined) throw new Error("Missing shallow-freeze fixture.");
    const retained = retainedUnlockedIds;
    expect(() => retained.push("late-mutation")).toThrow();
    expect(core.getStateForSave().achievements.unlockedIds).toEqual(["shallow-frozen-branch"]);
  });

  test("a populated cache remains isolated across deterministic fatal rollback", () => {
    const events: PowerTopologyCacheEvent[] = [];
    const failingFactory: TickSystemFactory = {
      createRuntime() {
        return {
          executionMode: "structural-sharing",
          run() {
            throw new Error("fatal stage after Power");
          },
        };
      },
    };
    const core = new SimCore({
      initialState: createState("cache-rollback"),
      tickSystems: {
        ...createPowerTickSystems(content, {
          onTopologyCacheEvent(event) {
            events.push(event);
          },
        }),
        "emit-events": failingFactory,
      },
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow("during stage emit-events");
    expect(core.getStateForSave()).toEqual(before);
    expect(() => core.step()).toThrow("during stage emit-events");

    expect(events).toEqual(["clear", "rebuild", "hit"]);
    expect(core.getStateForSave()).toEqual(before);
    expect(core.tick).toBe(0);
  });

  test("rolls back state and RNG when same-generation Power validation fails fatally", () => {
    const initialState = createState("same-generation-fatal-rollback");
    const source = initialState.facility.modules["source"];
    if (source === undefined) throw new Error("Missing source fixture.");
    source.operationalState = "starting";
    source.startupTicksRemaining = 1;
    const invalidPowerFactory: TickSystemFactory = {
      createRuntime() {
        return {
          executionMode: "structural-sharing",
          run({ state, rng }) {
            rng.nextUint32();
            const topology = createPowerTopology(state.facility, content);
            const result = calculateFacilityPower(state, content, topology);
            const sinkDelivery = result.power.byModule["sink"];
            if (sinkDelivery === undefined) throw new Error("Missing sink delivery fixture.");
            sinkDelivery.limitingReason = "route-capacity";
            assertValidPowerTickResult(state, result, topology, content);
            return state;
          },
        };
      },
    };
    const core = new SimCore({
      initialState,
      tickSystems: { "calculate-power-demand-and-delivery": invalidPowerFactory },
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow("during stage calculate-power-demand-and-delivery");

    expect(core.getStateForSave()).toEqual(before);
    expect(core.tick).toBe(0);
    expect(core.getStateForSave().rngState).toBe(before.rngState);
  });
});

describe("Task 6.1 scoped Power validation", () => {
  test("accepts historical startup availability without accepting an impossible contracted limit", () => {
    const calculationInput = createState("historical-startup-generation");
    const source = calculationInput.facility.modules["source"];
    if (source === undefined) throw new Error("Missing source fixture.");
    source.operationalState = "starting";
    source.startupTicksRemaining = 1;
    const result = calculateFacilityPower(calculationInput, content);
    const historical = structuredClone(calculationInput);
    historical.facility.modules = result.modules;
    historical.facility.power = result.power;

    expect(historical.facility.modules["source"]).toMatchObject({
      operationalState: "online",
      startupTicksRemaining: 0,
    });
    expect(historical.facility.power.byModule["sink"]).toMatchObject({
      deliveredPowerWatts: 0,
      limitingReason: "source-unavailable",
    });
    expect(() => {
      assertValidPowerState(historical, content);
    }).not.toThrow();

    const contradictory = structuredClone(historical);
    const sinkDelivery = contradictory.facility.power.byModule["sink"];
    if (sinkDelivery === undefined) throw new Error("Missing sink delivery fixture.");
    sinkDelivery.limitingReason = "contracted-capacity";

    expect(() => {
      assertValidPowerState(contradictory, content);
    }).toThrow("facility.power.byModule.sink.limitingReason");
  });

  test.each([
    {
      name: "non-finite delivery",
      expectedPath: "power.byModule.sink.deliveredPowerWatts",
      corrupt(result: ReturnType<typeof calculateFacilityPower>) {
        const sink = result.power.byModule["sink"];
        if (sink === undefined) throw new Error("Missing sink delivery fixture.");
        sink.deliveredPowerWatts = Number.NaN;
      },
    },
    {
      name: "route flow above capacity",
      expectedPath: "power.byRoute.route-power.deliveredPowerWatts",
      corrupt(result: ReturnType<typeof calculateFacilityPower>) {
        const routeResult = result.power.byRoute["route-power"];
        if (routeResult === undefined) throw new Error("Missing route delivery fixture.");
        routeResult.deliveredPowerWatts = 1_801;
      },
    },
    {
      name: "wrong layout revision",
      expectedPath: "power.layoutRevision",
      corrupt(result: ReturnType<typeof calculateFacilityPower>) {
        result.power.layoutRevision = 99;
      },
    },
    {
      name: "wrong facility total",
      expectedPath: "power.totalDeliveredPowerWatts",
      corrupt(result: ReturnType<typeof calculateFacilityPower>) {
        result.power.totalDeliveredPowerWatts += 1;
      },
    },
    {
      name: "non-Power module mutation",
      expectedPath: "modules.sink",
      corrupt(result: ReturnType<typeof calculateFacilityPower>) {
        const sink = result.modules["sink"];
        if (sink === undefined) throw new Error("Missing sink module fixture.");
        sink.binComputeRatio = 2;
      },
    },
  ])("rejects $name", (testCase) => {
    const previous = createState("targeted-validation");
    const topology = createPowerTopology(previous.facility, content);
    const valid = calculateFacilityPower(previous, content, topology);
    expect(() => {
      assertValidPowerTickResult(previous, valid, topology, content);
    }).not.toThrow();
    const corrupted = structuredClone(valid);
    testCase.corrupt(corrupted);

    expect(() => {
      assertValidPowerTickResult(previous, corrupted, topology, content);
    }).toThrow(testCase.expectedPath);
  });

  test("rejects positive route flow from a source that was unavailable at tick start", () => {
    const previous = createState("targeted-source-eligibility");
    const source = previous.facility.modules["source"];
    if (source === undefined) throw new Error("Missing source fixture.");
    source.operationalState = "starting";
    source.startupTicksRemaining = 1;
    const topology = createPowerTopology(previous.facility, content);
    const corrupted = calculateFacilityPower(previous, content, topology);
    const sinkDelivery = corrupted.power.byModule["sink"];
    const routeDelivery = corrupted.power.byRoute["route-power"];
    if (sinkDelivery === undefined || routeDelivery === undefined) {
      throw new Error("Missing routed delivery fixture.");
    }
    const sinkModule = corrupted.modules["sink"];
    if (sinkModule === undefined) throw new Error("Missing sink module fixture.");
    sinkModule.operationalState = "online";
    sinkDelivery.deliveredPowerWatts = sinkDelivery.requestedPowerWatts;
    sinkDelivery.powerFactor = 1;
    sinkDelivery.limitingReason = "none";
    routeDelivery.deliveredPowerWatts = sinkDelivery.requestedPowerWatts;
    routeDelivery.utilizationRatio = sinkDelivery.requestedPowerWatts / 1_800;
    corrupted.power.totalDeliveredPowerWatts =
      (corrupted.power.byModule["source"]?.deliveredPowerWatts ?? 0) +
      sinkDelivery.deliveredPowerWatts;
    corrupted.power.headroomWatts =
      previous.facility.contractedPowerWatts - corrupted.power.totalDeliveredPowerWatts;
    corrupted.power.energyCostUsdThisTick = calculateEnergyCostUsd(
      corrupted.power.totalDeliveredPowerWatts,
      0.1,
      previous.economy.energyPriceUsdPerKwh,
    );

    expect(() => {
      assertValidPowerTickResult(previous, corrupted, topology, content);
    }).toThrow("must not flow from a source unavailable at tick start");
  });

  test("rejects a contradictory same-generation limiting reason", () => {
    const previous = createState("same-generation-limiting-reason");
    const source = previous.facility.modules["source"];
    if (source === undefined) throw new Error("Missing source fixture.");
    source.operationalState = "starting";
    source.startupTicksRemaining = 1;
    const topology = createPowerTopology(previous.facility, content);
    const corrupted = calculateFacilityPower(previous, content, topology);
    const sinkDelivery = corrupted.power.byModule["sink"];
    if (sinkDelivery === undefined) throw new Error("Missing sink delivery fixture.");
    expect(sinkDelivery.limitingReason).toBe("source-unavailable");
    sinkDelivery.limitingReason = "route-capacity";

    expect(() => {
      assertValidPowerTickResult(previous, corrupted, topology, content);
    }).toThrow("power.byModule.sink.limitingReason");
  });
});

describe("Task 6.1 Power copy-on-write branches", () => {
  test("reuses stable module and Power branches after the authoritative values stop changing", () => {
    const state = createState("power-branch-reuse");
    const topology = createPowerTopology(state.facility, content);
    const first = calculateFacilityPower(state, content, topology);
    state.facility.modules = first.modules;
    state.facility.power = first.power;

    const second = calculateFacilityPower(state, content, topology);

    expect(second.modules).toBe(first.modules);
    expect(second.power).toBe(first.power);
    expect(second.power.byModule).toBe(first.power.byModule);
    expect(second.power.byRoute).toBe(first.power.byRoute);
  });

  test("reused numeric allocation scratch is exactly equivalent and never enters the result", () => {
    const state = createState("allocation-scratch");
    const topology = createPowerTopology(state.facility, content);
    const demands = calculatePowerDemand(state.facility.modules, content, topology.moduleIds);
    const cold = allocatePowerDelivery(state.facility, demands, topology, content);
    const scratch = createPowerAllocationScratch(topology);

    const warm = allocatePowerDelivery(state.facility, demands, topology, content, scratch);
    const calculated = calculateFacilityPower(state, content, topology, scratch);
    state.facility.modules = calculated.modules;
    state.facility.power = calculated.power;
    const steadyDemands = calculatePowerDemand(state.facility.modules, content, topology.moduleIds);
    const reused = allocatePowerDelivery(
      state.facility,
      steadyDemands,
      topology,
      content,
      scratch,
      state.facility.power,
    );
    const validationScratch = createPowerTickValidationScratch(topology);
    expect(() => {
      assertValidPowerTickResult(state, calculated, topology, content, validationScratch);
    }).not.toThrow();

    expect(warm).toEqual(cold);
    expect(reused.byModule).toBe(state.facility.power.byModule);
    expect(reused.byRoute).toBe(state.facility.power.byRoute);
    expect(Object.values(warm)).not.toContain(scratch);
    expect(Object.values(calculated)).not.toContain(validationScratch);
    expect(canonicalSerialize(warm)).toBe(canonicalSerialize(cold));
  });

  test("committed authoritative state contains no topology or scratch containers", () => {
    const core = new SimCore({
      initialState: createState("derived-container-isolation"),
      tickSystems: createPowerTickSystems(content),
    });

    core.step(3);
    const saved = core.getStateForSave();

    expectNoDerivedRuntimeContainers(saved);
    expect(() => {
      canonicalSerialize(saved);
    }).not.toThrow();
  });
});
