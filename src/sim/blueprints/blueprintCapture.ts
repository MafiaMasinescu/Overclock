import type {
  ContentBundle,
  DeepReadonly,
  ModuleDefinition,
} from "../../content/schemas/contentSchemas.ts";
import {
  enumerateOccupiedTiles,
  isGridPointInBounds,
  isValidFacilitySize,
} from "../../grid/domain/footprintGeometry.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type {
  BlueprintModule,
  BlueprintRecord,
  BlueprintRoute,
  GameState,
  GridPoint,
  ModuleInstanceState,
  ResearchState,
  Size2D,
} from "../core/types.ts";
import { addMicrodollars, microdollarsToUsd, usdToMicrodollars } from "../economy/money.ts";
import { isFeatureUnlocked, isModuleUnlocked } from "../research/researchDomain.ts";
import { buildOccupancyIndex } from "../../grid/domain/occupancy.ts";
import { resolveManualRouteEndpoints, validateManualRoutePath } from "../routing/manualRouting.ts";
import {
  calculateEffectiveFullLoadPowerWatts,
  calculateModuleDynamicPowerFactor,
} from "../overclock/overclockDomain.ts";
import {
  formatBlueprintLocalModuleId,
  formatBlueprintLocalRouteId,
  validateBlueprintState,
} from "./blueprintState.ts";

export type BlueprintCapturePayload = Omit<BlueprintRecord, "id" | "name">;
export type BlueprintSummary = BlueprintRecord["summary"];

export type BlueprintCaptureSelectionIssueCode =
  | "ACTIVE_DESIGN_MODE"
  | "EMPTY_SELECTION"
  | "DUPLICATE_SELECTION"
  | "MISSING_MODULE"
  | "MISSING_MODULE_DEFINITION"
  | "FEATURE_LOCKED"
  | "MODULE_LOCKED"
  | "RESEARCH_NOT_COMPLETED";

export interface BlueprintCaptureSelectionIssue {
  readonly path: string;
  readonly code: BlueprintCaptureSelectionIssueCode;
  readonly message: string;
}

export interface BlueprintCaptureContentIssue {
  readonly path: string;
  readonly message: string;
}

export class BlueprintCaptureSelectionError extends Error {
  readonly issues: readonly BlueprintCaptureSelectionIssue[];

  constructor(issues: readonly BlueprintCaptureSelectionIssue[]) {
    super("Blueprint capture selection is invalid.");
    this.name = "BlueprintCaptureSelectionError";
    this.issues = issues;
  }
}

export class BlueprintCaptureContentError extends Error {
  readonly issues: readonly BlueprintCaptureContentIssue[];

  constructor(issues: readonly BlueprintCaptureContentIssue[]) {
    super("Blueprint capture content is invalid.");
    this.name = "BlueprintCaptureContentError";
    this.issues = issues;
  }
}

interface SelectedModule {
  readonly facilityModuleId: string;
  readonly module: Readonly<ModuleInstanceState>;
  readonly definition: DeepReadonly<ModuleDefinition>;
}

interface CanonicalRouteCandidate {
  readonly route: BlueprintRoute;
  readonly endpointIdentity: string;
}

interface CaptureGeometry {
  readonly origin: GridPoint;
  readonly bounds: Size2D;
}

function issue(
  path: string,
  code: BlueprintCaptureSelectionIssueCode,
  message: string,
): BlueprintCaptureSelectionIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function comparePoints(left: GridPoint, right: GridPoint): number {
  return left.y - right.y || left.x - right.x;
}

