import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type { GameState, InventoryStack } from "../core/types.ts";
import { assertValidInventoryEconomyState } from "./inventoryEconomyState.ts";
import {
  addMicrodollars,
  divideMicrodollarsHalfAwayFromZero,
  evaluateCreditAffordability,
  microdollarsToUsd,
  multiplyMicrodollars,
  usdToMicrodollars,
} from "./money.ts";

export type InventoryEconomyCommandHandlers = Pick<
  CommandHandlerRegistry,
  "BUY_MODULE" | "SELL_INVENTORY_ITEM"
>;

const REJECTIONS = {
  invalidPayload: {
    code: "INVALID_PAYLOAD",
    messageKey: "errors.invalid-payload",
  },
  insufficientCash: {
    code: "INSUFFICIENT_CASH",
    messageKey: "errors.insufficient-cash",
  },
  insufficientInventory: {
    code: "INSUFFICIENT_INVENTORY",
    messageKey: "errors.insufficient-inventory",
  },
  researchRequired: {
    code: "RESEARCH_REQUIRED",
    messageKey: "errors.research-required",
  },
} as const satisfies Record<string, CommandHandlerRejection>;

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function resolveModule(
  content: ContentBundle,
  definitionId: string,
): ContentBundle["modules"][string] | undefined {
  if (!Object.hasOwn(content.modules, definitionId)) {
    return undefined;
  }
  return content.modules[definitionId];
}

function addQuantities(left: number, right: number): number {
  if (!isPositiveSafeInteger(left) || !isPositiveSafeInteger(right)) {
    throw new RangeError("Inventory quantities must be positive safe integers.");
  }
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Inventory quantity exceeds the safe-integer range.");
  }
  return result;
}

export type ModulePurchasePlan =
  | {
      readonly status: "ready";
      readonly costUsd: number;
      readonly nextStack: InventoryStack;
      readonly nextCashUsd: number;
      readonly nextTotalExpenseUsd: number;
    }
  | {
      readonly status: "rejected";
      readonly code: "INVALID_PAYLOAD" | "INSUFFICIENT_CASH" | "RESEARCH_REQUIRED";
    };

/** Exact, side-effect-free BUY_MODULE preflight shared by the command and Build reads. */
export function planModulePurchase(
  state: Readonly<GameState>,
  content: ContentBundle,
  definitionId: string,
  quantity: number,
): ModulePurchasePlan {
  if (!isPositiveSafeInteger(quantity)) return { status: "rejected", code: "INVALID_PAYLOAD" };
  const definition = resolveModule(content, definitionId);
  if (definition === undefined) return { status: "rejected", code: "INVALID_PAYLOAD" };
  if (
    !definition.unlockResearchIds.every(
      (researchId) => state.research.statuses[researchId] === "completed",
    )
  ) {
    return { status: "rejected", code: "RESEARCH_REQUIRED" };
  }

  try {
    const unitPriceMicrodollars = usdToMicrodollars(definition.priceUsd);
    const purchaseCostMicrodollars = multiplyMicrodollars(unitPriceMicrodollars, quantity);
    const affordability = evaluateCreditAffordability(
      state.economy.cashUsd,
      state.economy.creditLimitUsd,
      microdollarsToUsd(purchaseCostMicrodollars),
    );
    if (affordability.status === "insufficient") {
      return { status: "rejected", code: "INSUFFICIENT_CASH" };
    }
    if (affordability.status === "invalid") {
      return { status: "rejected", code: "INVALID_PAYLOAD" };
    }

    const existing = state.inventory.stacks[definitionId];
    let nextStack: InventoryStack;
    if (existing === undefined) {
      nextStack = {
        definitionId,
        quantity,
        averageAcquisitionCostUsd: microdollarsToUsd(unitPriceMicrodollars),
      };
    } else {
      const nextQuantity = addQuantities(existing.quantity, quantity);
      const existingValueMicrodollars = multiplyMicrodollars(
        usdToMicrodollars(existing.averageAcquisitionCostUsd),
        existing.quantity,
      );
      const combinedValueMicrodollars = addMicrodollars(
        existingValueMicrodollars,
        purchaseCostMicrodollars,
      );
      nextStack = {
        definitionId: existing.definitionId,
        quantity: nextQuantity,
        averageAcquisitionCostUsd: microdollarsToUsd(
          divideMicrodollarsHalfAwayFromZero(combinedValueMicrodollars, nextQuantity),
        ),
      };
    }
    const nextTotalExpenseMicrodollars = addMicrodollars(
      usdToMicrodollars(state.economy.totalExpenseUsd),
      purchaseCostMicrodollars,
    );
    return {
      status: "ready",
      costUsd: microdollarsToUsd(purchaseCostMicrodollars),
      nextStack,
      nextCashUsd: affordability.nextCashUsd,
      nextTotalExpenseUsd: microdollarsToUsd(nextTotalExpenseMicrodollars),
    };
  } catch (error: unknown) {
    if (error instanceof RangeError) return { status: "rejected", code: "INVALID_PAYLOAD" };
    throw error;
  }
}

