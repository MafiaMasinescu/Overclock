import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";

describe("thermal state validation", () => {
  test("accepts exact row-major initial coverage", async () => {
    const { validateThermalState } = await import("../../src/sim/thermal/thermalState.ts");
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "thermal-validation" });

    expect(validateThermalState(state.facility, content.balancing.thermal)).toEqual([]);
  });

  test("reports malformed coverage, temperatures, bounds, and revisions", async () => {
    const { validateThermalState } = await import("../../src/sim/thermal/thermalState.ts");
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "thermal-invalid" });
    const first = state.facility.thermalTiles[0];
    const second = state.facility.thermalTiles[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected initial thermal tiles.");
    }
    first.position = { x: 1, y: 0 };
    second.temperatureC = Number.NaN;
    state.facility.thermalRevision = Number.MAX_SAFE_INTEGER + 1;

    const issues = validateThermalState(state.facility, {
      ...content.balancing.thermal,
      maximumTemperatureC: 10,
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "facility.thermalTiles[0].position" }),
        expect.objectContaining({ path: "facility.thermalTiles[1].temperatureC" }),
        expect.objectContaining({ path: "facility.thermalRevision" }),
        expect.objectContaining({ path: "balancing.thermal" }),
      ]),
    );
  });

  test("rejects duplicate coordinates through exact row-major coverage", async () => {
    const { validateThermalState } = await import("../../src/sim/thermal/thermalState.ts");
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "thermal-duplicate-coordinate" });
    const first = state.facility.thermalTiles[0];
    const second = state.facility.thermalTiles[1];
    if (first === undefined || second === undefined)
      throw new Error("Expected initial thermal tiles.");
    second.position = { ...first.position };

    expect(validateThermalState(state.facility, content.balancing.thermal)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "facility.thermalTiles[1].position" }),
      ]),
    );
  });

  test("rejects nonpositive thermal and efficiency bin ratios", async () => {
    const { validateThermalState } = await import("../../src/sim/thermal/thermalState.ts");
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "thermal-bin-ratios" });
    state.facility.modules = {
      invalid: {
        id: "invalid",
        definitionId: "module-vacuum-tube-logic",
        position: { x: 0, y: 0 },
        rotation: 0,
        operationalState: "offline",
        overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
        binComputeRatio: 1,
        binEfficiencyRatio: 0,
        binThermalRatio: Number.NaN,
        binStabilityRatio: 1,
        startupTicksRemaining: 0,
        cooldownTicksRemaining: 0,
      },
    };

    expect(validateThermalState(state.facility, content.balancing.thermal)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "facility.modules.invalid.binEfficiencyRatio" }),
        expect.objectContaining({ path: "facility.modules.invalid.binThermalRatio" }),
      ]),
    );
  });
});
