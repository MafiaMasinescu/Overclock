import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import {
  assertValidBlueprintState,
  assertValidStoredBlueprintState,
  formatBlueprintId,
  formatBlueprintLocalModuleId,
  formatBlueprintLocalRouteId,
  normalizeBlueprintName,
  validateBlueprintState,
} from "../../src/sim/blueprints/blueprintState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { AuthoritativeState } from "../../src/sim/core/authoritativeState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";
import type { BlueprintRecord, BlueprintState, GameState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

function record(overrides: Partial<BlueprintRecord> = {}): BlueprintRecord {
  return {
    id: "blueprint-00000001",
    name: "Relay",
    version: 1,
    kind: "subassembly",
    contentVersion: "historical-0.0.1",
    modules: [
      {
        localId: "module-0001",
        definitionId: "module-data-relay",
        relativePosition: { x: 0, y: 0 },
        rotation: 0,
        defaultOverclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
      {
        localId: "module-0002",
        definitionId: "module-data-relay",
        relativePosition: { x: 1, y: 0 },
        rotation: 180,
        defaultOverclock: { profile: "eco", frequencyRatio: 0.8, voltageRatio: 0.9 },
      },
    ],
    routes: [
      {
        localId: "route-0001",
        kind: "data",
        fromLocalModuleId: "module-0001",
        fromPortId: "data-out",
        toLocalModuleId: "module-0002",
        toPortId: "data-in",
        relativePath: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
    ],
    requiredResearchIds: ["research-alpha", "research-zeta"],
    bounds: { width: 2, height: 1 },
    summary: {
      theoreticalComputeFlops: 10,
      peakPowerWatts: 20,
      estimatedMaxTemperatureC: 30,
      estimatedCostUsd: 1.000001,
    },
    ...overrides,
  };
}

function blueprintState(overrides: Partial<BlueprintState> = {}): BlueprintState {
  const saved = record();
  return { nextBlueprintSequence: 2, records: { [saved.id]: saved }, ...overrides };
}

function moduleAt(index: number) {
  const module = record().modules[index];
  if (module === undefined) throw new Error("Missing Blueprint module fixture.");
  return module;
}

function routeAt(index: number) {
  const route = record().routes[index];
  if (route === undefined) throw new Error("Missing Blueprint route fixture.");
  return route;
}

function stateWithBlueprints(blueprints: BlueprintState): GameState {
  return {
    ...createInitialGameState({ content: loadContentBundle(), seed: "blueprint-state" }),
    blueprints,
  };
}

describe("Blueprint structural state", () => {
  test("accepts a normalized historical subassembly without consulting current content", () => {
    expect(() => {
      assertValidBlueprintState(blueprintState());
    }).not.toThrow();
    expect(() => {
      assertValidStoredBlueprintState(stateWithBlueprints(blueprintState()));
    }).not.toThrow();
  });

  test("requires the exact BlueprintState shape and exact record key-to-ID agreement", () => {
    const missingSequence = { records: {} } as unknown as BlueprintState;
    expect(
      validateBlueprintState(missingSequence).some(
        (issue) => issue.path === "blueprints.nextBlueprintSequence",
      ),
    ).toBe(true);

    const mismatched = blueprintState({ records: { other: record() } });
    expect(
      validateBlueprintState(mismatched).some(
        (issue) => issue.path === "blueprints.records.other.id",
      ),
    ).toBe(true);

    const extra = { ...record(), unexpected: true } as unknown as BlueprintRecord;
    const extraState = blueprintState({ records: { [extra.id]: extra } });
    expect(
      validateBlueprintState(extraState).some(
        (issue) => issue.path === "blueprints.records.blueprint-00000001",
      ),
    ).toBe(true);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid next Blueprint sequence %s",
    (nextBlueprintSequence) => {
      expect(
        validateBlueprintState(blueprintState({ nextBlueprintSequence })).some(
          (issue) => issue.path === "blueprints.nextBlueprintSequence",
        ),
      ).toBe(true);
    },
  );

  test("rejects reused or non-canonical Blueprint record sequences", () => {
    const reused = blueprintState({
      nextBlueprintSequence: 2,
      records: {
        "blueprint-00000001": record(),
        "blueprint-00000002": record({ id: "blueprint-00000001" }),
      },
    });
    expect(validateBlueprintState(reused).some((issue) => issue.path.endsWith(".id"))).toBe(true);

    const nonCanonical = blueprintState({
      records: { "blueprint-1": record({ id: "blueprint-1" }) },
    });
    expect(validateBlueprintState(nonCanonical).some((issue) => issue.path.endsWith(".id"))).toBe(
      true,
    );
  });

  test.each(["", "  \t", "x".repeat(81), "bad\u0000name", "bad\u001fname", "bad\u007fname"])(
    "rejects invalid Blueprint name %j",
    (name) => {
      expect(() => normalizeBlueprintName(name)).toThrow();
      const state = blueprintState({ records: { "blueprint-00000001": record({ name }) } });
      expect(validateBlueprintState(state).some((issue) => issue.path.endsWith(".name"))).toBe(
        true,
      );
    },
  );

  test("rejects a stored Blueprint name that is not already normalized", () => {
    const state = blueprintState({
      records: { "blueprint-00000001": record({ name: " Relay " }) },
    });
    expect(validateBlueprintState(state).some((issue) => issue.path.endsWith(".name"))).toBe(true);
  });

  test("trims valid names and permits duplicates", () => {
    expect(normalizeBlueprintName("  Relay  ")).toBe("Relay");
    const duplicate = blueprintState({
      records: {
        "blueprint-00000001": record(),
        "blueprint-00000002": record({ id: "blueprint-00000002", name: "Relay" }),
      },
      nextBlueprintSequence: 3,
    });
    expect(() => {
      assertValidBlueprintState(duplicate);
    }).not.toThrow();
  });

  test("uses the reserved canonical IDs", () => {
    expect(formatBlueprintId(1)).toBe("blueprint-00000001");
    expect(formatBlueprintLocalModuleId(1)).toBe("module-0001");
    expect(formatBlueprintLocalRouteId(1)).toBe("route-0001");
    expect(() => formatBlueprintId(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  test.each([
    ["module duplicate", { modules: [moduleAt(0), { ...moduleAt(0) }] }],
    ["empty subassembly", { modules: [] }],
    ["route duplicate", { routes: [routeAt(0), { ...routeAt(0) }] }],
    ["missing route module", { routes: [{ ...routeAt(0), fromLocalModuleId: "module-9999" }] }],
    ["invalid path", { routes: [{ ...routeAt(0), relativePath: [{ x: 0, y: 0 }] }] }],
  ])("rejects structurally invalid collections: %s", (_name, overrides) => {
    const state = blueprintState({ records: { "blueprint-00000001": record(overrides) } });
    expect(validateBlueprintState(state).length).toBeGreaterThan(0);
  });

  test("rejects non-positive bounds and points outside stored bounds", () => {
    const badBounds = blueprintState({
      records: { "blueprint-00000001": record({ bounds: { width: 0, height: 1 } }) },
    });
    expect(validateBlueprintState(badBounds).some((issue) => issue.path.includes(".bounds"))).toBe(
      true,
    );

    const badPoint = blueprintState({
      records: {
        "blueprint-00000001": record({
          modules: [{ ...moduleAt(0), relativePosition: { x: 2, y: 0 } }],
        }),
      },
    });
    expect(
      validateBlueprintState(badPoint).some((issue) => issue.path.includes("relativePosition")),
    ).toBe(true);
  });

  test("rejects unsorted or duplicate required Research IDs and invalid summary numbers", () => {
    const state = blueprintState({
      records: {
        "blueprint-00000001": record({
          requiredResearchIds: ["research-zeta", "research-alpha", "research-alpha"],
          summary: {
            theoreticalComputeFlops: Number.NaN,
            peakPowerWatts: -0,
            estimatedMaxTemperatureC: Infinity,
            estimatedCostUsd: 0.0000001,
          },
        }),
      },
    });
    const issues = validateBlueprintState(state);
    expect(issues.some((issue) => issue.path.endsWith("requiredResearchIds"))).toBe(true);
    expect(issues.some((issue) => issue.path.includes("summary"))).toBe(true);
  });

  test("rejects invalid saved Overclock settings while preserving structural-only content history", () => {
    const invalid = blueprintState({
      records: {
        "blueprint-00000001": record({
          modules: [
            {
              ...moduleAt(0),
              defaultOverclock: {
                profile: "invalid" as "balanced",
                frequencyRatio: -0,
                voltageRatio: Infinity,
              },
            },
          ],
        }),
      },
    });
    expect(
      validateBlueprintState(invalid).some((issue) => issue.path.includes("defaultOverclock")),
    ).toBe(true);
    expect(() => {
      assertValidBlueprintState(
        blueprintState({
          records: { "blueprint-00000001": record({ contentVersion: "removed-content-version" }) },
        }),
      );
    }).not.toThrow();
  });

  test("deep-freezes the authoritative Blueprint branch", () => {
    const authority = new AuthoritativeState(stateWithBlueprints(blueprintState()));
    const owned = authority.readInternal().blueprints;
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.records)).toBe(true);
    expect(Object.isFrozen(owned.records["blueprint-00000001"])).toBe(true);
    const ownedRecord = owned.records["blueprint-00000001"];
    if (ownedRecord === undefined) throw new Error("Missing owned Blueprint fixture.");
    expect(() => {
      ownedRecord.name = "mutated";
    }).toThrow();
  });

  test("rejects invalid construction and replacement state", () => {
    const invalid = stateWithBlueprints(blueprintState({ nextBlueprintSequence: 0 }));
    expect(() => new SimCore({ initialState: invalid })).toThrow();

    const core = new SimCore({ initialState: stateWithBlueprints(blueprintState()) });
    expect(() => {
      core.replaceState(invalid);
    }).toThrow();
    expect(core.getStateForSave().blueprints.nextBlueprintSequence).toBe(2);
  });

  test("turns invalid Blueprint command candidates into fatal invariant violations", () => {
    const core = new SimCore({
      initialState: stateWithBlueprints(blueprintState()),
      commandHandlers: {
        SET_GUIDANCE_MODE({ state }) {
          state.blueprints.nextBlueprintSequence = 0;
        },
      },
    });
    core.enqueue({
      commandId: "13010000-0000-4000-8000-000000000001",
      source: "debug",
      kind: "SET_GUIDANCE_MODE",
      mode: "simple",
    });
    expect(() => core.processPendingCommands()).toThrow(SimulatorInvariantError);
    expect(core.getStateForSave().blueprints.nextBlueprintSequence).toBe(2);
  });

  test("protects Blueprint identity from production tick systems", () => {
    const core = new SimCore({
      initialState: stateWithBlueprints(blueprintState()),
      tickSystems: {
        "emit-events": {
          createRuntime() {
            return {
              executionMode: "structural-sharing",
              run({ state }) {
                return { ...state, blueprints: { ...state.blueprints, nextBlueprintSequence: 3 } };
              },
            };
          },
        },
      },
    });
    expect(() => {
      core.step();
    }).toThrow(SimulatorInvariantError);
  });

  test("records the compatibility change as only the additive sequence field", () => {
    const state = createInitialGameState({
      content: loadContentBundle(),
      seed: "compatibility-blueprint",
    });
    const previousShape = { ...state, blueprints: { records: {} } };

    expect(hashCanonicalState(previousShape)).toBe("1ac5a1d2a3739390");
    expect(hashCanonicalState(state)).toBe("539d230076b51eda");
    expect(hashCanonicalState({ ...state, blueprints: { records: {} } })).toBe(
      hashCanonicalState(previousShape),
    );
  });
});
