import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import {
  enumerateOccupiedTiles,
  isGridPointInBounds,
  resolveRotatedFootprintSize,
  transformLocalFootprintPoint,
} from "../../src/grid/domain/footprintGeometry.ts";
import {
  buildOccupancyIndex,
  findOccupyingModuleInstanceIds,
  validateModulePlacement,
} from "../../src/grid/domain/occupancy.ts";
import {
  assertValidGridState,
  GridStateInvariantError,
  validateGridState,
} from "../../src/grid/validation/gridState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GridPoint, ModuleInstanceState, Rotation } from "../../src/sim/core/types.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const THREE_BY_TWO = { width: 3, height: 2 } as const;

function createModule(
  id: string,
  definitionId: string,
  position: GridPoint,
  rotation: Rotation = 0,
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
    rotation,
    operationalState: "offline",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function placement(overrides: Partial<Parameters<typeof validateModulePlacement>[0]> = {}) {
  return validateModulePlacement({
    facilitySize: { width: 6, height: 5 },
    definitionId: "module-line-printer",
    position: { x: 0, y: 0 },
    rotation: 0,
    modules: {},
    content,
    ...overrides,
  });
}

describe("rotated footprint geometry", () => {
  test.each([
    { rotation: 0 as const, expected: { width: 3, height: 2 } },
    { rotation: 90 as const, expected: { width: 2, height: 3 } },
    { rotation: 180 as const, expected: { width: 3, height: 2 } },
    { rotation: 270 as const, expected: { width: 2, height: 3 } },
  ])("resolves exact 3 x 2 dimensions at $rotation degrees", ({ rotation, expected }) => {
    expect(resolveRotatedFootprintSize(THREE_BY_TWO, rotation)).toEqual(expected);
  });

  test("preserves square dimensions for every rotation", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(resolveRotatedFootprintSize({ width: 2, height: 2 }, rotation)).toEqual({
        width: 2,
        height: 2,
      });
    }
  });

  test.each([
    { rotation: 0 as const, expected: { x: 2, y: 1 } },
    { rotation: 90 as const, expected: { x: 0, y: 2 } },
    { rotation: 180 as const, expected: { x: 0, y: 0 } },
    { rotation: 270 as const, expected: { x: 1, y: 0 } },
  ])("transforms a local 3 x 2 corner at $rotation degrees", ({ rotation, expected }) => {
    expect(transformLocalFootprintPoint({ x: 2, y: 1 }, THREE_BY_TWO, rotation)).toEqual(expected);
  });

  test.each([
    {
      rotation: 0 as const,
      expected: [
        { x: 10, y: 20 },
        { x: 11, y: 20 },
        { x: 12, y: 20 },
        { x: 10, y: 21 },
        { x: 11, y: 21 },
        { x: 12, y: 21 },
      ],
    },
    {
      rotation: 90 as const,
      expected: [
        { x: 10, y: 20 },
        { x: 11, y: 20 },
        { x: 10, y: 21 },
        { x: 11, y: 21 },
        { x: 10, y: 22 },
        { x: 11, y: 22 },
      ],
    },
    {
      rotation: 180 as const,
      expected: [
        { x: 10, y: 20 },
        { x: 11, y: 20 },
        { x: 12, y: 20 },
        { x: 10, y: 21 },
        { x: 11, y: 21 },
        { x: 12, y: 21 },
      ],
    },
    {
      rotation: 270 as const,
      expected: [
        { x: 10, y: 20 },
        { x: 11, y: 20 },
        { x: 10, y: 21 },
        { x: 11, y: 21 },
        { x: 10, y: 22 },
        { x: 11, y: 22 },
      ],
    },
  ])("enumerates exact row-major occupied tiles at $rotation degrees", ({ rotation, expected }) => {
    expect(enumerateOccupiedTiles({ x: 10, y: 20 }, THREE_BY_TWO, rotation)).toEqual(expected);
  });
});