function comparePath(left: readonly GridPoint[], right: readonly GridPoint[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftPoint = left[index];
    const rightPoint = right[index];
    if (leftPoint === undefined || rightPoint === undefined) continue;
    const comparison = comparePoints(leftPoint, rightPoint);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function assertFinite(value: number, description: string): void {
  if (!Number.isFinite(value) || Object.is(value, -0)) {
    throw new RangeError(`${description} must be finite and not negative zero.`);
  }
}

function assertFiniteNonnegative(value: number, description: string): void {
  assertFinite(value, description);
  if (value < 0) throw new RangeError(`${description} must be nonnegative.`);
}

function addFinite(left: number, right: number, description: string): number {
  const result = left + right;
  assertFiniteNonnegative(result, description);
  return result === 0 ? 0 : result;
}

function sortedFeatureResearchIds(content: ContentBundle): readonly string[] {
  return Object.values(content.research)
    .filter((node) => node.unlockFeatureIds.includes("subassembly-blueprints"))
    .map((node) => node.id)
    .toSorted(compareStableStrings);
}

function captureResearchIds(
  selectedModules: readonly SelectedModule[],
  content: ContentBundle,
): string[] {
  const ids = new Set<string>(sortedFeatureResearchIds(content));
  for (const { definition } of selectedModules) {
    for (const researchId of definition.unlockResearchIds) ids.add(researchId);
  }
  return [...ids].toSorted(compareStableStrings);
}

function validateSelectedModuleIds(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): BlueprintCaptureSelectionIssue[] {
  const issues: BlueprintCaptureSelectionIssue[] = [];
  const selection = Array.isArray(selectedModuleIds) ? selectedModuleIds : [];
  if (state.facility.designDraft !== null) {
    issues.push(
      issue(
        "facility.designDraft",
        "ACTIVE_DESIGN_MODE",
        "Blueprint capture requires no active Design Mode draft.",
      ),
    );
  }
  if (selection.length === 0) {
    issues.push(
      issue(
        "selectedModuleIds",
        "EMPTY_SELECTION",
        "Blueprint capture requires a non-empty selection.",
      ),
    );
  }

  const seen = new Set<string>();
  for (const [index, moduleId] of selection.entries()) {
    const path = `selectedModuleIds[${index}]`;
    if (typeof moduleId !== "string" || moduleId.length === 0) {
      issues.push(issue(path, "MISSING_MODULE", "Selected module ID must be a nonempty string."));
      continue;
    }
    if (seen.has(moduleId)) {
      issues.push(issue(path, "DUPLICATE_SELECTION", "Selected module IDs must be unique."));
      continue;
    }
    seen.add(moduleId);
    const module = state.facility.modules[moduleId];
    if (module?.id !== moduleId) {
      issues.push(
        issue(path, "MISSING_MODULE", "Selected module must exist in the live facility."),
      );
      continue;
    }
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      issues.push(
        issue(
          `${path}.definitionId`,
          "MISSING_MODULE_DEFINITION",
          `Selected module definition ${module.definitionId} is missing from current content.`,
        ),
      );
      continue;
    }
    if (!isModuleUnlocked(module.definitionId, state.research, content)) {
      issues.push(
        issue(
          `${path}.definitionId`,
          "MODULE_LOCKED",
          `Selected module definition ${module.definitionId} is not currently unlocked.`,
        ),
      );
    }
  }

  const featureResearchIds = sortedFeatureResearchIds(content);
  if (
    featureResearchIds.length === 0 ||
    !isFeatureUnlocked("subassembly-blueprints", state.research, content)
  ) {
    issues.push(
      issue(
        "research.statuses",
        "FEATURE_LOCKED",
        "Research feature subassembly-blueprints must be unlocked.",
      ),
    );
  }
  for (const researchId of featureResearchIds) {
    if (state.research.statuses[researchId] !== "completed") {
      issues.push(
        issue(
          `research.statuses.${researchId}`,
          "RESEARCH_NOT_COMPLETED",
          `Research node ${researchId} must be completed before capture.`,
        ),
      );
    }
  }
  return issues;
}

export function validateBlueprintCaptureSelection(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): readonly BlueprintCaptureSelectionIssue[] {
  return validateSelectedModuleIds(state, content, selectedModuleIds);
}

export function assertValidBlueprintCaptureSelection(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): void {
  const issues = validateBlueprintCaptureSelection(state, content, selectedModuleIds);
  if (issues.length > 0) throw new BlueprintCaptureSelectionError(issues);
}

function resolveSelectedModules(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): readonly SelectedModule[] {
  assertValidBlueprintCaptureSelection(state, content, selectedModuleIds);
  return selectedModuleIds
    .map((facilityModuleId) => {
      const module = state.facility.modules[facilityModuleId];
      if (module?.id !== facilityModuleId) {
        throw new Error("Validated Blueprint selection module coverage is incomplete.");
      }
      const definition = content.modules[module.definitionId];
      if (definition === undefined) {
        throw new Error("Validated Blueprint selection definition coverage is incomplete.");
      }
      return { facilityModuleId, module, definition };
    })
    .toSorted(
      (left, right) =>
        comparePoints(left.module.position, right.module.position) ||
        compareStableStrings(left.definition.id, right.definition.id) ||
        compareStableStrings(left.facilityModuleId, right.facilityModuleId),
    );
}

function assertFacilityPoint(point: GridPoint, facilitySize: Size2D, description: string): void {
  if (!isGridPointInBounds(point, facilitySize)) {
    throw new RangeError(`${description} must fit the live facility bounds.`);
  }
}

function calculateCaptureGeometry(
  selectedModules: readonly SelectedModule[],
  routes: readonly Pick<BlueprintRoute, "relativePath">[],
  facilitySize: Size2D,
): CaptureGeometry {
  if (!isValidFacilitySize(facilitySize)) {
    throw new RangeError("Live facility size must contain positive safe integer dimensions.");
  }
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  const include = (point: GridPoint, description: string): void => {
    assertFacilityPoint(point, facilitySize, description);
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  };

  for (const { facilityModuleId, module, definition } of selectedModules) {
    const occupiedTiles = enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    );
    if (occupiedTiles.length === 0) {
      throw new Error(`Selected module ${facilityModuleId} has no occupied footprint tiles.`);
    }
    for (const tile of occupiedTiles) include(tile, `Module ${facilityModuleId} footprint tile`);
  }
  for (const route of routes) {
    for (const point of route.relativePath) include(point, "Route path point");
  }

  if (!Number.isFinite(minimumX) || !Number.isFinite(minimumY)) {
    throw new Error("Blueprint capture geometry requires at least one selected module.");
  }
  const width = maximumX - minimumX + 1;
  const height = maximumY - minimumY + 1;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("Blueprint capture bounds must be positive safe integers.");
  }
  return {
    origin: { x: minimumX, y: minimumY },
    bounds: { width, height },
  };
}

