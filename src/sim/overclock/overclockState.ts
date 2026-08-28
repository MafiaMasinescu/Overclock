import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  FacilityOverclockState,
  GameState,
  ModuleInstanceState,
  ModuleOverclockResultState,
  OverclockProfile,
} from "../core/types.ts";

export interface OverclockStateIssue {
  readonly path: string;
  readonly message: string;
}

const PROFILES = new Set<OverclockProfile>(["eco", "balanced", "boost", "manual"]);

export function createDirtyOverclockState(): FacilityOverclockState {
  return {
    layoutRevision: null,
    thermalRevision: null,
    byModule: {},
  };
}

function pushIf(
  issues: OverclockStateIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0 && !Object.is(value, -0);
}

function isUnitFactor(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1 && !Object.is(value, -0);
}

function validateModuleSettings(
  module: Readonly<ModuleInstanceState>,
  content: ContentBundle,
  issues: OverclockStateIssue[],
): void {
  const path = `facility.modules.${module.id}.overclock`;
  const definition = content.modules[module.definitionId];
  if (definition === undefined) {
    issues.push({
      path: `facility.modules.${module.id}.definitionId`,
      message: "must exist in content",
    });
    return;
  }
  const { profile, frequencyRatio, voltageRatio } = module.overclock;
  pushIf(issues, !PROFILES.has(profile), `${path}.profile`, "must be a supported profile");
  pushIf(
    issues,
    !isFinitePositive(frequencyRatio),
    `${path}.frequencyRatio`,
    "must be finite and strictly positive",
  );
  pushIf(
    issues,
    !isFinitePositive(voltageRatio),
    `${path}.voltageRatio`,
    "must be finite and strictly positive",
  );
  if (!PROFILES.has(profile)) return;

  if (!definition.overclockable) {
    pushIf(issues, profile !== "balanced", `${path}.profile`, "must be balanced when unsupported");
    pushIf(
      issues,
      frequencyRatio !== 1,
      `${path}.frequencyRatio`,
      "must be exactly 1 when unsupported",
    );
    pushIf(
      issues,
      voltageRatio !== 1,
      `${path}.voltageRatio`,
      "must be exactly 1 when unsupported",
    );
    return;
  }

  const { manual } = content.balancing.overclock;
  if (profile === "manual") {
    pushIf(
      issues,
      frequencyRatio < manual.frequencyRatioMin || frequencyRatio > manual.frequencyRatioMax,
      `${path}.frequencyRatio`,
      "must be inside the inclusive manual bounds",
    );
    pushIf(
      issues,
      voltageRatio < manual.voltageRatioMin || voltageRatio > manual.voltageRatioMax,
      `${path}.voltageRatio`,
      "must be inside the inclusive manual bounds",
    );
    return;
  }

  const preset = content.balancing.overclock[profile];
  pushIf(
    issues,
    frequencyRatio !== preset.frequencyRatio,
    `${path}.frequencyRatio`,
    "must exactly match its profile preset",
  );
  pushIf(
    issues,
    voltageRatio !== preset.voltageRatio,
    `${path}.voltageRatio`,
    "must exactly match its profile preset",
  );
}

