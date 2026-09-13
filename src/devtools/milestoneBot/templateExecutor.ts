import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { calculateDesignApplyPreview } from "../../sim/design/designApplyPreview.ts";
import { isFeatureUnlocked, isModuleUnlocked } from "../../sim/research/researchDomain.ts";
import type { GameState, ModuleInstanceId, RouteId } from "../../sim/core/types.ts";
import type { ReplayCommandDriver } from "./replayCommandDriver.ts";
import { getBuildTemplate, resolveBuildTemplateChain } from "./buildTemplates.ts";
import type { BuildTemplate, BuildTemplateModule, BuildTemplateRoute } from "./botContracts.ts";
import { assertValidBuildTemplates } from "./buildTemplateValidation.ts";

export type MilestoneTemplateId = BuildTemplate["id"];

export class TemplateExecutionError extends Error {
  readonly templateId: MilestoneTemplateId;
  readonly reason: string;

  constructor(templateId: MilestoneTemplateId, reason: string) {
    super(`Template ${templateId} could not be executed: ${reason}`);
    this.name = "TemplateExecutionError";
    this.templateId = templateId;
    this.reason = reason;
  }
}

export interface TemplateExecutionResult {
  readonly templateId: MilestoneTemplateId;
  readonly addedModuleIds: readonly ModuleInstanceId[];
  readonly addedRouteIds: readonly RouteId[];
  readonly moduleMapping: Readonly<Record<string, ModuleInstanceId>>;
  readonly draftRevision: number;
  readonly netCostUsd: number;
  readonly downtimeTicks: number;
}

export interface TemplateExecutor {
  readonly applyTemplate: (templateId: MilestoneTemplateId) => TemplateExecutionResult;
  readonly getAppliedTemplateIds: () => readonly MilestoneTemplateId[];
  readonly getModuleMapping: () => Readonly<Record<string, ModuleInstanceId>>;
  readonly resolveBlueprintSelection: (
    templateId?: MilestoneTemplateId,
  ) => readonly ModuleInstanceId[];
  readonly resolveClusterRole: (
    templateId: MilestoneTemplateId,
    role: keyof BuildTemplate["clusterRoles"],
  ) => readonly ModuleInstanceId[];
}

function stateOf(driver: ReplayCommandDriver): GameState {
  return driver.getDetachedState();
}

