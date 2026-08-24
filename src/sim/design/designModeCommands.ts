import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { validateModulePlacement } from "../../grid/domain/occupancy.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { assertValidGridState } from "../../grid/validation/gridState.ts";
import {
  assertValidRouteState,
  validateManualRouteConnection,
  type ManualRouteFailure,
} from "../routing/manualRouting.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type {
  DesignDraftState,
  FacilityState,
  JsonObject,
  ModuleInstanceState,
  RouteState,
} from "../core/types.ts";
import { canonicalSerialize } from "../replay/canonicalState.ts";

export type DesignModeCommandHandlers = Pick<
  CommandHandlerRegistry,
  | "ENTER_DESIGN_MODE"
  | "PLACE_MODULE"
  | "MOVE_MODULE"
  | "ROTATE_MODULE"
  | "REMOVE_MODULE"
  | "CONNECT_PORTS"
  | "DISCONNECT_ROUTE"
  | "CANCEL_DESIGN"
>;

const REJECTIONS = {
  invalidPayload: { code: "INVALID_PAYLOAD", messageKey: "errors.invalid-payload" },
  notInDesignMode: {
    code: "NOT_IN_DESIGN_MODE",
    messageKey: "errors.not-in-design-mode",
  },
  alreadyInDesignMode: {
    code: "ALREADY_IN_DESIGN_MODE",
    messageKey: "errors.already-in-design-mode",
  },
  insufficientInventory: {
    code: "INSUFFICIENT_INVENTORY",
    messageKey: "errors.insufficient-inventory",
  },
  invalidSystem: { code: "INVALID_SYSTEM", messageKey: "errors.invalid-system" },
  outOfBounds: { code: "OUT_OF_BOUNDS", messageKey: "errors.out-of-bounds" },
  tileOccupied: { code: "TILE_OCCUPIED", messageKey: "errors.tile-occupied" },
} as const satisfies Record<string, CommandHandlerRejection>;

export interface DesignInventoryReservation {
  readonly definitionId: string;
  readonly liveCount: number;
  readonly draftCount: number;
  readonly requiredFromInventory: number;
  readonly availableInventory: number;
}

function toJsonObject(value: unknown): JsonObject {
  const parsed: unknown = JSON.parse(canonicalSerialize(value));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Design operation payload must be a JSON object.");
  }
  return parsed as JsonObject;
}

function resolveDefinition(content: ContentBundle, definitionId: string) {
  return Object.hasOwn(content.modules, definitionId) ? content.modules[definitionId] : undefined;
}

function countModulesByDefinition(
  modules: Readonly<Record<string, ModuleInstanceState>>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [, module] of Object.entries(modules).toSorted(([left], [right]) =>
    compareStableStrings(left, right),
  )) {
    const next = (counts[module.definitionId] ?? 0) + 1;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError("Module definition count exceeds the safe-integer range.");
    }
    counts[module.definitionId] = next;
  }
  return counts;
}

export function calculateDesignInventoryReservations(
  facility: Pick<FacilityState, "modules">,
  draft: Pick<DesignDraftState, "modules">,
  inventory: Readonly<Record<string, { readonly quantity: number }>>,
): readonly DesignInventoryReservation[] {
  const liveCounts = countModulesByDefinition(facility.modules);
  const draftCounts = countModulesByDefinition(draft.modules);
  const definitionIds = [
    ...new Set([...Object.keys(liveCounts), ...Object.keys(draftCounts)]),
  ].toSorted(compareStableStrings);

  return definitionIds.map((definitionId) => {
    const liveCount = liveCounts[definitionId] ?? 0;
    const draftCount = draftCounts[definitionId] ?? 0;
    const requiredFromInventory = Math.max(0, draftCount - liveCount);
    if (!Number.isSafeInteger(requiredFromInventory)) {
      throw new RangeError("Inventory reservation exceeds the safe-integer range.");
    }
    return {
      definitionId,
      liveCount,
      draftCount,
      requiredFromInventory,
      availableInventory: inventory[definitionId]?.quantity ?? 0,
    };
  });
}

