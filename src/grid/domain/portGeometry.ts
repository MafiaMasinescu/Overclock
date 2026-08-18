import type {
  DeepReadonly,
  ModuleDefinition,
  ModulePortDefinition,
} from "../../content/schemas/contentSchemas.ts";
import type { GridPoint, ModuleInstanceState, PortRef, RouteKind } from "../../sim/core/types.ts";
import type { GridValidationIssue } from "./contracts.ts";
import {
  isIntegerGridPoint,
  isValidFootprintSize,
  isValidRotation,
  transformLocalFootprintPoint,
} from "./footprintGeometry.ts";
import { compareGridValidationIssues, compareStableStrings } from "./stableOrdering.ts";

export type PortKind = ModulePortDefinition["kind"];
export type PortSide = ModulePortDefinition["side"];

export interface ResolvedPortGeometry {
  readonly moduleInstanceId: string;
  readonly portId: string;
  readonly kind: PortKind;
  readonly facingSide: PortSide;
  readonly moduleTile: GridPoint;
  readonly adjacentTile: GridPoint;
  readonly capacityPerSecond: number;
}

export interface ResolvedModulePortGeometry {
  readonly ports: readonly ResolvedPortGeometry[];
  readonly issues: readonly GridValidationIssue[];
}

export interface CompatiblePortPair {
  readonly kind: RouteKind;
  readonly from: PortRef;
  readonly to: PortRef;
}

const SIDES: readonly PortSide[] = ["north", "east", "south", "west"];
const PORT_KINDS: readonly PortKind[] = [
  "power-in",
  "power-out",
  "data-in",
  "data-out",
  "data-bidirectional",
  "airflow",
];

function comparePortDefinitions(
  left: DeepReadonly<ModulePortDefinition>,
  right: DeepReadonly<ModulePortDefinition>,
): number {
  return (
    compareStableStrings(left.id, right.id) ||
    compareStableStrings(left.kind, right.kind) ||
    compareStableStrings(left.side, right.side) ||
    left.offset - right.offset ||
    left.capacityPerSecond - right.capacityPerSecond
  );
}

export function comparePortReferences(left: PortRef, right: PortRef): number {
  return (
    compareStableStrings(left.moduleInstanceId, right.moduleInstanceId) ||
    compareStableStrings(left.portId, right.portId)
  );
}

function portReference(port: ResolvedPortGeometry): PortRef {
  return { moduleInstanceId: port.moduleInstanceId, portId: port.portId };
}

function localPortTile(
  port: DeepReadonly<ModulePortDefinition>,
  footprint: DeepReadonly<ModuleDefinition>["footprint"],
): GridPoint {
  switch (port.side) {
    case "north":
      return { x: port.offset, y: 0 };
    case "east":
      return { x: footprint.width - 1, y: port.offset };
    case "south":
      return { x: port.offset, y: footprint.height - 1 };
    case "west":
      return { x: 0, y: port.offset };
  }
}

function rotateSide(side: PortSide, rotation: ModuleInstanceState["rotation"]): PortSide {
  const start = SIDES.indexOf(side);
  const steps = rotation / 90;
  const rotated = SIDES[(start + steps) % SIDES.length];
  if (rotated === undefined) {
    throw new Error("Port side rotation produced no side.");
  }
  return rotated;
}

function adjacentTile(tile: GridPoint, side: PortSide): GridPoint {
  switch (side) {
    case "north":
      return { x: tile.x, y: tile.y - 1 };
    case "east":
      return { x: tile.x + 1, y: tile.y };
    case "south":
      return { x: tile.x, y: tile.y + 1 };
    case "west":
      return { x: tile.x - 1, y: tile.y };
  }
}

function isValidPort(
  port: DeepReadonly<ModulePortDefinition>,
  definition: DeepReadonly<ModuleDefinition>,
): boolean {
  const maximumOffset =
    port.side === "north" || port.side === "south"
      ? definition.footprint.width
      : definition.footprint.height;
  return (
    port.id.length > 0 &&
    PORT_KINDS.includes(port.kind) &&
    SIDES.includes(port.side) &&
    Number.isInteger(port.offset) &&
    port.offset >= 0 &&
    port.offset < maximumOffset &&
    Number.isFinite(port.capacityPerSecond) &&
    port.capacityPerSecond >= 0
  );
}

