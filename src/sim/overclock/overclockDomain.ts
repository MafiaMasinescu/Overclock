import type { DeepReadonly, ModuleDefinition } from "../../content/schemas/contentSchemas.ts";
import type { OverclockSettings } from "../core/types.ts";

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive.`);
  }
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

function assertLoadPowerContract(definition: DeepReadonly<ModuleDefinition>): void {
  assertFiniteNonnegative(definition.idlePowerWatts, "Idle power");
  assertFiniteNonnegative(definition.loadPowerWatts, "Load power");
  if (definition.loadPowerWatts < definition.idlePowerWatts) {
    throw new RangeError("Load power must be greater than or equal to idle power.");
  }
}

export function calculateDynamicPowerFactor(settings: Readonly<OverclockSettings>): number {
  assertFinitePositive(settings.frequencyRatio, "Frequency ratio");
  assertFinitePositive(settings.voltageRatio, "Voltage ratio");
  const dynamicPowerFactor = settings.voltageRatio ** 2 * settings.frequencyRatio;
  assertFinitePositive(dynamicPowerFactor, "Dynamic Power Factor");
  return dynamicPowerFactor;
}

export function calculateModuleDynamicPowerFactor(
  definition: DeepReadonly<ModuleDefinition>,
  settings: Readonly<OverclockSettings>,
): number {
  if (
    !definition.overclockable &&
    (settings.profile !== "balanced" ||
      settings.frequencyRatio !== 1 ||
      settings.voltageRatio !== 1)
  ) {
    throw new RangeError("Ineligible modules must retain Balanced overclock settings.");
  }
  return calculateDynamicPowerFactor(settings);
}

export function calculateEffectiveLoadPowerWatts(
  definition: DeepReadonly<ModuleDefinition>,
  dynamicPowerFactor: number,
): number {
  assertLoadPowerContract(definition);
  assertFinitePositive(dynamicPowerFactor, "Dynamic Power Factor");
  const effectiveLoadPowerWatts = Math.max(
    definition.idlePowerWatts,
    definition.loadPowerWatts * dynamicPowerFactor,
  );
  assertFiniteNonnegative(effectiveLoadPowerWatts, "Effective load power");
  return effectiveLoadPowerWatts === 0 ? 0 : effectiveLoadPowerWatts;
}

export function calculateEffectiveFullLoadPowerWatts(
  definition: DeepReadonly<ModuleDefinition>,
  binEfficiencyRatio: number,
  dynamicPowerFactor: number,
): number {
  assertFinitePositive(binEfficiencyRatio, "Bin efficiency ratio");
  const effectiveFullLoadPowerWatts =
    calculateEffectiveLoadPowerWatts(definition, dynamicPowerFactor) / binEfficiencyRatio;
  assertFiniteNonnegative(effectiveFullLoadPowerWatts, "Effective full-load power");
  return effectiveFullLoadPowerWatts === 0 ? 0 : effectiveFullLoadPowerWatts;
}
