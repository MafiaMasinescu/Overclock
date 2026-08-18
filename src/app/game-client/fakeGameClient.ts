import type { GameClient } from "./contracts.ts";
import type { GridViewModel, UiSnapshot } from "./snapshots.ts";
import { deepFreeze } from "../../content/loader/deepFreeze.ts";

const placeholderSnapshot: UiSnapshot = deepFreeze({
  revision: 0,
  tick: 0,
  header: {
    eraNameKey: "common.era.vacuum-tube",
    year: 1946,
    objectiveKey: "ui.objective",
    paused: true,
    speed: 1,
    cashUsd: 32_000,
    usefulComputeFlops: 0,
    theoreticalComputeFlops: 0,
    powerDrawWatts: 0,
    powerCapacityWatts: 24_000,
    averageTemperatureC: 22,
    maxTemperatureC: 22,
  },
  tasks: [
    {
      taskInstanceId: "placeholder-task-1",
      definitionId: "task-ballistic-table-verification",
      nameKey: "tasks.task-ballistic-table-verification.name",
      status: "active",
      tags: ["serial", "historical"],
      progressRatio: 0.18,
      phaseIndex: 0,
      phaseCount: 2,
      deadlineTick: 2_100,
      projectedCompletionTick: 1_840,
      deadlineRisk: "low",
      allocatedUsefulComputeFlops: 0,
    },
  ],
  alerts: [
    {
      id: "phase-zero-status",
      severity: "info",
      messageKey: "ui.shell-status",
    },
  ],
  telemetry: {
    memoryCapacityBytes: 0,
    memoryUsedBytes: 0,
    memoryBandwidthBytesPerSecond: 0,
    memoryBandwidthUsedBytesPerSecond: 0,
    researchData: 10,
    reputation: 0,
    retryRate: 0,
    powerHeadroomWatts: 24_000,
    bottleneck: null,
    seriesRevision: 0,
  },
  inspector: {
    selectedEntityId: null,
    entityKind: null,
    titleKey: null,
    stats: [],
    computeBreakdown: null,
  },
  research: {
    researchData: 10,
    activeNodeId: null,
    activeProgressRatio: 0,
    availableNodeIds: ["research-stable-power-distribution"],
    completedNodeIds: [],
  },
  build: {
    designMode: false,
    draftRevision: null,
    inventoryRevision: 0,
    availableDefinitionIds: [
      "module-power-distribution",
      "module-vacuum-tube-logic",
      "module-control-unit",
      "module-accumulator-register",
      "module-punch-card-reader",
    ],
  },
  tutorial: {
    currentStepId: null,
    guidanceMode: "engineering",
  },
  commandAvailability: {},
});

const placeholderGrid: GridViewModel = deepFreeze({
  revision: 0,
  layoutRevision: 0,
  thermalRevision: 0,
  gridSize: { width: 24, height: 16 },
  modules: [],
  routes: [],
  heatmap: null,
  placementPreview: null,
  diagnosticHighlights: [],
});

export function createFakeGameClient(): GameClient {
  const snapshotListeners = new Set<() => void>();
  const eventListeners = new Set<Parameters<GameClient["subscribeEvents"]>[0]>();

  return {
    dispatch(command) {
      return Promise.resolve({
        commandId: command.commandId,
        accepted: false,
        rejectedAtTick: 0,
        code: "COMMAND_NOT_AVAILABLE",
        messageKey: "errors.phase-zero-no-simulator",
      });
    },
    getSnapshot() {
      return placeholderSnapshot;
    },
    subscribe(listener) {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    getGridViewModel() {
      return placeholderGrid;
    },
    requestSave() {
      return Promise.reject(new Error("Saving is unavailable in Phase 0."));
    },
  };
}
