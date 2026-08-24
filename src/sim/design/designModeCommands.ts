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
  DesignDraftOperation,
  FacilityState,
  JsonObject,
  ModuleInstanceState,
  RouteState,
} from "../core/types.ts";
import {
  parseDesignDraftOperation,
  assertValidDesignHistory,
  type ParsedDesignDraftOperation,
} from "./designModeState.ts";
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
  | "UNDO_DESIGN"
  | "REDO_DESIGN"
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

function assertValidUndoRedoDraft(
  facility: FacilityState,
  draft: DesignDraftState,
  content: ContentBundle,
): void {
  assertValidDraftGrid(facility, draft, content);
  assertValidDesignHistory(draft.undoStack, draft.redoStack);
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

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function cloneOperation(operation: ParsedDesignDraftOperation): DesignDraftOperation {
  return JSON.parse(canonicalSerialize(operation)) as DesignDraftOperation;
}

function assertStoredModulePlacement(
  facility: FacilityState,
  draft: DesignDraftState,
  module: ModuleInstanceState,
  content: ContentBundle,
): void {
  const definition = resolveDefinition(content, module.definitionId);
  if (definition === undefined) {
    throw new Error("Stored module references an unknown definition.");
  }
  const placement = validateModulePlacement({
    facilitySize: facility.size,
    definitionId: module.definitionId,
    position: module.position,
    rotation: module.rotation,
    modules: draft.modules,
    content,
  });
  if (!placement.valid) {
    throw new Error("Stored module cannot be restored into the current draft.");
  }
}

function assertModuleAt(
  draft: DesignDraftState,
  moduleInstanceId: string,
  position: { x: number; y: number },
  rotation?: 0 | 90 | 180 | 270,
): ModuleInstanceState {
  const module = draft.modules[moduleInstanceId];
  if (
    module?.id !== moduleInstanceId ||
    module.position.x !== position.x ||
    module.position.y !== position.y ||
    (rotation !== undefined && module.rotation !== rotation)
  ) {
    throw new Error("Draft module does not match the expected history state.");
  }
  return module;
}

function attachedRoutes(
  routes: Readonly<Record<string, RouteState>>,
  moduleInstanceId: string,
): RouteState[] {
  return Object.values(routes)
    .filter(
      (route) =>
        route.from.moduleInstanceId === moduleInstanceId ||
        route.to.moduleInstanceId === moduleInstanceId,
    )
    .toSorted((left, right) => compareStableStrings(left.id, right.id));
}

function assertAttachedRoutesEqual(
  routes: Readonly<Record<string, RouteState>>,
  moduleInstanceId: string,
  expected: readonly RouteState[],
): void {
  const actual = attachedRoutes(routes, moduleInstanceId);
  if (actual.length !== expected.length) {
    throw new Error("Draft attached routes do not match the history operation.");
  }
  const expectedSorted = expected.toSorted((left, right) =>
    compareStableStrings(left.id, right.id),
  );
  for (let index = 0; index < actual.length; index += 1) {
    if (!sameCanonical(actual[index], expectedSorted[index])) {
      throw new Error("Draft attached routes do not match the history operation.");
    }
  }
}

function restoreRoutes(draft: DesignDraftState, routes: readonly RouteState[]): void {
  for (const route of routes) {
    if (Object.hasOwn(draft.routes, route.id)) {
      throw new Error("A restored route id already exists in the draft.");
    }
  }
  for (const route of routes) {
    draft.routes[route.id] = structuredClone(route);
  }
}

function removeStoredRoutes(draft: DesignDraftState, routes: readonly RouteState[]): void {
  for (const route of routes) {
    const existing = draft.routes[route.id];
    if (existing === undefined || !sameCanonical(existing, route)) {
      throw new Error("Draft route does not match the stored history route.");
    }
  }
  for (const route of routes) {
    Reflect.deleteProperty(draft.routes, route.id);
  }
}

function assertRoutesAbsent(draft: DesignDraftState, routes: readonly RouteState[]): void {
  for (const route of routes) {
    if (Object.hasOwn(draft.routes, route.id)) {
      throw new Error("A stored route id unexpectedly exists in the draft.");
    }
  }
}

function assertUndoPrecondition(
  facility: FacilityState,
  draft: DesignDraftState,
  operation: ParsedDesignDraftOperation,
  content: ContentBundle,
): void {
  switch (operation.kind) {
    case "place": {
      const existing = draft.modules[operation.payload.module.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.module)) {
        throw new Error("Placed module does not match the stored history module.");
      }
      assertAttachedRoutesEqual(draft.routes, existing.id, []);
      return;
    }
    case "move": {
      const module = assertModuleAt(
        draft,
        operation.payload.moduleInstanceId,
        operation.payload.newPosition,
      );
      assertAttachedRoutesEqual(draft.routes, module.id, []);
      assertRoutesAbsent(draft, operation.payload.removedRoutes);
      return;
    }
    case "rotate": {
      const module = draft.modules[operation.payload.moduleInstanceId];
      if (
        module?.id !== operation.payload.moduleInstanceId ||
        module.rotation !== operation.payload.newRotation
      ) {
        throw new Error("Draft module does not match the expected rotation history state.");
      }
      assertAttachedRoutesEqual(draft.routes, module.id, []);
      assertRoutesAbsent(draft, operation.payload.removedRoutes);
      return;
    }
    case "remove":
      if (Object.hasOwn(draft.modules, operation.payload.module.id)) {
        throw new Error("Removed module unexpectedly exists before remove undo.");
      }
      assertStoredModulePlacement(facility, draft, operation.payload.module, content);
      assertRoutesAbsent(draft, operation.payload.removedRoutes);
      return;
    case "connect": {
      const existing = draft.routes[operation.payload.route.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.route)) {
        throw new Error("Connected route does not match the stored history route.");
      }
      return;
    }
    case "disconnect":
      assertRoutesAbsent(draft, [operation.payload.route]);
      return;
  }
}

