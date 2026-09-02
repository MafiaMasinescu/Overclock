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
          researchFactor: 1,
          stabilityFactor: 1,
          usefulComputeFlops: 100,
          bottlenecks: [],
        },
      },
    },
    research: null,
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

  test("keeps historical Research delivery separate from the Task useful-compute total", () => {
    const state = calculatedState();
    state.facility.compute.research = {
      nodeId: "research-stable-power-distribution",
      reservedComputeShare: 0.25,
      facilityAvailableComputeFlops: 200,
      deliveredUsefulComputeFlops: 50,
    };

    expect(validate(state)).toEqual([]);
    expect(state.facility.compute.totalAllocatedUsefulComputeFlops).toBe(100);
  });

  test.each([
    {
      name: "zero reservation",
      research: {
        nodeId: "research-stable-power-distribution",
        reservedComputeShare: 0,
        facilityAvailableComputeFlops: 100,
        deliveredUsefulComputeFlops: 0,
      },
      path: "facility.compute.research.reservedComputeShare",
    },
    {
      name: "non-string node ID",
      research: {
        nodeId: 42,
        reservedComputeShare: 0.25,
        facilityAvailableComputeFlops: 100,
        deliveredUsefulComputeFlops: 25,
      },
      path: "facility.compute.research.nodeId",
    },
  ])("rejects historical Research Compute with $name", ({ research, path }) => {
    const state = calculatedState();
    state.facility.compute.research =
      research as unknown as GameState["facility"]["compute"]["research"];

    expect(validate(state)).toContainEqual(expect.objectContaining({ path }));
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
        serviceWindowCompliant: null,
      },
    };

    expect(validate(state)).toEqual([]);
  });

  test.each([
    ["requested frequency zero", "requestedFrequencyRatio", 0],
    ["requested frequency negative zero", "requestedFrequencyRatio", -0],
    ["fractional operational ratio", "operationalRatio", 0.5],
    ["operational negative zero", "operationalRatio", -0],
  ] as const)("rejects %s in a stored module result", (_name, field, value) => {
    const state = calculatedState();
    const result = state.facility.compute.byModule["module-compute-a"];
    if (result === undefined) throw new Error("Missing module compute fixture.");
    result[field] = value;
    if (field === "operationalRatio") {
      result.theoreticalComputeFlops = value * 100;
      result.availableComputeFlops = value * 100;
      state.facility.compute.totalTheoreticalComputeFlops = value * 100;
      state.facility.compute.totalAvailableComputeFlops = value * 100;
      const task = state.facility.compute.byTask["task-instance-a"];
      if (task === undefined) throw new Error("Missing task compute fixture.");
      task.breakdown.theoreticalComputeFlops = value * 100;
      task.breakdown.usefulComputeFlops = value * 100;
      state.facility.compute.totalAllocatedUsefulComputeFlops = value * 100;
    }

    expect(validate(state).map((issue) => issue.path)).toContain(
      `facility.compute.byModule.module-compute-a.${field}`,
    );
  });

  test.each([0, 1] as const)("accepts operational ratio %s", (operationalRatio) => {
    const state = calculatedState();
    const result = state.facility.compute.byModule["module-compute-a"];
    if (result === undefined) throw new Error("Missing module compute fixture.");
    result.operationalRatio = operationalRatio;
    result.theoreticalComputeFlops = operationalRatio * 100;
    result.availableComputeFlops = operationalRatio * 100;
    state.facility.compute.totalTheoreticalComputeFlops = operationalRatio * 100;
    state.facility.compute.totalAvailableComputeFlops = operationalRatio * 100;
    if (operationalRatio === 0) {
      state.facility.compute.byTask = {};
      state.facility.compute.totalAllocatedUsefulComputeFlops = 0;
    }

    expect(validate(state)).toEqual([]);
  });
});
