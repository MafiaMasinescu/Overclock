import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import {
  advanceBenchmarkRun,
  clearBenchmarkAdvanceEvidence,
} from "../../src/sim/benchmarks/benchmarkDomain.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const MODULE_ID = "module-instance-00000001";
const OVERCLOCK = { profile: "balanced" as const, frequencyRatio: 1, voltageRatio: 1 };

function createBenchmarkState(benchmarkId: string): GameState {
  return {
    tick: 0,
    facility: {
      ambientTemperatureC: 16,
      modules: {
        [MODULE_ID]: {
          id: MODULE_ID,
          definitionId: "module-vacuum-tube-logic",
          operationalState: "online",
          overclock: OVERCLOCK,
        },
      },
      compute: {
        byModule: {
          [MODULE_ID]: {
            moduleInstanceId: MODULE_ID,
            requestedFrequencyRatio: 1,
            operationalRatio: 1,
            theoreticalComputeFlops: 20_000,
            powerFactor: 1,
            thermalFactor: 1,
            retryRate: 0,
            invalidSampleRate: 0,
            stabilityFactor: 1,
            availableComputeFlops: 20_000,
          },
        },
      },
      power: {
        totalDeliveredPowerWatts: 10,
        headroomWatts: 50,
        energyCostUsdThisTick: 0,
      },
      thermalTiles: [{ position: { x: 0, y: 0 }, temperatureC: 20 }],
    },
    benchmarks: {
      nextBenchmarkRunSequence: 2,
      active: {
        runId: "benchmark-run-00000001",
        benchmarkId,
        startedAtTick: 0,
        elapsedTicks: 0,
        clusterModuleIds: [MODULE_ID],
        accumulatedUsefulComputeFlops: 0,
        peakUsefulComputeFlops: 0,
        accumulatedPowerWatts: 0,
        peakPowerWatts: 0,
        maxTemperatureC: null,
        minimumPowerHeadroomWatts: null,
        accumulatedRetryRate: 0,
        accumulatedValidSampleRate: 0,
        accumulatedCostUsd: 0,
        shutdownObserved: false,
        overclockSummary: { [MODULE_ID]: OVERCLOCK },
      },
      history: [],
      bestRunByBenchmark: {},
    },
  } as unknown as GameState;
}

function runFixture(benchmarkId: string, durationTicks: number) {
  let state = createBenchmarkState(benchmarkId);
  for (let tick = 0; tick < durationTicks; tick += 1) {
    const active = state.benchmarks.active;
    if (active === null) throw new Error("Benchmark ended before its exact duration.");
    const calculation = advanceBenchmarkRun(active, state, content);
    clearBenchmarkAdvanceEvidence(calculation.witness);
    state = {
      ...state,
      tick: state.tick + 1,
      benchmarks: calculation.result.benchmarks,
    };
  }
  const result = state.benchmarks.history[0];
  if (result === undefined) throw new Error("Benchmark did not produce a result.");
  return {
    tick: state.tick,
    sequence: state.benchmarks.nextBenchmarkRunSequence,
    result,
    bestRunId: state.benchmarks.bestRunByBenchmark[benchmarkId],
    finalHash: hashCanonicalState(state),
  };
}

describe("Benchmark determinism", () => {
  test("repeats the exact Peak sequence, result, and final hash 100 times", () => {
    const expected = runFixture("benchmark-peak-throughput", 150);
    expect(expected).toMatchObject({
      tick: 150,
      sequence: 2,
      result: {
        runId: "benchmark-run-00000001",
        benchmarkId: "benchmark-peak-throughput",
        durationTicks: 150,
        averageUsefulComputeFlops: 20_000,
        peakUsefulComputeFlops: 20_000,
        averagePowerWatts: 10,
        peakPowerWatts: 10,
        maxTemperatureC: 20,
        minimumPowerHeadroomWatts: 50,
        retryRate: 0,
        validSampleRate: 1,
        costUsd: 0,
        passed: true,
        failureReasons: [],
      },
      bestRunId: "benchmark-run-00000001",
      finalHash: "71d63abb2a2c8cb6",
    });
    for (let run = 1; run < 100; run += 1) {
      expect(runFixture("benchmark-peak-throughput", 150)).toEqual(expected);
    }
  }, 15_000);

  test("repeats the exact Sustained sequence, result, and final hash 100 times", () => {
    const expected = runFixture("benchmark-sustained-stability", 1_200);
    expect(expected).toMatchObject({
      tick: 1_200,
      sequence: 2,
      result: {
        runId: "benchmark-run-00000001",
        benchmarkId: "benchmark-sustained-stability",
        durationTicks: 1_200,
        averageUsefulComputeFlops: 20_000,
        peakUsefulComputeFlops: 20_000,
        averagePowerWatts: 10,
        peakPowerWatts: 10,
        maxTemperatureC: 20,
        minimumPowerHeadroomWatts: 50,
        retryRate: 0,
        validSampleRate: 1,
        costUsd: 0,
        passed: true,
        failureReasons: [],
      },
      bestRunId: "benchmark-run-00000001",
      finalHash: "9865fdde48a6deb6",
    });
    for (let run = 1; run < 100; run += 1) {
      expect(runFixture("benchmark-sustained-stability", 1_200)).toEqual(expected);
    }
  }, 15_000);
});
