import type { DeepReadonly, ModuleDefinition } from "../../content/schemas/contentSchemas.ts";
import { deepFreeze } from "../../content/loader/deepFreeze.ts";
import type { CommandResult } from "../commands/contracts.ts";
import type {
  BlueprintId,
  BlueprintRecord,
  GridPoint,
  ModuleDefinitionId,
  ModuleInstanceId,
  PortRef,
  ResearchNodeId,
  Rotation,
  RouteKind,
  Size2D,
} from "../core/types.ts";
import type { DesignApplyPreview } from "../design/designApplyPreview.ts";
import type { BlueprintMaterializationFailureCode } from "../blueprints/blueprintMaterialization.ts";
import type { ManualRouteReason } from "../routing/manualRouting.ts";

/** The only layout sources a Build read may expose. */
export type BuildViewMode = "live" | "draft";

export type BuildFeatureId =
  | "auto-route"
  | "heatmap"
  | "subassembly-blueprints"
  | "power-headroom-inspector"
  | "stability-inspector";

export type BuildReadStatus = "ready" | "rejected" | "unavailable";

export type BuildReadReason =
  | "INVALID_INPUT"
  | "OUT_OF_BOUNDS"
  | "TILE_OCCUPIED"
  | "INSUFFICIENT_INVENTORY"
  | "INSUFFICIENT_CREDIT"
  | "RESEARCH_REQUIRED"
  | "DRAFT_REQUIRED"
  | "ACTIVE_BENCHMARK"
  | "INVALID_PORT"
  | "INCOMPATIBLE_PORTS"
  | "INVALID_ROUTE"
  | "NO_ROUTE_FOUND"
  | "BLUEPRINT_INVALID"
  | "FEATURE_LOCKED"
  | "INVALID_SYSTEM"
  | "NOT_AVAILABLE";

export interface BuildSourceStamp {
  readonly mode: BuildViewMode;
  readonly observedTick: number;
  readonly liveLayoutRevision: number;
  readonly draftRevision: number | null;
  readonly generation: number;
}

export type BuildPurchaseEligibility =
  | { readonly kind: "available" }
  | {
      readonly kind: "purchase";
      readonly costUsd: number;
    }
  | {
      readonly kind: "locked";
      readonly researchIds: readonly ResearchNodeId[];
    }
  | {
      readonly kind: "insufficient-credit";
      readonly costUsd: number;
      readonly creditLimitUsd: number;
    }
  | {
      readonly kind: "invalid";
      readonly reason: "INVALID_SYSTEM";
    };

export interface BuildCatalogEntry {
  readonly definitionId: ModuleDefinitionId;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly footprint: DeepReadonly<ModuleDefinition>["footprint"];
  readonly priceUsd: number;
  readonly unlockResearchIds: readonly ResearchNodeId[];
  readonly inventoryQuantity: number;
  readonly reservationRequirement: number;
  readonly reusableInstalledQuantity: number;
  readonly availableAdditionalPlacements: number;
  readonly purchase: BuildPurchaseEligibility;
}

export interface BuildFeatureFlags {
  readonly autoRoute: boolean;
  readonly heatmap: boolean;
  readonly subassemblyBlueprints: boolean;
  readonly powerHeadroomInspector: boolean;
  readonly stabilityInspector: boolean;
}

