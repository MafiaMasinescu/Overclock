import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { BenchmarkResult, GameState } from "../../src/sim/core/types.ts";
import { createResearchTickSystems } from "../../src/sim/research/facilityResearch.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const FINAL = "research-transistor-theory";

function benchmark(runId: string, benchmarkId: string): BenchmarkResult {
  return {
    runId,
    benchmarkId,
    clusterModuleIds: ["module-instance-00000001"],
    passed: true,
    startedAtTick: 0,
    durationTicks: 10,
    averageUsefulComputeFlops: 100,
    peakUsefulComputeFlops: 100,
    peakPowerWatts: 50,
    averagePowerWatts: 25,
    maxTemperatureC: 40,
    minimumPowerHeadroomWatts: 10,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {},
  };
}

function finalLifecycleState(): GameState {
  const state = createInitialGameState({ content, seed: "research-exact-100" });
  for (const nodeId of Object.keys(state.research.statuses)) {
    state.research.statuses[nodeId] = nodeId === FINAL ? "active" : "completed";
  }
  state.research.active = {
    nodeId: FINAL,
    startedAtTick: 0,
    completedOperations: 0,
    reservedComputeShare: 0.2,
  };
  state.research.evidenceTags = ["evidence-semiconductor-effect"];
  state.benchmarks.history = [
    benchmark("benchmark-run-00000001", "benchmark-peak-throughput"),
    benchmark("benchmark-run-00000002", "benchmark-sustained-stability"),
  ];
  state.benchmarks.bestRunByBenchmark = {
    "benchmark-peak-throughput": "benchmark-run-00000001",
    "benchmark-sustained-stability": "benchmark-run-00000002",
  };
  state.benchmarks.nextBenchmarkRunSequence = 3;
  state.facility.compute = {
    layoutRevision: 0,
    thermalRevision: 0,
    byModule: {},
    byTask: {},
    research: {
      nodeId: FINAL,
      reservedComputeShare: 0.2,
      facilityAvailableComputeFlops: 900_000,
      deliveredUsefulComputeFlops: 180_000,
    },
    totalTheoreticalComputeFlops: 0,
    totalAvailableComputeFlops: 0,
    totalAllocatedUsefulComputeFlops: 0,
  };
  return state;
}

function runResearchLifecycle() {
  const core = new SimCore({
    initialState: finalLifecycleState(),
    tickSystems: createResearchTickSystems(content),
  });
  const initialRngState = core.getStateForSave().rngState;
  core.step(100);
  const finalState = core.getStateForSave();
  return {
    state: finalState,
    finalHash: hashCanonicalState(finalState),
    rngUnchanged: finalState.rngState === initialRngState,
  };
}

describe("Research lifecycle determinism", () => {
  test("repeats the exact 100-tick final reveal and hash 100 times", () => {
    const expected = runResearchLifecycle();

    expect(expected.state.tick).toBe(100);
    expect(expected.state.research.active).toBeNull();
    expect(expected.state.research.statuses[FINAL]).toBe("completed");
    expect(expected.state.museum.snapshots).toHaveLength(1);
    expect(expected.rngUnchanged).toBe(true);

    for (let run = 1; run < 100; run += 1) {
      expect(runResearchLifecycle()).toEqual(expected);
    }
  }, 30_000);
});
