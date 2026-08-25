import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { assertValidGridState } from "../../grid/validation/gridState.ts";
import type { GameState, ModuleInstanceState } from "../core/types.ts";
import { assertValidInventoryEconomyState } from "../economy/inventoryEconomyState.ts";
import {
  addMicrodollars,
  microdollarsToUsd,
  multiplyMicrodollars,
  usdToMicrodollars,
} from "../economy/money.ts";
import { assertValidRouteState } from "../routing/manualRouting.ts";
import { canonicalSerialize } from "../replay/canonicalState.ts";
import { assertValidDesignHistory } from "./designModeState.ts";

export interface DesignApplyInventoryConsumptionEntry {
  readonly definitionId: string;
  readonly quantity: number;
  readonly bookValueUsd: number;
}

export interface DesignApplySalvageCreditEntry {
  readonly definitionId: string;
  readonly quantity: number;
  readonly unitCreditUsd: number;
  readonly creditUsd: number;
}

export interface DesignApplyInventoryShortfallEntry {
  readonly definitionId: string;
  readonly requiredQuantity: number;
  readonly availableQuantity: number;
}

export interface DesignApplyPreviewReady {
  readonly status: "ready";
  readonly draftRevision: number;
  readonly hasLayoutChanges: boolean;
  readonly addedModuleIds: readonly string[];
  readonly removedModuleIds: readonly string[];
  readonly movedModuleIds: readonly string[];
  readonly rotatedModuleIds: readonly string[];
  readonly changedModuleIds: readonly string[];
  readonly inventoryConsumption: readonly DesignApplyInventoryConsumptionEntry[];
  readonly salvageCredits: readonly DesignApplySalvageCreditEntry[];
  readonly consumedInventoryBookValueUsd: number;
  readonly salvageCreditUsd: number;
  readonly laborCostUsd: number;
  readonly netCostUsd: number;
  readonly downtimeTicks: number;
}

export type DesignApplyPreviewBlocked =
  | { readonly status: "blocked"; readonly code: "NOT_IN_DESIGN_MODE" }
  | {
      readonly status: "blocked";
      readonly code: "INSUFFICIENT_INVENTORY";
      readonly shortfalls: readonly DesignApplyInventoryShortfallEntry[];
    }
  | { readonly status: "blocked"; readonly code: "INVALID_SYSTEM" };

export type DesignApplyPreview = DesignApplyPreviewReady | DesignApplyPreviewBlocked;

interface DefinitionQuantities {
  readonly definitionId: string;
  readonly liveQuantity: number;
  readonly draftQuantity: number;
  readonly consumeQuantity: number;
  readonly salvageQuantity: number;
}

interface CalculationOptions {
  readonly checkLiveLayoutRevisionCapacity: boolean;
}

function freezeDetached<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeDetached(child);
    }
    Object.freeze(value);
  }
  return value;
}

function detached<Value>(value: Value): Value {
  return freezeDetached(structuredClone(value));
}

function assertSafeNonnegativeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${description} must be a nonnegative safe integer.`);
  }
}

function addQuantities(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Module definition quantity exceeds the safe-integer range.");
  }
  return result;
}

function countByDefinition(
  modules: Readonly<Record<string, ModuleInstanceState>>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [, module] of Object.entries(modules).toSorted(([left], [right]) =>
    compareStableStrings(left, right),
  )) {
    counts[module.definitionId] = addQuantities(counts[module.definitionId] ?? 0, 1);
  }
  return counts;
}

function calculateDefinitionQuantities(
  liveModules: Readonly<Record<string, ModuleInstanceState>>,
  draftModules: Readonly<Record<string, ModuleInstanceState>>,
): readonly DefinitionQuantities[] {
  const liveCounts = countByDefinition(liveModules);
  const draftCounts = countByDefinition(draftModules);
  return [...new Set([...Object.keys(liveCounts), ...Object.keys(draftCounts)])]
    .toSorted(compareStableStrings)
    .map((definitionId) => {
      const liveQuantity = liveCounts[definitionId] ?? 0;
      const draftQuantity = draftCounts[definitionId] ?? 0;
      return {
        definitionId,
        liveQuantity,
        draftQuantity,
        consumeQuantity: Math.max(0, draftQuantity - liveQuantity),
        salvageQuantity: Math.max(0, liveQuantity - draftQuantity),
      };
    });
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function sortedModuleIds(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  predicate: (moduleId: string, module: ModuleInstanceState) => boolean,
): readonly string[] {
  return Object.entries(modules)
    .filter(([moduleId, module]) => predicate(moduleId, module))
    .map(([moduleId]) => moduleId)
    .toSorted(compareStableStrings);
}

function validateAuthoritativeLayout(state: GameState, content: ContentBundle): void {
  assertValidInventoryEconomyState(state);
  assertValidGridState(state.facility, content);
  assertValidRouteState(
    {
      size: state.facility.size,
      modules: state.facility.modules,
      routes: state.facility.routes,
      nextRouteSequence: state.facility.nextRouteSequence,
    },
    content,
  );

  const draft = state.facility.designDraft;
  if (draft === null) return;
  assertSafeNonnegativeInteger(draft.revision, "Design draft revision");
  assertValidDesignHistory(draft.undoStack, draft.redoStack);
  assertValidGridState(
    {
      ...state.facility,
      modules: draft.modules,
      routes: draft.routes,
      designDraft: null,
    },
    content,
  );
  assertValidRouteState(
    {
      size: state.facility.size,
      modules: draft.modules,
      routes: draft.routes,
      nextRouteSequence: state.facility.nextRouteSequence,
    },
    content,
  );
}

function hasFinalLayoutDifference(state: GameState): boolean {
  const draft = state.facility.designDraft;
  if (draft === null) return false;
  return (
    !sameCanonical(state.facility.modules, draft.modules) ||
    !sameCanonical(state.facility.routes, draft.routes)
  );
}

function calculatePreview(
  state: GameState,
  content: ContentBundle,
  options: CalculationOptions,
): DesignApplyPreview {
  const draft = state.facility.designDraft;
  if (draft === null) {
    return detached({ status: "blocked" as const, code: "NOT_IN_DESIGN_MODE" as const });
  }

  validateAuthoritativeLayout(state, content);
  const definitionQuantities = calculateDefinitionQuantities(state.facility.modules, draft.modules);
  const shortfalls = definitionQuantities
    .filter(({ definitionId, consumeQuantity }) => {
      const availableQuantity = state.inventory.stacks[definitionId]?.quantity ?? 0;
      return consumeQuantity > availableQuantity;
    })
    .map(({ definitionId, consumeQuantity }) => ({
      definitionId,
      requiredQuantity: consumeQuantity,
      availableQuantity: state.inventory.stacks[definitionId]?.quantity ?? 0,
    }));
  if (shortfalls.length > 0) {
    return detached({
      status: "blocked" as const,
      code: "INSUFFICIENT_INVENTORY" as const,
      shortfalls,
    });
  }

  try {
    const addedModuleIds = sortedModuleIds(
      draft.modules,
      (moduleId) => !Object.hasOwn(state.facility.modules, moduleId),
    );
    const removedModuleIds = sortedModuleIds(
      state.facility.modules,
      (moduleId) => !Object.hasOwn(draft.modules, moduleId),
    );
    const movedModuleIds = sortedModuleIds(draft.modules, (moduleId, module) => {
      const live = state.facility.modules[moduleId];
      return live !== undefined && !sameCanonical(live.position, module.position);
    });
    const rotatedModuleIds = sortedModuleIds(draft.modules, (moduleId, module) => {
      const live = state.facility.modules[moduleId];
      return live !== undefined && live.rotation !== module.rotation;
    });
    const changedModuleIds = [
      ...new Set([...addedModuleIds, ...removedModuleIds, ...movedModuleIds, ...rotatedModuleIds]),
    ].toSorted(compareStableStrings);
    const hasLayoutChanges = hasFinalLayoutDifference(state);

    let consumedInventoryBookValueMicrodollars = 0;
    let salvageCreditMicrodollars = 0;
    const inventoryConsumption: DesignApplyInventoryConsumptionEntry[] = [];
    const salvageCredits: DesignApplySalvageCreditEntry[] = [];
    for (const quantity of definitionQuantities) {
      const definition = content.modules[quantity.definitionId];
      if (definition === undefined) {
        throw new Error("Design Apply module definition is missing from content.");
      }
      if (quantity.consumeQuantity > 0) {
        const stack = state.inventory.stacks[quantity.definitionId];
        if (stack === undefined) throw new Error("Validated inventory stack is missing.");
        const bookValueMicrodollars = multiplyMicrodollars(
          usdToMicrodollars(stack.averageAcquisitionCostUsd),
          quantity.consumeQuantity,
        );
        consumedInventoryBookValueMicrodollars = addMicrodollars(
          consumedInventoryBookValueMicrodollars,
          bookValueMicrodollars,
        );
        inventoryConsumption.push({
          definitionId: quantity.definitionId,
          quantity: quantity.consumeQuantity,
          bookValueUsd: microdollarsToUsd(bookValueMicrodollars),
        });
      }
      if (quantity.salvageQuantity > 0) {
        const unitCreditMicrodollars = usdToMicrodollars(
          definition.priceUsd * definition.salvageRatio,
        );
        const creditMicrodollars = multiplyMicrodollars(
          unitCreditMicrodollars,
          quantity.salvageQuantity,
        );
        salvageCreditMicrodollars = addMicrodollars(salvageCreditMicrodollars, creditMicrodollars);
        salvageCredits.push({
          definitionId: quantity.definitionId,
          quantity: quantity.salvageQuantity,
          unitCreditUsd: microdollarsToUsd(unitCreditMicrodollars),
          creditUsd: microdollarsToUsd(creditMicrodollars),
        });
      }
    }

    const laborCostMicrodollars = multiplyMicrodollars(
      usdToMicrodollars(content.balancing.economy.laborCostPerMovedModuleUsd),
      changedModuleIds.length,
    );
    const netCostMicrodollars = addMicrodollars(laborCostMicrodollars, -salvageCreditMicrodollars);
    const affectedModuleIds = [
      ...new Set([...addedModuleIds, ...movedModuleIds, ...rotatedModuleIds]),
    ]
      .filter((moduleId) => Object.hasOwn(draft.modules, moduleId))
      .toSorted(compareStableStrings);
    const downtimeTicks = affectedModuleIds.reduce((maximum, moduleId) => {
      const module = draft.modules[moduleId];
      if (module === undefined) throw new Error("Affected Design Apply module is missing.");
      const definition = content.modules[module.definitionId];
      if (definition === undefined)
        throw new Error("Affected Design Apply module definition is missing.");
      return Math.max(maximum, definition.startupTicks);
    }, 0);
    assertSafeNonnegativeInteger(downtimeTicks, "Design Apply downtime");

    if (
      options.checkLiveLayoutRevisionCapacity &&
      hasLayoutChanges &&
      state.facility.liveLayoutRevision >= Number.MAX_SAFE_INTEGER
    ) {
      return detached({ status: "blocked" as const, code: "INVALID_SYSTEM" as const });
    }

    return detached({
      status: "ready" as const,
      draftRevision: draft.revision,
      hasLayoutChanges,
      addedModuleIds,
      removedModuleIds,
      movedModuleIds,
      rotatedModuleIds,
      changedModuleIds,
      inventoryConsumption,
      salvageCredits,
      consumedInventoryBookValueUsd: microdollarsToUsd(consumedInventoryBookValueMicrodollars),
      salvageCreditUsd: microdollarsToUsd(salvageCreditMicrodollars),
      laborCostUsd: microdollarsToUsd(laborCostMicrodollars),
      netCostUsd: microdollarsToUsd(netCostMicrodollars),
      downtimeTicks,
    });
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      return detached({ status: "blocked" as const, code: "INVALID_SYSTEM" as const });
    }
    throw error;
  }
}

export function calculateDesignApplyPreview(
  state: GameState,
  content: ContentBundle,
): DesignApplyPreview {
  return calculatePreview(state, content, { checkLiveLayoutRevisionCapacity: true });
}

export function calculateDesignApplyPreviewForTransaction(
  state: GameState,
  content: ContentBundle,
): DesignApplyPreview {
  return calculatePreview(state, content, { checkLiveLayoutRevisionCapacity: false });
}

export function isDesignApplyPreviewRejection(
  preview: DesignApplyPreview,
): preview is DesignApplyPreviewBlocked {
  return preview.status === "blocked";
}