function localModuleIdByFacilityId(
  selectedModules: readonly SelectedModule[],
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [index, selected] of selectedModules.entries()) {
    result[selected.facilityModuleId] = formatBlueprintLocalModuleId(index + 1);
  }
  return result;
}

function mappedModule(selected: SelectedModule, localId: string): ModuleInstanceState {
  return {
    ...selected.module,
    id: localId,
    position: { ...selected.module.position },
    overclock: { ...selected.module.overclock },
  };
}

function canonicalEndpointIdentity(route: BlueprintRoute): string {
  return [route.fromLocalModuleId, route.fromPortId, route.toLocalModuleId, route.toPortId].join(
    "\u0000",
  );
}

function captureInternalRoutes(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModules: readonly SelectedModule[],
  localIds: Readonly<Record<string, string>>,
): BlueprintRoute[] {
  const selectedIds = new Set(selectedModules.map(({ facilityModuleId }) => facilityModuleId));
  const mappedModules: Record<string, ModuleInstanceState> = {};
  for (const selected of selectedModules) {
    const localId = localIds[selected.facilityModuleId];
    if (localId === undefined) throw new Error("Validated local module ID coverage is incomplete.");
    mappedModules[localId] = mappedModule(selected, localId);
  }

  const captured: CanonicalRouteCandidate[] = [];
  const occupancy = buildOccupancyIndex({ modules: mappedModules, content });
  if (occupancy.issues.length > 0) {
    throw new Error("Internal Blueprint route validation requires valid module occupancy.");
  }
  for (const [, route] of Object.entries(state.facility.routes).toSorted(([left], [right]) =>
    compareStableStrings(left, right),
  )) {
    if (
      !selectedIds.has(route.from.moduleInstanceId) ||
      !selectedIds.has(route.to.moduleInstanceId)
    ) {
      continue;
    }
    const fromLocalModuleId = localIds[route.from.moduleInstanceId];
    const toLocalModuleId = localIds[route.to.moduleInstanceId];
    if (fromLocalModuleId === undefined || toLocalModuleId === undefined) {
      throw new Error("Internal route endpoint does not have a local module ID.");
    }
    const mappedFrom = { moduleInstanceId: fromLocalModuleId, portId: route.from.portId };
    const mappedTo = { moduleInstanceId: toLocalModuleId, portId: route.to.portId };
    const endpoints = resolveManualRouteEndpoints(
      { modules: mappedModules },
      content,
      mappedFrom,
      mappedTo,
    );
    if ("code" in endpoints) {
      throw new Error(`Internal Blueprint route endpoint is invalid: ${endpoints.code}.`);
    }
    if (endpoints.kind !== route.kind) {
      throw new Error("Internal Blueprint route kind does not match its current endpoints.");
    }
    const relativePath = endpoints.reverseSubmittedPath ? route.path.toReversed() : [...route.path];
    const pathFailure = validateManualRoutePath(
      { size: state.facility.size, modules: mappedModules },
      content,
      endpoints.from,
      endpoints.to,
      relativePath,
    );
    if (pathFailure !== null) {
      throw new Error(`Internal Blueprint route path is invalid: ${pathFailure.reason}.`);
    }
    const candidate: BlueprintRoute = {
      localId: "",
      kind: endpoints.kind,
      fromLocalModuleId: endpoints.from.moduleInstanceId,
      fromPortId: endpoints.from.portId,
      toLocalModuleId: endpoints.to.moduleInstanceId,
      toPortId: endpoints.to.portId,
      relativePath,
    };
    captured.push({ route: candidate, endpointIdentity: canonicalEndpointIdentity(candidate) });
  }

  captured.sort(
    (left, right) =>
      compareStableStrings(left.endpointIdentity, right.endpointIdentity) ||
      compareStableStrings(left.route.kind, right.route.kind) ||
      comparePath(left.route.relativePath, right.route.relativePath),
  );
  return captured.map(({ route }, index) => ({
    ...route,
    localId: formatBlueprintLocalRouteId(index + 1),
    relativePath: route.relativePath.map((point) => ({ ...point })),
  }));
}

