import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import {
  enumerateOccupiedTiles,
  isGridPointInBounds,
} from "../../grid/domain/footprintGeometry.ts";
import { resolveModulePortGeometry, type PortSide } from "../../grid/domain/portGeometry.ts";
import type { FacilityState, ModuleInstanceState, ThermalTileState } from "../core/types.ts";
import {
  calculateEffectiveFullLoadPowerWatts,
  calculateModuleDynamicPowerFactor,
} from "../overclock/overclockDomain.ts";
import type {
  ThermalGeneration,
  ThermalGenerationScratch,
  ThermalIssue,
  ThermalModuleTopology,
  ThermalTickResult,
  ThermalTopology,
  ThermalUpdate,
  ThermalUpdateBalancingContract,
  ThermalUpdateScratch,
} from "./contracts.ts";
import { validateThermalState } from "./thermalState.ts";

const CARDINAL_DIRECTIONS: Readonly<Record<PortSide, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

function assertModuleFiniteNonnegative(
  value: number,
  label: "Power delivery" | "Power Factor" | "Generated heat" | "Effective cooling",
  moduleId: string,
): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} for ${moduleId} must be finite and nonnegative.`);
  }
}

function assertModuleFinitePositive(
  value: number,
  moduleId: string,
  field: "binEfficiencyRatio" | "binThermalRatio",
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Module ${moduleId} ${field} must be finite and positive.`);
  }
}

function almostEqual(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <= Number.EPSILON * 64 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function assertTopologyCompatibility(
  facility: Readonly<FacilityState>,
  topology: Readonly<ThermalTopology>,
): void {
  if (
    topology.layoutRevision !== facility.liveLayoutRevision ||
    topology.facilityWidth !== facility.size.width ||
    topology.facilityHeight !== facility.size.height ||
    topology.tileCount !== facility.size.width * facility.size.height
  ) {
    throw new Error("Thermal topology is incompatible with the live facility layout.");
  }
}

function assertScratchLength(length: number, expected: number, label: string): void {
  if (length !== expected) {
    throw new RangeError(`${label} must exactly match thermal tile coverage.`);
  }
}

function activeForThermal(
  module: Readonly<ModuleInstanceState>,
  deliveredPowerWatts: number,
): boolean {
  return (
    module.operationalState !== "offline" &&
    module.operationalState !== "shutdown" &&
    deliveredPowerWatts > 0
  );
}

function powerRatio(effectiveFullLoadPowerWatts: number, deliveredPowerWatts: number): number {
  assertFiniteNonnegative(effectiveFullLoadPowerWatts, "effectiveFullLoadPowerWatts");
  assertFiniteNonnegative(deliveredPowerWatts, "deliveredPowerWatts");
  if (effectiveFullLoadPowerWatts === 0) return deliveredPowerWatts === 0 ? 0 : 1;
  return clamp(deliveredPowerWatts / effectiveFullLoadPowerWatts, 0, 1);
}

function airflowRayTileIndexes(
  origin: Readonly<{ x: number; y: number }>,
  facing: PortSide,
  rangeTiles: number,
  facility: Readonly<FacilityState>,
): number[] {
  const direction = CARDINAL_DIRECTIONS[facing];
  const indexes: number[] = [];
  for (let distance = 0; distance < rangeTiles; distance += 1) {
    const tile = {
      x: origin.x + direction[0] * distance,
      y: origin.y + direction[1] * distance,
    };
    if (isGridPointInBounds(tile, facility.size)) {
      indexes.push(tile.y * facility.size.width + tile.x);
    }
  }
  return indexes;
}

export function buildThermalTopology(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
): ThermalTopology {
  const moduleIds = Object.keys(facility.modules).toSorted();
  const moduleIndexById: Record<string, number> = {};
  const occupiedTileIndexesByModule: Record<string, readonly number[]> = {};
  const modules: ThermalModuleTopology[] = [];
  const extractionModuleIndexes: number[] = [];
  const occupiedTileIndexes = new Set<number>();

  for (const [moduleIndex, moduleId] of moduleIds.entries()) {
    const module = facility.modules[moduleId];
    if (module?.id !== moduleId) {
      throw new Error("Thermal topology module record key must match its stored ID.");
    }
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      throw new Error(`Thermal topology module ${moduleId} references unknown content.`);
    }
    const moduleOccupiedTileIndexes = enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    ).map((tile) => {
      if (!isGridPointInBounds(tile, facility.size)) {
        throw new RangeError(`Thermal topology module ${moduleId} footprint is out of bounds.`);
      }
      const index = tile.y * facility.size.width + tile.x;
      if (occupiedTileIndexes.has(index)) {
        throw new Error("Thermal topology module footprints must not overlap.");
      }
      occupiedTileIndexes.add(index);
      return index;
    });
    if (moduleOccupiedTileIndexes.length === 0) {
      throw new Error(`Thermal topology module ${moduleId} must occupy at least one tile.`);
    }
    const thermalBehavior = definition.thermalBehavior;
    const airflowRays =
      thermalBehavior.role === "local-airflow"
        ? resolveModulePortGeometry(module, definition)
            .ports.filter((port) => port.kind === "airflow")
            .map((port) => ({
              portId: port.portId,
              tileIndexes: Object.freeze(
                airflowRayTileIndexes(
                  port.adjacentTile,
                  port.facingSide,
                  thermalBehavior.rangeTiles,
                  facility,
                ),
              ),
            }))
        : [];
    if (thermalBehavior.role === "local-airflow" && airflowRays.length === 0) {
      throw new Error(`Thermal topology module ${moduleId} has no airflow ports.`);
    }
    const topologyModule: ThermalModuleTopology = {
      moduleId,
      definitionId: definition.id,
      behaviorRole: definition.thermalBehavior.role,
      occupiedTileIndexes: Object.freeze(moduleOccupiedTileIndexes),
      airflowRays: Object.freeze(airflowRays),
    };
    moduleIndexById[moduleId] = moduleIndex;
    occupiedTileIndexesByModule[moduleId] = topologyModule.occupiedTileIndexes;
    modules.push(Object.freeze(topologyModule));
    if (topologyModule.behaviorRole === "extraction") extractionModuleIndexes.push(moduleIndex);
  }

  return Object.freeze({
    layoutRevision: facility.liveLayoutRevision,
    facilityWidth: facility.size.width,
    facilityHeight: facility.size.height,
    tileCount: facility.size.width * facility.size.height,
    moduleIds: Object.freeze(moduleIds),
    modules: Object.freeze(modules),
    moduleIndexById: Object.freeze(moduleIndexById),
    extractionModuleIndexes: Object.freeze(extractionModuleIndexes),
    occupiedTileIndexesByModule: Object.freeze(occupiedTileIndexesByModule),
  });
}

