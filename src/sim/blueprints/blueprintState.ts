import { isMicrodollarAlignedUsd } from "../economy/money.ts";
import type {
  BlueprintKind,
  BlueprintRecord,
  BlueprintState,
  BlueprintModule,
  BlueprintRoute,
  GridPoint,
  OverclockSettings,
} from "../core/types.ts";

export interface BlueprintStateIssue {
  readonly path: string;
  readonly message: string;
}

const BLUEPRINT_ID_PATTERN = /^blueprint-(\d{8,})$/;
const LOCAL_MODULE_ID_PATTERN = /^module-(\d{4,})$/;
const LOCAL_ROUTE_ID_PATTERN = /^route-(\d{4,})$/;
const BLUEPRINT_KINDS: readonly BlueprintKind[] = [
  "subassembly",
  "server",
  "rack",
  "facility-zone",
];
const OVERCLOCK_PROFILES = ["eco", "balanced", "boost", "manual"] as const;
const ROUTE_KINDS = ["power", "data"] as const;

function pushIf(
  issues: BlueprintStateIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
  path: string,
  issues: BlueprintStateIssue[],
): value is Record<string, unknown> {
  if (!isObject(value)) {
    issues.push({ path, message: "must be a plain object" });
    return false;
  }
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  pushIf(
    issues,
    actual.length !== expected.length || actual.some((key, index) => key !== expected[index]),
    path,
    "has an invalid exact shape",
  );
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

function isFiniteNonnegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasValidName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    value === value.trim() &&
    value.trim().length > 0 &&
    !containsControlCharacter(value)
  );
}

function parsePositiveSequence(value: string, pattern: RegExp): number | null {
  const match = pattern.exec(value);
  if (match?.[1] === undefined) return null;
  const sequence = Number(match[1]);
  return isPositiveSafeInteger(sequence) ? sequence : null;
}

function formatSequence(prefix: string, sequence: number, width: number): string {
  if (!isPositiveSafeInteger(sequence)) {
    throw new RangeError("Blueprint sequence must be a positive safe integer.");
  }
  return `${prefix}${String(sequence).padStart(width, "0")}`;
}

export function formatBlueprintId(sequence: number): string {
  return formatSequence("blueprint-", sequence, 8);
}

export function formatBlueprintLocalModuleId(sequence: number): string {
  return formatSequence("module-", sequence, 4);
}

export function formatBlueprintLocalRouteId(sequence: number): string {
  return formatSequence("route-", sequence, 4);
}

export function normalizeBlueprintName(name: string): string {
  if (typeof name !== "string") throw new TypeError("Blueprint name must be a string.");
  const normalized = name.trim();
  if (!hasValidName(normalized)) {
    throw new RangeError(
      "Blueprint name must be nonempty, at most 80 UTF-16 code units, and control-free.",
    );
  }
  return normalized;
}

function validatePoint(
  value: unknown,
  path: string,
  issues: BlueprintStateIssue[],
): value is GridPoint {
  if (!hasExactKeys(value, ["x", "y"], path, issues)) return false;
  pushIf(
    issues,
    !isFiniteInteger(value["x"]),
    `${path}.x`,
    "must be a finite integer without negative zero",
  );
  pushIf(
    issues,
    !isFiniteInteger(value["y"]),
    `${path}.y`,
    "must be a finite integer without negative zero",
  );
  return isFiniteInteger(value["x"]) && isFiniteInteger(value["y"]);
}

function validateOverclockSettings(
  value: unknown,
  path: string,
  issues: BlueprintStateIssue[],
): value is OverclockSettings {
  if (!hasExactKeys(value, ["profile", "frequencyRatio", "voltageRatio"], path, issues))
    return false;
  pushIf(
    issues,
    !OVERCLOCK_PROFILES.includes(value["profile"] as (typeof OVERCLOCK_PROFILES)[number]),
    `${path}.profile`,
    "must be a supported overclock profile",
  );
  pushIf(
    issues,
    !isFiniteNumber(value["frequencyRatio"]) || value["frequencyRatio"] <= 0,
    `${path}.frequencyRatio`,
    "must be finite and strictly positive",
  );
  pushIf(
    issues,
    !isFiniteNumber(value["voltageRatio"]) || value["voltageRatio"] <= 0,
    `${path}.voltageRatio`,
    "must be finite and strictly positive",
  );
  return true;
}

