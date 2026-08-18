import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  GridPoint,
  ModuleInstanceId,
  ModuleInstanceState,
  Rotation,
  Size2D,
} from "../../sim/core/types.ts";
import type {
  GridValidationIssue,
  OccupancyIndex,
  PlacementValidationResult,
} from "./contracts.ts";
import {
  enumerateOccupiedTiles,
  isGridPointInBounds,
  isIntegerGridPoint,
  isValidFacilitySize,
  isValidFootprintSize,
  isValidRotation,
} from "./footprintGeometry.ts";
import {
  compareGridPointsRowMajor,
  compareGridValidationIssues,
  compareStableStrings,
} from "./stableOrdering.ts";

export interface BuildOccupancyIndexOptions {
  readonly modules: Readonly<Record<string, ModuleInstanceState>>;
  readonly content: ContentBundle;
  readonly excludeModuleInstanceId?: ModuleInstanceId;
}

export interface ValidateModulePlacementOptions {
  readonly facilitySize: Size2D;
  readonly definitionId: string;
  readonly position: GridPoint;
  readonly rotation: Rotation;
  readonly modules: Readonly<Record<string, ModuleInstanceState>>;
  readonly content: ContentBundle;
  readonly excludeModuleInstanceId?: ModuleInstanceId;
}

interface MutableOccupancyTile {
  readonly tile: GridPoint;
  readonly moduleInstanceIds: string[];
}

function tileKey(tile: GridPoint): string {
  return `${tile.x},${tile.y}`;
}

function invalidModuleGeometryIssues(
  module: ModuleInstanceState,
  footprint: Size2D,
): GridValidationIssue[] {
  const issues: GridValidationIssue[] = [];
  if (!isIntegerGridPoint(module.position)) {
    issues.push({
      code: "INVALID_PAYLOAD",
      reason: "INVALID_POSITION",
      moduleInstanceId: module.id,
      definitionId: module.definitionId,
    });
  }
  if (!isValidRotation(module.rotation)) {
    issues.push({
      code: "INVALID_PAYLOAD",
      reason: "INVALID_ROTATION",
      moduleInstanceId: module.id,
      definitionId: module.definitionId,
    });
  }
  if (!isValidFootprintSize(footprint)) {
    issues.push({
      code: "INVALID_PAYLOAD",
      reason: "INVALID_FOOTPRINT",
      moduleInstanceId: module.id,
      definitionId: module.definitionId,
    });
  }
  return issues;
}

export function buildOccupancyIndex({
  modules,
  content,
  excludeModuleInstanceId,
}: BuildOccupancyIndexOptions): OccupancyIndex {
  const issues: GridValidationIssue[] = [];
  const occupancyByTile = new Map<string, MutableOccupancyTile>();
  const records = Object.entries(modules).toSorted(([leftKey], [rightKey]) =>
    compareStableStrings(leftKey, rightKey),
  );

  for (const [recordKey, module] of records) {
    if (module.id === excludeModuleInstanceId) {
      continue;
    }
    if (recordKey !== module.id) {
      issues.push({
        code: "INVALID_PAYLOAD",
        reason: "MODULE_RECORD_KEY_MISMATCH",
        moduleRecordKey: recordKey,
        moduleInstanceId: module.id,
      });
    }

    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      issues.push({
        code: "INVALID_PAYLOAD",
        reason: "UNKNOWN_MODULE_DEFINITION",
        moduleInstanceId: module.id,
        definitionId: module.definitionId,
      });
      continue;
    }

    const geometryIssues = invalidModuleGeometryIssues(module, definition.footprint);
    issues.push(...geometryIssues);
    if (geometryIssues.length > 0) {
      continue;
    }

    for (const tile of enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    )) {
      const key = tileKey(tile);
      const occupied = occupancyByTile.get(key);
      if (occupied === undefined) {
        occupancyByTile.set(key, { tile, moduleInstanceIds: [module.id] });
      } else {
        occupied.moduleInstanceIds.push(module.id);
      }
    }
  }

  const tiles = [...occupancyByTile.values()]
    .map(({ tile, moduleInstanceIds }) => ({
      tile: { ...tile },
      moduleInstanceIds: moduleInstanceIds.toSorted(compareStableStrings),
    }))
    .toSorted((left, right) => compareGridPointsRowMajor(left.tile, right.tile));

  for (const occupied of tiles) {
    const first = occupied.moduleInstanceIds[0];
    if (first === undefined) {
      continue;
    }
    for (const duplicate of occupied.moduleInstanceIds.slice(1)) {
      issues.push({
        code: "TILE_OCCUPIED",
        reason: "DUPLICATE_TILE_OCCUPANCY",
        tile: { ...occupied.tile },
        moduleInstanceId: first,
        occupyingModuleInstanceId: duplicate,
      });
    }
  }

  return {
    tiles,
    issues: issues.toSorted(compareGridValidationIssues),
  };
}

