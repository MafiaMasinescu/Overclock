import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createReplayRecorder } from "../../src/sim/replay/replayRecorder.ts";
import { runReplay } from "../../src/sim/replay/replayRunner.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import type {
  ActiveBenchmarkState,
  BlueprintModule,
  BlueprintRecord,
  BlueprintRoute,
  GameState,
  OverclockSettings,
} from "../../src/sim/core/types.ts";
import { createTask9PerformanceFixture } from "../performance/thermalFixture.ts";

const IDS = {
  enter: "20700000-0000-4000-8000-000000000001",
  place: "20700000-0000-4000-8000-000000000002",
  reject: "20700000-0000-4000-8000-000000000003",
  task: "20700000-0000-4000-8000-000000000004",
  pause: "20700000-0000-4000-8000-000000000005",
} as const;
const benchmarkContent = loadContentBundle();

function createTrace() {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed: "replay-exact-100" });
  const recorder = createReplayRecorder({ content, initialState });

  recorder.perform({
    kind: "enqueue",
    command: { commandId: IDS.enter, source: "player", kind: "ENTER_DESIGN_MODE" },
  });
  recorder.perform({
    kind: "enqueue",
    command: {
      commandId: IDS.place,
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: "module-vacuum-tube-logic",
      position: { x: 0, y: 0 },
      rotation: 0,
    },
  });
  recorder.perform({ kind: "process-pending" });
  recorder.checkpoint();

  recorder.perform({
    kind: "enqueue",
    command: {
      commandId: IDS.reject,
      source: "player",
      kind: "SET_GUIDANCE_MODE",
      mode: "engineering",
    },
  });
  recorder.perform({
    kind: "enqueue",
    command: {
      commandId: IDS.task,
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: "task-ballistic-table-verification",
    },
  });
  recorder.perform({ kind: "process-pending" });
  recorder.perform({
    kind: "clock",
    command: {
      commandId: IDS.pause,
      source: "player",
      kind: "SET_PAUSED",
      paused: false,
      expectedTick: 0,
    },
  });
  recorder.perform({ kind: "step", ticks: 0 });
  recorder.perform({ kind: "step", ticks: 2 });
  recorder.checkpoint();

  return { content, ...recorder.finish() };
}

function canonicalizeModuleIds(state: GameState): void {
  const sourceIds = Object.keys(state.facility.modules).toSorted();
  const mappedIds = Object.fromEntries(
    sourceIds.map((sourceId, index) => [
      sourceId,
      `module-instance-${String(index + 1).padStart(8, "0")}`,
    ]),
  );
  const moduleId = (sourceId: string): string => mappedIds[sourceId] ?? sourceId;
  state.facility.modules = Object.fromEntries(
    Object.entries(state.facility.modules).map(([sourceId, module]) => [
      moduleId(sourceId),
      { ...module, id: moduleId(sourceId) },
    ]),
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
  state.facility.power.byModule = Object.fromEntries(
    Object.entries(state.facility.power.byModule).map(([sourceId, delivery]) => [
      moduleId(sourceId),
      { ...delivery, moduleInstanceId: moduleId(delivery.moduleInstanceId) },
    ]),
  );
  state.facility.overclock.byModule = Object.fromEntries(
    Object.entries(state.facility.overclock.byModule).map(([sourceId, result]) => [
      moduleId(sourceId),
      { ...result, moduleInstanceId: moduleId(result.moduleInstanceId) },
    ]),
  );
  state.facility.compute.byModule = Object.fromEntries(
    Object.entries(state.facility.compute.byModule).map(([sourceId, result]) => [
      moduleId(sourceId),
      { ...result, moduleInstanceId: moduleId(result.moduleInstanceId) },
    ]),
  );
  state.facility.nextModuleInstanceSequence = sourceIds.length + 1;
}

function createBenchmarkReplayState(
  benchmarkId: "benchmark-peak-throughput" | "benchmark-sustained-stability",
): GameState {
  const state = createTask9PerformanceFixture(`replay-${benchmarkId}`);
  canonicalizeModuleIds(state);
  state.tasks.instances = {};
  state.tasks.offers = [];
  if (benchmarkId === "benchmark-peak-throughput") {
    state.research.statuses["research-high-frequency-clock"] = "completed";
  }
  const clusterModuleIds = Object.keys(state.facility.modules)
    .toSorted()
    .filter((moduleId) => {
      const module = state.facility.modules[moduleId];
      return (
        module !== undefined &&
        (benchmarkContent.modules[module.definitionId]?.baseComputeFlops ?? 0) > 0
      );
    })
    .slice(0, 4);
  const overclockSummary: Record<string, OverclockSettings> = {};
  for (const moduleId of clusterModuleIds) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) throw new Error("Benchmark Replay fixture module is missing.");
    overclockSummary[moduleId] = { ...module.overclock };
  }
  const active: ActiveBenchmarkState = {
    runId: "benchmark-run-00000001",
    benchmarkId,
    startedAtTick: state.tick,
    elapsedTicks: 0,
    clusterModuleIds,
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
    overclockSummary,
  };
  state.benchmarks = {
    nextBenchmarkRunSequence: 2,
    active,
    history: [],
    bestRunByBenchmark: {},
  };
  return state;
}

