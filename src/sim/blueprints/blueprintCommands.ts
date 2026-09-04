import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { assertValidGridState } from "../../grid/validation/gridState.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type {
  BlueprintRecord,
  DesignDraftOperation,
  DesignDraftState,
  GameState,
  JsonObject,
  ModuleInstanceState,
  RouteState,
} from "../core/types.ts";
import {
  assertValidDesignHistory,
  assertValidDesignModeState,
  parseDesignDraftOperation,
} from "../design/designModeState.ts";
import { assertValidStoredOverclockState } from "../overclock/overclockState.ts";
import { isFeatureUnlocked } from "../research/researchDomain.ts";
import { assertValidThermalState } from "../thermal/thermalState.ts";
import { assertValidRouteState } from "../routing/manualRouting.ts";
import { canonicalSerialize } from "../replay/canonicalState.ts";
import { planBlueprintMaterialization } from "./blueprintMaterialization.ts";
import type {
  BlueprintMaterializationFailure,
  BlueprintMaterializationPlan,
} from "./blueprintMaterialization.ts";
import {
  captureCanonicalBlueprintPayload,
  validateBlueprintCaptureSelection,
} from "./blueprintCapture.ts";
import {
  assertValidBlueprintState,
  formatBlueprintId,
  normalizeBlueprintName,
  validateBlueprintState,
} from "./blueprintState.ts";
import { validateCurrentBlueprintCapture } from "./blueprintCapture.ts";

export type BlueprintCommandHandlers = Pick<
  CommandHandlerRegistry,
  "SAVE_BLUEPRINT" | "INSTANTIATE_BLUEPRINT" | "RENAME_BLUEPRINT"
>;

type BlueprintInvalidReason =
  | "invalid-name"
  | "design-mode-active"
  | "empty-selection"
  | "duplicate-module"
  | "missing-module"
  | "locked-module"
  | "invalid-record"
  | "unknown-blueprint"
  | "unsupported-kind"
  | "incompatible-content-version";

const REJECTIONS = {
  researchRequired: {
    code: "RESEARCH_REQUIRED",
    messageKey: "errors.research-required",
  },
  invalidSystem: {
    code: "INVALID_SYSTEM",
    messageKey: "errors.invalid-system",
  },
  notInDesignMode: {
    code: "NOT_IN_DESIGN_MODE",
    messageKey: "errors.not-in-design-mode",
  },
  insufficientInventory: {
    code: "INSUFFICIENT_INVENTORY",
    messageKey: "errors.insufficient-inventory",
  },
  outOfBounds: { code: "OUT_OF_BOUNDS", messageKey: "errors.out-of-bounds" },
  tileOccupied: { code: "TILE_OCCUPIED", messageKey: "errors.tile-occupied" },
} as const satisfies Record<string, CommandHandlerRejection>;

function blueprintInvalid(reason: BlueprintInvalidReason): CommandHandlerRejection {
  return {
    code: "BLUEPRINT_INVALID",
    messageKey: `errors.blueprint-${reason}`,
    parameters: { reason },
  };
}

function assertValidBlueprintSaveSources(state: GameState, content: ContentBundle): void {
  assertValidBlueprintState(state.blueprints);
  assertValidDesignModeState(state);
  assertValidGridState(state.facility, content);
  assertValidRouteState(
    {
      size: state.facility.size,
      modules: state.facility.modules,
      routes: state.facility.routes,
      nextRouteSequence: state.facility.nextRouteSequence,
    },
    content,
  );
  assertValidThermalState(state.facility, content.balancing.thermal);
  assertValidStoredOverclockState(state, content);
}

function selectionRejection(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): CommandHandlerRejection | undefined {
  const issues = validateBlueprintCaptureSelection(state, content, selectedModuleIds);
  const firstIssue = issues[0];
  if (firstIssue === undefined) return undefined;

  switch (firstIssue.code) {
    case "FEATURE_LOCKED":
    case "RESEARCH_NOT_COMPLETED":
      return REJECTIONS.researchRequired;
    case "ACTIVE_DESIGN_MODE":
      return blueprintInvalid("design-mode-active");
    case "EMPTY_SELECTION":
      return blueprintInvalid("empty-selection");
    case "DUPLICATE_SELECTION":
      return blueprintInvalid("duplicate-module");
    case "MISSING_MODULE":
      return blueprintInvalid("missing-module");
    case "MODULE_LOCKED":
      return blueprintInvalid("locked-module");
    case "MISSING_MODULE_DEFINITION":
      return blueprintInvalid("invalid-record");
    default:
      return blueprintInvalid("invalid-record");
  }
}

