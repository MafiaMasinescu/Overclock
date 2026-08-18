import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityState } from "../../sim/core/types.ts";
import type { GridValidationIssue } from "../domain/contracts.ts";
import { isGridPointInBounds, isValidFacilitySize } from "../domain/footprintGeometry.ts";
import { buildOccupancyIndex } from "../domain/occupancy.ts";
import { resolveModulePortGeometry } from "../domain/portGeometry.ts";
import { compareGridValidationIssues } from "../domain/stableOrdering.ts";

export class GridStateInvariantError extends Error {
  readonly issues: readonly GridValidationIssue[];

  constructor(issues: readonly GridValidationIssue[]) {
    super("Grid state invariant violation.");
    this.name = "GridStateInvariantError";
    this.issues = issues;
  }
}

export function validateGridState(
  facility: FacilityState,
  content: ContentBundle,
): readonly GridValidationIssue[] {
  const issues: GridValidationIssue[] = [];
  if (!isValidFacilitySize(facility.size)) {
    issues.push({ code: "INVALID_PAYLOAD", reason: "INVALID_FACILITY_SIZE" });
  }

  const occupancy = buildOccupancyIndex({ modules: facility.modules, content });
  issues.push(...occupancy.issues);
  for (const occupied of occupancy.tiles) {
    if (!isGridPointInBounds(occupied.tile, facility.size)) {
      for (const moduleInstanceId of occupied.moduleInstanceIds) {
        issues.push({
          code: "OUT_OF_BOUNDS",
          reason: "FOOTPRINT_TILE_OUT_OF_BOUNDS",
          moduleInstanceId,
          tile: { ...occupied.tile },
        });
      }
    }
  }

  for (const [, module] of Object.entries(facility.modules).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const definition = content.modules[module.definitionId];
    if (definition !== undefined) {
      issues.push(...resolveModulePortGeometry(module, definition).issues);
    }
  }

  return issues.toSorted(compareGridValidationIssues);
}

export function assertValidGridState(facility: FacilityState, content: ContentBundle): void {
  const issues = validateGridState(facility, content);
  if (issues.length > 0) {
    throw new GridStateInvariantError(issues);
  }
}
