// Simulator-neutral presentation view-model contracts (Phase 2 §4, §7.1).
//
// Canonical home for the UiSnapshot/GridViewModel family. The existing app
// snapshot module re-exports these types so current shell consumers keep
// working; `src/sim` never imports `src/app` (ESLint enforced).
//
// Nullability follows P2-D20: unknown forecasts, unrecorded memory/retry
// quantities and missing evidence are explicit null, never invented zeros.
// `revision` on both roots is reserved for the publication/host boundary
// (Task 19 owns transport revisions); the pure projector always emits 0 and
// real source revisions travel in `layoutRevision`/`thermalRevision`.

import type { DeepReadonly } from "../../content/schemas/contentSchemas.ts";
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
  ThermalTileState,
} from "../core/types.ts";

// Deeply immutable breakdown carried by value. The projector copies the
// stored breakdown into a fresh object and freezes it; receivers never
// observe the authoritative record.
export type PresentationBreakdown = DeepReadonly<ComputeBreakdown>;

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
  tags: readonly string[];
  progressRatio: number;
  phaseIndex: number;
  phaseCount: number;
  deadlineTick: number | null;
  // Null until an accepted forecast exists (P2-D20). No forecast formula
  // is invented by the projector.
  projectedCompletionTick: number | null;
  deadlineRisk: "none" | "low" | "high" | null;
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
  // Null unless the quantity is actually recorded by Compute (§7.1).
  // Facility-level memory capacity/usage and bandwidth usage have no
  // authoritative aggregate, so the projector emits null.
  memoryCapacityBytes: number | null;
  memoryUsedBytes: number | null;
  memoryBandwidthBytesPerSecond: number | null;
  memoryBandwidthUsedBytesPerSecond: number | null;
  researchData: number;
  reputation: number;
  // Null unless an authoritative stored aggregate exists. Per-module retry
  // rates are stored, but no facility aggregate is, so this stays null.
  retryRate: number | null;
  powerHeadroomWatts: number;
  bottleneck: PresentationBreakdown["bottlenecks"][number] | null;
  // 0 until a later chart contract supplies data (§7.1).
  seriesRevision: number;
}

export interface InspectorViewModel {
  selectedEntityId: string | null;
  entityKind: "module" | "route" | "tile" | "task" | null;
  titleKey: string | null;
  stats: readonly {
    labelKey: string;
    value: number | string;
    unitKey?: string;
    state?: "normal" | "warning" | "critical";
  }[];
  computeBreakdown: PresentationBreakdown | null;
}

export interface ResearchSummaryViewModel {
  researchData: number;
  activeNodeId: ResearchNodeId | null;
  activeProgressRatio: number;
  availableNodeIds: readonly ResearchNodeId[];
  completedNodeIds: readonly ResearchNodeId[];
}

export interface UiSnapshot {
  revision: number;
  tick: number;
  header: HeaderViewModel;
  tasks: readonly TaskCardViewModel[];
  alerts: readonly AlertViewModel[];
  telemetry: TelemetryViewModel;
  inspector: InspectorViewModel;
  research: ResearchSummaryViewModel;
  build: {
    designMode: boolean;
    draftRevision: number | null;
    inventoryUnitCount: number;
    availableDefinitionIds: readonly ModuleDefinitionId[];
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
  // Mean temperature of the live occupied tiles. Draft-only entities have
  // no live footprint, so this is null (never a guessed value).
  temperatureC: number | null;
  overclock: OverclockSettings;
}

export interface GridRouteViewModel {
  id: string;
  kind: "power" | "data";
  path: readonly GridPoint[];
  // Stored Power byRoute utilization for power routes. Data utilization is
  // null unless authoritative evidence exists; a power route without a
  // stored delivery (dirty power, draft-only) is also null.
  utilizationRatio: number | null;
  selected: boolean;
}

export interface HeatmapPatch {
  full: boolean;
  values: readonly { x: number; y: number; temperatureC: number }[];
}

export interface PlacementPreviewViewModel {
  definitionId: ModuleDefinitionId;
  position: GridPoint;
  rotation: Rotation;
  valid: boolean;
  issueKeys: readonly string[];
  estimatedCostUsd: number;
}

export type GridViewMode = "live" | "draft";

export interface GridViewModel {
  revision: number;
  // Explicit mode: geometry comes from the selected authoritative
  // live/draft layout (§7.1). Physics always references live results.
  mode: GridViewMode;
  layoutRevision: number;
  thermalRevision: number;
  gridSize: { width: number; height: number };
  modules: readonly GridModuleViewModel[];
  routes: readonly GridRouteViewModel[];
  // Always null on the pure path; heatmap deltas are publisher-owned (18.2).
  heatmap: HeatmapPatch | null;
  // Null until the later placement-preview UI contract.
  placementPreview: PlacementPreviewViewModel | null;
  // Empty until the later semantic-alert UI contract.
  diagnosticHighlights: readonly {
    entityId: string;
    intensity: number;
    reason: "active-route" | "primary-bottleneck" | "efficiency-loss";
  }[];
}

// Source revisions carried alongside a projection so the publication
// path assembles its input without a getStateForSave serialization.
export interface ProjectionSource {
  readonly liveLayoutRevision: number;
  readonly draftRevision: number | null;
  readonly thermalRevision: number;
  readonly viewMode: GridViewMode;
  readonly width: number;
  readonly height: number;
}

// The owned narrow read: view models plus the shared frozen thermal field
// and source revisions. thermalTiles is the authoritative frozen array
// shared by reference (never mutated by receivers); everything else is a
// fresh owned copy.
export interface ProjectedPresentation {
  readonly snapshot: UiSnapshot;
  readonly grid: GridViewModel;
  readonly thermalTiles: readonly ThermalTileState[];
  readonly source: ProjectionSource;
}

// Read-only presentation input. Selection/camera stay local UI state and
// never enter authoritative simulation state.
export interface PresentationContext {
  readonly selectedIds: readonly string[];
  readonly inspectedEntityId: string | null;
  readonly heatmapEnabled: boolean;
}

const MAX_SELECTED_IDS = 512;
const MAX_ID_CHARACTERS = 256;

export function createDefaultPresentationContext(): PresentationContext {
  return Object.freeze({
    selectedIds: Object.freeze([] as string[]),
    inspectedEntityId: null,
    heatmapEnabled: false,
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseSelectedIds(value: unknown): string[] {
  if (!isExactDenseArray(value) || value.length > MAX_SELECTED_IDS) {
    throw new TypeError("PresentationContext.selectedIds must be an array of at most 512 strings.");
  }
  const selectedIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_ID_CHARACTERS) {
      throw new TypeError("PresentationContext.selectedIds entries must be nonempty strings.");
    }
    selectedIds.push(entry);
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new TypeError("PresentationContext.selectedIds must not contain duplicates.");
  }
  return selectedIds;
}

function isExactDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length")) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    lengthDescriptor.value !== value.length
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return false;
    }
  }
  return true;
}

