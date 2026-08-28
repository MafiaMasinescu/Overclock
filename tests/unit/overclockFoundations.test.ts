import { describe, expect, test } from "vitest";

import {
  ContentValidationError,
  loadContentBundle,
  validateContent,
} from "../../src/content/loader/contentLoader.ts";
import { createRawContentPack } from "../../src/content/loader/rawContentPack.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { ModuleInstanceState, ModuleOverclockResultState } from "../../src/sim/core/types.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import { validateOverclockState } from "../../src/sim/overclock/overclockState.ts";

function module(id: string): ModuleInstanceState {
  return {
    id,
    definitionId: "module-vacuum-tube-logic",
    position: { x: 0, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function result(id: string): ModuleOverclockResultState {
  return {
    moduleInstanceId: id,
    profile: "balanced",
    requestedFrequencyRatio: 1,
    requestedVoltageRatio: 1,
    dynamicPowerFactor: 1,
    sampledTemperatureC: 22,
    thermalFactor: 1,
    retryRate: 0,
    invalidSampleRate: 0,
    stabilityFactor: 1,
    shutdownReason: null,
  };
}

describe("Task 8.1 Overclock foundations", () => {
  test("declares the approved explicit overclock eligibility for every supplied module", () => {
    const content = loadContentBundle();

    const overclockableModuleIds = Object.values(content.modules)
      .filter((definition) => definition.overclockable)
      .map((definition) => definition.id)
      .toSorted();

    expect(overclockableModuleIds).toEqual([
      "module-arithmetic-unit",
      "module-control-unit",
      "module-vacuum-tube-logic",
    ]);
    expect(
      Object.values(content.modules).every(
        (definition) => typeof definition.overclockable === "boolean",
      ),
    ).toBe(true);
  });

  test("keeps balanced exact and every preset inside finite positive manual bounds", () => {
    const { overclock } = loadContentBundle().balancing;
    const { manual } = overclock;

    expect(overclock.balanced).toEqual({ frequencyRatio: 1, voltageRatio: 1 });
    expect(
      [
        manual.frequencyRatioMin,
        manual.frequencyRatioMax,
        manual.voltageRatioMin,
        manual.voltageRatioMax,
      ].every((value) => Number.isFinite(value) && value > 0),
    ).toBe(true);
    expect(manual.frequencyRatioMin).toBeLessThanOrEqual(manual.frequencyRatioMax);
    expect(manual.voltageRatioMin).toBeLessThanOrEqual(manual.voltageRatioMax);
    for (const preset of [overclock.eco, overclock.balanced, overclock.boost]) {
      expect(preset.frequencyRatio).toBeGreaterThanOrEqual(manual.frequencyRatioMin);
      expect(preset.frequencyRatio).toBeLessThanOrEqual(manual.frequencyRatioMax);
      expect(preset.voltageRatio).toBeGreaterThanOrEqual(manual.voltageRatioMin);
      expect(preset.voltageRatio).toBeLessThanOrEqual(manual.voltageRatioMax);
    }
  });

  test("rejects an overclockable definition without positive base compute", () => {
    const pack = createRawContentPack();
    const definition = pack.modules.modules.find(
      (entry) => entry.id === "module-vacuum-tube-logic",
    );
    if (definition === undefined) throw new Error("Missing overclockable fixture module.");
    definition.baseComputeFlops = 0;

    expect(() => validateContent(pack)).toThrow(ContentValidationError);
    expect(() => validateContent(pack)).toThrow(
      "modules.modules[1].overclockable: overclockable modules require positive base compute flops",
    );
  });

  test("initializes the authoritative Overclock result as exactly dirty", () => {
    const state = createInitialGameState({ content: loadContentBundle(), seed: "overclock-dirty" });

    expect(state.facility.overclock).toEqual({
      layoutRevision: null,
      thermalRevision: null,
      byModule: {},
    });
  });

  test("accepts only exact dirty state and validates calculated stable module coverage", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "overclock-validation" });

    expect(validateOverclockState(state, content)).toEqual([]);
    state.facility.overclock.byModule = { ghost: result("ghost") };
    expect(validateOverclockState(state, content)).toContainEqual({
      path: "facility.overclock.byModule",
      message: "dirty state must be empty",
    });

    state.facility.modules = { "module-b": module("module-b"), "module-a": module("module-a") };
    state.facility.overclock = {
      layoutRevision: state.facility.liveLayoutRevision,
      thermalRevision: state.facility.thermalRevision,
      byModule: { "module-b": result("module-b"), "module-a": result("module-a") },
    };
    expect(validateOverclockState(state, content)).toContainEqual({
      path: "facility.overclock.byModule",
      message: "keys must use stable ordering",
    });

    state.facility.overclock.byModule = {
      "module-a": result("module-a"),
      "module-b": result("module-b"),
    };
    expect(validateOverclockState(state, content)).toEqual([]);
  });

  test("rejects non-finite values, invalid factors, and invalid rate relationships", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "overclock-numeric-validation" });
    state.facility.modules = { "module-a": module("module-a") };
    const invalid = result("module-a");
    invalid.dynamicPowerFactor = Number.NaN;
    invalid.thermalFactor = 1.01;
    invalid.retryRate = 0.7;
    invalid.invalidSampleRate = 0.4;
    invalid.stabilityFactor = 0;
    state.facility.overclock = {
      layoutRevision: state.facility.liveLayoutRevision,
      thermalRevision: state.facility.thermalRevision,
      byModule: { "module-a": invalid },
    };

    const issues = validateOverclockState(state, content);

    expect(issues.map((issue) => issue.message)).toContain("must be finite and strictly positive");
    expect(issues.map((issue) => issue.message)).toContain("must be in [0, 1]");
    expect(issues.map((issue) => issue.message)).toContain(
      "retry and invalid sample rates must not exceed 1 together",
    );
    expect(issues.map((issue) => issue.message)).toContain(
      "must exactly equal 1 minus retry and invalid sample rates",
    );
  });

  test("requires the exact deterministic shutdown override and rejects negative zero", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "overclock-shutdown-validation" });
    const shutdown = module("module-a");
    shutdown.operationalState = "shutdown";
    const shutdownResult = result("module-a");
    shutdownResult.thermalFactor = 0;
    shutdownResult.retryRate = 0;
    shutdownResult.invalidSampleRate = 1;
    shutdownResult.stabilityFactor = 0;
    shutdownResult.shutdownReason = "thermal";
    state.facility.modules = { "module-a": shutdown };
    state.facility.overclock = {
      layoutRevision: state.facility.liveLayoutRevision,
      thermalRevision: state.facility.thermalRevision,
      byModule: { "module-a": shutdownResult },
    };

    expect(validateOverclockState(state, content)).toEqual([]);
    shutdownResult.retryRate = -0;
    expect(validateOverclockState(state, content).map((issue) => issue.message)).toContain(
      "must be in [0, 1]",
    );
  });

  test("keeps the foundation canonical and consumes no RNG", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "overclock-canonical" });
    const rngState = state.rngState;

    expect(validateOverclockState(state, content)).toEqual([]);
    expect(JSON.parse(canonicalSerialize(state))).toEqual(state);
    expect(state.rngState).toBe(rngState);
  });
});