function calculatePlacementReservations(
  facility: Pick<FacilityState, "modules">,
  draft: Pick<DesignDraftState, "modules">,
  inventory: Readonly<Record<string, { readonly quantity: number }>>,
  placedDefinitionId: string,
): readonly DesignInventoryReservation[] {
  const current = calculateDesignInventoryReservations(facility, draft, inventory);
  const reservations = current.map((reservation) => ({ ...reservation }));
  const placed = reservations.find(
    (reservation) => reservation.definitionId === placedDefinitionId,
  );
  if (placed === undefined) {
    reservations.push({
      definitionId: placedDefinitionId,
      liveCount: 0,
      draftCount: 1,
      requiredFromInventory: 1,
      availableInventory: inventory[placedDefinitionId]?.quantity ?? 0,
    });
  } else {
    const draftCount = placed.draftCount + 1;
    if (!Number.isSafeInteger(draftCount)) {
      throw new RangeError("Module definition count exceeds the safe-integer range.");
    }
    placed.draftCount = draftCount;
    placed.requiredFromInventory = Math.max(0, draftCount - placed.liveCount);
  }
  return reservations.toSorted((left, right) =>
    compareStableStrings(left.definitionId, right.definitionId),
  );
}

function incrementRevision(draft: DesignDraftState): number | null {
  if (draft.revision >= Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return draft.revision + 1;
}

function operationId(revision: number, commandId: string): string {
  return `design-operation-${revision}-${commandId}`;
}

function gridRejection(
  result: ReturnType<typeof validateModulePlacement>,
): CommandHandlerRejection {
  const issue = result.issues[0];
  if (issue?.code === "OUT_OF_BOUNDS") {
    return REJECTIONS.outOfBounds;
  }
  if (issue?.code === "TILE_OCCUPIED") {
    return REJECTIONS.tileOccupied;
  }
  return REJECTIONS.invalidPayload;
}

function routeRejection(failure: ManualRouteFailure): CommandHandlerRejection {
  const parameters = { reason: failure.reason };
  switch (failure.code) {
    case "INVALID_ROUTE":
      return {
        code: failure.code,
        messageKey: `errors.invalid-route-${failure.reason.toLowerCase().replaceAll("_", "-")}`,
        parameters,
      };
    case "OUT_OF_BOUNDS":
      return { code: failure.code, messageKey: "errors.route-out-of-bounds", parameters };
    case "TILE_OCCUPIED":
      return { code: failure.code, messageKey: "errors.route-tile-occupied", parameters };
    case "INVALID_PORT":
      return { code: failure.code, messageKey: "errors.route-invalid-port", parameters };
    case "INCOMPATIBLE_PORTS":
      return { code: failure.code, messageKey: "errors.route-incompatible-ports", parameters };
    default:
      return { ...REJECTIONS.invalidSystem, parameters };
  }
}

function assertValidDraftGrid(
  facility: FacilityState,
  draft: DesignDraftState,
  content: ContentBundle,
): void {
  assertValidGridState(
    {
      ...facility,
      modules: draft.modules,
      routes: draft.routes,
      designDraft: null,
    },
    content,
  );
  assertValidRouteState(
    {
      size: facility.size,
      modules: draft.modules,
      routes: draft.routes,
      nextRouteSequence: facility.nextRouteSequence,
    },
    content,
  );
}

function removeAttachedRoutes(
  routes: Record<string, RouteState>,
  moduleInstanceId: string,
): RouteState[] {
  const attached = Object.entries(routes)
    .filter(
      ([, route]) =>
        route.from.moduleInstanceId === moduleInstanceId ||
        route.to.moduleInstanceId === moduleInstanceId,
    )
    .toSorted(
      ([leftKey, left], [rightKey, right]) =>
        compareStableStrings(left.id, right.id) || compareStableStrings(leftKey, rightKey),
    );
  for (const [routeKey] of attached) {
    Reflect.deleteProperty(routes, routeKey);
  }
  return attached.map(([, route]) => structuredClone(route));
}

export function createDesignModeCommandHandlers(content: ContentBundle): DesignModeCommandHandlers {
  return Object.freeze({
    ENTER_DESIGN_MODE({ state }) {
      if (state.facility.designDraft !== null) {
        return REJECTIONS.alreadyInDesignMode;
      }
      assertValidGridState(state.facility, content);
      assertValidRouteState(state.facility, content);
      state.facility.designDraft = {
        revision: 0,
        modules: structuredClone(state.facility.modules),
        routes: structuredClone(state.facility.routes),
        undoStack: [],
        redoStack: [],
      };
    },

    PLACE_MODULE({ state }, command) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      const definition = resolveDefinition(content, command.definitionId);
      if (definition === undefined) {
        return REJECTIONS.invalidPayload;
      }
      const placement = validateModulePlacement({
        facilitySize: state.facility.size,
        definitionId: command.definitionId,
        position: command.position,
        rotation: command.rotation,
        modules: draft.modules,
        content,
      });
      if (!placement.valid) {
        return gridRejection(placement);
      }

      let reservations: readonly DesignInventoryReservation[];
      try {
        reservations = calculatePlacementReservations(
          state.facility,
          draft,
          state.inventory.stacks,
          command.definitionId,
        );
      } catch (error: unknown) {
        if (error instanceof RangeError) {
          return REJECTIONS.invalidSystem;
        }
        throw error;
      }
      if (
        reservations.some(
          (reservation) => reservation.requiredFromInventory > reservation.availableInventory,
        )
      ) {
        return REJECTIONS.insufficientInventory;
      }

      const revision = incrementRevision(draft);
      const sequence = state.facility.nextModuleInstanceSequence;
      if (revision === null || sequence >= Number.MAX_SAFE_INTEGER) {
        return REJECTIONS.invalidSystem;
      }
      const moduleInstanceId = `module-instance-${sequence.toString().padStart(8, "0")}`;
      if (
        Object.hasOwn(state.facility.modules, moduleInstanceId) ||
        Object.hasOwn(draft.modules, moduleInstanceId)
      ) {
        return REJECTIONS.invalidSystem;
      }

      const module: ModuleInstanceState = {
        id: moduleInstanceId,
        definitionId: command.definitionId,
        position: { ...command.position },
        rotation: command.rotation,
        operationalState: "offline",
        overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
        binComputeRatio: 1,
        binEfficiencyRatio: 1,
        binThermalRatio: 1,
        binStabilityRatio: 1,
        startupTicksRemaining: definition.startupTicks,
        cooldownTicksRemaining: 0,
      };
      draft.modules[module.id] = module;
      draft.revision = revision;
      draft.undoStack.push({
        operationId: operationId(revision, command.commandId),
        kind: "place",
        payload: toJsonObject({ module }),
      });
      draft.redoStack = [];
      state.facility.nextModuleInstanceSequence = sequence + 1;
      assertValidDraftGrid(state.facility, draft, content);
    },

    MOVE_MODULE({ state }, command) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      if (!Object.hasOwn(draft.modules, command.moduleInstanceId)) {
        return REJECTIONS.invalidPayload;
      }
      const module = draft.modules[command.moduleInstanceId];
      if (module === undefined) {
        return REJECTIONS.invalidPayload;
      }
      if (module.position.x === command.position.x && module.position.y === command.position.y) {
        return;
      }
      const placement = validateModulePlacement({
        facilitySize: state.facility.size,
        definitionId: module.definitionId,
        position: command.position,
        rotation: module.rotation,
        modules: draft.modules,
        content,
        excludeModuleInstanceId: module.id,
      });
      if (!placement.valid) {
        return gridRejection(placement);
      }
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }

      const previousPosition = { ...module.position };
      const newPosition = { ...command.position };
      const removedRoutes = removeAttachedRoutes(draft.routes, module.id);
      module.position = newPosition;
      draft.revision = revision;
      draft.undoStack.push({
        operationId: operationId(revision, command.commandId),
        kind: "move",
        payload: toJsonObject({
          moduleInstanceId: module.id,
          previousPosition,
          newPosition,
          removedRoutes,
        }),
      });
      draft.redoStack = [];
      assertValidDraftGrid(state.facility, draft, content);
    },

    ROTATE_MODULE({ state }, command) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      if (!Object.hasOwn(draft.modules, command.moduleInstanceId)) {
        return REJECTIONS.invalidPayload;
      }
      const module = draft.modules[command.moduleInstanceId];
      if (module === undefined) {
        return REJECTIONS.invalidPayload;
      }
      if (module.rotation === command.rotation) {
        return;
      }
      const placement = validateModulePlacement({
        facilitySize: state.facility.size,
        definitionId: module.definitionId,
        position: module.position,
        rotation: command.rotation,
        modules: draft.modules,
        content,
        excludeModuleInstanceId: module.id,
      });
      if (!placement.valid) {
        return gridRejection(placement);
      }
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }

      const previousRotation = module.rotation;
      const removedRoutes = removeAttachedRoutes(draft.routes, module.id);
      module.rotation = command.rotation;
      draft.revision = revision;
      draft.undoStack.push({
        operationId: operationId(revision, command.commandId),
        kind: "rotate",
        payload: toJsonObject({
          moduleInstanceId: module.id,
          previousRotation,
          newRotation: command.rotation,
          removedRoutes,
        }),
      });
      draft.redoStack = [];
      assertValidDraftGrid(state.facility, draft, content);
    },

    REMOVE_MODULE({ state }, command) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      if (!Object.hasOwn(draft.modules, command.moduleInstanceId)) {
        return REJECTIONS.invalidPayload;
      }
      const module = draft.modules[command.moduleInstanceId];
      if (module === undefined) {
        return REJECTIONS.invalidPayload;
      }
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }

      const removedModule = structuredClone(module);
      const removedRoutes = removeAttachedRoutes(draft.routes, command.moduleInstanceId);
      Reflect.deleteProperty(draft.modules, command.moduleInstanceId);
      draft.revision = revision;
      draft.undoStack.push({
        operationId: operationId(revision, command.commandId),
        kind: "remove",
        payload: toJsonObject({ module: removedModule, removedRoutes }),
      });
      draft.redoStack = [];
      assertValidDraftGrid(state.facility, draft, content);
    },

    CONNECT_PORTS({ state }, command) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      const resolved = validateManualRouteConnection(
        {
          size: state.facility.size,
          modules: draft.modules,
          routes: draft.routes,
        },
        content,
        command.from,
        command.to,
        command.path,
      );
      if ("code" in resolved) {
        return routeRejection(resolved);
      }
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }
      const sequence = state.facility.nextRouteSequence;
      if (sequence >= Number.MAX_SAFE_INTEGER) {
        return REJECTIONS.invalidSystem;
      }
      const routeId = `route-${sequence.toString().padStart(8, "0")}`;
      if (Object.hasOwn(state.facility.routes, routeId) || Object.hasOwn(draft.routes, routeId)) {
        return REJECTIONS.invalidSystem;
      }
      const path = (resolved.reverseSubmittedPath ? command.path.toReversed() : command.path).map(
        (point) => ({ ...point }),
      );
      const route: RouteState = {
        id: routeId,
        kind: resolved.kind,
        from: {
          moduleInstanceId: resolved.from.moduleInstanceId,
          portId: resolved.from.portId,
        },
        to: {
          moduleInstanceId: resolved.to.moduleInstanceId,
          portId: resolved.to.portId,
        },
        path,
        capacityPerSecond: Math.min(resolved.from.capacityPerSecond, resolved.to.capacityPerSecond),
        congestionRatio: 0,
      };
      draft.routes[route.id] = route;
      draft.revision = revision;
      draft.undoStack.push({
        operationId: operationId(revision, command.commandId),
        kind: "connect",
        payload: toJsonObject({ route }),
      });
      draft.redoStack = [];
      state.facility.nextRouteSequence = sequence + 1;
      assertValidDraftGrid(state.facility, draft, content);
    },

    DISCONNECT_ROUTE({ state }, command) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      if (!Object.hasOwn(draft.routes, command.routeId)) {
        return routeRejection({ code: "INVALID_ROUTE", reason: "ROUTE_NOT_FOUND" });
      }
      const route = draft.routes[command.routeId];
      if (route?.id !== command.routeId) {
        return REJECTIONS.invalidSystem;
      }
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }
      const removedRoute = structuredClone(route);
      Reflect.deleteProperty(draft.routes, command.routeId);
      draft.revision = revision;
      draft.undoStack.push({
        operationId: operationId(revision, command.commandId),
        kind: "disconnect",
        payload: toJsonObject({ route: removedRoute }),
      });
      draft.redoStack = [];
      assertValidDraftGrid(state.facility, draft, content);
    },

    CANCEL_DESIGN({ state }) {
      if (state.facility.designDraft === null) {
        return REJECTIONS.notInDesignMode;
      }
      state.facility.designDraft = null;
    },
  });
}
