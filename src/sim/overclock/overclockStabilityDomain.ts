import type {
  ContentBundle,
  DeepReadonly,
  ModuleDefinition,
} from "../../content/schemas/contentSchemas.ts";
import type {
  FacilityOverclockState,
  FacilityState,
  ModuleInstanceState,
  ModuleOverclockResultState,
} from "../core/types.ts";
import { calculateModuleDynamicPowerFactor } from "./overclockDomain.ts";
import type { ThermalTopology } from "../thermal/contracts.ts";

export interface ModuleStabilityBreakdown {
  readonly frequencyStabilityFactor: number;
  readonly temperatureStabilityFactor: number;
  readonly retryRate: number;
  readonly invalidSampleRate: number;
  readonly stabilityFactor: number;
}

export interface FacilityOverclockCalculation {
  readonly modules: Record<string, ModuleInstanceState>;
  readonly overclock: FacilityOverclockState;
}

export interface OverclockTickIssue {
  readonly path: string;
  readonly message: string;
}

type ThermalThresholds = DeepReadonly<ModuleDefinition>["thermal"];

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive.`);
  }
}

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer.`);
  }
}

function assertThermalThresholds(thermal: ThermalThresholds): void {
  const { normalMaxC, warningMaxC, criticalMaxC, shutdownC } = thermal;
  if (
    !Number.isFinite(normalMaxC) ||
    !Number.isFinite(warningMaxC) ||
    !Number.isFinite(criticalMaxC) ||
    !Number.isFinite(shutdownC)
  ) {
    throw new RangeError("Thermal thresholds must be finite.");
  }
  if (!(normalMaxC < warningMaxC && warningMaxC < criticalMaxC && criticalMaxC < shutdownC)) {
    throw new RangeError("Thermal thresholds must be strictly increasing.");
  }
}

function interpolate(
  value: number,
  lowerInput: number,
  upperInput: number,
  lowerOutput: number,
  upperOutput: number,
): number {
  return (
    lowerOutput + ((value - lowerInput) / (upperInput - lowerInput)) * (upperOutput - lowerOutput)
  );
}

function assertTopologyCompatibility(
  facility: Readonly<FacilityState>,
  topology: Readonly<ThermalTopology>,
): void {
  const tileCount = facility.size.width * facility.size.height;
  if (
    topology.layoutRevision !== facility.liveLayoutRevision ||
    topology.facilityWidth !== facility.size.width ||
    topology.facilityHeight !== facility.size.height ||
    topology.tileCount !== tileCount ||
    topology.modules.length !== topology.moduleIds.length ||
    topology.moduleIds.length !== Object.keys(facility.modules).length
  ) {
    throw new Error("Thermal topology is incompatible with the current facility layout.");
  }
  let previousModuleId: string | undefined;
  for (const [index, moduleId] of topology.moduleIds.entries()) {
    const module = facility.modules[moduleId];
    const topologyModule = topology.modules[index];
    if (
      (previousModuleId !== undefined && previousModuleId >= moduleId) ||
      module?.id !== moduleId ||
      topologyModule?.moduleId !== moduleId ||
      topologyModule.definitionId !== module.definitionId ||
      topology.moduleIndexById[moduleId] !== index ||
      topology.occupiedTileIndexesByModule[moduleId] !== topologyModule.occupiedTileIndexes
    ) {
      throw new Error("Thermal topology module coverage is incompatible with the facility.");
    }
    previousModuleId = moduleId;
  }
  if (facility.thermalTiles.length !== tileCount) {
    throw new Error("Thermal tiles must cover the complete facility.");
  }
}

function assertThermalTileCoverage(facility: Readonly<FacilityState>, tileIndex: number): void {
  if (
    !Number.isSafeInteger(tileIndex) ||
    tileIndex < 0 ||
    tileIndex >= facility.thermalTiles.length
  ) {
    throw new RangeError("Thermal topology references a tile outside thermal coverage.");
  }
  const tile = facility.thermalTiles[tileIndex];
  if (tile === undefined) throw new Error("Thermal tile coverage is incomplete.");
  const expectedX = tileIndex % facility.size.width;
  const expectedY = Math.floor(tileIndex / facility.size.width);
  if (tile.position.x !== expectedX || tile.position.y !== expectedY) {
    throw new Error("Thermal tiles must use exact row-major coverage.");
  }
  assertFinite(tile.temperatureC, "Thermal tile temperature");
}