function translatePoint(point: GridPoint, origin: GridPoint): GridPoint {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function canonicalModules(
  selectedModules: readonly SelectedModule[],
  localIds: Readonly<Record<string, string>>,
  origin: GridPoint,
): BlueprintModule[] {
  return selectedModules.map(({ facilityModuleId, module }) => {
    const localId = localIds[facilityModuleId];
    if (localId === undefined) throw new Error("Validated local module ID coverage is incomplete.");
    return {
      localId,
      definitionId: module.definitionId,
      relativePosition: translatePoint(module.position, origin),
      rotation: module.rotation,
      defaultOverclock: { ...module.overclock },
    };
  });
}

function thermalTemperatureAt(state: Readonly<GameState>, point: GridPoint): number {
  const index = point.y * state.facility.size.width + point.x;
  if (
    index < 0 ||
    index >= state.facility.thermalTiles.length ||
    !Object.hasOwn(state.facility.thermalTiles, index)
  ) {
    throw new Error(`Missing finite thermal observation at ${point.x},${point.y}.`);
  }
  const tile = state.facility.thermalTiles[index];
  if (tile === undefined) {
    throw new Error(`Missing finite thermal observation at ${point.x},${point.y}.`);
  }
  if (
    tile.position.x !== point.x ||
    tile.position.y !== point.y ||
    !Number.isFinite(tile.temperatureC) ||
    Object.is(tile.temperatureC, -0)
  ) {
    throw new Error(`Missing finite thermal observation at ${point.x},${point.y}.`);
  }
  return tile.temperatureC;
}

function calculateObservedMaximumTemperature(
  state: Readonly<GameState>,
  selectedModules: readonly SelectedModule[],
): number {
  const occupied = new Map<string, GridPoint>();
  for (const { module, definition } of selectedModules) {
    for (const point of enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    )) {
      occupied.set(`${point.x},${point.y}`, point);
    }
  }
  let maximumTemperatureC = Number.NEGATIVE_INFINITY;
  for (const point of occupied.values()) {
    maximumTemperatureC = Math.max(maximumTemperatureC, thermalTemperatureAt(state, point));
  }
  assertFiniteNonnegative(maximumTemperatureC, "Observed maximum temperature");
  return maximumTemperatureC === 0 ? 0 : maximumTemperatureC;
}

