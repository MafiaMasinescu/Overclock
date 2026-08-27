import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle, ModuleDefinition } from "../../src/content/schemas/contentSchemas.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type {
  FacilityState,
  GridPoint,
  ModuleInstanceState,
  ModuleOperationalState,
  ModulePowerDeliveryState,
  Rotation,
  ThermalTileState,
} from "../../src/sim/core/types.ts";
import type { ThermalGeneration } from "../../src/sim/thermal/contracts.ts";
import {
  assertValidThermalUpdateOutput,
  assertValidThermalTickResult,
  buildThermalTopology,
  calculateHeatGeneration,
  updateThermalState,
  validateThermalGeneration,
} from "../../src/sim/thermal/thermalDomain.ts";

const content = loadContentBundle();

function module(
  id: string,
  definitionId: string,
  position: GridPoint,
  rotation: Rotation = 0,
  operationalState: ModuleOperationalState = "online",
  overrides: Partial<ModuleInstanceState> = {},
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
    rotation,
    operationalState,
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: operationalState === "starting" ? 1 : 0,
    cooldownTicksRemaining: 0,
    ...overrides,
  };
}

function delivery(
  moduleInstanceId: string,
  deliveredPowerWatts: number,
  powerFactor = 1,
): ModulePowerDeliveryState {
  return {
    moduleInstanceId,
    requestedPowerWatts: deliveredPowerWatts,
    minimumPowerWatts: 0,
    deliveredPowerWatts,
    powerFactor,
    limitingReason: "none",
  };
}

function thermalTiles(width: number, height: number, temperatureC = 22): ThermalTileState[] {
  return Array.from({ length: width * height }, (_, index) => ({
    position: { x: index % width, y: Math.floor(index / width) },
    temperatureC,
  }));
}

function facility(
  width: number,
  height: number,
  modules: readonly ModuleInstanceState[] = [],
  deliveries: readonly ModulePowerDeliveryState[] = [],
): FacilityState {
  const state = createInitialGameState({ content, seed: "thermal-domain" });
  state.facility.size = { width, height };
  state.facility.thermalTiles = thermalTiles(width, height);
  state.facility.modules = Object.fromEntries(modules.map((entry) => [entry.id, entry]));
  state.facility.power = {
    ...state.facility.power,
    layoutRevision: state.facility.liveLayoutRevision,
    byModule: Object.fromEntries(deliveries.map((entry) => [entry.moduleInstanceId, entry])),
  };
  return state.facility;
}

function generation(
  tileCount: number,
  overrides: Partial<ThermalGeneration> = {},
): ThermalGeneration {
  return {
    heatWattsOnTile: Array.from({ length: tileCount }, () => 0),
    localCoolingWattsOnTile: Array.from({ length: tileCount }, () => 0),
    totalGeneratedHeatWatts: 0,
    effectiveExtractionCapacityWatts: 0,
    ...overrides,
  };
}

function withDefinitions(...definitions: readonly ModuleDefinition[]): ContentBundle {
  return {
    ...content,
    modules: {
      ...content.modules,
      ...Object.fromEntries(definitions.map((entry) => [entry.id, entry])),
    },
  };
}

function airflowDefinition(
  id: string,
  ports: ModuleDefinition["ports"],
  coolingWatts = 100,
  rangeTiles = 2,
): ModuleDefinition {
  const template = content.modules["module-air-mover"];
  if (template === undefined) throw new Error("Air mover content is missing.");
  const clonedTemplate = structuredClone(template) as ModuleDefinition;
  return {
    ...clonedTemplate,
    id,
    ports: structuredClone(ports),
    coolingWatts,
    airflowUnits: 1,
    thermalBehavior: { role: "local-airflow", rangeTiles },
  };
}