function stableModuleIds(
  modules: Readonly<Record<string, ModuleInstanceState>>,
): readonly string[] {
  return Object.keys(modules).toSorted();
}

interface PreparedFacilityModule {
  readonly moduleId: string;
  readonly definition: DeepReadonly<ModuleDefinition>;
  sampledTemperatureC: number;
  dynamicPowerFactor: number;
}

/** Caller-owned reusable calculation storage. It is private runtime data, never GameState. */
export interface FacilityOverclockCalculationScratch {
  readonly topology: ThermalTopology;
  readonly preparedModules: PreparedFacilityModule[];
  facilityIdentity: FacilityState | undefined;
}

export function createFacilityOverclockCalculationScratch(
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
): FacilityOverclockCalculationScratch {
  return {
    topology,
    facilityIdentity: undefined,
    preparedModules: topology.modules.map((topologyModule) => {
      const definition = content.modules[topologyModule.definitionId];
      if (definition === undefined) {
        throw new Error(`Unknown module definition: ${topologyModule.definitionId}`);
      }
      return {
        moduleId: topologyModule.moduleId,
        definition,
        sampledTemperatureC: 0,
        dynamicPowerFactor: 0,
      };
    }),
  };
}

function calculateModuleThermalFactorUnchecked(
  temperatureC: number,
  thermal: ThermalThresholds,
): number {
  const { normalMaxC, warningMaxC, criticalMaxC, shutdownC } = thermal;
  if (temperatureC <= normalMaxC) return 1;
  if (temperatureC <= warningMaxC) {
    return normalizeZero(interpolate(temperatureC, normalMaxC, warningMaxC, 1, 0.96));
  }
  if (temperatureC <= criticalMaxC) {
    return normalizeZero(interpolate(temperatureC, warningMaxC, criticalMaxC, 0.96, 0.65));
  }
  if (temperatureC < shutdownC) {
    return normalizeZero(interpolate(temperatureC, criticalMaxC, shutdownC, 0.65, 0.1));
  }
  return 0;
}

export function calculateModuleThermalFactor(
  temperatureC: number,
  thermal: ThermalThresholds,
): number {
  assertFinite(temperatureC, "temperatureC");
  assertThermalThresholds(thermal);
  const normalized = calculateModuleThermalFactorUnchecked(temperatureC, thermal);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new RangeError("Thermal Factor must be finite and inside [0, 1].");
  }
  return normalized;
}

function calculateModuleStabilityBreakdownUnchecked(
  module: Readonly<ModuleInstanceState>,
  definition: DeepReadonly<ModuleDefinition>,
  temperatureC: number,
): ModuleStabilityBreakdown {
  const supportedFrequencyRatio =
    definition.stableFrequencyRatio * module.binStabilityRatio * module.overclock.voltageRatio;
  const frequencyStabilityFactor = normalizeZero(
    clamp(supportedFrequencyRatio / module.overclock.frequencyRatio, 0, 1),
  );
  const { warningMaxC, shutdownC } = definition.thermal;
  const temperatureStabilityFactor = normalizeZero(
    temperatureC <= warningMaxC
      ? 1
      : temperatureC < shutdownC
        ? (shutdownC - temperatureC) / (shutdownC - warningMaxC)
        : 0,
  );
  const retryRate = normalizeZero(clamp(1 - frequencyStabilityFactor, 0, 1));
  const remainingAfterRetries = normalizeZero(1 - retryRate);
  const invalidSampleRate = normalizeZero(
    clamp(remainingAfterRetries * (1 - temperatureStabilityFactor), 0, remainingAfterRetries),
  );
  return {
    frequencyStabilityFactor,
    temperatureStabilityFactor,
    retryRate,
    invalidSampleRate,
    stabilityFactor: normalizeZero(clamp(1 - retryRate - invalidSampleRate, 0, 1)),
  };
}