function calculateSummaryFromSelectedModules(
  state: Readonly<GameState>,
  selectedModules: readonly SelectedModule[],
): BlueprintSummary {
  let theoreticalComputeFlops = 0;
  let peakPowerWatts = 0;
  let estimatedCostMicrodollars = 0;
  for (const { module, definition } of selectedModules) {
    const frequency = module.overclock.frequencyRatio;
    assertFiniteNonnegative(definition.baseComputeFlops, `Base Compute for ${definition.id}`);
    assertFiniteNonnegative(frequency, `Frequency for ${module.id}`);
    theoreticalComputeFlops = addFinite(
      theoreticalComputeFlops,
      definition.baseComputeFlops * frequency,
      "Theoretical Compute summary",
    );

    const dynamicPowerFactor = calculateModuleDynamicPowerFactor(definition, module.overclock);
    const effectiveFullLoadPowerWatts = calculateEffectiveFullLoadPowerWatts(
      definition,
      1,
      dynamicPowerFactor,
    );
    peakPowerWatts = addFinite(peakPowerWatts, effectiveFullLoadPowerWatts, "Peak Power summary");

    estimatedCostMicrodollars = addMicrodollars(
      estimatedCostMicrodollars,
      usdToMicrodollars(definition.priceUsd),
    );
  }
  return {
    theoreticalComputeFlops,
    peakPowerWatts,
    estimatedMaxTemperatureC: calculateObservedMaximumTemperature(state, selectedModules),
    estimatedCostUsd: microdollarsToUsd(estimatedCostMicrodollars),
  };
}

export function calculateCanonicalBlueprintSummary(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): BlueprintSummary {
  const selectedModules = resolveSelectedModules(state, content, selectedModuleIds);
  return calculateSummaryFromSelectedModules(state, selectedModules);
}

export function captureCanonicalBlueprintPayload(
  state: Readonly<GameState>,
  content: ContentBundle,
  selectedModuleIds: readonly string[],
): BlueprintCapturePayload {
  const selectedModules = resolveSelectedModules(state, content, selectedModuleIds);
  const localIds = localModuleIdByFacilityId(selectedModules);
  const internalRoutes = captureInternalRoutes(state, content, selectedModules, localIds);
  const geometry = calculateCaptureGeometry(selectedModules, internalRoutes, state.facility.size);
  const routes = internalRoutes.map((route) => ({
    ...route,
    relativePath: route.relativePath.map((point) => translatePoint(point, geometry.origin)),
  }));
  const modules = canonicalModules(selectedModules, localIds, geometry.origin);
  return {
    kind: "subassembly",
    version: 1,
    contentVersion: content.contentVersion,
    modules,
    routes,
    requiredResearchIds: captureResearchIds(selectedModules, content),
    bounds: geometry.bounds,
    summary: calculateSummaryFromSelectedModules(state, selectedModules),
  };
}