export function validateThermalGeneration(
  generation: Readonly<ThermalGeneration>,
  tileCount: number,
): ThermalIssue[] {
  const issues: ThermalIssue[] = [];
  if (!Number.isSafeInteger(tileCount) || tileCount <= 0) {
    issues.push({ path: "tileCount", message: "must be a positive safe integer" });
    return issues;
  }
  const heatWattsOnTile = generation.heatWattsOnTile;
  let validDistributedHeat = heatWattsOnTile.length === tileCount;
  let distributedHeatWatts = 0;
  if (!validDistributedHeat) {
    issues.push({
      path: "generation.heatWattsOnTile",
      message: "must cover every thermal tile",
    });
  }
  for (let index = 0; index < heatWattsOnTile.length; index += 1) {
    const value = heatWattsOnTile[index];
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      validDistributedHeat = false;
      issues.push({
        path: `generation.heatWattsOnTile[${index}]`,
        message: "must be finite and nonnegative",
      });
    } else {
      distributedHeatWatts += value;
    }
  }
  const localCoolingWattsOnTile = generation.localCoolingWattsOnTile;
  if (localCoolingWattsOnTile.length !== tileCount) {
    issues.push({
      path: "generation.localCoolingWattsOnTile",
      message: "must cover every thermal tile",
    });
  }
  for (let index = 0; index < localCoolingWattsOnTile.length; index += 1) {
    const value = localCoolingWattsOnTile[index];
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      issues.push({
        path: `generation.localCoolingWattsOnTile[${index}]`,
        message: "must be finite and nonnegative",
      });
    }
  }
  if (
    !Number.isFinite(generation.totalGeneratedHeatWatts) ||
    generation.totalGeneratedHeatWatts < 0
  ) {
    issues.push({
      path: "generation.totalGeneratedHeatWatts",
      message: "must be finite and nonnegative",
    });
  } else if (
    validDistributedHeat &&
    !almostEqual(distributedHeatWatts, generation.totalGeneratedHeatWatts)
  ) {
    issues.push({
      path: "generation.totalGeneratedHeatWatts",
      message: "must equal the distributed tile heat within numeric tolerance",
    });
  }
  if (
    !Number.isFinite(generation.effectiveExtractionCapacityWatts) ||
    generation.effectiveExtractionCapacityWatts < 0
  ) {
    issues.push({
      path: "generation.effectiveExtractionCapacityWatts",
      message: "must be finite and nonnegative",
    });
  }
  return issues;
}

