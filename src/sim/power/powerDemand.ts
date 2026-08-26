import type {
  ContentBundle,
  DeepReadonly,
  ModuleDefinition,
} from "../../content/schemas/contentSchemas.ts";
import type { ModuleInstanceState } from "../core/types.ts";

export interface ModulePowerDemand {
  readonly moduleInstanceId: string;
  readonly requestedPowerWatts: number;
  readonly minimumPowerWatts: number;
}

type MutableModulePowerDemand = {
  -readonly [Key in keyof ModulePowerDemand]: ModulePowerDemand[Key];
};

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

export function calculateModulePowerDemand(
  module: Readonly<ModuleInstanceState>,
  definition: DeepReadonly<ModuleDefinition>,
  reusableDemand?: ModulePowerDemand,
): ModulePowerDemand {
  const demand: MutableModulePowerDemand = reusableDemand ?? {
    moduleInstanceId: module.id,
    requestedPowerWatts: 0,
    minimumPowerWatts: 0,
  };
  writeModulePowerDemand(module, definition, demand);
  return demand;
}

function writeModulePowerDemand(
  module: Readonly<ModuleInstanceState>,
  definition: DeepReadonly<ModuleDefinition>,
  demand: MutableModulePowerDemand,
): void {
  if (!Number.isFinite(module.binEfficiencyRatio) || module.binEfficiencyRatio <= 0) {
    throw new RangeError("Bin efficiency ratio must be finite and positive.");
  }
  assertFiniteNonnegative(definition.idlePowerWatts, "Idle power");
  assertFiniteNonnegative(definition.loadPowerWatts, "Load power");
  if (definition.loadPowerWatts < definition.idlePowerWatts) {
    throw new RangeError("Load power must be greater than or equal to idle power.");
  }

  if (module.operationalState === "shutdown") {
    demand.moduleInstanceId = module.id;
    demand.requestedPowerWatts = 0;
    demand.minimumPowerWatts = 0;
    return;
  }

  const basePowerWatts =
    module.startupTicksRemaining > 0 ? definition.idlePowerWatts : definition.loadPowerWatts;
  const requestedPowerWatts = basePowerWatts / module.binEfficiencyRatio;
  const minimumPowerWatts = definition.idlePowerWatts / module.binEfficiencyRatio;
  assertFiniteNonnegative(requestedPowerWatts, "Requested power");
  assertFiniteNonnegative(minimumPowerWatts, "Minimum power");

  demand.moduleInstanceId = module.id;
  demand.requestedPowerWatts = normalizeZero(requestedPowerWatts);
  demand.minimumPowerWatts = normalizeZero(minimumPowerWatts);
}

export function calculatePowerDemand(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  content: ContentBundle,
  stableModuleIds: readonly string[] = Object.keys(modules).toSorted(),
  reusableDemands?: Record<string, ModulePowerDemand>,
): Record<string, ModulePowerDemand> {
  const demands = reusableDemands ?? {};
  for (const moduleId of stableModuleIds) {
    const module = modules[moduleId];
    if (module?.id !== moduleId) {
      throw new Error("Power demand module record key must match its stored ID.");
    }
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      throw new Error(`Power demand references unknown module definition: ${module.definitionId}`);
    }
    const demand = demands[moduleId] as MutableModulePowerDemand | undefined;
    if (demand === undefined) {
      demands[moduleId] = calculateModulePowerDemand(module, definition);
    } else {
      writeModulePowerDemand(module, definition, demand);
    }
  }
  return demands;
}
