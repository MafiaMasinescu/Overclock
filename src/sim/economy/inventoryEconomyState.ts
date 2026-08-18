import type { GameState } from "../core/types.ts";
import { isMicrodollarAlignedUsd, usdToMicrodollars } from "./money.ts";

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and nonnegative.`);
  }
}

function assertSafeAlignedMoney(valueUsd: number, label: string): void {
  if (!isMicrodollarAlignedUsd(valueUsd)) {
    throw new Error(`${label} must be finite, safe, and microdollar-aligned.`);
  }
  usdToMicrodollars(valueUsd);
}

function assertSafeAlignedNonnegativeMoney(valueUsd: number, label: string): void {
  assertFiniteNonnegative(valueUsd, label);
  assertSafeAlignedMoney(valueUsd, label);
}

export function assertValidInventoryEconomyState(state: GameState): void {
  assertSafeAlignedMoney(state.economy.cashUsd, "Cash");
  assertFiniteNonnegative(state.economy.creditLimitUsd, "Credit limit");
  usdToMicrodollars(state.economy.creditLimitUsd);
  assertSafeAlignedNonnegativeMoney(state.economy.totalIncomeUsd, "Total income");
  assertSafeAlignedNonnegativeMoney(state.economy.totalExpenseUsd, "Total expense");

  for (const [definitionId, stack] of Object.entries(state.inventory.stacks)) {
    if (stack.definitionId !== definitionId) {
      throw new Error(`Inventory key ${definitionId} must match its stack definition ID.`);
    }
    if (!Number.isSafeInteger(stack.quantity) || stack.quantity <= 0) {
      throw new Error(`Inventory stack ${definitionId} must have a positive safe quantity.`);
    }
    assertSafeAlignedNonnegativeMoney(
      stack.averageAcquisitionCostUsd,
      `Inventory stack ${definitionId} acquisition cost`,
    );
  }
}
