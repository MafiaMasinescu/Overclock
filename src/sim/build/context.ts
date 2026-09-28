import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { deepFreeze } from "../../content/loader/deepFreeze.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { calculateDesignInventoryReservations } from "../design/designModeCommands.ts";
import { planModulePurchase } from "../economy/inventoryTransactions.ts";
import { isFeatureUnlocked, isModuleUnlocked } from "../research/researchDomain.ts";
import type { GameState } from "../core/types.ts";
import type {
  BuildCatalogEntry,
  BuildContextRead,
  BuildFeatureId,
  BuildSourceStamp,
  BuildViewMode,
} from "./contracts.ts";
import { previewBuildApply } from "./preview.ts";

const FEATURE_IDS: Readonly<Record<BuildFeatureId, keyof BuildContextRead["featureFlags"]>> = {
  "auto-route": "autoRoute",
  heatmap: "heatmap",
  "subassembly-blueprints": "subassemblyBlueprints",
  "power-headroom-inspector": "powerHeadroomInspector",
  "stability-inspector": "stabilityInspector",
};

function countDefinitions(
  modules: Readonly<Record<string, { readonly definitionId: string }>>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const module of Object.values(modules)) {
    const next = (counts[module.definitionId] ?? 0) + 1;
    if (!Number.isSafeInteger(next)) throw new RangeError("Build module count exceeds safe range.");
    counts[module.definitionId] = next;
  }
  return counts;
}

function featureFlags(
  state: Readonly<GameState>,
  content: ContentBundle,
): BuildContextRead["featureFlags"] {
  const flags = {} as Record<keyof BuildContextRead["featureFlags"], boolean>;
  for (const [featureId, key] of Object.entries(FEATURE_IDS) as readonly [
    BuildFeatureId,
    keyof BuildContextRead["featureFlags"],
  ][]) {
    flags[key] = isFeatureUnlocked(featureId, state.research, content);
  }
  return flags;
}

function moduleCatalog(
  state: Readonly<GameState>,
  content: ContentBundle,
): readonly BuildCatalogEntry[] {
  const liveCounts = countDefinitions(state.facility.modules);
  const draft = state.facility.designDraft;
  const draftCounts = countDefinitions(draft?.modules ?? state.facility.modules);
  const inventory = state.inventory.stacks;
  const reservations = new Map(
    draft === null
      ? []
      : calculateDesignInventoryReservations(state.facility, draft, inventory).map((entry) => [
          entry.definitionId,
          entry,
        ]),
  );

  return Object.values(content.modules)
    .toSorted(
      (left, right) => left.sortOrder - right.sortOrder || compareStableStrings(left.id, right.id),
    )
    .map((definition) => {
      const liveCount = liveCounts[definition.id] ?? 0;
      const draftCount = draftCounts[definition.id] ?? 0;
      const reservation = reservations.get(definition.id);
      const inventoryQuantity = inventory[definition.id]?.quantity ?? 0;
      const reservationRequirement = reservation?.requiredFromInventory ?? 0;
      const reusableInstalledQuantity = Math.max(0, liveCount - draftCount);
      const availableAdditionalPlacements = Math.max(
        0,
        reusableInstalledQuantity + inventoryQuantity - reservationRequirement,
      );
      const unlocked = isModuleUnlocked(definition.id, state.research, content);
      const purchasePlan = planModulePurchase(state, content, definition.id, 1);
      let purchase: BuildCatalogEntry["purchase"];
      if (availableAdditionalPlacements > 0) {
        purchase = { kind: "available" };
      } else if (!unlocked) {
        purchase = { kind: "locked", researchIds: [...definition.unlockResearchIds] };
      } else if (purchasePlan.status === "ready") {
        purchase = { kind: "purchase", costUsd: purchasePlan.costUsd };
      } else if (purchasePlan.code === "INSUFFICIENT_CASH") {
        purchase = {
          kind: "insufficient-credit",
          costUsd: definition.priceUsd,
          creditLimitUsd: state.economy.creditLimitUsd,
        };
      } else {
        purchase = { kind: "invalid", reason: "INVALID_SYSTEM" };
      }
      return {
        definitionId: definition.id,
        nameKey: definition.nameKey,
        descriptionKey: definition.descriptionKey,
        category: definition.category,
        tags: [...definition.tags],
        footprint: { ...definition.footprint },
        priceUsd: definition.priceUsd,
        unlockResearchIds: [...definition.unlockResearchIds],
        inventoryQuantity,
        reservationRequirement,
        reusableInstalledQuantity,
        availableAdditionalPlacements,
        purchase,
      };
    });
}

