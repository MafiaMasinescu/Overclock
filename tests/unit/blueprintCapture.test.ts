import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle, ModuleDefinition } from "../../src/content/schemas/contentSchemas.ts";
import type {
  GameState,
  ModuleInstanceState,
  RouteState,
  Rotation,
} from "../../src/sim/core/types.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  assertValidBlueprintCaptureSelection,
  assertValidCurrentBlueprintCapture,
  calculateCanonicalBlueprintSummary,
  captureCanonicalBlueprintPayload,
  validateCurrentBlueprintCapture,
} from "../../src/sim/blueprints/blueprintCapture.ts";

const baseContent = loadContentBundle();
const LOGIC = "module-vacuum-tube-logic";
const RELAY = "module-data-relay";
const PRINTER = "module-line-printer";
const BLUEPRINT_RESEARCH = "research-blueprint-documentation";
const MODULAR_WIRING = "research-modular-wiring";
const BUFFERED_IO = "research-buffered-io";

function enableAllResearch(state: GameState): void {
  for (const researchId of Object.keys(state.research.statuses)) {
    state.research.statuses[researchId] = "completed";
  }
}

function moduleState(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
  rotation: Rotation = 0,
  overrides: Partial<ModuleInstanceState> = {},
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
    rotation,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
    ...overrides,
  };
}

function createState(
  modules: readonly ModuleInstanceState[],
  routes: readonly RouteState[] = [],
): GameState {
  const state = createInitialGameState({ content: baseContent, seed: "blueprint-capture" });
  enableAllResearch(state);
  state.facility.modules = Object.fromEntries(modules.map((module) => [module.id, module]));
  state.facility.routes = Object.fromEntries(routes.map((route) => [route.id, route]));
  return state;
}

function contentWithModule(
  definitionId: string,
  changes: Partial<ModuleDefinition>,
): ContentBundle {
  const definition = baseContent.modules[definitionId];
  if (definition === undefined) throw new Error(`Missing module fixture: ${definitionId}`);
  return {
    ...baseContent,
    modules: {
      ...baseContent.modules,
      [definitionId]: { ...definition, ...changes },
    },
  };
}

