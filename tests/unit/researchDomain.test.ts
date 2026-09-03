import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { BenchmarkResult, GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import {
  advanceResearchSystem,
  isFeatureUnlocked,
  isModuleUnlocked,
  validateFreshResearchAdvance,
} from "../../src/sim/research/researchDomain.ts";

const content = loadContentBundle();
const ROOT = "research-stable-power-distribution";
const RELIABILITY = "research-vacuum-tube-reliability";
const FORCED_AIRFLOW = "research-forced-airflow";
const ACCUMULATOR = "research-accumulator-design";
const MODULAR_WIRING = "research-modular-wiring";
const FINAL = "research-transistor-theory";
const FINAL_SNAPSHOT = "museum-vacuum-tube-final";

function state(): GameState {
  return createInitialGameState({ content, seed: "research-domain" });
}

function makeActiveState(
  nodeId = ROOT,
  reservedComputeShare = 0.1,
  completedOperations = 0,
): GameState {
  const next = state();
  next.research.statuses[nodeId] = "active";
  next.research.active = {
    nodeId,
    startedAtTick: next.tick,
    completedOperations,
    reservedComputeShare,
  };
  return next;
}

function installResearchCompute(
  next: GameState,
  nodeId: string,
  reservedComputeShare: number,
  deliveredUsefulComputeFlops: number,
  facilityAvailableComputeFlops = deliveredUsefulComputeFlops / reservedComputeShare,
): void {
  next.facility.compute = {
    layoutRevision: 0,
    thermalRevision: 0,
    byModule: {},
    byTask: {},
    research: {
      nodeId,
      reservedComputeShare,
      facilityAvailableComputeFlops,
      deliveredUsefulComputeFlops,
    },
    totalTheoreticalComputeFlops: 0,
    totalAvailableComputeFlops: 0,
    totalAllocatedUsefulComputeFlops: 0,
  };
}

function validBenchmark(
  runId: string,
  benchmarkId: string,
  overrides: Partial<BenchmarkResult> = {},
): BenchmarkResult {
  return {
    runId,
    benchmarkId,
    clusterModuleIds: ["module-instance-00000001"],
    passed: true,
    startedAtTick: 0,
    durationTicks: 10,
    averageUsefulComputeFlops: 10_000,
    peakUsefulComputeFlops: 12_000,
    peakPowerWatts: 30,
    averagePowerWatts: 20,
    maxTemperatureC: 60,
    minimumPowerHeadroomWatts: 10,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {},
    ...overrides,
  };
}

function makeFinalState(): GameState {
  const next = makeActiveState(FINAL, 1);
  for (const nodeId of Object.keys(next.research.statuses)) {
    next.research.statuses[nodeId] = nodeId === FINAL ? "active" : "completed";
  }
  next.research.evidenceTags = [
    "evidence-clock-stability",
    "evidence-layout-study",
    "evidence-memory-timing",
    "evidence-semiconductor-effect",
    "evidence-tube-failure-log",
  ];
  next.tick = 10;
  next.research.active = {
    nodeId: FINAL,
    startedAtTick: 10,
    completedOperations: 0,
    reservedComputeShare: 1,
  };
  next.facility.name = "Final Research Laboratory";
  next.facility.modules = {
    "module-instance-1": {
      id: "module-instance-1",
      definitionId: "module-vacuum-tube-logic",
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
    } satisfies ModuleInstanceState,
  };
  next.facility.thermalTiles = [
    { position: { x: 1, y: 0 }, temperatureC: 30 },
    { position: { x: 0, y: 1 }, temperatureC: 20 },
    { position: { x: 0, y: 0 }, temperatureC: 10 },
  ];
  next.facility.compute = {
    layoutRevision: 0,
    thermalRevision: 0,
    byModule: {
      "module-instance-1": {
        moduleInstanceId: "module-instance-1",
        requestedFrequencyRatio: 1,
        operationalRatio: 1,
        theoreticalComputeFlops: 123,
        powerFactor: 1,
        thermalFactor: 1,
        retryRate: 0,
        invalidSampleRate: 0,
        stabilityFactor: 1,
        availableComputeFlops: 123,
      },
    },
    byTask: {},
    research: {
      nodeId: FINAL,
      reservedComputeShare: 1,
      facilityAvailableComputeFlops: 18_000_000,
      deliveredUsefulComputeFlops: 18_000_000,
    },
    totalTheoreticalComputeFlops: 123,
    totalAvailableComputeFlops: 123,
    totalAllocatedUsefulComputeFlops: 0,
  };
  next.benchmarks.history = [
    validBenchmark("benchmark-run-00000001", "benchmark-sustained-stability", {
      averagePowerWatts: 30,
      peakPowerWatts: 45,
    }),
    validBenchmark("benchmark-run-00000002", "benchmark-peak-throughput", {
      averagePowerWatts: 10,
      peakPowerWatts: 50,
    }),
  ];
  next.benchmarks.bestRunByBenchmark = {
    "benchmark-sustained-stability": "benchmark-run-00000001",
    "benchmark-peak-throughput": "benchmark-run-00000002",
  };
  next.benchmarks.nextBenchmarkRunSequence = 3;
  return next;
}

function cloneContent(): ContentBundle {
  return structuredClone(content);
}

describe("pure Research lifecycle", () => {
  test("keeps the root available and does not require Compute without active Research", () => {
    const next = advanceResearchSystem(state(), content).result;

    expect(next.research.statuses[ROOT]).toBe("available");
    expect(next.research.active).toBeNull();
  });

  test("reconciles prerequisite, evidence, and passed benchmark eligibility", () => {
    const prerequisite = state();
    prerequisite.research.statuses[ROOT] = "completed";
    const prerequisiteResult = advanceResearchSystem(prerequisite, content).result.research;
    expect(prerequisiteResult.statuses[RELIABILITY]).toBe("locked");

    prerequisite.research.evidenceTags = ["evidence-tube-failure-log"];
    const evidenceResult = advanceResearchSystem(prerequisite, content).result.research;
    expect(evidenceResult.statuses[RELIABILITY]).toBe("available");

    const benchmarkState = state();
    for (const nodeId of [
      "research-delay-line-memory",
      "research-blueprint-documentation",
      "research-high-frequency-clock",
      RELIABILITY,
      FORCED_AIRFLOW,
    ]) {
      benchmarkState.research.statuses[nodeId] = "completed";
    }
    benchmarkState.research.evidenceTags = ["evidence-semiconductor-effect"];
    benchmarkState.benchmarks.history = [
      validBenchmark("benchmark-run-00000001", "benchmark-peak-throughput"),
      validBenchmark("benchmark-run-00000002", "benchmark-sustained-stability"),
    ];
    benchmarkState.benchmarks.bestRunByBenchmark = {
      "benchmark-peak-throughput": "benchmark-run-00000001",
      "benchmark-sustained-stability": "benchmark-run-00000002",
    };
    benchmarkState.benchmarks.nextBenchmarkRunSequence = 3;
    expect(advanceResearchSystem(benchmarkState, content).result.research.statuses[FINAL]).toBe(
      "available",
    );
  });

  test.each([
    ["missing", [], { "benchmark-peak-throughput": "benchmark-run-00000001" }],
    [
      "failed",
      [
        validBenchmark("benchmark-run-00000001", "benchmark-peak-throughput", {
          passed: false,
          failureReasons: ["average-compute"],
        }),
      ],
      { "benchmark-peak-throughput": "benchmark-run-00000001" },
    ],
    [
      "wrong mapping",
      [validBenchmark("benchmark-run-00000002", "benchmark-sustained-stability")],
      { "benchmark-peak-throughput": "benchmark-run-00000002" },
    ],
    [
      "duplicate history",
      [
        validBenchmark("benchmark-run-00000003", "benchmark-peak-throughput"),
        validBenchmark("benchmark-run-00000003", "benchmark-peak-throughput"),
      ],
      { "benchmark-peak-throughput": "benchmark-run-00000003" },
    ],
  ])("does not unlock a node with a %s benchmark mapping", (_name, history, bestRunByBenchmark) => {
    const next = state();
    next.research.statuses[ROOT] = "completed";
    next.research.statuses[RELIABILITY] = "completed";
    next.research.statuses[FORCED_AIRFLOW] = "completed";
    next.research.statuses["research-delay-line-memory"] = "completed";
    next.research.statuses["research-blueprint-documentation"] = "completed";
    next.research.statuses["research-high-frequency-clock"] = "completed";
    next.research.evidenceTags = ["evidence-semiconductor-effect"];
    next.benchmarks.history = history;
    next.benchmarks.bestRunByBenchmark = bestRunByBenchmark;

    expect(advanceResearchSystem(next, content).result.research.statuses[FINAL]).toBe("locked");
  });

  test("preserves cancelled and completed statuses monotonically", () => {
    const next = state();
    next.research.statuses[ROOT] = "cancelled";
    next.research.statuses[RELIABILITY] = "completed";

    const result = advanceResearchSystem(next, content).result.research;
    expect(result.statuses[ROOT]).toBe("cancelled");
    expect(result.statuses[RELIABILITY]).toBe("completed");
  });

  test("stalls with zero Research delivery", () => {
    const next = makeActiveState();
    installResearchCompute(next, ROOT, 0.1, 0);

    expect(advanceResearchSystem(next, content).result.research.active?.completedOperations).toBe(
      0,
    );
  });

  test("applies fractional progress without rounding", () => {
    const next = makeActiveState();
    installResearchCompute(next, ROOT, 0.1, 25);

    expect(advanceResearchSystem(next, content).result.research.active?.completedOperations).toBe(
      2.5,
    );
  });

  test("completes exactly, discards overshoot, and unlocks multiple dependents", () => {
    const next = makeActiveState(ROOT, 0.1);
    installResearchCompute(next, ROOT, 0.1, 1_800_000);
    next.research.evidenceTags = ["evidence-layout-study", "evidence-tube-failure-log"];

    const result = advanceResearchSystem(next, content).result.research;
    expect(result.active).toBeNull();
    expect(result.statuses[ROOT]).toBe("completed");
    expect(result.statuses[RELIABILITY]).toBe("available");
    expect(result.statuses[FORCED_AIRFLOW]).toBe("available");
    expect(result.statuses[ACCUMULATOR]).toBe("available");
    expect(result.statuses[MODULAR_WIRING]).toBe("available");

    const overshoot = makeActiveState(ROOT, 0.1);
    installResearchCompute(overshoot, ROOT, 0.1, 18_000_000);
    const overshootResult = advanceResearchSystem(overshoot, content).result.research;
    expect(overshootResult.active).toBeNull();
    expect(overshootResult.statuses[ROOT]).toBe("completed");
  });

  test.each([
    ["missing", null],
    [
      "mismatched node",
      {
        nodeId: RELIABILITY,
        reservedComputeShare: 0.1,
        facilityAvailableComputeFlops: 0,
        deliveredUsefulComputeFlops: 0,
      },
    ],
    [
      "mismatched share",
      {
        nodeId: ROOT,
        reservedComputeShare: 0.2,
        facilityAvailableComputeFlops: 0,
        deliveredUsefulComputeFlops: 0,
      },
    ],
  ])("rejects an active Research state with %s Compute evidence", (_name, researchResult) => {
    const next = makeActiveState();
    next.facility.compute = {
      layoutRevision: 0,
      thermalRevision: 0,
      byModule: {},
      byTask: {},
      research: researchResult,
      totalTheoreticalComputeFlops: 0,
      totalAvailableComputeFlops: 0,
      totalAllocatedUsefulComputeFlops: 0,
    };

    expect(() => advanceResearchSystem(next, content)).toThrow();
  });

  test("rejects non-finite delivery and progress overflow", () => {
    const invalid = makeActiveState();
    installResearchCompute(invalid, ROOT, 0.1, Number.POSITIVE_INFINITY);
    expect(() => advanceResearchSystem(invalid, content)).toThrow();

    const hugeContent = cloneContent();
    const hugeRoot = hugeContent.research[ROOT] as unknown as { requiredOperations: number };
    hugeRoot.requiredOperations = Number.POSITIVE_INFINITY;
    const overflow = makeActiveState(ROOT, 1, Number.MAX_VALUE * 0.95);
    installResearchCompute(overflow, ROOT, 1, Number.MAX_VALUE, Number.MAX_VALUE);
    expect(() => advanceResearchSystem(overflow, hugeContent)).toThrow();
  });

  test("accepts the historical Compute result after completion on the following call", () => {
    const next = makeActiveState();
    installResearchCompute(next, ROOT, 0.1, 1_800_000);
    const calculation = advanceResearchSystem(next, content);
    const followingState = {
      ...next,
      research: calculation.result.research,
      campaign: calculation.result.campaign,
      museum: calculation.result.museum,
    };

    expect(advanceResearchSystem(followingState, content).result.research.active).toBeNull();
  });

  test("derives module and feature availability from completed Research", () => {
    const next = state();
    expect(isModuleUnlocked("module-arithmetic-unit", next.research, content)).toBe(false);
    expect(isFeatureUnlocked("power-headroom-inspector", next.research, content)).toBe(false);
    next.research.statuses[ROOT] = "completed";
    expect(isModuleUnlocked("module-arithmetic-unit", next.research, content)).toBe(true);
    expect(isFeatureUnlocked("power-headroom-inspector", next.research, content)).toBe(true);
  });

  test("creates the exact final Museum snapshot and only campaign flags", () => {
    const next = makeFinalState();
    const result = advanceResearchSystem(next, content).result;
    const snapshot = result.museum.snapshots[0];
    const modulePrice = content.modules["module-vacuum-tube-logic"]?.priceUsd;

    expect(result.campaign).toMatchObject({
      transistorRevealed: true,
      verticalSliceCompleted: true,
      objectiveKey: next.campaign.objectiveKey,
      reputation: next.campaign.reputation,
    });
    expect(snapshot).toEqual({
      id: FINAL_SNAPSHOT,
      createdAtTick: 11,
      systemName: "Final Research Laboratory",
      architectureId: "vacuum-tube",
      year: 1946,
      moduleCount: 1,
      theoreticalComputeFlops: 123,
      usefulComputeFlops: 123,
      averagePowerWatts: 20,
      peakPowerWatts: 50,
      averageTemperatureC: 20,
      maxTemperatureC: 30,
      totalCostUsd: modulePrice,
      benchmarkRunIds: ["benchmark-run-00000002", "benchmark-run-00000001"],
      completedResearchIds: Object.values(content.research)
        .toSorted(
          (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
        )
        .map((node) => node.id),
    });
    expect(result).not.toHaveProperty("inventory");
    expect(result).not.toHaveProperty("modules");
    expect(next.facility.modules["module-instance-1"]?.definitionId).toBe(
      "module-vacuum-tube-logic",
    );
  });

  test("rejects duplicate fixed final snapshots and requires thermal data", () => {
    const duplicate = makeFinalState();
    duplicate.museum.snapshots = [
      {
        id: FINAL_SNAPSHOT,
        createdAtTick: 1,
        systemName: "old",
        architectureId: "vacuum-tube",
        year: 1946,
        moduleCount: 0,
        theoreticalComputeFlops: 0,
        usefulComputeFlops: 0,
        averagePowerWatts: 0,
        peakPowerWatts: 0,
        averageTemperatureC: 20,
        maxTemperatureC: 20,
        totalCostUsd: 0,
        benchmarkRunIds: ["old-run"],
        completedResearchIds: [FINAL],
      },
    ];
    expect(() => advanceResearchSystem(duplicate, content)).toThrow();

    const noThermal = makeFinalState();
    noThermal.facility.thermalTiles = [];
    expect(() => advanceResearchSystem(noThermal, content)).toThrow(/thermal/i);
  });

  test("returns detached deeply immutable data and preserves unchanged frozen branches", () => {
    const next = state();
    const calculation = advanceResearchSystem(next, content);
    next.research.statuses[ROOT] = "completed";
    expect(calculation.result.research.statuses[ROOT]).toBe("available");
    expect(Object.isFrozen(calculation.result)).toBe(true);
    expect(Object.isFrozen(calculation.result.research)).toBe(true);
    expect(Object.isFrozen(calculation.result.research.statuses)).toBe(true);

    const frozen = state();
    Object.freeze(frozen.research.statuses);
    Object.freeze(frozen.research.evidenceTags);
    Object.freeze(frozen.research);
    Object.freeze(frozen.campaign);
    Object.freeze(frozen.museum.snapshots);
    Object.freeze(frozen.museum);
    const frozenResult = advanceResearchSystem(frozen, content).result;
    expect(frozenResult.research).toBe(frozen.research);
    expect(frozenResult.campaign).toBe(frozen.campaign);
    expect(frozenResult.museum).toBe(frozen.museum);
  });

  test("is insertion-order independent, serializable, witness-bound, and RNG-free", () => {
    const first = makeFinalState();
    const second = structuredClone(first);
    second.research.statuses = Object.fromEntries(
      Object.entries(second.research.statuses).reverse(),
    );
    second.benchmarks.bestRunByBenchmark = Object.fromEntries(
      Object.entries(second.benchmarks.bestRunByBenchmark).reverse(),
    );
    second.benchmarks.history.reverse();
    second.facility.thermalTiles.reverse();
    const firstRng = first.rngState;
    const secondRng = second.rngState;
    const firstCalculation = advanceResearchSystem(first, content);
    const secondCalculation = advanceResearchSystem(second, content);

    expect(JSON.stringify(firstCalculation.result)).toBe(JSON.stringify(secondCalculation.result));
    expect(JSON.parse(JSON.stringify(firstCalculation.result))).toEqual(firstCalculation.result);
    expect(first.rngState).toBe(firstRng);
    expect(second.rngState).toBe(secondRng);
    expect(
      validateFreshResearchAdvance(
        first,
        content,
        firstCalculation.result,
        firstCalculation.witness,
      ),
    ).toEqual([]);
    first.tick += 1;
    expect(
      validateFreshResearchAdvance(
        first,
        content,
        firstCalculation.result,
        firstCalculation.witness,
      ),
    ).toHaveLength(1);
  });
});