function validateCapturedRecord(
  state: Readonly<GameState>,
  content: ContentBundle,
  record: BlueprintRecord,
): boolean {
  const payload = {
    kind: record.kind,
    version: record.version,
    contentVersion: record.contentVersion,
    modules: record.modules,
    routes: record.routes,
    requiredResearchIds: record.requiredResearchIds,
    bounds: record.bounds,
    summary: record.summary,
  };
  const payloadIssues = validateCurrentBlueprintCapture(payload, content, state.research);
  if (payloadIssues.length > 0) return false;
  return (
    validateBlueprintState({
      nextBlueprintSequence: state.blueprints.nextBlueprintSequence + 1,
      records: { ...state.blueprints.records, [record.id]: record },
    }).length === 0
  );
}

function saveBlueprint(
  state: GameState,
  content: ContentBundle,
  name: string,
  selectedModuleIds: readonly string[],
): CommandHandlerRejection | undefined {
  assertValidBlueprintSaveSources(state, content);

  let normalizedName: string;
  try {
    normalizedName = normalizeBlueprintName(name);
  } catch {
    return blueprintInvalid("invalid-name");
  }

  if (!isFeatureUnlocked("subassembly-blueprints", state.research, content)) {
    return REJECTIONS.researchRequired;
  }
  if (state.facility.designDraft !== null) {
    return blueprintInvalid("design-mode-active");
  }

  const selectionFailure = selectionRejection(state, content, selectedModuleIds);
  if (selectionFailure !== undefined) return selectionFailure;

  const sequence = state.blueprints.nextBlueprintSequence;
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence >= Number.MAX_SAFE_INTEGER) {
    return REJECTIONS.invalidSystem;
  }
  const blueprintId = formatBlueprintId(sequence);
  if (Object.hasOwn(state.blueprints.records, blueprintId)) {
    return REJECTIONS.invalidSystem;
  }

  const payload = captureCanonicalBlueprintPayload(state, content, selectedModuleIds);
  const record: BlueprintRecord = {
    id: blueprintId,
    name: normalizedName,
    ...payload,
  };
  if (!validateCapturedRecord(state, content, record)) {
    return blueprintInvalid("invalid-record");
  }

  state.blueprints = {
    nextBlueprintSequence: sequence + 1,
    records: { ...state.blueprints.records, [record.id]: record },
  };
}

function renameBlueprint(
  state: GameState,
  name: string,
  blueprintId: string,
): CommandHandlerRejection | undefined {
  assertValidBlueprintState(state.blueprints);
  const record = state.blueprints.records[blueprintId];
  if (record?.id !== blueprintId) {
    return blueprintInvalid("unknown-blueprint");
  }

  let normalizedName: string;
  try {
    normalizedName = normalizeBlueprintName(name);
  } catch {
    return blueprintInvalid("invalid-name");
  }

  state.blueprints = {
    ...state.blueprints,
    records: {
      ...state.blueprints.records,
      [blueprintId]: { ...record, name: normalizedName },
    },
  };
}

function currentCaptureValue(record: BlueprintRecord): object {
  return {
    kind: record.kind,
    version: record.version,
    contentVersion: record.contentVersion,
    modules: record.modules,
    routes: record.routes,
    requiredResearchIds: record.requiredResearchIds,
    bounds: record.bounds,
    summary: record.summary,
  };
}

function toJsonObject(value: unknown): JsonObject {
  const parsed: unknown = JSON.parse(canonicalSerialize(value));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Blueprint operation payload must be a JSON object.");
  }
  return parsed as JsonObject;
}

function assertValidInstantiationSources(state: GameState, content: ContentBundle): void {
  assertValidBlueprintState(state.blueprints);
  assertValidDesignModeState(state);
  assertCanonicalSequenceOwnership(
    state.facility.modules,
    state.facility.nextModuleInstanceSequence,
    "module-instance",
  );
  assertCanonicalSequenceOwnership(
    state.facility.routes,
    state.facility.nextRouteSequence,
    "route",
  );
  assertValidGridState(state.facility, content);
  assertValidRouteState(
    {
      size: state.facility.size,
      modules: state.facility.modules,
      routes: state.facility.routes,
      nextRouteSequence: state.facility.nextRouteSequence,
    },
    content,
  );
  assertValidThermalState(state.facility, content.balancing.thermal);
  assertValidStoredOverclockState(state, content);
  const draft = state.facility.designDraft;
  if (draft === null) return;
  assertCanonicalSequenceOwnership(
    draft.modules,
    state.facility.nextModuleInstanceSequence,
    "module-instance",
  );
  assertCanonicalSequenceOwnership(draft.routes, state.facility.nextRouteSequence, "route");
  assertValidGridState(
    {
      ...state.facility,
      modules: draft.modules,
      routes: draft.routes,
      designDraft: null,
    },
    content,
  );
  assertValidRouteState(
    {
      size: state.facility.size,
      modules: draft.modules,
      routes: draft.routes,
      nextRouteSequence: state.facility.nextRouteSequence,
    },
    content,
  );
  assertValidDesignHistory(draft.undoStack, draft.redoStack);
}

