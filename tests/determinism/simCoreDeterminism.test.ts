import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore, type SimCoreCommandHandlerRegistry } from "../../src/sim/core/simCore.ts";
import type { TickSystemRegistry } from "../../src/sim/core/tickSystems.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const COMMAND_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;
const content = loadContentBundle();

function createCommand(commandId: string): Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> {
  return {
    commandId,
    source: "replay",
    expectedTick: 0,
    kind: "SET_GUIDANCE_MODE",
    mode: "engineering",
  };
}

function runDeterministicFixture() {
  const commandHandlers: SimCoreCommandHandlerRegistry = {
    SET_GUIDANCE_MODE({ state, rng }, command) {
      state.achievements.unlockedIds.push(command.commandId);
      rng.nextUint32();
    },
  };
  const tickSystems: TickSystemRegistry = {
    "calculate-workload-allocation"({ state, rng }) {
      state.facility.liveLayoutRevision += rng.nextUint32() % 3;
    },
    "update-tutorial-achievements-and-campaign"({ state }) {
      if (state.tick % 10 === 0) {
        state.achievements.unlockedAtTick[`fixture-${state.tick}`] = state.tick;
      }
    },
  };
  const core = new SimCore({
    initialState: createInitialGameState({
      content,
      seed: "task-three-repeat-fixture",
    }),
    commandHandlers,
    tickSystems,
  });
  const receipts = COMMAND_IDS.map((commandId) => core.enqueue(createCommand(commandId)));
  const commandResults = [
    ...core.step(1).commandResults,
    ...core.step(2).commandResults,
    ...core.step(7).commandResults,
  ];

  return {
    receipts,
    commandResults,
    finalHash: hashCanonicalState(core.getStateForSave()),
  };
}

describe("SimCore determinism", () => {
  test("repeats the same final hash for identical inputs and tick grouping across 100 runs", () => {
    const expected = runDeterministicFixture();

    for (let run = 1; run < 100; run += 1) {
      expect(runDeterministicFixture()).toEqual(expected);
    }
  }, 15_000);
});
