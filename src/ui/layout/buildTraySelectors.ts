import type { BuildCatalogEntry, BuildReadReason } from "../../app/game-client/contracts.ts";

export type BuildTrayTab = "inventory" | "catalog";

export interface BuildTrayFilters {
  readonly tab: BuildTrayTab;
  readonly category: string;
  readonly search: string;
}

export function filterBuildCatalog(
  catalog: readonly BuildCatalogEntry[],
  filters: BuildTrayFilters,
  searchText: (entry: BuildCatalogEntry) => string,
): readonly BuildCatalogEntry[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return catalog.filter((entry) => {
    if (filters.category !== "all" && entry.category !== filters.category) return false;
    if (search.length === 0) return true;
    return searchText(entry).toLocaleLowerCase().includes(search);
  });
}

export function getBuildTrayEntryState(
  entry: BuildCatalogEntry,
  tab: BuildTrayTab,
): { readonly selectable: boolean; readonly reason: BuildReadReason | null } {
  if (entry.availableAdditionalPlacements > 0) return { selectable: true, reason: null };
  if (tab === "inventory") return { selectable: false, reason: "INSUFFICIENT_INVENTORY" };
  switch (entry.purchase.kind) {
    case "available":
      return { selectable: true, reason: null };
    case "purchase":
      return { selectable: true, reason: null };
    case "locked":
      return { selectable: false, reason: "RESEARCH_REQUIRED" };
    case "insufficient-credit":
      return { selectable: false, reason: "INSUFFICIENT_CREDIT" };
    case "invalid":
      return { selectable: false, reason: entry.purchase.reason };
  }
}
