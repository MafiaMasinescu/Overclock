import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { assertCanonicalSerializable } from "../../sim/replay/canonicalState.ts";
import {
  enumerateOccupiedTiles,
  isGridPointInBounds,
  resolveRotatedFootprintSize,
} from "../../grid/domain/footprintGeometry.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type { BuildTemplate, BuildTemplateModule, BuildTemplateRoute } from "./botContracts.ts";
import { BUILD_TEMPLATE_BY_ID, resolveBuildTemplateChain } from "./buildTemplates.ts";

export interface BuildTemplateValidationIssue {
  readonly path: string;
  readonly message: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value)
    .filter((key): key is string => typeof key === "string")
    .toSorted(compareStableStrings);
  const orderedExpected = [...expected].toSorted(compareStableStrings);
  return (
    actual.length === orderedExpected.length &&
    actual.every((key, index) => key === orderedExpected[index])
  );
}

function validPoint(value: unknown): value is { readonly x: number; readonly y: number } {
  return (
    isPlainRecord(value) &&
    exactKeys(value, ["x", "y"]) &&
    Number.isSafeInteger(value["x"]) &&
    Number.isSafeInteger(value["y"])
  );
}

function validRotation(value: unknown): value is BuildTemplateModule["rotation"] {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function validRouteEndpoint(value: unknown): value is BuildTemplateRoute["from"] {
  return (
    isPlainRecord(value) &&
    exactKeys(value, ["moduleKey", "portId"]) &&
    typeof value["moduleKey"] === "string" &&
    typeof value["portId"] === "string"
  );
}

function validRouteKind(value: unknown): value is BuildTemplateRoute["kind"] {
  return value === "power" || value === "data";
}

function validDefinition(
  definition: ContentBundle["modules"][string] | undefined,
): definition is NonNullable<ContentBundle["modules"][string]> {
  return definition !== undefined;
}

function portKind(
  definition: NonNullable<ContentBundle["modules"][string]>,
  portId: string,
): string | undefined {
  return definition.ports.find((port) => port.id === portId)?.kind;
}

function compatibleRouteKind(
  left: string | undefined,
  right: string | undefined,
  kind: string,
): boolean {
  if (left === undefined || right === undefined) return false;
  if (left === "airflow" || right === "airflow") return false;
  const data = ["data-in", "data-out", "data-bidirectional"];
  if (kind === "data")
    return (
      data.includes(left) &&
      data.includes(right) &&
      !(left === "data-in" && right === "data-in") &&
      !(left === "data-out" && right === "data-out")
    );
  return (
    (left === "power-in" && right === "power-out") || (left === "power-out" && right === "power-in")
  );
}

function validateRoute(
  route: unknown,
  index: number,
  modules: Readonly<Record<string, BuildTemplateModule>>,
  content: ContentBundle,
  occupied: ReadonlySet<string>,
  issues: BuildTemplateValidationIssue[],
): void {
  const path = `routes[${index}]`;
  if (!isPlainRecord(route) || !exactKeys(route, ["key", "kind", "from", "to", "path"])) {
    issues.push({ path, message: "must contain exactly the route keys" });
    return;
  }
  const key = route["key"];
  const kind = route["kind"];
  const from = route["from"];
  const to = route["to"];
  const routePath = route["path"];
  if (
    typeof key !== "string" ||
    !validRouteKind(kind) ||
    !validRouteEndpoint(from) ||
    !validRouteEndpoint(to)
  ) {
    issues.push({ path, message: "must contain valid route values" });
    return;
  }
  const fromModule = modules[from.moduleKey];
  const toModule = modules[to.moduleKey];
  const fromDefinition =
    fromModule === undefined ? undefined : content.modules[fromModule.definitionId];
  const toDefinition = toModule === undefined ? undefined : content.modules[toModule.definitionId];
  if (!validDefinition(fromDefinition) || !validDefinition(toDefinition)) {
    issues.push({ path, message: "must reference known module definitions" });
  } else if (
    !compatibleRouteKind(
      portKind(fromDefinition, from.portId),
      portKind(toDefinition, to.portId),
      kind,
    )
  ) {
    issues.push({ path, message: "port kinds do not match the declared route kind" });
  }
  if (!Array.isArray(routePath) || routePath.length < 2) {
    issues.push({ path: `${path}.path`, message: "must contain at least two integer points" });
    return;
  }
  const points: { readonly x: number; readonly y: number }[] = [];
  for (const point of routePath) {
    if (!validPoint(point)) {
      issues.push({ path: `${path}.path`, message: "must contain at least two integer points" });
      return;
    }
    points.push(point);
  }
  const seen = new Set<string>();
  points.forEach((point, pointIndex) => {
    const key = `${point.x},${point.y}`;
    if (seen.has(key))
      issues.push({ path: `${path}.path[${pointIndex}]`, message: "must not repeat a tile" });
    seen.add(key);
    if (!isGridPointInBounds(point, content.era.facilityGrid))
      issues.push({
        path: `${path}.path[${pointIndex}]`,
        message: "must stay inside the facility",
      });
    if (pointIndex > 0) {
      const previous = points[pointIndex - 1];
      if (
        previous !== undefined &&
        Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) !== 1
      ) {
        issues.push({ path: `${path}.path[${pointIndex}]`, message: "must be orthogonal" });
      }
    }
    if (pointIndex > 0 && pointIndex < points.length - 1 && occupied.has(key)) {
      issues.push({
        path: `${path}.path[${pointIndex}]`,
        message: "route interior must not cross a module",
      });
    }
  });
}

