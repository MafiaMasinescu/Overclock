import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { isGridPointInBounds } from "../../grid/domain/footprintGeometry.ts";
import {
  buildOccupancyIndex,
  findOccupyingModuleInstanceIds,
} from "../../grid/domain/occupancy.ts";
import type { OccupancyIndex } from "../../grid/domain/contracts.ts";
import {
  resolveCompatiblePortPair,
  resolveModulePortGeometry,
  type ResolvedPortGeometry,
} from "../../grid/domain/portGeometry.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type { CommandRejectionCode } from "../commands/contracts.ts";
import type { FacilityState, GridPoint, PortRef, RouteState } from "../core/types.ts";

export type ManualRouteReason =
  | "ROUTE_NOT_FOUND"
  | "DUPLICATE_ENDPOINT_PAIR"
  | "PATH_TOO_SHORT"
  | "PATH_TOO_LONG"
  | "PATH_ENDPOINT_MISMATCH"
  | "NON_ORTHOGONAL_SEGMENT"
  | "REPEATED_PATH_TILE"
  | "MISSING_MODULE"
  | "MISSING_PORT"
  | "SAME_MODULE_ENDPOINT"
  | "AIRFLOW_PORT"
  | "INVALID_ENDPOINT_CAPACITY"
  | "ROUTE_RECORD_KEY_MISMATCH"
  | "NON_CANONICAL_ENDPOINT_DIRECTION"
  | "PATH_INTERIOR_TILE_OCCUPIED"
  | "INVALID_ROUTE_CAPACITY"
  | "INVALID_CONGESTION_RATIO"
  | "INVALID_ROUTE_SEQUENCE";

export interface ManualRouteFailure {
  readonly code: CommandRejectionCode;
  readonly reason: ManualRouteReason;
}

export interface ResolvedManualRouteEndpoints {
  readonly kind: RouteState["kind"];
  readonly from: ResolvedPortGeometry;
  readonly to: ResolvedPortGeometry;
  readonly reverseSubmittedPath: boolean;
}

export interface RouteValidationIssue extends ManualRouteFailure {
  readonly routeId?: string;
}

