import { describe, expect, test } from "vitest";

import { loadContentBundle, validateContent } from "../../src/content/loader/contentLoader.ts";
import { createRawContentPack } from "../../src/content/loader/rawContentPack.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import type { CommandResult, SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInventoryEconomyCommandHandlers } from "../../src/sim/economy/inventoryTransactions.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const VACUUM_TUBE = "module-vacuum-tube-logic";
const ARITHMETIC_UNIT = "module-arithmetic-unit";

function commandId(sequence: number): string {
  return `40000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function buy(
  sequence: number,
  definitionId = VACUUM_TUBE,
  quantity = 1,
): Extract<SimCommand, { kind: "BUY_MODULE" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "BUY_MODULE",
    definitionId,
    quantity,
  };
}

function sell(
  sequence: number,
  definitionId = VACUUM_TUBE,
  quantity = 1,
): Extract<SimCommand, { kind: "SELL_INVENTORY_ITEM" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "SELL_INVENTORY_ITEM",
    definitionId,
    quantity,
  };
}

function createContentWithModule(
  definitionId: string,
  changes: Partial<{ priceUsd: number; salvageRatio: number }>,
): ContentBundle {
  const raw = createRawContentPack();
  const definition = raw.modules.modules.find((module) => module.id === definitionId);
  if (definition === undefined) {
    throw new Error(`Missing module fixture ${definitionId}`);
  }
  Object.assign(definition, changes);
  return validateContent(raw);
}

function createCore(
  options: {
    content?: ContentBundle;
    seed?: string;
    editState?: (state: GameState) => void;
  } = {},
): { core: SimCore; initialState: GameState; content: ContentBundle } {
  const content = options.content ?? loadContentBundle();
  const initialState = createInitialGameState({
    content,
    seed: options.seed ?? "inventory-transactions",
  });
  options.editState?.(initialState);
  return {
    core: new SimCore({
      initialState,
      commandHandlers: createInventoryEconomyCommandHandlers(content),
    }),
    initialState,
    content,
  };
}

function process(core: SimCore, command: SimCommand): CommandResult {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result === undefined) {
    throw new Error("Expected one command result.");
  }
  return result;
}

function getStack(state: GameState, definitionId: string) {
  const stack = state.inventory.stacks[definitionId];
  if (stack === undefined) {
    throw new Error(`Expected inventory stack ${definitionId}.`);
  }
  return stack;
}

describe("BUY_MODULE", () => {
  test("buys multiple units into a new inventory stack without touching the facility", () => {
    const { core, initialState } = createCore({
      editState(state) {
        Reflect.deleteProperty(state.inventory.stacks, VACUUM_TUBE);
        state.economy.lastTickExpenseUsd = 1.25;
      },
    });

    expect(process(core, buy(1, VACUUM_TUBE, 3))).toEqual({
      commandId: commandId(1),
      accepted: true,
      appliedAtTick: 0,
    });
    const state = core.getStateForSave();
    expect(state.inventory.stacks[VACUUM_TUBE]).toEqual({
      definitionId: VACUUM_TUBE,
      quantity: 3,
      averageAcquisitionCostUsd: 1_850,
    });
    expect(state.economy).toMatchObject({
      cashUsd: 26_450,
      totalExpenseUsd: 5_550,
      lastTickExpenseUsd: 1.25,
    });
    expect(state.facility.modules).toEqual({});
    expect(state.rngState).toBe(initialState.rngState);
  });

  test("merges an existing stack with a deterministically rounded weighted acquisition cost", () => {
    const content = createContentWithModule(VACUUM_TUBE, { priceUsd: 2.000001 });
    const { core } = createCore({
      content,
      editState(state) {
        state.inventory.stacks[VACUUM_TUBE] = {
          definitionId: VACUUM_TUBE,
          quantity: 1,
          averageAcquisitionCostUsd: 1,
        };
      },
    });

    expect(process(core, buy(2, VACUUM_TUBE, 2)).accepted).toBe(true);
    expect(core.getStateForSave().inventory.stacks[VACUUM_TUBE]).toEqual({
      definitionId: VACUUM_TUBE,
      quantity: 3,
      averageAcquisitionCostUsd: 1.666667,
    });
  });

  test("allows an exact zero-cash boundary", () => {
    const { core } = createCore({
      editState(state) {
        state.economy.cashUsd = 1_850;
      },
    });

    expect(process(core, buy(3)).accepted).toBe(true);
    expect(core.getStateForSave().economy.cashUsd).toBe(0);
  });

  test("allows an exact credit boundary", () => {
    const { core } = createCore({
      editState(state) {
        state.economy.cashUsd = 150;
        state.economy.creditLimitUsd = 1_700;
      },
    });

    expect(process(core, buy(4)).accepted).toBe(true);
    expect(core.getStateForSave().economy.cashUsd).toBe(-1_700);
  });

  test("rejects a purchase below the credit boundary atomically", () => {
    const { core, initialState } = createCore({
      editState(state) {
        state.economy.cashUsd = 149.999999;
        state.economy.creditLimitUsd = 1_700;
      },
    });
    const beforeHash = hashCanonicalState(initialState);

    expect(process(core, buy(5))).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_CASH",
      messageKey: "errors.insufficient-cash",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
    expect(core.getStateForSave().rngState).toBe(initialState.rngState);
  });

  test("requires every module research unlock to be completed", () => {
    const { core } = createCore();

    expect(process(core, buy(6, ARITHMETIC_UNIT))).toMatchObject({
      accepted: false,
      code: "RESEARCH_REQUIRED",
      messageKey: "errors.research-required",
    });
  });

  test("accepts a researched module", () => {
    const { core } = createCore({
      editState(state) {
        state.research.statuses["research-stable-power-distribution"] = "completed";
      },
    });

    expect(process(core, buy(7, ARITHMETIC_UNIT))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().inventory.stacks[ARITHMETIC_UNIT]?.quantity).toBe(1);
  });

  test("rejects an unknown module identifier", () => {
    const { core } = createCore();

    expect(process(core, buy(8, "module-does-not-exist"))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
      messageKey: "errors.invalid-payload",
    });
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid quantity %s at command admission",
    (quantity) => {
      const { core } = createCore();
      expect(() => core.enqueue(buy(9, VACUUM_TUBE, quantity))).toThrow();
      expect(core.processPendingCommands()).toEqual([]);
    },
  );

  test("rejects overflowing transaction arithmetic without changing state", () => {
    const { core, initialState } = createCore();
    const beforeHash = hashCanonicalState(initialState);

    expect(process(core, buy(10, VACUUM_TUBE, Number.MAX_SAFE_INTEGER))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
  });

  test("rejects a stack quantity overflow even when a zero-price purchase has no cash cost", () => {
    const content = createContentWithModule(VACUUM_TUBE, { priceUsd: 0 });
    const { core } = createCore({
      content,
      editState(state) {
        state.inventory.stacks[VACUUM_TUBE] = {
          definitionId: VACUUM_TUBE,
          quantity: Number.MAX_SAFE_INTEGER,
          averageAcquisitionCostUsd: 0,
        };
      },
    });

    expect(process(core, buy(11))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
  });
});

describe("SELL_INVENTORY_ITEM", () => {
  test("partially sells a stack and preserves its average acquisition cost", () => {
    const { core, initialState } = createCore({
      editState(state) {
        state.inventory.stacks[VACUUM_TUBE] = {
          definitionId: VACUUM_TUBE,
          quantity: 3,
          averageAcquisitionCostUsd: 999.123456,
        };
        state.economy.lastTickIncomeUsd = 2.5;
      },
    });

    expect(process(core, sell(20, VACUUM_TUBE, 2)).accepted).toBe(true);
    const state = core.getStateForSave();
    expect(state.inventory.stacks[VACUUM_TUBE]).toEqual({
      definitionId: VACUUM_TUBE,
      quantity: 1,
      averageAcquisitionCostUsd: 999.123456,
    });
    expect(state.economy).toMatchObject({
      cashUsd: 33_295,
      totalIncomeUsd: 1_295,
      lastTickIncomeUsd: 2.5,
    });
    expect(state.rngState).toBe(initialState.rngState);
  });

  test("fully sells and removes a stack", () => {
    const { core } = createCore();

    expect(process(core, sell(21, VACUUM_TUBE, 2)).accepted).toBe(true);
    expect(core.getStateForSave().inventory.stacks[VACUUM_TUBE]).toBeUndefined();
  });

  test.each([3, Number.MAX_SAFE_INTEGER])(
    "rejects an insufficient inventory quantity of %s without a partial sale",
    (quantity) => {
      const { core, initialState } = createCore();
      const beforeHash = hashCanonicalState(initialState);

      expect(process(core, sell(22, VACUUM_TUBE, quantity))).toMatchObject({
        accepted: false,
        code: "INSUFFICIENT_INVENTORY",
        messageKey: "errors.insufficient-inventory",
      });
      expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
      expect(core.getStateForSave().rngState).toBe(initialState.rngState);
    },
  );

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid sale quantity %s at command admission",
    (quantity) => {
      const { core } = createCore();
      expect(() => core.enqueue(sell(22, VACUUM_TUBE, quantity))).toThrow();
      expect(core.processPendingCommands()).toEqual([]);
    },
  );

  test("sells a research-locked module already in inventory", () => {
    const { core } = createCore({
      editState(state) {
        state.inventory.stacks[ARITHMETIC_UNIT] = {
          definitionId: ARITHMETIC_UNIT,
          quantity: 1,
          averageAcquisitionCostUsd: 4_200,
        };
      },
    });

    expect(process(core, sell(23, ARITHMETIC_UNIT))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().economy.totalIncomeUsd).toBe(1_470);
  });

  test("uses current content price and salvage ratio instead of acquisition cost", () => {
    const content = createContentWithModule(VACUUM_TUBE, {
      priceUsd: 10.000003,
      salvageRatio: 0.35,
    });
    const { core } = createCore({
      content,
      editState(state) {
        state.inventory.stacks[VACUUM_TUBE] = {
          definitionId: VACUUM_TUBE,
          quantity: 1,
          averageAcquisitionCostUsd: 9_000,
        };
      },
    });

    expect(process(core, sell(24))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().economy.totalIncomeUsd).toBe(3.500001);
  });

  test("does not sell an installed module when inventory is empty", () => {
    const installed: ModuleInstanceState = {
      id: "installed-vacuum-tube",
      definitionId: VACUUM_TUBE,
      position: { x: 0, y: 0 },
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
    const { core } = createCore({
      editState(state) {
        Reflect.deleteProperty(state.inventory.stacks, VACUUM_TUBE);
        state.facility.modules[installed.id] = installed;
      },
    });

    expect(process(core, sell(25))).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_INVENTORY",
    });
    expect(core.getStateForSave().facility.modules[installed.id]).toEqual(installed);
  });

  test("makes a grouped sale equivalent to individual unit sales", () => {
    const grouped = createCore({
      editState(state) {
        getStack(state, VACUUM_TUBE).quantity = 4;
      },
    }).core;
    const individual = createCore({
      editState(state) {
        getStack(state, VACUUM_TUBE).quantity = 4;
      },
    }).core;

    process(grouped, sell(26, VACUUM_TUBE, 3));
    process(individual, sell(27));
    process(individual, sell(28));
    process(individual, sell(29));

    expect(grouped.getStateForSave().economy).toEqual(individual.getStateForSave().economy);
    expect(grouped.getStateForSave().inventory).toEqual(individual.getStateForSave().inventory);
  });

  test("rejects unknown module content before inspecting inventory", () => {
    const { core } = createCore();
    expect(process(core, sell(30, "module-does-not-exist"))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
  });
});

describe("inventory transaction pipeline", () => {
  test("accumulates lifetime totals and leaves both periodic tick-flow fields unchanged", () => {
    const { core } = createCore({
      editState(state) {
        state.economy.totalIncomeUsd = 10.5;
        state.economy.totalExpenseUsd = 20.25;
        state.economy.lastTickIncomeUsd = 3.25;
        state.economy.lastTickExpenseUsd = 4.75;
      },
    });

    core.enqueue(buy(39));
    core.enqueue(sell(40));
    expect(core.processPendingCommands().every((result) => result.accepted)).toBe(true);

    expect(core.getStateForSave().economy).toMatchObject({
      cashUsd: 30_797.5,
      totalIncomeUsd: 658,
      totalExpenseUsd: 1_870.25,
      lastTickIncomeUsd: 3.25,
      lastTickExpenseUsd: 4.75,
    });
  });

  test("processes FIFO buy then sell using the bought inventory", () => {
    const { core } = createCore({
      editState(state) {
        Reflect.deleteProperty(state.inventory.stacks, VACUUM_TUBE);
      },
    });
    const receipts = [core.enqueue(buy(40)), core.enqueue(sell(41))];

    expect(core.processPendingCommands()).toEqual([
      { commandId: commandId(40), accepted: true, appliedAtTick: 0 },
      { commandId: commandId(41), accepted: true, appliedAtTick: 0 },
    ]);
    expect(receipts.map((receipt) => receipt.queueSequence)).toEqual([0, 1]);
    expect(core.getStateForSave().inventory.stacks[VACUUM_TUBE]).toBeUndefined();
    expect(core.getStateForSave().economy).toMatchObject({
      cashUsd: 30_797.5,
      totalExpenseUsd: 1_850,
      totalIncomeUsd: 647.5,
      lastTickExpenseUsd: 0,
      lastTickIncomeUsd: 0,
    });
  });

  test("keeps receipts, results, state, and transaction RNG JSON serializable", () => {
    const { core } = createCore();
    const receipt = core.enqueue(buy(42));
    const results = core.processPendingCommands();
    const state = core.getStateForSave();

    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  test("repeats identical receipts, results, state hash, and RNG across exactly 100 runs", () => {
    let expected:
      | {
          receipts: unknown[];
          results: readonly CommandResult[];
          stateHash: string;
          rngState: number;
        }
      | undefined;

    for (let run = 0; run < 100; run += 1) {
      const { core } = createCore({ seed: "task-four-repeat-fixture" });
      const receipts = [
        core.enqueue(buy(50, VACUUM_TUBE, 2)),
        core.enqueue(sell(51)),
        core.enqueue(buy(52, ARITHMETIC_UNIT)),
        core.enqueue(sell(53, "module-unknown")),
      ];
      const actual = {
        receipts,
        results: core.processPendingCommands(),
        stateHash: hashCanonicalState(core.getStateForSave()),
        rngState: core.getStateForSave().rngState,
      };

      expected ??= actual;
      expect(actual).toEqual(expected);
    }
  }, 15_000);
});
