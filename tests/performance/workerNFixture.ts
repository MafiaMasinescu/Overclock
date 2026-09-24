import {
  captureCanonicalBlueprintPayload,
  calculateCanonicalBlueprintSummary,
} from "../../src/sim/blueprints/blueprintCapture.ts";
import { assertValidBlueprintState } from "../../src/sim/blueprints/blueprintState.ts";
import { assertValidStoredBenchmarkState } from "../../src/sim/benchmarks/benchmarkState.ts";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import { enumerateOccupiedTiles } from "../../src/grid/domain/footprintGeometry.ts";
import { assertValidStoredResearchState } from "../../src/sim/research/researchState.ts";
import { assertValidStoredTaskState } from "../../src/sim/tasks/taskState.ts";
import type { BenchmarkResult, GameState } from "../../src/sim/core/types.ts";
import { createTask9PerformanceFixture } from "./thermalFixture.ts";

const BASE_CONTENT = loadContentBundle();
const MINIMUM_OCCUPIED_TILES = 288;
const ACTIVE_RESEARCH_ID = "research-stable-power-distribution";
const HISTORY_BENCHMARK_ID = "benchmark-sustained-stability";

function canonicalizeModuleIds(state: GameState): Map<string, string> {
  const sourceIds = Object.keys(state.facility.modules).toSorted();
  const idBySource = new Map(
    sourceIds.map((sourceId, index) => [
      sourceId,
      `module-instance-${String(index + 1).padStart(8, "0")}`,
    ]),
  );
  const moduleId = (sourceId: string): string => idBySource.get(sourceId) ?? sourceId;
  state.facility.modules = Object.fromEntries(
    Object.entries(state.facility.modules).map(([sourceId, module]) => {
      const id = moduleId(sourceId);
      return [id, { ...module, id }];
    }),
  );
  state.facility.routes = Object.fromEntries(
    Object.entries(state.facility.routes).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        from: { ...route.from, moduleInstanceId: moduleId(route.from.moduleInstanceId) },
        to: { ...route.to, moduleInstanceId: moduleId(route.to.moduleInstanceId) },
      },
    ]),
  );
  for (const domain of [state.facility.power, state.facility.overclock, state.facility.compute]) {
    domain.byModule = Object.fromEntries(
      Object.entries(domain.byModule).map(([sourceId, value]) => {
        const id = moduleId(sourceId);
        return [id, { ...value, moduleInstanceId: id }];
      }),
    );
  }
  for (const task of Object.values(state.tasks.instances)) {
    if (task.allocation !== null) {
      task.allocation.clusterModuleIds = task.allocation.clusterModuleIds.map(moduleId);
    }
  }
  state.facility.nextModuleInstanceSequence = sourceIds.length + 1;
  return idBySource;
}

/** Shared dense N fixture for the Task 19 Worker and projection measurements. */
export function createWorkerNFixture(
  seed: string,
  content: ContentBundle = BASE_CONTENT,
): GameState {
  const state = createTask9PerformanceFixture(seed);
  canonicalizeModuleIds(state);
  const serviceTask = state.tasks.instances["task-9-bandwidth"];
  if (serviceTask === undefined) throw new Error("Worker N fixture lacks its service Task.");
  serviceTask.serviceWindowCompliant = true;
  state.research.researchData = 1_000_000;
  for (const researchId of [
    "research-vacuum-tube-reliability",
    "research-forced-airflow",
    "research-accumulator-design",
    "research-delay-line-memory",
    "research-buffered-io",
    "research-modular-wiring",
    "research-blueprint-documentation",
  ]) {
    state.research.statuses[researchId] = "completed";
  }
  state.research.statuses[ACTIVE_RESEARCH_ID] = "active";
  state.research.active = {
    nodeId: ACTIVE_RESEARCH_ID,
    startedAtTick: state.tick,
    completedOperations: 0,
    reservedComputeShare: 0.1,
  };

  const selectedBlueprintModuleId = Object.keys(state.facility.modules)
    .toSorted()
    .find((moduleId) => {
      try {
        const payload = captureCanonicalBlueprintPayload(state, content, [moduleId]);
        const summary = calculateCanonicalBlueprintSummary(state, content, [moduleId]);
        return payload.modules.length === 1 && Number.isFinite(summary.theoreticalComputeFlops);
      } catch {
        return false;
      }
    });
  if (selectedBlueprintModuleId === undefined) {
    throw new Error("Worker N fixture has no module eligible for a valid Blueprint.");
  }
  const payload = captureCanonicalBlueprintPayload(state, content, [selectedBlueprintModuleId]);
  const summary = calculateCanonicalBlueprintSummary(state, content, [selectedBlueprintModuleId]);
  const records = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => {
      const sequence = index + 1;
      const id = `blueprint-${String(sequence).padStart(8, "0")}`;
      return [
        id,
        {
          id,
          name: `Worker N diagnostic ${sequence}`,
          ...structuredClone(payload),
          summary: structuredClone(summary),
        },
      ];
    }),
  );
  state.blueprints = { records, nextBlueprintSequence: 9 };

  const benchmarkModule = Object.values(state.facility.modules)
    .filter((module) => (content.modules[module.definitionId]?.baseComputeFlops ?? 0) > 0)
    .toSorted((left, right) => left.id.localeCompare(right.id))[0];
  if (benchmarkModule === undefined) {
    throw new Error("Worker N fixture has no Compute module for Benchmark history.");
  }
  const benchmarkResult: BenchmarkResult = {
    runId: "benchmark-run-00000001",
    benchmarkId: HISTORY_BENCHMARK_ID,
    clusterModuleIds: [benchmarkModule.id],
    passed: true,
    startedAtTick: 0,
    durationTicks: 1_200,
    averageUsefulComputeFlops: 20_000,
    peakUsefulComputeFlops: 22_000,
    peakPowerWatts: 100,
    averagePowerWatts: 90,
    maxTemperatureC: 70,
    minimumPowerHeadroomWatts: 10,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: { [benchmarkModule.id]: { ...benchmarkModule.overclock } },
  };
  state.benchmarks = {
    nextBenchmarkRunSequence: 2,
    active: null,
    history: [benchmarkResult],
    bestRunByBenchmark: { [HISTORY_BENCHMARK_ID]: benchmarkResult.runId },
  };

  const occupiedTiles = new Set<string>();
  for (const module of Object.values(state.facility.modules)) {
    const definition = content.modules[module.definitionId];
    if (definition === undefined) throw new Error(`Worker N fixture lacks ${module.definitionId}.`);
    for (const tile of enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    )) {
      occupiedTiles.add(`${tile.x},${tile.y}`);
    }
  }
  if (occupiedTiles.size < MINIMUM_OCCUPIED_TILES) {
    throw new Error(
      `Worker N fixture occupies ${occupiedTiles.size} tiles; at least ${MINIMUM_OCCUPIED_TILES} are required.`,
    );
  }
  assertValidBlueprintState(state.blueprints);
  assertValidStoredBenchmarkState(state);
  assertValidStoredResearchState(state);
  assertValidStoredTaskState(state);
  return state;
}
