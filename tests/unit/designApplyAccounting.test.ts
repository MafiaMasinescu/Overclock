import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";
const POWER = "module-power-distribution";

function commandId(sequence: number): string {
  return `55000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function module(id: string, definitionId: string, x: number, y: number): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 3,
  };
}

function stateWithDraft(
  live: readonly ModuleInstanceState[],
  draft: readonly ModuleInstanceState[],
): GameState {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "task-5-5-accounting" });
  state.facility.modules = Object.fromEntries(live.map((entry) => [entry.id, entry]));
  state.facility.designDraft = {
    revision: 1,
    modules: Object.fromEntries(draft.map((entry) => [entry.id, structuredClone(entry)])),
    routes: {},
    undoStack: [],
    redoStack: [],
  };
  return state;
}

function apply(
  preview: Extract<ReturnType<typeof calculateDesignApplyPreview>, { status: "ready" }>,
): SimCommand {
  return {
    commandId: commandId(1),
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: preview.draftRevision,
    acceptedCostUsd: preview.netCostUsd,
    acceptedDowntimeTicks: preview.downtimeTicks,
  };
}

function process(state: GameState, command: SimCommand) {
  const core = new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
  });
  core.enqueue(command);
  return { core, result: core.processPendingCommands()[0] };
}

test("uses current partial inventory with informational book value and no second cash charge", () => {
  const state = stateWithDraft([], [module("added", RELAY, 0, 0)]);
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 2,
    averageAcquisitionCostUsd: 12.5,
  };
  const preview = calculateDesignApplyPreview(state, loadContentBundle());
  if (preview.status !== "ready") throw new Error("Expected ready preview.");
  expect(preview.inventoryConsumption).toEqual([
    { definitionId: RELAY, quantity: 1, bookValueUsd: 12.5 },
  ]);
  expect(preview.consumedInventoryBookValueUsd).toBe(12.5);
  expect(preview.netCostUsd).toBe(85);

  const { core, result } = process(state, apply(preview));
  expect(result).toMatchObject({ accepted: true });
  expect(core.getStateForSave().inventory.stacks[RELAY]).toEqual({
    definitionId: RELAY,
    quantity: 1,
    averageAcquisitionCostUsd: 12.5,
  });
  expect(core.getStateForSave().economy.totalExpenseUsd).toBe(85);
});

test("removes a fully consumed inventory stack", () => {
  const state = stateWithDraft([], [module("added", RELAY, 0, 0)]);
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 1,
    averageAcquisitionCostUsd: 10,
  };
  const preview = calculateDesignApplyPreview(state, loadContentBundle());
  if (preview.status !== "ready") throw new Error("Expected ready preview.");

  const { core, result } = process(state, apply(preview));
  expect(result).toMatchObject({ accepted: true });
  expect(core.getStateForSave().inventory.stacks[RELAY]).toBeUndefined();
});

test("settles per-unit salvage as gross lifetime income and permits a negative net Apply cost", () => {
  const state = stateWithDraft([module("removed", POWER, 0, 0)], []);
  const preview = calculateDesignApplyPreview(state, loadContentBundle());
  if (preview.status !== "ready") throw new Error("Expected ready preview.");
  expect(preview.salvageCredits).toEqual([
    { definitionId: POWER, quantity: 1, unitCreditUsd: 980, creditUsd: 980 },
  ]);
  expect(preview.laborCostUsd).toBe(85);
  expect(preview.netCostUsd).toBe(-895);
  const cashBefore = state.economy.cashUsd;

  const { core, result } = process(state, apply(preview));
  expect(result).toMatchObject({ accepted: true });
  expect(core.getStateForSave().economy.cashUsd).toBe(cashBefore + 895);
  expect(core.getStateForSave().economy.totalExpenseUsd).toBe(85);
  expect(core.getStateForSave().economy.totalIncomeUsd).toBe(980);
});

test("accepts the exact final credit boundary and rejects one microdollar below it atomically", () => {
  const accepted = stateWithDraft([], [module("added", RELAY, 0, 0)]);
  accepted.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 1,
    averageAcquisitionCostUsd: 1,
  };
  accepted.economy.cashUsd = -85;
  accepted.economy.creditLimitUsd = 170;
  const preview = calculateDesignApplyPreview(accepted, loadContentBundle());
  if (preview.status !== "ready") throw new Error("Expected ready preview.");
  expect(process(accepted, apply(preview)).result).toMatchObject({ accepted: true });

  const rejected = stateWithDraft([], [module("added", RELAY, 0, 0)]);
  rejected.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 1,
    averageAcquisitionCostUsd: 1,
  };
  rejected.economy.cashUsd = -85;
  rejected.economy.creditLimitUsd = 169.999999;
  const before = hashCanonicalState(rejected);
  expect(process(rejected, apply(preview)).result).toMatchObject({
    accepted: false,
    code: "INSUFFICIENT_CASH",
  });
  expect(hashCanonicalState(rejected)).toBe(before);
});

test("returns deterministic invalid-system outcomes for revision capacity and preserves rejected state", () => {
  const state = stateWithDraft([], [module("added", RELAY, 0, 0)]);
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 1,
    averageAcquisitionCostUsd: 1,
  };
  state.facility.liveLayoutRevision = Number.MAX_SAFE_INTEGER;
  expect(calculateDesignApplyPreview(state, loadContentBundle())).toEqual({
    status: "blocked",
    code: "INVALID_SYSTEM",
  });

  const transactionState = structuredClone(state);
  transactionState.facility.liveLayoutRevision = Number.MAX_SAFE_INTEGER;
  const preview = calculateDesignApplyPreview(transactionState, loadContentBundle());
  expect(preview).toMatchObject({ status: "blocked", code: "INVALID_SYSTEM" });
  const before = hashCanonicalState(transactionState);
  expect(
    process(transactionState, {
      commandId: commandId(2),
      source: "player",
      kind: "APPLY_DESIGN",
      expectedDraftRevision: 1,
      acceptedCostUsd: 85,
      acceptedDowntimeTicks: 5,
    }).result,
  ).toMatchObject({ accepted: false, code: "INVALID_SYSTEM" });
  expect(hashCanonicalState(transactionState)).toBe(before);
});

test("keeps malformed Design Mode history on the fatal ADR-0002 invariant boundary", () => {
  const state = stateWithDraft([], [module("added", RELAY, 0, 0)]);
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 1,
    averageAcquisitionCostUsd: 1,
  };
  state.facility.designDraft?.undoStack.push({
    operationId: "bad-history",
    kind: "place",
    payload: { incomplete: true },
  });
  const core = new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
  });
  core.enqueue({
    commandId: commandId(3),
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: 1,
    acceptedCostUsd: 85,
    acceptedDowntimeTicks: 5,
  });

  expect(() => core.processPendingCommands()).toThrow(SimulatorInvariantError);
});