function validateResult(
  result: Readonly<ModuleOverclockResultState>,
  module: Readonly<ModuleInstanceState> | undefined,
  moduleId: string,
  issues: OverclockStateIssue[],
): void {
  const path = `facility.overclock.byModule.${moduleId}`;
  pushIf(
    issues,
    result.moduleInstanceId !== moduleId,
    `${path}.moduleInstanceId`,
    "must match its record key",
  );
  pushIf(issues, !PROFILES.has(result.profile), `${path}.profile`, "must be a supported profile");
  for (const [field, value] of [
    ["requestedFrequencyRatio", result.requestedFrequencyRatio],
    ["requestedVoltageRatio", result.requestedVoltageRatio],
    ["dynamicPowerFactor", result.dynamicPowerFactor],
  ] as const) {
    pushIf(
      issues,
      !isFinitePositive(value),
      `${path}.${field}`,
      "must be finite and strictly positive",
    );
  }
  pushIf(
    issues,
    !Number.isFinite(result.sampledTemperatureC) || Object.is(result.sampledTemperatureC, -0),
    `${path}.sampledTemperatureC`,
    "must be finite",
  );
  for (const [field, value] of [
    ["thermalFactor", result.thermalFactor],
    ["retryRate", result.retryRate],
    ["invalidSampleRate", result.invalidSampleRate],
    ["stabilityFactor", result.stabilityFactor],
  ] as const) {
    pushIf(issues, !isUnitFactor(value), `${path}.${field}`, "must be in [0, 1]");
  }
  pushIf(
    issues,
    result.retryRate + result.invalidSampleRate > 1,
    path,
    "retry and invalid sample rates must not exceed 1 together",
  );
  pushIf(
    issues,
    result.stabilityFactor !== 1 - result.retryRate - result.invalidSampleRate,
    `${path}.stabilityFactor`,
    "must exactly equal 1 minus retry and invalid sample rates",
  );
  const shutdownReason: unknown = result.shutdownReason;
  pushIf(
    issues,
    shutdownReason !== null && shutdownReason !== "thermal",
    `${path}.shutdownReason`,
    "must be thermal or null",
  );
  if (module !== undefined) {
    pushIf(
      issues,
      result.profile !== module.overclock.profile,
      `${path}.profile`,
      "must match module settings",
    );
    pushIf(
      issues,
      result.requestedFrequencyRatio !== module.overclock.frequencyRatio,
      `${path}.requestedFrequencyRatio`,
      "must match module settings",
    );
    pushIf(
      issues,
      result.requestedVoltageRatio !== module.overclock.voltageRatio,
      `${path}.requestedVoltageRatio`,
      "must match module settings",
    );
    if (module.operationalState === "shutdown") {
      pushIf(
        issues,
        result.thermalFactor !== 0,
        `${path}.thermalFactor`,
        "must be zero while shutdown",
      );
      pushIf(issues, result.retryRate !== 0, `${path}.retryRate`, "must be zero while shutdown");
      pushIf(
        issues,
        result.invalidSampleRate !== 1,
        `${path}.invalidSampleRate`,
        "must be one while shutdown",
      );
      pushIf(
        issues,
        result.stabilityFactor !== 0,
        `${path}.stabilityFactor`,
        "must be zero while shutdown",
      );
      pushIf(
        issues,
        result.shutdownReason !== "thermal",
        `${path}.shutdownReason`,
        "must be thermal while shutdown",
      );
    } else {
      pushIf(
        issues,
        result.shutdownReason !== null,
        `${path}.shutdownReason`,
        "must be null outside shutdown",
      );
    }
  }
}

export function validateOverclockState(
  state: Readonly<GameState>,
  content: ContentBundle,
): OverclockStateIssue[] {
  const issues: OverclockStateIssue[] = [];
  const { facility } = state;
  const { overclock } = facility;
  const moduleIds = Object.keys(facility.modules).toSorted();
  const resultModuleIds = Object.keys(overclock.byModule);

  for (const moduleId of moduleIds) {
    const module = facility.modules[moduleId];
    if (module !== undefined) validateModuleSettings(module, content, issues);
  }
  pushIf(
    issues,
    resultModuleIds.join("\u0000") !== resultModuleIds.toSorted().join("\u0000"),
    "facility.overclock.byModule",
    "keys must use stable ordering",
  );

  if (overclock.layoutRevision === null || overclock.thermalRevision === null) {
    pushIf(
      issues,
      overclock.layoutRevision !== null || overclock.thermalRevision !== null,
      "facility.overclock",
      "dirty state must have null layout and thermal revisions",
    );
    pushIf(
      issues,
      resultModuleIds.length !== 0,
      "facility.overclock.byModule",
      "dirty state must be empty",
    );
    return issues;
  }

  pushIf(
    issues,
    !Number.isSafeInteger(overclock.layoutRevision) || overclock.layoutRevision < 0,
    "facility.overclock.layoutRevision",
    "must be a nonnegative safe integer or null",
  );
  pushIf(
    issues,
    !Number.isSafeInteger(overclock.thermalRevision) || overclock.thermalRevision < 0,
    "facility.overclock.thermalRevision",
    "must be a nonnegative safe integer or null",
  );
  pushIf(
    issues,
    overclock.layoutRevision !== facility.liveLayoutRevision,
    "facility.overclock.layoutRevision",
    "must match the live layout revision",
  );
  pushIf(
    issues,
    overclock.thermalRevision !== facility.thermalRevision,
    "facility.overclock.thermalRevision",
    "must match the thermal revision",
  );
  pushIf(
    issues,
    resultModuleIds.join("\u0000") !== moduleIds.join("\u0000"),
    "facility.overclock.byModule",
    "must cover every live module exactly once in stable ID order",
  );
  for (const moduleId of resultModuleIds.toSorted()) {
    const result = overclock.byModule[moduleId];
    if (result !== undefined) {
      validateResult(result, facility.modules[moduleId], moduleId, issues);
    }
  }
  return issues;
}

export function assertValidStoredOverclockState(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  const issues = validateOverclockState(state, content);
  if (issues.length > 0) {
    throw new Error(
      `Invalid overclock state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}
