import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";

const RELAY = "module-data-relay";

function module(id: string, x: number, y: number, rotation = 0): ModuleInstanceState {
  return {
    id,
    definitionId: RELAY,
    position: { x, y },
    rotation: rotation as 0 | 90 | 180 | 270,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 7,
  };
}

function route(id: string, from: ModuleInstanceState, to: ModuleInstanceState): RouteState {
  return {
    id,
    kind: "data",
    from: { moduleInstanceId: from.id, portId: "data-east" },
    to: { moduleInstanceId: to.id, portId: "data-west" },
    path: [
      { x: from.position.x, y: from.position.y },
      { x: from.position.x + 1, y: from.position.y },
      { x: to.position.x - 1, y: to.position.y },
      { x: to.position.x, y: to.position.y },
    ],
    capacityPerSecond: 60_000,
    congestionRatio: 0,
  };
}

function stateWithDraft(
  liveModules: readonly ModuleInstanceState[],
  draftModules: readonly ModuleInstanceState[],
  liveRoutes: readonly RouteState[] = [],
  draftRoutes: readonly RouteState[] = [],
): GameState {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "task-5-5-preview" });
  state.facility.modules = Object.fromEntries(liveModules.map((entry) => [entry.id, entry]));
  state.facility.routes = Object.fromEntries(liveRoutes.map((entry) => [entry.id, entry]));
  state.facility.designDraft = {
    revision: 4,
    modules: Object.fromEntries(draftModules.map((entry) => [entry.id, structuredClone(entry)])),
    routes: Object.fromEntries(draftRoutes.map((entry) => [entry.id, structuredClone(entry)])),
    undoStack: [],
    redoStack: [],
  };
  return state;
}

describe("calculateDesignApplyPreview", () => {
  test("returns a typed blocked outcome outside Design Mode", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "task-5-5-no-draft" });

    expect(calculateDesignApplyPreview(state, content)).toEqual({
      status: "blocked",
      code: "NOT_IN_DESIGN_MODE",
    });
  });

  test("returns a detached zero-cost, zero-downtime ready preview for an unchanged draft", () => {
    const unchanged = module("unchanged", 0, 0);
    const state = stateWithDraft([unchanged], [unchanged]);

    const preview = calculateDesignApplyPreview(state, loadContentBundle());

    expect(preview).toMatchObject({
      status: "ready",
      draftRevision: 4,
      hasLayoutChanges: false,
      addedModuleIds: [],
      removedModuleIds: [],
      movedModuleIds: [],
      rotatedModuleIds: [],
      changedModuleIds: [],
      inventoryConsumption: [],
      salvageCredits: [],
      consumedInventoryBookValueUsd: 0,
      salvageCreditUsd: 0,
      laborCostUsd: 0,
      netCostUsd: 0,
      downtimeTicks: 0,
    });
    if (preview.status !== "ready") throw new Error("Expected a ready preview.");
    expect(JSON.parse(JSON.stringify(preview))).toEqual(preview);
    expect(Object.isFrozen(preview)).toBe(true);
  });

  test("classifies module IDs in stable order and charges a moved-and-rotated module once", () => {
    const removed = module("removed-z", 0, 0);
    const moved = module("moved-b", 3, 0);
    const movedAndRotated = module("changed-c", 6, 0);
    const unchanged = module("unchanged-d", 9, 0);
    const added = module("added-a", 12, 0);
    const state = stateWithDraft(
      [removed, moved, movedAndRotated, unchanged],
      [
        unchanged,
        movedAndRotated,
        added,
        { ...moved, position: { x: 3, y: 2 } },
        {
          ...movedAndRotated,
          position: { x: 6, y: 2 },
          rotation: 90,
        },
      ],
    );

    const preview = calculateDesignApplyPreview(state, loadContentBundle());

    expect(preview).toMatchObject({
      status: "ready",
      addedModuleIds: ["added-a"],
      removedModuleIds: ["removed-z"],
      movedModuleIds: ["changed-c", "moved-b"],
      rotatedModuleIds: ["changed-c"],
      changedModuleIds: ["added-a", "changed-c", "moved-b", "removed-z"],
      laborCostUsd: 340,
      downtimeTicks: 5,
    });
  });

  test("treats a valid route-only final change as layout change with zero labor and downtime", () => {
    const left = module("left", 0, 0);
    const right = module("right", 3, 0);
    const state = stateWithDraft([left, right], [left, right], [], [route("route-a", left, right)]);

    expect(calculateDesignApplyPreview(state, loadContentBundle())).toMatchObject({
      status: "ready",
      hasLayoutChanges: true,
      changedModuleIds: [],
      laborCostUsd: 0,
      downtimeTicks: 0,
    });
  });

  test("nets same-definition installed hardware before reporting a stable current inventory shortfall", () => {
    const retained = module("retained", 0, 0);
    const addedOne = module("added-one", 3, 0);
    const addedTwo = module("added-two", 6, 0);
    const state = stateWithDraft([retained], [retained, addedOne, addedTwo]);
    state.inventory.stacks[RELAY] = {
      definitionId: RELAY,
      quantity: 1,
      averageAcquisitionCostUsd: 12.5,
    };

    expect(calculateDesignApplyPreview(state, loadContentBundle())).toEqual({
      status: "blocked",
      code: "INSUFFICIENT_INVENTORY",
      shortfalls: [{ definitionId: RELAY, requiredQuantity: 2, availableQuantity: 1 }],
    });
  });
});