export function validateBuildTemplate(
  template: unknown,
  content: ContentBundle,
): readonly BuildTemplateValidationIssue[] {
  const issues: BuildTemplateValidationIssue[] = [];
  try {
    assertCanonicalSerializable(template);
  } catch {
    return [{ path: "template", message: "must be canonical serializable data" }];
  }
  if (
    !isPlainRecord(template) ||
    !exactKeys(template, [
      "templateVersion",
      "id",
      "baseTemplateId",
      "purpose",
      "requiredResearchIds",
      "modules",
      "routes",
      "clusterRoles",
    ])
  ) {
    return [{ path: "template", message: "must be a plain object with the exact template keys" }];
  }
  const templateRecord = template;
  const candidate = template as unknown as BuildTemplate;
  if (templateRecord["templateVersion"] !== 1)
    issues.push({ path: "templateVersion", message: "must equal 1" });
  if (typeof candidate.id !== "string" || !Object.hasOwn(BUILD_TEMPLATE_BY_ID, candidate.id))
    issues.push({ path: "id", message: "must be one of the three approved template IDs" });
  if (typeof candidate.purpose !== "string" || candidate.purpose.length === 0)
    issues.push({ path: "purpose", message: "must be nonempty" });
  if (
    !Array.isArray(candidate.requiredResearchIds) ||
    candidate.requiredResearchIds.some((id) => typeof id !== "string")
  )
    issues.push({ path: "requiredResearchIds", message: "must be string IDs" });
  if (!Array.isArray(candidate.modules) || candidate.modules.length === 0) {
    issues.push({ path: "modules", message: "must contain at least one module" });
    return Object.freeze(issues);
  }
  const moduleKeys = new Set<string>();
  const modules: Record<string, BuildTemplate["modules"][number]> = {};
  const occupied = new Set<string>();
  const baseTemplate =
    candidate.baseTemplateId === null || typeof candidate.baseTemplateId !== "string"
      ? undefined
      : BUILD_TEMPLATE_BY_ID[candidate.baseTemplateId as BuildTemplate["id"]];
  if (baseTemplate !== undefined) {
    for (const module of resolveBuildTemplateChain(baseTemplate.id).flatMap(
      (entry) => entry.modules,
    )) {
      moduleKeys.add(module.key);
      modules[module.key] = module;
      const definition = content.modules[module.definitionId];
      if (definition === undefined) continue;
      for (const tile of enumerateOccupiedTiles(
        module.position,
        definition.footprint,
        module.rotation,
      )) {
        occupied.add(`${tile.x},${tile.y}`);
      }
    }
  }
  candidate.modules.forEach((module, index) => {
    const path = `modules[${index}]`;
    if (
      !isPlainRecord(module) ||
      !exactKeys(module, ["key", "definitionId", "position", "rotation"])
    ) {
      issues.push({ path, message: "must contain exact module keys and valid values" });
      return;
    }
    const moduleRecord: unknown = module;
    if (
      !isPlainRecord(moduleRecord) ||
      !exactKeys(moduleRecord, ["key", "definitionId", "position", "rotation"])
    ) {
      issues.push({ path, message: "must contain exact module keys and valid values" });
      return;
    }
    const moduleKey = moduleRecord["key"];
    const definitionId = moduleRecord["definitionId"];
    const position = moduleRecord["position"];
    const rotation = moduleRecord["rotation"];
    if (
      typeof moduleKey !== "string" ||
      typeof definitionId !== "string" ||
      !validPoint(position) ||
      !validRotation(rotation)
    ) {
      issues.push({ path, message: "must contain exact module keys and valid values" });
      return;
    }
    const moduleCandidate: BuildTemplateModule = {
      key: moduleKey,
      definitionId,
      position,
      rotation,
    };
    if (moduleKeys.has(moduleCandidate.key))
      issues.push({ path: `${path}.key`, message: "must be unique" });
    moduleKeys.add(moduleCandidate.key);
    modules[moduleCandidate.key] = moduleCandidate;
    const definition = content.modules[moduleCandidate.definitionId];
    if (definition === undefined) {
      issues.push({ path: `${path}.definitionId`, message: "must reference a known module" });
      return;
    }
    if (![0, 90, 180, 270].includes(moduleCandidate.rotation))
      issues.push({ path: `${path}.rotation`, message: "must be 0, 90, 180, or 270" });
    if (![0, 90, 180, 270].includes(moduleCandidate.rotation)) return;
    const size = resolveRotatedFootprintSize(definition.footprint, moduleCandidate.rotation);
    for (const tile of enumerateOccupiedTiles(
      moduleCandidate.position,
      definition.footprint,
      moduleCandidate.rotation,
    )) {
      const key = `${tile.x},${tile.y}`;
      if (!isGridPointInBounds(tile, content.era.facilityGrid))
        issues.push({
          path: `${path}.position`,
          message: "footprint must remain inside the facility",
        });
      if (occupied.has(key))
        issues.push({ path: `${path}.position`, message: "module footprints must not overlap" });
      occupied.add(key);
    }
    if (
      moduleCandidate.position.x + size.width > content.era.facilityGrid.width ||
      moduleCandidate.position.y + size.height > content.era.facilityGrid.height
    )
      issues.push({
        path: `${path}.position`,
        message: "footprint must remain inside the facility",
      });
  });
  if (Array.isArray(candidate.routes))
    candidate.routes.forEach((route, index) => {
      validateRoute(route, index, modules, content, occupied, issues);
    });
  else issues.push({ path: "routes", message: "must be an array" });

  const roles = candidate.clusterRoles;
  if (
    !isPlainRecord(roles) ||
    !exactKeys(roles, [
      "task-primary",
      "research-primary",
      "benchmark-sustained",
      "benchmark-peak",
      "blueprint-selection",
    ])
  )
    issues.push({ path: "clusterRoles", message: "must contain the exact role keys" });
  else
    for (const [role, keys] of Object.entries(roles)) {
      if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        keys.some((key) => typeof key !== "string" || !moduleKeys.has(key))
      )
        issues.push({
          path: `clusterRoles.${role}`,
          message: "must reference existing symbolic modules",
        });
    }
  return Object.freeze(issues);
}