function invalidPortIssue(
  module: ModuleInstanceState,
  definition: DeepReadonly<ModuleDefinition>,
  portId?: string,
): GridValidationIssue {
  return {
    code: "INVALID_PAYLOAD",
    reason: "INVALID_PORT_DEFINITION",
    moduleInstanceId: module.id,
    definitionId: definition.id,
    ...(portId === undefined ? {} : { portId }),
  };
}

export function resolveModulePortGeometry(
  module: ModuleInstanceState,
  definition: DeepReadonly<ModuleDefinition>,
): ResolvedModulePortGeometry {
  const issues: GridValidationIssue[] = [];
  if (
    !isIntegerGridPoint(module.position) ||
    !isValidRotation(module.rotation) ||
    !isValidFootprintSize(definition.footprint)
  ) {
    return { ports: [], issues: [invalidPortIssue(module, definition)] };
  }

  const ports: ResolvedPortGeometry[] = [];
  const seenPortIds = new Set<string>();
  for (const port of definition.ports.toSorted(comparePortDefinitions)) {
    if (seenPortIds.has(port.id) || !isValidPort(port, definition)) {
      issues.push(invalidPortIssue(module, definition, port.id));
      continue;
    }
    seenPortIds.add(port.id);

    const transformed = transformLocalFootprintPoint(
      localPortTile(port, definition.footprint),
      definition.footprint,
      module.rotation,
    );
    const moduleTile = {
      x: module.position.x + transformed.x,
      y: module.position.y + transformed.y,
    };
    const facingSide = rotateSide(port.side, module.rotation);
    ports.push({
      moduleInstanceId: module.id,
      portId: port.id,
      kind: port.kind,
      facingSide,
      moduleTile,
      adjacentTile: adjacentTile(moduleTile, facingSide),
      capacityPerSecond: port.capacityPerSecond,
    });
  }

  return { ports, issues: issues.toSorted(compareGridValidationIssues) };
}

function areOppositeSides(left: PortSide, right: PortSide): boolean {
  return (
    (left === "north" && right === "south") ||
    (left === "east" && right === "west") ||
    (left === "south" && right === "north") ||
    (left === "west" && right === "east")
  );
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

export function arePortsPhysicallyAdjacent(
  left: ResolvedPortGeometry,
  right: ResolvedPortGeometry,
): boolean {
  return (
    left.moduleInstanceId !== right.moduleInstanceId &&
    areOppositeSides(left.facingSide, right.facingSide) &&
    samePoint(left.adjacentTile, right.moduleTile) &&
    samePoint(right.adjacentTile, left.moduleTile)
  );
}

function directedPair(
  kind: RouteKind,
  from: ResolvedPortGeometry,
  to: ResolvedPortGeometry,
): CompatiblePortPair {
  return { kind, from: portReference(from), to: portReference(to) };
}

export function resolveCompatiblePortPair(
  left: ResolvedPortGeometry,
  right: ResolvedPortGeometry,
): CompatiblePortPair | null {
  if (left.kind === "power-out" && right.kind === "power-in") {
    return directedPair("power", left, right);
  }
  if (right.kind === "power-out" && left.kind === "power-in") {
    return directedPair("power", right, left);
  }

  const leftIsData = left.kind.startsWith("data-");
  const rightIsData = right.kind.startsWith("data-");
  if (!leftIsData || !rightIsData) {
    return null;
  }
  if (left.kind === "data-out" && right.kind !== "data-out") {
    return directedPair("data", left, right);
  }
  if (right.kind === "data-out" && left.kind !== "data-out") {
    return directedPair("data", right, left);
  }
  if (left.kind === "data-in" && right.kind === "data-bidirectional") {
    return directedPair("data", right, left);
  }
  if (right.kind === "data-in" && left.kind === "data-bidirectional") {
    return directedPair("data", left, right);
  }
  if (left.kind === "data-bidirectional" && right.kind === "data-bidirectional") {
    return comparePortReferences(portReference(left), portReference(right)) <= 0
      ? directedPair("data", left, right)
      : directedPair("data", right, left);
  }
  return null;
}
