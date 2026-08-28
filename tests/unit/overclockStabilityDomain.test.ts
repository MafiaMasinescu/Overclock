import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { DeepReadonly, ModuleDefinition } from "../../src/content/schemas/contentSchemas.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { FacilityState, ModuleInstanceState, Rotation } from "../../src/sim/core/types.ts";
import {
  applyThermalLifecycleTransitions,
  calculateFacilityOverclockResult,
  createFacilityOverclockCalculationScratch,
  calculateModuleStabilityBreakdown,
  calculateModuleStabilityFactor,
  calculateModuleThermalFactor,
  sampleModuleMaximumTemperature,
  validateGeneratedOverclockTickResult,
  validateOverclockTickResult,
} from "../../src/sim/overclock/overclockStabilityDomain.ts";
import { buildThermalTopology } from "../../src/sim/thermal/thermalDomain.ts";

const content = loadContentBundle();
const LOGIC = "module-vacuum-tube-logic";

function module(
  id: string,
  definitionId = LOGIC,
  position = { x: 0, y: 0 },
  rotation: Rotation = 0,
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

function facility(modules: readonly ModuleInstanceState[], width = 6, height = 6): FacilityState {
  const state = createInitialGameState({ content, seed: "overclock-stability-domain" });
  state.facility.size = { width, height };
  state.facility.thermalTiles = Array.from({ length: width * height }, (_, index) => ({
    position: { x: index % width, y: Math.floor(index / width) },
    temperatureC: 22,
  }));
  state.facility.modules = Object.fromEntries(modules.map((entry) => [entry.id, entry]));
  return state.facility;
}

function definition(): DeepReadonly<ModuleDefinition> {
  const value = content.modules[LOGIC];
  if (value === undefined) throw new Error("Missing Overclock stability fixture definition.");
  return value;
}

function withTemperature(
  current: FacilityState,
  topology: ReturnType<typeof buildThermalTopology>,
  moduleId: string,
  temperatures: readonly number[],
): void {
  const indexes = topology.occupiedTileIndexesByModule[moduleId];
  if (
    indexes === undefined ||
    (temperatures.length !== 1 && indexes.length !== temperatures.length)
  ) {
    throw new Error("Temperature fixture coverage is invalid.");
  }
  for (const [offset, tileIndex] of indexes.entries()) {
    const tile = current.thermalTiles[tileIndex];
    const temperatureC = temperatures[temperatures.length === 1 ? 0 : offset];
    if (tile === undefined || temperatureC === undefined)
      throw new Error("Missing temperature fixture.");
    tile.temperatureC = temperatureC;
  }
}

function stabilityDefinition(stableFrequencyRatio: number): DeepReadonly<ModuleDefinition> {
  return { ...definition(), stableFrequencyRatio };
}

describe("pure Task 8.3 Overclock stability domain", () => {
  test("calculates the exact Thermal Factor curve at thresholds and interpolation points", () => {
    const thermal = definition().thermal;

    expect(calculateModuleThermalFactor(thermal.normalMaxC - 1, thermal)).toBe(1);
    expect(calculateModuleThermalFactor(thermal.normalMaxC, thermal)).toBe(1);
    expect(
      calculateModuleThermalFactor((thermal.normalMaxC + thermal.warningMaxC) / 2, thermal),
    ).toBe(0.98);
    expect(calculateModuleThermalFactor(thermal.warningMaxC, thermal)).toBe(0.96);
    expect(
      calculateModuleThermalFactor((thermal.warningMaxC + thermal.criticalMaxC) / 2, thermal),
    ).toBeCloseTo(0.805, 12);
    expect(calculateModuleThermalFactor(thermal.criticalMaxC, thermal)).toBe(0.65);
    expect(
      calculateModuleThermalFactor((thermal.criticalMaxC + thermal.shutdownC) / 2, thermal),
    ).toBe(0.375);
    expect(calculateModuleThermalFactor(thermal.shutdownC - 1e-9, thermal)).toBeGreaterThan(0.1);
    expect(calculateModuleThermalFactor(thermal.shutdownC, thermal)).toBe(0);
    expect(calculateModuleThermalFactor(thermal.shutdownC + 1, thermal)).toBe(0);
  });

  test("derives retry and invalid-sample rates before the exact stored Stability Factor", () => {
    const coolTemperatureC = definition().thermal.warningMaxC;
    const balanced = module("balanced");
    const frequencyLoss = module("frequency", LOGIC, undefined, 0, {
      overclock: { profile: "manual", frequencyRatio: 1, voltageRatio: 1 },
    });
    const temperatureLoss = module("temperature");
    const combined = module("combined");

    const full = calculateModuleStabilityBreakdown(
      balanced,
      stabilityDefinition(1),
      coolTemperatureC,
    );
    const frequency = calculateModuleStabilityBreakdown(
      frequencyLoss,
      stabilityDefinition(0.8),
      coolTemperatureC,
    );
    const thermal = definition().thermal;
    const temperature = calculateModuleStabilityBreakdown(
      temperatureLoss,
      stabilityDefinition(1),
      (thermal.warningMaxC + thermal.shutdownC) / 2,
    );
    const both = calculateModuleStabilityBreakdown(
      combined,
      stabilityDefinition(0.8),
      (thermal.warningMaxC + thermal.shutdownC) / 2,
    );

    expect(full).toMatchObject({ retryRate: 0, invalidSampleRate: 0, stabilityFactor: 1 });
    expect(frequency.retryRate).toBeCloseTo(0.2, 12);
    expect(frequency).toMatchObject({ invalidSampleRate: 0, stabilityFactor: 0.8 });
    expect(temperature).toMatchObject({
      retryRate: 0,
      invalidSampleRate: 0.5,
      stabilityFactor: 0.5,
    });
    expect(both.retryRate).toBeCloseTo(0.2, 12);
    expect(both.invalidSampleRate).toBeCloseTo(0.4, 12);
    expect(both.stabilityFactor).toBeCloseTo(0.4, 12);
    for (const result of [full, frequency, temperature, both]) {
      expect(result.stabilityFactor).toBe(
        Math.max(0, Math.min(1, 1 - result.retryRate - result.invalidSampleRate)),
      );
    }
    expect(
      calculateModuleStabilityFactor(
        combined,
        stabilityDefinition(0.8),
        (thermal.warningMaxC + thermal.shutdownC) / 2,
      ),
    ).toBe(both.stabilityFactor);
  });

  test("uses exact Manual voltage, bin stability, and shutdown boundary behavior", () => {
    const thermal = definition().thermal;
    const manual = module("manual", LOGIC, undefined, 0, {
      overclock: { profile: "manual", frequencyRatio: 1.1, voltageRatio: 0.9 },
      binStabilityRatio: 0.8,
    });
    const headroom = module("headroom", LOGIC, undefined, 0, {
      overclock: { profile: "manual", frequencyRatio: 1, voltageRatio: 1.2 },
      binStabilityRatio: 1.5,
    });

    expect(
      calculateModuleStabilityBreakdown(manual, definition(), thermal.warningMaxC).stabilityFactor,
    ).toBeCloseTo((definition().stableFrequencyRatio * 0.8 * 0.9) / 1.1, 12);
    expect(
      calculateModuleStabilityBreakdown(headroom, definition(), thermal.warningMaxC)
        .stabilityFactor,
    ).toBe(1);
    expect(
      calculateModuleStabilityBreakdown(manual, definition(), thermal.shutdownC),
    ).toMatchObject({
      stabilityFactor: 0,
    });
  });

  test("calculates cool Balanced, Eco, Boost, and non-overclockable diagnostic results", () => {
    const coolTemperatureC = definition().thermal.normalMaxC;
    const eco = module("eco", LOGIC, undefined, 0, {
      overclock: { profile: "eco", frequencyRatio: 0.8, voltageRatio: 0.9 },
    });
    const boost = module("boost", LOGIC, undefined, 0, {
      overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
    });
    const relay = module("relay", "module-data-relay");
    const relayDefinition = content.modules[relay.definitionId];
    if (relayDefinition === undefined) throw new Error("Missing ineligible diagnostic fixture.");

    expect(
      calculateModuleStabilityBreakdown(module("balanced"), definition(), coolTemperatureC),
    ).toMatchObject({
      stabilityFactor: 1,
    });
    expect(calculateModuleStabilityBreakdown(eco, definition(), coolTemperatureC)).toMatchObject({
      stabilityFactor: 1,
    });
    expect(calculateModuleStabilityBreakdown(boost, definition(), coolTemperatureC)).toMatchObject({
      stabilityFactor: 1,
    });
    expect(
      calculateModuleStabilityBreakdown(relay, relayDefinition, coolTemperatureC).stabilityFactor,
    ).toBe(1);
  });

  test("rejects invalid factor and stability inputs deterministically", () => {
    const thermal = definition().thermal;
    expect(() => calculateModuleThermalFactor(Number.NaN, thermal)).toThrow(RangeError);
    expect(() =>
      calculateModuleThermalFactor(22, { ...thermal, warningMaxC: thermal.normalMaxC }),
    ).toThrow(RangeError);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        calculateModuleStabilityBreakdown(
          module("invalid", LOGIC, undefined, 0, { binStabilityRatio: value }),
          definition(),
          22,
        ),
      ).toThrow(RangeError);
    }
  });

  test.each([
    {
      name: "startup progress",
      target: module("invalid-startup", LOGIC, undefined, 0, {
        startupTicksRemaining: Number.NaN,
      }),
    },
    {
      name: "cooldown progress",
      target: module("invalid-cooldown", LOGIC, undefined, 0, {
        operationalState: "shutdown",
        cooldownTicksRemaining: Number.POSITIVE_INFINITY,
      }),
    },
  ])("rejects invalid $name in a complete facility calculation", ({ target }) => {
    const current = facility([target]);
    const topology = buildThermalTopology(current, content);

    expect(() => calculateFacilityOverclockResult(current, content, topology)).toThrow(
      /must be a nonnegative safe integer/,
    );
  });

  test("samples the maximum occupied tile for multi-tile modules across rotations", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const current = facility([module(`logic-${rotation}`, LOGIC, { x: 1, y: 1 }, rotation)]);
      const topology = buildThermalTopology(current, content);
      const moduleId = `logic-${rotation}`;
      const indexes = topology.occupiedTileIndexesByModule[moduleId];
      if (indexes === undefined) throw new Error("Missing topology fixture coverage.");
      withTemperature(
        current,
        topology,
        moduleId,
        indexes.map((_, index) => 30 + index * 9),
      );

      expect(sampleModuleMaximumTemperature(current, topology, moduleId)).toBe(
        30 + (indexes.length - 1) * 9,
      );
    }
  });

  test("samples a one-by-one module from its sole row-major tile", () => {
    const current = facility([module("relay", "module-data-relay", { x: 4, y: 3 })]);
    const topology = buildThermalTopology(current, content);
    withTemperature(current, topology, "relay", [41]);

    expect(sampleModuleMaximumTemperature(current, topology, "relay")).toBe(41);
  });

  test("rejects stale topology, non-finite tiles, and non-row-major thermal coverage", () => {
    const current = facility([module("logic")]);
    const topology = buildThermalTopology(current, content);
    current.liveLayoutRevision += 1;
    expect(() => sampleModuleMaximumTemperature(current, topology, "logic")).toThrow();

    current.liveLayoutRevision -= 1;
    const firstTile = current.thermalTiles[0];
    if (firstTile === undefined) throw new Error("Missing thermal tile fixture.");
    current.thermalTiles[0] = { ...firstTile, temperatureC: Number.NaN };
    expect(() => sampleModuleMaximumTemperature(current, topology, "logic")).toThrow(RangeError);

    current.thermalTiles[0] = { position: { x: 1, y: 0 }, temperatureC: 22 };
    expect(() => sampleModuleMaximumTemperature(current, topology, "logic")).toThrow();
  });

  test("transitions active hot modules to shutdown without shutting down offline modules", () => {
    for (const operationalState of ["starting", "online", "brownout"] as const) {
      const current = facility([
        module(operationalState, LOGIC, undefined, 0, {
          operationalState,
          startupTicksRemaining: 7,
        }),
      ]);
      const topology = buildThermalTopology(current, content);
      withTemperature(current, topology, operationalState, [definition().thermal.shutdownC]);
      const result = calculateFacilityOverclockResult(current, content, topology);

      expect(result.modules[operationalState]).toMatchObject({
        operationalState: "shutdown",
        cooldownTicksRemaining: definition().cooldownTicks,
        startupTicksRemaining: 7,
      });
      expect(result.overclock.byModule[operationalState]).toMatchObject({
        thermalFactor: 0,
        retryRate: 0,
        invalidSampleRate: 1,
        stabilityFactor: 0,
        shutdownReason: "thermal",
      });
    }

    const offline = facility([
      module("offline", LOGIC, undefined, 0, { operationalState: "offline" }),
    ]);
    const topology = buildThermalTopology(offline, content);
    withTemperature(offline, topology, "offline", [definition().thermal.shutdownC]);
    expect(
      calculateFacilityOverclockResult(offline, content, topology).modules["offline"]
        ?.operationalState,
    ).toBe("offline");
  });

  test("holds, decrements, reheats, and recovers shutdown cooldown without mutating Power or thermal state", () => {
    const current = facility([
      module("logic", LOGIC, undefined, 0, {
        operationalState: "shutdown",
        startupTicksRemaining: 3,
        cooldownTicksRemaining: 2,
      }),
    ]);
    const topology = buildThermalTopology(current, content);
    const powerBefore = structuredClone(current.power);

    withTemperature(current, topology, "logic", [definition().thermal.warningMaxC + 1]);
    const tilesBeforeCalculation = structuredClone(current.thermalTiles);
    const held = calculateFacilityOverclockResult(current, content, topology);
    expect(held.modules["logic"]?.cooldownTicksRemaining).toBe(2);
    expect(held.overclock.byModule["logic"]).toMatchObject({
      invalidSampleRate: 1,
      shutdownReason: "thermal",
    });
    expect(current.thermalTiles).toEqual(tilesBeforeCalculation);

    current.modules = held.modules;
    withTemperature(current, topology, "logic", [definition().thermal.warningMaxC]);
    const decremented = calculateFacilityOverclockResult(current, content, topology);
    expect(decremented.modules["logic"]?.cooldownTicksRemaining).toBe(1);

    current.modules = decremented.modules;
    withTemperature(current, topology, "logic", [definition().thermal.warningMaxC + 1]);
    const reheated = calculateFacilityOverclockResult(current, content, topology);
    expect(reheated.modules["logic"]?.cooldownTicksRemaining).toBe(1);

    current.modules = reheated.modules;
    withTemperature(current, topology, "logic", [definition().thermal.warningMaxC]);
    const recovered = calculateFacilityOverclockResult(current, content, topology);
    expect(recovered.modules["logic"]).toMatchObject({
      operationalState: "offline",
      cooldownTicksRemaining: 0,
      startupTicksRemaining: definition().startupTicks,
    });
    expect(recovered.overclock.byModule["logic"]?.shutdownReason).toBeNull();
    expect(recovered.overclock.byModule["logic"]?.invalidSampleRate).not.toBe(1);
    expect(current.power).toEqual(powerBefore);
  });

  test("keeps zero-duration shutdown crossing until a later safe lifecycle evaluation", () => {
    const zeroCooldown = { ...definition(), cooldownTicks: 0 };
    const current = facility([module("logic")]);
    const topology = buildThermalTopology(current, content);
    withTemperature(current, topology, "logic", [zeroCooldown.thermal.shutdownC]);
    const crossing = applyThermalLifecycleTransitions(
      current.modules,
      { ...content, modules: { ...content.modules, [LOGIC]: zeroCooldown } },
      topology,
      current,
    );
    expect(crossing["logic"]?.operationalState).toBe("shutdown");
    current.modules = crossing;
    withTemperature(current, topology, "logic", [zeroCooldown.thermal.warningMaxC]);
    expect(
      applyThermalLifecycleTransitions(
        current.modules,
        { ...content, modules: { ...content.modules, [LOGIC]: zeroCooldown } },
        topology,
        current,
      )["logic"]?.operationalState,
    ).toBe("offline");
  });

  test("returns stable ordered, serializable, validated pure results without input mutation", () => {
    const current = facility([module("z"), module("a", LOGIC, { x: 2, y: 0 })]);
    const topology = buildThermalTopology(current, content);
    const before = structuredClone(current);

    const first = calculateFacilityOverclockResult(current, content, topology);
    const second = calculateFacilityOverclockResult(current, content, topology);

    expect(Object.keys(first.overclock.byModule)).toEqual(["a", "z"]);
    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(current).toEqual(before);
    expect(validateOverclockTickResult(current, content, topology, first)).toEqual([]);
    const contradictory = structuredClone(first);
    const contradictoryResult = contradictory.overclock.byModule["a"];
    if (contradictoryResult === undefined) throw new Error("Missing contradictory result fixture.");
    contradictoryResult.stabilityFactor = 0.5;
    expect(validateOverclockTickResult(current, content, topology, contradictory)).not.toEqual([]);
  });

  test("validates a generated result without recalculating a competing result", () => {
    const current = facility([module("logic")]);
    const topology = buildThermalTopology(current, content);
    const result = calculateFacilityOverclockResult(current, content, topology);

    expect(validateGeneratedOverclockTickResult(current, content, topology, result)).toEqual([]);

    const contradictory = structuredClone(result);
    const record = contradictory.overclock.byModule["logic"];
    if (record === undefined) throw new Error("Missing generated validation fixture record.");
    record.dynamicPowerFactor = 2;
    expect(
      validateGeneratedOverclockTickResult(current, content, topology, contradictory),
    ).not.toEqual([]);
  });

  test("keeps reusable private calculation scratch equivalent to a cold pure calculation", () => {
    const current = facility([module("logic")]);
    const topology = buildThermalTopology(current, content);
    const scratch = createFacilityOverclockCalculationScratch(content, topology);
    const cold = calculateFacilityOverclockResult(current, content, topology);
    const warm = calculateFacilityOverclockResult(current, content, topology, scratch);
    const repeated = calculateFacilityOverclockResult(current, content, topology, scratch);

    expect(warm).toEqual(cold);
    expect(repeated).toEqual(cold);
    expect(JSON.parse(JSON.stringify(warm))).toEqual(warm);
  });

  test("consumes no RNG, emits no negative zero, and keeps independent calculations isolated", () => {
    const state = createInitialGameState({ content, seed: "overclock-stability-purity" });
    const firstFacility = facility([module("first")]);
    const secondFacility = facility([module("second")]);
    const firstTopology = buildThermalTopology(firstFacility, content);
    const secondTopology = buildThermalTopology(secondFacility, content);
    const initialRngState = state.rngState;
    withTemperature(firstFacility, firstTopology, "first", [definition().thermal.warningMaxC + 1]);

    const first = calculateFacilityOverclockResult(firstFacility, content, firstTopology);
    const second = calculateFacilityOverclockResult(secondFacility, content, secondTopology);

    expect(state.rngState).toBe(initialRngState);
    expect(second.overclock.byModule["second"]?.sampledTemperatureC).toBe(22);
    for (const result of Object.values(first.overclock.byModule)) {
      for (const value of [
        result.thermalFactor,
        result.retryRate,
        result.invalidSampleRate,
        result.stabilityFactor,
      ]) {
        expect(Object.is(value, -0)).toBe(false);
      }
    }
  });
});
