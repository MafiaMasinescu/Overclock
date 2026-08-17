export type ModuleDefinitionId = string;
export type ModuleInstanceId = string;
export type RouteId = string;
export type TaskDefinitionId = string;
export type TaskInstanceId = string;
export type ResearchNodeId = string;
export type BlueprintId = string;
export type BenchmarkDefinitionId = string;
export type BenchmarkRunId = string;
export type EvidenceTagId = string;

export type Rotation = 0 | 90 | 180 | 270;
export type SimulationSpeed = 1 | 2 | 4;
export type OverclockProfile = "eco" | "balanced" | "boost" | "manual";
export type GuidanceMode = "simple" | "engineering" | "skip";
export type TaskStatus =
  | "offered"
  | "accepted"
  | "active"
  | "hold"
  | "completed"
  | "failed"
  | "abandoned";
export type ResearchStatus = "locked" | "available" | "active" | "completed" | "cancelled";
export type ModuleOperationalState = "offline" | "starting" | "online" | "brownout" | "shutdown";
export type RouteKind = "power" | "data";
export type BlueprintKind = "subassembly" | "server" | "rack" | "facility-zone";

export interface GridPoint {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface PortRef {
  moduleInstanceId: ModuleInstanceId;
  portId: string;
}

export interface OverclockSettings {
  profile: OverclockProfile;
  frequencyRatio: number;
  voltageRatio: number;
}

export interface SimulationClockState {
  paused: boolean;
  speed: SimulationSpeed;
  simulatedSeconds: number;
}

export interface CampaignState {
  eraId: "era-1946-vacuum-tube";
  currentYear: number;
  objectiveKey: string;
  transistorRevealed: boolean;
  verticalSliceCompleted: boolean;
}

export interface EconomyState {
  cashUsd: number;
  creditLimitUsd: number;
  energyPriceUsdPerKwh: number;
  lastTickIncomeUsd: number;
  lastTickExpenseUsd: number;
  totalIncomeUsd: number;
  totalExpenseUsd: number;
}

export interface ModuleInstanceState {
  id: ModuleInstanceId;
  definitionId: ModuleDefinitionId;
  position: GridPoint;
  rotation: Rotation;
  operationalState: ModuleOperationalState;
  overclock: OverclockSettings;
  binComputeRatio: number;
  binEfficiencyRatio: number;
  binThermalRatio: number;
  binStabilityRatio: number;
  startupTicksRemaining: number;
  cooldownTicksRemaining: number;
}

export interface RouteState {
  id: RouteId;
  kind: RouteKind;
  from: PortRef;
  to: PortRef;
  path: GridPoint[];
  capacityPerSecond: number;
  congestionRatio: number;
}

export interface ThermalTileState {
  position: GridPoint;
  temperatureC: number;
}

export interface DesignDraftOperation {
  operationId: string;
  kind: "place" | "move" | "rotate" | "remove" | "connect" | "disconnect";
  payload: Record<string, unknown>;
}

export interface DesignDraftState {
  revision: number;
  modules: Record<ModuleInstanceId, ModuleInstanceState>;
  routes: Record<RouteId, RouteState>;
  undoStack: DesignDraftOperation[];
  redoStack: DesignDraftOperation[];
}

export interface FacilityState {
  id: "facility-alpha";
  name: string;
  size: Size2D;
  ambientTemperatureC: number;
  extractionCapacityWatts: number;
  contractedPowerWatts: number;
  modules: Record<ModuleInstanceId, ModuleInstanceState>;
  routes: Record<RouteId, RouteState>;
  thermalTiles: ThermalTileState[];
  liveLayoutRevision: number;
  thermalRevision: number;
  designDraft: DesignDraftState | null;
}

export interface InventoryStack {
  definitionId: ModuleDefinitionId;
  quantity: number;
  averageAcquisitionCostUsd: number;
}

export interface InventoryState {
  stacks: Record<ModuleDefinitionId, InventoryStack>;
}

export interface TaskAllocationState {
  clusterModuleIds: ModuleInstanceId[];
  requestedShare: number;
  deliveredUsefulComputeFlops: number;
}

export interface TaskInstanceState {
  id: TaskInstanceId;
  definitionId: TaskDefinitionId;
  status: TaskStatus;
  acceptedAtTick: number | null;
  deadlineTick: number | null;
  currentPhaseIndex: number;
  phaseCompletedOperations: number;
  totalCompletedOperations: number;
  allocation: TaskAllocationState | null;
  accruedPayoutUsd: number;
}

export interface TaskSystemState {
  activeSlotCount: number;
  offers: TaskDefinitionId[];
  instances: Record<TaskInstanceId, TaskInstanceState>;
}

export interface ActiveResearchState {
  nodeId: ResearchNodeId;
  startedAtTick: number;
  completedOperations: number;
  reservedComputeShare: number;
}

export interface ResearchState {
  researchData: number;
  statuses: Record<ResearchNodeId, ResearchStatus>;
  active: ActiveResearchState | null;
  evidenceTags: EvidenceTagId[];
}

export interface BenchmarkResult {
  runId: BenchmarkRunId;
  benchmarkId: BenchmarkDefinitionId;
  passed: boolean;
  startedAtTick: number;
  durationTicks: number;
  averageUsefulComputeFlops: number;
  peakUsefulComputeFlops: number;
  peakPowerWatts: number;
  averagePowerWatts: number;
  maxTemperatureC: number;
  retryRate: number;
  validSampleRate: number;
  costUsd: number;
  overclockSummary: Record<ModuleInstanceId, OverclockSettings>;
}

export interface ActiveBenchmarkState {
  runId: BenchmarkRunId;
  benchmarkId: BenchmarkDefinitionId;
  startedAtTick: number;
  elapsedTicks: number;
}

export interface BenchmarkState {
  active: ActiveBenchmarkState | null;
  history: BenchmarkResult[];
  bestRunByBenchmark: Partial<Record<BenchmarkDefinitionId, BenchmarkRunId>>;
}

export interface BlueprintModule {
  localId: string;
  definitionId: ModuleDefinitionId;
  relativePosition: GridPoint;
  rotation: Rotation;
  defaultOverclock: OverclockSettings;
}

export interface BlueprintRoute {
  localId: string;
  kind: RouteKind;
  fromLocalModuleId: string;
  fromPortId: string;
  toLocalModuleId: string;
  toPortId: string;
  relativePath: GridPoint[];
}

export interface BlueprintRecord {
  id: BlueprintId;
  name: string;
  version: number;
  kind: BlueprintKind;
  contentVersion: string;
  modules: BlueprintModule[];
  routes: BlueprintRoute[];
  requiredResearchIds: ResearchNodeId[];
  bounds: Size2D;
  summary: {
    theoreticalComputeFlops: number;
    peakPowerWatts: number;
    estimatedMaxTemperatureC: number;
    estimatedCostUsd: number;
  };
}

export interface BlueprintState {
  records: Record<BlueprintId, BlueprintRecord>;
}

export interface TutorialState {
  guidanceMode: GuidanceMode;
  currentStepId: string | null;
  completedStepIds: string[];
  skipped: boolean;
}

export interface MuseumSnapshot {
  id: string;
  createdAtTick: number;
  systemName: string;
  architectureId: "vacuum-tube";
  year: number;
  moduleCount: number;
  theoreticalComputeFlops: number;
  usefulComputeFlops: number;
  averagePowerWatts: number;
  peakPowerWatts: number;
  averageTemperatureC: number;
  maxTemperatureC: number;
  totalCostUsd: number;
  benchmarkRunIds: BenchmarkRunId[];
  completedResearchIds: ResearchNodeId[];
}

export interface MuseumState {
  snapshots: MuseumSnapshot[];
}

export interface AchievementState {
  unlockedIds: string[];
  unlockedAtTick: Record<string, number>;
}

export interface GameState {
  saveVersion: 1;
  contentVersion: string;
  seed: string;
  tick: number;
  rngState: number;
  clock: SimulationClockState;
  campaign: CampaignState;
  economy: EconomyState;
  facility: FacilityState;
  inventory: InventoryState;
  tasks: TaskSystemState;
  research: ResearchState;
  benchmarks: BenchmarkState;
  blueprints: BlueprintState;
  tutorial: TutorialState;
  museum: MuseumState;
  achievements: AchievementState;
}

export interface ComputeBreakdown {
  theoreticalComputeFlops: number;
  powerFactor: number;
  thermalFactor: number;
  memoryFactor: number;
  interconnectFactor: number;
  suitabilityFactor: number;
  stabilityFactor: number;
  usefulComputeFlops: number;
  bottlenecks: Array<{
    factor: "power" | "thermal" | "memory" | "interconnect" | "suitability" | "stability";
    factorValue: number;
    lostComputeFlops: number;
    explanationKey: string;
  }>;
}

