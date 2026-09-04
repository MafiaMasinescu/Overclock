import type {
  ContentBundle,
  DeepReadonly,
  ModuleDefinition,
} from "../../content/schemas/contentSchemas.ts";
import {
  enumerateOccupiedTiles,
  isGridPointInBounds,
  isIntegerGridPoint,
  isValidFacilitySize,
  isValidRotation,
  resolveRotatedFootprintSize,
} from "../../grid/domain/footprintGeometry.ts";
import { buildOccupancyIndex } from "../../grid/domain/occupancy.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { assertValidGridState } from "../../grid/validation/gridState.ts";
import type {
  BlueprintModule,
  BlueprintRecord,
  BlueprintRoute,
  GameState,
  GridPoint,
  ModuleInstanceState,
  RouteState,
  Rotation,
  Size2D,
} from "../core/types.ts";
import { calculateDesignInventoryReservations } from "../design/designModeCommands.ts";
import { isFeatureUnlocked } from "../research/researchDomain.ts";
import {
  resolveManualRouteEndpoints,
  validateRouteState,
  validateManualRoutePath,
  type ManualRouteFailure,
} from "../routing/manualRouting.ts";
import { validateCurrentBlueprintCapture } from "./blueprintCapture.ts";
import { validateBlueprintState } from "./blueprintState.ts";

export type BlueprintMaterializationFailureCode =
  | "BLUEPRINT_NOT_FOUND"
  | "NOT_IN_DESIGN_MODE"
  | "FEATURE_LOCKED"
  | "RESEARCH_INCOMPLETE"
  | "BLUEPRINT_INVALID"
  | "INVALID_ROTATION"
  | "INVALID_TARGET"
  | "OUT_OF_BOUNDS"
  | "TILE_OCCUPIED"
  | "INVALID_PORT"
  | "INCOMPATIBLE_PORTS"
  | "INVALID_ROUTE"
  | "INSUFFICIENT_INVENTORY"
  | "INVALID_SYSTEM";

export interface BlueprintMaterializationFailure {
  readonly status: "rejected";
  readonly code: BlueprintMaterializationFailureCode;
  readonly reason: string;
}

export interface BlueprintInventoryReservationDelta {
  readonly definitionId: string;
  readonly quantity: number;
}

export interface BlueprintMaterializationPlan {
  readonly blueprintId: string;
  readonly blueprintVersion: number;
  readonly targetPosition: GridPoint;
  readonly globalRotation: Rotation;
  readonly addedModules: readonly ModuleInstanceState[];
  readonly addedRoutes: readonly RouteState[];
  readonly nextModuleInstanceSequence: number;
  readonly nextRouteSequence: number;
  readonly inventoryReservationDelta: readonly BlueprintInventoryReservationDelta[];
}

export interface BlueprintMaterializationReady {
  readonly status: "ready";
  readonly plan: BlueprintMaterializationPlan;
}

export type BlueprintMaterializationResult =
  BlueprintMaterializationReady | BlueprintMaterializationFailure;

interface SourceModuleGeometry {
  readonly blueprintModule: BlueprintModule;
  readonly definition: DeepReadonly<ModuleDefinition>;
  readonly occupiedTiles: readonly GridPoint[];
}

interface AllocatedIds {
  readonly ids: readonly string[];
  readonly nextSequence: number;
}

