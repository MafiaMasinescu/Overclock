import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { validateModulePlacement } from "../../grid/domain/occupancy.ts";
import type { GameState, GridPoint, ModuleInstanceId, Rotation } from "../core/types.ts";
import {
  calculateDesignApplySettlement,
  calculateDesignApplyPreview,
  type DesignApplyPreview,
} from "../design/designApplyPreview.ts";
import {
  calculatePlacementReservations,
  incrementDesignRevision,
  listAttachedRouteIds,
  resolveNextModuleInstanceId,
  resolveNextRouteId,
} from "../design/designModeCommands.ts";
import { validateManualRouteConnection } from "../routing/manualRouting.ts";
import { planBlueprintMaterialization } from "../blueprints/blueprintMaterialization.ts";
import { planModulePurchase } from "../economy/inventoryTransactions.ts";
import type {
  BuildBlueprintMaterializationPreview,
  BuildManualRouteInput,
  BuildManualRoutePreview,
  BuildPlacementInput,
  BuildPlacementPreview,
  BuildReadReason,
  BuildRemovalPreview,
  BuildSourceStamp,
  BuildViewMode,
} from "./contracts.ts";
import { freezeBuildRead } from "./contracts.ts";

function activeModules(state: Readonly<GameState>): Readonly<GameState["facility"]["modules"]> {
  return state.facility.designDraft?.modules ?? state.facility.modules;
}

function mapPlacementReason(code: string): BuildReadReason {
  if (code === "OUT_OF_BOUNDS") return "OUT_OF_BOUNDS";
  if (code === "TILE_OCCUPIED") return "TILE_OCCUPIED";
  return "INVALID_INPUT";
}

function mapManualRouteReason(code: string): BuildReadReason {
  if (code === "INVALID_PORT") return "INVALID_PORT";
  if (code === "INCOMPATIBLE_PORTS") return "INCOMPATIBLE_PORTS";
  if (code === "OUT_OF_BOUNDS") return "OUT_OF_BOUNDS";
  return "INVALID_ROUTE";
}

export function previewBuildPlacement(
  state: Readonly<GameState>,
  content: ContentBundle,
  input: BuildPlacementInput,
): BuildPlacementPreview {
  const definition = content.modules[input.definitionId];
  const base = {
    definitionId: input.definitionId,
    position: { ...input.position },
    rotation: input.rotation,
    attachedRouteIds: [] as readonly string[],
  };
  if (state.facility.designDraft === null || definition === undefined) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: definition === undefined ? "INVALID_INPUT" : "DRAFT_REQUIRED",
      ...base,
      occupiedTiles: [],
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  const placement = validateModulePlacement({
    facilitySize: state.facility.size,
    definitionId: input.definitionId,
    position: input.position,
    rotation: input.rotation,
    modules: activeModules(state),
    content,
  });
  if (!placement.valid) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: mapPlacementReason(placement.issues[0]?.code ?? "INVALID_PAYLOAD"),
      ...base,
      occupiedTiles: placement.occupiedTiles,
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }

  const inventory = state.inventory.stacks;
  let reservations: ReturnType<typeof calculatePlacementReservations>;
  try {
    reservations = calculatePlacementReservations(
      state.facility,
      state.facility.designDraft,
      inventory,
      input.definitionId,
    );
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) throw error;
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INVALID_SYSTEM",
      ...base,
      occupiedTiles: placement.occupiedTiles,
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  const existing = reservations.find((entry) => entry.definitionId === input.definitionId);
  const requiredFromInventory = existing?.requiredFromInventory ?? 1;
  const available = inventory[input.definitionId]?.quantity ?? 0;
  const requiresPurchase = requiredFromInventory > available;
  const hasUnresolvedShortfall = reservations.some(
    (reservation) =>
      reservation.requiredFromInventory >
      reservation.availableInventory +
        (input.source === "catalog" && reservation.definitionId === input.definitionId ? 1 : 0),
  );
  if (hasUnresolvedShortfall) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INSUFFICIENT_INVENTORY",
      ...base,
      occupiedTiles: placement.occupiedTiles,
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  const purchasePlan = requiresPurchase
    ? planModulePurchase(state, content, input.definitionId, 1)
    : null;
  const purchaseCostUsd = purchasePlan?.status === "ready" ? purchasePlan.costUsd : 0;
  if (requiresPurchase && purchasePlan?.status === "rejected") {
    const reason: BuildReadReason =
      purchasePlan.code === "RESEARCH_REQUIRED"
        ? "RESEARCH_REQUIRED"
        : purchasePlan.code === "INSUFFICIENT_CASH"
          ? "INSUFFICIENT_CREDIT"
          : "INVALID_SYSTEM";
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason,
      ...base,
      occupiedTiles: placement.occupiedTiles,
      purchaseCostUsd: definition.priceUsd,
      requiresPurchase: true,
    });
  }
  if (
    incrementDesignRevision(state.facility.designDraft) === null ||
    resolveNextModuleInstanceId(state.facility, state.facility.designDraft) === null
  ) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INVALID_SYSTEM",
      ...base,
      occupiedTiles: placement.occupiedTiles,
      purchaseCostUsd,
      requiresPurchase,
    });
  }
  return freezeBuildRead({
    status: "ready",
    valid: true,
    reason: null,
    ...base,
    occupiedTiles: placement.occupiedTiles,
    purchaseCostUsd,
    requiresPurchase,
  });
}

