import { describe, expect, test } from "vitest";

import { buildOccupancyIndex } from "../../src/grid/domain/occupancy.ts";
import { assertValidGridState } from "../../src/grid/validation/gridState.ts";
import { calculateFacilityPower } from "../../src/sim/power/facilityPower.ts";
import {
  buildThermalTopology,
  calculateHeatGeneration,
  updateThermalState,
} from "../../src/sim/thermal/thermalDomain.ts";
import {
  createTask9PerformanceFixture,
  createTask8PerformanceFixture,
  createThermalPerformanceFixture,
  THERMAL_PERFORMANCE_HEIGHT,
  THERMAL_PERFORMANCE_WIDTH,
  thermalPerformanceContent,
} from "../performance/thermalFixture.ts";

describe("thermal performance fixture", () => {
  test("exercises valid dense mixed-footprint Power and thermal work", () => {
    const state = createThermalPerformanceFixture("thermal-fixture-audit");
    const { facility } = state;
    const occupancy = buildOccupancyIndex({
      modules: facility.modules,
      content: thermalPerformanceContent,
    });

    expect(facility.size).toEqual({
      width: THERMAL_PERFORMANCE_WIDTH,
      height: THERMAL_PERFORMANCE_HEIGHT,
    });
    expect(occupancy.issues).toEqual([]);
    expect(occupancy.tiles.length).toBeGreaterThanOrEqual(288);
    expect([
      ...new Set(Object.values(facility.modules).map((module) => module.definitionId)),
    ]).toEqual(
      expect.arrayContaining([
        "module-data-relay",
        "module-vacuum-tube-logic",
        "module-line-printer",
        "module-air-mover",
        "module-room-cooling",
      ]),
    );
    expect([...new Set(Object.values(facility.modules).map((module) => module.rotation))]).toEqual(
      expect.arrayContaining([0, 90, 180, 270]),
    );
    expect(Object.keys(facility.routes).length).toBeGreaterThan(
      Object.keys(facility.modules).length - 4,
    );
    expect(
      Object.values(facility.modules).some((module) => module.operationalState === "starting"),
    ).toBe(true);
    expect(
      Object.values(facility.modules).some((module) => module.operationalState === "brownout"),
    ).toBe(true);
    expect(new Set(facility.thermalTiles.map((tile) => tile.temperatureC)).size).toBeGreaterThan(8);
    expect(() => {
      assertValidGridState(facility, thermalPerformanceContent);
    }).not.toThrow();

    const calculated = calculateFacilityPower(state, thermalPerformanceContent);
    expect(calculated.power.totalDeliveredPowerWatts).toBeGreaterThan(0);
    expect(
      Object.values(calculated.power.byRoute).some((route) => route.utilizationRatio === 1),
    ).toBe(true);
    const thermalFacility = {
      ...facility,
      modules: calculated.modules,
      power: calculated.power,
    };
    const topology = buildThermalTopology(thermalFacility, thermalPerformanceContent);
    const generation = calculateHeatGeneration(
      thermalFacility,
      thermalPerformanceContent,
      topology,
    );
    const update = updateThermalState(
      thermalFacility,
      generation,
      thermalPerformanceContent.balancing.thermal,
      0.1,
    );

    expect(generation.totalGeneratedHeatWatts).toBeGreaterThan(
      generation.effectiveExtractionCapacityWatts,
    );
    expect(generation.localCoolingWattsOnTile.some((watts) => watts > 0)).toBe(true);
    expect(update.temperatureChanged).toBe(true);
  });

  test("extends the audited dense fixture with every Task 8 profile and eligible definition", () => {
    const state = createTask8PerformanceFixture("task-8-fixture-audit");
    const occupancy = buildOccupancyIndex({
      modules: state.facility.modules,
      content: thermalPerformanceContent,
    });
    const eligibleModules = Object.values(state.facility.modules).filter(
      (module) => thermalPerformanceContent.modules[module.definitionId]?.overclockable,
    );

    expect(occupancy.issues).toEqual([]);
    expect(occupancy.tiles.length).toBeGreaterThanOrEqual(288);
    expect(new Set(eligibleModules.map((module) => module.definitionId))).toEqual(
      new Set(["module-vacuum-tube-logic", "module-arithmetic-unit", "module-control-unit"]),
    );
    expect(new Set(eligibleModules.map((module) => module.overclock.profile))).toEqual(
      new Set(["eco", "balanced", "boost", "manual"]),
    );
  });

  test("extends the audited fixture with diagnostic Task 9 data routes and valid shared allocations", () => {
    const state = createTask9PerformanceFixture("task-9-fixture-audit");
    const occupancy = buildOccupancyIndex({
      modules: state.facility.modules,
      content: thermalPerformanceContent,
    });
    const activeAllocations = Object.values(state.tasks.instances).filter(
      (task) => task.status === "active" && task.allocation !== null,
    );

    expect(occupancy.issues).toEqual([]);
    expect(occupancy.tiles.length).toBeGreaterThanOrEqual(288);
    expect(
      Object.values(state.facility.routes).filter((route) => route.kind === "data"),
    ).toHaveLength(5);
    expect(activeAllocations).toHaveLength(2);
    expect(activeAllocations.flatMap((task) => task.allocation?.clusterModuleIds ?? [])).toContain(
      "thermal-003",
    );
    expect(activeAllocations.every((task) => task.allocation?.requestedShare === 0.5)).toBe(true);
  });
});
