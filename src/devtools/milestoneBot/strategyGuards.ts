import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState, ModuleInstanceId } from "../../sim/core/types.ts";

export interface BoostGuardInput {
  readonly state: Readonly<GameState>;
  readonly content: ContentBundle;
  readonly moduleIds: readonly ModuleInstanceId[];
  readonly stabilityMinimum?: number;
}

function targetModules(input: BoostGuardInput) {
  return input.moduleIds.map((id) => {
    const module = input.state.facility.modules[id];
    const definition =
      module === undefined ? undefined : input.content.modules[module.definitionId];
    const overclock = input.state.facility.overclock.byModule[id];
    return { module, definition, overclock };
  });
}

export function canEnterBoost(input: BoostGuardInput): boolean {
  if (
    input.state.benchmarks.active !== null ||
    input.state.facility.designDraft !== null ||
    input.moduleIds.length === 0
  )
    return false;
  return targetModules(input).every(({ module, definition, overclock }) => {
    if (
      module === undefined ||
      definition === undefined ||
      overclock === undefined ||
      !definition.overclockable
    )
      return false;
    if (module.operationalState !== "online" && module.operationalState !== "brownout")
      return false;
    if (!(overclock.sampledTemperatureC < definition.thermal.normalMaxC)) return false;
    const minimum = input.stabilityMinimum ?? 0;
    return overclock.stabilityFactor >= Math.min(1, minimum + 0.05);
  });
}

export function mustExitBoost(input: BoostGuardInput): boolean {
  return targetModules(input).some(({ module, definition, overclock }) => {
    if (module === undefined || definition === undefined || overclock === undefined) return true;
    const minimum = input.stabilityMinimum ?? 0;
    return (
      overclock.sampledTemperatureC >= definition.thermal.warningMaxC - 2 ||
      overclock.stabilityFactor < Math.min(1, minimum + 0.02) ||
      module.operationalState === "shutdown" ||
      module.cooldownTicksRemaining > 0 ||
      overclock.shutdownReason !== null ||
      (input.state.facility.power.byModule[module.id]?.powerFactor ?? 0) <= 0
    );
  });
}

export function canReenterBoost(
  input: BoostGuardInput,
  consecutiveStableTicks: number,
  requiredTicks = 100,
): boolean {
  return (
    Number.isSafeInteger(consecutiveStableTicks) &&
    consecutiveStableTicks >= requiredTicks &&
    canEnterBoost(input)
  );
}

export function countShutdownTransitions(
  previous: Readonly<GameState> | null,
  current: Readonly<GameState>,
): number {
  if (previous === null) return 0;
  let count = 0;
  for (const [id, module] of Object.entries(current.facility.modules)) {
    if (
      module.operationalState === "shutdown" &&
      previous.facility.modules[id]?.operationalState !== "shutdown"
    )
      count += 1;
  }
  return count;
}

export function aggregateStrategyMetrics(states: readonly (Readonly<GameState> | null)[]): {
  readonly shutdownTransitions: number;
  readonly maximumTemperatureC: number;
  readonly minimumStabilityFactor: number;
} {
  let shutdownTransitions = 0;
  let maximumTemperatureC = Number.NEGATIVE_INFINITY;
  let minimumStabilityFactor = 1;
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    if (state === null) continue;
    if (state === undefined) continue;
    shutdownTransitions += countShutdownTransitions(
      index === 0 ? null : (states[index - 1] ?? null),
      state,
    );
    for (const tile of state.facility.thermalTiles)
      maximumTemperatureC = Math.max(maximumTemperatureC, tile.temperatureC);
    for (const module of Object.values(state.facility.overclock.byModule))
      minimumStabilityFactor = Math.min(minimumStabilityFactor, module.stabilityFactor);
  }
  return {
    shutdownTransitions,
    maximumTemperatureC: Number.isFinite(maximumTemperatureC) ? maximumTemperatureC : 0,
    minimumStabilityFactor,
  };
}