describe("bounds and placement validation", () => {
  const malformedPlacementCases: readonly {
    position: GridPoint;
    rotation: Rotation;
    reason: "INVALID_POSITION" | "INVALID_ROTATION";
  }[] = [
    { position: { x: 0.5, y: 0 }, rotation: 0, reason: "INVALID_POSITION" },
    { position: { x: Number.NaN, y: 0 }, rotation: 0, reason: "INVALID_POSITION" },
    { position: { x: 0, y: 0 }, rotation: 45 as Rotation, reason: "INVALID_ROTATION" },
  ];

  test.each([
    { point: { x: 0, y: 0 }, expected: true },
    { point: { x: 3, y: 2 }, expected: true },
    { point: { x: -1, y: 0 }, expected: false },
    { point: { x: 0, y: -1 }, expected: false },
    { point: { x: 4, y: 0 }, expected: false },
    { point: { x: 0, y: 3 }, expected: false },
  ])("checks all facility boundaries for $point", ({ point, expected }) => {
    expect(isGridPointInBounds(point, { width: 4, height: 3 })).toBe(expected);
  });

  test("accepts exact placement against the right and bottom boundaries", () => {
    const result = placement({ position: { x: 3, y: 3 } });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.occupiedTiles.at(-1)).toEqual({ x: 5, y: 4 });
  });

  test.each([
    { position: { x: -1, y: 0 }, tile: { x: -1, y: 0 } },
    { position: { x: 0, y: -1 }, tile: { x: 0, y: -1 } },
    { position: { x: 4, y: 0 }, tile: { x: 6, y: 0 } },
    { position: { x: 0, y: 4 }, tile: { x: 0, y: 5 } },
  ])("rejects a one-tile failure at $position", ({ position, tile }) => {
    const result = placement({ position });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      code: "OUT_OF_BOUNDS",
      reason: "FOOTPRINT_TILE_OUT_OF_BOUNDS",
      definitionId: "module-line-printer",
      tile,
    });
  });

  test("reports single and multiple collisions in row-major order", () => {
    const single = placement({
      modules: {
        "module-a": createModule("module-a", "module-data-relay", { x: 0, y: 0 }),
      },
    });
    const modules = {
      "module-z": createModule("module-z", "module-data-relay", { x: 2, y: 1 }),
      "module-a": createModule("module-a", "module-data-relay", { x: 0, y: 0 }),
    };

    expect(single.issues.filter(({ code }) => code === "TILE_OCCUPIED")).toHaveLength(1);
    expect(placement({ modules }).issues.filter(({ code }) => code === "TILE_OCCUPIED")).toEqual([
      {
        code: "TILE_OCCUPIED",
        reason: "PLACEMENT_TILE_OCCUPIED",
        definitionId: "module-line-printer",
        tile: { x: 0, y: 0 },
        occupyingModuleInstanceId: "module-a",
      },
      {
        code: "TILE_OCCUPIED",
        reason: "PLACEMENT_TILE_OCCUPIED",
        definitionId: "module-line-printer",
        tile: { x: 2, y: 1 },
        occupyingModuleInstanceId: "module-z",
      },
    ]);
  });

  test("excludes the moved module instance from collision validation", () => {
    const moved = createModule("module-moving", "module-line-printer", { x: 0, y: 0 });

    const blocked = placement({ modules: { [moved.id]: moved } });
    const allowed = placement({
      modules: { [moved.id]: moved },
      excludeModuleInstanceId: moved.id,
    });

    expect(blocked.valid).toBe(false);
    expect(allowed).toMatchObject({ valid: true, issues: [] });
  });

  test.each(malformedPlacementCases)(
    "rejects malformed placement geometry",
    ({ position, rotation, reason }) => {
      const result = placement({ position, rotation });

      expect(result).toMatchObject({
        valid: false,
        occupiedTiles: [],
        issues: [{ code: "INVALID_PAYLOAD", reason }],
      });
    },
  );
});