function sortedDefinitionIds(
  content: ContentBundle,
  counts: Readonly<Record<string, number>>,
): readonly string[] {
  return Object.keys(counts).toSorted((left, right) => {
    const leftDefinition = content.modules[left];
    const rightDefinition = content.modules[right];
    return (
      (leftDefinition?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (rightDefinition?.sortOrder ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right)
    );
  });
}

function countTemplateModules(
  modules: readonly BuildTemplateModule[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const module of modules)
    counts[module.definitionId] = (counts[module.definitionId] ?? 0) + 1;
  return counts;
}

function requireResearch(template: BuildTemplate, state: GameState): void {
  for (const researchId of template.requiredResearchIds) {
    if (state.research.statuses[researchId] !== "completed") {
      throw new TemplateExecutionError(template.id, `research-required:${researchId}`);
    }
  }
}

function requireTemplateChain(
  template: BuildTemplate,
  applied: readonly MilestoneTemplateId[],
): void {
  const appliedSet = new Set(applied);
  for (const chainTemplate of resolveBuildTemplateChain(template.id)) {
    if (chainTemplate.id !== template.id && !appliedSet.has(chainTemplate.id)) {
      throw new TemplateExecutionError(template.id, `base-template-required:${chainTemplate.id}`);
    }
  }
}

function assertNoActiveDesignOrBenchmark(templateId: MilestoneTemplateId, state: GameState): void {
  if (state.facility.designDraft !== null) {
    throw new TemplateExecutionError(templateId, "design-mode-already-active");
  }
  if (state.benchmarks.active !== null) {
    throw new TemplateExecutionError(templateId, "benchmark-active");
  }
}

function submitBuyShortfall(
  driver: ReplayCommandDriver,
  content: ContentBundle,
  state: GameState,
  modules: readonly BuildTemplateModule[],
): void {
  const counts = countTemplateModules(modules);
  for (const definitionId of sortedDefinitionIds(content, counts)) {
    const required = counts[definitionId] ?? 0;
    const available = state.inventory.stacks[definitionId]?.quantity ?? 0;
    const shortfall = required - available;
    if (shortfall <= 0) continue;
    driver.submitGameplayCommand({
      kind: "BUY_MODULE",
      definitionId,
      quantity: shortfall,
    });
  }
}

function keysOf<T>(record: Readonly<Record<string, T>>): readonly string[] {
  return Object.keys(record).toSorted();
}

function freshKey(before: readonly string[], after: readonly string[], label: string): string {
  const previous = new Set(before);
  const additions = after.filter((key) => !previous.has(key));
  if (additions.length !== 1 || additions[0] === undefined) {
    throw new Error(`Expected exactly one fresh ${label} ID.`);
  }
  return additions[0];
}

function executeModule(
  driver: ReplayCommandDriver,
  module: BuildTemplateModule,
  mapping: Readonly<Record<string, ModuleInstanceId>>,
): ModuleInstanceId {
  const before = stateOf(driver).facility.designDraft;
  if (before === null) throw new Error("Template placement requires an active Design Mode draft.");
  const beforeKeys = keysOf(before.modules);
  driver.submitGameplayCommand({
    kind: "PLACE_MODULE",
    definitionId: module.definitionId,
    position: { ...module.position },
    rotation: module.rotation,
  });
  const after = stateOf(driver).facility.designDraft;
  if (after === null) throw new Error("Placement unexpectedly left Design Mode.");
  const id = freshKey(beforeKeys, keysOf(after.modules), "module");
  const created = after.modules[id];
  if (created === undefined) throw new Error(`Fresh module mapping is missing for ${module.key}.`);
  if (
    created.definitionId !== module.definitionId ||
    created.position.x !== module.position.x ||
    created.position.y !== module.position.y ||
    created.rotation !== module.rotation ||
    Object.hasOwn(mapping, module.key)
  ) {
    throw new Error(`Fresh module mapping is invalid for ${module.key}.`);
  }
  return id;
}

function mappedRouteEndpoint(
  endpoint: BuildTemplateRoute["from"],
  mapping: Readonly<Record<string, ModuleInstanceId>>,
): { moduleInstanceId: ModuleInstanceId; portId: string } {
  const moduleInstanceId = mapping[endpoint.moduleKey];
  if (moduleInstanceId === undefined)
    throw new Error(`Missing module mapping: ${endpoint.moduleKey}.`);
  return { moduleInstanceId, portId: endpoint.portId };
}

function executeRoute(
  driver: ReplayCommandDriver,
  route: BuildTemplateRoute,
  mapping: Readonly<Record<string, ModuleInstanceId>>,
): RouteId {
  const before = stateOf(driver).facility.designDraft;
  if (before === null) throw new Error("Template routing requires an active Design Mode draft.");
  const beforeKeys = keysOf(before.routes);
  const from = mappedRouteEndpoint(route.from, mapping);
  const to = mappedRouteEndpoint(route.to, mapping);
  driver.submitGameplayCommand({
    kind: "CONNECT_PORTS",
    from,
    to,
    path: route.path.map((point) => ({ ...point })),
  });
  const after = stateOf(driver).facility.designDraft;
  if (after === null) throw new Error("Routing unexpectedly left Design Mode.");
  const id = freshKey(beforeKeys, keysOf(after.routes), "route");
  const created = after.routes[id];
  if (created === undefined) throw new Error(`Fresh route mapping is missing for ${route.key}.`);
  if (
    created.kind !== route.kind ||
    (!Object.is(created.from.moduleInstanceId, from.moduleInstanceId) &&
      !Object.is(created.from.moduleInstanceId, to.moduleInstanceId)) ||
    created.path.length !== route.path.length
  ) {
    throw new Error(`Fresh route mapping is invalid for ${route.key}.`);
  }
  return id;
}

function mapRoles(
  templateId: MilestoneTemplateId,
  mapping: Readonly<Record<string, ModuleInstanceId>>,
  role: keyof BuildTemplate["clusterRoles"],
): readonly ModuleInstanceId[] {
  const template = getBuildTemplate(templateId);
  if (template === undefined) throw new Error(`Unknown template: ${templateId}.`);
  const ids = template.clusterRoles[role].map((key) => mapping[key]);
  if (ids.some((id) => id === undefined)) throw new Error(`Missing role mapping for ${role}.`);
  return Object.freeze(ids as ModuleInstanceId[]);
}

export function createTemplateExecutor({
  content,
  driver,
}: {
  readonly content: ContentBundle;
  readonly driver: ReplayCommandDriver;
}): TemplateExecutor {
  assertValidBuildTemplates(content);
  const appliedTemplateIds: MilestoneTemplateId[] = [];
  let moduleMapping: Readonly<Record<string, ModuleInstanceId>> = Object.freeze({});

  const applyTemplate = (templateId: MilestoneTemplateId): TemplateExecutionResult => {
    const template = getBuildTemplate(templateId);
    if (template === undefined) throw new TemplateExecutionError(templateId, "unknown-template");
    if (appliedTemplateIds.includes(templateId)) {
      throw new TemplateExecutionError(templateId, "template-already-applied");
    }
    requireTemplateChain(template, appliedTemplateIds);
    const before = stateOf(driver);
    assertNoActiveDesignOrBenchmark(templateId, before);
    requireResearch(template, before);
    for (const module of template.modules) {
      if (!isModuleUnlocked(module.definitionId, before.research, content)) {
        throw new TemplateExecutionError(templateId, `module-locked:${module.definitionId}`);
      }
    }
    submitBuyShortfall(driver, content, before, template.modules);
    driver.submitGameplayCommand({ kind: "ENTER_DESIGN_MODE" });

    const addedModuleIds: ModuleInstanceId[] = [];
    const nextMapping: Record<string, ModuleInstanceId> = { ...moduleMapping };
    for (const module of template.modules) {
      const id = executeModule(driver, module, nextMapping);
      nextMapping[module.key] = id;
      addedModuleIds.push(id);
    }

    const addedRouteIds: RouteId[] = [];
    for (const route of template.routes) {
      addedRouteIds.push(executeRoute(driver, route, nextMapping));
    }

    const beforeApply = stateOf(driver);
    const preview = calculateDesignApplyPreview(beforeApply, content);
    if (preview.status !== "ready") {
      throw new TemplateExecutionError(templateId, `apply-preview:${preview.status}`);
    }
    const liveRevision = beforeApply.facility.liveLayoutRevision;
    driver.submitGameplayCommand({
      kind: "APPLY_DESIGN",
      expectedDraftRevision: preview.draftRevision,
      acceptedCostUsd: preview.netCostUsd,
      acceptedDowntimeTicks: preview.downtimeTicks,
    });
    const after = stateOf(driver);
    if (
      after.facility.designDraft !== null ||
      after.facility.liveLayoutRevision !== liveRevision + 1 ||
      addedModuleIds.some((id) => after.facility.modules[id] === undefined) ||
      addedRouteIds.some((id) => after.facility.routes[id] === undefined)
    ) {
      throw new Error(`Template ${templateId} did not apply its complete live layout.`);
    }

    moduleMapping = Object.freeze(nextMapping);
    appliedTemplateIds.push(templateId);
    return Object.freeze({
      templateId,
      addedModuleIds: Object.freeze([...addedModuleIds]),
      addedRouteIds: Object.freeze([...addedRouteIds]),
      moduleMapping: Object.freeze({ ...moduleMapping }),
      draftRevision: preview.draftRevision,
      netCostUsd: preview.netCostUsd,
      downtimeTicks: preview.downtimeTicks,
    });
  };

  const getAppliedTemplateIds = (): readonly MilestoneTemplateId[] =>
    Object.freeze([...appliedTemplateIds]);
  const getModuleMapping = (): Readonly<Record<string, ModuleInstanceId>> =>
    Object.freeze({ ...moduleMapping });
  const resolveBlueprintSelection = (
    templateId: MilestoneTemplateId = "starter-serial",
  ): readonly ModuleInstanceId[] => {
    const template = getBuildTemplate(templateId);
    if (template === undefined) throw new TemplateExecutionError(templateId, "unknown-template");
    requireTemplateChain(template, appliedTemplateIds);
    const ids = mapRoles(templateId, moduleMapping, "blueprint-selection");
    const state = stateOf(driver);
    if (!isFeatureUnlocked("subassembly-blueprints", state.research, content)) {
      throw new TemplateExecutionError(templateId, "research-required:subassembly-blueprints");
    }
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => state.facility.modules[id] === undefined)
    ) {
      throw new TemplateExecutionError(templateId, "stale-blueprint-selection");
    }
    return Object.freeze([...ids]);
  };

  const resolveClusterRole = (
    templateId: MilestoneTemplateId,
    role: keyof BuildTemplate["clusterRoles"],
  ): readonly ModuleInstanceId[] => mapRoles(templateId, moduleMapping, role);

  return Object.freeze({
    applyTemplate,
    getAppliedTemplateIds,
    getModuleMapping,
    resolveBlueprintSelection,
    resolveClusterRole,
  });
}