export function calculateModuleStabilityBreakdown(
  module: Readonly<ModuleInstanceState>,
  definition: DeepReadonly<ModuleDefinition>,
  temperatureC: number,
): ModuleStabilityBreakdown {
  assertFinite(temperatureC, "temperatureC");
  assertThermalThresholds(definition.thermal);
  assertFinitePositive(definition.stableFrequencyRatio, "stableFrequencyRatio");
  assertFinitePositive(module.binStabilityRatio, "binStabilityRatio");
  assertFinitePositive(module.overclock.frequencyRatio, "frequencyRatio");
  assertFinitePositive(module.overclock.voltageRatio, "voltageRatio");
  const supportedFrequencyRatio =
    definition.stableFrequencyRatio * module.binStabilityRatio * module.overclock.voltageRatio;
  assertFinitePositive(supportedFrequencyRatio, "supportedFrequencyRatio");
  return calculateModuleStabilityBreakdownUnchecked(module, definition, temperatureC);
}

export function calculateModuleStabilityFactor(
  module: Readonly<ModuleInstanceState>,
  definition: DeepReadonly<ModuleDefinition>,
  temperatureC: number,
): number {
  return calculateModuleStabilityBreakdown(module, definition, temperatureC).stabilityFactor;
}

function sampleModuleMaximumTemperatureUnchecked(
  facility: Readonly<FacilityState>,
  topology: Readonly<ThermalTopology>,
  moduleId: string,
): number {
  const module = facility.modules[moduleId];
  const topologyIndex = topology.moduleIndexById[moduleId];
  const topologyModule = topologyIndex === undefined ? undefined : topology.modules[topologyIndex];
  const tileIndexes = topology.occupiedTileIndexesByModule[moduleId];
  if (
    module?.id !== moduleId ||
    topologyModule?.moduleId !== moduleId ||
    tileIndexes === undefined ||
    tileIndexes !== topologyModule.occupiedTileIndexes ||
    tileIndexes.length === 0
  ) {
    throw new Error("Thermal topology has no occupied tile coverage for the module.");
  }
  let maximumTemperatureC = Number.NEGATIVE_INFINITY;
  for (const tileIndex of tileIndexes) {
    assertThermalTileCoverage(facility, tileIndex);
    const temperatureC = facility.thermalTiles[tileIndex]?.temperatureC;
    if (temperatureC === undefined) throw new Error("Thermal tile coverage is incomplete.");
    maximumTemperatureC = Math.max(maximumTemperatureC, temperatureC);
  }
  assertFinite(maximumTemperatureC, "sampled maximum temperature");
  return normalizeZero(maximumTemperatureC);
}

function samplePreparedModuleMaximumTemperature(
  facility: Readonly<FacilityState>,
  tileIndexes: readonly number[],
  trustedThermalTiles: boolean,
): number {
  let maximumTemperatureC = Number.NEGATIVE_INFINITY;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let index = 0; index < tileIndexes.length; index += 1) {
    const tileIndex = tileIndexes[index];
    if (tileIndex === undefined) throw new Error("Thermal topology tile coverage is incomplete.");
    const temperatureC = facility.thermalTiles[tileIndex]?.temperatureC;
    if (temperatureC === undefined) throw new Error("Thermal tile coverage is incomplete.");
    if (trustedThermalTiles) {
      assertFinite(temperatureC, "Thermal tile temperature");
    } else {
      assertThermalTileCoverage(facility, tileIndex);
    }
    if (temperatureC > maximumTemperatureC) maximumTemperatureC = temperatureC;
  }
  assertFinite(maximumTemperatureC, "sampled maximum temperature");
  return normalizeZero(maximumTemperatureC);
}

