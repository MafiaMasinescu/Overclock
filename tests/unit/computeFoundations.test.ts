import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { validateComputeState } from "../../src/sim/compute/computeState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";

function calculatedState(): GameState {
  const state = createInitialGameState({ content: loadContentBundle(), seed: "compute-state" });
  state.facility.compute = {
    layoutRevision: 0,
    thermalRevision: 0,
    byModule: {
      "module-compute-a": {
        moduleInstanceId: "module-compute-a",
        requestedFrequencyRatio: 1,
        operationalRatio: 1,
        theoreticalComputeFlops: 100,
        powerFactor: 1,
        thermalFactor: 1,
        retryRate: 0,
        invalidSampleRate: 0,
        stabilityFactor: 1,
        availableComputeFlops: 100,
      },
    },
    byTask: {
      "task-instance-a": {
        taskInstanceId: "task-instance-a",
        taskDefinitionId: "task-ballistic-table-verification",
        phaseIndex: 0,
        phaseId: "verification",
        clusterModuleIds: ["module-compute-a"],
        requestedShare: 1,
        availableMemoryCapacityBytes: 1,
        availableMemoryBandwidthBytesPerSecond: 1,
        deliveredRouteBandwidthBytesPerSecond: 1,
        extraLatencyMicroseconds: 0,
        retryRate: 0,
        invalidSampleRate: 0,
        meetsStabilityMinimum: true,
        runnable: true,
        blockingReasons: [],
        warnings: [],
        breakdown: {
          theoreticalComputeFlops: 100,
          powerFactor: 1,
          thermalFactor: 1,
          memoryFactor: 1,
          interconnectFactor: 1,
          suitabilityFactor: 1,
          stabilityFactor: 1,
          usefulComputeFlops: 100,
          bottlenecks: [],
        },
      },
    },
    totalTheoreticalComputeFlops: 100,
    totalAvailableComputeFlops: 100,
    totalAllocatedUsefulComputeFlops: 100,
  };
  return state;
}

function validate(state: GameState): { readonly path: string; readonly message: string }[] {
  return validateComputeState(state);
}