function parseOptionalId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_CHARACTERS) {
    throw new TypeError(`PresentationContext.${field} must be a string or null.`);
  }
  return value;
}

function isDataPropertyDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { readonly value: unknown } {
  return descriptor !== undefined && Object.hasOwn(descriptor, "value");
}

function readDataPropertyValue(descriptor: PropertyDescriptor | undefined): unknown {
  if (!isDataPropertyDescriptor(descriptor)) {
    throw new TypeError("PresentationContext fields must be data properties.");
  }
  return descriptor.value as unknown;
}

// Validates an externally supplied context (host-owned) and returns an
// owned copy. Unknown keys are rejected; nothing is coerced.
export function parsePresentationContext(input: unknown): PresentationContext {
  if (!isPlainRecord(input)) {
    throw new TypeError("PresentationContext must be a plain record.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const stringKeys = keys.filter((key): key is string => typeof key === "string").toSorted();
  if (
    keys.length !== 3 ||
    stringKeys.length !== 3 ||
    stringKeys[0] !== "heatmapEnabled" ||
    stringKeys[1] !== "inspectedEntityId" ||
    stringKeys[2] !== "selectedIds"
  ) {
    throw new TypeError(
      "PresentationContext must have exactly { selectedIds, inspectedEntityId, heatmapEnabled }.",
    );
  }
  const selectedIdsDescriptor = descriptors["selectedIds"];
  const inspectedEntityIdDescriptor = descriptors["inspectedEntityId"];
  const heatmapEnabledDescriptor = descriptors["heatmapEnabled"];
  if (
    selectedIdsDescriptor === undefined ||
    inspectedEntityIdDescriptor === undefined ||
    heatmapEnabledDescriptor === undefined ||
    !isDataPropertyDescriptor(selectedIdsDescriptor) ||
    !isDataPropertyDescriptor(inspectedEntityIdDescriptor) ||
    !isDataPropertyDescriptor(heatmapEnabledDescriptor) ||
    selectedIdsDescriptor.enumerable !== true ||
    inspectedEntityIdDescriptor.enumerable !== true ||
    heatmapEnabledDescriptor.enumerable !== true
  ) {
    throw new TypeError("PresentationContext fields must be enumerable data properties.");
  }
  const selectedIds = readDataPropertyValue(selectedIdsDescriptor);
  const inspectedEntityId = readDataPropertyValue(inspectedEntityIdDescriptor);
  const heatmapEnabled = readDataPropertyValue(heatmapEnabledDescriptor);
  if (typeof heatmapEnabled !== "boolean") {
    throw new TypeError("PresentationContext.heatmapEnabled must be a boolean.");
  }
  return Object.freeze({
    selectedIds: Object.freeze(parseSelectedIds(selectedIds)),
    inspectedEntityId: parseOptionalId(inspectedEntityId, "inspectedEntityId"),
    heatmapEnabled,
  });
}