function prepareFacilityModules(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  scratch?: FacilityOverclockCalculationScratch,
): readonly PreparedFacilityModule[] {
  const trustedTopology = scratch?.topology === topology;
  if (trustedTopology) {
    const tileCount = facility.size.width * facility.size.height;
    if (
      topology.layoutRevision !== facility.liveLayoutRevision ||
      topology.facilityWidth !== facility.size.width ||
      topology.facilityHeight !== facility.size.height ||
      topology.tileCount !== tileCount
    ) {
      throw new Error("Thermal topology is incompatible with the current facility layout.");
    }
  } else {
    assertTopologyCompatibility(facility, topology);
  }
  const reusable = scratch?.preparedModules;
  if (reusable !== undefined && reusable.length !== topology.modules.length) {
    throw new RangeError("Overclock calculation scratch must match topology module coverage.");
  }
  const prepared: PreparedFacilityModule[] = reusable ?? [];
  for (let index = 0; index < topology.modules.length; index += 1) {
    const topologyModule = topology.modules[index];
    if (topologyModule === undefined) {
      throw new Error("Thermal topology module coverage is incomplete.");
    }
    const module = facility.modules[topologyModule.moduleId];
    const definition = content.modules[topologyModule.definitionId];
    const reusableModule = reusable?.[index];
    const reusableModuleMatches =
      reusableModule?.moduleId === undefined ||
      (reusableModule.moduleId === topologyModule.moduleId &&
        reusableModule.definition === definition);
    if (definition === undefined) {
      throw new Error("Thermal topology references unknown module content.");
    }
    if (
      module?.id !== topologyModule.moduleId ||
      definition.id !== topologyModule.definitionId ||
      !reusableModuleMatches ||
      topology.occupiedTileIndexesByModule[topologyModule.moduleId] !==
        topologyModule.occupiedTileIndexes
    ) {
      throw new Error("Thermal topology has incompatible module or content coverage.");
    }
    assertThermalThresholds(definition.thermal);
    assertNonnegativeSafeInteger(module.startupTicksRemaining, "startupTicksRemaining");
    assertNonnegativeSafeInteger(module.cooldownTicksRemaining, "cooldownTicksRemaining");
    const sampledTemperatureC = samplePreparedModuleMaximumTemperature(
      facility,
      topologyModule.occupiedTileIndexes,
      trustedTopology,
    );
    const dynamicPowerFactor = calculateModuleDynamicPowerFactor(definition, module.overclock);
    if (module.operationalState !== "shutdown") {
      assertFinitePositive(definition.stableFrequencyRatio, "stableFrequencyRatio");
      assertFinitePositive(module.binStabilityRatio, "binStabilityRatio");
      assertFinitePositive(module.overclock.frequencyRatio, "frequencyRatio");
      assertFinitePositive(module.overclock.voltageRatio, "voltageRatio");
      assertFinitePositive(
        definition.stableFrequencyRatio * module.binStabilityRatio * module.overclock.voltageRatio,
        "supportedFrequencyRatio",
      );
    }
    if (reusableModule === undefined) {
      prepared.push({
        moduleId: topologyModule.moduleId,
        definition,
        sampledTemperatureC,
        dynamicPowerFactor,
      });
    } else {
      reusableModule.sampledTemperatureC = sampledTemperatureC;
      reusableModule.dynamicPowerFactor = dynamicPowerFactor;
    }
  }
  if (scratch !== undefined) scratch.facilityIdentity = facility;
  return prepared;
}

function transitionModuleForTemperature(
  module: Readonly<ModuleInstanceState>,
  definition: DeepReadonly<ModuleDefinition>,
  sampledTemperatureC: number,
): ModuleInstanceState {
  if (
    (module.operationalState === "starting" ||
      module.operationalState === "online" ||
      module.operationalState === "brownout") &&
    sampledTemperatureC >= definition.thermal.shutdownC
  ) {
    return {
      ...module,
      operationalState: "shutdown",
      cooldownTicksRemaining: definition.cooldownTicks,
    };
  }
  if (
    module.operationalState === "shutdown" &&
    sampledTemperatureC <= definition.thermal.warningMaxC
  ) {
    const cooldownTicksRemaining = Math.max(0, module.cooldownTicksRemaining - 1);
    return cooldownTicksRemaining === 0
      ? {
          ...module,
          operationalState: "offline",
          cooldownTicksRemaining: 0,
          startupTicksRemaining: definition.startupTicks,
        }
      : { ...module, cooldownTicksRemaining };
  }
  return module;
}