describe("pure thermal topology and generation", () => {
  test("uses operational state and delivered power for proportional heat", () => {
    const modules = [
      module("offline", "module-data-relay", { x: 0, y: 0 }, 0, "offline"),
      module("starting", "module-data-relay", { x: 1, y: 0 }, 0, "starting"),
      module("ready", "module-data-relay", { x: 2, y: 0 }),
      module("brownout", "module-data-relay", { x: 3, y: 0 }, 0, "brownout"),
      module("shutdown", "module-data-relay", { x: 4, y: 0 }, 0, "shutdown"),
    ];
    const current = facility(5, 1, modules, [
      delivery("offline", 260),
      delivery("starting", 130, 0.5),
      delivery("ready", 260),
      delivery("brownout", 65, 0.25),
      delivery("shutdown", 260),
    ]);
    const result = calculateHeatGeneration(
      current,
      content,
      buildThermalTopology(current, content),
    );

    expect(result.heatWattsOnTile).toEqual([0, 95, 190, 47.5, 0]);
    expect(result.totalGeneratedHeatWatts).toBe(332.5);
  });

  test("uses bin thermal ratios, includes cooling self-heat, and ignores airflow units", () => {
    const normal = module("normal", "module-data-relay", { x: 0, y: 0 });
    const better = module("better", "module-data-relay", { x: 1, y: 0 }, 0, "online", {
      binThermalRatio: 2,
    });
    const worse = module("worse", "module-data-relay", { x: 2, y: 0 }, 0, "online", {
      binThermalRatio: 0.5,
    });
    const cooler = module("cooler", "module-air-mover", { x: 3, y: 0 });
    const current = facility(
      8,
      2,
      [normal, better, worse, cooler],
      [
        delivery("normal", 130, 0.5),
        delivery("better", 260),
        delivery("worse", 260),
        delivery("cooler", 420),
      ],
    );
    const topology = buildThermalTopology(current, content);
    const result = calculateHeatGeneration(current, content, topology);
    const airMover = content.modules["module-air-mover"];
    if (airMover === undefined) throw new Error("Air mover content is missing.");
    const alteredAirMover = structuredClone(airMover) as ModuleDefinition;
    const alteredContent = withDefinitions({ ...alteredAirMover, airflowUnits: 999_999 });

    expect(result.heatWattsOnTile.slice(0, 4)).toEqual([95, 95, 380, 110]);
    expect(result.localCoolingWattsOnTile.slice(4, 8)).toEqual([180, 180, 180, 180]);
    expect(calculateHeatGeneration(current, alteredContent, topology)).toEqual(result);
  });

  test.each([
    { definitionId: "module-data-relay", width: 1, height: 1 },
    { definitionId: "module-vacuum-tube-logic", width: 2, height: 1 },
    { definitionId: "module-power-distribution", width: 2, height: 2 },
    { definitionId: "module-line-printer", width: 3, height: 2 },
  ])("conserves heat across the $width x $height footprint", ({ definitionId, width, height }) => {
    const entry = module("footprint", definitionId, { x: 0, y: 0 });
    const current = facility(6, 3, [entry], [delivery("footprint", 20_000)]);
    const result = calculateHeatGeneration(
      current,
      content,
      buildThermalTopology(current, content),
    );

    expect(result.heatWattsOnTile.filter((value) => value > 0)).toHaveLength(width * height);
    expect(result.heatWattsOnTile.reduce((total, value) => total + value, 0)).toBeCloseTo(
      result.totalGeneratedHeatWatts,
      12,
    );
  });

  test("builds stable topology independent of record order and maps rotated footprints", () => {
    const alpha = module("alpha", "module-line-printer", { x: 0, y: 0 }, 90);
    const beta = module("beta", "module-data-relay", { x: 3, y: 0 });
    const first = facility(5, 4, [beta, alpha], [delivery("alpha", 980), delivery("beta", 260)]);
    const second = facility(5, 4, [alpha, beta], [delivery("beta", 260), delivery("alpha", 980)]);
    const topology = buildThermalTopology(first, content);

    expect(topology.moduleIds).toEqual(["alpha", "beta"]);
    expect(topology.occupiedTileIndexesByModule["alpha"]).toEqual([0, 1, 5, 6, 10, 11]);
    expect(buildThermalTopology(second, content)).toEqual(topology);
    expect(calculateHeatGeneration(first, content, topology)).toEqual(
      calculateHeatGeneration(second, content, buildThermalTopology(second, content)),
    );
  });

  test.each([
    { rotation: 0 as const, expected: [45, 46, 47, 48] },
    { rotation: 90 as const, expected: [54, 64, 74, 84] },
    { rotation: 180 as const, expected: [43, 42, 41, 40] },
    { rotation: 270 as const, expected: [34, 24, 14, 4] },
  ])("resolves directional airflow at $rotation degrees", ({ rotation, expected }) => {
    const current = facility(
      10,
      10,
      [module("fan", "module-air-mover", { x: 4, y: 4 }, rotation)],
      [delivery("fan", 420)],
    );
    const topology = buildThermalTopology(current, content);
    const fan = topology.modules[0];
    if (fan === undefined) throw new Error("Fan topology is missing.");

    expect(fan.airflowRays[0]?.tileIndexes).toEqual(expected);
  });

  test("discards edge cooling and combines multiple port and overlapping cooling", () => {
    const dual = airflowDefinition("module-dual-airflow", [
      { id: "air-east", kind: "airflow", side: "east", offset: 0, capacityPerSecond: 1 },
      { id: "air-west", kind: "airflow", side: "west", offset: 0, capacityPerSecond: 1 },
    ]);
    const customContent = withDefinitions(dual);
    const edge = facility(4, 1, [module("edge", dual.id, { x: 3, y: 0 })], [delivery("edge", 1)]);
    const overlapping = facility(
      6,
      1,
      [module("left", dual.id, { x: 1, y: 0 }), module("right", dual.id, { x: 4, y: 0 }, 180)],
      [delivery("left", 1), delivery("right", 1)],
    );

    expect(
      calculateHeatGeneration(edge, customContent, buildThermalTopology(edge, customContent))
        .localCoolingWattsOnTile,
    ).toEqual([0, 25, 25, 0]);
    expect(
      calculateHeatGeneration(
        overlapping,
        customContent,
        buildThermalTopology(overlapping, customContent),
      ).localCoolingWattsOnTile,
    ).toEqual([25, 0, 50, 50, 0, 25]);
  });

  test("adds powered extraction at Power Factor without mutating base extraction", () => {
    const current = facility(
      4,
      3,
      [module("extract", "module-room-cooling", { x: 0, y: 0 })],
      [delivery("extract", 1_950, 0.5)],
    );
    current.extractionCapacityWatts = 100;
    const result = calculateHeatGeneration(
      current,
      content,
      buildThermalTopology(current, content),
    );

    expect(result.effectiveExtractionCapacityWatts).toBe(2_700);
    expect(current.extractionCapacityWatts).toBe(100);
    expect(result.localCoolingWattsOnTile.every((value) => value === 0)).toBe(true);
  });
});

