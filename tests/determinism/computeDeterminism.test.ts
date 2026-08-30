import { describe, expect, test } from "vitest";

import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
} from "../performance/thermalFixture.ts";

function runFixture() {
  const initialState = createTask9PerformanceFixture("task-9-exact-100");
  const initialRngState = initialState.rngState;
  const core = new SimCore({
    initialState,
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
      ...createOverclockTickSystems(thermalPerformanceContent),
      ...createComputeTickSystems(thermalPerformanceContent),
    },
  });

  const stepResults = [core.step(), core.step(4)];
  const finalState = core.getStateForSave();

  return {
    stepResults,
    tick: finalState.tick,
    rngState: finalState.rngState,
    rngUnchanged: finalState.rngState === initialRngState,
    nextModuleInstanceSequence: finalState.facility.nextModuleInstanceSequence,
    nextRouteSequence: finalState.facility.nextRouteSequence,
    compute: finalState.facility.compute,
    allocations: finalState.tasks.instances,
    finalHash: hashCanonicalState(finalState),
  };
}

describe("Task 9 determinism", () => {
  test("repeats production results, state, tick, IDs, hash, and RNG exactly 100 times", () => {
    const expected = runFixture();
    expect(expected.tick).toBe(5);
    expect(expected.rngUnchanged).toBe(true);
    expect(Object.keys(expected.compute.byTask)).toEqual(["task-9-bandwidth", "task-9-serial"]);

    for (let run = 1; run < 100; run += 1) {
      expect(runFixture()).toEqual(expected);
    }
  }, 30_000);
});