function applyPreparedThermalLifecycleTransitions(
  modules: Record<string, ModuleInstanceState>,
  prepared: readonly PreparedFacilityModule[],
): Record<string, ModuleInstanceState> {
  let nextModules: Record<string, ModuleInstanceState> | undefined;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    if (item === undefined) throw new Error("Prepared module coverage is incomplete.");
    const module = modules[item.moduleId];
    if (module?.id !== item.moduleId || module.definitionId !== item.definition.id) {
      throw new Error("Lifecycle module coverage is incompatible with the thermal topology.");
    }
    const next = transitionModuleForTemperature(module, item.definition, item.sampledTemperatureC);
    if (next !== module) {
      nextModules ??= { ...modules };
      nextModules[item.moduleId] = next;
    }
  }
  return nextModules ?? modules;
}

export function sampleModuleMaximumTemperature(
  facility: Readonly<FacilityState>,
  topology: Readonly<ThermalTopology>,
  moduleId: string,
): number {
  assertTopologyCompatibility(facility, topology);
  return sampleModuleMaximumTemperatureUnchecked(facility, topology, moduleId);
}

export function applyThermalLifecycleTransitions(
  modules: Record<string, ModuleInstanceState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  facility: Readonly<FacilityState>,
): Record<string, ModuleInstanceState> {
  if (stableModuleIds(modules).join("\u0000") !== topology.moduleIds.join("\u0000")) {
    throw new Error("Lifecycle modules must exactly match thermal topology coverage.");
  }
  const prepared = prepareFacilityModules(facility, content, topology);
  return applyPreparedThermalLifecycleTransitions(modules, prepared);
}

export function calculateFacilityOverclockResult(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  scratch?: FacilityOverclockCalculationScratch,
): FacilityOverclockCalculation {
  const prepared = prepareFacilityModules(facility, content, topology, scratch);
  const modules = applyPreparedThermalLifecycleTransitions(facility.modules, prepared);
  const byModule: Record<string, ModuleOverclockResultState> = {};
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    if (item === undefined) throw new Error("Prepared module coverage is incomplete.");
    const module = modules[item.moduleId];
    if (module?.id !== item.moduleId)
      throw new Error("Overclock lifecycle result coverage is incomplete.");
    if (module.operationalState === "shutdown") {
      byModule[item.moduleId] = {
        moduleInstanceId: item.moduleId,
        profile: module.overclock.profile,
        requestedFrequencyRatio: module.overclock.frequencyRatio,
        requestedVoltageRatio: module.overclock.voltageRatio,
        dynamicPowerFactor: item.dynamicPowerFactor,
        sampledTemperatureC: item.sampledTemperatureC,
        thermalFactor: 0,
        retryRate: 0,
        invalidSampleRate: 1,
        stabilityFactor: 0,
        shutdownReason: "thermal",
      };
      continue;
    }
    const stability = calculateModuleStabilityBreakdownUnchecked(
      module,
      item.definition,
      item.sampledTemperatureC,
    );
    byModule[item.moduleId] = {
      moduleInstanceId: item.moduleId,
      profile: module.overclock.profile,
      requestedFrequencyRatio: module.overclock.frequencyRatio,
      requestedVoltageRatio: module.overclock.voltageRatio,
      dynamicPowerFactor: item.dynamicPowerFactor,
      sampledTemperatureC: item.sampledTemperatureC,
      thermalFactor: calculateModuleThermalFactorUnchecked(
        item.sampledTemperatureC,
        item.definition.thermal,
      ),
      retryRate: stability.retryRate,
      invalidSampleRate: stability.invalidSampleRate,
      stabilityFactor: stability.stabilityFactor,
      shutdownReason: null,
    };
  }
  return {
    modules,
    overclock: {
      layoutRevision: facility.liveLayoutRevision,
      thermalRevision: facility.thermalRevision,
      byModule,
    },
  };
}

function valueEqual(left: unknown, right: unknown): boolean {
  return typeof left === "number" && typeof right === "number"
    ? Object.is(left, right)
    : left === right;
}