describe("pure double-buffered thermal update", () => {
  test("uses ambient recovery at equilibrium, symmetric diffusion, and no wrapping", () => {
    const current = facility(3, 1);
    current.thermalTiles = thermalTiles(3, 1).map((tile, index) => ({
      ...tile,
      temperatureC: [20, 30, 20][index] ?? 22,
    }));
    const result = updateThermalState(
      current,
      generation(3),
      { ...content.balancing.thermal, diffusionCoefficient: 0.1, ambientRecoveryCoefficient: 0 },
      1,
    );

    expect(result.thermalTiles.map((tile) => tile.temperatureC)).toEqual([21, 28, 21]);
    expect(result.thermalTiles.reduce((sum, tile) => sum + tile.temperatureC, 0)).toBe(70);
    expect(
      updateThermalState(facility(1, 1), generation(1), content.balancing.thermal, 0.1),
    ).toEqual({ thermalTiles: thermalTiles(1, 1), temperatureChanged: false });

    const corner = facility(2, 2);
    corner.thermalTiles = thermalTiles(2, 2).map((tile, index) => ({
      ...tile,
      temperatureC: [40, 22, 22, 22][index] ?? 22,
    }));
    const cornerResult = updateThermalState(
      corner,
      generation(4),
      { ...content.balancing.thermal, diffusionCoefficient: 0.1, ambientRecoveryCoefficient: 0 },
      1,
    );
    expect(cornerResult.thermalTiles.map((tile) => tile.temperatureC)).toEqual([
      36.4, 23.8, 23.8, 22,
    ]);
  });

  test("applies heat, cooling, raw global pressure, ambient recovery, and clamps in order", () => {
    const current = facility(1, 1);
    current.ambientTemperatureC = 20;
    current.thermalTiles[0] = { position: { x: 0, y: 0 }, temperatureC: 20 };
    const result = updateThermalState(
      current,
      generation(1, {
        heatWattsOnTile: [10],
        localCoolingWattsOnTile: [1],
        totalGeneratedHeatWatts: 10,
        effectiveExtractionCapacityWatts: 4,
      }),
      {
        ...content.balancing.thermal,
        heatToTemperatureCoefficient: 1,
        diffusionCoefficient: 0,
        ambientRecoveryCoefficient: 0,
        globalHeatCoefficient: 0.5,
      },
      1,
    );
    const clampedLow = updateThermalState(
      current,
      generation(1, { localCoolingWattsOnTile: [100] }),
      { ...content.balancing.thermal, heatToTemperatureCoefficient: 1, minimumTemperatureC: 14 },
      1,
    );
    const clampedHigh = updateThermalState(
      current,
      generation(1, { heatWattsOnTile: [100], totalGeneratedHeatWatts: 100 }),
      { ...content.balancing.thermal, heatToTemperatureCoefficient: 1, maximumTemperatureC: 30 },
      1,
    );

    expect(result.thermalTiles[0]?.temperatureC).toBe(32);
    expect(clampedLow.thermalTiles[0]?.temperatureC).toBe(14);
    expect(clampedHigh.thermalTiles[0]?.temperatureC).toBe(30);
  });

  test("rejects invalid numeric input and validates public tick results", () => {
    const current = facility(1, 1);
    const validGeneration = generation(1);
    const validUpdate = updateThermalState(
      current,
      validGeneration,
      content.balancing.thermal,
      0.1,
    );

    expect(() =>
      updateThermalState(
        current,
        generation(1, { heatWattsOnTile: [Number.NaN] }),
        content.balancing.thermal,
        0.1,
      ),
    ).toThrow();
    expect(() =>
      updateThermalState(
        current,
        generation(1, { localCoolingWattsOnTile: [Number.POSITIVE_INFINITY] }),
        content.balancing.thermal,
        0.1,
      ),
    ).toThrow();
    expect(validateThermalGeneration(validGeneration, 1)).toEqual([]);
    expect(() => {
      assertValidThermalTickResult(
        current,
        validGeneration,
        validUpdate,
        content.balancing.thermal,
      );
    }).not.toThrow();
    expect(() => {
      assertValidThermalUpdateOutput(
        current,
        validGeneration,
        validUpdate,
        content.balancing.thermal,
      );
    }).not.toThrow();
    expect(() => {
      assertValidThermalUpdateOutput(
        current,
        validGeneration,
        {
          thermalTiles: [{ position: { x: 0, y: 0 }, temperatureC: Number.POSITIVE_INFINITY }],
          temperatureChanged: true,
        },
        content.balancing.thermal,
      );
    }).toThrow();
  });

  test("does not mutate inputs, consumes no RNG, isolates scratch, and returns serializable data", () => {
    const state = createInitialGameState({ content, seed: "thermal-rng" });
    state.facility.size = { width: 2, height: 1 };
    state.facility.thermalTiles = thermalTiles(2, 1);
    state.facility.modules = { fan: module("fan", "module-air-mover", { x: 0, y: 0 }) };
    state.facility.power = {
      ...state.facility.power,
      layoutRevision: 0,
      byModule: { fan: delivery("fan", 420) },
    };
    const before = structuredClone(state);
    const topology = buildThermalTopology(state.facility, content);
    const generationScratch = {
      heatWattsOnTile: new Float64Array([999, 999]),
      localCoolingWattsOnTile: new Float64Array([999, 999]),
    };
    const first = calculateHeatGeneration(state.facility, content, topology, generationScratch);
    const second = calculateHeatGeneration(state.facility, content, topology, generationScratch);
    const updateScratch = { nextTemperatureC: new Float64Array([999, 999]) };
    const firstUpdate = updateThermalState(
      state.facility,
      first,
      content.balancing.thermal,
      0.1,
      updateScratch,
    );
    updateThermalState(state.facility, second, content.balancing.thermal, 0.1, updateScratch);

    expect(state).toEqual(before);
    expect(state.rngState).toBe(before.rngState);
    expect(second).toEqual(first);
    expect(firstUpdate.thermalTiles).not.toBe(state.facility.thermalTiles);
    expect(JSON.parse(JSON.stringify({ first, firstUpdate }))).toEqual({ first, firstUpdate });
  });
});