function assertValidGeneration(generation: Readonly<ThermalGeneration>, tileCount: number): void {
  const issues = validateThermalGeneration(generation, tileCount);
  if (issues.length > 0) {
    throw new Error(
      `Invalid thermal generation:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

function calculateHeatGenerationResult(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  scratch: ThermalGenerationScratch | undefined,
  retainScratch: boolean,
): ThermalGeneration {
  assertTopologyCompatibility(facility, topology);
  const heatWattsOnTile = scratch?.heatWattsOnTile ?? new Float64Array(topology.tileCount);
  const localCoolingWattsOnTile =
    scratch?.localCoolingWattsOnTile ?? new Float64Array(topology.tileCount);
  assertScratchLength(heatWattsOnTile.length, topology.tileCount, "Heat-generation scratch");
  assertScratchLength(
    localCoolingWattsOnTile.length,
    topology.tileCount,
    "Cooling-generation scratch",
  );
  heatWattsOnTile.fill(0);
  localCoolingWattsOnTile.fill(0);

  let totalGeneratedHeatWatts = 0;
  let effectiveExtractionCapacityWatts = facility.extractionCapacityWatts;
  assertFiniteNonnegative(effectiveExtractionCapacityWatts, "Facility extraction capacity");
  for (let moduleIndex = 0; moduleIndex < topology.modules.length; moduleIndex += 1) {
    const topologyModule = topology.modules[moduleIndex];
    if (topologyModule === undefined) {
      throw new Error("Thermal topology module coverage is incomplete.");
    }
    const module = facility.modules[topologyModule.moduleId];
    const definition = content.modules[topologyModule.definitionId];
    const power = facility.power.byModule[topologyModule.moduleId];
    if (module === undefined || definition === undefined || power === undefined) {
      throw new Error(
        "Thermal generation requires complete topology, content, and Power coverage.",
      );
    }
    if (module.id !== topologyModule.moduleId || definition.id !== topologyModule.definitionId) {
      throw new Error("Thermal topology no longer matches module or content identity.");
    }
    assertModuleFiniteNonnegative(power.deliveredPowerWatts, "Power delivery", module.id);
    assertModuleFiniteNonnegative(power.powerFactor, "Power Factor", module.id);
    assertModuleFinitePositive(module.binEfficiencyRatio, module.id, "binEfficiencyRatio");
    assertModuleFinitePositive(module.binThermalRatio, module.id, "binThermalRatio");
    const dynamicPowerFactor = calculateModuleDynamicPowerFactor(definition, module.overclock);
    const effectiveFullLoadPowerWatts = calculateEffectiveFullLoadPowerWatts(
      definition,
      module.binEfficiencyRatio,
      dynamicPowerFactor,
    );
    const isActive = activeForThermal(module, power.deliveredPowerWatts);
    const ratio = isActive ? powerRatio(effectiveFullLoadPowerWatts, power.deliveredPowerWatts) : 0;
    const moduleHeatWatts = isActive
      ? (definition.heatWattsAtLoad * dynamicPowerFactor * ratio) / module.binThermalRatio
      : 0;
    assertModuleFiniteNonnegative(moduleHeatWatts, "Generated heat", module.id);
    const heatPerTile = moduleHeatWatts / topologyModule.occupiedTileIndexes.length;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
    for (
      let tileOffset = 0;
      tileOffset < topologyModule.occupiedTileIndexes.length;
      tileOffset += 1
    ) {
      const tileIndex = topologyModule.occupiedTileIndexes[tileOffset];
      if (tileIndex === undefined) throw new Error("Thermal topology tile coverage is incomplete.");
      const previousTileHeat = heatWattsOnTile[tileIndex];
      if (previousTileHeat === undefined)
        throw new Error("Thermal heat scratch coverage is incomplete.");
      heatWattsOnTile[tileIndex] = previousTileHeat + heatPerTile;
    }
    totalGeneratedHeatWatts += moduleHeatWatts;
    if (!Number.isFinite(totalGeneratedHeatWatts))
      throw new RangeError("Generated heat overflowed.");

    const effectiveCoolingWatts = isActive
      ? definition.coolingWatts * clamp(power.powerFactor, 0, 1)
      : 0;
    assertModuleFiniteNonnegative(effectiveCoolingWatts, "Effective cooling", module.id);
    if (topologyModule.behaviorRole === "local-airflow") {
      const coolingPerPort = effectiveCoolingWatts / topologyModule.airflowRays.length;
      const rangeTiles =
        definition.thermalBehavior.role === "local-airflow"
          ? definition.thermalBehavior.rangeTiles
          : 0;
      if (rangeTiles <= 0) throw new Error("Local airflow topology has no nominal range.");
      const coolingPerNominalTile = coolingPerPort / rangeTiles;
      // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
      for (let rayIndex = 0; rayIndex < topologyModule.airflowRays.length; rayIndex += 1) {
        const ray = topologyModule.airflowRays[rayIndex];
        if (ray === undefined) throw new Error("Thermal airflow ray coverage is incomplete.");
        // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
        for (let tileOffset = 0; tileOffset < ray.tileIndexes.length; tileOffset += 1) {
          const tileIndex = ray.tileIndexes[tileOffset];
          if (tileIndex === undefined) {
            throw new Error("Thermal airflow tile coverage is incomplete.");
          }
          const previousTileCooling = localCoolingWattsOnTile[tileIndex];
          if (previousTileCooling === undefined) {
            throw new Error("Thermal cooling scratch coverage is incomplete.");
          }
          localCoolingWattsOnTile[tileIndex] = previousTileCooling + coolingPerNominalTile;
        }
      }
    }
    if (topologyModule.behaviorRole === "extraction") {
      effectiveExtractionCapacityWatts += effectiveCoolingWatts;
      if (!Number.isFinite(effectiveExtractionCapacityWatts)) {
        throw new RangeError("Effective extraction capacity overflowed.");
      }
    }
    if (
      topology.extractionModuleIndexes.includes(moduleIndex) !==
      (topologyModule.behaviorRole === "extraction")
    ) {
      throw new Error("Thermal topology extraction index coverage is inconsistent.");
    }
  }

  const result: ThermalGeneration = {
    heatWattsOnTile: retainScratch
      ? (heatWattsOnTile as unknown as readonly number[])
      : Array.from(heatWattsOnTile),
    localCoolingWattsOnTile: retainScratch
      ? (localCoolingWattsOnTile as unknown as readonly number[])
      : Array.from(localCoolingWattsOnTile),
    totalGeneratedHeatWatts,
    effectiveExtractionCapacityWatts,
  };
  assertValidGeneration(result, topology.tileCount);
  return result;
}

export function calculateHeatGeneration(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  scratch?: ThermalGenerationScratch,
): ThermalGeneration {
  return calculateHeatGenerationResult(facility, content, topology, scratch, false);
}

/** Private same-tick runtime handoff. The result expires before these scratch arrays are reused. */
export function calculateHeatGenerationInScratch(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  topology: Readonly<ThermalTopology>,
  scratch: ThermalGenerationScratch,
): ThermalGeneration {
  return calculateHeatGenerationResult(facility, content, topology, scratch, true);
}

function validateUpdateInput(
  facility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
  dtSeconds: number,
): void {
  const stateIssues = validateThermalState(facility, balancing);
  if (stateIssues.length > 0) {
    throw new Error(
      `Invalid thermal state:\n${stateIssues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
  assertValidGeneration(generation, facility.thermalTiles.length);
  validateUpdateParameters(balancing, dtSeconds);
}

function validateUpdateParameters(
  balancing: Readonly<ThermalUpdateBalancingContract>,
  dtSeconds: number,
): void {
  assertFiniteNonnegative(dtSeconds, "Thermal dtSeconds");
  for (const [label, value] of [
    ["heatToTemperatureCoefficient", balancing.heatToTemperatureCoefficient],
    ["diffusionCoefficient", balancing.diffusionCoefficient],
    ["ambientRecoveryCoefficient", balancing.ambientRecoveryCoefficient],
    ["globalHeatCoefficient", balancing.globalHeatCoefficient],
  ] as const) {
    assertFiniteNonnegative(value, `Thermal ${label}`);
  }
}

function temperatureAt(tiles: readonly ThermalTileState[], index: number): number {
  const tile = tiles[index];
  if (tile === undefined) throw new Error("Thermal tile coverage is incomplete.");
  return tile.temperatureC;
}

function updateThermalStateResult(
  facility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
  dtSeconds: number,
  scratch: ThermalUpdateScratch | undefined,
  inputsAlreadyValidated: boolean,
): ThermalUpdate {
  if (inputsAlreadyValidated) validateUpdateParameters(balancing, dtSeconds);
  else validateUpdateInput(facility, generation, balancing, dtSeconds);
  const tileCount = facility.thermalTiles.length;
  const nextTemperatureC = scratch?.nextTemperatureC ?? new Float64Array(tileCount);
  assertScratchLength(nextTemperatureC.length, tileCount, "Thermal-update scratch");
  const lowerTemperatureC = Math.max(
    balancing.minimumTemperatureC,
    facility.ambientTemperatureC - 10,
  );
  const globalPressureDelta =
    Math.max(0, generation.totalGeneratedHeatWatts - generation.effectiveExtractionCapacityWatts) *
    balancing.globalHeatCoefficient *
    dtSeconds;
  if (!Number.isFinite(globalPressureDelta))
    throw new RangeError("Global heat pressure overflowed.");

  for (let index = 0; index < tileCount; index += 1) {
    const previousTemperatureC = temperatureAt(facility.thermalTiles, index);
    const x = index % facility.size.width;
    const y = Math.floor(index / facility.size.width);
    let cardinalNeighborDifference = 0;
    if (y > 0)
      cardinalNeighborDifference +=
        temperatureAt(facility.thermalTiles, index - facility.size.width) - previousTemperatureC;
    if (x + 1 < facility.size.width)
      cardinalNeighborDifference +=
        temperatureAt(facility.thermalTiles, index + 1) - previousTemperatureC;
    if (y + 1 < facility.size.height)
      cardinalNeighborDifference +=
        temperatureAt(facility.thermalTiles, index + facility.size.width) - previousTemperatureC;
    if (x > 0)
      cardinalNeighborDifference +=
        temperatureAt(facility.thermalTiles, index - 1) - previousTemperatureC;
    const heatWatts = generation.heatWattsOnTile[index];
    const coolingWatts = generation.localCoolingWattsOnTile[index];
    if (heatWatts === undefined || coolingWatts === undefined) {
      throw new Error("Thermal generation tile coverage is incomplete.");
    }
    const next = clamp(
      previousTemperatureC +
        heatWatts * balancing.heatToTemperatureCoefficient * dtSeconds -
        coolingWatts * balancing.heatToTemperatureCoefficient * dtSeconds +
        balancing.diffusionCoefficient * cardinalNeighborDifference * dtSeconds +
        globalPressureDelta +
        balancing.ambientRecoveryCoefficient *
          (facility.ambientTemperatureC - previousTemperatureC) *
          dtSeconds,
      lowerTemperatureC,
      balancing.maximumTemperatureC,
    );
    if (!Number.isFinite(next))
      throw new RangeError("Thermal update produced a non-finite temperature.");
    nextTemperatureC[index] = next;
  }

  let temperatureChanged = false;
  const thermalTiles: ThermalTileState[] = facility.thermalTiles.map((previous, index) => {
    const temperatureC = nextTemperatureC[index];
    if (temperatureC === undefined)
      throw new Error("Thermal update scratch coverage is incomplete.");
    if (temperatureC === previous.temperatureC) return previous;
    temperatureChanged = true;
    return { position: previous.position, temperatureC };
  });
  return { thermalTiles, temperatureChanged };
}

export function updateThermalState(
  facility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
  dtSeconds: number,
  scratch?: ThermalUpdateScratch,
): ThermalUpdate {
  return updateThermalStateResult(facility, generation, balancing, dtSeconds, scratch, false);
}

/** Private same-transaction path after stage-one facility and generation validation. */
export function updateThermalStateFromValidatedInputs(
  facility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
  dtSeconds: number,
  scratch: ThermalUpdateScratch,
): ThermalUpdate {
  return updateThermalStateResult(facility, generation, balancing, dtSeconds, scratch, true);
}

export function assertValidThermalTickResult(
  previousFacility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  update: Readonly<ThermalUpdate>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
): asserts update is ThermalUpdate {
  const previousIssues = validateThermalState(previousFacility, balancing);
  if (previousIssues.length > 0) {
    throw new Error(
      `Invalid previous thermal state:\n${previousIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  assertValidThermalUpdateOutput(previousFacility, generation, update, balancing);
}

/**
 * Validates the generation and write-generation output after `updateThermalState` has already
 * validated its read-generation input. SimCore uses this targeted check to avoid revalidating
 * immutable module and prior-tile branches in the same production stage.
 */
function assertValidThermalUpdateOutputResult(
  previousFacility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  update: Readonly<ThermalUpdate>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
  generationAlreadyValidated: boolean,
): asserts update is ThermalUpdate {
  if (!generationAlreadyValidated) {
    assertValidGeneration(generation, previousFacility.thermalTiles.length);
  }
  if (update.thermalTiles.length !== previousFacility.thermalTiles.length) {
    throw new Error("Thermal tick result must preserve tile coverage.");
  }
  const lowerTemperatureC = Math.max(
    balancing.minimumTemperatureC,
    previousFacility.ambientTemperatureC - 10,
  );
  if (
    !Number.isFinite(lowerTemperatureC) ||
    !Number.isFinite(balancing.maximumTemperatureC) ||
    lowerTemperatureC > balancing.maximumTemperatureC
  ) {
    throw new Error("Thermal tick result requires finite ordered clamp bounds.");
  }
  let temperatureChanged = false;
  for (let index = 0; index < update.thermalTiles.length; index += 1) {
    const tile = update.thermalTiles[index];
    const previousTile = previousFacility.thermalTiles[index];
    if (tile === undefined || previousTile === undefined) {
      throw new Error("Thermal tick result must preserve complete tile coverage.");
    }
    const expectedX = index % previousFacility.size.width;
    const expectedY = Math.floor(index / previousFacility.size.width);
    if (tile.position.x !== expectedX || tile.position.y !== expectedY) {
      throw new Error("Thermal tick result must use exact row-major facility coverage.");
    }
    if (
      !Number.isFinite(tile.temperatureC) ||
      tile.temperatureC < lowerTemperatureC ||
      tile.temperatureC > balancing.maximumTemperatureC
    ) {
      throw new Error("Thermal tick result temperature must remain within resolved clamp bounds.");
    }
    if (tile.temperatureC !== previousTile.temperatureC) temperatureChanged = true;
  }
  if (temperatureChanged !== update.temperatureChanged) {
    throw new Error("Thermal tick result must report exact authoritative temperature changes.");
  }
}

export function assertValidThermalUpdateOutput(
  previousFacility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  update: Readonly<ThermalUpdate>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
): asserts update is ThermalUpdate {
  assertValidThermalUpdateOutputResult(previousFacility, generation, update, balancing, false);
}

/** Private same-transaction output check after stage-one generation validation. */
export function assertValidThermalUpdateOutputFromValidatedGeneration(
  previousFacility: Readonly<FacilityState>,
  generation: Readonly<ThermalGeneration>,
  update: Readonly<ThermalUpdate>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
): asserts update is ThermalUpdate {
  assertValidThermalUpdateOutputResult(previousFacility, generation, update, balancing, true);
}

export function assertValidThermalTickResultObject(
  previousFacility: Readonly<FacilityState>,
  result: Readonly<ThermalTickResult>,
  balancing: Readonly<ThermalUpdateBalancingContract>,
): void {
  assertValidThermalTickResult(previousFacility, result.generation, result.update, balancing);
}
