import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { seedToUint32 } from "../rng/seededRng.ts";
import type { GameState, ResearchStatus, ThermalTileState } from "./types.ts";

export interface NewGameOptions {
  content: ContentBundle;
  seed: string;
}

function compareStableIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function createThermalTiles(
  width: number,
  height: number,
  ambientTemperatureC: number,
): ThermalTileState[] {
  const tiles: ThermalTileState[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push({ position: { x, y }, temperatureC: ambientTemperatureC });
    }
  }
  return tiles;
}

export function createInitialGameState({ content, seed }: NewGameOptions): GameState {
  if (content.era.id !== "era-1946-vacuum-tube") {
    throw new Error(`Unsupported initial era: ${content.era.id}`);
  }

  const inventoryStacks: GameState["inventory"]["stacks"] = {};
  for (const stack of content.era.startingInventory.toSorted((left, right) =>
    compareStableIds(left.definitionId, right.definitionId),
  )) {
    const definition = content.modules[stack.definitionId];
    if (definition === undefined) {
      throw new Error(`Starting inventory references unknown module: ${stack.definitionId}`);
    }
    inventoryStacks[stack.definitionId] = {
      definitionId: stack.definitionId,
      quantity: stack.quantity,
      averageAcquisitionCostUsd: definition.priceUsd,
    };
  }

  const researchStatuses: Record<string, ResearchStatus> = {};
  for (const node of Object.values(content.research).toSorted(
    (left, right) => left.sortOrder - right.sortOrder || compareStableIds(left.id, right.id),
  )) {
    researchStatuses[node.id] = node.prerequisites.length === 0 ? "available" : "locked";
  }

  const initialTaskOffers = Object.values(content.tasks)
    .filter(
      (task) =>
        task.offerYear <= content.era.startYear && task.prerequisiteResearchIds.length === 0,
    )
    .toSorted(
      (left, right) => left.sortOrder - right.sortOrder || compareStableIds(left.id, right.id),
    )
    .map((task) => task.id);

  return {
    saveVersion: 1,
    contentVersion: content.contentVersion,
    seed,
    tick: 0,
    rngState: seedToUint32(seed),
    clock: {
      paused: true,
      speed: 1,
      simulatedSeconds: 0,
    },
    campaign: {
      eraId: content.era.id,
      currentYear: content.era.startYear,
      objectiveKey: "ui.objective",
      transistorRevealed: false,
      verticalSliceCompleted: false,
    },
    economy: {
      cashUsd: content.era.startingCashUsd,
      creditLimitUsd: 0,
      energyPriceUsdPerKwh: content.balancing.economy.defaultEnergyPriceUsdPerKwh,
      lastTickIncomeUsd: 0,
      lastTickExpenseUsd: 0,
      totalIncomeUsd: 0,
      totalExpenseUsd: 0,
    },
    facility: {
      id: "facility-alpha",
      name: "facility-alpha",
      size: { ...content.era.facilityGrid },
      ambientTemperatureC: content.era.ambientTemperatureC,
      extractionCapacityWatts: 0,
      contractedPowerWatts: content.era.startingPowerCapacityWatts,
      modules: {},
      routes: {},
      thermalTiles: createThermalTiles(
        content.era.facilityGrid.width,
        content.era.facilityGrid.height,
        content.era.ambientTemperatureC,
      ),
      liveLayoutRevision: 0,
      thermalRevision: 0,
      designDraft: null,
    },
    inventory: { stacks: inventoryStacks },
    tasks: {
      activeSlotCount: content.era.activeTaskSlots,
      offers: initialTaskOffers,
      instances: {},
    },
    research: {
      researchData: content.era.startingResearchData,
      statuses: researchStatuses,
      active: null,
      evidenceTags: [],
    },
    benchmarks: {
      active: null,
      history: [],
      bestRunByBenchmark: {},
    },
    blueprints: { records: {} },
    tutorial: {
      guidanceMode: "simple",
      currentStepId: null,
      completedStepIds: [],
      skipped: false,
    },
    museum: { snapshots: [] },
    achievements: {
      unlockedIds: [],
      unlockedAtTick: {},
    },
  };
}
