import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import type { TickSystemRegistry } from "../../src/sim/core/tickSystems.ts";
import { createOverclockCommandHandlers } from "../../src/sim/overclock/overclockCommands.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const definition = (() => {
  const value = content.modules["module-vacuum-tube-logic"];
  if (value === undefined) throw new Error("Missing Task 8 determinism fixture content.");
  return value;
})();

function module(): ModuleInstanceState {
  return {
    id: "logic",
    definitionId: definition.id,
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

function scheduledThermalField(): TickSystemRegistry {
  return {
    "update-thermal-state": {
      createRuntime() {
        return {
          executionMode: "structural-sharing" as const,
          run({ state }: { readonly state: Readonly<GameState> }): GameState {
            const temperatureC =
              state.tick === 0 || state.tick === 2
                ? definition.thermal.shutdownC
                : definition.thermal.warningMaxC;
            const current = state.facility.thermalTiles[0];
            if (current === undefined) throw new Error("Missing determinism thermal tile.");
            if (current.temperatureC === temperatureC) return state;
            return {
              ...state,
              facility: {
                ...state.facility,
                thermalRevision: state.facility.thermalRevision + 1,
                thermalTiles: [
                  { position: current.position, temperatureC },
                  ...state.facility.thermalTiles.slice(1),
                ],
              },
            };
          },
        };
      },
    },
  };
}

function runFixture() {
  const initialState = createInitialGameState({ content, seed: "task-8-exact-100" });
  initialState.facility.modules = { logic: module() };
  const initialRngState = initialState.rngState;
  const core = new SimCore({
    initialState,
    commandHandlers: createOverclockCommandHandlers(content),
    tickSystems: {
      ...scheduledThermalField(),
      ...createOverclockTickSystems(content),
    },
  });
  const receipts = [
    core.enqueue({
      commandId: "88010000-0000-4000-8000-000000000001",
      source: "replay",
      kind: "SET_OVERCLOCK_PROFILE",
      moduleInstanceIds: ["logic"],
      profile: "boost",
    }),
    core.enqueue({
      commandId: "88010000-0000-4000-8000-000000000002",
      source: "replay",
      kind: "SET_MANUAL_OVERCLOCK",
      moduleInstanceIds: ["logic"],
      frequencyRatio: 1.234567,
      voltageRatio: 1.087654,
    }),
  ];

  const first = core.step();
  const afterShutdown = core.getStateForSave();
  core.step();
  const afterSafeDecrement = core.getStateForSave();
  core.step();
  const afterReheatHold = core.getStateForSave();
  core.step(59);
  const finalState = core.getStateForSave();

  return {
    receipts,
    commandResults: first.commandResults,
    lifecycle: [
      {
        state: afterShutdown.facility.modules["logic"]?.operationalState,
        cooldown: afterShutdown.facility.modules["logic"]?.cooldownTicksRemaining,
      },
      {
        state: afterSafeDecrement.facility.modules["logic"]?.operationalState,
        cooldown: afterSafeDecrement.facility.modules["logic"]?.cooldownTicksRemaining,
      },
      {
        state: afterReheatHold.facility.modules["logic"]?.operationalState,
        cooldown: afterReheatHold.facility.modules["logic"]?.cooldownTicksRemaining,
      },
      {
        state: finalState.facility.modules["logic"]?.operationalState,
        cooldown: finalState.facility.modules["logic"]?.cooldownTicksRemaining,
        startup: finalState.facility.modules["logic"]?.startupTicksRemaining,
      },
    ],
    exactManual: finalState.facility.modules["logic"]?.overclock,
    finalHash: hashCanonicalState(finalState),
    rngUnchanged: finalState.rngState === initialRngState,
  };
}

describe("Task 8 determinism", () => {
  test("repeats commands, lifecycle sequence, final hash, and RNG exactly 100 times", () => {
    const expected = runFixture();
    expect(expected.lifecycle).toEqual([
      { state: "shutdown", cooldown: 60 },
      { state: "shutdown", cooldown: 59 },
      { state: "shutdown", cooldown: 59 },
      { state: "offline", cooldown: 0, startup: 30 },
    ]);
    expect(expected.exactManual).toEqual({
      profile: "manual",
      frequencyRatio: 1.234567,
      voltageRatio: 1.087654,
    });
    expect(expected.rngUnchanged).toBe(true);

    for (let run = 1; run < 100; run += 1) {
      expect(runFixture()).toEqual(expected);
    }
  }, 15_000);
});
