// Pure presentation projector (Phase 2 §4, §7.1).
//
// Reads current immutable state, content and presentation context and
// returns owned, deeply frozen view models. No gameplay writes, no
// duplicated allocation/formula implementations: every derived number
// below reuses an existing pure domain rule or a documented read-only
// definition from the frozen source mapping (`sourceMapping.ts`).
// Never throws on valid authoritative state; unknown content references
// fail loud because they contradict construction-time validation.

import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { resolveRotatedFootprintSize } from "../../grid/domain/footprintGeometry.ts";
import { freezeOwned } from "./freezeOwned.ts";
import { isRegisteredProjectedThermalTiles, registerProjectedGrid } from "./ownedPlainData.ts";
import { isFeatureUnlocked, isModuleUnlocked } from "../research/researchDomain.ts";
import { validateRouteState } from "../routing/manualRouting.ts";
import { hasPotentialBenchmarkStart } from "../benchmarks/benchmarkCommands.ts";
import { rejectIfBenchmarkConfigurationLocked } from "../benchmarks/benchmarkGuards.ts";
import {
  validateBlueprintCaptureSelection,
  validateCurrentBlueprintCapture,
} from "../blueprints/blueprintCapture.ts";
import {
  calculateDesignApplyPreview,
  isDesignApplyPreviewRejection,
} from "../design/designApplyPreview.ts";
import { hasPotentialResearchStart } from "../research/researchCommands.ts";
import { hasPotentialTaskAcceptance } from "../tasks/taskCommands.ts";
import type {
  ComputeBreakdown,
  FacilityState,
  GameState,
  ModuleInstanceState,
  RouteState,
} from "../core/types.ts";
import type {
  GridModuleViewModel,
  GridRouteViewModel,
  GridViewModel,
  GridViewMode,
  InspectorViewModel,
  PresentationContext,
  ProjectedPresentation,
  ResearchSummaryViewModel,
  TaskCardViewModel,
  TelemetryViewModel,
  UiSnapshot,
} from "./presentationTypes.ts";

interface ThermalSummary {
  readonly meanTemperatureC: number;
  readonly maxTemperatureC: number;
  at: (x: number, y: number) => number;
}

function summarizeThermal(facility: Readonly<FacilityState>): ThermalSummary {
  const { width, height } = facility.size;
  const values = new Float64Array(width * height).fill(facility.ambientTemperatureC);
  for (const tile of facility.thermalTiles) {
    const index = tile.position.y * width + tile.position.x;
    if (index >= 0 && index < values.length) values[index] = tile.temperatureC;
  }
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    sum += value;
    if (value > max) max = value;
  }
  const count = values.length;
  return {
    meanTemperatureC: count === 0 ? facility.ambientTemperatureC : sum / count,
    maxTemperatureC: count === 0 ? facility.ambientTemperatureC : max,
    at: (x: number, y: number) => values[y * width + x] ?? facility.ambientTemperatureC,
  };
}