describe("derived occupancy and grid invariants", () => {
  test("detects unknown definitions and mismatched module record keys", () => {
    const modules = {
      "wrong-key": createModule("actual-id", "module-does-not-exist", { x: 0, y: 0 }),
    };

    expect(buildOccupancyIndex({ modules, content }).issues).toEqual([
      {
        code: "INVALID_PAYLOAD",
        reason: "MODULE_RECORD_KEY_MISMATCH",
        moduleRecordKey: "wrong-key",
        moduleInstanceId: "actual-id",
      },
      {
        code: "INVALID_PAYLOAD",
        reason: "UNKNOWN_MODULE_DEFINITION",
        moduleInstanceId: "actual-id",
        definitionId: "module-does-not-exist",
      },
    ]);
  });

  test("detects duplicate tile occupation and exposes every occupant", () => {
    const modules = {
      "module-b": createModule("module-b", "module-data-relay", { x: 1, y: 1 }),
      "module-a": createModule("module-a", "module-data-relay", { x: 1, y: 1 }),
    };
    const index = buildOccupancyIndex({ modules, content });

    expect(index.tiles).toEqual([
      { tile: { x: 1, y: 1 }, moduleInstanceIds: ["module-a", "module-b"] },
    ]);
    expect(findOccupyingModuleInstanceIds(index, { x: 1, y: 1 })).toEqual(["module-a", "module-b"]);
    expect(index.issues).toContainEqual({
      code: "TILE_OCCUPIED",
      reason: "DUPLICATE_TILE_OCCUPANCY",
      tile: { x: 1, y: 1 },
      moduleInstanceId: "module-a",
      occupyingModuleInstanceId: "module-b",
    });
  });

  test("validates facility dimensions, module geometry, bounds, and collisions on demand", () => {
    const state = createInitialGameState({ content, seed: "grid-invariants" });
    state.facility.size.width = 0;
    state.facility.modules = {
      "module-a": createModule("module-a", "module-line-printer", { x: 23, y: 15 }),
      "module-b": createModule("module-b", "module-data-relay", { x: 23, y: 15 }),
    };

    const issues = validateGridState(state.facility, content);

    expect(issues.some(({ reason }) => reason === "INVALID_FACILITY_SIZE")).toBe(true);
    expect(issues.some(({ code }) => code === "OUT_OF_BOUNDS")).toBe(true);
    expect(issues.some(({ reason }) => reason === "DUPLICATE_TILE_OCCUPANCY")).toBe(true);
    expect(() => {
      assertValidGridState(state.facility, content);
    }).toThrow(GridStateInvariantError);
  });

  test.each([
    { width: Number.NaN, height: 16 },
    { width: 24.5, height: 16 },
    { width: 24, height: Number.POSITIVE_INFINITY },
    { width: 24, height: -1 },
  ])("rejects non-finite, non-integer, or non-positive facility dimensions", (size) => {
    const state = createInitialGameState({ content, seed: "invalid-facility-size" });
    state.facility.size = size;

    expect(validateGridState(state.facility, content)).toContainEqual({
      code: "INVALID_PAYLOAD",
      reason: "INVALID_FACILITY_SIZE",
    });
  });

  test("returns canonical JSON data and leaves authoritative state and RNG unchanged", () => {
    const state = createInitialGameState({ content, seed: "pure-grid-geometry" });
    state.facility.modules = {
      "module-a": createModule("module-a", "module-line-printer", { x: 3, y: 4 }, 90),
    };
    const before = canonicalSerialize(state);
    const rngBefore = state.rngState;

    const occupancy = buildOccupancyIndex({ modules: state.facility.modules, content });
    const result = placement({ modules: state.facility.modules, position: { x: 10, y: 10 } });
    const issues = validateGridState(state.facility, content);

    expect(canonicalSerialize({ occupancy, result, issues })).toBeTypeOf("string");
    expect(canonicalSerialize(state)).toBe(before);
    expect(state.rngState).toBe(rngBefore);
  });

  test("produces identical geometry and issues across exactly 100 runs", () => {
    const modules = {
      "module-b": createModule("module-b", "module-data-relay", { x: 0, y: 0 }),
      "module-a": createModule("module-a", "module-data-relay", { x: 0, y: 0 }),
    };
    const run = () => ({
      tiles: enumerateOccupiedTiles({ x: 5, y: 7 }, THREE_BY_TWO, 270),
      occupancy: buildOccupancyIndex({ modules, content }),
      placement: placement({ modules }),
    });
    const expected = canonicalSerialize(run());

    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(canonicalSerialize(run())).toBe(expected);
    }
  });

  test("reports an unknown placement definition without partial geometry", () => {
    const result = placement({ definitionId: "module-does-not-exist" });

    expect(result).toEqual({
      valid: false,
      occupiedTiles: [],
      issues: [
        {
          code: "INVALID_PAYLOAD",
          reason: "UNKNOWN_MODULE_DEFINITION",
          definitionId: "module-does-not-exist",
        },
      ],
    });
  });

  test("accepts an explicitly reordered content record without changing occupancy output", () => {
    const reversedContent: ContentBundle = {
      ...content,
      modules: Object.fromEntries(Object.entries(content.modules).reverse()),
    };
    const modules = {
      "module-b": createModule("module-b", "module-data-relay", { x: 2, y: 0 }),
      "module-a": createModule("module-a", "module-data-relay", { x: 0, y: 0 }),
    };

    expect(buildOccupancyIndex({ modules, content: reversedContent })).toEqual(
      buildOccupancyIndex({ modules, content }),
    );
  });
});