function pushContentIssue(
  issues: BlueprintCaptureContentIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function structuralCaptureIssues(value: unknown): BlueprintCaptureContentIssue[] {
  if (!isRecord(value)) {
    return [{ path: "capture", message: "must be a plain object." }];
  }
  const captureKeys = [
    "bounds",
    "contentVersion",
    "kind",
    "modules",
    "requiredResearchIds",
    "routes",
    "summary",
    "version",
  ];
  const actualKeys = Object.keys(value).toSorted(compareStableStrings);
  const issues: BlueprintCaptureContentIssue[] = [];
  if (
    actualKeys.length !== captureKeys.length ||
    actualKeys.some((key, index) => key !== captureKeys[index])
  ) {
    issues.push({ path: "capture", message: "has an invalid exact shape." });
  }
  const syntheticRecord = {
    ...value,
    id: "blueprint-00000001",
    name: "Current capture",
  };
  issues.push(
    ...validateBlueprintState({
      records: { "blueprint-00000001": syntheticRecord },
      nextBlueprintSequence: 2,
    }).map(({ path, message }) => ({
      path: path.replace("blueprints.records.blueprint-00000001", "capture"),
      message,
    })),
  );
  return issues;
}

function moduleForCurrentValidation(module: BlueprintModule): ModuleInstanceState {
  return {
    id: module.localId,
    definitionId: module.definitionId,
    position: { ...module.relativePosition },
    rotation: module.rotation,
    operationalState: "offline",
    overclock: { ...module.defaultOverclock },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateCurrentBlueprintCapture(
  value: unknown,
  content: ContentBundle,
  research: Readonly<ResearchState>,
): readonly BlueprintCaptureContentIssue[] {
  const issues = structuralCaptureIssues(value);
  if (!isRecord(value)) return issues;

  const contentVersion = value["contentVersion"];
  pushContentIssue(
    issues,
    contentVersion !== content.contentVersion,
    "capture.contentVersion",
    "must equal the current content version for a current capture.",
  );
  pushContentIssue(
    issues,
    value["kind"] !== "subassembly" || value["version"] !== 1,
    "capture.kind",
    "current captures must be subassembly version 1.",
  );

  const modulesValue = value["modules"];
  const moduleById: Record<string, ModuleInstanceState> = {};
  if (Array.isArray(modulesValue)) {
    for (const [index, candidate] of modulesValue.entries()) {
      if (!isRecord(candidate)) continue;
      const definitionId = candidate["definitionId"];
      const definition =
        typeof definitionId === "string" ? content.modules[definitionId] : undefined;
      pushContentIssue(
        issues,
        definition === undefined,
        `capture.modules[${index}].definitionId`,
        "must reference a current module definition.",
      );
      const localId = candidate["localId"];
      if (typeof localId !== "string") continue;
      const module = candidate as unknown as BlueprintModule;
      moduleById[localId] = moduleForCurrentValidation(module);
      if (definition !== undefined) {
        try {
          calculateModuleDynamicPowerFactor(definition, module.defaultOverclock);
        } catch {
          issues.push({
            path: `capture.modules[${index}].defaultOverclock`,
            message: "must be valid for the current module definition.",
          });
        }
      }
    }
  }

  const occupancy = buildOccupancyIndex({ modules: moduleById, content });
  if (occupancy.issues.length > 0) {
    issues.push({ path: "capture.modules", message: "must have valid current module occupancy." });
  }

  const requiredResearchIds = value["requiredResearchIds"];
  const expectedResearchIds = new Set<string>(sortedFeatureResearchIds(content));
  if (Array.isArray(modulesValue)) {
    for (const candidate of modulesValue) {
      if (!isRecord(candidate) || typeof candidate["definitionId"] !== "string") continue;
      const definition = content.modules[candidate["definitionId"]];
      if (definition !== undefined) {
        for (const researchId of definition.unlockResearchIds) expectedResearchIds.add(researchId);
      }
    }
  }
  const sortedExpectedResearchIds = [...expectedResearchIds].toSorted(compareStableStrings);
  if (Array.isArray(requiredResearchIds)) {
    pushContentIssue(
      issues,
      !sameStringArray(requiredResearchIds, sortedExpectedResearchIds),
      "capture.requiredResearchIds",
      "must equal the current module and feature Research requirement union.",
    );
    for (const [index, researchId] of requiredResearchIds.entries()) {
      if (typeof researchId !== "string") continue;
      pushContentIssue(
        issues,
        content.research[researchId] === undefined,
        `capture.requiredResearchIds[${index}]`,
        "must reference a current Research node.",
      );
      pushContentIssue(
        issues,
        research.statuses[researchId] !== "completed",
        `research.statuses.${researchId}`,
        "must be completed for a current capture.",
      );
    }
  }

  const boundsValue = value["bounds"];
  const routesValue = value["routes"];
  if (
    isRecord(boundsValue) &&
    typeof boundsValue["width"] === "number" &&
    typeof boundsValue["height"] === "number" &&
    Array.isArray(routesValue)
  ) {
    const size = { width: boundsValue["width"], height: boundsValue["height"] };
    for (const [index, candidate] of routesValue.entries()) {
      if (!isRecord(candidate)) continue;
      const localId = candidate["localId"];
      const fromLocalModuleId = candidate["fromLocalModuleId"];
      const toLocalModuleId = candidate["toLocalModuleId"];
      const fromPortId = candidate["fromPortId"];
      const toPortId = candidate["toPortId"];
      if (
        typeof localId !== "string" ||
        typeof fromLocalModuleId !== "string" ||
        typeof toLocalModuleId !== "string" ||
        typeof fromPortId !== "string" ||
        typeof toPortId !== "string" ||
        !Array.isArray(candidate["relativePath"])
      ) {
        continue;
      }
      const from = moduleById[fromLocalModuleId];
      const to = moduleById[toLocalModuleId];
      if (from === undefined || to === undefined) continue;
      const endpoints = resolveManualRouteEndpoints(
        { modules: moduleById },
        content,
        { moduleInstanceId: fromLocalModuleId, portId: fromPortId },
        { moduleInstanceId: toLocalModuleId, portId: toPortId },
      );
      if ("code" in endpoints) {
        issues.push({
          path: `capture.routes[${index}]`,
          message: "must reference compatible current module ports.",
        });
        continue;
      }
      pushContentIssue(
        issues,
        candidate["kind"] !== endpoints.kind,
        `capture.routes[${index}].kind`,
        "must match current endpoint compatibility.",
      );
      if (
        endpoints.from.moduleInstanceId !== fromLocalModuleId ||
        endpoints.from.portId !== fromPortId ||
        endpoints.to.moduleInstanceId !== toLocalModuleId ||
        endpoints.to.portId !== toPortId
      ) {
        issues.push({
          path: `capture.routes[${index}]`,
          message: "must use current canonical endpoint direction.",
        });
      }
      const path = candidate["relativePath"] as GridPoint[];
      const pathFailure = validateManualRoutePath(
        { size, modules: moduleById },
        content,
        endpoints.from,
        endpoints.to,
        path,
      );
      pushContentIssue(
        issues,
        pathFailure !== null,
        `capture.routes[${index}].relativePath`,
        "must be a valid current route path.",
      );
    }
  }
  return issues;
}

export function assertValidCurrentBlueprintCapture(
  value: unknown,
  content: ContentBundle,
  research: Readonly<ResearchState>,
): asserts value is BlueprintCapturePayload {
  const issues = validateCurrentBlueprintCapture(value, content, research);
  if (issues.length > 0) {
    throw new BlueprintCaptureContentError(issues);
  }
}
