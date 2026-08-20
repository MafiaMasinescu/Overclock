import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";

function commandId(sequence: number): string {
  return `52990000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function commands(): readonly SimCommand[] {
  return [
    { commandId: commandId(1), source: "replay", kind: "ENTER_DESIGN_MODE" },
    {
      commandId: commandId(2),
      source: "replay",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 0 },
      rotation: 0,
    },
    {
      commandId: commandId(3),
      source: "replay",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 1, y: 0 },
      rotation: 0,
    },
    {
      commandId: commandId(4),
      source: "replay",
      kind: "MOVE_MODULE",
      moduleInstanceId: "module-instance-00000001",
      position: { x: 2, y: 0 },
    },
    {
      commandId: commandId(5),
      source: "replay",
      kind: "ROTATE_MODULE",
      moduleInstanceId: "module-instance-00000001",
      rotation: 90,
    },
    {
      commandId: commandId(6),
      source: "replay",
      kind: "REMOVE_MODULE",
      moduleInstanceId: "module-instance-00000002",
    },
  ];
}

function runFixture() {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed: "task-5-2-repeat" });
  initialState.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 2,
    averageAcquisitionCostUsd: 1,
  };
  const core = new SimCore({
    initialState,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
  const receipts = commands().map((command) => core.enqueue(command));
  const results = core.processPendingCommands();
  const state = core.getStateForSave();

  return {
    receipts,
    results,
    allocatedIds: Object.keys(state.facility.designDraft?.modules ?? {}),
    operationHistory: state.facility.designDraft?.undoStack,
    finalStateHash: hashCanonicalState(state),
    rngState: state.rngState,
  };
}

test("repeats Task 5.2 receipts, results, IDs, history, hash, and RNG across exactly 100 runs", () => {
  const expected = runFixture();
  for (let run = 1; run < 100; run += 1) {
    expect(runFixture()).toEqual(expected);
  }
}, 15_000);
