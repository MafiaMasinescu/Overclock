// Phase 2 Task 18.3 projection/publication diagnostic.
//
// Measures the pure projector, project-plus-publish-plus-encode,
// main-thread store apply, and the combined production tick with due
// projection on the shared dense fixtures. Budgets are the Phase 2
// contract §13 targets; results on any other host are informative only.
// Never changes authoritative simulation state and exposes no production
// debug API. Rerun after projector, publisher, store, or admission
// changes.
//
// Run it with: corepack pnpm performance:projection

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { arch, cpus, platform, release } from "node:os";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createGameClientStore } from "../../src/app/game-client/store.ts";
import {
  createGridPublisher,
  type GridPublicationSource,
} from "../../src/sim/selectors/gridPublication.ts";
import {
  createPresentationProjector,
  projectGridViewModel,
  projectUiSnapshot,
} from "../../src/sim/selectors/projector.ts";
import { createDefaultPresentationContext } from "../../src/sim/selectors/presentationTypes.ts";
import { freezeOwned } from "../../src/sim/selectors/freezeOwned.ts";
import { copyOwnedThermalTiles } from "../../src/sim/selectors/ownedPlainData.ts";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
  THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES,
} from "./thermalFixture.ts";
import { enumerateOccupiedTiles } from "../../src/grid/domain/footprintGeometry.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import {
  captureCanonicalBlueprintPayload,
  validateCurrentBlueprintCapture,
} from "../../src/sim/blueprints/blueprintCapture.ts";
import type { BenchmarkResult } from "../../src/sim/core/types.ts";
import type { GameState } from "../../src/sim/core/types.ts";

const content = loadContentBundle();
const EPSILON = content.balancing.thermal.dirtyEpsilonC;

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

const isTargetHost =
  platform() === "win32" && arch() === "x64" && (cpus()[0]?.model ?? "").includes("i7-2600");

const hardFailures: string[] = [];

function summarize(
  fixture: string,
  operation: string,
  values: number[],
  extra?: Record<string, number | string>,
  hardBudgetMs?: number,
): number {
  const p95Ms = percentile(values, 0.95);
  console.log(
    JSON.stringify({
      fixture,
      operation,
      samples: values.length,
      medianMs: percentile(values, 0.5),
      p95Ms,
      maximumMs: Math.max(...values),
      ...extra,
    }),
  );
  if (hardBudgetMs !== undefined && isTargetHost && !(p95Ms < hardBudgetMs)) {
    hardFailures.push(`${fixture}/${operation}: p95 ${p95Ms} ms >= ${hardBudgetMs} ms`);
  }
  return p95Ms;
}