export interface BuildContextRead {
  readonly mode: BuildViewMode;
  readonly dimensions: Size2D;
  readonly source: BuildSourceStamp;
  readonly catalog: readonly BuildCatalogEntry[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly apply: {
    readonly eligible: boolean;
    readonly reason: BuildReadReason | null;
  };
  readonly activeBenchmarkLock: boolean;
  readonly featureFlags: BuildFeatureFlags;
}

export interface BuildPlacementPreview {
  readonly status: "ready" | "rejected";
  readonly valid: boolean;
  readonly reason: BuildReadReason | null;
  readonly definitionId: string;
  readonly position: GridPoint;
  readonly rotation: Rotation;
  readonly occupiedTiles: readonly GridPoint[];
  readonly attachedRouteIds: readonly string[];
  readonly purchaseCostUsd: number;
  readonly requiresPurchase: boolean;
}

export interface BuildRemovalPreview {
  readonly status: "ready" | "rejected";
  readonly valid: boolean;
  readonly reason: BuildReadReason | null;
  readonly moduleInstanceId: ModuleInstanceId;
  readonly attachedRouteIds: readonly string[];
}

export interface BuildManualRoutePreview {
  readonly status: "ready" | "rejected";
  readonly valid: boolean;
  readonly reason: BuildReadReason | null;
  readonly domainReason: ManualRouteReason | "REQUESTED_KIND_MISMATCH" | null;
  readonly routeKind: "power" | "data" | null;
  readonly path: readonly GridPoint[];
}

export interface BuildBlueprintListRead {
  readonly records: readonly BlueprintRecord[];
  readonly nextAfterId: BlueprintId | null;
}

export type BuildBlueprintMaterializationPreview =
  | {
      readonly status: "ready";
      readonly blueprintId: string;
      readonly blueprintVersion: number;
      readonly targetPosition: GridPoint;
      readonly globalRotation: Rotation;
      readonly modules: readonly {
        readonly localHandle: string;
        readonly definitionId: string;
        readonly position: GridPoint;
        readonly rotation: Rotation;
      }[];
      readonly routes: readonly {
        readonly localHandle: string;
        readonly kind: RouteKind;
        readonly fromModuleHandle: string;
        readonly toModuleHandle: string;
        readonly path: readonly GridPoint[];
      }[];
      readonly inventoryReservationDelta: readonly {
        readonly definitionId: string;
        readonly quantity: number;
      }[];
    }
  | {
      readonly status: "rejected";
      readonly code: BlueprintMaterializationFailureCode;
      readonly reason: string;
    };

export interface BuildPositionInput {
  readonly x: number;
  readonly y: number;
}

export interface BuildPlacementInput {
  readonly definitionId: ModuleDefinitionId;
  readonly position: BuildPositionInput;
  readonly rotation: Rotation;
  readonly source: "inventory" | "catalog";
}

export interface BuildManualRouteInput {
  readonly kind: RouteKind;
  readonly from: PortRef;
  readonly to: PortRef;
  readonly path: readonly BuildPositionInput[];
}

export interface BuildQueryBase {
  readonly clientIntentSequence: number;
  readonly mode: BuildViewMode;
}

export type BuildQuery =
  | (BuildQueryBase & { readonly kind: "context" })
  | (BuildQueryBase & { readonly kind: "placement"; readonly input: BuildPlacementInput })
  | (BuildQueryBase & {
      readonly kind: "move";
      readonly moduleInstanceId: ModuleInstanceId;
      readonly position: BuildPositionInput;
    })
  | (BuildQueryBase & {
      readonly kind: "rotate";
      readonly moduleInstanceId: ModuleInstanceId;
      readonly rotation: Rotation;
    })
  | (BuildQueryBase & {
      readonly kind: "removal";
      readonly moduleInstanceId: ModuleInstanceId;
    })
  | (BuildQueryBase & { readonly kind: "apply" })
  | (BuildQueryBase & { readonly kind: "manual-route"; readonly input: BuildManualRouteInput })
  | (BuildQueryBase & {
      readonly kind: "automatic-route";
      readonly from: PortRef;
      readonly to: PortRef;
    })
  | (BuildQueryBase & { readonly kind: "adjacent-candidates"; readonly moduleInstanceId: string })
  | (BuildQueryBase & {
      readonly kind: "blueprint-list";
      readonly afterBlueprintId: BlueprintId | null;
      readonly limit: number;
    })
  | (BuildQueryBase & { readonly kind: "blueprint-detail"; readonly blueprintId: BlueprintId })
  | (BuildQueryBase & {
      readonly kind: "blueprint-materialization";
      readonly blueprintId: BlueprintId;
      readonly position: BuildPositionInput;
      readonly rotation: Rotation;
    })
  | (BuildQueryBase & {
      readonly kind: "diagnostic-pulse";
      readonly selectedIds: readonly string[];
    });

export interface BuildQueryResultBase {
  readonly kind: BuildQuery["kind"];
  readonly status: BuildReadStatus;
  readonly clientIntentSequence: number;
  readonly source: BuildSourceStamp;
  readonly reason?: BuildReadReason;
}

export interface BuildContextQueryResult extends BuildQueryResultBase {
  readonly kind: "context";
  readonly status: "ready";
  readonly context: BuildContextRead;
}

export interface BuildQueryDataMap {
  readonly placement: BuildPlacementPreview;
  readonly move: BuildPlacementPreview;
  readonly rotate: BuildPlacementPreview;
  readonly removal: BuildRemovalPreview;
  readonly apply: DesignApplyPreview;
  readonly "manual-route": BuildManualRoutePreview;
  readonly "blueprint-list": BuildBlueprintListRead;
  readonly "blueprint-detail": BlueprintRecord | null;
  readonly "blueprint-materialization": BuildBlueprintMaterializationPreview;
}

export type BuildQueryReadyResult = {
  [K in keyof BuildQueryDataMap]: BuildQueryResultBase & {
    readonly kind: K;
    readonly status: "ready";
    readonly data: BuildQueryDataMap[K];
  };
}[keyof BuildQueryDataMap];

export type BuildQueryDataRejectedResult = {
  [K in keyof BuildQueryDataMap]: BuildQueryResultBase & {
    readonly kind: K;
    readonly status: "rejected";
    readonly reason: BuildReadReason;
    readonly data: BuildQueryDataMap[K];
  };
}[keyof BuildQueryDataMap];

export interface BuildQueryRejectedResult extends BuildQueryResultBase {
  readonly status: "rejected" | "unavailable";
  readonly reason: BuildReadReason;
}

export type BuildQueryResult =
  | BuildContextQueryResult
  | BuildQueryReadyResult
  | BuildQueryDataRejectedResult
  | BuildQueryRejectedResult;

export type BuildGuardedWriteOutcome =
  | {
      readonly kind: "not-queued";
      readonly code: "STALE_BUILD_VIEW" | "INVALID_BUILD_COMMAND";
      readonly expectedGeneration: number;
      readonly observedGeneration: number;
      readonly source: BuildSourceStamp;
    }
  | {
      readonly kind: "domain";
      readonly result: CommandResult;
      readonly source: BuildSourceStamp;
    };

export type BuildCommandKind =
  | "ENTER_DESIGN_MODE"
  | "BUY_MODULE"
  | "PLACE_MODULE"
  | "MOVE_MODULE"
  | "ROTATE_MODULE"
  | "REMOVE_MODULE"
  | "CONNECT_PORTS"
  | "DISCONNECT_ROUTE"
  | "UNDO_DESIGN"
  | "REDO_DESIGN"
  | "APPLY_DESIGN"
  | "CANCEL_DESIGN"
  | "SAVE_BLUEPRINT"
  | "RENAME_BLUEPRINT"
  | "INSTANTIATE_BLUEPRINT";

export interface BuildInputState {
  readonly tool: "select" | "place" | "move" | "rotate" | "route" | "blueprint";
  readonly cursor: BuildPositionInput | null;
  readonly selectedIds: readonly string[];
  readonly pendingOperation: BuildOperationStatus;
}

export type BuildOperationStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "unsubmitted"; readonly clientOperationId: string }
  | { readonly kind: "queued"; readonly clientOperationId: string }
  | { readonly kind: "accepted-awaiting-publication"; readonly clientOperationId: string }
  | { readonly kind: "rejected"; readonly clientOperationId: string; readonly reason: string }
  | { readonly kind: "unknown"; readonly clientOperationId: string; readonly reason: string };

