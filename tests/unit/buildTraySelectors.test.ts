import { describe, expect, it } from "vitest";

import type { BuildCatalogEntry } from "../../src/sim/build/contracts.ts";
import {
  filterBuildCatalog,
  getBuildTrayEntryState,
} from "../../src/ui/layout/buildTraySelectors.ts";

function entry(
  definitionId: string,
  overrides: Partial<BuildCatalogEntry> = {},
): BuildCatalogEntry {
  return {
    definitionId,
    nameKey: `modules.${definitionId}.name`,
    descriptionKey: `modules.${definitionId}.description`,
    category: "compute",
    tags: ["serial"],
    footprint: { width: 2, height: 1 },
    priceUsd: 100,
    unlockResearchIds: [],
    inventoryQuantity: 0,
    reservationRequirement: 0,
    reusableInstalledQuantity: 0,
    availableAdditionalPlacements: 0,
    purchase: { kind: "purchase", costUsd: 100 },
    ...overrides,
  };
}

describe("Build Tray selectors", () => {
  it("keeps catalog order while applying localized search and category filters", () => {
    const catalog = [
      entry("module-b", { category: "memory" }),
      entry("module-a", { category: "power" }),
      entry("module-c", { category: "memory" }),
    ];

    expect(
      filterBuildCatalog(
        catalog,
        { category: "memory", search: "delay", tab: "catalog" },
        (item) => (item.definitionId === "module-c" ? "Delay line memory" : item.definitionId),
      ).map((item) => item.definitionId),
    ).toEqual(["module-c"]);
  });

  it("uses reusable installed hardware and reservations for Inventory availability", () => {
    const reusable = entry("module-reusable", {
      inventoryQuantity: 0,
      reusableInstalledQuantity: 1,
      reservationRequirement: 1,
      availableAdditionalPlacements: 1,
      purchase: { kind: "purchase", costUsd: 100 },
    });
    const shortage = entry("module-shortage", {
      inventoryQuantity: 2,
      reservationRequirement: 2,
      availableAdditionalPlacements: 0,
      purchase: { kind: "purchase", costUsd: 100 },
    });

    expect(getBuildTrayEntryState(reusable, "inventory")).toEqual({
      selectable: true,
      reason: null,
    });
    expect(getBuildTrayEntryState(shortage, "inventory")).toEqual({
      selectable: false,
      reason: "INSUFFICIENT_INVENTORY",
    });
  });

  it("preserves query-owned Catalog lock and credit reasons", () => {
    expect(
      getBuildTrayEntryState(
        entry("module-locked", {
          purchase: { kind: "locked", researchIds: ["research-one"] },
        }),
        "catalog",
      ),
    ).toEqual({ selectable: false, reason: "RESEARCH_REQUIRED" });
    expect(
      getBuildTrayEntryState(
        entry("module-credit", {
          purchase: { kind: "insufficient-credit", costUsd: 100, creditLimitUsd: 10 },
        }),
        "catalog",
      ),
    ).toEqual({ selectable: false, reason: "INSUFFICIENT_CREDIT" });
  });
});