describe("Task 9.1 Useful Compute foundations", () => {
  test("keeps dirty and calculated Compute state structurally valid and canonically serializable", () => {
    const dirty = createInitialGameState({ content: loadContentBundle(), seed: "compute-dirty" });

    expect(validate(dirty)).toEqual([]);
    expect(validate(calculatedState())).toEqual([]);
    expect(JSON.parse(canonicalSerialize(calculatedState()))).toEqual(calculatedState());
  });

  test.each([
    {
      name: "requires both dirty revisions and every dirty record and total to be empty",
      change: (state: GameState) => {
        state.facility.compute.layoutRevision = null;
        state.facility.compute.totalAvailableComputeFlops = 1;
      },
      path: "facility.compute.thermalRevision",
    },
    {
      name: "requires stable module and task record ordering",
      change: (state: GameState) => {
        const record = state.facility.compute.byModule["module-compute-a"];
        if (record === undefined) throw new Error("Missing module compute fixture.");
        state.facility.compute.byModule = {
          "module-compute-b": { ...record, moduleInstanceId: "module-compute-b" },
          "module-compute-a": record,
        };
      },
      path: "facility.compute.byModule",
    },
    {
      name: "rejects invalid module factor and available-compute identities",
      change: (state: GameState) => {
        const record = state.facility.compute.byModule["module-compute-a"];
        if (record === undefined) throw new Error("Missing module compute fixture.");
        record.powerFactor = 1.1;
        record.availableComputeFlops = 99;
      },
      path: "facility.compute.byModule.module-compute-a.powerFactor",
    },
    {
      name: "rejects task rates, duplicate cluster membership, and incompatible runnable issues",
      change: (state: GameState) => {
        const record = state.facility.compute.byTask["task-instance-a"];
        if (record === undefined) throw new Error("Missing task compute fixture.");
        record.clusterModuleIds.push("module-compute-a");
        record.retryRate = 2;
        record.blockingReasons = ["no-active-compute"];
      },
      path: "facility.compute.byTask.task-instance-a.clusterModuleIds",
    },
    {
      name: "rejects breakdown and aggregate total identity corruption",
      change: (state: GameState) => {
        const record = state.facility.compute.byTask["task-instance-a"];
        if (record === undefined) throw new Error("Missing task compute fixture.");
        record.breakdown.usefulComputeFlops = 99;
        state.facility.compute.totalAllocatedUsefulComputeFlops = 99;
      },
      path: "facility.compute.byTask.task-instance-a.breakdown.usefulComputeFlops",
    },
  ])("$name", ({ change, path }) => {
    const state = calculatedState();
    change(state);

    expect(validate(state).map((issue) => issue.path)).toContain(path);
  });

  test.each([
    {
      name: "rejects a task Power aggregate that contradicts its module records",
      change: (state: GameState) => {
        const record = state.facility.compute.byTask["task-instance-a"];
        if (record === undefined) throw new Error("Missing task compute fixture.");
        record.breakdown.powerFactor = 0.5;
        record.breakdown.usefulComputeFlops = 50;
        record.breakdown.bottlenecks = [
          {
            factor: "power",
            factorValue: 0.5,
            lostComputeFlops: 50,
            explanationKey: "compute.bottlenecks.power",
          },
        ];
        state.facility.compute.totalAllocatedUsefulComputeFlops = 50;
      },
      path: "facility.compute.byTask.task-instance-a.breakdown.powerFactor",
    },
    {
      name: "rejects a noncanonical bottleneck localization key",
      change: (state: GameState) => {
        const record = state.facility.compute.byTask["task-instance-a"];
        if (record === undefined) throw new Error("Missing task compute fixture.");
        record.breakdown.powerFactor = 0.5;
        record.breakdown.usefulComputeFlops = 50;
        record.breakdown.bottlenecks = [
          {
            factor: "power",
            factorValue: 0.5,
            lostComputeFlops: 50,
            explanationKey: "compute.bottlenecks.not-power",
          },
        ];
        const moduleRecord = state.facility.compute.byModule["module-compute-a"];
        if (moduleRecord === undefined) throw new Error("Missing module compute fixture.");
        moduleRecord.powerFactor = 0.5;
        moduleRecord.availableComputeFlops = 50;
        state.facility.compute.totalAvailableComputeFlops = 50;
        state.facility.compute.totalAllocatedUsefulComputeFlops = 50;
      },
      path: "facility.compute.byTask.task-instance-a.breakdown.bottlenecks.power.explanationKey",
    },
    {
      name: "rejects a disconnected reason with a connected Interconnect Factor",
      change: (state: GameState) => {
        const record = state.facility.compute.byTask["task-instance-a"];
        if (record === undefined) throw new Error("Missing task compute fixture.");
        record.blockingReasons = ["data-disconnected"];
        record.runnable = false;
      },
      path: "facility.compute.byTask.task-instance-a.blockingReasons",
    },
  ])("$name", ({ change, path }) => {
    const state = calculatedState();
    change(state);

    expect(validate(state).map((issue) => issue.path)).toContain(path);
  });

  test("accepts historical allocation delivery after a later stage changes task status", () => {
    const state = calculatedState();
    state.tasks.instances = {
      "task-instance-a": {
        id: "task-instance-a",
        definitionId: "task-ballistic-table-verification",
        status: "completed",
        acceptedAtTick: 0,
        deadlineTick: null,
        currentPhaseIndex: 0,
        phaseCompletedOperations: 0,
        totalCompletedOperations: 0,
        allocation: {
          clusterModuleIds: ["module-compute-a"],
          requestedShare: 1,
          deliveredUsefulComputeFlops: 100,
        },
        accruedPayoutUsd: 0,
      },
    };

    expect(validate(state)).toEqual([]);
  });
});
