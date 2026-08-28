import {
  enumerateOccupiedTiles,
  resolveRotatedFootprintSize,
} from "../../src/grid/domain/footprintGeometry.ts";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type {
  GameState,
  ModuleInstanceState,
  Rotation,
  RouteState,
} from "../../src/sim/core/types.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";

export const THERMAL_PERFORMANCE_WIDTH = 24;
export const THERMAL_PERFORMANCE_HEIGHT = 16;
export const THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES = 288;
export const thermalPerformanceContent = loadContentBundle();

interface ModulePlan {
  readonly definitionId: string;
  readonly rotation: Rotation;
  readonly operationalState?: ModuleInstanceState["operationalState"];
  readonly startupTicksRemaining?: number;
}

const MIXED_MODULE_PLANS: readonly ModulePlan[] = [
  { definitionId: "module-room-cooling", rotation: 0 },
  { definitionId: "module-line-printer", rotation: 90 },
  { definitionId: "module-arithmetic-unit", rotation: 180 },
  { definitionId: "module-vacuum-tube-logic", rotation: 270 },
  { definitionId: "module-delay-line-memory", rotation: 0 },
  { definitionId: "module-accumulator-register", rotation: 90 },
  { definitionId: "module-air-mover", rotation: 180 },
  { definitionId: "module-data-relay", rotation: 270 },
  { definitionId: "module-control-unit", rotation: 0 },
  { definitionId: "module-punch-card-reader", rotation: 90 },
  { definitionId: "module-paper-tape-reader", rotation: 180 },
  { definitionId: "module-air-mover", rotation: 270 },
  { definitionId: "module-data-relay", rotation: 0, operationalState: "brownout" },
  {
    definitionId: "module-vacuum-tube-logic",
    rotation: 90,
    operationalState: "starting",
    startupTicksRemaining: 2,
  },
];

function createModule(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
  rotation: Rotation,
  overrides: Partial<ModuleInstanceState> = {},
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position,
    rotation,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
    ...overrides,
  };
}

function firstFreePosition(
  definitionId: string,
  rotation: Rotation,
  occupied: Set<string>,
): { x: number; y: number } | undefined {
  const definition = thermalPerformanceContent.modules[definitionId];
  if (definition === undefined)
    throw new Error(`Missing thermal fixture definition ${definitionId}.`);
  const footprint = resolveRotatedFootprintSize(definition.footprint, rotation);
  for (let y = 0; y <= THERMAL_PERFORMANCE_HEIGHT - footprint.height; y += 1) {
    for (let x = 0; x <= THERMAL_PERFORMANCE_WIDTH - footprint.width; x += 1) {
      const tiles = enumerateOccupiedTiles({ x, y }, definition.footprint, rotation);
      if (tiles.every((tile) => !occupied.has(`${tile.x},${tile.y}`))) return { x, y };
    }
  }
  return undefined;
}

function occupyModule(module: ModuleInstanceState, occupied: Set<string>): number {
  const definition = thermalPerformanceContent.modules[module.definitionId];
  if (definition === undefined)
    throw new Error(`Missing thermal fixture definition ${module.definitionId}.`);
  const tiles = enumerateOccupiedTiles(module.position, definition.footprint, module.rotation);
  for (const tile of tiles) occupied.add(`${tile.x},${tile.y}`);
  return tiles.length;
}

function powerRoute(
  id: string,
  sourceId: string,
  sinkId: string,
  sinkPortId: string,
  capacityPerSecond: number,
): RouteState {
  return {
    id,
    kind: "power",
    from: { moduleInstanceId: sourceId, portId: "power-out-east" },
    to: { moduleInstanceId: sinkId, portId: sinkPortId },
    path: [],
    capacityPerSecond,
    congestionRatio: 0,
  };
}

function sinkPowerPortId(definitionId: string): string {
  const definition = thermalPerformanceContent.modules[definitionId];
  const port = definition?.ports.find((candidate) => candidate.kind === "power-in");
  if (port === undefined)
    throw new Error(`Thermal fixture module ${definitionId} lacks power input.`);
  return port.id;
}

function sinkRouteCapacity(definitionId: string): number {
  const definition = thermalPerformanceContent.modules[definitionId];
  const port = definition?.ports.find((candidate) => candidate.kind === "power-in");
  if (port === undefined)
    throw new Error(`Thermal fixture module ${definitionId} lacks power input.`);
  return Math.min(port.capacityPerSecond, 1_800);
}

function createRoutes(
  modules: Readonly<Record<string, ModuleInstanceState>>,
): Record<string, RouteState> {
  const sourceIds = Object.keys(modules)
    .filter((id) => id.startsWith("source-"))
    .toSorted();
  const sinkIds = Object.keys(modules)
    .filter((id) => !id.startsWith("source-"))
    .toSorted();
  const routes: Record<string, RouteState> = {};
  for (const [index, sinkId] of sinkIds.entries()) {
    const sink = modules[sinkId];
    const sourceId = sourceIds[index % sourceIds.length];
    if (sink === undefined || sourceId === undefined)
      throw new Error("Thermal fixture route coverage is incomplete.");
    const routeId = `power-route-${String(index).padStart(3, "0")}`;
    routes[routeId] = powerRoute(
      routeId,
      sourceId,
      sinkId,
      sinkPowerPortId(sink.definitionId),
      sinkRouteCapacity(sink.definitionId),
    );
  }
  const sharedSinkId = sinkIds[0];
  const secondarySourceId = sourceIds[1];
  const sharedSink = sharedSinkId === undefined ? undefined : modules[sharedSinkId];
  if (sharedSinkId === undefined || secondarySourceId === undefined || sharedSink === undefined) {
    throw new Error("Thermal fixture shared-capacity route coverage is incomplete.");
  }
  routes["power-route-shared-sink"] = powerRoute(
    "power-route-shared-sink",
    secondarySourceId,
    sharedSinkId,
    sinkPowerPortId(sharedSink.definitionId),
    sinkRouteCapacity(sharedSink.definitionId),
  );
  return routes;
}