function meanLiveModuleTemperatureC(
  module: Readonly<ModuleInstanceState>,
  definitionId: string,
  content: ContentBundle,
  thermal: ThermalSummary,
): number | null {
  const definition = content.modules[definitionId];
  if (definition === undefined) {
    throw new Error(`Presentation cannot project unknown module definition ${definitionId}.`);
  }
  const footprint = resolveRotatedFootprintSize(definition.footprint, module.rotation);
  // Solid-rectangle footprints rotate to solid rectangles anchored at the
  // module position: identical coverage to enumerateOccupiedTiles over the
  // validated layout, computed inline without per-module allocation.
  let sum = 0;
  let count = 0;
  for (let dy = 0; dy < footprint.height; dy += 1) {
    for (let dx = 0; dx < footprint.width; dx += 1) {
      sum += thermal.at(module.position.x + dx, module.position.y + dy);
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

interface RouteIssueCacheEntry {
  readonly modules: Readonly<Record<string, Readonly<ModuleInstanceState>>>;
  readonly routes: Readonly<Record<string, Readonly<RouteState>>>;
  readonly width: number;
  readonly height: number;
  readonly nextRouteSequence: number;
  readonly issues: ReadonlySet<string>;
}

// The §4 private last-published comparison cache: a single entry keyed by
// layout branch identity. Unchanged layouts (the common tick-to-tick case
// under structural sharing) reuse the validated issue set; any edit
// swaps branch identity and recomputes exactly once. Observationally pure:
// identical inputs always yield identical outputs.
// Route issue memoization is created per SimCore presentation runtime below.

function calculateRouteIssues(
  layout: Pick<FacilityState, "modules" | "routes">,
  facility: Readonly<FacilityState>,
  content: ContentBundle,
): ReadonlySet<string> {
  const issues = validateRouteState(
    {
      size: facility.size,
      modules: layout.modules,
      routes: layout.routes,
      nextRouteSequence: facility.nextRouteSequence,
    },
    content,
  );
  const flagged = new Set<string>();
  for (const issue of issues) {
    if (issue.routeId !== undefined) flagged.add(issue.routeId);
  }
  return flagged;
}

type RouteIssueResolver = (
  layout: Pick<FacilityState, "modules" | "routes">,
  facility: Readonly<FacilityState>,
  content: ContentBundle,
) => ReadonlySet<string>;

function createRouteIssueResolver(): RouteIssueResolver {
  let cache: RouteIssueCacheEntry | null = null;
  return (layout, facility, content) => {
    if (
      cache !== null &&
      cache.modules === layout.modules &&
      cache.routes === layout.routes &&
      cache.width === facility.size.width &&
      cache.height === facility.size.height &&
      cache.nextRouteSequence === facility.nextRouteSequence
    ) {
      return cache.issues;
    }
    const issues = calculateRouteIssues(layout, facility, content);
    cache = {
      modules: layout.modules,
      routes: layout.routes,
      width: facility.size.width,
      height: facility.size.height,
      nextRouteSequence: facility.nextRouteSequence,
      issues,
    };
    return issues;
  };
}

const directRouteIssueResolver: RouteIssueResolver = calculateRouteIssues;

type ModuleWarning = GridModuleViewModel["warning"];

function resolveModuleWarning(
  moduleId: string,
  liveModule: Readonly<ModuleInstanceState> | undefined,
  facility: Readonly<FacilityState>,
  layoutRoutes: Readonly<Record<string, Readonly<RouteState>>>,
  routesWithIssues: ReadonlySet<string>,
): ModuleWarning {
  if (liveModule !== undefined) {
    const overclock = facility.overclock.byModule[moduleId];
    if (overclock?.shutdownReason === "thermal") return "thermal";
    const delivery = facility.power.byModule[moduleId];
    if (delivery !== undefined && delivery.limitingReason !== "none") return "power";
    // Attachments are read from the viewed (selected) layout; the issue
    // set comes from validating that same layout. Power/thermal evidence
    // always stays live (§7.1: no recalculated draft prediction).
    for (const route of Object.values(layoutRoutes)) {
      if (
        (route.from.moduleInstanceId === moduleId || route.to.moduleInstanceId === moduleId) &&
        routesWithIssues.has(route.id)
      ) {
        return "route";
      }
    }
  }
  return "none";
}

function projectGridModules(
  layout: Pick<FacilityState, "modules" | "routes" | "power" | "overclock">,
  liveFacility: Readonly<FacilityState>,
  content: ContentBundle,
  thermal: ThermalSummary,
  routesWithIssues: ReadonlySet<string>,
  selected: Readonly<Set<string>>,
): GridModuleViewModel[] {
  const modules: GridModuleViewModel[] = [];
  for (const moduleId of Object.keys(layout.modules).toSorted(compareStableStrings)) {
    const module = layout.modules[moduleId];
    if (module === undefined) continue;
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      throw new Error(
        `Presentation cannot project unknown module definition ${module.definitionId}.`,
      );
    }
    const liveModule = liveFacility.modules[moduleId];
    const footprint = resolveRotatedFootprintSize(definition.footprint, module.rotation);
    modules.push({
      id: module.id,
      definitionId: module.definitionId,
      spriteKey: `module-${definition.category}`,
      position: { x: module.position.x, y: module.position.y },
      footprint: { width: footprint.width, height: footprint.height },
      rotation: module.rotation,
      operationalState: module.operationalState,
      selected: selected.has(module.id),
      warning: resolveModuleWarning(
        moduleId,
        liveModule,
        liveFacility,
        layout.routes,
        routesWithIssues,
      ),
      temperatureC:
        liveModule === undefined
          ? null
          : meanLiveModuleTemperatureC(liveModule, liveModule.definitionId, content, thermal),
      overclock: {
        profile: module.overclock.profile,
        frequencyRatio: module.overclock.frequencyRatio,
        voltageRatio: module.overclock.voltageRatio,
      },
    });
  }
  return modules;
}

function projectGridRoutes(
  layout: Pick<FacilityState, "routes" | "power">,
  selected: Readonly<Set<string>>,
): GridRouteViewModel[] {
  const routes: GridRouteViewModel[] = [];
  for (const routeId of Object.keys(layout.routes).toSorted(compareStableStrings)) {
    const route = layout.routes[routeId];
    if (route === undefined) continue;
    routes.push({
      id: route.id,
      kind: route.kind,
      path: route.path.map((point) => ({ x: point.x, y: point.y })),
      utilizationRatio:
        route.kind === "power" ? (layout.power.byRoute[route.id]?.utilizationRatio ?? null) : null,
      selected: selected.has(route.id),
    });
  }
  return routes;
}

function copyBreakdown(breakdown: Readonly<ComputeBreakdown>): ComputeBreakdown {
  return {
    theoreticalComputeFlops: breakdown.theoreticalComputeFlops,
    researchFactor: breakdown.researchFactor,
    powerFactor: breakdown.powerFactor,
    thermalFactor: breakdown.thermalFactor,
    memoryFactor: breakdown.memoryFactor,
    interconnectFactor: breakdown.interconnectFactor,
    suitabilityFactor: breakdown.suitabilityFactor,
    stabilityFactor: breakdown.stabilityFactor,
    usefulComputeFlops: breakdown.usefulComputeFlops,
    bottlenecks: breakdown.bottlenecks.map((entry) => ({
      factor: entry.factor,
      factorValue: entry.factorValue,
      lostComputeFlops: entry.lostComputeFlops,
      explanationKey: entry.explanationKey,
    })),
  };
}

function selectBottleneck(
  breakdown: Readonly<ComputeBreakdown> | undefined,
): TelemetryViewModel["bottleneck"] {
  if (breakdown === undefined || breakdown.bottlenecks.length === 0) return null;
  let best = breakdown.bottlenecks[0];
  if (best === undefined) return null;
  for (const entry of breakdown.bottlenecks) {
    if (
      entry.lostComputeFlops > best.lostComputeFlops ||
      (entry.lostComputeFlops === best.lostComputeFlops &&
        compareStableStrings(entry.factor, best.factor) < 0)
    ) {
      best = entry;
    }
  }
  return {
    factor: best.factor,
    factorValue: best.factorValue,
    lostComputeFlops: best.lostComputeFlops,
    explanationKey: best.explanationKey,
  };
}

function clampUnitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function projectTaskCards(state: Readonly<GameState>, content: ContentBundle): TaskCardViewModel[] {
  const cards: TaskCardViewModel[] = [];
  const ids = Object.keys(state.tasks.instances).toSorted(compareStableStrings);
  for (const taskId of ids) {
    const instance = state.tasks.instances[taskId];
    if (instance === undefined) continue;
    const definition = content.tasks[instance.definitionId];
    if (definition === undefined) {
      throw new Error(
        `Presentation cannot project unknown task definition ${instance.definitionId}.`,
      );
    }
    let required = 0;
    for (const phase of definition.phases) required += phase.operations;
    cards.push({
      taskInstanceId: instance.id,
      definitionId: instance.definitionId,
      nameKey: definition.nameKey,
      status: instance.status,
      tags: [...definition.tags],
      progressRatio:
        required <= 0 ? 0 : clampUnitRatio(instance.totalCompletedOperations / required),
      phaseIndex: instance.currentPhaseIndex,
      phaseCount: definition.phases.length,
      deadlineTick: instance.deadlineTick,
      projectedCompletionTick: null,
      deadlineRisk: null,
      allocatedUsefulComputeFlops: instance.allocation?.deliveredUsefulComputeFlops ?? 0,
    });
  }
  return cards;
}

function projectResearch(
  state: Readonly<GameState>,
  content: ContentBundle,
): ResearchSummaryViewModel {
  const ordered = Object.values(content.research).toSorted(
    (left, right) => left.sortOrder - right.sortOrder || compareStableStrings(left.id, right.id),
  );
  const availableNodeIds: string[] = [];
  const completedNodeIds: string[] = [];
  for (const node of ordered) {
    const status = state.research.statuses[node.id];
    if (status === "available") availableNodeIds.push(node.id);
    else if (status === "completed") completedNodeIds.push(node.id);
  }
  const active = state.research.active;
  const activeNode = active === null ? undefined : content.research[active.nodeId];
  return {
    researchData: state.research.researchData,
    activeNodeId: active?.nodeId ?? null,
    activeProgressRatio:
      active === null || activeNode === undefined || activeNode.requiredOperations <= 0
        ? 0
        : clampUnitRatio(active.completedOperations / activeNode.requiredOperations),
    availableNodeIds,
    completedNodeIds,
  };
}

function totalInventoryUnits(state: Readonly<GameState>): number {
  let total = 0;
  for (const stack of Object.values(state.inventory.stacks)) {
    total += stack.quantity;
    if (!Number.isSafeInteger(total)) return Number.MAX_SAFE_INTEGER;
  }
  return total;
}

function projectCommandAvailability(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
): Record<string, boolean> {
  const draft = state.facility.designDraft;
  const hasUnlockedModule = Object.keys(content.modules).some((moduleId) =>
    isModuleUnlocked(moduleId, state.research, content),
  );
  const hasInventoryUnits = Object.values(state.inventory.stacks).some(
    (stack) => stack.quantity > 0,
  );
  const hasOverclockableLiveModule = Object.values(state.facility.modules).some(
    (module) => content.modules[module.definitionId]?.overclockable === true,
  );
  const hasActiveInstance = Object.values(state.tasks.instances).some(
    (instance) =>
      instance.status === "accepted" || instance.status === "active" || instance.status === "hold",
  );
  const hasBlueprints = Object.keys(state.blueprints.records).length > 0;
  const canSaveBlueprint =
    draft === null &&
    context.selectedIds.length > 0 &&
    validateBlueprintCaptureSelection(state, content, context.selectedIds).length === 0;
  const blueprintFeatureUnlocked = isFeatureUnlocked(
    "subassembly-blueprints",
    state.research,
    content,
  );
  const hasEligibleBlueprint =
    draft !== null &&
    blueprintFeatureUnlocked &&
    Object.values(state.blueprints.records).some(
      (record) => validateCurrentBlueprintCapture(record, content, state.research).length === 0,
    );
  let canApplyDesign = false;
  if (draft !== null && rejectIfBenchmarkConfigurationLocked(state) === undefined) {
    try {
      const preview = calculateDesignApplyPreview(state, content);
      canApplyDesign =
        !isDesignApplyPreviewRejection(preview) && preview.netCostUsd <= state.economy.cashUsd;
    } catch {
      canApplyDesign = false;
    }
  }
  const hasPotentialOverclockTarget =
    hasOverclockableLiveModule &&
    draft === null &&
    rejectIfBenchmarkConfigurationLocked(state) === undefined;
  const hasPotentialTask = hasPotentialTaskAcceptance(state, content);
  const hasPotentialResearch = hasPotentialResearchStart(state, content);
  return {
    SET_PAUSED: true,
    SET_SPEED: true,
    ENTER_DESIGN_MODE: draft === null,
    BUY_MODULE: hasUnlockedModule,
    SELL_INVENTORY_ITEM: hasInventoryUnits,
    PLACE_MODULE: draft !== null,
    MOVE_MODULE: draft !== null,
    ROTATE_MODULE: draft !== null,
    REMOVE_MODULE: draft !== null,
    CONNECT_PORTS: draft !== null,
    DISCONNECT_ROUTE: draft !== null,
    UNDO_DESIGN: draft !== null && draft.undoStack.length > 0,
    REDO_DESIGN: draft !== null && draft.redoStack.length > 0,
    APPLY_DESIGN: canApplyDesign,
    CANCEL_DESIGN: draft !== null,
    ACCEPT_TASK: hasPotentialTask,
    ALLOCATE_TASK: hasActiveInstance && rejectIfBenchmarkConfigurationLocked(state) === undefined,
    SET_TASK_HOLD: hasActiveInstance && rejectIfBenchmarkConfigurationLocked(state) === undefined,
    ABANDON_TASK: hasActiveInstance,
    SET_OVERCLOCK_PROFILE: hasPotentialOverclockTarget,
    SET_MANUAL_OVERCLOCK: hasPotentialOverclockTarget,
    START_RESEARCH: hasPotentialResearch,
    CANCEL_RESEARCH: state.research.active !== null,
    SAVE_BLUEPRINT: canSaveBlueprint,
    INSTANTIATE_BLUEPRINT: draft !== null && blueprintFeatureUnlocked && hasEligibleBlueprint,
    RENAME_BLUEPRINT: hasBlueprints,
    START_BENCHMARK: hasPotentialBenchmarkStart(state, content),
    CANCEL_BENCHMARK: state.benchmarks.active !== null,
    ACKNOWLEDGE_TUTORIAL_STEP: state.tutorial.currentStepId !== null,
    SET_GUIDANCE_MODE: true,
  };
}

interface InspectedSelection {
  readonly view: InspectorViewModel;
  readonly taskBreakdown: Readonly<ComputeBreakdown> | undefined;
}

function emptyInspector(): InspectedSelection {
  return {
    view: {
      selectedEntityId: null,
      entityKind: null,
      titleKey: null,
      stats: [],
      computeBreakdown: null,
    },
    taskBreakdown: undefined,
  };
}

function parseTileSelection(entityId: string): { x: number; y: number } | null {
  const match = /^tile:(\d+):(\d+)$/.exec(entityId);
  if (match === null) return null;
  const x = Number.parseInt(match[1] ?? "", 10);
  const y = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return { x, y };
}

function projectInspector(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
  thermal: ThermalSummary,
): InspectedSelection {
  const entityId = context.inspectedEntityId;
  if (entityId === null) return emptyInspector();
  const facility = state.facility;
  const draft = facility.designDraft;

  const liveModule = facility.modules[entityId];
  const draftModule = draft?.modules[entityId];
  const module = liveModule ?? draftModule;
  if (module !== undefined) {
    const definition = content.modules[module.definitionId];
    if (definition === undefined) return emptyInspector();
    const stats: {
      labelKey: string;
      value: number | string;
      state?: "normal" | "warning" | "critical";
    }[] = [];
    const delivery = liveModule === undefined ? undefined : facility.power.byModule[entityId];
    if (delivery !== undefined) {
      stats.push({
        labelKey: "ui.power",
        value: delivery.deliveredPowerWatts,
        state:
          delivery.limitingReason === "none"
            ? "normal"
            : delivery.limitingReason === "shutdown"
              ? "critical"
              : "warning",
      });
    }
    const temperatureC =
      liveModule === undefined
        ? null
        : meanLiveModuleTemperatureC(liveModule, liveModule.definitionId, content, thermal);
    if (temperatureC !== null) {
      stats.push({ labelKey: "ui.temperature", value: temperatureC, state: "normal" });
    }
    const compute = liveModule === undefined ? undefined : facility.compute.byModule[entityId];
    if (compute !== undefined) {
      stats.push({ labelKey: "ui.useful-compute", value: compute.availableComputeFlops });
    }
    return {
      view: {
        selectedEntityId: entityId,
        entityKind: "module",
        titleKey: definition.nameKey,
        stats,
        computeBreakdown: null,
      },
      taskBreakdown: undefined,
    };
  }

  const route: Readonly<RouteState> | undefined =
    facility.routes[entityId] ?? draft?.routes[entityId];
  if (route !== undefined) {
    const delivery = route.kind === "power" ? facility.power.byRoute[entityId] : undefined;
    return {
      view: {
        selectedEntityId: entityId,
        entityKind: "route",
        titleKey: null,
        stats:
          delivery === undefined
            ? []
            : [{ labelKey: "ui.power", value: delivery.deliveredPowerWatts, state: "normal" }],
        computeBreakdown: null,
      },
      taskBreakdown: undefined,
    };
  }

  const task = state.tasks.instances[entityId];
  if (task !== undefined) {
    const definition = content.tasks[task.definitionId];
    if (definition === undefined) return emptyInspector();
    const breakdown = facility.compute.byTask[entityId]?.breakdown;
    return {
      view: {
        selectedEntityId: entityId,
        entityKind: "task",
        titleKey: definition.nameKey,
        stats: [{ labelKey: "ui.task-status", value: task.status }],
        computeBreakdown: breakdown === undefined ? null : copyBreakdown(breakdown),
      },
      taskBreakdown: breakdown,
    };
  }

  const tile = parseTileSelection(entityId);
  if (tile !== null) {
    if (
      tile.x < 0 ||
      tile.x >= facility.size.width ||
      tile.y < 0 ||
      tile.y >= facility.size.height
    ) {
      return emptyInspector();
    }
    return {
      view: {
        selectedEntityId: entityId,
        entityKind: "tile",
        titleKey: null,
        stats: [{ labelKey: "ui.temperature", value: thermal.at(tile.x, tile.y), state: "normal" }],
        computeBreakdown: null,
      },
      taskBreakdown: undefined,
    };
  }

  return emptyInspector();
}

export function projectUiSnapshot(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
): UiSnapshot {
  const facility = state.facility;
  const thermal = summarizeThermal(facility);
  const inspector = projectInspector(state, content, context, thermal);
  const snapshot = {
    revision: 0,
    tick: state.tick,
    header: {
      eraNameKey: content.era.nameKey,
      year: state.campaign.currentYear,
      objectiveKey: state.campaign.objectiveKey,
      paused: state.clock.paused,
      speed: state.clock.speed,
      cashUsd: state.economy.cashUsd,
      usefulComputeFlops: facility.compute.totalAllocatedUsefulComputeFlops,
      theoreticalComputeFlops: facility.compute.totalTheoreticalComputeFlops,
      powerDrawWatts: facility.power.totalDeliveredPowerWatts,
      powerCapacityWatts: facility.contractedPowerWatts,
      averageTemperatureC: thermal.meanTemperatureC,
      maxTemperatureC: thermal.maxTemperatureC,
    },
    tasks: projectTaskCards(state, content),
    alerts: [],
    telemetry: {
      memoryCapacityBytes: null,
      memoryUsedBytes: null,
      memoryBandwidthBytesPerSecond: null,
      memoryBandwidthUsedBytesPerSecond: null,
      researchData: state.research.researchData,
      reputation: state.campaign.reputation,
      retryRate: null,
      powerHeadroomWatts: facility.power.headroomWatts,
      bottleneck: selectBottleneck(inspector.taskBreakdown),
      seriesRevision: 0,
    },
    inspector: inspector.view,
    research: projectResearch(state, content),
    build: {
      designMode: facility.designDraft !== null,
      draftRevision: facility.designDraft?.revision ?? null,
      inventoryUnitCount: totalInventoryUnits(state),
      availableDefinitionIds: Object.keys(content.modules)
        .filter((moduleId) => isModuleUnlocked(moduleId, state.research, content))
        .toSorted(compareStableStrings),
    },
    tutorial: {
      currentStepId: state.tutorial.currentStepId,
      guidanceMode: state.tutorial.guidanceMode,
    },
    commandAvailability: projectCommandAvailability(state, content, context),
  };
  return freezeOwned(snapshot);
}

function projectGridViewModelWithResolver(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
  resolveRoutes: RouteIssueResolver,
): GridViewModel {
  const facility = state.facility;
  const draft = facility.designDraft;
  const mode: GridViewMode = draft === null ? "live" : "draft";
  // Physics always references live results, even in draft mode; only the
  // geometry (modules/routes) comes from the selected layout.
  const layout =
    draft === null ? facility : { ...facility, modules: draft.modules, routes: draft.routes };
  const thermal = summarizeThermal(facility);
  const routesWithIssues = resolveRoutes(layout, facility, content);
  const selected = new Set<string>(context.selectedIds);
  const grid = {
    revision: 0,
    mode,
    layoutRevision: draft === null ? facility.liveLayoutRevision : draft.revision,
    thermalRevision: facility.thermalRevision,
    gridSize: { width: facility.size.width, height: facility.size.height },
    modules: projectGridModules(layout, facility, content, thermal, routesWithIssues, selected),
    routes: projectGridRoutes(layout, selected),
    heatmap: null,
    placementPreview: null,
    diagnosticHighlights: [],
  };
  return registerProjectedGrid(freezeOwned(grid));
}

export function projectGridViewModel(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
): GridViewModel {
  return projectGridViewModelWithResolver(state, content, context, directRouteIssueResolver);
}

function projectPresentationWithResolver(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
  resolveRoutes: RouteIssueResolver,
  trustFrozenThermal: boolean,
): ProjectedPresentation {
  const snapshot = projectUiSnapshot(state, content, context);
  const grid = projectGridViewModelWithResolver(state, content, context, resolveRoutes);
  const draft = state.facility.designDraft;
  const thermalTiles =
    trustFrozenThermal && isRegisteredProjectedThermalTiles(state.facility.thermalTiles)
      ? state.facility.thermalTiles
      : freezeOwned(
          state.facility.thermalTiles.map((tile) => ({
            position: { x: tile.position.x, y: tile.position.y },
            temperatureC: tile.temperatureC,
          })),
        );
  return freezeOwned({
    snapshot,
    grid,
    thermalTiles,
    source: {
      liveLayoutRevision: state.facility.liveLayoutRevision,
      draftRevision: draft?.revision ?? null,
      thermalRevision: state.facility.thermalRevision,
      viewMode: draft === null ? "live" : "draft",
      width: state.facility.size.width,
      height: state.facility.size.height,
    },
  });
}

export function projectPresentation(
  state: Readonly<GameState>,
  content: ContentBundle,
  context: PresentationContext,
): ProjectedPresentation {
  return projectPresentationWithResolver(state, content, context, directRouteIssueResolver, false);
}

export interface PresentationProjector {
  projectPresentation(
    state: Readonly<GameState>,
    content: ContentBundle,
    context: PresentationContext,
  ): ProjectedPresentation;
}

export function createPresentationProjector(): PresentationProjector {
  const resolveRoutes = createRouteIssueResolver();
  return Object.freeze({
    projectPresentation: (
      state: Readonly<GameState>,
      content: ContentBundle,
      context: PresentationContext,
    ) => projectPresentationWithResolver(state, content, context, resolveRoutes, true),
  });
}