function createRouteBoundaryReplayState(): GameState {
  const relayDefinitionId = "module-data-relay";
  const modules: BlueprintModule[] = [0, 3, 6].map((x, index) => ({
    localId: `module-${String(index + 1).padStart(4, "0")}`,
    definitionId: relayDefinitionId,
    relativePosition: { x, y: 0 },
    rotation: 0,
    defaultOverclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  }));
  const route = (
    localId: string,
    fromLocalModuleId: string,
    toLocalModuleId: string,
    startX: number,
  ): BlueprintRoute => ({
    localId,
    kind: "data",
    fromLocalModuleId,
    fromPortId: "data-east",
    toLocalModuleId,
    toPortId: "data-west",
    relativePath: [0, 1, 2, 3].map((offset) => ({ x: startX + offset, y: 0 })),
  });
  const featureResearchId = "research-blueprint-documentation";
  const requiredResearchIds = [
    featureResearchId,
    ...(benchmarkContent.modules[relayDefinitionId]?.unlockResearchIds ?? []),
  ].toSorted();
  const record: BlueprintRecord = {
    id: "blueprint-00000001",
    name: "Replay route boundary",
    version: 1,
    kind: "subassembly",
    contentVersion: benchmarkContent.contentVersion,
    modules,
    routes: [
      route("route-0001", "module-0001", "module-0002", 0),
      route("route-0002", "module-0002", "module-0003", 3),
    ],
    requiredResearchIds: [...new Set(requiredResearchIds)],
    bounds: { width: 7, height: 1 },
    summary: {
      theoreticalComputeFlops: 0,
      peakPowerWatts: 300,
      estimatedMaxTemperatureC: 20,
      estimatedCostUsd: 2_100,
    },
  };
  const state = createInitialGameState({
    content: benchmarkContent,
    seed: "replay-route-boundary",
  });
  state.research.statuses["research-stable-power-distribution"] = "completed";
  state.research.statuses["research-modular-wiring"] = "completed";
  state.research.statuses["research-blueprint-documentation"] = "completed";
  state.research.evidenceTags = ["evidence-layout-study"];
  state.blueprints = { records: { [record.id]: record }, nextBlueprintSequence: 2 };
  state.facility.designDraft = {
    revision: 0,
    modules: {},
    routes: {},
    undoStack: [],
    redoStack: [],
  };
  state.facility.nextRouteSequence = 99_999_999;
  state.inventory.stacks[relayDefinitionId] = {
    definitionId: relayDefinitionId,
    quantity: 20,
    averageAcquisitionCostUsd: 700,
  };
  return state;
}

describe("Replay exact determinism", () => {
  test("replays one frozen cross-domain trace identically across 100 fresh runners", () => {
    const artifact = createTrace();
    const reports = Array.from({ length: 100 }, () =>
      runReplay({
        content: artifact.content,
        initialState: artifact.initialState,
        log: artifact.log,
      }),
    );
    const serializedReports = reports.map((report) => canonicalSerialize(report));

    expect(reports.every((report) => report.status === "matched")).toBe(true);
    expect(new Set(serializedReports).size).toBe(1);
    expect(
      artifact.log.entries.some(
        (entry) => entry.operation.kind === "step" && entry.operation.ticks === 0,
      ),
    ).toBe(true);
    expect(
      artifact.log.entries.some(
        (entry) => entry.operation.kind === "step" && entry.operation.ticks === 2,
      ),
    ).toBe(true);
    expect(artifact.log.checkpoints.map((checkpoint) => checkpoint.afterSequence)).toEqual([
      0, 3, 9,
    ]);
  }, 30_000);

  test.each([
    ["benchmark-peak-throughput", 150],
    ["benchmark-sustained-stability", 1_200],
  ] as const)(
    "records and verifies a complete %s Replay trace",
    (benchmarkId, durationTicks) => {
      const initialState = createBenchmarkReplayState(benchmarkId);
      const recorder = createReplayRecorder({ content: benchmarkContent, initialState });
      recorder.perform({ kind: "step", ticks: durationTicks });
      const artifact = recorder.finish();

      const report = runReplay({
        content: benchmarkContent,
        initialState: artifact.initialState,
        log: artifact.log,
      });

      expect(report.status).toBe("matched");
      expect(report.executedTicks).toBe(durationTicks);
      expect(report.finalTick).toBe(initialState.tick + durationTicks);
      expect(artifact.log.entries[0]?.outcome).toMatchObject({
        kind: "step-result",
        result: { ticksExecuted: durationTicks },
      });
    },
    30_000,
  );

  test("replays Task 13.7 route allocations across the decimal padding boundary", () => {
    const initialState = createRouteBoundaryReplayState();
    const recorder = createReplayRecorder({ content: benchmarkContent, initialState });
    const performCommand = (sequence: number, command: Record<string, unknown>) => {
      recorder.perform({
        kind: "enqueue",
        command: {
          commandId: `20700000-0000-4000-8001-${String(sequence).padStart(12, "0")}`,
          source: "player",
          ...command,
        },
      });
      recorder.perform({ kind: "process-pending" });
    };
    performCommand(1, {
      kind: "INSTANTIATE_BLUEPRINT",
      blueprintId: "blueprint-00000001",
      position: { x: 5, y: 5 },
      rotation: 0,
    });
    performCommand(2, { kind: "UNDO_DESIGN" });
    performCommand(3, { kind: "REDO_DESIGN" });
    const state = recorder.getStateForSave();
    const log = recorder.finish().log;

    expect(Object.keys(state.facility.designDraft?.routes ?? {})).toEqual([
      "route-99999999",
      "route-100000000",
    ]);
    expect(state.facility.nextRouteSequence).toBe(100_000_001);
    expect(runReplay({ content: benchmarkContent, initialState, log }).status).toBe("matched");
  });
});