function withBlueprints(count: number): ReturnType<typeof createTask9PerformanceFixture> {
  const state = createTask9PerformanceFixture("projection-performance-l");
  // The completed 150/1,200-tick benchmark history predates this snapshot.
  // Active Task and Research begin now, so the fixture has a possible timeline.
  state.tick = 1_500;
  state.clock.simulatedSeconds = 150;
  state.tasks.instances = Object.fromEntries(
    Object.entries(state.tasks.instances).map(([id, instance]) => [
      id,
      { ...instance, acceptedAtTick: state.tick },
    ]),
  );
  const activeResearchId = "research-transistor-theory";
  state.research.statuses = Object.fromEntries(
    Object.keys(state.research.statuses).map((id) => [
      id,
      id === activeResearchId ? "active" : "completed",
    ]),
  );
  state.research.active = {
    nodeId: activeResearchId,
    startedAtTick: state.tick,
    completedOperations: 0,
    reservedComputeShare: 0.2,
  };
  state.research.researchData = 1_000_000;
  state.research.evidenceTags = [
    "evidence-clock-stability",
    "evidence-layout-study",
    "evidence-memory-timing",
    "evidence-semiconductor-effect",
    "evidence-tube-failure-log",
  ];
  state.economy.cashUsd = 1_000_000;
  const benchmarkResult = (
    runId: string,
    benchmarkId: string,
    durationTicks: number,
  ): BenchmarkResult => ({
    runId,
    benchmarkId,
    clusterModuleIds: ["module-instance-00000001"],
    passed: true,
    startedAtTick: 0,
    durationTicks,
    averageUsefulComputeFlops: 10_000,
    peakUsefulComputeFlops: 12_000,
    peakPowerWatts: 50,
    averagePowerWatts: 25,
    maxTemperatureC: 70,
    minimumPowerHeadroomWatts: 10,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {},
  });
  state.benchmarks.history = [
    benchmarkResult("benchmark-run-00000001", "benchmark-peak-throughput", 150),
    benchmarkResult("benchmark-run-00000002", "benchmark-sustained-stability", 1_200),
  ];
  state.benchmarks.bestRunByBenchmark = {
    "benchmark-peak-throughput": "benchmark-run-00000001",
    "benchmark-sustained-stability": "benchmark-run-00000002",
  };
  state.benchmarks.nextBenchmarkRunSequence = 3;
  const availableModules = Object.keys(state.facility.modules)
    .filter((id) => id.startsWith("thermal-"))
    .toSorted();
  const records: Record<string, (typeof state.blueprints.records)[string]> = {};
  for (let index = 1; index <= count; index += 1) {
    const id = `blueprint-${index.toString().padStart(8, "0")}`;
    const selectedId = availableModules[(index - 1) % availableModules.length];
    if (selectedId === undefined) throw new Error("Dense fixture has no capturable module.");
    const captured = captureCanonicalBlueprintPayload(state, thermalPerformanceContent, [
      selectedId,
    ]);
    const issues = validateCurrentBlueprintCapture(
      captured,
      thermalPerformanceContent,
      state.research,
    );
    if (issues.length > 0)
      throw new Error(`Invalid diagnostic Blueprint ${id}: ${JSON.stringify(issues)}`);
    records[id] = {
      ...captured,
      id,
      name: `Projection Blueprint ${index}`,
    };
  }
  state.blueprints = { nextBlueprintSequence: count + 1, records };
  const service = state.tasks.instances["task-9-bandwidth"];
  if (service !== undefined) {
    state.tasks.instances["task-9-bandwidth"] = { ...service, serviceWindowCompliant: true };
  }
  const occupied = new Set<string>();
  for (const module of Object.values(state.facility.modules)) {
    const definition = thermalPerformanceContent.modules[module.definitionId];
    if (definition === undefined) throw new Error("Diagnostic module definition is missing.");
    for (const tile of enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    )) {
      occupied.add(`${tile.x}:${tile.y}`);
    }
  }
  if (
    occupied.size < THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES ||
    state.facility.size.width !== 24 ||
    state.facility.size.height !== 16 ||
    Object.values(state.tasks.instances).filter((task) => task.status === "active").length < 2 ||
    !Object.values(state.research.statuses).includes("active") ||
    Object.keys(state.blueprints.records).length !== count ||
    state.benchmarks.history.length !== 2 ||
    state.benchmarks.history.some(
      (result) => result.startedAtTick + result.durationTicks > state.tick,
    )
  ) {
    throw new Error("Projection performance fixture does not meet the audited N/L contract.");
  }
  createProductionSimCore({ content: thermalPerformanceContent, initialState: state });
  return state;
}

const context = createDefaultPresentationContext();

function measureOwnershipCosts(
  fixture: string,
  state: ReturnType<typeof createTask9PerformanceFixture>,
  samples: number,
  warmup: number,
): void {
  const grid = createPresentationProjector().projectPresentation(
    state,
    thermalPerformanceContent,
    context,
  ).grid;
  const cloneValues: number[] = [];
  const freezeValues: number[] = [];
  const thermalValues: number[] = [];
  const strictThermalValues: number[] = [];
  for (let index = 0; index < warmup + samples; index += 1) {
    const start = performance.now();
    const clone = structuredClone(grid);
    const afterClone = performance.now();
    freezeOwned(clone);
    const afterFreeze = performance.now();
    freezeOwned(
      state.facility.thermalTiles.map((tile) => ({
        position: { ...tile.position },
        temperatureC: tile.temperatureC,
      })),
    );
    const end = performance.now();
    copyOwnedThermalTiles(state.facility.thermalTiles, 24, 16);
    const afterStrictThermal = performance.now();
    if (index >= warmup) {
      cloneValues.push(afterClone - start);
      freezeValues.push(afterFreeze - afterClone);
      thermalValues.push(end - afterFreeze);
      strictThermalValues.push(afterStrictThermal - end);
    }
  }
  summarize(fixture, "ownership-grid-clone", cloneValues, { note: "diagnostic-only" });
  summarize(fixture, "ownership-grid-freeze", freezeValues, { note: "diagnostic-only" });
  summarize(fixture, "ownership-thermal-copy", thermalValues, { note: "diagnostic-only" });
  summarize(fixture, "ownership-strict-thermal-copy", strictThermalValues, {
    note: "diagnostic-only",
  });
}