export function createThermalPerformanceFixture(seed: string): GameState {
  const state = createInitialGameState({ content: thermalPerformanceContent, seed });
  const modules: Record<string, ModuleInstanceState> = {};
  const occupied = new Set<string>();
  let occupiedTileCount = 0;
  const sourceRotations: readonly Rotation[] = [0, 90, 180, 270];
  for (const [index, rotation] of sourceRotations.entries()) {
    const position = firstFreePosition("module-power-distribution", rotation, occupied);
    if (position === undefined) throw new Error("Thermal fixture cannot place power source.");
    const id = `source-${String(index).padStart(2, "0")}`;
    const source = createModule(id, "module-power-distribution", position, rotation, {
      operationalState: index === 3 ? "starting" : "online",
      startupTicksRemaining: index === 3 ? 2 : 0,
    });
    modules[id] = source;
    occupiedTileCount += occupyModule(source, occupied);
  }

  for (let index = 0; occupiedTileCount < 300; index += 1) {
    const plan = MIXED_MODULE_PLANS[index % MIXED_MODULE_PLANS.length];
    if (plan === undefined) throw new Error("Thermal fixture module plan is incomplete.");
    const position = firstFreePosition(plan.definitionId, plan.rotation, occupied);
    if (position === undefined) throw new Error("Thermal fixture cannot reach dense occupancy.");
    const id = `thermal-${String(index).padStart(3, "0")}`;
    const module = createModule(id, plan.definitionId, position, plan.rotation, {
      ...(plan.operationalState === undefined ? {} : { operationalState: plan.operationalState }),
      ...(plan.startupTicksRemaining === undefined
        ? {}
        : { startupTicksRemaining: plan.startupTicksRemaining }),
    });
    modules[id] = module;
    occupiedTileCount += occupyModule(module, occupied);
  }

  state.facility.modules = modules;
  state.facility.routes = createRoutes(modules);
  state.facility.contractedPowerWatts = 60_000;
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  state.facility.thermalTiles = state.facility.thermalTiles.map((tile) => ({
    position: tile.position,
    temperatureC: 16 + ((tile.position.x * 3 + tile.position.y * 5) % 19),
  }));
  return state;
}

/**
 * Extends (without reducing) the audited Task 7 fixture with all approved Overclock profiles.
 * This fixture is diagnostic-only; the canonical Task 7 fixture remains unchanged above.
 */
export function createTask8PerformanceFixture(seed: string): GameState {
  const state = createThermalPerformanceFixture(seed);
  const eligibleIds = Object.keys(state.facility.modules)
    .toSorted()
    .filter((moduleId) => {
      const module = state.facility.modules[moduleId];
      return (
        module !== undefined &&
        thermalPerformanceContent.modules[module.definitionId]?.overclockable
      );
    });
  const eligibleDefinitionIds = new Set(
    eligibleIds.map((moduleId) => state.facility.modules[moduleId]?.definitionId),
  );
  for (const definitionId of [
    "module-vacuum-tube-logic",
    "module-arithmetic-unit",
    "module-control-unit",
  ]) {
    if (!eligibleDefinitionIds.has(definitionId)) {
      throw new Error(`Task 8 performance fixture lacks ${definitionId}.`);
    }
  }
  const manual = thermalPerformanceContent.balancing.overclock.manual;
  const manualFrequencyRatio =
    manual.frequencyRatioMin + (manual.frequencyRatioMax - manual.frequencyRatioMin) * 0.63;
  const manualVoltageRatio =
    manual.voltageRatioMin + (manual.voltageRatioMax - manual.voltageRatioMin) * 0.37;
  state.facility.modules = Object.fromEntries(
    Object.entries(state.facility.modules).map(([moduleId, module]) => {
      const eligibleIndex = eligibleIds.indexOf(moduleId);
      if (eligibleIndex < 0) return [moduleId, module];
      const overclock =
        eligibleIndex === 0
          ? { profile: "eco" as const, frequencyRatio: 0.8, voltageRatio: 0.9 }
          : eligibleIndex === 1
            ? { profile: "boost" as const, frequencyRatio: 1.25, voltageRatio: 1.1 }
            : eligibleIndex === 2
              ? {
                  profile: "manual" as const,
                  frequencyRatio: manualFrequencyRatio,
                  voltageRatio: manualVoltageRatio,
                }
              : { profile: "balanced" as const, frequencyRatio: 1, voltageRatio: 1 };
      return [moduleId, { ...module, overclock }];
    }),
  );
  return state;
}
