import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createBlueprintCommandHandlers } from "../../src/sim/blueprints/blueprintCommands.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const RELAY = "module-data-relay";

function commandId(sequence: number): string {
  return `13000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function relay(id: string, x: number): ModuleInstanceState {
  return {
    id,
    definitionId: RELAY,
    position: { x, y: 0 },
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

function liveRoute(): RouteState {
  return {
    id: "live-route",
    kind: "data",
    from: { moduleInstanceId: "left", portId: "data-east" },
    to: { moduleInstanceId: "right", portId: "data-west" },
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    capacityPerSecond: 60_000,
    congestionRatio: 0,
  };
}

function initialState(): GameState {
  const state = createInitialGameState({ content, seed: "task-13-exact-100" });
  for (const researchId of Object.keys(state.research.statuses)) {
    state.research.statuses[researchId] = "completed";
  }
  state.facility.modules = { left: relay("left", 0), right: relay("right", 3) };
  state.facility.routes = { "live-route": liveRoute() };
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 10,
    averageAcquisitionCostUsd: content.modules[RELAY]?.priceUsd ?? 0,
  };
  return state;
}

function runBlueprintSequence() {
  const state = initialState();
  const initialRngState = state.rngState;
  const core = new SimCore({
    initialState: state,
    commandHandlers: {
      ...createBlueprintCommandHandlers(content),
      ...createDesignModeCommandHandlers(content),
    },
  });
  const commands: readonly SimCommand[] = [
    {
      commandId: commandId(1),
      source: "debug",
      kind: "SAVE_BLUEPRINT",
      name: " Exact Blueprint ",
      selectedModuleIds: ["right", "left"],
    },
    {
      commandId: commandId(2),
      source: "debug",
      kind: "RENAME_BLUEPRINT",
      blueprintId: "blueprint-00000001",
      name: "Exact Blueprint Renamed",
    },
    { commandId: commandId(3), source: "debug", kind: "ENTER_DESIGN_MODE" },
    {
      commandId: commandId(4),
      source: "debug",
      kind: "INSTANTIATE_BLUEPRINT",
      blueprintId: "blueprint-00000001",
      position: { x: 0, y: 2 },
      rotation: 0,
    },
    { commandId: commandId(5), source: "debug", kind: "UNDO_DESIGN" },
    { commandId: commandId(6), source: "debug", kind: "REDO_DESIGN" },
  ];
  for (const command of commands) core.enqueue(command);
  const results = core.processPendingCommands();
  const finalState = core.getStateForSave();
  return {
    results,
    finalHash: hashCanonicalState(finalState),
    rngState: finalState.rngState,
    rngUnchanged: finalState.rngState === initialRngState,
    blueprintSequence: finalState.blueprints.nextBlueprintSequence,
    moduleSequence: finalState.facility.nextModuleInstanceSequence,
    routeSequence: finalState.facility.nextRouteSequence,
    draftRevision: finalState.facility.designDraft?.revision,
  };
}

test("repeats the Blueprint save, rename, instantiate, Undo, and Redo sequence exactly 100 times", () => {
  const expected = runBlueprintSequence();
  expect(expected.results).toHaveLength(6);
  expect(expected.results.every(({ accepted }) => accepted)).toBe(true);
  expect(expected.rngUnchanged).toBe(true);
  expect(expected.blueprintSequence).toBe(2);
  expect(expected.moduleSequence).toBe(3);
  expect(expected.routeSequence).toBe(2);
  expect(expected.draftRevision).toBe(3);

  for (let run = 1; run < 100; run += 1) {
    expect(runBlueprintSequence()).toEqual(expected);
  }
}, 30_000);
