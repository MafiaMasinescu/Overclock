import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import * as computeDomain from "../../src/sim/compute/computeDomain.ts";
import { validateComputeState } from "../../src/sim/compute/computeState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";

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

function readyState(): GameState {
  const state = createInitialGameState({ content, seed: "task-9-domain" });
  const compute = module("compute", "module-vacuum-tube-logic");
  state.facility.modules = { compute };
  state.facility.power = {
    layoutRevision: 0,
    totalRequestedPowerWatts: 100,
    totalDeliveredPowerWatts: 100,
    headroomWatts: 0,
    energyCostUsdThisTick: 0,
    byModule: {
      compute: {
        moduleInstanceId: "compute",
        requestedPowerWatts: 100,
        minimumPowerWatts: 10,
        deliveredPowerWatts: 100,
        powerFactor: 1,
        limitingReason: "none",
      },
    },
    byRoute: {},
  };
  state.facility.overclock = {
    layoutRevision: 0,
    thermalRevision: 0,
    byModule: {
      compute: {
        moduleInstanceId: "compute",
        profile: "balanced",
        requestedFrequencyRatio: 1,
        requestedVoltageRatio: 1,
        dynamicPowerFactor: 1,
        sampledTemperatureC: 22,
        thermalFactor: 1,
        retryRate: 0,
        invalidSampleRate: 0,
        stabilityFactor: 1,
        shutdownReason: null,
      },
    },
  };
  return state;
}

function activeTaskState(): GameState {
  const state = readyState();
  const memory = module("memory", "module-accumulator-register");
  const compute = state.facility.modules["compute"];
  if (compute === undefined) throw new Error("Missing compute fixture module.");
  state.facility.modules = { compute, memory };
  state.facility.routes = {
    "data-route": {
      id: "data-route",
      kind: "data",
      from: { moduleInstanceId: "compute", portId: "data-east" },
      to: { moduleInstanceId: "memory", portId: "data-west" },
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      capacityPerSecond: 16_000,
      congestionRatio: 0,
    },
  };
  state.facility.power.byModule["memory"] = {
    moduleInstanceId: "memory",
    requestedPowerWatts: 100,
    minimumPowerWatts: 10,
    deliveredPowerWatts: 100,
    powerFactor: 1,
    limitingReason: "none",
  };
  state.facility.overclock.byModule["memory"] = {
    moduleInstanceId: "memory",
    profile: "balanced",
    requestedFrequencyRatio: 1,
    requestedVoltageRatio: 1,
    dynamicPowerFactor: 1,
    sampledTemperatureC: 22,
    thermalFactor: 1,
    retryRate: 0,
    invalidSampleRate: 0,
    stabilityFactor: 1,
    shutdownReason: null,
  };
  state.tasks.instances = {
    task: {
      id: "task",
      definitionId: "task-ballistic-table-verification",
      status: "active",
      acceptedAtTick: 0,
      deadlineTick: null,
      currentPhaseIndex: 0,
      phaseCompletedOperations: 0,
      totalCompletedOperations: 0,
      allocation: {
        clusterModuleIds: ["compute"],
        requestedShare: 1,
        deliveredUsefulComputeFlops: 0,
      },
      accruedPayoutUsd: 0,
    },
  };
  return state;
}

function addModuleResults(state: GameState, moduleId: string): void {
  state.facility.power.byModule[moduleId] = {
    moduleInstanceId: moduleId,
    requestedPowerWatts: 100,
    minimumPowerWatts: 10,
    deliveredPowerWatts: 100,
    powerFactor: 1,
    limitingReason: "none",
  };
  state.facility.overclock.byModule[moduleId] = {
    moduleInstanceId: moduleId,
    profile: "balanced",
    requestedFrequencyRatio: 1,
    requestedVoltageRatio: 1,
    dynamicPowerFactor: 1,
    sampledTemperatureC: 22,
    thermalFactor: 1,
    retryRate: 0,
    invalidSampleRate: 0,
    stabilityFactor: 1,
    shutdownReason: null,
  };
}

