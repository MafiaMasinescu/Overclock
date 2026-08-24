import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";

function commandId(sequence: number): string {
  return `53010000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
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
  return [
    { commandId: commandId(1), source: "replay", kind: "ENTER_DESIGN_MODE" },
    {
      commandId: commandId(2),
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
    },
    {
      commandId: commandId(3),
      source: "replay",
      kind: "CONNECT_PORTS",
      from: { moduleInstanceId: "right", portId: "data-west" },
      to: { moduleInstanceId: "left", portId: "data-east" },
      path: [
        { x: 3, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
    },
    {
      commandId: commandId(4),
      source: "replay",
      kind: "DISCONNECT_ROUTE",
      routeId: "route-00000001",
    },
    {
      commandId: commandId(5),
      source: "replay",
      kind: "DISCONNECT_ROUTE",
      routeId: "route-00000001",
    },
    {
      commandId: commandId(6),
      source: "replay",
      kind: "CONNECT_PORTS",
      from: { moduleInstanceId: "bottom-left", portId: "data-east" },
      to: { moduleInstanceId: "bottom-right", portId: "data-west" },
      path: [
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
    },
  ];
}

function runFixture() {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed: "task-5-3-repeat" });
  const modules = [
    relay("left", 0, 0),
    relay("right", 3, 0),
    relay("bottom-left", 0, 2),
    relay("bottom-right", 3, 2),
  ];
  initialState.facility.modules = Object.fromEntries(modules.map((module) => [module.id, module]));
  const core = new SimCore({
    initialState,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
  const receipts = commands().map((command) => core.enqueue(command));
  const results = core.processPendingCommands();
  const state = core.getStateForSave();
  const draft = state.facility.designDraft;

  return {
    receipts,
    results,
    routeIds: Object.keys(draft?.routes ?? {}),
    routes: draft?.routes,
    revision: draft?.revision,
    undoStack: draft?.undoStack,
    redoStack: draft?.redoStack,
    moduleSequence: state.facility.nextModuleInstanceSequence,
    routeSequence: state.facility.nextRouteSequence,
    finalStateHash: hashCanonicalState(state),
    rngState: state.rngState,
  };
}

test("repeats Task 5.3 routing receipts, results, routes, IDs, history, hash, and RNG across exactly 100 runs", () => {
  const expected = runFixture();
  for (let run = 1; run < 100; run += 1) {
    expect(runFixture()).toEqual(expected);
  }
}, 15_000);
