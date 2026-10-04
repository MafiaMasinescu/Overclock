import { describe, expect, test } from "vitest";

import {
  reconcileKeyedScene,
  type KeyedScene,
} from "../../src/rendering/pixi/sceneReconciliation.ts";

describe("keyed Pixi scene reconciliation", () => {
  test("keeps unchanged entities, updates changed entities and removes missing entities", () => {
    const previous: KeyedScene = {
      modules: new Map([
        ["module-a", "a:1"],
        ["module-b", "b:1"],
      ]),
      routes: new Map([["route-a", "r:1"]]),
    };
    const next = reconcileKeyedScene(previous, {
      modules: new Map([
        ["module-a", "a:1"],
        ["module-b", "b:2"],
        ["module-c", "c:1"],
      ]),
      routes: new Map([["route-b", "r:2"]]),
    });

    expect(next.scene).toEqual({
      modules: new Map([
        ["module-a", "a:1"],
        ["module-b", "b:2"],
        ["module-c", "c:1"],
      ]),
      routes: new Map([["route-b", "r:2"]]),
    });
    expect(next.changes).toEqual({
      modules: { created: ["module-c"], updated: ["module-b"], removed: [] },
      routes: { created: ["route-b"], updated: [], removed: ["route-a"] },
    });
  });

  test("does not mutate the retained model maps", () => {
    const previous: KeyedScene = {
      modules: new Map([["module-a", "a:1"]]),
      routes: new Map(),
    };
    const before = [...previous.modules.entries()];
    reconcileKeyedScene(previous, { modules: new Map(), routes: new Map() });
    expect([...previous.modules.entries()]).toEqual(before);
  });
});