function failure(code: CommandRejectionCode, reason: ManualRouteReason): ManualRouteFailure {
  return { code, reason };
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function samePortReference(left: PortRef, right: PortRef): boolean {
  return left.moduleInstanceId === right.moduleInstanceId && left.portId === right.portId;
}

function routeEntries(routes: Readonly<Record<string, RouteState>>) {
  return Object.entries(routes).toSorted(
    ([leftKey, left], [rightKey, right]) =>
      compareStableStrings(left.id, right.id) || compareStableStrings(leftKey, rightKey),
  );
}

function findPort(
  facility: Pick<FacilityState, "modules">,
  content: ContentBundle,
  reference: PortRef,
): ResolvedPortGeometry | ManualRouteFailure {
  if (!Object.hasOwn(facility.modules, reference.moduleInstanceId)) {
    return failure("INVALID_PORT", "MISSING_MODULE");
  }
  const module = facility.modules[reference.moduleInstanceId];
  if (module === undefined) {
    return failure("INVALID_PORT", "MISSING_MODULE");
  }
  const definition = content.modules[module.definitionId];
  if (definition === undefined) {
    return failure("INVALID_PORT", "MISSING_MODULE");
  }
  const geometry = resolveModulePortGeometry(module, definition);
  if (geometry.issues.length > 0) {
    return failure("INVALID_PORT", "MISSING_PORT");
  }
  const port = geometry.ports.find((candidate) => candidate.portId === reference.portId);
  return port ?? failure("INVALID_PORT", "MISSING_PORT");
}

function isFailure(value: unknown): value is ManualRouteFailure {
  return value !== null && typeof value === "object" && "code" in value;
}

export function resolveManualRouteEndpoints(
  facility: Pick<FacilityState, "modules">,
  content: ContentBundle,
  submittedFrom: PortRef,
  submittedTo: PortRef,
): ResolvedManualRouteEndpoints | ManualRouteFailure {
  const fromPort = findPort(facility, content, submittedFrom);
  if (isFailure(fromPort)) {
    return fromPort;
  }
  const toPort = findPort(facility, content, submittedTo);
  if (isFailure(toPort)) {
    return toPort;
  }
  if (fromPort.moduleInstanceId === toPort.moduleInstanceId) {
    return failure("INVALID_PORT", "SAME_MODULE_ENDPOINT");
  }
  if (fromPort.kind === "airflow" || toPort.kind === "airflow") {
    return failure("INVALID_PORT", "AIRFLOW_PORT");
  }
  const compatible = resolveCompatiblePortPair(fromPort, toPort);
  if (compatible === null) {
    return failure("INCOMPATIBLE_PORTS", "MISSING_PORT");
  }
  if (
    !Number.isFinite(fromPort.capacityPerSecond) ||
    fromPort.capacityPerSecond <= 0 ||
    !Number.isFinite(toPort.capacityPerSecond) ||
    toPort.capacityPerSecond <= 0
  ) {
    return failure("INVALID_PORT", "INVALID_ENDPOINT_CAPACITY");
  }

  const canonicalFrom = samePortReference(compatible.from, submittedFrom) ? fromPort : toPort;
  const canonicalTo = samePortReference(compatible.to, submittedTo) ? toPort : fromPort;
  return {
    kind: compatible.kind,
    from: canonicalFrom,
    to: canonicalTo,
    reverseSubmittedPath: !samePortReference(compatible.from, submittedFrom),
  };
}

function containsDuplicateEndpointPair(
  routes: Readonly<Record<string, RouteState>>,
  from: PortRef,
  to: PortRef,
): boolean {
  return routeEntries(routes).some(
    ([, route]) => samePortReference(route.from, from) && samePortReference(route.to, to),
  );
}

export function validateManualRoutePath(
  facility: Pick<FacilityState, "size" | "modules">,
  content: ContentBundle,
  from: ResolvedPortGeometry,
  to: ResolvedPortGeometry,
  path: readonly GridPoint[],
): ManualRouteFailure | null {
  return validateManualRoutePathWithOccupancy(facility, content, from, to, path);
}

function validateManualRoutePathWithOccupancy(
  facility: Pick<FacilityState, "size" | "modules">,
  content: ContentBundle,
  from: ResolvedPortGeometry,
  to: ResolvedPortGeometry,
  path: readonly GridPoint[],
  occupancy?: OccupancyIndex,
): ManualRouteFailure | null {
  const maximumLength = facility.size.width * facility.size.height;
  if (path.length < 2) {
    return failure("INVALID_ROUTE", "PATH_TOO_SHORT");
  }
  if (!Number.isSafeInteger(maximumLength) || path.length > maximumLength) {
    return failure("INVALID_ROUTE", "PATH_TOO_LONG");
  }

  const penultimate = path.at(-2);
  const final = path.at(-1);
  const second = path[1];
  const first = path[0];
  if (
    first === undefined ||
    second === undefined ||
    penultimate === undefined ||
    final === undefined ||
    !samePoint(first, from.moduleTile) ||
    !samePoint(second, from.adjacentTile) ||
    !samePoint(penultimate, to.adjacentTile) ||
    !samePoint(final, to.moduleTile)
  ) {
    return failure("INVALID_ROUTE", "PATH_ENDPOINT_MISMATCH");
  }

  for (const point of path) {
    if (!isGridPointInBounds(point, facility.size)) {
      return failure("OUT_OF_BOUNDS", "PATH_ENDPOINT_MISMATCH");
    }
  }

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (previous === undefined || current === undefined) {
      throw new Error("Route path unexpectedly became sparse after command validation.");
    }
    if (Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y) !== 1) {
      return failure("INVALID_ROUTE", "NON_ORTHOGONAL_SEGMENT");
    }
  }

  const seen = new Set<string>();
  for (const point of path) {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) {
      return failure("INVALID_ROUTE", "REPEATED_PATH_TILE");
    }
    seen.add(key);
  }

  const resolvedOccupancy =
    occupancy ?? buildOccupancyIndex({ modules: facility.modules, content });
  if (resolvedOccupancy.issues.length > 0) {
    throw new Error("Route validation requires a valid module occupancy state.");
  }
  for (let index = 1; index < path.length - 1; index += 1) {
    const point = path[index];
    if (point === undefined) {
      throw new Error("Route path unexpectedly became sparse after command validation.");
    }
    if (findOccupyingModuleInstanceIds(resolvedOccupancy, point).length > 0) {
      return failure("TILE_OCCUPIED", "PATH_INTERIOR_TILE_OCCUPIED");
    }
  }
  return null;
}