function validateModule(
  value: unknown,
  index: number,
  bounds: { width: number; height: number } | null,
  issues: BlueprintStateIssue[],
): value is BlueprintModule {
  const path = `modules[${index}]`;
  if (
    !hasExactKeys(
      value,
      ["localId", "definitionId", "relativePosition", "rotation", "defaultOverclock"],
      path,
      issues,
    )
  )
    return false;
  const localId = value["localId"];
  const position = value["relativePosition"];
  pushIf(
    issues,
    parsePositiveSequence(typeof localId === "string" ? localId : "", LOCAL_MODULE_ID_PATTERN) ===
      null,
    `${path}.localId`,
    "must be a canonical local module ID",
  );
  pushIf(
    issues,
    !nonemptyString(value["definitionId"]),
    `${path}.definitionId`,
    "must be a nonempty string",
  );
  const validPosition = validatePoint(position, `${path}.relativePosition`, issues);
  if (validPosition && bounds !== null) {
    pushIf(
      issues,
      position.x < 0 || position.x >= bounds.width || position.y < 0 || position.y >= bounds.height,
      `${path}.relativePosition`,
      "must fit stored bounds",
    );
  }
  pushIf(
    issues,
    value["rotation"] !== 0 &&
      value["rotation"] !== 90 &&
      value["rotation"] !== 180 &&
      value["rotation"] !== 270,
    `${path}.rotation`,
    "must be 0, 90, 180, or 270",
  );
  validateOverclockSettings(value["defaultOverclock"], `${path}.defaultOverclock`, issues);
  return true;
}

function validateRoute(
  value: unknown,
  index: number,
  bounds: { width: number; height: number } | null,
  moduleIds: ReadonlySet<string>,
  issues: BlueprintStateIssue[],
): value is BlueprintRoute {
  const path = `routes[${index}]`;
  if (
    !hasExactKeys(
      value,
      [
        "localId",
        "kind",
        "fromLocalModuleId",
        "fromPortId",
        "toLocalModuleId",
        "toPortId",
        "relativePath",
      ],
      path,
      issues,
    )
  )
    return false;
  const localId = value["localId"];
  pushIf(
    issues,
    parsePositiveSequence(typeof localId === "string" ? localId : "", LOCAL_ROUTE_ID_PATTERN) ===
      null,
    `${path}.localId`,
    "must be a canonical local route ID",
  );
  pushIf(
    issues,
    !ROUTE_KINDS.includes(value["kind"] as (typeof ROUTE_KINDS)[number]),
    `${path}.kind`,
    "must be a supported route kind",
  );
  for (const [field, endpoint] of [
    ["fromLocalModuleId", value["fromLocalModuleId"]],
    ["toLocalModuleId", value["toLocalModuleId"]],
  ] as const) {
    pushIf(
      issues,
      !nonemptyString(endpoint),
      `${path}.${field}`,
      "must be a nonempty local module ID",
    );
    pushIf(
      issues,
      nonemptyString(endpoint) && !moduleIds.has(endpoint),
      `${path}.${field}`,
      "must reference a local module",
    );
  }
  for (const field of ["fromPortId", "toPortId"] as const) {
    pushIf(issues, !nonemptyString(value[field]), `${path}.${field}`, "must be a nonempty string");
  }
  if (!Array.isArray(value["relativePath"])) {
    issues.push({ path: `${path}.relativePath`, message: "must be an array" });
    return true;
  }
  const relativePath: unknown[] = value["relativePath"];
  pushIf(
    issues,
    relativePath.length < 2,
    `${path}.relativePath`,
    "must contain at least two points",
  );
  const points: GridPoint[] = [];
  const seen = new Set<string>();
  for (let pointIndex = 0; pointIndex < relativePath.length; pointIndex += 1) {
    const point = relativePath[pointIndex];
    if (!validatePoint(point, `${path}.relativePath[${pointIndex}]`, issues)) continue;
    points.push(point);
    const key = `${point.x},${point.y}`;
    pushIf(issues, seen.has(key), `${path}.relativePath`, "must not repeat a point");
    seen.add(key);
    if (bounds !== null) {
      pushIf(
        issues,
        point.x < 0 || point.x >= bounds.width || point.y < 0 || point.y >= bounds.height,
        `${path}.relativePath[${pointIndex}]`,
        "must fit stored bounds",
      );
    }
  }
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const previous = points[pointIndex - 1];
    const current = points[pointIndex];
    if (previous !== undefined && current !== undefined) {
      pushIf(
        issues,
        Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y) !== 1,
        `${path}.relativePath`,
        "must contain orthogonal adjacent points",
      );
    }
  }
  return true;
}

