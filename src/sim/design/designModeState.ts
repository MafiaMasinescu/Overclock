import type { GameState, GridPoint, ModuleInstanceState, RouteState } from "../core/types.ts";

export type ParsedDesignDraftOperation =
  | { operationId: string; kind: "place"; payload: { module: ModuleInstanceState } }
  | {
      operationId: string;
      kind: "move";
      payload: {
        moduleInstanceId: string;
        previousPosition: GridPoint;
        newPosition: GridPoint;
        removedRoutes: RouteState[];
      };
    }
  | {
      operationId: string;
      kind: "rotate";
      payload: {
        moduleInstanceId: string;
        previousRotation: 0 | 90 | 180 | 270;
        newRotation: 0 | 90 | 180 | 270;
        removedRoutes: RouteState[];
      };
    }
  | {
      operationId: string;
      kind: "remove";
      payload: { module: ModuleInstanceState; removedRoutes: RouteState[] };
    }
  | { operationId: string; kind: "connect"; payload: { route: RouteState } }
  | { operationId: string; kind: "disconnect"; payload: { route: RouteState } };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(
  value: unknown,
  keys: readonly string[],
  description: string,
): Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be a plain object.`,
  );
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result).toSorted();
  const expected = [...keys].toSorted();
  assert(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${description} has an invalid shape.`,
  );
  return result;
}

function nonemptyString(value: unknown, description: string): string {
  assert(
    typeof value === "string" && value.length > 0,
    `${description} must be a nonempty string.`,
  );
  return value;
}

function finite(value: unknown, description: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `${description} must be finite.`);
  return value;
}

function nonnegativeSafeInteger(value: unknown, description: string): number {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `${description} must be a nonnegative safe integer.`,
  );
  return value;
}

function point(value: unknown, description: string): GridPoint {
  const source = record(value, ["x", "y"], description);
  return {
    x: nonnegativeSafeInteger(source["x"], `${description}.x`),
    y: nonnegativeSafeInteger(source["y"], `${description}.y`),
  };
}

function rotation(value: unknown, description: string): 0 | 90 | 180 | 270 {
  assert(
    value === 0 || value === 90 || value === 180 || value === 270,
    `${description} is invalid.`,
  );
  return value;
}

function module(value: unknown): ModuleInstanceState {
  const source = record(
    value,
    [
      "id",
      "definitionId",
      "position",
      "rotation",
      "operationalState",
      "overclock",
      "binComputeRatio",
      "binEfficiencyRatio",
      "binThermalRatio",
      "binStabilityRatio",
      "startupTicksRemaining",
      "cooldownTicksRemaining",
    ],
    "Stored module",
  );
  const overclock = record(
    source["overclock"],
    ["profile", "frequencyRatio", "voltageRatio"],
    "Stored module overclock",
  );
  const operationalState = source["operationalState"];
  const profile = overclock["profile"];
  assert(
    operationalState === "offline" ||
      operationalState === "starting" ||
      operationalState === "online" ||
      operationalState === "brownout" ||
      operationalState === "shutdown",
    "Stored module operational state is invalid.",
  );
  assert(
    profile === "eco" || profile === "balanced" || profile === "boost" || profile === "manual",
    "Stored module overclock profile is invalid.",
  );
  return {
    id: nonemptyString(source["id"], "Stored module id"),
    definitionId: nonemptyString(source["definitionId"], "Stored module definition id"),
    position: point(source["position"], "Stored module position"),
    rotation: rotation(source["rotation"], "Stored module rotation"),
    operationalState,
    overclock: {
      profile,
      frequencyRatio: finite(overclock["frequencyRatio"], "Stored module frequency ratio"),
      voltageRatio: finite(overclock["voltageRatio"], "Stored module voltage ratio"),
    },
    binComputeRatio: finite(source["binComputeRatio"], "Stored module compute ratio"),
    binEfficiencyRatio: finite(source["binEfficiencyRatio"], "Stored module efficiency ratio"),
    binThermalRatio: finite(source["binThermalRatio"], "Stored module thermal ratio"),
    binStabilityRatio: finite(source["binStabilityRatio"], "Stored module stability ratio"),
    startupTicksRemaining: nonnegativeSafeInteger(
      source["startupTicksRemaining"],
      "Stored module startup ticks",
    ),
    cooldownTicksRemaining: nonnegativeSafeInteger(
      source["cooldownTicksRemaining"],
      "Stored module cooldown ticks",
    ),
  };
}