function resultFieldsMatch(
  actual: Readonly<ModuleOverclockResultState>,
  expected: Readonly<ModuleOverclockResultState>,
): boolean {
  return (
    actual.moduleInstanceId === expected.moduleInstanceId &&
    actual.profile === expected.profile &&
    valueEqual(actual.requestedFrequencyRatio, expected.requestedFrequencyRatio) &&
    valueEqual(actual.requestedVoltageRatio, expected.requestedVoltageRatio) &&
    valueEqual(actual.dynamicPowerFactor, expected.dynamicPowerFactor) &&
    valueEqual(actual.sampledTemperatureC, expected.sampledTemperatureC) &&
    valueEqual(actual.thermalFactor, expected.thermalFactor) &&
    valueEqual(actual.retryRate, expected.retryRate) &&
    valueEqual(actual.invalidSampleRate, expected.invalidSampleRate) &&
    valueEqual(actual.stabilityFactor, expected.stabilityFactor) &&
    actual.shutdownReason === expected.shutdownReason
  );
}

function resultMatchesGeneratedModule(
  actual: Readonly<ModuleOverclockResultState>,
  module: Readonly<ModuleInstanceState>,
  prepared: Readonly<PreparedFacilityModule>,
): boolean {
  if (
    actual.moduleInstanceId !== prepared.moduleId ||
    actual.profile !== module.overclock.profile ||
    !valueEqual(actual.requestedFrequencyRatio, module.overclock.frequencyRatio) ||
    !valueEqual(actual.requestedVoltageRatio, module.overclock.voltageRatio) ||
    !valueEqual(actual.dynamicPowerFactor, prepared.dynamicPowerFactor) ||
    !valueEqual(actual.sampledTemperatureC, prepared.sampledTemperatureC)
  ) {
    return false;
  }
  if (module.operationalState === "shutdown") {
    return (
      actual.thermalFactor === 0 &&
      actual.retryRate === 0 &&
      actual.invalidSampleRate === 1 &&
      actual.stabilityFactor === 0 &&
      actual.shutdownReason === "thermal"
    );
  }
  const supportedFrequencyRatio =
    prepared.definition.stableFrequencyRatio *
    module.binStabilityRatio *
    module.overclock.voltageRatio;
  const frequencyStabilityFactor = normalizeZero(
    clamp(supportedFrequencyRatio / module.overclock.frequencyRatio, 0, 1),
  );
  const temperatureStabilityFactor = normalizeZero(
    prepared.sampledTemperatureC <= prepared.definition.thermal.warningMaxC
      ? 1
      : prepared.sampledTemperatureC < prepared.definition.thermal.shutdownC
        ? (prepared.definition.thermal.shutdownC - prepared.sampledTemperatureC) /
          (prepared.definition.thermal.shutdownC - prepared.definition.thermal.warningMaxC)
        : 0,
  );
  const retryRate = normalizeZero(clamp(1 - frequencyStabilityFactor, 0, 1));
  const remainingAfterRetries = normalizeZero(1 - retryRate);
  const invalidSampleRate = normalizeZero(
    clamp(remainingAfterRetries * (1 - temperatureStabilityFactor), 0, remainingAfterRetries),
  );
  const stabilityFactor = normalizeZero(clamp(1 - retryRate - invalidSampleRate, 0, 1));
  return (
    valueEqual(
      actual.thermalFactor,
      calculateModuleThermalFactorUnchecked(
        prepared.sampledTemperatureC,
        prepared.definition.thermal,
      ),
    ) &&
    valueEqual(actual.retryRate, retryRate) &&
    valueEqual(actual.invalidSampleRate, invalidSampleRate) &&
    valueEqual(actual.stabilityFactor, stabilityFactor) &&
    actual.shutdownReason === null
  );
}

function hasExactStableKeyCoverage(
  record: Readonly<Record<string, unknown>>,
  expectedIds: readonly string[],
): boolean {
  let index = 0;
  for (const key in record) {
    if (!Object.hasOwn(record, key) || key !== expectedIds[index]) return false;
    index += 1;
  }
  return index === expectedIds.length;
}