export function previewBuildMove(
  state: Readonly<GameState>,
  content: ContentBundle,
  moduleInstanceId: ModuleInstanceId,
  position: GridPoint,
): BuildPlacementPreview {
  const draft = state.facility.designDraft;
  const module = draft?.modules[moduleInstanceId];
  if (draft === null || module === undefined) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: draft === null ? "DRAFT_REQUIRED" : "INVALID_INPUT",
      definitionId: module?.definitionId ?? "unknown",
      position: { ...position },
      rotation: module?.rotation ?? 0,
      occupiedTiles: [],
      attachedRouteIds: [],
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  const placement = validateModulePlacement({
    facilitySize: state.facility.size,
    definitionId: module.definitionId,
    position,
    rotation: module.rotation,
    modules: draft.modules,
    content,
    excludeModuleInstanceId: moduleInstanceId,
  });
  const changesPosition = module.position.x !== position.x || module.position.y !== position.y;
  const attachedRouteIds = changesPosition
    ? listAttachedRouteIds(draft.routes, moduleInstanceId)
    : [];
  if (placement.valid && changesPosition && incrementDesignRevision(draft) === null) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INVALID_SYSTEM",
      definitionId: module.definitionId,
      position: { ...position },
      rotation: module.rotation,
      occupiedTiles: placement.occupiedTiles,
      attachedRouteIds,
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  return freezeBuildRead({
    status: placement.valid ? "ready" : "rejected",
    valid: placement.valid,
    reason: placement.valid
      ? null
      : mapPlacementReason(placement.issues[0]?.code ?? "INVALID_PAYLOAD"),
    definitionId: module.definitionId,
    position: { ...position },
    rotation: module.rotation,
    occupiedTiles: placement.occupiedTiles,
    attachedRouteIds,
    purchaseCostUsd: 0,
    requiresPurchase: false,
  });
}

export function previewBuildRotation(
  state: Readonly<GameState>,
  content: ContentBundle,
  moduleInstanceId: ModuleInstanceId,
  rotation: Rotation,
): BuildPlacementPreview {
  const draft = state.facility.designDraft;
  const module = draft?.modules[moduleInstanceId];
  if (draft === null || module === undefined) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: draft === null ? "DRAFT_REQUIRED" : "INVALID_INPUT",
      definitionId: "unknown",
      position: { x: 0, y: 0 },
      rotation,
      occupiedTiles: [],
      attachedRouteIds: [],
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  const placement = validateModulePlacement({
    facilitySize: state.facility.size,
    definitionId: module.definitionId,
    position: module.position,
    rotation,
    modules: draft.modules,
    content,
    excludeModuleInstanceId: moduleInstanceId,
  });
  const changesRotation = module.rotation !== rotation;
  const attachedRouteIds = changesRotation
    ? listAttachedRouteIds(draft.routes, moduleInstanceId)
    : [];
  if (placement.valid && changesRotation && incrementDesignRevision(draft) === null) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INVALID_SYSTEM",
      definitionId: module.definitionId,
      position: { ...module.position },
      rotation,
      occupiedTiles: placement.occupiedTiles,
      attachedRouteIds,
      purchaseCostUsd: 0,
      requiresPurchase: false,
    });
  }
  return freezeBuildRead({
    status: placement.valid ? "ready" : "rejected",
    valid: placement.valid,
    reason: placement.valid
      ? null
      : mapPlacementReason(placement.issues[0]?.code ?? "INVALID_PAYLOAD"),
    definitionId: module.definitionId,
    position: { ...module.position },
    rotation,
    occupiedTiles: placement.occupiedTiles,
    attachedRouteIds,
    purchaseCostUsd: 0,
    requiresPurchase: false,
  });
}

export function previewBuildRemoval(
  state: Readonly<GameState>,
  moduleInstanceId: ModuleInstanceId,
): BuildRemovalPreview {
  const draft = state.facility.designDraft;
  const module = draft?.modules[moduleInstanceId];
  if (draft === null || module === undefined) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: draft === null ? "DRAFT_REQUIRED" : "INVALID_INPUT",
      moduleInstanceId,
      attachedRouteIds: [],
    });
  }
  if (incrementDesignRevision(draft) === null) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INVALID_SYSTEM",
      moduleInstanceId,
      attachedRouteIds: listAttachedRouteIds(draft.routes, moduleInstanceId),
    });
  }
  return freezeBuildRead({
    status: "ready",
    valid: true,
    reason: null,
    moduleInstanceId,
    attachedRouteIds: Object.values(draft.routes)
      .filter(
        (route) =>
          route.from.moduleInstanceId === moduleInstanceId ||
          route.to.moduleInstanceId === moduleInstanceId,
      )
      .map((route) => route.id)
      .toSorted(),
  });
}

