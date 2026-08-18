import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import {
  CommandProcessor,
  SimulatorInvariantError,
} from "../../src/sim/commands/commandProcessor.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const COMMAND_ID = "50000000-0000-4000-8000-000000000001";

function createState(): GameState {
  return createInitialGameState({ content: loadContentBundle(), seed: "economy-invariants" });
}

function getVacuumTubeStack(state: GameState) {
  const stack = state.inventory.stacks["module-vacuum-tube-logic"];
  if (stack === undefined) {
    throw new Error("Expected the vacuum-tube inventory fixture.");
  }
  return stack;
}

function command(): Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> {
  return {
    commandId: COMMAND_ID,
    source: "player",
    kind: "SET_GUIDANCE_MODE",
    mode: "engineering",
  };
}

describe("inventory and economy authoritative invariants", () => {
  test.each([
    ["misaligned cash", (state: GameState) => (state.economy.cashUsd = 1.0000001)],
    ["negative credit", (state: GameState) => (state.economy.creditLimitUsd = -1)],
    ["negative income", (state: GameState) => (state.economy.totalIncomeUsd = -1)],
    ["non-finite expense", (state: GameState) => (state.economy.totalExpenseUsd = Infinity)],
    ["zero stack", (state: GameState) => (getVacuumTubeStack(state).quantity = 0)],
    [
      "unsafe stack",
      (state: GameState) => (getVacuumTubeStack(state).quantity = Number.MAX_SAFE_INTEGER + 1),
    ],
    [
      "mismatched stack key",
      (state: GameState) => (getVacuumTubeStack(state).definitionId = "module-control-unit"),
    ],
    [
      "misaligned acquisition cost",
      (state: GameState) => (getVacuumTubeStack(state).averageAcquisitionCostUsd = 1.0000001),
    ],
  ])("rejects initial state with %s", (_label, corrupt) => {
    const state = createState();
    corrupt(state);

    expect(() => new CommandProcessor({ initialState: state })).toThrow();
  });

  test("rolls back a handler candidate with invalid inventory economy state", () => {
    const initialState = createState();
    const processor = new CommandProcessor({
      initialState,
      handlers: {
        SET_GUIDANCE_MODE({ state }) {
          getVacuumTubeStack(state).quantity = 0;
        },
      },
    });
    processor.enqueue(command());

    expect(() => processor.processQueuedCommands()).toThrow(SimulatorInvariantError);
    expect(hashCanonicalState(processor.getState())).toBe(hashCanonicalState(initialState));
  });

  test("rolls back a tick system candidate with misaligned cash", () => {
    const initialState = createState();
    const core = new SimCore({
      initialState,
      tickSystems: {
        "apply-economy-and-energy-costs"({ state }) {
          state.economy.cashUsd = 1.0000001;
        },
      },
    });

    expect(() => core.step()).toThrow(SimulatorInvariantError);
    expect(hashCanonicalState(core.getStateForSave())).toBe(hashCanonicalState(initialState));
  });
});