export function validateOverclockTickResult(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  result: Readonly<FacilityOverclockCalculation>,
): OverclockTickIssue[] {
  const issues: OverclockTickIssue[] = [];
  let expected: FacilityOverclockCalculation;
  try {
    expected = calculateFacilityOverclockResult(facility, content, topology);
  } catch (error) {
    issues.push({
      path: "overclock",
      message: error instanceof Error ? error.message : "invalid input",
    });
    return issues;
  }
  if (Object.keys(result.modules).toSorted().join("\u0000") !== topology.moduleIds.join("\u0000")) {
    issues.push({ path: "modules", message: "must cover live modules in stable ID order" });
  }
  for (const moduleId of topology.moduleIds) {
    if (JSON.stringify(result.modules[moduleId]) !== JSON.stringify(expected.modules[moduleId])) {
      issues.push({
        path: `modules.${moduleId}`,
        message: "must match the deterministic lifecycle transition",
      });
    }
  }
  if (
    result.overclock.layoutRevision !== expected.overclock.layoutRevision ||
    result.overclock.thermalRevision !== expected.overclock.thermalRevision
  ) {
    issues.push({ path: "overclock", message: "must use current layout and thermal revisions" });
  }
  const resultIds = Object.keys(result.overclock.byModule);
  if (resultIds.join("\u0000") !== topology.moduleIds.join("\u0000")) {
    issues.push({
      path: "overclock.byModule",
      message: "must cover live modules in stable ID order",
    });
  }
  for (const moduleId of topology.moduleIds) {
    const actual = result.overclock.byModule[moduleId];
    const expectedResult = expected.overclock.byModule[moduleId];
    if (
      actual === undefined ||
      expectedResult === undefined ||
      !resultFieldsMatch(actual, expectedResult)
    ) {
      issues.push({
        path: `overclock.byModule.${moduleId}`,
        message: "must match deterministic inputs",
      });
    }
  }
  return issues;
}

/**
 * Validates a just-generated result against the same current-tick inputs without building a
 * second FacilityOverclockCalculation. Stored historical results retain the stricter independent
 * validation above; the production stage uses this targeted generation check.
 */
export function validateGeneratedOverclockTickResult(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  result: Readonly<FacilityOverclockCalculation>,
  scratch?: FacilityOverclockCalculationScratch,
): OverclockTickIssue[] {
  const issues: OverclockTickIssue[] = [];
  let prepared: readonly PreparedFacilityModule[];
  try {
    prepared =
      scratch?.topology === topology && scratch.facilityIdentity === facility
        ? scratch.preparedModules
        : prepareFacilityModules(facility, content, topology, scratch);
  } catch (error) {
    issues.push({
      path: "overclock",
      message: error instanceof Error ? error.message : "invalid input",
    });
    return issues;
  }
  const expectedModules = applyPreparedThermalLifecycleTransitions(facility.modules, prepared);
  if (!hasExactStableKeyCoverage(result.modules, topology.moduleIds)) {
    issues.push({ path: "modules", message: "must cover live modules in stable ID order" });
  }
  if (
    result.overclock.layoutRevision !== facility.liveLayoutRevision ||
    result.overclock.thermalRevision !== facility.thermalRevision
  ) {
    issues.push({ path: "overclock", message: "must use current layout and thermal revisions" });
  }
  if (!hasExactStableKeyCoverage(result.overclock.byModule, topology.moduleIds)) {
    issues.push({
      path: "overclock.byModule",
      message: "must cover live modules in stable ID order",
    });
  }
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    if (item === undefined) throw new Error("Prepared module coverage is incomplete.");
    const actualModule = result.modules[item.moduleId];
    const expectedModule = expectedModules[item.moduleId];
    if (
      actualModule !== expectedModule &&
      JSON.stringify(actualModule) !== JSON.stringify(expectedModule)
    ) {
      issues.push({
        path: `modules.${item.moduleId}`,
        message: "must match the deterministic lifecycle transition",
      });
    }
    if (expectedModule === undefined) continue;
    const actualResult = result.overclock.byModule[item.moduleId];
    if (
      actualResult === undefined ||
      !resultMatchesGeneratedModule(actualResult, expectedModule, item)
    ) {
      issues.push({
        path: `overclock.byModule.${item.moduleId}`,
        message: "must match deterministic inputs",
      });
    }
  }
  return issues;
}