function internalReversalRoute(): RouteState {
  return {
    id: "facility-route-live",
    kind: "data",
    from: { moduleInstanceId: "facility-a", portId: "data-west" },
    to: { moduleInstanceId: "facility-z", portId: "data-east" },
    path: [
      { x: 5, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ],
    capacityPerSecond: 60_000,
    congestionRatio: 0,
  };
}

function externalRoute(): RouteState {
  return {
    id: "facility-route-external",
    kind: "data",
    from: { moduleInstanceId: "facility-z", portId: "data-east" },
    to: { moduleInstanceId: "zz-outside", portId: "data-west" },
    path: [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 2, y: 5 },
      { x: 2, y: 6 },
      { x: 2, y: 7 },
      { x: 3, y: 7 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
      { x: 6, y: 7 },
      { x: 7, y: 7 },
      { x: 8, y: 7 },
      { x: 9, y: 7 },
      { x: 10, y: 7 },
      { x: 10, y: 8 },
    ],
    capacityPerSecond: 60_000,
    congestionRatio: 0,
  };
}

function setTemperatures(state: GameState, temperatures: Readonly<Record<string, number>>): void {
  state.facility.thermalTiles = state.facility.thermalTiles.map((tile) => ({
    ...tile,
    temperatureC: temperatures[`${tile.position.x},${tile.position.y}`] ?? tile.temperatureC,
  }));
}

describe("pure Blueprint capture selection", () => {
  test.each([
    { name: "empty selection", selection: [] },
    { name: "duplicate selection", selection: ["module-a", "module-a"] },
    { name: "missing module", selection: ["missing-module"] },
  ])("rejects $name", ({ selection }) => {
    const state = createState([moduleState("module-a", RELAY, { x: 1, y: 1 })]);
    expect(() => {
      assertValidBlueprintCaptureSelection(state, baseContent, selection);
    }).toThrow();
  });

  test("rejects an active Design Mode draft and locked feature or module", () => {
    const state = createState([moduleState("module-a", PRINTER, { x: 1, y: 1 })]);
    state.facility.designDraft = {
      revision: 0,
      modules: structuredClone(state.facility.modules),
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    expect(() => {
      assertValidBlueprintCaptureSelection(state, baseContent, ["module-a"]);
    }).toThrow();

    state.facility.designDraft = null;
    state.research.statuses[BLUEPRINT_RESEARCH] = "locked";
    expect(() => {
      assertValidBlueprintCaptureSelection(state, baseContent, ["module-a"]);
    }).toThrow();

    state.research.statuses[BLUEPRINT_RESEARCH] = "completed";
    state.research.statuses[BUFFERED_IO] = "locked";
    expect(() => {
      assertValidBlueprintCaptureSelection(state, baseContent, ["module-a"]);
    }).toThrow();
  });

  test("accepts selected modules in every live lifecycle state", () => {
    const modules = (["offline", "starting", "online", "brownout", "shutdown"] as const).map(
      (operationalState, index) =>
        moduleState(`module-${index}`, RELAY, { x: index * 2, y: 1 }, 0, {
          operationalState,
          startupTicksRemaining: operationalState === "starting" ? 2 : 0,
          cooldownTicksRemaining: operationalState === "shutdown" ? 3 : 0,
        }),
    );
    const state = createState(modules);
    expect(() => {
      assertValidBlueprintCaptureSelection(
        state,
        baseContent,
        modules.map(({ id }) => id),
      );
    }).not.toThrow();
  });
});

describe("canonical Blueprint capture", () => {
  test("is invariant to selection order and facility object insertion order", () => {
    const modules = [
      moduleState("facility-z", RELAY, { x: 1, y: 2 }),
      moduleState("facility-a", RELAY, { x: 5, y: 2 }),
    ];
    const firstState = createState(modules, [internalReversalRoute()]);
    const secondState = createState([...modules].reverse(), [internalReversalRoute()]);

    const first = captureCanonicalBlueprintPayload(firstState, baseContent, [
      "facility-z",
      "facility-a",
    ]);
    const second = captureCanonicalBlueprintPayload(secondState, baseContent, [
      "facility-a",
      "facility-z",
    ]);

    expect(second).toEqual(first);
    expect(first.modules.map(({ localId }) => localId)).toEqual(["module-0001", "module-0002"]);
    expect(first.modules.map(({ relativePosition }) => relativePosition)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  test("includes internal routes, omits external routes, and reverses a path after recanonicalization", () => {
    const state = createState(
      [
        moduleState("facility-z", RELAY, { x: 1, y: 2 }),
        moduleState("facility-a", RELAY, { x: 5, y: 2 }),
        moduleState("zz-outside", RELAY, { x: 10, y: 8 }),
      ],
      [internalReversalRoute(), externalRoute()],
    );

    const payload = captureCanonicalBlueprintPayload(state, baseContent, [
      "facility-a",
      "facility-z",
    ]);

    expect(payload.routes).toHaveLength(1);
    expect(payload.bounds).toEqual({ width: 5, height: 2 });
    expect(payload.routes[0]).toMatchObject({
      localId: "route-0001",
      fromLocalModuleId: "module-0001",
      fromPortId: "data-east",
      toLocalModuleId: "module-0002",
      toPortId: "data-west",
      relativePath: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("facility-");
    expect(JSON.stringify(payload)).not.toContain("zz-outside");
  });

  test("uses rotated occupied footprints and route points for tight bounds", () => {
    const state = createState([
      moduleState("rotated", LOGIC, { x: 6, y: 4 }, 90),
      moduleState("relay", RELAY, { x: 2, y: 2 }),
    ]);
    const payload = captureCanonicalBlueprintPayload(state, baseContent, ["rotated", "relay"]);

    expect(payload.bounds).toEqual({ width: 5, height: 4 });
    expect(payload.modules).toEqual([
      expect.objectContaining({ localId: "module-0001", relativePosition: { x: 0, y: 0 } }),
      expect.objectContaining({ localId: "module-0002", relativePosition: { x: 4, y: 2 } }),
    ]);
  });

  test("captures the required Research union sorted and unique", () => {
    const state = createState([
      moduleState("relay", RELAY, { x: 1, y: 1 }),
      moduleState("printer", PRINTER, { x: 4, y: 1 }),
    ]);
    const payload = captureCanonicalBlueprintPayload(state, baseContent, ["printer", "relay"]);

    expect(payload.requiredResearchIds).toEqual([BLUEPRINT_RESEARCH, BUFFERED_IO, MODULAR_WIRING]);
    expect(new Set(payload.requiredResearchIds).size).toBe(payload.requiredResearchIds.length);
  });

  test("captures requested default Overclock and no runtime facility state", () => {
    const state = createState([
      moduleState("logic", LOGIC, { x: 1, y: 1 }, 0, {
        operationalState: "shutdown",
        overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
        binComputeRatio: 0.2,
        binEfficiencyRatio: 2,
        startupTicksRemaining: 8,
        cooldownTicksRemaining: 9,
      }),
    ]);
    const payload = captureCanonicalBlueprintPayload(state, baseContent, ["logic"]);

    expect(payload.modules[0]).toEqual({
      localId: "module-0001",
      definitionId: LOGIC,
      relativePosition: { x: 0, y: 0 },
      rotation: 0,
      defaultOverclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
    });
    expect(JSON.stringify(payload)).not.toContain("operationalState");
    expect(JSON.stringify(payload)).not.toContain("binComputeRatio");
    expect(JSON.stringify(payload)).not.toContain("startupTicksRemaining");
  });
});

describe("canonical Blueprint summary", () => {
  test("uses nominal Compute and shared full-load Power with dynamic Overclock once", () => {
    const state = createState([
      moduleState("logic", LOGIC, { x: 1, y: 1 }, 0, {
        operationalState: "shutdown",
        overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
        binComputeRatio: 0.25,
        binEfficiencyRatio: 4,
      }),
    ]);
    state.facility.power.byModule["logic"] = {
      moduleInstanceId: "logic",
      requestedPowerWatts: 0,
      minimumPowerWatts: 0,
      deliveredPowerWatts: 0,
      powerFactor: 0,
      limitingReason: "shutdown",
    };
    state.facility.compute.byModule["logic"] = {
      moduleInstanceId: "logic",
      requestedFrequencyRatio: 0.1,
      operationalRatio: 0,
      theoreticalComputeFlops: 0,
      powerFactor: 0,
      thermalFactor: 0,
      retryRate: 1,
      invalidSampleRate: 1,
      stabilityFactor: 0,
      availableComputeFlops: 0,
    };

    const summary = calculateCanonicalBlueprintSummary(state, baseContent, ["logic"]);

    expect(summary.theoreticalComputeFlops).toBe(1_125);
    expect(summary.peakPowerWatts).toBeCloseTo(2_193.125, 12);
    expect(summary.estimatedCostUsd).toBe(1_850);
  });

  test("accumulates exact monetary values in microdollars and rejects overflow", () => {
    const exactContent = contentWithModule(LOGIC, { priceUsd: 1_850.000001 });
    const exactState = createState([
      moduleState("logic", LOGIC, { x: 1, y: 1 }),
      moduleState("logic-two", LOGIC, { x: 4, y: 1 }),
    ]);
    expect(
      calculateCanonicalBlueprintSummary(exactState, exactContent, ["logic", "logic-two"])
        .estimatedCostUsd,
    ).toBe(3_700.000002);

    const overflowContent = contentWithModule(LOGIC, {
      priceUsd: Number.MAX_SAFE_INTEGER / 1_000_000,
    });
    expect(() => {
      calculateCanonicalBlueprintSummary(exactState, overflowContent, ["logic", "logic-two"]);
    }).toThrow(RangeError);
  });

  test("records the maximum current temperature over occupied tiles once", () => {
    const state = createState([moduleState("logic", LOGIC, { x: 3, y: 4 }, 90)]);
    setTemperatures(state, { "3,4": 31, "3,5": 47 });

    const summary = calculateCanonicalBlueprintSummary(state, baseContent, ["logic"]);

    expect(summary.estimatedMaxTemperatureC).toBe(47);
  });

  test("does not mutate inputs, consume RNG, or vary across repeated capture", () => {
    const state = createState([
      moduleState("logic", LOGIC, { x: 3, y: 4 }, 90, {
        overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
      }),
    ]);
    const before = structuredClone(state);
    const rngBefore = state.rngState;

    const first = captureCanonicalBlueprintPayload(state, baseContent, ["logic"]);
    const second = captureCanonicalBlueprintPayload(state, baseContent, ["logic"]);

    expect(second).toEqual(first);
    expect(state).toEqual(before);
    expect(state.rngState).toBe(rngBefore);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});

describe("current-content Blueprint capture validation", () => {
  test("accepts a current capture and rejects missing module definitions or Research references", () => {
    const state = createState([moduleState("relay", RELAY, { x: 1, y: 1 })]);
    const payload = captureCanonicalBlueprintPayload(state, baseContent, ["relay"]);

    expect(validateCurrentBlueprintCapture(payload, baseContent, state.research)).toEqual([]);
    expect(() => {
      assertValidCurrentBlueprintCapture(payload, baseContent, state.research);
    }).not.toThrow();

    const withoutModule = {
      ...baseContent,
      modules: Object.fromEntries(
        Object.entries(baseContent.modules).filter(([definitionId]) => definitionId !== RELAY),
      ),
    };
    expect(
      validateCurrentBlueprintCapture(payload, withoutModule, state.research).some(({ path }) =>
        path.includes("modules"),
      ),
    ).toBe(true);

    const withoutResearch = {
      ...baseContent,
      research: Object.fromEntries(
        Object.entries(baseContent.research).filter(
          ([researchId]) => researchId !== MODULAR_WIRING,
        ),
      ),
    };
    expect(
      validateCurrentBlueprintCapture(payload, withoutResearch, state.research).some(({ path }) =>
        path.includes("requiredResearchIds"),
      ),
    ).toBe(true);
  });

  test("rejects record identity fields that are not part of a capture payload", () => {
    const state = createState([moduleState("relay", RELAY, { x: 1, y: 1 })]);
    const payload = captureCanonicalBlueprintPayload(state, baseContent, ["relay"]);

    expect(
      validateCurrentBlueprintCapture(
        { ...payload, id: "blueprint-00000001", name: "Injected record identity" },
        baseContent,
        state.research,
      ),
    ).toContainEqual(expect.objectContaining({ path: "capture" }));
  });

  test("rejects a non-plain current capture object", () => {
    const state = createState([moduleState("relay", RELAY, { x: 1, y: 1 })]);
    const payload = captureCanonicalBlueprintPayload(state, baseContent, ["relay"]);
    const nonPlain = Object.assign(Object.create({ inherited: true }) as object, payload);

    expect(validateCurrentBlueprintCapture(nonPlain, baseContent, state.research)).toContainEqual(
      expect.objectContaining({ path: "capture", message: "must be a plain object." }),
    );
  });

  test("reports invalid current module occupancy instead of throwing from route validation", () => {
    const state = createState(
      [
        moduleState("facility-z", RELAY, { x: 1, y: 2 }),
        moduleState("facility-a", RELAY, { x: 5, y: 2 }),
      ],
      [internalReversalRoute()],
    );
    const payload = captureCanonicalBlueprintPayload(state, baseContent, [
      "facility-z",
      "facility-a",
    ]);
    const invalid = structuredClone(payload);
    const firstModule = invalid.modules[0];
    const secondModule = invalid.modules[1];
    if (firstModule === undefined || secondModule === undefined) {
      throw new Error("Expected two Blueprint modules.");
    }
    secondModule.relativePosition = { ...firstModule.relativePosition };

    expect(() =>
      validateCurrentBlueprintCapture(invalid, baseContent, state.research),
    ).not.toThrow();
    expect(validateCurrentBlueprintCapture(invalid, baseContent, state.research)).toContainEqual(
      expect.objectContaining({ path: "capture.modules" }),
    );
  });
});