export function previewBuildApply(
  state: Readonly<GameState>,
  content: ContentBundle,
): { readonly data: DesignApplyPreview; readonly reason: BuildReadReason | null } {
  if (state.benchmarks.active !== null) {
    return freezeBuildRead({
      data: calculateDesignApplyPreview(state, content),
      reason: "ACTIVE_BENCHMARK",
    });
  }
  const data = calculateDesignApplyPreview(state, content);
  if (data.status === "blocked") {
    const reason: BuildReadReason =
      data.code === "NOT_IN_DESIGN_MODE"
        ? "DRAFT_REQUIRED"
        : data.code === "INSUFFICIENT_INVENTORY"
          ? "INSUFFICIENT_INVENTORY"
          : "INVALID_SYSTEM";
    return freezeBuildRead({ data, reason });
  }
  const affordability = calculateDesignApplySettlement(state, data);
  const reason: BuildReadReason | null =
    affordability.status === "ready"
      ? null
      : affordability.code === "INSUFFICIENT_CASH"
        ? "INSUFFICIENT_CREDIT"
        : "INVALID_SYSTEM";
  return freezeBuildRead({ data, reason });
}

export function previewBuildManualRoute(
  state: Readonly<GameState>,
  content: ContentBundle,
  input: BuildManualRouteInput,
): BuildManualRoutePreview {
  if (state.facility.designDraft === null) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "DRAFT_REQUIRED",
      domainReason: null,
      routeKind: null,
      path: input.path,
    });
  }
  const facility = {
    ...state.facility,
    modules: state.facility.designDraft.modules,
    routes: state.facility.designDraft.routes,
  };
  const result = validateManualRouteConnection(facility, content, input.from, input.to, input.path);
  if ("code" in result) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: mapManualRouteReason(result.code),
      domainReason: result.reason,
      routeKind: null,
      path: input.path,
    });
  }
  if (result.kind !== input.kind) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INCOMPATIBLE_PORTS",
      domainReason: "REQUESTED_KIND_MISMATCH",
      routeKind: result.kind,
      path: input.path,
    });
  }
  if (
    incrementDesignRevision(state.facility.designDraft) === null ||
    resolveNextRouteId(state.facility, state.facility.designDraft) === null
  ) {
    return freezeBuildRead({
      status: "rejected",
      valid: false,
      reason: "INVALID_SYSTEM",
      domainReason: null,
      routeKind: result.kind,
      path: input.path,
    });
  }
  return freezeBuildRead({
    status: "ready",
    valid: true,
    reason: null,
    domainReason: null,
    routeKind: result.kind,
    path: input.path,
  });
}

export function previewBlueprintMaterialization(
  state: Readonly<GameState>,
  content: ContentBundle,
  blueprintId: string,
  position: GridPoint,
  rotation: Rotation,
): BuildBlueprintMaterializationPreview {
  const result = planBlueprintMaterialization(state, content, blueprintId, position, rotation);
  if (result.status !== "ready") return freezeBuildRead(result);
  const moduleHandles = new Map(
    result.plan.addedModules.map((module, index) => [module.id, `ghost-module-${index + 1}`]),
  );
  return freezeBuildRead({
    status: "ready",
    blueprintId: result.plan.blueprintId,
    blueprintVersion: result.plan.blueprintVersion,
    targetPosition: result.plan.targetPosition,
    globalRotation: result.plan.globalRotation,
    modules: result.plan.addedModules.map((module) => ({
      localHandle: moduleHandles.get(module.id) ?? "ghost-module-unknown",
      definitionId: module.definitionId,
      position: module.position,
      rotation: module.rotation,
    })),
    routes: result.plan.addedRoutes.map((route, index) => ({
      localHandle: `ghost-route-${index + 1}`,
      kind: route.kind,
      fromModuleHandle: moduleHandles.get(route.from.moduleInstanceId) ?? "ghost-module-unknown",
      toModuleHandle: moduleHandles.get(route.to.moduleInstanceId) ?? "ghost-module-unknown",
      path: route.path,
    })),
    inventoryReservationDelta: result.plan.inventoryReservationDelta,
  });
}

export function buildPreviewSource(
  state: Readonly<GameState>,
  mode: BuildViewMode,
  generation: number,
): BuildSourceStamp {
  return {
    mode,
    observedTick: state.tick,
    liveLayoutRevision: state.facility.liveLayoutRevision,
    draftRevision: state.facility.designDraft?.revision ?? null,
    generation,
  };
}
