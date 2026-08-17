import type {
  ComputeBreakdown,
  GridPoint,
  ModuleDefinitionId,
  ModuleInstanceId,
  OverclockSettings,
  ResearchNodeId,
  Rotation,
  TaskInstanceId,
  TaskStatus,
} from "./types";

export interface HeaderViewModel {
  eraNameKey: string;
  year: number;
  objectiveKey: string;
  paused: boolean;
  speed: 1 | 2 | 4;
  cashUsd: number;
  usefulComputeFlops: number;
  theoreticalComputeFlops: number;
  powerDrawWatts: number;
  powerCapacityWatts: number;
  averageTemperatureC: number;
  maxTemperatureC: number;
}

export interface TaskCardViewModel {
  taskInstanceId: TaskInstanceId;
  definitionId: string;
  nameKey: string;
  status: TaskStatus;
  tags: string[];
  progressRatio: number;
  phaseIndex: number;
  phaseCount: number;
  deadlineTick: number | null;
  projectedCompletionTick: number | null;
  deadlineRisk: "none" | "low" | "high";
  allocatedUsefulComputeFlops: number;
}

export interface AlertViewModel {
  id: string;
  severity: "info" | "success" | "warning" | "critical";
  messageKey: string;
  parameters?: Record<string, string | number | boolean>;
  entityId?: string;
}

export interface TelemetryViewModel {
  memoryCapacityBytes: number;
  memoryUsedBytes: number;
  memoryBandwidthBytesPerSecond: number;
  memoryBandwidthUsedBytesPerSecond: number;
  researchData: number;
  reputation: number;
  retryRate: number;
  powerHeadroomWatts: number;
  bottleneck: ComputeBreakdown["bottlenecks"][number] | null;
  seriesRevision: number;
}

export interface InspectorViewModel {
  selectedEntityId: string | null;
  entityKind: "module" | "route" | "tile" | "task" | null;
  titleKey: string | null;
  stats: Array<{
    labelKey: string;
    value: number | string;
    unitKey?: string;
    state?: "normal" | "warning" | "critical";
  }>;
  computeBreakdown: ComputeBreakdown | null;
}

export interface ResearchSummaryViewModel {
  researchData: number;
  activeNodeId: ResearchNodeId | null;
  activeProgressRatio: number;
  availableNodeIds: ResearchNodeId[];
  completedNodeIds: ResearchNodeId[];
}

export interface UiSnapshot {
  revision: number;
  tick: number;
  header: HeaderViewModel;
  tasks: TaskCardViewModel[];
  alerts: AlertViewModel[];
  telemetry: TelemetryViewModel;
  inspector: InspectorViewModel;
  research: ResearchSummaryViewModel;
  build: {
    designMode: boolean;
    draftRevision: number | null;
    inventoryRevision: number;
    availableDefinitionIds: ModuleDefinitionId[];
  };
  tutorial: {
    currentStepId: string | null;
    guidanceMode: "simple" | "engineering" | "skip";
  };
  commandAvailability: Record<string, boolean>;
}

export interface GridModuleViewModel {
  id: ModuleInstanceId;
  definitionId: ModuleDefinitionId;
  spriteKey: string;
  position: GridPoint;
  footprint: { width: number; height: number };
  rotation: Rotation;
  operationalState: "offline" | "starting" | "online" | "brownout" | "shutdown";
  selected: boolean;
  warning: "none" | "power" | "thermal" | "route";
  temperatureC: number;
  overclock: OverclockSettings;
}

export interface GridRouteViewModel {
  id: string;
  kind: "power" | "data";
  path: GridPoint[];
  utilizationRatio: number;
  selected: boolean;
}

export interface HeatmapPatch {
  full: boolean;
  values: Array<{ x: number; y: number; temperatureC: number }>;
}

export interface PlacementPreviewViewModel {
  definitionId: ModuleDefinitionId;
  position: GridPoint;
  rotation: Rotation;
  valid: boolean;
  issueKeys: string[];
  estimatedCostUsd: number;
}

export interface GridViewModel {
  revision: number;
  layoutRevision: number;
  thermalRevision: number;
  gridSize: { width: number; height: number };
  modules: GridModuleViewModel[];
  routes: GridRouteViewModel[];
  heatmap: HeatmapPatch | null;
  placementPreview: PlacementPreviewViewModel | null;
  diagnosticHighlights: Array<{
    entityId: string;
    intensity: number;
    reason: "active-route" | "primary-bottleneck" | "efficiency-loss";
  }>;
}

