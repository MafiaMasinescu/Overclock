import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { validateContent } from "../../src/content/loader/contentLoader.ts";
import { createRawContentPack } from "../../src/content/loader/rawContentPack.ts";
import type {
  ContentBundle,
  LocalizationDictionary,
} from "../../src/content/schemas/contentSchemas.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { seedToUint32 } from "../../src/sim/rng/seededRng.ts";

function reverseRecord<Value>(record: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.fromEntries(Object.entries(record).reverse());
}

function collectLocalizationKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([property, child]) => {
    if (property.endsWith("Key") && typeof child === "string") {
      return [child];
    }
    return collectLocalizationKeys(child);
  });
}

function resolveLocalization(dictionary: LocalizationDictionary, dottedKey: string): string | null {
  let value: unknown = dictionary;
  for (const segment of dottedKey.split(".")) {
    if (value === null || typeof value !== "object") {
      return null;
    }
    value = Reflect.get(value, segment);
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

describe("initial GameState", () => {
  test("creates a valid new game from the validated content bundle", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "foundation-seed" });

    expect(state).toMatchObject({
      saveVersion: 1,
      contentVersion: "0.1.0",
      seed: "foundation-seed",
      tick: 0,
      rngState: seedToUint32("foundation-seed"),
      clock: { paused: true, speed: 1, simulatedSeconds: 0 },
      campaign: {
        eraId: "era-1946-vacuum-tube",
        currentYear: 1946,
        objectiveKey: "ui.objective",
        transistorRevealed: false,
        verticalSliceCompleted: false,
      },
      economy: {
        cashUsd: 32_000,
        creditLimitUsd: 0,
        energyPriceUsdPerKwh: 0.042,
        lastTickIncomeUsd: 0,
        lastTickExpenseUsd: 0,
        totalIncomeUsd: 0,
        totalExpenseUsd: 0,
      },
      facility: {
        id: "facility-alpha",
        name: "facility-alpha",
        size: { width: 24, height: 16 },
        ambientTemperatureC: 22,
        extractionCapacityWatts: 0,
        contractedPowerWatts: 24_000,
        modules: {},
        routes: {},
        nextModuleInstanceSequence: 1,
        nextRouteSequence: 1,
        liveLayoutRevision: 0,
        thermalRevision: 0,
        designDraft: null,
        power: {
          layoutRevision: null,
          totalRequestedPowerWatts: 0,
          totalDeliveredPowerWatts: 0,
          headroomWatts: 24_000,
          energyCostUsdThisTick: 0,
          byModule: {},
          byRoute: {},
        },
      },
      tasks: {
        activeSlotCount: 2,
        offers: ["task-ballistic-table-verification", "task-census-tabulation-service"],
        instances: {},
      },
      benchmarks: { active: null, history: [], bestRunByBenchmark: {} },
      blueprints: { records: {} },
      tutorial: {
        guidanceMode: "simple",
        currentStepId: null,
        completedStepIds: [],
        skipped: false,
      },
      museum: { snapshots: [] },
      achievements: { unlockedIds: [], unlockedAtTick: {} },
    });

    expect(state.facility.thermalTiles).toHaveLength(24 * 16);
    expect(state.facility.thermalTiles[0]).toEqual({
      position: { x: 0, y: 0 },
      temperatureC: 22,
    });
    expect(state.facility.thermalTiles.at(-1)).toEqual({
      position: { x: 23, y: 15 },
      temperatureC: 22,
    });
    expect(state.inventory.stacks["module-vacuum-tube-logic"]).toEqual({
      definitionId: "module-vacuum-tube-logic",
      quantity: 2,
      averageAcquisitionCostUsd: 1_850,
    });
    expect(state.research.statuses["research-stable-power-distribution"]).toBe("available");
    expect(state.research.statuses["research-vacuum-tube-reliability"]).toBe("locked");
  });

  test("contains only canonical serializable authoritative data", () => {
    const state = createInitialGameState({ content: loadContentBundle(), seed: "serializable" });

    expect(JSON.parse(canonicalSerialize(state))).toEqual(state);
    expect(structuredClone(state)).toEqual(state);
    expect(Number.isFinite(state.economy.cashUsd)).toBe(true);
    expect(
      state.facility.thermalTiles.every(
        ({ temperatureC }) =>
          Number.isFinite(temperatureC) && temperatureC >= 12 && temperatureC <= 250,
      ),
    ).toBe(true);
  });

  test("localizes every key emitted by the initial state in Romanian and English", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "localized-state" });
    const emittedLocalizationKeys = collectLocalizationKeys(state);

    expect(emittedLocalizationKeys.length).toBeGreaterThan(0);
    for (const key of emittedLocalizationKeys) {
      expect(
        resolveLocalization(content.locales.ro, key),
        `Romanian localization for ${key}`,
      ).not.toBeNull();
      expect(
        resolveLocalization(content.locales.en, key),
        `English localization for ${key}`,
      ).not.toBeNull();
    }
  });

  test("does not depend on content record insertion order", () => {
    const content = loadContentBundle();
    const reorderedContent: ContentBundle = {
      ...content,
      modules: reverseRecord(content.modules),
      tasks: reverseRecord(content.tasks),
      research: reverseRecord(content.research),
    };

    expect(createInitialGameState({ content: reorderedContent, seed: "ordered-content" })).toEqual(
      createInitialGameState({ content, seed: "ordered-content" }),
    );
  });

  test("quantizes initial cash and acquisition costs and omits zero-quantity stacks", () => {
    const raw = createRawContentPack();
    raw.era.era.startingCashUsd = 32_000.0000005;
    const firstStartingStack = raw.era.era.startingInventory[0];
    const secondStartingStack = raw.era.era.startingInventory[1];
    if (firstStartingStack === undefined || secondStartingStack === undefined) {
      throw new Error("Expected two starting inventory fixtures.");
    }
    firstStartingStack.quantity = 0;
    const secondDefinition = raw.modules.modules.find(
      ({ id }) => id === secondStartingStack.definitionId,
    );
    if (secondDefinition === undefined) {
      throw new Error("Expected the second starting module definition.");
    }
    secondDefinition.priceUsd = 1.0000005;

    const state = createInitialGameState({
      content: validateContent(raw),
      seed: "quantized-initial-money",
    });

    expect(state.economy.cashUsd).toBe(32_000.000001);
    expect(state.inventory.stacks[firstStartingStack.definitionId]).toBeUndefined();
    expect(
      state.inventory.stacks[secondStartingStack.definitionId]?.averageAcquisitionCostUsd,
    ).toBe(1.000001);
  });

  test("creates the same canonical state and hash in at least 100 runs", () => {
    const content = loadContentBundle();
    const expected = createInitialGameState({ content, seed: "repeat-new-game" });
    const expectedSerialization = canonicalSerialize(expected);
    const expectedHash = hashCanonicalState(expected);

    for (let run = 0; run < 100; run += 1) {
      const state = createInitialGameState({ content, seed: "repeat-new-game" });
      expect(canonicalSerialize(state)).toBe(expectedSerialization);
      expect(hashCanonicalState(state)).toBe(expectedHash);
    }
  });
});
