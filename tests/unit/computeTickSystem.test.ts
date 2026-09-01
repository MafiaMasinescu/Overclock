import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import type { StructuralSharingTickSystemContext } from "../../src/sim/core/tickSystems.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();

function guidanceCommand(): Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> {
  return {
    commandId: "95000000-0000-4000-8000-000000000001",
    source: "debug",
    kind: "SET_GUIDANCE_MODE",
    mode: "engineering",
  };
}

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
  const state = createInitialGameState({ content, seed: "task-9-3-compute" });
  const compute = module("compute", "module-vacuum-tube-logic");
  const memory = module("memory", "module-accumulator-register");
  state.facility.modules = { compute, memory };
  state.facility.power = {
    layoutRevision: 0,
    totalRequestedPowerWatts: 200,
    totalDeliveredPowerWatts: 200,
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
      memory: {
        moduleInstanceId: "memory",
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
      memory: {
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
      },
    },
  };
  state.facility.routes = {
    "data-route": {
      id: "data-route",
      kind: "data",
      from: { moduleInstanceId: "compute", portId: "data-east" },
      to: { moduleInstanceId: "memory", portId: "data-west" },
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      capacityPerSecond: 16_000,
      congestionRatio: 0,
    },
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
      serviceWindowCompliant: null,
    },
  };
  state.tasks.offers = [];
  return state;
}

