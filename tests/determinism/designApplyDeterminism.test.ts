import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

function module(id: string, x: number): ModuleInstanceState {
  return {
    id,
    definitionId: "module-data-relay",
    position: { x, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 4,
  };
}

function runFixture() {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "task-5-5-repeat" });
  const removed = module("removed", 0);
  const added = module("added", 3);
  state.facility.modules = { [removed.id]: removed };
  state.facility.designDraft = {
    revision: 3,
    modules: { [added.id]: added },
    routes: {},
    undoStack: [],
    redoStack: [],
  };
  const preview = calculateDesignApplyPreview(state, content);
  if (preview.status !== "ready") throw new Error("Expected ready preview.");
  const core = new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
  const receipt = core.enqueue({
    commandId: "55010000-0000-4000-8000-000000000001",
    source: "replay",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: preview.draftRevision,
    acceptedCostUsd: preview.netCostUsd,
    acceptedDowntimeTicks: preview.downtimeTicks,
  });
  const results = core.processPendingCommands();
  const finalState = core.getStateForSave();
  return {
    preview,
    receipt,
    results,
    canonicalState: canonicalSerialize(finalState),
    stateHash: hashCanonicalState(finalState),
    inventory: finalState.inventory,
    economy: finalState.economy,
    moduleSequence: finalState.facility.nextModuleInstanceSequence,
    routeSequence: finalState.facility.nextRouteSequence,
    rngState: finalState.rngState,
  };
}

test("repeats preview and Apply receipts, results, state, inventory, economy, sequences, and RNG exactly 100 times", () => {
  const expected = runFixture();
  expect(expected.results).toEqual([
    {
      commandId: "55010000-0000-4000-8000-000000000001",
      accepted: true,
      appliedAtTick: 0,
    },
  ]);
  for (let run = 1; run < 100; run += 1) {
    expect(runFixture()).toEqual(expected);
  }
}, 15_000);
