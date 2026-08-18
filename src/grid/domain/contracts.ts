import type { CommandRejectionCode } from "../../sim/commands/contracts.ts";
import type { GridPoint, ModuleInstanceId } from "../../sim/core/types.ts";

export type GridValidationIssueCode = Extract<
  CommandRejectionCode,
  "INVALID_PAYLOAD" | "OUT_OF_BOUNDS" | "TILE_OCCUPIED"
>;

export type GridValidationIssueReason =
  | "INVALID_FACILITY_SIZE"
  | "INVALID_POSITION"
  | "INVALID_ROTATION"
  | "INVALID_FOOTPRINT"
  | "UNKNOWN_MODULE_DEFINITION"
  | "MODULE_RECORD_KEY_MISMATCH"
  | "FOOTPRINT_TILE_OUT_OF_BOUNDS"
  | "PLACEMENT_TILE_OCCUPIED"
  | "DUPLICATE_TILE_OCCUPANCY"
  | "INVALID_PORT_DEFINITION";

export interface GridValidationIssue {
  readonly code: GridValidationIssueCode;
  readonly reason: GridValidationIssueReason;
  readonly moduleRecordKey?: string;
  readonly moduleInstanceId?: ModuleInstanceId;
  readonly definitionId?: string;
  readonly portId?: string;
  readonly tile?: GridPoint;
  readonly occupyingModuleInstanceId?: ModuleInstanceId;
}

export interface OccupancyTile {
  readonly tile: GridPoint;
  readonly moduleInstanceIds: readonly ModuleInstanceId[];
}

export interface OccupancyIndex {
  readonly tiles: readonly OccupancyTile[];
  readonly issues: readonly GridValidationIssue[];
}

export interface PlacementValidationResult {
  readonly valid: boolean;
  readonly occupiedTiles: readonly GridPoint[];
  readonly issues: readonly GridValidationIssue[];
}