function assertSafeSequenceIncrement(start: number, count: number, description: string): number {
  if (!Number.isSafeInteger(start) || start <= 0 || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${description} is invalid.`);
  }
  if (count > Number.MAX_SAFE_INTEGER - start) {
    throw new Error(`${description} overflows.`);
  }
  return start + count;
}

function assertCanonicalSequenceOwnership(
  records: Readonly<Record<string, { readonly id: string }>>,
  nextSequence: number,
  prefix: "module-instance" | "route",
): void {
  const pattern = prefix === "module-instance" ? /^module-instance-(\d{8,})$/ : /^route-(\d{8,})$/;
  for (const [key, record] of Object.entries(records)) {
    for (const id of [key, record.id]) {
      const match = pattern.exec(id);
      if (match?.[1] !== undefined) {
        const sequence = Number(match[1]);
        if (Number.isSafeInteger(sequence) && sequence >= nextSequence) {
          throw new Error(`The ${prefix} sequence is behind an allocated id.`);
        }
      }
    }
  }
}

function assertMaterializationPlan(
  state: GameState,
  record: BlueprintRecord,
  plan: BlueprintMaterializationPlan,
  position: { readonly x: number; readonly y: number },
  rotation: 0 | 90 | 180 | 270,
): void {
  if (
    plan.blueprintId !== record.id ||
    plan.blueprintVersion !== record.version ||
    plan.targetPosition.x !== position.x ||
    plan.targetPosition.y !== position.y ||
    plan.globalRotation !== rotation ||
    plan.addedModules.length !== record.modules.length ||
    plan.addedRoutes.length !== record.routes.length
  ) {
    throw new Error("Blueprint materialization plan evidence does not match its source.");
  }
  const expectedNextModuleSequence = assertSafeSequenceIncrement(
    state.facility.nextModuleInstanceSequence,
    plan.addedModules.length,
    "Blueprint module sequence",
  );
  const expectedNextRouteSequence = assertSafeSequenceIncrement(
    state.facility.nextRouteSequence,
    plan.addedRoutes.length,
    "Blueprint route sequence",
  );
  if (
    plan.nextModuleInstanceSequence !== expectedNextModuleSequence ||
    plan.nextRouteSequence !== expectedNextRouteSequence
  ) {
    throw new Error("Blueprint materialization plan sequence evidence is invalid.");
  }
  for (const [index, module] of plan.addedModules.entries()) {
    const expectedId = `module-instance-${(state.facility.nextModuleInstanceSequence + index)
      .toString()
      .padStart(8, "0")}`;
    if (
      module.id !== expectedId ||
      Object.hasOwn(state.facility.modules, module.id) ||
      state.facility.designDraft?.modules[module.id] !== undefined
    ) {
      throw new Error("Blueprint materialization plan contains an invalid module allocation.");
    }
  }
  for (const [index, route] of plan.addedRoutes.entries()) {
    const expectedId = `route-${(state.facility.nextRouteSequence + index)
      .toString()
      .padStart(8, "0")}`;
    if (
      route.id !== expectedId ||
      Object.hasOwn(state.facility.routes, route.id) ||
      state.facility.designDraft?.routes[route.id] !== undefined
    ) {
      throw new Error("Blueprint materialization plan contains an invalid route allocation.");
    }
  }
}

function materializationRejection(
  result: BlueprintMaterializationFailure,
): CommandHandlerRejection {
  switch (result.code) {
    case "INSUFFICIENT_INVENTORY":
      return REJECTIONS.insufficientInventory;
    case "INVALID_SYSTEM":
      return REJECTIONS.invalidSystem;
    case "INVALID_TARGET":
      if (result.reason === "collision" || result.reason === "route-collision") {
        return REJECTIONS.tileOccupied;
      }
      return REJECTIONS.outOfBounds;
    case "OUT_OF_BOUNDS":
      return REJECTIONS.outOfBounds;
    case "TILE_OCCUPIED":
      return REJECTIONS.tileOccupied;
    case "INVALID_ROUTE":
      return {
        code: "INVALID_ROUTE",
        messageKey: `errors.invalid-route-${result.reason.toLowerCase().replaceAll("_", "-")}`,
        parameters: { reason: result.reason },
      };
    case "INVALID_PORT":
      return {
        code: "INVALID_PORT",
        messageKey: "errors.route-invalid-port",
        parameters: { reason: result.reason },
      };
    case "INCOMPATIBLE_PORTS":
      return {
        code: "INCOMPATIBLE_PORTS",
        messageKey: "errors.route-incompatible-ports",
        parameters: { reason: result.reason },
      };
    case "NOT_IN_DESIGN_MODE":
      return REJECTIONS.notInDesignMode;
    case "FEATURE_LOCKED":
    case "RESEARCH_INCOMPLETE":
      return REJECTIONS.researchRequired;
    case "INVALID_ROTATION":
    case "BLUEPRINT_INVALID":
    case "BLUEPRINT_NOT_FOUND":
      return blueprintInvalid(
        result.reason === "content-version-mismatch"
          ? "incompatible-content-version"
          : "invalid-record",
      );
  }
  return REJECTIONS.invalidSystem;
}

function instantiateBlueprint(
  state: GameState,
  content: ContentBundle,
  blueprintId: string,
  position: { readonly x: number; readonly y: number },
  rotation: 0 | 90 | 180 | 270,
  commandId: string,
): CommandHandlerRejection | undefined {
  assertValidInstantiationSources(state, content);
  const record = state.blueprints.records[blueprintId];
  if (record?.id !== blueprintId) return blueprintInvalid("unknown-blueprint");
  const draft = state.facility.designDraft;
  if (draft === null) return REJECTIONS.notInDesignMode;
  if (!isFeatureUnlocked("subassembly-blueprints", state.research, content)) {
    return REJECTIONS.researchRequired;
  }
  for (const researchId of record.requiredResearchIds) {
    if (content.research[researchId] === undefined) return blueprintInvalid("invalid-record");
    if (state.research.statuses[researchId] !== "completed") return REJECTIONS.researchRequired;
  }
  if (record.kind !== "subassembly") return blueprintInvalid("unsupported-kind");
  if (record.contentVersion !== content.contentVersion) {
    return blueprintInvalid("incompatible-content-version");
  }
  if (
    validateCurrentBlueprintCapture(currentCaptureValue(record), content, state.research).length > 0
  ) {
    return blueprintInvalid("invalid-record");
  }

  const result = planBlueprintMaterialization(state, content, blueprintId, position, rotation);
  if (result.status === "rejected") return materializationRejection(result);
  assertMaterializationPlan(state, record, result.plan, position, rotation);

  const revision = draft.revision >= Number.MAX_SAFE_INTEGER ? null : draft.revision + 1;
  if (revision === null) return REJECTIONS.invalidSystem;
  const operation: DesignDraftOperation = {
    operationId: `design-operation-${revision}-${commandId}`,
    kind: "instantiate-blueprint",
    payload: toJsonObject({
      blueprintId: result.plan.blueprintId,
      blueprintVersion: result.plan.blueprintVersion,
      addedModules: result.plan.addedModules,
      addedRoutes: result.plan.addedRoutes,
      inventoryReservationDelta: result.plan.inventoryReservationDelta,
      nextModuleInstanceSequence: result.plan.nextModuleInstanceSequence,
      nextRouteSequence: result.plan.nextRouteSequence,
    }),
  };
  parseDesignDraftOperation(operation);
  const modules: Record<string, ModuleInstanceState> = { ...draft.modules };
  for (const module of result.plan.addedModules) modules[module.id] = structuredClone(module);
  const routes: Record<string, RouteState> = { ...draft.routes };
  for (const route of result.plan.addedRoutes) routes[route.id] = structuredClone(route);
  const candidateDraft: DesignDraftState = {
    ...draft,
    revision,
    modules,
    routes,
    undoStack: [...draft.undoStack, operation],
    redoStack: [],
  };
  assertValidDesignHistory(candidateDraft.undoStack, candidateDraft.redoStack);
  assertValidGridState({ ...state.facility, modules, routes, designDraft: null }, content);
  assertValidRouteState(
    {
      size: state.facility.size,
      modules,
      routes,
      nextRouteSequence: result.plan.nextRouteSequence,
    },
    content,
  );
  state.facility.designDraft = candidateDraft;
  state.facility.nextModuleInstanceSequence = result.plan.nextModuleInstanceSequence;
  state.facility.nextRouteSequence = result.plan.nextRouteSequence;
}

export function createBlueprintCommandHandlers(content: ContentBundle): BlueprintCommandHandlers {
  return Object.freeze({
    SAVE_BLUEPRINT({ state }, command) {
      return saveBlueprint(state, content, command.name, command.selectedModuleIds);
    },

    RENAME_BLUEPRINT({ state }, command) {
      return renameBlueprint(state, command.name, command.blueprintId);
    },

    INSTANTIATE_BLUEPRINT({ state }, command) {
      return instantiateBlueprint(
        state,
        content,
        command.blueprintId,
        command.position,
        command.rotation,
        command.commandId,
      );
    },
  });
}
