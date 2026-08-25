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
): ModulePowerDemand {
  if (!Number.isFinite(module.binEfficiencyRatio) || module.binEfficiencyRatio <= 0) {
    throw new RangeError("Bin efficiency ratio must be finite and positive.");
  }
  assertFiniteNonnegative(definition.idlePowerWatts, "Idle power");
  assertFiniteNonnegative(definition.loadPowerWatts, "Load power");
  if (definition.loadPowerWatts < definition.idlePowerWatts) {
    throw new RangeError("Load power must be greater than or equal to idle power.");
  }

  if (module.operationalState === "shutdown") {
    return {
      moduleInstanceId: module.id,
      requestedPowerWatts: 0,
      minimumPowerWatts: 0,
    };
  }

  const basePowerWatts =
    module.startupTicksRemaining > 0 ? definition.idlePowerWatts : definition.loadPowerWatts;
  const requestedPowerWatts = basePowerWatts / module.binEfficiencyRatio;
  const minimumPowerWatts = definition.idlePowerWatts / module.binEfficiencyRatio;
  assertFiniteNonnegative(requestedPowerWatts, "Requested power");
  assertFiniteNonnegative(minimumPowerWatts, "Minimum power");

  return {
    moduleInstanceId: module.id,
    requestedPowerWatts: normalizeZero(requestedPowerWatts),
    minimumPowerWatts: normalizeZero(minimumPowerWatts),
  };
}

export function calculatePowerDemand(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  content: ContentBundle,
): Record<string, ModulePowerDemand> {
  const demands: Record<string, ModulePowerDemand> = {};
  for (const moduleId of Object.keys(modules).toSorted()) {
    const module = modules[moduleId];
    if (module?.id !== moduleId) {
      throw new Error("Power demand module record key must match its stored ID.");
    }
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      throw new Error(`Power demand references unknown module definition: ${module.definitionId}`);
    }
    demands[moduleId] = calculateModulePowerDemand(module, definition);
  }
  return demands;
}
