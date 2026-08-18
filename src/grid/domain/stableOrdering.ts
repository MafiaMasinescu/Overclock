import type { GridPoint } from "../../sim/core/types.ts";
import type { GridValidationIssue } from "./contracts.ts";

export function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function compareGridPointsRowMajor(left: GridPoint, right: GridPoint): number {
  return left.y - right.y || left.x - right.x;
}

const ISSUE_CODE_ORDER: Readonly<Record<GridValidationIssue["code"], number>> = {
  INVALID_PAYLOAD: 0,
  OUT_OF_BOUNDS: 1,
  TILE_OCCUPIED: 2,
};

function optionalString(value: string | undefined): string {
  return value ?? "";
}

function optionalCoordinate(value: number | undefined): number {
  return value ?? Number.MIN_SAFE_INTEGER;
}

export function compareGridValidationIssues(
  left: GridValidationIssue,
  right: GridValidationIssue,
): number {
  return (
    ISSUE_CODE_ORDER[left.code] - ISSUE_CODE_ORDER[right.code] ||
    compareStableStrings(left.reason, right.reason) ||
    compareStableStrings(
      optionalString(left.moduleRecordKey),
      optionalString(right.moduleRecordKey),
    ) ||
    compareStableStrings(
      optionalString(left.moduleInstanceId),
      optionalString(right.moduleInstanceId),
    ) ||
    compareStableStrings(optionalString(left.definitionId), optionalString(right.definitionId)) ||
    optionalCoordinate(left.tile?.y) - optionalCoordinate(right.tile?.y) ||
    optionalCoordinate(left.tile?.x) - optionalCoordinate(right.tile?.x) ||
    compareStableStrings(optionalString(left.portId), optionalString(right.portId)) ||
    compareStableStrings(
      optionalString(left.occupyingModuleInstanceId),
      optionalString(right.occupyingModuleInstanceId),
    )
  );
}
