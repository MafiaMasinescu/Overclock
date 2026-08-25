import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { calculateFacilityPower } from "../../src/sim/power/facilityPower.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";

export const POWER_FIXTURE_WIDTH = 24;
export const POWER_FIXTURE_HEIGHT = 16;
export const POWER_FIXTURE_MODULE_COUNT = 250;
export const POWER_FIXTURE_SOURCE_COUNT = 4;
export const POWER_FIXTURE_CONTRACTED_WATTS = 60_000;
export const powerPerformanceContent = loadContentBundle();

function module(
  id: string,
  definitionId: string,
  index: number,
  overrides: Partial<ModuleInstanceState> = {},
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: {
      x: index % POWER_FIXTURE_WIDTH,
      y: Math.floor(index / POWER_FIXTURE_WIDTH) % POWER_FIXTURE_HEIGHT,
    },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 0.5,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
    ...overrides,
  };
}

function powerRoute(
  id: string,
  sourceId: string,
  sinkId: string,
  capacityPerSecond: number,
): RouteState {
  return {
    id,
    kind: "power",
    from: { moduleInstanceId: sourceId, portId: "power-out-east" },
    to: { moduleInstanceId: sinkId, portId: "power-in-south" },
    path: [],
    capacityPerSecond,
    congestionRatio: 0,
  };
}

export function createPowerPerformanceFixture(seed: string): GameState {
  const state = createInitialGameState({ content: powerPerformanceContent, seed });
  const modules: Record<string, ModuleInstanceState> = {};
  const routes: Record<string, RouteState> = {};
  const sourceIds: string[] = [];
  for (let index = 0; index < POWER_FIXTURE_SOURCE_COUNT; index += 1) {
    const id = `source-${String(index).padStart(2, "0")}`;
    sourceIds.push(id);
    modules[id] = module(id, "module-power-distribution", index, {
      binEfficiencyRatio: 1,
      position: { x: index * 3, y: 0 },
    });
  }
  for (let index = POWER_FIXTURE_SOURCE_COUNT; index < POWER_FIXTURE_MODULE_COUNT; index += 1) {
    const id = `sink-${String(index).padStart(3, "0")}`;
    const sinkIndex = index - POWER_FIXTURE_SOURCE_COUNT;
    const startup = index % 11 === 0;
    const brownout = !startup && index % 13 === 0;
    modules[id] = module(id, "module-data-relay", index, {
      position: {
        x: sinkIndex % POWER_FIXTURE_WIDTH,
        y: 2 + Math.floor(sinkIndex / POWER_FIXTURE_WIDTH),
      },
      binEfficiencyRatio: 0.05,
      operationalState: startup ? "starting" : brownout ? "brownout" : "online",
      startupTicksRemaining: startup ? 3 : 0,
    });
    const sharedSinkCapacity = sinkIndex < 24;
    const routeLegs = sharedSinkCapacity ? 2 : 1;
    for (let leg = 0; leg < routeLegs; leg += 1) {
      const sourceIndex = leg === 1 ? 1 : sinkIndex < 76 ? 0 : sinkIndex % sourceIds.length;
      const sourceId = sourceIds[sourceIndex];
      if (sourceId === undefined) throw new Error("Power performance source fixture is missing.");
      const routeId = `route-${String(index).padStart(3, "0")}-${leg}`;
      routes[routeId] = powerRoute(routeId, sourceId, id, sharedSinkCapacity ? 200 : 350);
    }
  }
  state.facility.modules = modules;
  state.facility.routes = routes;
  state.facility.contractedPowerWatts = POWER_FIXTURE_CONTRACTED_WATTS;
  state.facility.power = createDirtyPowerState(POWER_FIXTURE_CONTRACTED_WATTS);
  return state;
}

export const POWER_FIXTURE_ROUTE_COUNT =
  POWER_FIXTURE_MODULE_COUNT - POWER_FIXTURE_SOURCE_COUNT + 24;

export function assertPowerPerformanceFixtureExercisesConstraints(): void {
  const fixture = createPowerPerformanceFixture("power-performance-audit");
  const calculation = calculateFacilityPower(fixture, powerPerformanceContent);
  if (calculation.power.totalDeliveredPowerWatts !== POWER_FIXTURE_CONTRACTED_WATTS) {
    throw new Error("Power performance fixture must exhaust contracted capacity.");
  }
  const sourceFlow = Object.entries(calculation.power.byRoute)
    .filter(([routeId]) => fixture.facility.routes[routeId]?.from.moduleInstanceId === "source-00")
    .reduce((total, [, result]) => total + result.deliveredPowerWatts, 0);
  if (sourceFlow !== 18_000) {
    throw new Error("Power performance fixture must exhaust a shared source-output port.");
  }
  const sharedSinkRoutes = [
    calculation.power.byRoute["route-004-0"],
    calculation.power.byRoute["route-004-1"],
  ];
  if (
    sharedSinkRoutes.some((result) => result === undefined || result.deliveredPowerWatts <= 0) ||
    sharedSinkRoutes.reduce((total, result) => total + (result?.deliveredPowerWatts ?? 0), 0) !==
      350
  ) {
    throw new Error(
      "Power performance fixture must bind shared sink-input capacity across routes.",
    );
  }
}