export function createInventoryEconomyCommandHandlers(
  content: ContentBundle,
): InventoryEconomyCommandHandlers {
  return Object.freeze({
    BUY_MODULE({ state }, command) {
      assertValidInventoryEconomyState(state);
      const plan = planModulePurchase(state, content, command.definitionId, command.quantity);
      if (plan.status === "rejected") {
        if (plan.code === "INSUFFICIENT_CASH") return REJECTIONS.insufficientCash;
        if (plan.code === "RESEARCH_REQUIRED") return REJECTIONS.researchRequired;
        return REJECTIONS.invalidPayload;
      }
      state.inventory.stacks[command.definitionId] = plan.nextStack;
      state.economy.cashUsd = plan.nextCashUsd;
      state.economy.totalExpenseUsd = plan.nextTotalExpenseUsd;
      return;
    },

    SELL_INVENTORY_ITEM({ state }, command) {
      assertValidInventoryEconomyState(state);
      if (!isPositiveSafeInteger(command.quantity)) {
        return REJECTIONS.invalidPayload;
      }

      const definition = resolveModule(content, command.definitionId);
      if (definition === undefined) {
        return REJECTIONS.invalidPayload;
      }
      const existing = state.inventory.stacks[command.definitionId];
      if (existing === undefined || existing.quantity < command.quantity) {
        return REJECTIONS.insufficientInventory;
      }

      try {
        const unitSaleValueMicrodollars = usdToMicrodollars(
          definition.priceUsd * definition.salvageRatio,
        );
        const proceedsMicrodollars = multiplyMicrodollars(
          unitSaleValueMicrodollars,
          command.quantity,
        );
        const nextCashMicrodollars = addMicrodollars(
          usdToMicrodollars(state.economy.cashUsd),
          proceedsMicrodollars,
        );
        const nextTotalIncomeMicrodollars = addMicrodollars(
          usdToMicrodollars(state.economy.totalIncomeUsd),
          proceedsMicrodollars,
        );
        const remainingQuantity = existing.quantity - command.quantity;

        if (remainingQuantity === 0) {
          Reflect.deleteProperty(state.inventory.stacks, command.definitionId);
        } else {
          state.inventory.stacks[command.definitionId] = {
            ...existing,
            quantity: remainingQuantity,
          };
        }
        state.economy.cashUsd = microdollarsToUsd(nextCashMicrodollars);
        state.economy.totalIncomeUsd = microdollarsToUsd(nextTotalIncomeMicrodollars);
        return;
      } catch (error: unknown) {
        if (error instanceof RangeError) {
          return REJECTIONS.invalidPayload;
        }
        throw error;
      }
    },
  });
}