function measurePureProject(
  fixture: string,
  state: ReturnType<typeof createTask9PerformanceFixture>,
  samples: number,
  warmup: number,
): void {
  const before = hashCanonicalState(state);
  const projector = createPresentationProjector();
  for (let index = 0; index < warmup; index += 1) {
    projector.projectPresentation(state, thermalPerformanceContent, context);
  }
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    projector.projectPresentation(state, thermalPerformanceContent, context);
    values.push(performance.now() - start);
  }
  if (hashCanonicalState(state) !== before) throw new Error("Projector mutated its input.");
  summarize(
    fixture,
    "pure-project",
    values,
    { budgetMs: "<1 p95" },
    fixture === "N" ? 1 : undefined,
  );
  const snapshotValues: number[] = [];
  const gridValues: number[] = [];
  for (let index = 0; index < warmup + samples; index += 1) {
    const start = performance.now();
    projectUiSnapshot(state, thermalPerformanceContent, context);
    const gridStart = performance.now();
    projectGridViewModel(state, thermalPerformanceContent, context);
    const end = performance.now();
    if (index >= warmup) {
      snapshotValues.push(gridStart - start);
      gridValues.push(end - gridStart);
    }
  }
  summarize(fixture, "pure-snapshot-only", snapshotValues, { note: "diagnostic-only" });
  summarize(fixture, "pure-grid-without-cache", gridValues, { note: "diagnostic-only" });
}

function measurePublishEncode(
  fixture: string,
  state: ReturnType<typeof createTask9PerformanceFixture>,
  samples: number,
  warmup: number,
): void {
  const publisher = createGridPublisher({ epoch: "perf-epoch-1", dirtyEpsilonC: EPSILON });
  const stateA = freezeOwned(structuredClone(state));
  // Consecutive production ticks preserve layout identity when only
  // temperatures change. Share those owned branches in this diagnostic.
  const stateB = freezeOwned({
    ...stateA,
    facility: {
      ...stateA.facility,
      thermalTiles: stateA.facility.thermalTiles.map((tile, index) =>
        index % 48 === 0
          ? { position: tile.position, temperatureC: tile.temperatureC + 0.06 + EPSILON }
          : tile,
      ),
    },
  });
  const coreA = createProductionSimCore({
    content: thermalPerformanceContent,
    initialState: stateA,
  });
  const coreB = createProductionSimCore({
    content: thermalPerformanceContent,
    initialState: stateB,
  });
  const draft = state.facility.designDraft;
  const source: GridPublicationSource = {
    liveLayoutRevision: state.facility.liveLayoutRevision,
    draftRevision: draft?.revision ?? null,
    thermalRevision: state.facility.thermalRevision,
    viewMode: draft === null ? "live" : "draft",
    width: state.facility.size.width,
    height: state.facility.size.height,
  };
  let revision = 0;
  const phases = {
    project: [] as number[],
    publish: [] as number[],
    encode: [] as number[],
    acknowledge: [] as number[],
  };
  const cycle = (candidate: typeof coreA, recordPhases: boolean): number => {
    const projectStart = performance.now();
    const presentation = candidate.getPresentation(context);
    const publishStart = performance.now();
    revision += 1;
    const publication = publisher.publish({
      grid: presentation.grid,
      thermalTiles: presentation.thermalTiles,
      source: { ...source, thermalRevision: source.thermalRevision + revision },
      heatmapEnabled: true,
      nowMs: revision,
    });
    if (publication === null) throw new Error("Expected a delta publication.");
    const encodeStart = performance.now();
    const bytes = canonicalSerialize(publication).length;
    const acknowledgeStart = performance.now();
    const ack = publisher.acknowledge(publication.publicationSequence);
    if (ack.status !== "acknowledged") throw new Error("Acknowledgement failed.");
    if (recordPhases) {
      const end = performance.now();
      phases.project.push(publishStart - projectStart);
      phases.publish.push(encodeStart - publishStart);
      phases.encode.push(acknowledgeStart - encodeStart);
      phases.acknowledge.push(end - acknowledgeStart);
    }
    return bytes;
  };
  for (let index = 0; index < warmup; index += 1) cycle(index % 2 === 0 ? coreA : coreB, false);
  const values: number[] = [];
  let bytes = 0;
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    bytes = cycle(index % 2 === 0 ? coreA : coreB, true);
    values.push(performance.now() - start);
  }
  summarize(
    fixture,
    "project-publish-encode",
    values,
    { budgetMs: "<2 p95", bytes },
    fixture === "N" ? 2 : undefined,
  );
  for (const [phase, phaseValues] of Object.entries(phases)) {
    summarize(fixture, `publish-phase-${phase}`, phaseValues, { note: "diagnostic-only" });
  }
}