function validateRecord(
  value: unknown,
  path: string,
  issues: BlueprintStateIssue[],
): value is BlueprintRecord {
  if (
    !hasExactKeys(
      value,
      [
        "id",
        "name",
        "version",
        "kind",
        "contentVersion",
        "modules",
        "routes",
        "requiredResearchIds",
        "bounds",
        "summary",
      ],
      path,
      issues,
    )
  )
    return false;
  const id = value["id"];
  pushIf(
    issues,
    parsePositiveSequence(typeof id === "string" ? id : "", BLUEPRINT_ID_PATTERN) === null,
    `${path}.id`,
    "must be a canonical Blueprint ID",
  );
  pushIf(
    issues,
    !hasValidName(value["name"]),
    `${path}.name`,
    "must be normalized, nonempty, at most 80 UTF-16 code units, and control-free",
  );
  pushIf(
    issues,
    !isPositiveSafeInteger(value["version"]),
    `${path}.version`,
    "must be a positive safe integer",
  );
  pushIf(
    issues,
    !BLUEPRINT_KINDS.includes(value["kind"] as BlueprintKind),
    `${path}.kind`,
    "must be a supported structural kind",
  );
  pushIf(
    issues,
    !nonemptyString(value["contentVersion"]),
    `${path}.contentVersion`,
    "must be a nonempty string",
  );

  const boundsValue = value["bounds"];
  let bounds: { width: number; height: number } | null = null;
  if (hasExactKeys(boundsValue, ["width", "height"], `${path}.bounds`, issues)) {
    pushIf(
      issues,
      !isPositiveSafeInteger(boundsValue["width"]),
      `${path}.bounds.width`,
      "must be a positive safe integer",
    );
    pushIf(
      issues,
      !isPositiveSafeInteger(boundsValue["height"]),
      `${path}.bounds.height`,
      "must be a positive safe integer",
    );
    if (
      isPositiveSafeInteger(boundsValue["width"]) &&
      isPositiveSafeInteger(boundsValue["height"])
    ) {
      bounds = { width: boundsValue["width"], height: boundsValue["height"] };
    }
  }

  const moduleIds = new Set<string>();
  if (!Array.isArray(value["modules"])) {
    issues.push({ path: `${path}.modules`, message: "must be an array" });
  } else {
    const modules: unknown[] = value["modules"];
    pushIf(
      issues,
      value["kind"] === "subassembly" && modules.length === 0,
      `${path}.modules`,
      "subassemblies must contain at least one module",
    );
    for (let index = 0; index < modules.length; index += 1) {
      const module = modules[index];
      validateModule(module, index, bounds, issues);
      if (isObject(module) && typeof module["localId"] === "string") {
        pushIf(
          issues,
          moduleIds.has(module["localId"]),
          `${path}.modules[${index}].localId`,
          "must be unique",
        );
        moduleIds.add(module["localId"]);
      }
    }
  }

  if (!Array.isArray(value["routes"])) {
    issues.push({ path: `${path}.routes`, message: "must be an array" });
  } else {
    const routes: unknown[] = value["routes"];
    const routeIds = new Set<string>();
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      validateRoute(route, index, bounds, moduleIds, issues);
      if (isObject(route) && typeof route["localId"] === "string") {
        pushIf(
          issues,
          routeIds.has(route["localId"]),
          `${path}.routes[${index}].localId`,
          "must be unique",
        );
        routeIds.add(route["localId"]);
      }
    }
  }

  if (!Array.isArray(value["requiredResearchIds"])) {
    issues.push({ path: `${path}.requiredResearchIds`, message: "must be an array" });
  } else {
    const requiredResearchIds: unknown[] = value["requiredResearchIds"];
    for (let index = 0; index < requiredResearchIds.length; index += 1) {
      pushIf(
        issues,
        !nonemptyString(requiredResearchIds[index]),
        `${path}.requiredResearchIds[${index}]`,
        "must be a nonempty string",
      );
      if (index > 0) {
        const previous = requiredResearchIds[index - 1];
        const current = requiredResearchIds[index];
        pushIf(
          issues,
          typeof previous === "string" && typeof current === "string" && previous >= current,
          `${path}.requiredResearchIds`,
          "must be unique and lexically sorted",
        );
      }
    }
  }

  const summary = value["summary"];
  if (
    !hasExactKeys(
      summary,
      ["theoreticalComputeFlops", "peakPowerWatts", "estimatedMaxTemperatureC", "estimatedCostUsd"],
      `${path}.summary`,
      issues,
    )
  )
    return true;
  for (const field of [
    "theoreticalComputeFlops",
    "peakPowerWatts",
    "estimatedMaxTemperatureC",
    "estimatedCostUsd",
  ] as const) {
    pushIf(
      issues,
      !isFiniteNonnegative(summary[field]),
      `${path}.summary.${field}`,
      "must be finite, nonnegative, and not negative zero",
    );
  }
  const estimatedCostUsd = summary["estimatedCostUsd"];
  pushIf(
    issues,
    !isMicrodollarAlignedUsd(
      typeof estimatedCostUsd === "number" ? estimatedCostUsd : Number.NaN,
    ) || Object.is(estimatedCostUsd, -0),
    `${path}.summary.estimatedCostUsd`,
    "must be safely represented at microdollar precision",
  );
  return true;
}