function route(value: unknown): RouteState {
  const source = record(
    value,
    ["id", "kind", "from", "to", "path", "capacityPerSecond", "congestionRatio"],
    "Stored route",
  );
  const from = record(source["from"], ["moduleInstanceId", "portId"], "Stored route from endpoint");
  const to = record(source["to"], ["moduleInstanceId", "portId"], "Stored route to endpoint");
  const kind = source["kind"];
  assert(kind === "power" || kind === "data", "Stored route kind is invalid.");
  assert(Array.isArray(source["path"]), "Stored route path must be an array.");
  return {
    id: nonemptyString(source["id"], "Stored route id"),
    kind,
    from: {
      moduleInstanceId: nonemptyString(from["moduleInstanceId"], "Stored route from module id"),
      portId: nonemptyString(from["portId"], "Stored route from port id"),
    },
    to: {
      moduleInstanceId: nonemptyString(to["moduleInstanceId"], "Stored route to module id"),
      portId: nonemptyString(to["portId"], "Stored route to port id"),
    },
    path: source["path"].map((entry, index) => point(entry, `Stored route path ${index}`)),
    capacityPerSecond: finite(source["capacityPerSecond"], "Stored route capacity"),
    congestionRatio: finite(source["congestionRatio"], "Stored route congestion"),
  };
}

function routes(value: unknown, description: string): RouteState[] {
  assert(Array.isArray(value), `${description} must be an array.`);
  const result = value.map((entry) => route(entry));
  const ids = new Set<string>();
  for (const entry of result) {
    assert(!ids.has(entry.id), `${description} contains duplicate route ids.`);
    ids.add(entry.id);
  }
  return result;
}

export function parseDesignDraftOperation(value: unknown): ParsedDesignDraftOperation {
  const source = record(value, ["operationId", "kind", "payload"], "Design operation");
  const operationId = nonemptyString(source["operationId"], "Design operation id");
  const kind = source["kind"];
  const payload = source["payload"];
  switch (kind) {
    case "place": {
      const parsed = record(payload, ["module"], "Place operation payload");
      return { operationId, kind, payload: { module: module(parsed["module"]) } };
    }
    case "move": {
      const parsed = record(
        payload,
        ["moduleInstanceId", "previousPosition", "newPosition", "removedRoutes"],
        "Move operation payload",
      );
      return {
        operationId,
        kind,
        payload: {
          moduleInstanceId: nonemptyString(parsed["moduleInstanceId"], "Move operation module id"),
          previousPosition: point(parsed["previousPosition"], "Move previous position"),
          newPosition: point(parsed["newPosition"], "Move new position"),
          removedRoutes: routes(parsed["removedRoutes"], "Move removed routes"),
        },
      };
    }
    case "rotate": {
      const parsed = record(
        payload,
        ["moduleInstanceId", "previousRotation", "newRotation", "removedRoutes"],
        "Rotate operation payload",
      );
      return {
        operationId,
        kind,
        payload: {
          moduleInstanceId: nonemptyString(
            parsed["moduleInstanceId"],
            "Rotate operation module id",
          ),
          previousRotation: rotation(parsed["previousRotation"], "Rotate previous rotation"),
          newRotation: rotation(parsed["newRotation"], "Rotate new rotation"),
          removedRoutes: routes(parsed["removedRoutes"], "Rotate removed routes"),
        },
      };
    }
    case "remove": {
      const parsed = record(payload, ["module", "removedRoutes"], "Remove operation payload");
      return {
        operationId,
        kind,
        payload: {
          module: module(parsed["module"]),
          removedRoutes: routes(parsed["removedRoutes"], "Remove removed routes"),
        },
      };
    }
    case "connect":
    case "disconnect": {
      const parsed = record(payload, ["route"], `${kind} operation payload`);
      return { operationId, kind, payload: { route: route(parsed["route"]) } };
    }
    default:
      throw new Error("Design operation kind is invalid.");
  }
}

export function assertValidDesignHistory(
  undoStack: readonly unknown[],
  redoStack: readonly unknown[],
): void {
  const operationIds = new Set<string>();
  for (const operation of [...undoStack, ...redoStack]) {
    const parsed = parseDesignDraftOperation(operation);
    if (operationIds.has(parsed.operationId)) {
      throw new Error("Design operation ids must not appear in both history stacks.");
    }
    operationIds.add(parsed.operationId);
  }
}

export function assertValidDesignModeState(
  state: GameState,
  minimumModuleInstanceSequence?: number,
  minimumRouteSequence?: number,
): void {
  const sequence = state.facility.nextModuleInstanceSequence;
  if (!Number.isSafeInteger(sequence) || sequence <= 0)
    throw new Error("The next module instance sequence must be a positive safe integer.");
  if (minimumModuleInstanceSequence !== undefined && sequence < minimumModuleInstanceSequence)
    throw new Error("The next module instance sequence must never decrease.");
  const routeSequence = state.facility.nextRouteSequence;
  if (!Number.isSafeInteger(routeSequence) || routeSequence <= 0)
    throw new Error("The next route sequence must be a positive safe integer.");
  if (minimumRouteSequence !== undefined && routeSequence < minimumRouteSequence)
    throw new Error("The next route sequence must never decrease.");
  const draft = state.facility.designDraft;
  if (draft === null) return;
  if (!Number.isSafeInteger(draft.revision) || draft.revision < 0)
    throw new Error("The Design Mode revision must be a nonnegative safe integer.");
}