export function createBuildSourceStamp(
  state: Readonly<GameState>,
  mode: BuildViewMode,
  generation: number,
): BuildSourceStamp {
  return {
    mode,
    observedTick: state.tick,
    liveLayoutRevision: state.facility.liveLayoutRevision,
    draftRevision: state.facility.designDraft?.revision ?? null,
    generation,
  };
}

export function readBuildContext(
  state: Readonly<GameState>,
  content: ContentBundle,
  mode: BuildViewMode,
  generation: number,
): BuildContextRead {
  const applyReason = previewBuildApply(state, content).reason;
  const draft = state.facility.designDraft;
  return deepFreeze({
    mode,
    dimensions: { ...state.facility.size },
    source: createBuildSourceStamp(state, mode, generation),
    catalog: moduleCatalog(state, content),
    canUndo: draft !== null && draft.undoStack.length > 0,
    canRedo: draft !== null && draft.redoStack.length > 0,
    apply: { eligible: applyReason === null, reason: applyReason },
    activeBenchmarkLock: state.benchmarks.active !== null,
    featureFlags: featureFlags(state, content),
  });
}

export interface BuildGenerationTracker {
  observe(state: Readonly<GameState>): number;
  reset(state: Readonly<GameState>): void;
  get(): number;
}

interface BuildDependencySnapshot {
  readonly content: ContentBundle;
  readonly size: Readonly<GameState["facility"]["size"]>;
  readonly liveLayoutRevision: number;
  readonly draft: GameState["facility"]["designDraft"];
  readonly inventory: GameState["inventory"];
  readonly cashUsd: number;
  readonly creditLimitUsd: number;
  readonly totalIncomeUsd: number;
  readonly totalExpenseUsd: number;
  readonly researchStatuses: GameState["research"]["statuses"];
  readonly blueprints: GameState["blueprints"];
  readonly nextModuleInstanceSequence: number;
  readonly nextRouteSequence: number;
  readonly benchmarkActive: GameState["benchmarks"]["active"];
}

function dependencies(state: Readonly<GameState>, content: ContentBundle): BuildDependencySnapshot {
  return {
    content,
    size: state.facility.size,
    liveLayoutRevision: state.facility.liveLayoutRevision,
    draft: state.facility.designDraft,
    inventory: state.inventory,
    cashUsd: state.economy.cashUsd,
    creditLimitUsd: state.economy.creditLimitUsd,
    totalIncomeUsd: state.economy.totalIncomeUsd,
    totalExpenseUsd: state.economy.totalExpenseUsd,
    researchStatuses: state.research.statuses,
    blueprints: state.blueprints,
    nextModuleInstanceSequence: state.facility.nextModuleInstanceSequence,
    nextRouteSequence: state.facility.nextRouteSequence,
    benchmarkActive: state.benchmarks.active,
  };
}

function sameDependencies(left: BuildDependencySnapshot, right: BuildDependencySnapshot): boolean {
  return (
    left.content === right.content &&
    left.size === right.size &&
    left.liveLayoutRevision === right.liveLayoutRevision &&
    left.draft === right.draft &&
    left.inventory === right.inventory &&
    Object.is(left.cashUsd, right.cashUsd) &&
    Object.is(left.creditLimitUsd, right.creditLimitUsd) &&
    Object.is(left.totalIncomeUsd, right.totalIncomeUsd) &&
    Object.is(left.totalExpenseUsd, right.totalExpenseUsd) &&
    left.researchStatuses === right.researchStatuses &&
    left.blueprints === right.blueprints &&
    left.nextModuleInstanceSequence === right.nextModuleInstanceSequence &&
    left.nextRouteSequence === right.nextRouteSequence &&
    left.benchmarkActive === right.benchmarkActive
  );
}

export function createBuildGenerationTracker(
  initialState: Readonly<GameState>,
  content: ContentBundle,
): BuildGenerationTracker {
  let generation = 0;
  let snapshot = dependencies(initialState, content);
  return {
    observe(state) {
      const next = dependencies(state, content);
      if (!sameDependencies(snapshot, next)) {
        if (generation >= Number.MAX_SAFE_INTEGER)
          throw new RangeError("Build generation exhausted.");
        generation += 1;
        snapshot = next;
      }
      return generation;
    },
    reset(state) {
      generation = 0;
      snapshot = dependencies(state, content);
    },
    get() {
      return generation;
    },
  };
}
