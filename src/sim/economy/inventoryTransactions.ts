import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type { InventoryStack } from "../core/types.ts";
import { assertValidInventoryEconomyState } from "./inventoryEconomyState.ts";
import {
  addMicrodollars,
  divideMicrodollarsHalfAwayFromZero,
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

export function createInventoryEconomyCommandHandlers(
  content: ContentBundle,
): InventoryEconomyCommandHandlers {
  return Object.freeze({
    BUY_MODULE({ state }, command) {
      assertValidInventoryEconomyState(state);
      if (!isPositiveSafeInteger(command.quantity)) {
        return REJECTIONS.invalidPayload;
      }

      const definition = resolveModule(content, command.definitionId);
      if (definition === undefined) {
        return REJECTIONS.invalidPayload;
      }
      if (
        !definition.unlockResearchIds.every(
          (researchId) => state.research.statuses[researchId] === "completed",
        )
      ) {
        return REJECTIONS.researchRequired;
      }

      try {
        const unitPriceMicrodollars = usdToMicrodollars(definition.priceUsd);
        const purchaseCostMicrodollars = multiplyMicrodollars(
          unitPriceMicrodollars,
          command.quantity,
        );
        const cashMicrodollars = usdToMicrodollars(state.economy.cashUsd);
        const creditLimitMicrodollars = usdToMicrodollars(state.economy.creditLimitUsd);
        const nextCashMicrodollars = addMicrodollars(cashMicrodollars, -purchaseCostMicrodollars);
        if (nextCashMicrodollars < -creditLimitMicrodollars) {
          return REJECTIONS.insufficientCash;
        }

        const existing = state.inventory.stacks[command.definitionId];
        let nextStack: InventoryStack;
        if (existing === undefined) {
          nextStack = {
            definitionId: command.definitionId,
            quantity: command.quantity,
            averageAcquisitionCostUsd: microdollarsToUsd(unitPriceMicrodollars),
          };
        } else {
          const nextQuantity = addQuantities(existing.quantity, command.quantity);
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

        state.inventory.stacks[command.definitionId] = nextStack;
        state.economy.cashUsd = microdollarsToUsd(nextCashMicrodollars);
        state.economy.totalExpenseUsd = microdollarsToUsd(nextTotalExpenseMicrodollars);
        return;
      } catch (error: unknown) {
        if (error instanceof RangeError) {
          return REJECTIONS.invalidPayload;
        }
        throw error;
      }
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