export function findOccupyingModuleInstanceIds(
  occupancy: OccupancyIndex,
  tile: GridPoint,
): readonly ModuleInstanceId[] {
  const occupied = occupancy.tiles.find(
    (candidate) => candidate.tile.x === tile.x && candidate.tile.y === tile.y,
  );
  return occupied === undefined ? [] : [...occupied.moduleInstanceIds];
}

export function validateModulePlacement({
  facilitySize,
  definitionId,
  position,
  rotation,
  modules,
  content,
  excludeModuleInstanceId,
}: ValidateModulePlacementOptions): PlacementValidationResult {
  const issues: GridValidationIssue[] = [];
  if (!isValidFacilitySize(facilitySize)) {
    issues.push({ code: "INVALID_PAYLOAD", reason: "INVALID_FACILITY_SIZE" });
  }
  const definition = content.modules[definitionId];
  if (definition === undefined) {
    issues.push({
      code: "INVALID_PAYLOAD",
      reason: "UNKNOWN_MODULE_DEFINITION",
      definitionId,
    });
  }
  if (!isIntegerGridPoint(position)) {
    issues.push({ code: "INVALID_PAYLOAD", reason: "INVALID_POSITION", definitionId });
  }
  if (!isValidRotation(rotation)) {
    issues.push({ code: "INVALID_PAYLOAD", reason: "INVALID_ROTATION", definitionId });
  }
  if (definition !== undefined && !isValidFootprintSize(definition.footprint)) {
    issues.push({ code: "INVALID_PAYLOAD", reason: "INVALID_FOOTPRINT", definitionId });
  }

  if (issues.length > 0 || definition === undefined) {
    return {
      valid: false,
      occupiedTiles: [],
      issues: issues.toSorted(compareGridValidationIssues),
    };
  }

  const occupiedTiles = enumerateOccupiedTiles(position, definition.footprint, rotation);
  const occupancy = buildOccupancyIndex({
    modules,
    content,
    ...(excludeModuleInstanceId === undefined ? {} : { excludeModuleInstanceId }),
  });
  issues.push(...occupancy.issues);
  for (const tile of occupiedTiles) {
    if (!isGridPointInBounds(tile, facilitySize)) {
      issues.push({
        code: "OUT_OF_BOUNDS",
        reason: "FOOTPRINT_TILE_OUT_OF_BOUNDS",
        definitionId,
        tile: { ...tile },
      });
    }
    for (const occupyingModuleInstanceId of findOccupyingModuleInstanceIds(occupancy, tile)) {
      issues.push({
        code: "TILE_OCCUPIED",
        reason: "PLACEMENT_TILE_OCCUPIED",
        definitionId,
        tile: { ...tile },
        occupyingModuleInstanceId,
      });
    }
  }

  const orderedIssues = issues.toSorted(compareGridValidationIssues);
  return { valid: orderedIssues.length === 0, occupiedTiles, issues: orderedIssues };
}