export function validateBlueprintState(value: unknown): BlueprintStateIssue[] {
  const issues: BlueprintStateIssue[] = [];
  if (!hasExactKeys(value, ["records", "nextBlueprintSequence"], "blueprints", issues))
    return issues;
  const nextBlueprintSequence = value["nextBlueprintSequence"];
  pushIf(
    issues,
    !isPositiveSafeInteger(nextBlueprintSequence),
    "blueprints.nextBlueprintSequence",
    "must be a positive safe integer",
  );
  if (!isObject(value["records"])) {
    issues.push({ path: "blueprints.records", message: "must be a plain object" });
    return issues;
  }
  const recordIds = new Set<string>();
  let maximumSequence = 0;
  for (const [recordKey, recordValue] of Object.entries(value["records"]).toSorted(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    const path = `blueprints.records.${recordKey}`;
    if (!validateRecord(recordValue, path, issues)) continue;
    if (recordValue.id !== recordKey)
      issues.push({ path: `${path}.id`, message: "must exactly match its record key" });
    if (recordIds.has(recordValue.id))
      issues.push({ path: `${path}.id`, message: "must be unique" });
    recordIds.add(recordValue.id);
    const sequence = parsePositiveSequence(recordValue.id, BLUEPRINT_ID_PATTERN);
    if (sequence !== null) maximumSequence = Math.max(maximumSequence, sequence);
  }
  pushIf(
    issues,
    isPositiveSafeInteger(nextBlueprintSequence) && nextBlueprintSequence <= maximumSequence,
    "blueprints.nextBlueprintSequence",
    "must be greater than every allocated Blueprint sequence",
  );
  return issues;
}

export function assertValidBlueprintState(value: unknown): asserts value is BlueprintState {
  const issues = validateBlueprintState(value);
  if (issues.length > 0) {
    throw new Error(
      `Invalid Blueprint state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

export function validateStoredBlueprintState(state: {
  readonly blueprints: unknown;
}): BlueprintStateIssue[] {
  return validateBlueprintState(state.blueprints);
}

export function assertValidStoredBlueprintState(state: { readonly blueprints: unknown }): void {
  const issues = validateStoredBlueprintState(state);
  if (issues.length > 0) {
    throw new Error(
      `Invalid stored Blueprint state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}