export function validateAllBuildTemplates(
  content: ContentBundle,
): readonly BuildTemplateValidationIssue[] {
  const issues: BuildTemplateValidationIssue[] = [];
  const ids: readonly BuildTemplate["id"][] = [
    "starter-serial",
    "expanded-balanced",
    "cooled-benchmark",
  ];
  for (const id of ids) {
    const template = BUILD_TEMPLATE_BY_ID[id];
    issues.push(
      ...validateBuildTemplate(template, content).map((issue) => ({
        ...issue,
        path: `${id}.${issue.path}`,
      })),
    );
    const expectedBase =
      id === "starter-serial"
        ? null
        : id === "expanded-balanced"
          ? "starter-serial"
          : "expanded-balanced";
    if (template.baseTemplateId !== expectedBase)
      issues.push({
        path: `${id}.baseTemplateId`,
        message: "does not match the fixed template chain",
      });
    const chain = resolveBuildTemplateChain(id);
    const keys = chain.flatMap((entry) => entry.modules.map((module) => module.key));
    if (new Set(keys).size !== keys.length)
      issues.push({
        path: `${id}.modules`,
        message: "resolved symbolic module keys must be unique",
      });
  }
  return Object.freeze(issues);
}

export function assertValidBuildTemplates(content: ContentBundle): void {
  const issues = validateAllBuildTemplates(content);
  if (issues.length > 0)
    throw new Error(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
}
