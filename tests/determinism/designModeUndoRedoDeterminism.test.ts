import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";
const content = loadContentBundle();

function commandId(sequence: number): string {
  return `54010000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function relay(id: string, x: number, y: number): ModuleInstanceState {
  return {
    id,
    definitionId: RELAY,
    position: { x, y },
    rotation: 0,
    operationalState: "offline",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function commands(): readonly SimCommand[] {
  const connect = (sequence: number): SimCommand => ({
    commandId: commandId(sequence),
    source: "replay",
    kind: "CONNECT_PORTS",
    from: { moduleInstanceId: "left", portId: "data-east" },
    to: { moduleInstanceId: "right", portId: "data-west" },
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  });
  const undo = (sequence: number): SimCommand => ({
    commandId: commandId(sequence),
    source: "replay",
    kind: "UNDO_DESIGN",
  });
  const redo = (sequence: number): SimCommand => ({
    commandId: commandId(sequence),
    source: "replay",
    kind: "REDO_DESIGN",
  });
  return [
    { commandId: commandId(1), source: "replay", kind: "ENTER_DESIGN_MODE" },
    {
      commandId: commandId(2),
      source: "replay",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 4 },
      rotation: 0,
    },
    connect(3),
    {
      commandId: commandId(4),
      source: "replay",
      kind: "MOVE_MODULE",
      moduleInstanceId: "left",
      position: { x: 0, y: 2 },
    },
    undo(5),
    redo(6),
    undo(7),
    {
      commandId: commandId(8),
      source: "replay",
      kind: "ROTATE_MODULE",
      moduleInstanceId: "left",
      rotation: 90,
    },
    undo(9),
    redo(10),
    undo(11),
    { commandId: commandId(12), source: "replay", kind: "REMOVE_MODULE", moduleInstanceId: "left" },
    undo(13),
    redo(14),
    undo(15),
    {
      commandId: commandId(16),
      source: "replay",
      kind: "DISCONNECT_ROUTE",
      routeId: "route-00000001",
    },
    undo(17),
    redo(18),
  ];
}

const COMMANDS = commands();

function runFixture() {
  const initialState = createInitialGameState({ content, seed: "task-5-4-repeat" });
  initialState.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 4,
    averageAcquisitionCostUsd: 1,
  };
  initialState.facility.modules = { left: relay("left", 0, 0), right: relay("right", 3, 0) };
  const core = new SimCore({
    initialState,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
  const receipts = COMMANDS.map((entry) => core.enqueue(entry));
  const results = core.processPendingCommands();
  const state = core.getStateForSave();
  const draft = state.facility.designDraft;
  return {
    receipts,
    results,
    canonicalState: canonicalSerialize(state),
    stateHash: hashCanonicalState(state),
    undoStack: draft?.undoStack,
    redoStack: draft?.redoStack,
    revision: draft?.revision,
    moduleSequence: state.facility.nextModuleInstanceSequence,
    routeSequence: state.facility.nextRouteSequence,
    rngState: state.rngState,
  };
}

test("repeats mixed all-kind undo and redo execution exactly 100 times", () => {
  const expected = runFixture();
  expect(expected.results.every((result) => result.accepted)).toBe(true);
  for (let run = 1; run < 100; run += 1) {
    expect(runFixture()).toEqual(expected);
  }
}, 15_000);