describe("production Useful Compute tick system", () => {
  test("performs exactly one full facility calculation for a fresh Compute tick", () => {
    let calculations = 0;
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: createComputeTickSystems(content, {
        onFacilityCalculation() {
          calculations += 1;
        },
      }),
    });

    core.step();

    expect(calculations).toBe(1);
    expect(core.getStateForSave().facility.compute.byTask["task"]?.taskInstanceId).toBe("task");
  });

  test("calculates active allocation delivery on a real tick without consuming RNG", () => {
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: createComputeTickSystems(content),
    });
    const before = core.getStateForSave();
    const beforeSerialized = canonicalSerialize(before);

    expect(core.step(0)).toMatchObject({ ticksExecuted: 0, startTick: 0, endTick: 0 });
    expect(canonicalSerialize(core.getStateForSave())).toBe(beforeSerialized);
    core.step();

    const after = core.getStateForSave();
    expect(after.facility.compute.byModule["compute"]?.availableComputeFlops).toBe(900);
    expect(after.facility.compute.byTask["task"]?.breakdown.usefulComputeFlops).toBeGreaterThan(0);
    expect(after.tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops).toBe(
      after.facility.compute.byTask["task"]?.breakdown.usefulComputeFlops,
    );
    expect(after.rngState).toBe(before.rngState);
  });

  test("rejects later-stage delivery tampering and rolls back the complete tick and RNG", () => {
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        ...createComputeTickSystems(content),
        "advance-tasks-and-benchmarks": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state, rng }: StructuralSharingTickSystemContext) {
                rng.nextUint32();
                const task = state.tasks.instances["task"];
                if (!task?.allocation) throw new Error("Missing task allocation fixture.");
                return {
                  ...state,
                  tasks: {
                    ...state.tasks,
                    instances: {
                      ...state.tasks.instances,
                      task: {
                        ...task,
                        allocation: {
                          ...task.allocation,
                          deliveredUsefulComputeFlops:
                            task.allocation.deliveredUsefulComputeFlops + 1,
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
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(/advance-tasks-and-benchmarks/);
    expect(core.getStateForSave()).toEqual(before);
    expect(core.getStateForSave().rngState).toBe(before.rngState);
  });

  test("recalculates after a command-only allocation output change", () => {
    let calculations = 0;
    const core = new SimCore({
      initialState: readyState(),
      commandHandlers: {
        SET_GUIDANCE_MODE({ state }) {
          const allocation = state.tasks.instances["task"]?.allocation;
          if (allocation === null || allocation === undefined) {
            throw new Error("Missing command delivery fixture.");
          }
          allocation.deliveredUsefulComputeFlops = 0;
        },
      },
      tickSystems: createComputeTickSystems(content, {
        onFacilityCalculation() {
          calculations += 1;
        },
      }),
    });
    core.step();
    const calculatedDelivery =
      core.getStateForSave().tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops;
    if (calculatedDelivery === undefined || calculatedDelivery === 0) {
      throw new Error("Missing calculated delivery fixture.");
    }

    core.enqueue(guidanceCommand());
    expect(core.processPendingCommands()).toHaveLength(1);
    expect(
      core.getStateForSave().tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops,
    ).toBe(0);
    expect(calculations).toBe(1);

    core.step();
    expect(calculations).toBe(2);
    expect(
      core.getStateForSave().tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops,
    ).toBe(calculatedDelivery);
  });

  test("recalculates when an earlier stage changes only the owned delivery output", () => {
    const cacheEvents: string[] = [];
    let allocationRuns = 0;
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                allocationRuns += 1;
                if (allocationRuns !== 2) return state;
                const task = state.tasks.instances["task"];
                if (!task?.allocation) throw new Error("Missing allocation-stage fixture.");
                return {
                  ...state,
                  tasks: {
                    ...state.tasks,
                    instances: {
                      ...state.tasks.instances,
                      task: {
                        ...task,
                        allocation: { ...task.allocation, deliveredUsefulComputeFlops: 0 },
                      },
                    },
                  },
                };
              },
            };
          },
        },
        ...createComputeTickSystems(content, {
          onComputeResultCacheEvent(event) {
            cacheEvents.push(event);
          },
        }),
      },
    });

    core.step();
    const expectedDelivery =
      core.getStateForSave().tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops;
    core.step();

    expect(cacheEvents).toEqual(["calculated", "calculated"]);
    expect(
      core.getStateForSave().tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops,
    ).toBe(expectedDelivery);
  });

  test("reuses cached Compute after progress-only task changes preserve delivery", () => {
    const cacheEvents: string[] = [];
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        ...createComputeTickSystems(content, {
          onComputeResultCacheEvent(event) {
            cacheEvents.push(event);
          },
        }),
        "advance-tasks-and-benchmarks": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                const task = state.tasks.instances["task"];
                if (task === undefined) throw new Error("Missing progress fixture.");
                return {
                  ...state,
                  tasks: {
                    ...state.tasks,
                    instances: {
                      ...state.tasks.instances,
                      task: {
                        ...task,
                        phaseCompletedOperations: task.phaseCompletedOperations + 1,
                        totalCompletedOperations: task.totalCompletedOperations + 1,
                        accruedPayoutUsd: task.accruedPayoutUsd + 1,
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

    core.step(2);

    expect(cacheEvents).toEqual(["calculated", "reused"]);
  });

  test("rejects overcommitted allocations atomically", () => {
    const state = readyState();
    const task = state.tasks.instances["task"];
    if (!task?.allocation) throw new Error("Missing task fixture.");
    state.tasks.instances = {
      first: { ...task, id: "first", allocation: { ...task.allocation, requestedShare: 0.75 } },
      second: {
        ...task,
        id: "second",
        definitionId: "task-wiring-layout-study",
        allocation: { ...task.allocation, requestedShare: 0.75 },
      },
    };
    expect(
      () =>
        new SimCore({
          initialState: state,
          tickSystems: createComputeTickSystems(content),
        }),
    ).toThrow(/active requested shares/);
  });

  test("recalculates dynamic congestion without reconstructing the cached route topology", () => {
    const topologyEvents: string[] = [];
    const resultEvents: string[] = [];
    let workloadRuns = 0;
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                workloadRuns += 1;
                if (workloadRuns !== 2) return state;
                const route = state.facility.routes["data-route"];
                if (route === undefined) throw new Error("Missing route fixture.");
                return {
                  ...state,
                  facility: {
                    ...state.facility,
                    routes: {
                      ...state.facility.routes,
                      "data-route": { ...route, congestionRatio: 1 },
                    },
                  },
                };
              },
            };
          },
        },
        ...createComputeTickSystems(content, {
          onTopologyCacheEvent(event) {
            topologyEvents.push(event);
          },
          onComputeResultCacheEvent(event) {
            resultEvents.push(event);
          },
        }),
      },
    });

    core.step();
    const beforeCongestion = core.getStateForSave();
    core.step();
    const afterCongestion = core.getStateForSave();
    core.step();

    expect(
      afterCongestion.facility.compute.byTask["task"]?.deliveredRouteBandwidthBytesPerSecond,
    ).toBe(0);
    expect(afterCongestion.facility.compute.totalAllocatedUsefulComputeFlops).toBeLessThan(
      beforeCongestion.facility.compute.totalAllocatedUsefulComputeFlops,
    );
    expect(topologyEvents).toEqual(["clear", "rebuild", "hit", "hit"]);
    expect(resultEvents).toEqual(["calculated", "calculated", "reused"]);
  });

  test("rejects a structural route change that does not advance the layout revision", () => {
    let workloadRuns = 0;
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        "calculate-workload-allocation": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                workloadRuns += 1;
                if (workloadRuns !== 2) return state;
                const route = state.facility.routes["data-route"];
                if (route === undefined) throw new Error("Missing route fixture.");
                return {
                  ...state,
                  facility: {
                    ...state.facility,
                    routes: {
                      ...state.facility.routes,
                      "data-route": {
                        ...route,
                        path: [...route.path, { x: 2, y: 0 }],
                      },
                    },
                  },
                };
              },
            };
          },
        },
        ...createComputeTickSystems(content),
      },
    });
    core.step();
    const before = canonicalSerialize(core.getStateForSave());

    expect(() => core.step()).toThrow(/calculate-theoretical-and-useful-compute/);
    expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  });

  test("accepts a completed task's historical Compute record before removing it next tick", () => {
    let completionRuns = 0;
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        ...createComputeTickSystems(content),
        "advance-tasks-and-benchmarks": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                completionRuns += 1;
                if (completionRuns !== 1) return state;
                const task = state.tasks.instances["task"];
                if (task === undefined) throw new Error("Missing task fixture.");
                return {
                  ...state,
                  tasks: {
                    ...state.tasks,
                    instances: {
                      ...state.tasks.instances,
                      task: { ...task, status: "completed" as const },
                    },
                  },
                };
              },
            };
          },
        },
      },
    });

    expect(() => core.step()).not.toThrow();
    const historical = core.getStateForSave();
    expect(historical.tasks.instances["task"]?.status).toBe("completed");
    expect(historical.facility.compute.byTask["task"]?.phaseId).toBe("phase-input-check");

    core.step();
    const recalculated = core.getStateForSave();
    expect(recalculated.facility.compute.byTask).toEqual({});
    expect(recalculated.tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops).toBe(0);
  });

  test("zeros retained inactive allocation delivery without changing its allocation decision", () => {
    const state = readyState();
    const task = state.tasks.instances["task"];
    if (!task?.allocation) throw new Error("Missing task fixture.");
    state.tasks.instances = {
      task: {
        ...task,
        status: "hold",
        allocation: { ...task.allocation, deliveredUsefulComputeFlops: 123 },
      },
    };
    const core = new SimCore({
      initialState: state,
      tickSystems: createComputeTickSystems(content),
    });

    core.step();
    const after = core.getStateForSave();
    expect(after.tasks.instances["task"]?.allocation).toEqual({
      clusterModuleIds: ["compute"],
      requestedShare: 1,
      deliveredUsefulComputeFlops: 0,
    });
    expect(after.facility.compute.byTask).toEqual({});
  });

  test("delivers two valid shared allocations without normalizing their shares", () => {
    const state = readyState();
    const task = state.tasks.instances["task"];
    if (!task?.allocation) throw new Error("Missing task fixture.");
    state.tasks.instances = {
      first: { ...task, id: "first", allocation: { ...task.allocation, requestedShare: 0.5 } },
      second: {
        ...task,
        id: "second",
        definitionId: "task-wiring-layout-study",
        allocation: { ...task.allocation, requestedShare: 0.5 },
      },
    };
    const core = new SimCore({
      initialState: state,
      tickSystems: createComputeTickSystems(content),
    });

    core.step();
    const after = core.getStateForSave();
    expect(after.tasks.instances["first"]?.allocation?.requestedShare).toBe(0.5);
    expect(after.tasks.instances["second"]?.allocation?.requestedShare).toBe(0.5);
    expect(after.tasks.instances["first"]?.allocation?.deliveredUsefulComputeFlops).toBeGreaterThan(
      0,
    );
    expect(
      after.tasks.instances["second"]?.allocation?.deliveredUsefulComputeFlops,
    ).toBeGreaterThan(0);
    expect(after.facility.compute.totalAllocatedUsefulComputeFlops).toBe(
      (after.tasks.instances["first"]?.allocation?.deliveredUsefulComputeFlops ?? 0) +
        (after.tasks.instances["second"]?.allocation?.deliveredUsefulComputeFlops ?? 0),
    );
  });

  test("uses current Task 8 shutdown state after the fixed overclock stage", () => {
    const stages: string[] = [];
    const core = new SimCore({
      initialState: readyState(),
      tickSystems: {
        "apply-throttling-stability-and-shutdown": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                stages.push("apply-throttling-stability-and-shutdown");
                const compute = state.facility.modules["compute"];
                if (compute === undefined) throw new Error("Missing compute fixture.");
                return {
                  ...state,
                  facility: {
                    ...state.facility,
                    modules: {
                      ...state.facility.modules,
                      compute: { ...compute, operationalState: "shutdown" as const },
                    },
                  },
                };
              },
            };
          },
        },
        ...createComputeTickSystems(content),
      },
    });

    core.step();
    const after = core.getStateForSave();
    expect(after.facility.compute.byModule["compute"]?.operationalRatio).toBe(0);
    expect(after.tasks.instances["task"]?.allocation?.deliveredUsefulComputeFlops).toBe(0);
    expect(stages).toEqual(["apply-throttling-stability-and-shutdown"]);
  });

  test("uses current Power, Thermal, and Stability results in the stage calculation", () => {
    const state = readyState();
    const power = state.facility.power.byModule["compute"];
    const overclock = state.facility.overclock.byModule["compute"];
    if (power === undefined || overclock === undefined)
      throw new Error("Missing compute result fixture.");
    state.facility.power.byModule["compute"] = { ...power, powerFactor: 0.5 };
    state.facility.overclock.byModule["compute"] = {
      ...overclock,
      thermalFactor: 0.5,
      retryRate: 0.1,
      invalidSampleRate: 0.1,
      stabilityFactor: 0.8,
    };
    const core = new SimCore({
      initialState: state,
      tickSystems: createComputeTickSystems(content),
    });

    core.step();
    const result = core.getStateForSave().facility.compute;
    expect(result.byModule["compute"]?.availableComputeFlops).toBe(180);
    expect(result.byTask["task"]?.breakdown).toMatchObject({
      powerFactor: 0.5,
      thermalFactor: 0.5,
      stabilityFactor: 0.8,
    });
  });

  test("keeps startup completion at zero until the following full-load tick", () => {
    const state = readyState();
    const compute = state.facility.modules["compute"];
    if (compute === undefined) throw new Error("Missing compute fixture.");
    state.facility.modules = {
      ...state.facility.modules,
      compute: { ...compute, operationalState: "starting", startupTicksRemaining: 1 },
    };
    let powerRuns = 0;
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        "calculate-power-demand-and-delivery": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                powerRuns += 1;
                const currentCompute = state.facility.modules["compute"];
                const delivery = state.facility.power.byModule["compute"];
                if (currentCompute === undefined || delivery === undefined)
                  throw new Error("Missing startup fixture.");
                const fullLoad = powerRuns > 1;
                return {
                  ...state,
                  facility: {
                    ...state.facility,
                    modules: {
                      ...state.facility.modules,
                      compute: {
                        ...currentCompute,
                        operationalState: "online" as const,
                        startupTicksRemaining: 0,
                      },
                    },
                    power: {
                      ...state.facility.power,
                      byModule: {
                        ...state.facility.power.byModule,
                        compute: {
                          ...delivery,
                          requestedPowerWatts: fullLoad ? 100 : delivery.minimumPowerWatts,
                          deliveredPowerWatts: fullLoad ? 100 : delivery.minimumPowerWatts,
                        },
                      },
                    },
                  },
                };
              },
            };
          },
        },
        ...createComputeTickSystems(content),
      },
    });

    core.step();
    expect(
      core.getStateForSave().facility.compute.byModule["compute"]?.theoreticalComputeFlops,
    ).toBe(0);
    core.step();
    expect(
      core.getStateForSave().facility.compute.byModule["compute"]?.theoreticalComputeFlops,
    ).toBe(900);
  });

  test("invalidates private caches on state replacement and remains deterministic for 100 ticks", () => {
    const events: string[] = [];
    const first = new SimCore({
      initialState: readyState(),
      tickSystems: createComputeTickSystems(content, {
        onTopologyCacheEvent(event) {
          events.push(event);
        },
      }),
    });
    const second = new SimCore({
      initialState: readyState(),
      tickSystems: createComputeTickSystems(content),
    });

    first.step();
    first.replaceState(first.getStateForSave());
    first.step(99);
    second.step(100);

    expect(events).toEqual([
      "clear",
      "rebuild",
      "clear",
      "rebuild",
      ...Array.from({ length: 98 }, () => "hit"),
    ]);
    expect(first.getStateForSave()).toEqual(second.getStateForSave());
    expect(first.getStateForSave().rngState).toBe(second.getStateForSave().rngState);
  });
});