function assertRedoPrecondition(
  facility: FacilityState,
  draft: DesignDraftState,
  operation: ParsedDesignDraftOperation,
  content: ContentBundle,
): void {
  switch (operation.kind) {
    case "place":
      if (Object.hasOwn(draft.modules, operation.payload.module.id)) {
        throw new Error("Placed module unexpectedly exists before place redo.");
      }
      assertStoredModulePlacement(facility, draft, operation.payload.module, content);
      return;
    case "move": {
      const module = assertModuleAt(
        draft,
        operation.payload.moduleInstanceId,
        operation.payload.previousPosition,
      );
      assertAttachedRoutesEqual(draft.routes, module.id, operation.payload.removedRoutes);
      return;
    }
    case "rotate": {
      const module = draft.modules[operation.payload.moduleInstanceId];
      if (
        module?.id !== operation.payload.moduleInstanceId ||
        module.rotation !== operation.payload.previousRotation
      ) {
        throw new Error("Draft module does not match the expected rotation history state.");
      }
      assertAttachedRoutesEqual(draft.routes, module.id, operation.payload.removedRoutes);
      return;
    }
    case "remove": {
      const existing = draft.modules[operation.payload.module.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.module)) {
        throw new Error("Draft module does not match the stored remove history module.");
      }
      assertAttachedRoutesEqual(draft.routes, existing.id, operation.payload.removedRoutes);
      return;
    }
    case "connect":
      assertRoutesAbsent(draft, [operation.payload.route]);
      return;
    case "disconnect": {
      const existing = draft.routes[operation.payload.route.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.route)) {
        throw new Error("Disconnected route does not match the stored history route.");
      }
      return;
    }
  }
}

function applyUndoOperation(
  facility: FacilityState,
  draft: DesignDraftState,
  operation: ParsedDesignDraftOperation,
  content: ContentBundle,
): void {
  switch (operation.kind) {
    case "place": {
      const existing = draft.modules[operation.payload.module.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.module)) {
        throw new Error("Placed module does not match the stored history module.");
      }
      assertAttachedRoutesEqual(draft.routes, existing.id, []);
      Reflect.deleteProperty(draft.modules, existing.id);
      return;
    }
    case "move": {
      const module = assertModuleAt(
        draft,
        operation.payload.moduleInstanceId,
        operation.payload.newPosition,
      );
      assertAttachedRoutesEqual(draft.routes, module.id, []);
      for (const route of operation.payload.removedRoutes) {
        if (Object.hasOwn(draft.routes, route.id)) {
          throw new Error("Removed route id unexpectedly exists before move undo.");
        }
      }
      module.position = { ...operation.payload.previousPosition };
      restoreRoutes(draft, operation.payload.removedRoutes);
      return;
    }
    case "rotate": {
      const module = draft.modules[operation.payload.moduleInstanceId];
      if (
        module?.id !== operation.payload.moduleInstanceId ||
        module.rotation !== operation.payload.newRotation
      ) {
        throw new Error("Draft module does not match the expected rotation history state.");
      }
      assertAttachedRoutesEqual(draft.routes, module.id, []);
      for (const route of operation.payload.removedRoutes) {
        if (Object.hasOwn(draft.routes, route.id)) {
          throw new Error("Removed route id unexpectedly exists before rotation undo.");
        }
      }
      module.rotation = operation.payload.previousRotation;
      restoreRoutes(draft, operation.payload.removedRoutes);
      return;
    }
    case "remove": {
      if (Object.hasOwn(draft.modules, operation.payload.module.id)) {
        throw new Error("Removed module unexpectedly exists before remove undo.");
      }
      assertStoredModulePlacement(facility, draft, operation.payload.module, content);
      draft.modules[operation.payload.module.id] = structuredClone(operation.payload.module);
      restoreRoutes(draft, operation.payload.removedRoutes);
      return;
    }
    case "connect": {
      const existing = draft.routes[operation.payload.route.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.route)) {
        throw new Error("Connected route does not match the stored history route.");
      }
      Reflect.deleteProperty(draft.routes, existing.id);
      return;
    }
    case "disconnect": {
      restoreRoutes(draft, [operation.payload.route]);
      return;
    }
  }
}

