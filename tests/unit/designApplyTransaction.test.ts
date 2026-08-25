import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, JsonObject, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { createInventoryEconomyCommandHandlers } from "../../src/sim/economy/inventoryTransactions.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";

function commandId(sequence: number): string {
  return `55000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function module(id: string, x: number, y: number): ModuleInstanceState {
  return {
    id,
    definitionId: RELAY,
    position: { x, y },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "boost", frequencyRatio: 1.1, voltageRatio: 1.05 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 2,
    cooldownTicksRemaining: 9,
  };
}

function coreFrom(state: GameState): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
  });
}

function apply(sequence: number, revision: number, cost: number, downtime: number): SimCommand {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: revision,
    acceptedCostUsd: cost,
    acceptedDowntimeTicks: downtime,
  };
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result === undefined) throw new Error("Expected one command result.");
  return result;
}

function changedDraftState(): GameState {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "task-5-5-apply" });
  const removed = module("removed", 0, 0);
  const added = module("added", 3, 0);
  state.facility.modules = { [removed.id]: removed };
  state.facility.designDraft = {
    revision: 2,
    modules: { [added.id]: added },
    routes: {},
    undoStack: [],
    redoStack: [],
  };
  state.economy.cashUsd = 500;
  return state;
}

describe("APPLY_DESIGN", () => {
  test("is registered and rejects outside Design Mode", () => {
    const content = loadContentBundle();
    const core = coreFrom(createInitialGameState({ content, seed: "task-5-5-no-draft" }));

    expect(process(core, apply(1, 0, 0, 0))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
    });
  });

  test("atomically applies the ready shared preview, resets affected modules, and preserves sequences", () => {
    const core = coreFrom(changedDraftState());
    const before = core.getStateForSave();
    const preview = calculateDesignApplyPreview(before, loadContentBundle());
    if (preview.status !== "ready") throw new Error("Expected a ready preview.");

    expect(
      process(core, apply(2, preview.draftRevision, preview.netCostUsd, preview.downtimeTicks)),
    ).toMatchObject({ accepted: true });

    const after = core.getStateForSave();
    const applied = after.facility.modules["added"];
    expect(after.facility.designDraft).toBeNull();
    expect(after.facility.modules).toEqual({ added: applied });
    expect(applied).toMatchObject({
      operationalState: "offline",
      startupTicksRemaining: 5,
      cooldownTicksRemaining: 9,
      overclock: { profile: "boost", frequencyRatio: 1.1, voltageRatio: 1.05 },
    });
    expect(after.facility.liveLayoutRevision).toBe(before.facility.liveLayoutRevision + 1);
    expect(after.facility.nextModuleInstanceSequence).toBe(
      before.facility.nextModuleInstanceSequence,
    );
    expect(after.facility.nextRouteSequence).toBe(before.facility.nextRouteSequence);
    expect(after.rngState).toBe(before.rngState);
    expect(after.economy.cashUsd).toBe(330);
    expect(after.economy.totalExpenseUsd).toBe(170);
    expect(after.economy.totalIncomeUsd).toBe(0);
    expect(after.economy.lastTickIncomeUsd).toBe(before.economy.lastTickIncomeUsd);
    expect(after.economy.lastTickExpenseUsd).toBe(before.economy.lastTickExpenseUsd);
  });

  test("rejects a stale accepted preview atomically after current inventory validation", () => {
    const core = coreFrom(changedDraftState());
    const before = hashCanonicalState(core.getStateForSave());

    expect(process(core, apply(3, 2, 0, 0))).toMatchObject({
      accepted: false,
      code: "STALE_DESIGN_PREVIEW",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("rejects a stale draft revision and a stale downtime independently", () => {
    const core = coreFrom(changedDraftState());
    const preview = calculateDesignApplyPreview(core.getStateForSave(), loadContentBundle());
    if (preview.status !== "ready") throw new Error("Expected a ready preview.");
    const before = hashCanonicalState(core.getStateForSave());

    expect(
      process(
        core,
        apply(30, preview.draftRevision + 1, preview.netCostUsd, preview.downtimeTicks),
      ),
    ).toMatchObject({ accepted: false, code: "STALE_DRAFT_REVISION" });
    expect(
      process(
        core,
        apply(31, preview.draftRevision, preview.netCostUsd, preview.downtimeTicks + 1),
      ),
    ).toMatchObject({ accepted: false, code: "STALE_DESIGN_PREVIEW" });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("derives the final diff from layout rather than valid undo and redo history", () => {
    const state = changedDraftState();
    const noHistory = calculateDesignApplyPreview(state, loadContentBundle());
    const draft = state.facility.designDraft;
    if (draft === null) throw new Error("Expected a draft.");
    const added = draft.modules["added"];
    if (added === undefined) throw new Error("Expected the added module.");
    draft.undoStack.push({
      operationId: "history-place",
      kind: "place",
      payload: { module: structuredClone(added) } as unknown as JsonObject,
    });
    draft.redoStack.push({
      operationId: "history-disconnect",
      kind: "disconnect",
      payload: {
        route: {
          id: "route-history",
          kind: "data",
          from: { moduleInstanceId: "added", portId: "data-east" },
          to: { moduleInstanceId: "removed", portId: "data-west" },
          path: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          capacityPerSecond: 1,
          congestionRatio: 0,
        },
      },
    });

    expect(calculateDesignApplyPreview(state, loadContentBundle())).toEqual(noHistory);
  });

  test("keeps current inventory authoritative in FIFO order before Apply", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "task-5-5-fifo" });
    const added = module("added", 0, 0);
    state.facility.designDraft = {
      revision: 1,
      modules: { [added.id]: added },
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    state.inventory.stacks[RELAY] = {
      definitionId: RELAY,
      quantity: 1,
      averageAcquisitionCostUsd: 1,
    };
    const preview = calculateDesignApplyPreview(state, content);
    if (preview.status !== "ready") throw new Error("Expected a ready preview.");
    const core = new SimCore({
      initialState: state,
      commandHandlers: {
        ...createInventoryEconomyCommandHandlers(content),
        ...createDesignModeCommandHandlers(content),
      },
    });
    core.enqueue({
      commandId: commandId(32),
      source: "player",
      kind: "SELL_INVENTORY_ITEM",
      definitionId: RELAY,
      quantity: 1,
    });
    core.enqueue(apply(33, preview.draftRevision, preview.netCostUsd, preview.downtimeTicks));

    expect(core.processPendingCommands()).toMatchObject([
      { accepted: true },
      { accepted: false, code: "INSUFFICIENT_INVENTORY" },
    ]);
    expect(core.getStateForSave().facility.designDraft).not.toBeNull();
  });

  test("keeps grid and route corruption on the fatal invariant boundary", () => {
    const grid = changedDraftState();
    if (grid.facility.designDraft === null) throw new Error("Expected a draft.");
    const added = grid.facility.designDraft.modules["added"];
    if (added === undefined) throw new Error("Expected the added module.");
    added.position = { x: -1, y: 0 };
    expect(() => calculateDesignApplyPreview(grid, loadContentBundle())).toThrow();

    const route = changedDraftState();
    if (route.facility.designDraft === null) throw new Error("Expected a draft.");
    route.facility.designDraft.routes["bad-route"] = {
      id: "bad-route",
      kind: "data",
      from: { moduleInstanceId: "added", portId: "missing" },
      to: { moduleInstanceId: "removed", portId: "data-west" },
      path: [],
      capacityPerSecond: 0,
      congestionRatio: 0,
    };
    expect(() => calculateDesignApplyPreview(route, loadContentBundle())).toThrow();
  });

  test("rejects invalid command values before comparing the draft revision", () => {
    const core = coreFrom(changedDraftState());
    const before = hashCanonicalState(core.getStateForSave());

    expect(process(core, apply(4, -1, 170, 5))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(process(core, apply(5, 2, 0.0000001, 5))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(process(core, apply(6, 2, 170, -1))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("closes an unchanged draft without revision, inventory, economy, sequence, or RNG mutation", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "task-5-5-no-change" });
    const retained = module("retained", 0, 0);
    state.facility.modules = { [retained.id]: retained };
    state.facility.designDraft = {
      revision: 8,
      modules: { [retained.id]: structuredClone(retained) },
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    state.facility.nextModuleInstanceSequence = 11;
    state.facility.nextRouteSequence = 12;
    const core = coreFrom(state);
    const before = core.getStateForSave();

    expect(process(core, apply(7, 8, 0, 0))).toMatchObject({ accepted: true });
    const after = core.getStateForSave();
    expect(after.facility.designDraft).toBeNull();
    expect(after.facility.liveLayoutRevision).toBe(before.facility.liveLayoutRevision);
    expect(after.facility.modules).toEqual(before.facility.modules);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.economy).toEqual(before.economy);
    expect(after.facility.nextModuleInstanceSequence).toBe(11);
    expect(after.facility.nextRouteSequence).toBe(12);
    expect(after.rngState).toBe(before.rngState);
  });
});