export function validateManualRouteConnection(
  facility: Pick<FacilityState, "size" | "modules" | "routes">,
  content: ContentBundle,
  submittedFrom: PortRef,
  submittedTo: PortRef,
  path: readonly GridPoint[],
): ResolvedManualRouteEndpoints | ManualRouteFailure {
  const endpoints = resolveManualRouteEndpoints(facility, content, submittedFrom, submittedTo);
  if (isFailure(endpoints)) {
    return endpoints;
  }
  if (containsDuplicateEndpointPair(facility.routes, endpoints.from, endpoints.to)) {
    return failure("INVALID_ROUTE", "DUPLICATE_ENDPOINT_PAIR");
  }
  const pathFailure = validateManualRoutePath(
    facility,
    content,
    endpoints.reverseSubmittedPath ? endpoints.to : endpoints.from,
    endpoints.reverseSubmittedPath ? endpoints.from : endpoints.to,
    path,
  );
  return pathFailure ?? endpoints;
}

export function validateRouteState(
  facility: Pick<FacilityState, "size" | "modules" | "routes" | "nextRouteSequence">,
  content: ContentBundle,
): readonly RouteValidationIssue[] {
  const issues: RouteValidationIssue[] = [];
  const occupancy = buildOccupancyIndex({ modules: facility.modules, content });
  if (!Number.isSafeInteger(facility.nextRouteSequence) || facility.nextRouteSequence <= 0) {
    issues.push({ code: "INVALID_SYSTEM", reason: "INVALID_ROUTE_SEQUENCE" });
  }

  for (const [routeKey, route] of routeEntries(facility.routes)) {
    if (routeKey !== route.id) {
      issues.push({
        code: "INVALID_ROUTE",
        reason: "ROUTE_RECORD_KEY_MISMATCH",
        routeId: routeKey,
      });
      continue;
    }
    const routeKind: unknown = route.kind;
    if (route.id.length === 0 || (routeKind !== "power" && routeKind !== "data")) {
      issues.push({
        code: "INVALID_ROUTE",
        reason: "ROUTE_RECORD_KEY_MISMATCH",
        routeId: routeKey,
      });
      continue;
    }
    const endpoints = resolveManualRouteEndpoints(facility, content, route.from, route.to);
    if (isFailure(endpoints)) {
      issues.push({ ...endpoints, routeId: route.id });
      continue;
    }
    if (
      endpoints.kind !== route.kind ||
      !samePortReference(endpoints.from, route.from) ||
      !samePortReference(endpoints.to, route.to)
    ) {
      issues.push({
        code: "INVALID_ROUTE",
        reason: "NON_CANONICAL_ENDPOINT_DIRECTION",
        routeId: route.id,
      });
      continue;
    }
    const pathFailure = validateManualRoutePathWithOccupancy(
      facility,
      content,
      endpoints.from,
      endpoints.to,
      route.path,
      occupancy,
    );
    if (pathFailure !== null) {
      issues.push({ ...pathFailure, routeId: route.id });
      continue;
    }
    const expectedCapacity = Math.min(
      endpoints.from.capacityPerSecond,
      endpoints.to.capacityPerSecond,
    );
    if (
      !Number.isFinite(route.capacityPerSecond) ||
      route.capacityPerSecond <= 0 ||
      route.capacityPerSecond !== expectedCapacity
    ) {
      issues.push({ code: "INVALID_ROUTE", reason: "INVALID_ROUTE_CAPACITY", routeId: route.id });
    }
    if (
      !Number.isFinite(route.congestionRatio) ||
      route.congestionRatio < 0 ||
      route.congestionRatio > 1
    ) {
      issues.push({ code: "INVALID_ROUTE", reason: "INVALID_CONGESTION_RATIO", routeId: route.id });
    }
  }

  const pairs = routeEntries(facility.routes);
  for (let index = 1; index < pairs.length; index += 1) {
    const [, route] = pairs[index] ?? [];
    if (route === undefined) {
      continue;
    }
    if (
      pairs
        .slice(0, index)
        .some(
          ([, previous]) =>
            samePortReference(previous.from, route.from) &&
            samePortReference(previous.to, route.to),
        )
    ) {
      issues.push({ code: "INVALID_ROUTE", reason: "DUPLICATE_ENDPOINT_PAIR", routeId: route.id });
    }
  }
  return issues.toSorted(
    (left, right) =>
      compareStableStrings(left.routeId ?? "", right.routeId ?? "") ||
      compareStableStrings(left.reason, right.reason) ||
      compareStableStrings(left.code, right.code),
  );
}

export function assertValidRouteState(
  facility: Pick<FacilityState, "size" | "modules" | "routes" | "nextRouteSequence">,
  content: ContentBundle,
): void {
  const issues = validateRouteState(facility, content);
  if (issues.length > 0) {
    throw new Error(`Route state invariant violation: ${JSON.stringify(issues)}`);
  }
}