const MODULE_INSTANCE_ID_PREFIX = "module-instance-";
const ROUTE_ID_PREFIX = "route-";
const MODULE_INSTANCE_ID_PATTERN = /^module-instance-(\d{8,})$/;
const ROUTE_ID_PATTERN = /^route-(\d{8,})$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGridPoint(value: unknown): value is GridPoint {
  return isPlainRecord(value) && isIntegerGridPoint(value as unknown as GridPoint);
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function failure(
  code: BlueprintMaterializationFailureCode,
  reason: string,
): BlueprintMaterializationFailure {
  return Object.freeze({ status: "rejected" as const, code, reason });
}

function isMaterializationFailure(value: unknown): value is BlueprintMaterializationFailure {
  return (
    isPlainRecord(value) &&
    value["status"] === "rejected" &&
    typeof value["code"] === "string" &&
    typeof value["reason"] === "string"
  );
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function detached<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function localSequence(id: string, prefix: "module" | "route"): number | null {
  const pattern = prefix === "module" ? /^module-(\d{4,})$/ : /^route-(\d{4,})$/;
  const match = pattern.exec(id);
  if (match?.[1] === undefined) return null;
  const sequence = Number(match[1]);
  return isSafePositiveInteger(sequence) ? sequence : null;
}

function compareBlueprintModules(left: BlueprintModule, right: BlueprintModule): number {
  const leftSequence = localSequence(left.localId, "module") ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = localSequence(right.localId, "module") ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || compareStableStrings(left.localId, right.localId);
}

function compareBlueprintRoutes(left: BlueprintRoute, right: BlueprintRoute): number {
  const leftSequence = localSequence(left.localId, "route") ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = localSequence(right.localId, "route") ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || compareStableStrings(left.localId, right.localId);
}

function sameTileSet(left: readonly GridPoint[], right: readonly GridPoint[]): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(({ x, y }) => `${x},${y}`).toSorted(compareStableStrings);
  const rightKeys = right.map(({ x, y }) => `${x},${y}`).toSorted(compareStableStrings);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function minimumPoint(points: readonly GridPoint[]): GridPoint | null {
  const first = points[0];
  if (first === undefined) return null;
  return points.slice(1).reduce(
    (minimum, point) => ({
      x: Math.min(minimum.x, point.x),
      y: Math.min(minimum.y, point.y),
    }),
    { x: first.x, y: first.y },
  );
}

function translatePoint(point: GridPoint, targetPosition: GridPoint): GridPoint | null {
  const x = point.x + targetPosition.x;
  const y = point.y + targetPosition.y;
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
}

/** Applies the Blueprint-wide rotation to a point in the original Blueprint bounds. */
export function transformBlueprintPoint(
  point: GridPoint,
  bounds: Size2D,
  rotation: Rotation,
): GridPoint {
  if (!isGridPoint(point) || !isValidFacilitySize(bounds) || !isValidRotation(rotation)) {
    throw new RangeError("Blueprint point transform inputs are invalid.");
  }
  if (!isGridPointInBounds(point, bounds)) {
    throw new RangeError("Blueprint point must fit the original Blueprint bounds.");
  }
  switch (rotation) {
    case 0:
      return { x: point.x, y: point.y };
    case 90:
      return { x: bounds.height - 1 - point.y, y: point.x };
    case 180:
      return { x: bounds.width - 1 - point.x, y: bounds.height - 1 - point.y };
    case 270:
      return { x: point.y, y: bounds.width - 1 - point.x };
  }
}

function currentCaptureValue(record: BlueprintRecord): object {
  const capture: Record<string, unknown> = { ...record };
  Reflect.deleteProperty(capture, "id");
  Reflect.deleteProperty(capture, "name");
  return capture;
}

function contentFailure(
  record: BlueprintRecord,
  state: Readonly<GameState>,
  content: ContentBundle,
): BlueprintMaterializationFailure | null {
  if (!isFeatureUnlocked("subassembly-blueprints", state.research, content)) {
    return failure("FEATURE_LOCKED", "feature-locked");
  }
  for (const researchId of record.requiredResearchIds) {
    if (content.research[researchId] === undefined) {
      return failure("BLUEPRINT_INVALID", "invalid-record");
    }
    if (state.research.statuses[researchId] !== "completed") {
      return failure("RESEARCH_INCOMPLETE", "research-incomplete");
    }
  }

  const issues = validateCurrentBlueprintCapture(
    currentCaptureValue(record),
    content,
    state.research,
  );
  if (issues.length === 0) return null;
  if (issues.some(({ path }) => path === "capture.contentVersion")) {
    return failure("BLUEPRINT_INVALID", "content-version-mismatch");
  }
  if (issues.some(({ path }) => path.startsWith("research.statuses."))) {
    return failure("RESEARCH_INCOMPLETE", "research-incomplete");
  }
  return failure("BLUEPRINT_INVALID", "invalid-record");
}

function routeFailure(result: ManualRouteFailure): BlueprintMaterializationFailure {
  switch (result.code) {
    case "OUT_OF_BOUNDS":
    case "TILE_OCCUPIED":
    case "INVALID_PORT":
    case "INCOMPATIBLE_PORTS":
    case "INVALID_ROUTE":
      return failure(result.code, result.reason);
    default:
      return failure("BLUEPRINT_INVALID", "invalid-record");
  }
}

function resolveSourceGeometry(
  record: BlueprintRecord,
  content: ContentBundle,
): { readonly geometries: readonly SourceModuleGeometry[] } | BlueprintMaterializationFailure {
  const geometries: SourceModuleGeometry[] = [];
  const occupied = new Set<string>();
  for (const blueprintModule of [...record.modules].toSorted(compareBlueprintModules)) {
    const definition = content.modules[blueprintModule.definitionId];
    if (definition === undefined) return failure("BLUEPRINT_INVALID", "invalid-record");
    let occupiedTiles: GridPoint[];
    try {
      occupiedTiles = enumerateOccupiedTiles(
        blueprintModule.relativePosition,
        definition.footprint,
        blueprintModule.rotation,
      );
    } catch {
      return failure("BLUEPRINT_INVALID", "invalid-record");
    }
    for (const point of occupiedTiles) {
      if (!isGridPointInBounds(point, record.bounds)) {
        return failure("BLUEPRINT_INVALID", "invalid-record");
      }
      const key = `${point.x},${point.y}`;
      if (occupied.has(key)) return failure("BLUEPRINT_INVALID", "invalid-record");
      occupied.add(key);
    }
    geometries.push({ blueprintModule, definition, occupiedTiles });
  }
  return { geometries };
}

function recordById(
  state: Readonly<GameState>,
  blueprintId: string,
): BlueprintRecord | BlueprintMaterializationFailure {
  const structuralIssues = validateBlueprintState(state.blueprints);
  if (structuralIssues.length > 0) return failure("BLUEPRINT_INVALID", "invalid-record");
  const record = state.blueprints.records[blueprintId];
  return record ?? failure("BLUEPRINT_NOT_FOUND", "blueprint-not-found");
}

function allocateIds(
  startSequence: number,
  count: number,
  prefix: string,
  width: number,
  existingRecords: readonly Readonly<Record<string, unknown>>[],
): AllocatedIds | BlueprintMaterializationFailure {
  if (!isSafePositiveInteger(startSequence) || !Number.isSafeInteger(count) || count < 0) {
    return failure("INVALID_SYSTEM", "invalid-sequence");
  }
  if (count > Number.MAX_SAFE_INTEGER - startSequence) {
    return failure("INVALID_SYSTEM", "invalid-sequence");
  }

  const ids: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const sequence = startSequence + offset;
    const id = `${prefix}${sequence.toString().padStart(width, "0")}`;
    if (existingRecords.some((records) => Object.hasOwn(records, id))) {
      return failure("INVALID_SYSTEM", "id-collision");
    }
    ids.push(id);
  }

  const pattern =
    prefix === MODULE_INSTANCE_ID_PREFIX ? MODULE_INSTANCE_ID_PATTERN : ROUTE_ID_PATTERN;
  for (const records of existingRecords) {
    for (const key of Object.keys(records)) {
      const match = pattern.exec(key);
      if (match?.[1] !== undefined && Number(match[1]) >= startSequence) {
        return failure("INVALID_SYSTEM", "invalid-sequence");
      }
      const value = records[key];
      if (isPlainRecord(value) && typeof value["id"] === "string") {
        const valueMatch = pattern.exec(value["id"]);
        if (valueMatch?.[1] !== undefined && Number(valueMatch[1]) >= startSequence) {
          return failure("INVALID_SYSTEM", "invalid-sequence");
        }
      }
    }
  }
  return { ids, nextSequence: startSequence + count };
}

function countNewModules(
  geometries: readonly SourceModuleGeometry[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const { blueprintModule } of geometries) {
    const count = (counts[blueprintModule.definitionId] ?? 0) + 1;
    if (!Number.isSafeInteger(count)) throw new RangeError("Module count exceeds safe range.");
    counts[blueprintModule.definitionId] = count;
  }
  return counts;
}

function calculateReservationDelta(
  state: Readonly<GameState>,
  geometries: readonly SourceModuleGeometry[],
): readonly BlueprintInventoryReservationDelta[] | BlueprintMaterializationFailure {
  const draft = state.facility.designDraft;
  if (draft === null) return failure("NOT_IN_DESIGN_MODE", "not-in-design-mode");
  let existingReservations: readonly {
    readonly definitionId: string;
    readonly liveCount: number;
    readonly draftCount: number;
    readonly requiredFromInventory: number;
    readonly availableInventory: number;
  }[];
  try {
    existingReservations = calculateDesignInventoryReservations(
      state.facility,
      draft,
      state.inventory.stacks,
    );
  } catch {
    return failure("INVALID_SYSTEM", "invalid-inventory");
  }
  const existingByDefinition = new Map(
    existingReservations.map((reservation) => [reservation.definitionId, reservation]),
  );
  const newCounts = countNewModules(geometries);
  const deltas: BlueprintInventoryReservationDelta[] = [];
  for (const definitionId of Object.keys(newCounts).toSorted(compareStableStrings)) {
    const newCount = newCounts[definitionId];
    if (newCount === undefined) continue;
    const existing = existingByDefinition.get(definitionId);
    const liveCount = existing?.liveCount ?? 0;
    const draftCount = existing?.draftCount ?? 0;
    const availableInventory = state.inventory.stacks[definitionId]?.quantity ?? 0;
    if (!Number.isSafeInteger(availableInventory) || availableInventory < 0) {
      return failure("INVALID_SYSTEM", "invalid-inventory");
    }
    const combinedRequired = Math.max(0, draftCount + newCount - liveCount);
    if (!Number.isSafeInteger(combinedRequired)) {
      return failure("INVALID_SYSTEM", "invalid-inventory");
    }
    if (combinedRequired > availableInventory) {
      return failure("INSUFFICIENT_INVENTORY", "inventory-shortage");
    }
    const existingRequired = existing?.requiredFromInventory ?? 0;
    const delta = combinedRequired - existingRequired;
    if (!Number.isSafeInteger(delta) || delta < 0) {
      return failure("INVALID_SYSTEM", "invalid-inventory");
    }
    if (delta > 0) deltas.push({ definitionId, quantity: delta });
  }
  return deltas;
}

function materializedModule(
  geometry: SourceModuleGeometry,
  blueprintBounds: Size2D,
  targetPosition: GridPoint,
  globalRotation: Rotation,
  facilityModuleId: string,
): ModuleInstanceState | BlueprintMaterializationFailure {
  const transformedTiles: GridPoint[] = [];
  for (const point of geometry.occupiedTiles) {
    let transformed: GridPoint;
    try {
      transformed = transformBlueprintPoint(
        point,
        {
          width: blueprintBounds.width,
          height: blueprintBounds.height,
        },
        globalRotation,
      );
    } catch {
      return failure("BLUEPRINT_INVALID", "invalid-record");
    }
    const translated = translatePoint(transformed, targetPosition);
    if (translated === null) return failure("INVALID_TARGET", "invalid-target");
    transformedTiles.push(translated);
  }

  const anchor = minimumPoint(transformedTiles);
  if (anchor === null) return failure("BLUEPRINT_INVALID", "invalid-record");
  const rotation = ((geometry.blueprintModule.rotation + globalRotation) % 360) as Rotation;
  let expectedTiles: GridPoint[];
  try {
    expectedTiles = enumerateOccupiedTiles(anchor, geometry.definition.footprint, rotation);
  } catch {
    return failure("BLUEPRINT_INVALID", "invalid-record");
  }
  if (!sameTileSet(transformedTiles, expectedTiles)) {
    return failure("BLUEPRINT_INVALID", "invalid-record");
  }

  return {
    id: facilityModuleId,
    definitionId: geometry.blueprintModule.definitionId,
    position: anchor,
    rotation,
    operationalState: "offline",
    overclock: { ...geometry.blueprintModule.defaultOverclock },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: geometry.definition.startupTicks,
    cooldownTicksRemaining: 0,
  };
}

function mapLocalModuleIds(
  geometries: readonly SourceModuleGeometry[],
  facilityModuleIds: readonly string[],
): Readonly<Record<string, string>> | BlueprintMaterializationFailure {
  if (geometries.length !== facilityModuleIds.length) {
    return failure("BLUEPRINT_INVALID", "invalid-record");
  }
  const result: Record<string, string> = {};
  for (const [index, geometry] of geometries.entries()) {
    const facilityModuleId = facilityModuleIds[index];
    if (facilityModuleId === undefined) return failure("BLUEPRINT_INVALID", "invalid-record");
    result[geometry.blueprintModule.localId] = facilityModuleId;
  }
  return result;
}

function candidateModuleState(
  state: Readonly<GameState>,
  addedModules: readonly ModuleInstanceState[],
  content: ContentBundle,
): { readonly modules: Record<string, ModuleInstanceState> } | BlueprintMaterializationFailure {
  const draft = state.facility.designDraft;
  if (draft === null) return failure("NOT_IN_DESIGN_MODE", "not-in-design-mode");
  const modules: Record<string, ModuleInstanceState> = { ...draft.modules };
  const occupancy = buildOccupancyIndex({ modules: draft.modules, content });
  if (occupancy.issues.length > 0) {
    const hasCollision = occupancy.issues.some(({ code }) => code === "TILE_OCCUPIED");
    return failure("INVALID_TARGET", hasCollision ? "collision" : "invalid-target");
  }
  const occupiedByTile = new Map<string, string[]>();
  for (const occupied of occupancy.tiles) {
    occupiedByTile.set(`${occupied.tile.x},${occupied.tile.y}`, [...occupied.moduleInstanceIds]);
  }
  for (const module of addedModules) {
    let hasCollision = false;
    let hasOutOfBoundsTile = false;
    const definition = content.modules[module.definitionId];
    if (definition === undefined) return failure("BLUEPRINT_INVALID", "invalid-record");
    let occupiedTiles: readonly GridPoint[];
    try {
      occupiedTiles = enumerateOccupiedTiles(
        module.position,
        definition.footprint,
        module.rotation,
      );
    } catch {
      return failure("BLUEPRINT_INVALID", "invalid-record");
    }
    for (const tile of occupiedTiles) {
      if (!isGridPointInBounds(tile, state.facility.size)) hasOutOfBoundsTile = true;
      if (occupiedByTile.has(`${tile.x},${tile.y}`)) hasCollision = true;
    }
    if (hasCollision || hasOutOfBoundsTile) {
      return failure("INVALID_TARGET", hasCollision ? "collision" : "invalid-target");
    }
    modules[module.id] = module;
    for (const tile of occupiedTiles) {
      const tileKey = `${tile.x},${tile.y}`;
      const occupants = occupiedByTile.get(tileKey) ?? [];
      occupants.push(module.id);
      occupiedByTile.set(tileKey, occupants);
    }
  }
  return { modules };
}

function candidateRoutes(
  state: Readonly<GameState>,
  record: BlueprintRecord,
  geometries: readonly SourceModuleGeometry[],
  addedModules: readonly ModuleInstanceState[],
  facilityModuleIds: readonly string[],
  facilityRouteIds: readonly string[],
  targetPosition: GridPoint,
  globalRotation: Rotation,
  content: ContentBundle,
): { readonly routes: Record<string, RouteState> } | BlueprintMaterializationFailure {
  const draft = state.facility.designDraft;
  if (draft === null) return failure("NOT_IN_DESIGN_MODE", "not-in-design-mode");
  const localToFacility = mapLocalModuleIds(geometries, facilityModuleIds);
  if (isMaterializationFailure(localToFacility)) return localToFacility;
  const modules: Record<string, ModuleInstanceState> = { ...draft.modules };
  for (const module of addedModules) modules[module.id] = module;
  const routes: Record<string, RouteState> = { ...draft.routes };
  const sortedRoutes = [...record.routes].toSorted(compareBlueprintRoutes);
  if (sortedRoutes.length !== facilityRouteIds.length) {
    return failure("BLUEPRINT_INVALID", "invalid-record");
  }

  for (const [index, blueprintRoute] of sortedRoutes.entries()) {
    const routeId = facilityRouteIds[index];
    const fromModuleId = localToFacility[blueprintRoute.fromLocalModuleId];
    const toModuleId = localToFacility[blueprintRoute.toLocalModuleId];
    if (routeId === undefined || fromModuleId === undefined || toModuleId === undefined) {
      return failure("BLUEPRINT_INVALID", "invalid-record");
    }
    const endpoints = resolveManualRouteEndpoints(
      { modules },
      content,
      { moduleInstanceId: fromModuleId, portId: blueprintRoute.fromPortId },
      { moduleInstanceId: toModuleId, portId: blueprintRoute.toPortId },
    );
    if ("code" in endpoints) return routeFailure(endpoints);
    const transformedPath: GridPoint[] = [];
    for (const point of blueprintRoute.relativePath) {
      let transformed: GridPoint;
      try {
        transformed = transformBlueprintPoint(point, record.bounds, globalRotation);
      } catch {
        return failure("BLUEPRINT_INVALID", "invalid-record");
      }
      const translated = translatePoint(transformed, targetPosition);
      if (translated === null) return failure("INVALID_TARGET", "invalid-target");
      transformedPath.push(translated);
    }
    const path = endpoints.reverseSubmittedPath ? transformedPath.toReversed() : transformedPath;
    const pathFailure = validateManualRoutePath(
      { size: state.facility.size, modules },
      content,
      endpoints.from,
      endpoints.to,
      path,
    );
    if (pathFailure !== null) {
      return routeFailure(pathFailure);
    }
    routes[routeId] = {
      id: routeId,
      kind: endpoints.kind,
      from: { moduleInstanceId: endpoints.from.moduleInstanceId, portId: endpoints.from.portId },
      to: { moduleInstanceId: endpoints.to.moduleInstanceId, portId: endpoints.to.portId },
      path: path.map((point) => ({ ...point })),
      capacityPerSecond: Math.min(endpoints.from.capacityPerSecond, endpoints.to.capacityPerSecond),
      congestionRatio: 0,
    };
  }
  return { routes };
}

function validateCandidateDraft(
  state: Readonly<GameState>,
  modules: Readonly<Record<string, ModuleInstanceState>>,
  routes: Readonly<Record<string, RouteState>>,
  nextRouteSequence: number,
  content: ContentBundle,
): BlueprintMaterializationFailure | null {
  try {
    assertValidGridState(
      {
        ...state.facility,
        modules,
        routes,
        designDraft: null,
      },
      content,
    );
    const routeIssues = validateRouteState(
      { size: state.facility.size, modules, routes, nextRouteSequence },
      content,
    );
    const routeIssue = routeIssues[0];
    if (routeIssue !== undefined) {
      if (routeIssue.code === "INVALID_SYSTEM")
        return failure("INVALID_SYSTEM", "invalid-sequence");
      return routeFailure(routeIssue);
    }
  } catch {
    return failure("INVALID_TARGET", "candidate-geometry");
  }
  return null;
}

function planMaterialization(
  state: Readonly<GameState>,
  content: ContentBundle,
  blueprintId: string,
  targetPosition: GridPoint,
  globalRotation: Rotation,
): BlueprintMaterializationResult {
  if (state.facility.designDraft === null)
    return failure("NOT_IN_DESIGN_MODE", "not-in-design-mode");
  if (!isValidRotation(globalRotation)) return failure("INVALID_ROTATION", "invalid-rotation");
  if (!isGridPoint(targetPosition)) return failure("INVALID_TARGET", "invalid-target");
  if (!isValidFacilitySize(state.facility.size)) return failure("INVALID_SYSTEM", "invalid-grid");

  const recordResult = recordById(state, blueprintId);
  if (isMaterializationFailure(recordResult)) return recordResult;
  const record = recordResult;
  const currentContentFailure = contentFailure(record, state, content);
  if (currentContentFailure !== null) return currentContentFailure;

  const sourceGeometry = resolveSourceGeometry(record, content);
  if (isMaterializationFailure(sourceGeometry)) return sourceGeometry;
  const geometries = sourceGeometry.geometries;
  const rotatedBounds = resolveRotatedFootprintSize(record.bounds, globalRotation);
  if (
    targetPosition.x < 0 ||
    targetPosition.y < 0 ||
    !Number.isSafeInteger(targetPosition.x + rotatedBounds.width) ||
    !Number.isSafeInteger(targetPosition.y + rotatedBounds.height) ||
    targetPosition.x + rotatedBounds.width > state.facility.size.width ||
    targetPosition.y + rotatedBounds.height > state.facility.size.height
  ) {
    return failure("INVALID_TARGET", "invalid-target");
  }

  const inventoryDelta = calculateReservationDelta(state, geometries);
  if (isMaterializationFailure(inventoryDelta)) return inventoryDelta;

  const moduleIds = allocateIds(
    state.facility.nextModuleInstanceSequence,
    geometries.length,
    MODULE_INSTANCE_ID_PREFIX,
    8,
    [state.facility.modules, state.facility.designDraft.modules],
  );
  if (isMaterializationFailure(moduleIds)) return moduleIds;
  const routeIds = allocateIds(
    state.facility.nextRouteSequence,
    record.routes.length,
    ROUTE_ID_PREFIX,
    8,
    [state.facility.routes, state.facility.designDraft.routes],
  );
  if (isMaterializationFailure(routeIds)) return routeIds;

  const addedModules: ModuleInstanceState[] = [];
  for (const [index, geometry] of geometries.entries()) {
    const facilityModuleId = moduleIds.ids[index];
    if (facilityModuleId === undefined) return failure("BLUEPRINT_INVALID", "invalid-record");
    const module = materializedModule(
      geometry,
      record.bounds,
      targetPosition,
      globalRotation,
      facilityModuleId,
    );
    if (isMaterializationFailure(module)) return module;
    addedModules.push(module);
  }
  const candidateModules = candidateModuleState(state, addedModules, content);
  if (isMaterializationFailure(candidateModules)) return candidateModules;
  const candidateRoutesResult = candidateRoutes(
    state,
    record,
    geometries,
    addedModules,
    moduleIds.ids,
    routeIds.ids,
    targetPosition,
    globalRotation,
    content,
  );
  if (isMaterializationFailure(candidateRoutesResult)) return candidateRoutesResult;
  const candidateFailure = validateCandidateDraft(
    state,
    candidateModules.modules,
    candidateRoutesResult.routes,
    routeIds.nextSequence,
    content,
  );
  if (candidateFailure !== null) return candidateFailure;

  return {
    status: "ready",
    plan: detached({
      blueprintId: record.id,
      blueprintVersion: record.version,
      targetPosition: { ...targetPosition },
      globalRotation,
      addedModules,
      addedRoutes: Object.values(candidateRoutesResult.routes)
        .filter((route) => routeIds.ids.includes(route.id))
        .toSorted((left, right) => compareStableStrings(left.id, right.id)),
      nextModuleInstanceSequence: moduleIds.nextSequence,
      nextRouteSequence: routeIds.nextSequence,
      inventoryReservationDelta: inventoryDelta,
    }),
  };
}

/** Plans a complete deterministic Blueprint materialization without mutating authoritative state. */
export function planBlueprintMaterialization(
  state: Readonly<GameState>,
  content: ContentBundle,
  blueprintId: string,
  targetPosition: GridPoint,
  globalRotation: Rotation,
): BlueprintMaterializationResult {
  try {
    return planMaterialization(state, content, blueprintId, targetPosition, globalRotation);
  } catch {
    return failure("BLUEPRINT_INVALID", "invalid-record");
  }
}