export interface BuildOverlayState {
  readonly hoverTile: BuildPositionInput | null;
  readonly preview: BuildQueryResult | null;
  readonly stale: boolean;
}

export interface BuildGuardedCommandInput {
  readonly command: BuildCommandKind;
  readonly expectedGeneration: number;
  readonly clientOperationId: string;
}

export const BUILD_QUERY_LIMITS = Object.freeze({
  clientIntentSequence: { min: 0, max: Number.MAX_SAFE_INTEGER },
  blueprintPageSize: { min: 1, max: 50 },
  selectedIds: { min: 0, max: 512 },
  identifierLength: { min: 1, max: 256 },
} as const);

const QUERY_KINDS = new Set<BuildQuery["kind"]>([
  "context",
  "placement",
  "move",
  "rotate",
  "removal",
  "apply",
  "manual-route",
  "automatic-route",
  "adjacent-candidates",
  "blueprint-list",
  "blueprint-detail",
  "blueprint-materialization",
  "diagnostic-pulse",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readData(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
    throw new TypeError(`Build query property ${key} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Build query must be a plain record.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(descriptors, key))) {
    throw new TypeError("Build query has unexpected or missing properties.");
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      throw new TypeError("Build query properties must be enumerable data properties.");
    }
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function coordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new TypeError(`${label} must be a bounded nonempty string.`);
  }
  return value;
}

function position(value: unknown): BuildPositionInput {
  const record = exactRecord(value, ["x", "y"]);
  return {
    x: coordinate(readData(record, "x"), "position.x"),
    y: coordinate(readData(record, "y"), "position.y"),
  };
}

function portRef(value: unknown): PortRef {
  const record = exactRecord(value, ["moduleInstanceId", "portId"]);
  return {
    moduleInstanceId: identifier(readData(record, "moduleInstanceId"), "moduleInstanceId"),
    portId: identifier(readData(record, "portId"), "portId"),
  };
}

function exactDataArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) {
    throw new TypeError(`${label} must be a bounded plain array.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== value.length) throw new TypeError(`${label} must be a dense data array.`);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      throw new TypeError(`${label} entries must be enumerable data properties.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function routePath(value: unknown): readonly BuildPositionInput[] {
  return exactDataArray(value, 4096, "Build route path").map((entry) => position(entry));
}

function selectedIds(value: unknown): readonly string[] {
  const ids = exactDataArray(value, BUILD_QUERY_LIMITS.selectedIds.max, "Build selected ids").map(
    (entry) => identifier(entry, "selectedId"),
  );
  if (new Set(ids).size !== ids.length) throw new TypeError("Build selected ids must be unique.");
  return ids;
}

function rotation(value: unknown): Rotation {
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    throw new TypeError("Build rotation must be 0, 90, 180 or 270.");
  }
  return value;
}

function mode(value: unknown): BuildViewMode {
  if (value !== "live" && value !== "draft") throw new TypeError("Invalid Build view mode.");
  return value;
}

/**
 * Parse the neutral query envelope without invoking caller accessors or
 * accepting inherited/extra properties. Detailed domain validation remains a
 * SimCore concern and is deliberately not performed by this boundary.
 */
export function parseBuildQuery(input: unknown): BuildQuery {
  if (!isRecord(input)) throw new TypeError("Build query must be a plain record.");
  const kind = readData(input, "kind");
  if (typeof kind !== "string" || !QUERY_KINDS.has(kind as BuildQuery["kind"])) {
    throw new TypeError("Unknown Build query kind.");
  }
  const clientIntentSequence = safeInteger(
    readData(input, "clientIntentSequence"),
    "clientIntentSequence",
  );
  const viewMode = mode(readData(input, "mode"));
  const base = { kind, clientIntentSequence, mode: viewMode } as const;
  switch (kind) {
    case "context":
      exactRecord(input, ["kind", "clientIntentSequence", "mode"]);
      return { kind: "context", clientIntentSequence, mode: viewMode };
    case "apply":
      exactRecord(input, ["kind", "clientIntentSequence", "mode"]);
      return { kind: "apply", clientIntentSequence, mode: viewMode };
    case "placement": {
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "input"]);
      const inputRecord = exactRecord(readData(input, "input"), [
        "definitionId",
        "position",
        "rotation",
        "source",
      ]);
      const source = readData(inputRecord, "source");
      if (source !== "inventory" && source !== "catalog")
        throw new TypeError("Invalid placement source.");
      return {
        ...base,
        kind,
        input: {
          definitionId: identifier(readData(inputRecord, "definitionId"), "definitionId"),
          position: position(readData(inputRecord, "position")),
          rotation: rotation(readData(inputRecord, "rotation")),
          source,
        },
      };
    }
    case "move":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "moduleInstanceId", "position"]);
      return {
        ...base,
        kind,
        moduleInstanceId: identifier(readData(input, "moduleInstanceId"), "moduleInstanceId"),
        position: position(readData(input, "position")),
      };
    case "rotate":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "moduleInstanceId", "rotation"]);
      return {
        ...base,
        kind,
        moduleInstanceId: identifier(readData(input, "moduleInstanceId"), "moduleInstanceId"),
        rotation: rotation(readData(input, "rotation")),
      };
    case "removal":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "moduleInstanceId"]);
      return {
        ...base,
        kind,
        moduleInstanceId: identifier(readData(input, "moduleInstanceId"), "moduleInstanceId"),
      };
    case "blueprint-list": {
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "afterBlueprintId", "limit"]);
      const after = readData(input, "afterBlueprintId");
      if (after !== null) identifier(after, "afterBlueprintId");
      const limit = safeInteger(readData(input, "limit"), "limit");
      if (limit < 1 || limit > 50)
        throw new TypeError("Blueprint page size must be between 1 and 50.");
      return { ...base, kind, afterBlueprintId: after as string | null, limit };
    }
    case "blueprint-detail":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "blueprintId"]);
      return {
        ...base,
        kind,
        blueprintId: identifier(readData(input, "blueprintId"), "blueprintId"),
      };
    case "blueprint-materialization":
      exactRecord(input, [
        "kind",
        "clientIntentSequence",
        "mode",
        "blueprintId",
        "position",
        "rotation",
      ]);
      return {
        ...base,
        kind,
        blueprintId: identifier(readData(input, "blueprintId"), "blueprintId"),
        position: position(readData(input, "position")),
        rotation: rotation(readData(input, "rotation")),
      };
    case "adjacent-candidates":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "moduleInstanceId"]);
      return {
        ...base,
        kind,
        moduleInstanceId: identifier(readData(input, "moduleInstanceId"), "moduleInstanceId"),
      };
    case "automatic-route":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "from", "to"]);
      return {
        ...base,
        kind,
        from: portRef(readData(input, "from")),
        to: portRef(readData(input, "to")),
      };
    case "manual-route": {
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "input"]);
      const routeInput = exactRecord(readData(input, "input"), ["kind", "from", "to", "path"]);
      const routeKind = readData(routeInput, "kind");
      if (routeKind !== "power" && routeKind !== "data") throw new TypeError("Invalid route kind.");
      return {
        ...base,
        kind,
        input: {
          kind: routeKind,
          from: portRef(readData(routeInput, "from")),
          to: portRef(readData(routeInput, "to")),
          path: routePath(readData(routeInput, "path")),
        },
      };
    }
    case "diagnostic-pulse":
      exactRecord(input, ["kind", "clientIntentSequence", "mode", "selectedIds"]);
      return {
        ...base,
        kind,
        selectedIds: selectedIds(readData(input, "selectedIds")),
      };
  }
  throw new TypeError("Unsupported Build query kind.");
}

export function freezeBuildRead<T>(value: T): DeepReadonly<T> {
  return deepFreeze(value);
}