function applyRedoOperation(
  facility: FacilityState,
  draft: DesignDraftState,
  operation: ParsedDesignDraftOperation,
  content: ContentBundle,
): void {
  switch (operation.kind) {
    case "place": {
      if (Object.hasOwn(draft.modules, operation.payload.module.id)) {
        throw new Error("Placed module unexpectedly exists before place redo.");
      }
      assertStoredModulePlacement(facility, draft, operation.payload.module, content);
      draft.modules[operation.payload.module.id] = structuredClone(operation.payload.module);
      return;
    }
    case "move": {
      const module = assertModuleAt(
        draft,
        operation.payload.moduleInstanceId,
        operation.payload.previousPosition,
      );
      assertAttachedRoutesEqual(draft.routes, module.id, operation.payload.removedRoutes);
      removeStoredRoutes(draft, operation.payload.removedRoutes);
      module.position = { ...operation.payload.newPosition };
      return;
    }
    case "rotate": {
      const module = draft.modules[operation.payload.moduleInstanceId];
      if (
        module?.id !== operation.payload.moduleInstanceId ||
        module.rotation !== operation.payload.previousRotation
      ) {
        throw new Error("Draft module does not match the expected rotation history state.");
      }
      assertAttachedRoutesEqual(draft.routes, module.id, operation.payload.removedRoutes);
      removeStoredRoutes(draft, operation.payload.removedRoutes);
      module.rotation = operation.payload.newRotation;
      return;
    }
    case "remove": {
      const existing = draft.modules[operation.payload.module.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.module)) {
        throw new Error("Draft module does not match the stored remove history module.");
      }
      assertAttachedRoutesEqual(draft.routes, existing.id, operation.payload.removedRoutes);
      removeStoredRoutes(draft, operation.payload.removedRoutes);
      Reflect.deleteProperty(draft.modules, existing.id);
      return;
    }
    case "connect":
      restoreRoutes(draft, [operation.payload.route]);
      return;
    case "disconnect": {
      const existing = draft.routes[operation.payload.route.id];
      if (existing === undefined || !sameCanonical(existing, operation.payload.route)) {
        throw new Error("Disconnected route does not match the stored history route.");
      }
      Reflect.deleteProperty(draft.routes, existing.id);
      return;
    }
  }
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

    UNDO_DESIGN({ state }) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      const stored = draft.undoStack.at(-1);
      if (stored === undefined) {
        assertValidUndoRedoDraft(state.facility, draft, content);
        return;
      }
      const operation = parseDesignDraftOperation(stored);
      assertUndoPrecondition(state.facility, draft, operation, content);
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }
      applyUndoOperation(state.facility, draft, operation, content);
      draft.revision = revision;
      draft.undoStack = draft.undoStack.slice(0, -1);
      draft.redoStack = [...draft.redoStack, cloneOperation(operation)];
      assertValidUndoRedoDraft(state.facility, draft, content);
    },

    REDO_DESIGN({ state }) {
      const draft = state.facility.designDraft;
      if (draft === null) {
        return REJECTIONS.notInDesignMode;
      }
      const stored = draft.redoStack.at(-1);
      if (stored === undefined) {
        assertValidUndoRedoDraft(state.facility, draft, content);
        return;
      }
      const operation = parseDesignDraftOperation(stored);
      assertRedoPrecondition(state.facility, draft, operation, content);
      const revision = incrementRevision(draft);
      if (revision === null) {
        return REJECTIONS.invalidSystem;
      }
      applyRedoOperation(state.facility, draft, operation, content);
      draft.revision = revision;
      draft.redoStack = draft.redoStack.slice(0, -1);
      draft.undoStack = [...draft.undoStack, cloneOperation(operation)];
      assertValidUndoRedoDraft(state.facility, draft, content);
    },

    CANCEL_DESIGN({ state }) {
      if (state.facility.designDraft === null) {
        return REJECTIONS.notInDesignMode;
      }
      state.facility.designDraft = null;
    },
  });
}