function measureStoreApply(
  fixture: string,
  state: ReturnType<typeof createTask9PerformanceFixture>,
  samples: number,
  warmup: number,
): void {
  const snapshot = projectUiSnapshot(state, thermalPerformanceContent, context);
  const projector = createPresentationProjector();
  const seeder = createGridPublisher({ epoch: "perf-epoch-2", dirtyEpsilonC: EPSILON });
  const draft = state.facility.designDraft;
  const full = seeder.publish({
    grid: projector.projectPresentation(state, thermalPerformanceContent, context).grid,
    thermalTiles: state.facility.thermalTiles,
    source: {
      liveLayoutRevision: state.facility.liveLayoutRevision,
      draftRevision: draft?.revision ?? null,
      thermalRevision: state.facility.thermalRevision,
      viewMode: draft === null ? "live" : "draft",
      width: state.facility.size.width,
      height: state.facility.size.height,
    },
    heatmapEnabled: true,
    nowMs: 0,
  });
  if (full === null) throw new Error("Expected a full publication.");
  for (let index = 0; index < warmup; index += 1) {
    const store = createGameClientStore();
    const applied = store.applyPublication({ epoch: "perf-epoch-2", snapshot, grid: full });
    if (!applied.applied) throw new Error("Warm-up apply rejected.");
  }
  const values: number[] = [];
  const constructionValues: number[] = [];
  const applyValues: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const constructStart = performance.now();
    const store = createGameClientStore();
    const applyStart = performance.now();
    const applied = store.applyPublication({ epoch: "perf-epoch-2", snapshot, grid: full });
    const end = performance.now();
    constructionValues.push(applyStart - constructStart);
    applyValues.push(end - applyStart);
    values.push(end - constructStart);
    if (!applied.applied) throw new Error("Apply rejected.");
  }
  summarize(
    fixture,
    "store-apply",
    values,
    { budgetMs: "<5 p95", note: "includes per-sample store construction" },
    fixture === "N" ? 5 : undefined,
  );
  summarize(fixture, "store-construction", constructionValues, { note: "diagnostic-only" });
  summarize(fixture, "store-apply-only", applyValues, { note: "diagnostic-only" });
}

function measureCombinedTick(fixture: string, samples: number, warmup: number): void {
  const fixtureState: GameState = withBlueprints(8);
  const direct = createProductionSimCore({
    content: thermalPerformanceContent,
    initialState: fixtureState,
  });
  for (let index = 0; index < 100; index += 1) direct.step(1);
  const directValues: number[] = [];
  for (let index = 0; index < 200; index += 1) {
    const start = performance.now();
    direct.step(1);
    directValues.push(performance.now() - start);
  }
  summarize(fixture, "direct-complete-production-tick", directValues, { budgetMs: "<4 p95" }, 4);
  const core = createProductionSimCore({
    content: thermalPerformanceContent,
    initialState: fixtureState,
  });
  core.step(5);
  const publisher = createGridPublisher({ epoch: "perf-epoch-3", dirtyEpsilonC: EPSILON });
  const values: number[] = [];
  for (let index = 0; index < warmup + samples; index += 1) {
    const start = performance.now();
    core.step(1);
    // The narrow owned read boundary: no getStateForSave serialization on
    // the publication path (§4). The diagnostic measures the true host cost.
    const presented = core.getPresentation(context);
    const publication = publisher.publish({
      grid: presented.grid,
      thermalTiles: presented.thermalTiles,
      source: presented.source,
      heatmapEnabled: true,
      nowMs: index + 1,
    });
    if (publication !== null) {
      const ack = publisher.acknowledge(publication.publicationSequence);
      if (ack.status !== "acknowledged") throw new Error("Acknowledgement failed.");
    }
    const elapsed = performance.now() - start;
    if (index >= warmup) values.push(elapsed);
  }
  summarize(fixture, "combined-tick-with-projection", values, { budgetMs: "<6 p95" }, 6);
}

function measureColdConstruction(state: GameState): void {
  const values: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now();
    createProductionSimCore({ content: thermalPerformanceContent, initialState: state });
    values.push(performance.now() - start);
  }
  summarize("N", "cold-production-core-construction", values, {
    note: "report-only; no warm-up or excluded construction work",
  });
}

function main(): void {
  console.log(
    JSON.stringify({
      host: "see docs/diagnostics/PHASE_2_PROJECTION.md",
      cpu: cpus()[0]?.model ?? "unknown",
      os: `${platform()} ${release()}`,
      arch: arch(),
      targetHost: isTargetHost,
      contentVersion: thermalPerformanceContent.contentVersion,
      epsilonC: EPSILON,
    }),
  );
  const dense = withBlueprints(8);
  measureOwnershipCosts("N", dense, 500, 100);
  measurePureProject("N", dense, 500, 100);
  measurePublishEncode("N", dense, 500, 100);
  measureStoreApply("N", dense, 500, 100);
  measureCombinedTick("N", 500, 100);
  const large = withBlueprints(128);
  measurePureProject("L", large, 50, 5);
  measurePublishEncode("L", large, 50, 5);
  measureColdConstruction(dense);
  if (hardFailures.length > 0 && isTargetHost) {
    throw new Error(`Hard projection budgets failed:\n${hardFailures.join("\n")}`);
  }
}

main();