describe("Task 9.2 pure Useful Compute domain", () => {
  test("calculates exact Balanced theoretical and available module compute without mutating inputs", () => {
    const state = readyState();
    const before = structuredClone(state);
    const candidate = Reflect.get(computeDomain, "calculateModuleComputeCapacity");

    expect(typeof candidate).toBe("function");
    if (typeof candidate !== "function")
      throw new Error("Missing Task 9.2 module capacity domain.");
    const result = candidate(state.facility, content) as {
      readonly byModule: Record<string, unknown>;
    };

    expect(result.byModule["compute"]).toMatchObject({
      moduleInstanceId: "compute",
      requestedFrequencyRatio: 1,
      operationalRatio: 1,
      theoreticalComputeFlops: 900,
      availableComputeFlops: 900,
    });
    expect(state).toEqual(before);
  });

  test.each([
    { profile: "eco" as const, binRatio: 0.92, frequencyRatio: 0.85 },
    { profile: "balanced" as const, binRatio: 1, frequencyRatio: 1 },
    { profile: "boost" as const, binRatio: 1.08, frequencyRatio: 1.2 },
  ])(
    "applies $profile bin and requested-frequency ratios exactly once",
    ({ profile, binRatio, frequencyRatio }) => {
      const state = readyState();
      const module = state.facility.modules["compute"];
      const overclock = state.facility.overclock.byModule["compute"];
      if (module === undefined || overclock === undefined) {
        throw new Error("Missing module-ratio fixture inputs.");
      }
      module.binComputeRatio = binRatio;
      module.overclock = { profile, frequencyRatio, voltageRatio: 1 };
      overclock.profile = profile;
      overclock.requestedFrequencyRatio = frequencyRatio;

      const result = computeDomain.calculateModuleComputeCapacity(state.facility, content);

      expect(result.byModule["compute"]?.theoreticalComputeFlops).toBe(
        900 * binRatio * frequencyRatio,
      );
    },
  );

  test.each([
    { state: "starting" as const, requested: 100, delivered: 100 },
    { state: "brownout" as const, requested: 100, delivered: 100 },
    { state: "shutdown" as const, requested: 100, delivered: 100 },
    { state: "online" as const, requested: 10, delivered: 10 },
    { state: "online" as const, requested: 100, delivered: 9 },
  ])(
    "produces zero theoretical compute for $state with requested=$requested and delivered=$delivered",
    ({ state: operationalState, requested, delivered }) => {
      const state = readyState();
      const module = state.facility.modules["compute"];
      const power = state.facility.power.byModule["compute"];
      if (module === undefined || power === undefined) {
        throw new Error("Missing operational-ratio fixture inputs.");
      }
      module.operationalState = operationalState;
      power.requestedPowerWatts = requested;
      power.deliveredPowerWatts = delivered;

      expect(
        computeDomain.calculateModuleComputeCapacity(state.facility, content).byModule["compute"]
          ?.theoreticalComputeFlops,
      ).toBe(0);
    },
  );

  test("uses only explicit bidirectional RouteState paths for task memory and explainable Useful Compute", () => {
    const state = activeTaskState();
    const before = structuredClone(state);
    const topology = computeDomain.buildComputeTopology(state.facility, content);
    const beforePathMetrics = structuredClone(topology.pathMetrics);
    const result = computeDomain.calculateFacilityCompute(state, content, topology);

    expect(result.byTask["task"]).toMatchObject({
      runnable: true,
      blockingReasons: [],
      deliveredRouteBandwidthBytesPerSecond: 16_000,
      extraLatencyMicroseconds: 25,
    });
    expect(result.byTask["task"]?.breakdown.usefulComputeFlops).toBeGreaterThan(0);
    expect(state).toEqual(before);
    expect(topology.pathMetrics).toEqual(beforePathMetrics);
  });

  test("uses local memory bandwidth without requiring a route", () => {
    const state = activeTaskState();
    const compute = state.facility.modules["compute"];
    if (compute === undefined) throw new Error("Missing local-memory compute fixture.");
    state.facility.modules = {
      compute: { ...compute, definitionId: "module-control-unit" },
    };
    state.facility.routes = {};
    const computePower = state.facility.power.byModule["compute"];
    const computeOverclock = state.facility.overclock.byModule["compute"];
    if (computePower === undefined || computeOverclock === undefined) {
      throw new Error("Missing local-memory input results.");
    }
    state.facility.power.byModule = { compute: computePower };
    state.facility.overclock.byModule = { compute: computeOverclock };

    const result = computeDomain.calculateFacilityCompute(state, content).byTask["task"];

    expect(result).toMatchObject({
      availableMemoryCapacityBytes: 128,
      availableMemoryBandwidthBytesPerSecond: 12_000,
      deliveredRouteBandwidthBytesPerSecond: 12_000,
      extraLatencyMicroseconds: 0,
      blockingReasons: [],
    });
    expect(result?.breakdown).toMatchObject({ memoryFactor: 0.5, interconnectFactor: 1 });
  });

  test("uses shortest latency and widest bandwidth paths independently", () => {
    const state = activeTaskState();
    state.facility.modules["relay"] = module("relay", "module-data-relay");
    addModuleResults(state, "relay");
    state.facility.routes = {
      direct: {
        id: "direct",
        kind: "data",
        from: { moduleInstanceId: "compute", portId: "data-west" },
        to: { moduleInstanceId: "memory", portId: "data-west" },
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        capacityPerSecond: 4_000,
        congestionRatio: 0,
      },
      "wide-a": {
        id: "wide-a",
        kind: "data",
        from: { moduleInstanceId: "compute", portId: "data-east" },
        to: { moduleInstanceId: "relay", portId: "data-west" },
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        capacityPerSecond: 12_000,
        congestionRatio: 0,
      },
      "wide-b": {
        id: "wide-b",
        kind: "data",
        from: { moduleInstanceId: "relay", portId: "data-east" },
        to: { moduleInstanceId: "memory", portId: "data-east" },
        path: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        capacityPerSecond: 12_000,
        congestionRatio: 0,
      },
    };

    const result = computeDomain.calculateFacilityCompute(state, content).byTask["task"];

    expect(result).toMatchObject({
      deliveredRouteBandwidthBytesPerSecond: 12_000,
      extraLatencyMicroseconds: 0,
    });
  });

  test("requires explicit directed read and write routes to a memory provider", () => {
    const state = activeTaskState();
    const compute = state.facility.modules["compute"];
    if (compute === undefined) throw new Error("Missing directed-route compute fixture.");
    state.facility.modules["compute"] = {
      ...compute,
      definitionId: "module-arithmetic-unit",
    };
    state.facility.routes = {
      read: {
        id: "read",
        kind: "data",
        from: { moduleInstanceId: "memory", portId: "data-east" },
        to: { moduleInstanceId: "compute", portId: "data-in-north" },
        path: [
          { x: 1, y: 0 },
          { x: 0, y: 0 },
        ],
        capacityPerSecond: 16_000,
        congestionRatio: 0,
      },
      write: {
        id: "write",
        kind: "data",
        from: { moduleInstanceId: "compute", portId: "data-out-east" },
        to: { moduleInstanceId: "memory", portId: "data-west" },
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        capacityPerSecond: 16_000,
        congestionRatio: 0,
      },
    };

    expect(computeDomain.calculateFacilityCompute(state, content).byTask["task"]).toMatchObject({
      runnable: true,
      blockingReasons: [],
    });

    delete state.facility.routes["read"];
    expect(computeDomain.calculateFacilityCompute(state, content).byTask["task"]).toMatchObject({
      runnable: false,
      blockingReasons: ["insufficient-memory-capacity", "data-disconnected"],
      breakdown: { interconnectFactor: 0 },
    });
  });

  test("excludes offline compute modules from phase suitability", () => {
    const state = activeTaskState();
    state.facility.modules["offline-control"] = {
      ...module("offline-control", "module-control-unit"),
      operationalState: "offline",
    };
    addModuleResults(state, "offline-control");
    state.facility.routes["offline-memory"] = {
      id: "offline-memory",
      kind: "data",
      from: { moduleInstanceId: "offline-control", portId: "data-east" },
      to: { moduleInstanceId: "memory", portId: "data-east" },
      path: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      capacityPerSecond: 16_000,
      congestionRatio: 0,
    };
    const task = state.tasks.instances["task"];
    if (task?.allocation === null || task?.allocation === undefined) {
      throw new Error("Missing suitability task allocation fixture.");
    }
    task.allocation.clusterModuleIds = ["compute", "offline-control"];

    const result = computeDomain.calculateFacilityCompute(state, content).byTask["task"];

    expect(result?.breakdown.suitabilityFactor).toBe(0.9);
  });

  test("includes powered non-compute cluster modules in the bidirectionally usable suitability component", () => {
    const state = activeTaskState();
    const task = state.tasks.instances["task"];
    if (task?.allocation === null || task?.allocation === undefined) {
      throw new Error("Missing component-suitability task allocation fixture.");
    }
    task.definitionId = "task-wiring-layout-study";
    task.allocation.clusterModuleIds = ["compute", "memory"];

    const result = computeDomain.calculateFacilityCompute(state, content).byTask["task"];

    expect(result?.breakdown.suitabilityFactor).toBe(1.25);
  });

  test("treats the phase stability minimum as an inclusive warning boundary only", () => {
    const state = activeTaskState();
    const overclock = state.facility.overclock.byModule["compute"];
    const phase = content.tasks["task-ballistic-table-verification"]?.phases[0];
    if (overclock === undefined || phase === undefined) {
      throw new Error("Missing stability-minimum fixture inputs.");
    }
    overclock.retryRate = 1 - phase.stabilityMinimum;
    overclock.invalidSampleRate = 0;
    overclock.stabilityFactor = 1 - overclock.retryRate;

    const atMinimum = computeDomain.calculateFacilityCompute(state, content).byTask["task"];
    expect(atMinimum).toMatchObject({ meetsStabilityMinimum: true, warnings: [] });

    overclock.retryRate += 0.01;
    overclock.stabilityFactor = 1 - overclock.retryRate;
    const belowMinimum = computeDomain.calculateFacilityCompute(state, content).byTask["task"];
    expect(belowMinimum).toMatchObject({
      meetsStabilityMinimum: false,
      warnings: ["stability-below-minimum"],
      runnable: true,
    });
    expect(belowMinimum?.breakdown.usefulComputeFlops).toBeGreaterThan(0);
  });

  test("sums every common powered memory provider while routing through the best provider", () => {
    const state = activeTaskState();
    state.facility.modules["memory-secondary"] = module("memory-secondary", "module-control-unit");
    addModuleResults(state, "memory-secondary");
    state.facility.routes["secondary-memory"] = {
      id: "secondary-memory",
      kind: "data",
      from: { moduleInstanceId: "compute", portId: "data-west" },
      to: { moduleInstanceId: "memory-secondary", portId: "data-west" },
      path: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      capacityPerSecond: 16_000,
      congestionRatio: 0,
    };

    const result = computeDomain.calculateFacilityCompute(state, content).byTask["task"];

    expect(result?.availableMemoryCapacityBytes).toBe(640);
  });

  test("preserves the powered-memory provider prefix when a cached provider turns off", () => {
    const state = activeTaskState();
    state.facility.modules["memory-secondary"] = module(
      "memory-secondary",
      "module-accumulator-register",
    );
    addModuleResults(state, "memory-secondary");
    const stableModuleIds = Object.keys(state.facility.modules).toSorted();
    const initial = computeDomain.refreshPoweredMemoryProviders(
      state.facility,
      content,
      undefined,
      stableModuleIds,
    );
    const secondary = state.facility.modules["memory-secondary"];
    state.facility.modules["memory-secondary"] = {
      ...secondary,
      operationalState: "offline",
    };

    expect(
      computeDomain.refreshPoweredMemoryProviders(
        state.facility,
        content,
        initial,
        stableModuleIds,
      ),
    ).toEqual(["memory"]);
  });

  test("produces structurally valid fixed-order reasons when multiple blockers apply", () => {
    const state = activeTaskState();
    const compute = state.facility.modules["compute"];
    if (compute === undefined) throw new Error("Missing blocked compute fixture.");
    state.facility.modules["compute"] = { ...compute, operationalState: "offline" };
    state.facility.routes = {};
    state.facility.compute = computeDomain.calculateFacilityCompute(state, content);

    expect(state.facility.compute.byTask["task"]?.blockingReasons).toEqual([
      "no-active-compute",
      "insufficient-memory-capacity",
      "data-disconnected",
    ]);
    expect(validateComputeState(state)).toEqual([]);
  });

  test("rejects an allocation that names a module outside the authoritative facility", () => {
    const state = activeTaskState();
    const task = state.tasks.instances["task"];
    if (task?.allocation === null || task?.allocation === undefined) {
      throw new Error("Missing allocation-membership fixture.");
    }
    task.allocation.clusterModuleIds = ["missing-module"];

    expect(() => computeDomain.calculateFacilityCompute(state, content)).toThrow(
      "Allocation references unknown module missing-module.",
    );
  });

  test("rejects a contradictory fresh facility Compute result", () => {
    const state = activeTaskState();
    const calculation = computeDomain.calculateFacilityCompute(state, content);
    calculation.totalAllocatedUsefulComputeFlops += 1;

    expect(computeDomain.validateFreshComputeCalculation(state, content, calculation)).toEqual([
      "Compute calculation does not match its exact inputs.",
    ]);
  });

  test("validates a fresh calculation once with immutable exact evidence", () => {
    const state = activeTaskState();
    const topology = computeDomain.buildComputeTopology(state.facility, content);
    const transaction = computeDomain.calculateFacilityComputeWithWitness(state, content, topology);

    expect(
      computeDomain.validateFreshComputeWitness(
        state,
        content,
        transaction.compute,
        transaction.witness,
        topology,
      ),
    ).toEqual([]);
    expect(transaction.compute).toBe(transaction.witness.expected);
    expect(Object.isFrozen(transaction.compute)).toBe(true);
    expect(Object.isFrozen(transaction.compute.byTask)).toBe(true);
    expect(Object.isFrozen(transaction.compute.byTask["task"]?.breakdown.bottlenecks)).toBe(true);

    const tampered = structuredClone(transaction.compute);
    const tamperedModule = tampered.byModule["compute"];
    const tamperedTask = tampered.byTask["task"];
    if (tamperedModule === undefined || tamperedTask === undefined) {
      throw new Error("Missing detached Compute evidence fixture records.");
    }
    tampered.totalAllocatedUsefulComputeFlops += 1;
    tamperedModule.availableComputeFlops += 1;
    tamperedTask.deliveredRouteBandwidthBytesPerSecond += 1;
    tamperedTask.blockingReasons = ["data-disconnected"];
    tamperedTask.breakdown.usefulComputeFlops += 1;

    expect(
      computeDomain.validateFreshComputeWitness(
        state,
        content,
        tampered,
        transaction.witness,
        topology,
      ),
    ).toEqual(["Compute candidate does not match its detached exact calculation evidence."]);
    expect(transaction.witness.expected.totalAllocatedUsefulComputeFlops).toBe(
      transaction.compute.totalAllocatedUsefulComputeFlops,
    );
  });

  test("invalidates a fresh witness when an actual Compute input branch changes", () => {
    const state = activeTaskState();
    const transaction = computeDomain.calculateFacilityComputeWithWitness(state, content);
    const topology = computeDomain.buildComputeTopology(state.facility, content);
    const route = state.facility.routes["data-route"];
    if (route === undefined) throw new Error("Missing data route fixture.");
    const changedState: GameState = {
      ...state,
      facility: {
        ...state.facility,
        routes: {
          ...state.facility.routes,
          "data-route": { ...route, congestionRatio: 0.5 },
        },
      },
    };

    expect(
      computeDomain.validateFreshComputeWitness(
        changedState,
        content,
        transaction.compute,
        transaction.witness,
        topology,
      ),
    ).toEqual(["Compute calculation inputs changed before candidate-state validation."]);
  });
});
