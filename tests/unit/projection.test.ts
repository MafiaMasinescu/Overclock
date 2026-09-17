import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import { enumerateOccupiedTiles } from "../../src/grid/domain/footprintGeometry.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import type { SimCore } from "../../src/sim/core/simCore.ts";
import {
  calculateDesignApplyPreview,
  isDesignApplyPreviewRejection,
} from "../../src/sim/design/designApplyPreview.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { PROJECTION_SOURCE_MAPPING } from "../../src/sim/selectors/sourceMapping.ts";
import {
  createPresentationProjector,
  projectPresentation,
} from "../../src/sim/selectors/projector.ts";
import { isRegisteredProjectedThermalTiles } from "../../src/sim/selectors/ownedPlainData.ts";
import {
  createDefaultPresentationContext,
  parsePresentationContext,
} from "../../src/sim/selectors/presentationTypes.ts";
import type { GridViewModel, UiSnapshot } from "../../src/sim/selectors/presentationTypes.ts";

const content: ContentBundle = loadContentBundle();

test("only the SimCore owned-read boundary grants thermal identity reuse", () => {
  const context = createDefaultPresentationContext();
  const directState = createInitialGameState({ content, seed: "pure-thermal-untrusted" });
  Object.freeze(directState.facility.thermalTiles);
  const direct = projectPresentation(directState, content, context);
  expect(isRegisteredProjectedThermalTiles(direct.thermalTiles)).toBe(false);
  expect(direct.thermalTiles).not.toBe(directState.facility.thermalTiles);
  expect(Object.isFrozen(directState.facility.thermalTiles[0])).toBe(false);
  expect(Object.isFrozen(direct.thermalTiles[0])).toBe(true);

  const cached = createPresentationProjector().projectPresentation(directState, content, context);
  expect(cached.thermalTiles).not.toBe(directState.facility.thermalTiles);
  expect(Object.isFrozen(directState.facility.thermalTiles[0])).toBe(false);
  expect(Object.isFrozen(cached.thermalTiles[0])).toBe(true);

  const core = createCore("owned-thermal-trusted");
  const owned = core.getPresentation(context);
  expect(isRegisteredProjectedThermalTiles(owned.thermalTiles)).toBe(true);
  expect(Object.isFrozen(owned.thermalTiles[0])).toBe(true);
});

function commandId(sequence: number): string {
  return `63000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function createCore(seed: string): SimCore {
  return createProductionSimCore({
    content,
    initialState: createInitialGameState({ content, seed }),
  });
}

function dispatchAccepted(core: SimCore, command: SimCommand): void {
  core.enqueue(command);
  const results = core.processPendingCommands();
  expect(results).toHaveLength(1);
  expect(results[0]?.accepted).toBe(true);
}

function enterDesign(core: SimCore, sequence: number): void {
  dispatchAccepted(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "ENTER_DESIGN_MODE",
  });
}

function place(
  core: SimCore,
  sequence: number,
  definitionId: string,
  position: { x: number; y: number },
  rotation: 0 | 90 | 180 | 270 = 0,
): void {
  dispatchAccepted(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "PLACE_MODULE",
    definitionId,
    position,
    rotation,
  });
}

function applyDraft(core: SimCore, sequence: number): void {
  const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
  if (isDesignApplyPreviewRejection(preview))
    throw new Error("Apply preview blocked unexpectedly.");
  dispatchAccepted(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: preview.draftRevision,
    acceptedCostUsd: preview.netCostUsd,
    acceptedDowntimeTicks: preview.downtimeTicks,
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("presentation context validation", () => {
  test("creates an empty default context", () => {
    expect(createDefaultPresentationContext()).toEqual({
      selectedIds: [],
      inspectedEntityId: null,
      heatmapEnabled: false,
    });
  });

  test("rejects malformed contexts without coercion", () => {
    expect(() => parsePresentationContext(null)).toThrow(TypeError);
    expect(() => parsePresentationContext([])).toThrow(TypeError);
    expect(() => parsePresentationContext({ selectedIds: [], inspectedEntityId: null })).toThrow(
      TypeError,
    );
    expect(() =>
      parsePresentationContext({
        selectedIds: [],
        inspectedEntityId: null,
        heatmapEnabled: false,
        extra: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parsePresentationContext({
        selectedIds: "x",
        inspectedEntityId: null,
        heatmapEnabled: false,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parsePresentationContext({
        selectedIds: [42],
        inspectedEntityId: null,
        heatmapEnabled: false,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parsePresentationContext({ selectedIds: [], inspectedEntityId: 7, heatmapEnabled: false }),
    ).toThrow(TypeError);
    expect(() =>
      parsePresentationContext({ selectedIds: [], inspectedEntityId: null, heatmapEnabled: 1 }),
    ).toThrow(TypeError);
  });

  test("returns an owned copy detached from the input array", () => {
    const selectedIds = ["module-instance-00000001"];
    const parsed = parsePresentationContext({
      selectedIds,
      inspectedEntityId: null,
      heatmapEnabled: true,
    });
    selectedIds.push("late-mutation");
    expect(parsed.selectedIds).toEqual(["module-instance-00000001"]);
  });

  test("rejects accessor, sparse, custom and duplicate selected ids without executing getters", () => {
    let hits = 0;
    const accessorInput = Object.defineProperties(
      {},
      {
        selectedIds: {
          enumerable: true,
          get: () => {
            hits += 1;
            return ["module-instance-00000001"];
          },
        },
        inspectedEntityId: { enumerable: true, value: null },
        heatmapEnabled: { enumerable: true, value: false },
      },
    );
    expect(() => parsePresentationContext(accessorInput)).toThrow(TypeError);
    expect(hits).toBe(0);

    const sparse = [] as string[];
    sparse.length = 1;
    expect(() =>
      parsePresentationContext({
        selectedIds: sparse,
        inspectedEntityId: null,
        heatmapEnabled: false,
      }),
    ).toThrow(TypeError);

    const custom = ["module-instance-00000001"] as string[] & { extra?: string };
    custom.extra = "not allowed";
    expect(() =>
      parsePresentationContext({
        selectedIds: custom,
        inspectedEntityId: null,
        heatmapEnabled: false,
      }),
    ).toThrow(TypeError);

    expect(() =>
      parsePresentationContext({
        selectedIds: ["duplicate", "duplicate"],
        inspectedEntityId: null,
        heatmapEnabled: false,
      }),
    ).toThrow(TypeError);
  });

  test("returns a deeply frozen detached context", () => {
    const parsed = parsePresentationContext({
      selectedIds: ["module-instance-00000001"],
      inspectedEntityId: "route-1",
      heatmapEnabled: true,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.selectedIds)).toBe(true);
    expect(() => {
      (parsed.selectedIds as string[]).push("late");
    }).toThrow(TypeError);
  });
});

describe("initial-state projection", () => {
  test("maps header, tick and revisions directly from state and content", () => {
    const core = createCore("projection-initial");
    const state = core.getStateForSave();
    const { snapshot, grid } = core.getPresentation(createDefaultPresentationContext());

    expect(snapshot.revision).toBe(0);
    expect(snapshot.tick).toBe(0);
    expect(snapshot.header.eraNameKey).toBe(content.era.nameKey);
    expect(snapshot.header.year).toBe(1946);
    expect(snapshot.header.objectiveKey).toBe("ui.objective");
    expect(snapshot.header.paused).toBe(true);
    expect(snapshot.header.speed).toBe(1);
    expect(snapshot.header.cashUsd).toBe(state.economy.cashUsd);
    expect(snapshot.header.usefulComputeFlops).toBe(
      state.facility.compute.totalAllocatedUsefulComputeFlops,
    );
    expect(snapshot.header.theoreticalComputeFlops).toBe(
      state.facility.compute.totalTheoreticalComputeFlops,
    );
    expect(snapshot.header.powerDrawWatts).toBe(state.facility.power.totalDeliveredPowerWatts);
    expect(snapshot.header.powerCapacityWatts).toBe(state.facility.contractedPowerWatts);
    expect(snapshot.header.averageTemperatureC).toBe(22);
    expect(snapshot.header.maxTemperatureC).toBe(22);

    expect(grid.revision).toBe(0);
    expect(grid.mode).toBe("live");
    expect(grid.layoutRevision).toBe(state.facility.liveLayoutRevision);
    expect(grid.thermalRevision).toBe(state.facility.thermalRevision);
    expect(grid.gridSize).toEqual({ width: 24, height: 16 });
    expect(grid.modules).toEqual([]);
    expect(grid.routes).toEqual([]);
    expect(grid.heatmap).toBeNull();
    expect(grid.placementPreview).toBeNull();
    expect(grid.diagnosticHighlights).toEqual([]);
  });

  test("uses explicit nulls for unknown forecasts, memory, retry and evidence", () => {
    const core = createCore("projection-nulls");
    const { snapshot, grid } = core.getPresentation(createDefaultPresentationContext());

    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.telemetry.memoryCapacityBytes).toBeNull();
    expect(snapshot.telemetry.memoryUsedBytes).toBeNull();
    expect(snapshot.telemetry.memoryBandwidthBytesPerSecond).toBeNull();
    expect(snapshot.telemetry.memoryBandwidthUsedBytesPerSecond).toBeNull();
    expect(snapshot.telemetry.retryRate).toBeNull();
    expect(snapshot.telemetry.bottleneck).toBeNull();
    expect(snapshot.telemetry.seriesRevision).toBe(0);
    expect(snapshot.telemetry.researchData).toBe(state_researchData(core));
    expect(snapshot.telemetry.powerHeadroomWatts).toBe(
      core.getStateForSave().facility.power.headroomWatts,
    );
    expect(grid.modules).toEqual([]);
    expect(grid.routes).toEqual([]);
    expect(snapshot.inspector).toEqual({
      selectedEntityId: null,
      entityKind: null,
      titleKey: null,
      stats: [],
      computeBreakdown: null,
    });
  });

  function state_researchData(core: SimCore): number {
    return core.getStateForSave().research.researchData;
  }

  test("derives build availability from the existing unlock rule", () => {
    const core = createCore("projection-build");
    const { snapshot } = core.getPresentation(createDefaultPresentationContext());

    expect(snapshot.build.designMode).toBe(false);
    expect(snapshot.build.draftRevision).toBeNull();
    const expected = Object.keys(content.modules)
      .filter((moduleId) => (content.modules[moduleId]?.unlockResearchIds.length ?? 1) === 0)
      .toSorted();
    expect([...snapshot.build.availableDefinitionIds]).toEqual(expected);
    expect(expected).toContain("module-power-distribution");
    // Locked behind research: not buildable yet.
    expect(snapshot.build.availableDefinitionIds).not.toContain("module-arithmetic-unit");
  });

  test("exposes conservative command hints, never dev commands", () => {
    const core = createCore("projection-availability");
    const { snapshot } = core.getPresentation(createDefaultPresentationContext());
    const availability = snapshot.commandAvailability;

    expect(availability["SET_PAUSED"]).toBe(true);
    expect(availability["SET_SPEED"]).toBe(true);
    expect(availability["ENTER_DESIGN_MODE"]).toBe(true);
    expect(availability["PLACE_MODULE"]).toBe(false);
    expect(availability["UNDO_DESIGN"]).toBe(false);
    expect(availability["REDO_DESIGN"]).toBe(false);
    expect(availability["APPLY_DESIGN"]).toBe(false);
    expect(availability["CANCEL_DESIGN"]).toBe(false);
    // No live compute-capable module exists yet, so the conservative hint is false.
    expect(availability["START_BENCHMARK"]).toBe(false);
    expect(availability["CANCEL_BENCHMARK"]).toBe(false);
    expect(availability["START_RESEARCH"]).toBe(false);
    expect(availability["CANCEL_RESEARCH"]).toBe(false);
    expect(availability["SAVE_BLUEPRINT"]).toBe(false);
    expect(availability["SELL_INVENTORY_ITEM"]).toBe(true);
    expect(availability["ACCEPT_TASK"]).toBe(core.getStateForSave().tasks.offers.length > 0);
    expect(availability["TRIGGER_DIAGNOSTIC_PULSE"]).toBeUndefined();
    expect(availability["DEBUG_ADD_CASH"]).toBeUndefined();
    expect(availability["DEBUG_ADD_RESEARCH_DATA"]).toBeUndefined();
  });

  test("mirrors stored tutorial state without inventing progression", () => {
    const core = createCore("projection-tutorial");
    const state = core.getStateForSave();
    const { snapshot } = core.getPresentation(createDefaultPresentationContext());
    expect(snapshot.tutorial).toEqual({
      currentStepId: state.tutorial.currentStepId,
      guidanceMode: state.tutorial.guidanceMode,
    });
  });
});

describe("draft projection", () => {
  test("projects draft-only modules with null live physics", () => {
    const core = createCore("projection-draft");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);

    const selected = parsePresentationContext({
      selectedIds: ["module-instance-00000001"],
      inspectedEntityId: "module-instance-00000001",
      heatmapEnabled: false,
    });
    const { snapshot, grid } = core.getPresentation(selected);

    expect(snapshot.build.designMode).toBe(true);
    expect(snapshot.build.draftRevision).toBe(1);
    expect(snapshot.commandAvailability["UNDO_DESIGN"]).toBe(true);
    expect(snapshot.commandAvailability["ENTER_DESIGN_MODE"]).toBe(false);
    expect(snapshot.commandAvailability["APPLY_DESIGN"]).toBe(true);

    expect(grid.mode).toBe("draft");
    expect(grid.layoutRevision).toBe(1);
    expect(grid.modules).toHaveLength(1);
    const module = grid.modules[0];
    expect(module?.id).toBe("module-instance-00000001");
    expect(module?.definitionId).toBe("module-vacuum-tube-logic");
    expect(module?.footprint).toEqual({ width: 2, height: 1 });
    expect(module?.rotation).toBe(0);
    expect(module?.operationalState).toBe("offline");
    expect(module?.selected).toBe(true);
    expect(module?.warning).toBe("none");
    // Draft-only entity: no live footprint, so no invented temperature.
    expect(module?.temperatureC).toBeNull();
    expect(module?.spriteKey).toBe(
      `module-${content.modules["module-vacuum-tube-logic"]?.category}`,
    );
    expect(module?.overclock).toEqual({ profile: "balanced", frequencyRatio: 1, voltageRatio: 1 });

    expect(snapshot.inspector.selectedEntityId).toBe("module-instance-00000001");
    expect(snapshot.inspector.entityKind).toBe("module");
    expect(snapshot.inspector.titleKey).toBe(content.modules["module-vacuum-tube-logic"]?.nameKey);
  });

  test("resolves rotated footprints through the shared geometry rule", () => {
    const core = createCore("projection-rotated");
    enterDesign(core, 1);
    // module-accumulator-register is 1x2; rotated 90 degrees it covers 2x1.
    place(core, 2, "module-accumulator-register", { x: 5, y: 5 }, 90);

    const { grid } = core.getPresentation(createDefaultPresentationContext());
    expect(grid.modules).toHaveLength(1);
    expect(grid.modules[0]?.footprint).toEqual({ width: 2, height: 1 });
    expect(grid.modules[0]?.position).toEqual({ x: 5, y: 5 });
  });

  test("projects connected draft routes with null utilization", () => {
    const core = createCore("projection-route");
    enterDesign(core, 1);
    place(core, 2, "module-power-distribution", { x: 0, y: 0 }, 0);
    place(core, 3, "module-vacuum-tube-logic", { x: 3, y: 0 }, 0);
    dispatchAccepted(core, {
      commandId: commandId(4),
      source: "player",
      kind: "CONNECT_PORTS",
      from: { moduleInstanceId: "module-instance-00000001", portId: "power-out-east" },
      to: { moduleInstanceId: "module-instance-00000002", portId: "power-in-west" },
      path: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
    });

    const inspected = parsePresentationContext({
      selectedIds: ["route-00000001"],
      inspectedEntityId: "route-00000001",
      heatmapEnabled: false,
    });
    const { grid, snapshot } = core.getPresentation(inspected);
    expect(grid.routes).toHaveLength(1);
    expect(grid.routes[0]?.id).toBe("route-00000001");
    expect(grid.routes[0]?.kind).toBe("power");
    expect(grid.routes[0]?.path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    // Dirty power has no stored delivery yet: null, not zero.
    expect(grid.routes[0]?.utilizationRatio).toBeNull();
    expect(grid.routes[0]?.selected).toBe(true);
    expect(snapshot.inspector.entityKind).toBe("route");
    expect(snapshot.inspector.titleKey).toBeNull();
  });

  test("treats stale selections as an empty inspector without throwing", () => {
    const core = createCore("projection-stale");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);

    const stale = parsePresentationContext({
      selectedIds: ["ghost-entity"],
      inspectedEntityId: "ghost-entity",
      heatmapEnabled: false,
    });
    const { snapshot, grid } = core.getPresentation(stale);
    expect(snapshot.inspector.selectedEntityId).toBeNull();
    expect(snapshot.inspector.entityKind).toBeNull();
    expect(snapshot.inspector.stats).toEqual([]);
    expect(grid.modules).toHaveLength(1);
    expect(grid.modules[0]?.selected).toBe(false);
  });
});

describe("live layout and thermal evidence", () => {
  function buildLiveCore(seed: string): SimCore {
    const core = createCore(seed);
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);
    applyDraft(core, 3);
    core.step(3);
    return core;
  }

  test("reports live module temperature as the exact footprint mean", () => {
    const core = buildLiveCore("projection-live-temp");
    const state = core.getStateForSave();
    const { grid } = core.getPresentation(createDefaultPresentationContext());

    expect(grid.mode).toBe("live");
    expect(grid.layoutRevision).toBe(state.facility.liveLayoutRevision);
    expect(grid.modules).toHaveLength(1);
    const tiles = state.facility.thermalTiles;
    const at = (x: number, y: number): number => {
      const tile = tiles[y * state.facility.size.width + x];
      if (tile === undefined) throw new Error("Missing thermal tile.");
      return tile.temperatureC;
    };
    // module-vacuum-tube-logic is 2x1 at (0,0).
    const expectedMean = (at(0, 0) + at(1, 0)) / 2;
    expect(grid.modules[0]?.temperatureC).toBe(expectedMean);

    const temperatures = tiles.map((tile) => tile.temperatureC);
    const { snapshot } = core.getPresentation(createDefaultPresentationContext());
    expect(snapshot.header.averageTemperatureC).toBe(mean(temperatures));
    expect(snapshot.header.maxTemperatureC).toBe(Math.max(...temperatures));
  });

  test("inline rotated means match the shared occupancy rule exactly", () => {
    // Non-uniform gradient field so every rotation covers different values.
    const base = createInitialGameState({ content, seed: "projection-gradient" });
    const tiles = base.facility.thermalTiles.map((tile) => ({
      position: tile.position,
      temperatureC: 20 + tile.position.x + tile.position.y,
    }));
    const heated = {
      ...base,
      facility: { ...base.facility, thermalTiles: tiles },
    };
    for (const rotation of [0, 90, 180, 270] as const) {
      const core = createProductionSimCore({ content, initialState: heated });
      enterDesign(core, 1);
      // module-accumulator-register is 1x2: rotations cover distinct tiles.
      place(core, 2, "module-accumulator-register", { x: 5, y: 5 }, rotation);
      applyDraft(core, 3);
      const state = core.getStateForSave();
      const { grid } = core.getPresentation(createDefaultPresentationContext());
      const module = grid.modules[0];
      const definition = content.modules["module-accumulator-register"];
      if (module === undefined || definition === undefined) {
        throw new Error("Expected one live module.");
      }
      const covered = enumerateOccupiedTiles({ x: 5, y: 5 }, definition.footprint, rotation);
      const expected =
        covered.reduce((sum, point) => {
          const tile = state.facility.thermalTiles[point.y * 24 + point.x];
          if (tile === undefined) throw new Error("Missing thermal tile.");
          return sum + tile.temperatureC;
        }, 0) / covered.length;
      expect(module.temperatureC).toBe(expected);
      expect(covered.length).toBe(2);
    }
  });

  test("repeated projections share layout identity and agree exactly", () => {
    const core = createCore("projection-cache");
    enterDesign(core, 1);
    place(core, 2, "module-power-distribution", { x: 0, y: 0 }, 0);
    place(core, 3, "module-vacuum-tube-logic", { x: 3, y: 0 }, 0);
    applyDraft(core, 4);
    core.step(5);
    // Same authoritative branches: the comparison cache must serve the
    // identical validated diagnostics (dirty-to-calculated transitions
    // settle during the warm-up steps above, not inside the projector).
    const first = core.getPresentation(createDefaultPresentationContext());
    const second = core.getPresentation(createDefaultPresentationContext());
    expect(second.grid.modules).toEqual(first.grid.modules);
    expect(second.grid.routes).toEqual(first.grid.routes);
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
  });

  test("computes exact mean and max on a non-uniform field", () => {
    const base = createInitialGameState({ content, seed: "projection-nonuniform" });
    const tiles = base.facility.thermalTiles.map((tile, index) => {
      if (index === 0) return { position: tile.position, temperatureC: 30 };
      if (index === 1) return { position: tile.position, temperatureC: 40 };
      return tile;
    });
    const core = createProductionSimCore({
      content,
      initialState: { ...base, facility: { ...base.facility, thermalTiles: tiles } },
    });
    const { snapshot } = core.getPresentation(createDefaultPresentationContext());
    const count = 24 * 16;
    expect(snapshot.header.maxTemperatureC).toBe(40);
    expect(snapshot.header.averageTemperatureC).toBe((30 + 40 + 22 * (count - 2)) / count);
  });
});

describe("task and research cards", () => {
  test("accepts an offer and projects actual content labels with null forecasts", () => {
    const core = createCore("projection-task");
    const state = core.getStateForSave();
    const offer = state.tasks.offers[0];
    expect(offer).toBeDefined();
    if (offer === undefined) throw new Error("Expected an initial 1946 offer.");
    dispatchAccepted(core, {
      commandId: commandId(1),
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: offer,
    });

    const definition = content.tasks[offer];
    expect(definition).toBeDefined();
    if (definition === undefined) throw new Error("Offer references unknown task content.");
    const inspected = parsePresentationContext({
      selectedIds: [],
      inspectedEntityId: Object.keys(core.getStateForSave().tasks.instances)[0] ?? null,
      heatmapEnabled: false,
    });
    const { snapshot } = core.getPresentation(inspected);
    expect(snapshot.tasks).toHaveLength(1);
    const card = snapshot.tasks[0];
    expect(card?.definitionId).toBe(offer);
    expect(card?.nameKey).toBe(definition.nameKey);
    expect(card?.tags).toEqual([...definition.tags]);
    expect(card?.status).toBe("accepted");
    expect(card?.phaseIndex).toBe(0);
    expect(card?.phaseCount).toBe(definition.phases.length);
    expect(card?.progressRatio).toBe(0);
    expect(card?.projectedCompletionTick).toBeNull();
    expect(card?.deadlineRisk).toBeNull();
    expect(card?.allocatedUsefulComputeFlops).toBe(0);
    if (definition.deadlineSeconds !== null) {
      expect(card?.deadlineTick).toBe(definition.deadlineSeconds * 10);
    } else {
      expect(card?.deadlineTick).toBeNull();
    }
  });

  test("keeps allocation delivery, breakdown and bottleneck consistent with stored results", () => {
    const core = createCore("projection-allocate");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);
    applyDraft(core, 3);
    const offer = core.getStateForSave().tasks.offers[0];
    if (offer === undefined) throw new Error("Expected an initial 1946 offer.");
    dispatchAccepted(core, {
      commandId: commandId(4),
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: offer,
    });
    const instanceId = Object.keys(core.getStateForSave().tasks.instances)[0];
    if (instanceId === undefined) throw new Error("Expected an accepted task instance.");
    dispatchAccepted(core, {
      commandId: commandId(5),
      source: "player",
      kind: "ALLOCATE_TASK",
      taskInstanceId: instanceId,
      clusterModuleIds: ["module-instance-00000001"],
      requestedShare: 1,
    });
    core.step(2);

    const state = core.getStateForSave();
    const stored = state.facility.compute.byTask[instanceId];
    const { snapshot } = core.getPresentation(
      parsePresentationContext({
        selectedIds: [],
        inspectedEntityId: instanceId,
        heatmapEnabled: false,
      }),
    );
    const card = snapshot.tasks.find((entry) => entry.taskInstanceId === instanceId);
    expect(card?.allocatedUsefulComputeFlops).toBe(
      state.tasks.instances[instanceId]?.allocation?.deliveredUsefulComputeFlops ?? 0,
    );
    if (stored === undefined) {
      expect(snapshot.inspector.computeBreakdown).toBeNull();
      expect(snapshot.telemetry.bottleneck).toBeNull();
    } else {
      expect(snapshot.inspector.computeBreakdown).toEqual(stored.breakdown);
      let expected: { factor: string; lostComputeFlops: number } | null = null;
      for (const entry of stored.breakdown.bottlenecks) {
        if (
          expected === null ||
          entry.lostComputeFlops > expected.lostComputeFlops ||
          (entry.lostComputeFlops === expected.lostComputeFlops && entry.factor < expected.factor)
        ) {
          expected = entry;
        }
      }
      if (expected === null) {
        expect(snapshot.telemetry.bottleneck).toBeNull();
      } else {
        expect(snapshot.telemetry.bottleneck?.factor).toBe(expected.factor);
        expect(snapshot.telemetry.bottleneck?.lostComputeFlops).toBe(expected.lostComputeFlops);
      }
    }
  });
});

describe("ownership and determinism", () => {
  test("SimCore read boundary preserves hash, RNG, tick and state", () => {
    const core = createCore("projection-owned");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);
    const beforeHash = hashCanonicalState(core.getStateForSave());
    const beforeRng = core.getStateForSave().rngState;
    const beforeTick = core.tick;

    const first = core.getPresentation(createDefaultPresentationContext());
    const second = core.getPresentation(createDefaultPresentationContext());

    expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
    expect(core.getStateForSave().rngState).toBe(beforeRng);
    expect(core.tick).toBe(beforeTick);
    // Equal values, distinct owned references.
    expect(canonicalSerialize(first)).toBe(canonicalSerialize(second));
    expect(first.snapshot).not.toBe(second.snapshot);
    expect(first.grid).not.toBe(second.grid);
  });

  test("returned values are detached and deeply frozen", () => {
    const core = createCore("projection-detached");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);
    const state = core.getStateForSave();
    const { snapshot, grid } = core.getPresentation(
      parsePresentationContext({
        selectedIds: ["module-instance-00000001"],
        inspectedEntityId: "module-instance-00000001",
        heatmapEnabled: false,
      }),
    );

    const draftModule = state.facility.designDraft?.modules["module-instance-00000001"];
    expect(draftModule).toBeDefined();
    expect(grid.modules[0]).not.toBe(draftModule);
    expect(grid.modules[0]?.position).not.toBe(draftModule?.position);
    expect(grid.modules[0]?.overclock).not.toBe(draftModule?.overclock);

    for (const value of [
      snapshot,
      snapshot.header,
      snapshot.tasks,
      snapshot.telemetry,
      snapshot.inspector,
      snapshot.research,
      snapshot.build,
      grid,
      grid.modules,
      grid.routes,
      grid.modules[0],
      grid.modules[0]?.position,
      grid.modules[0]?.overclock,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(() => {
      (snapshot as { tick: number }).tick = 999;
    }).toThrow(TypeError);
  });

  test("narrow read carries shared frozen tiles and source revisions", () => {
    const core = createCore("projection-read");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 }, 0);
    const state = core.getStateForSave();
    const read = core.getPresentation(createDefaultPresentationContext());

    // Zero-copy read: consecutive reads share the frozen authoritative
    // array while thermal state is untouched (the save snapshot detaches,
    // so identity is asserted across reads, values against the snapshot).
    const again = core.getPresentation(createDefaultPresentationContext());
    expect(again.thermalTiles).toBe(read.thermalTiles);
    expect(read.thermalTiles).toEqual(state.facility.thermalTiles);
    expect(Object.isFrozen(read.thermalTiles)).toBe(true);
    expect(read.source).toEqual({
      liveLayoutRevision: state.facility.liveLayoutRevision,
      draftRevision: 1,
      thermalRevision: state.facility.thermalRevision,
      viewMode: "draft",
      width: 24,
      height: 16,
    });
    expect(Object.isFrozen(read)).toBe(true);
  });

  test("pure projector never mutates its inputs", () => {
    const core = createCore("projection-pure");
    const state = core.getStateForSave();
    const context = parsePresentationContext({
      selectedIds: ["module-instance-00000001"],
      inspectedEntityId: null,
      heatmapEnabled: false,
    });
    const beforeHash = hashCanonicalState(state);
    projectPresentation(state, content, context);
    expect(hashCanonicalState(state)).toBe(beforeHash);
    expect(context).toEqual({
      selectedIds: ["module-instance-00000001"],
      inspectedEntityId: null,
      heatmapEnabled: false,
    });
  });

  test("SimCore rejects malformed presentation contexts without touching state", () => {
    const core = createCore("projection-reject");
    const beforeHash = hashCanonicalState(core.getStateForSave());
    expect(() =>
      core.getPresentation({ selectedIds: [], inspectedEntityId: null } as unknown as never),
    ).toThrow(TypeError);
    expect(() =>
      core.getPresentation({
        selectedIds: [],
        inspectedEntityId: null,
        heatmapEnabled: false,
        extra: true,
      } as unknown as never),
    ).toThrow(TypeError);
    expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
  });
});

describe("projection source mapping", () => {
  function collectPaths(value: unknown, prefix: string, paths: Set<string>): void {
    if (Array.isArray(value)) {
      paths.add(prefix);
      // Recurse only into object elements; primitive arrays are covered
      // by their container entry (e.g. tasks[].tags).
      for (const entry of value) {
        if (entry !== null && typeof entry === "object") collectPaths(entry, `${prefix}[]`, paths);
      }
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") continue;
        collectPaths(
          (value as Record<string, unknown>)[key],
          prefix === "" ? key : `${prefix}.${key}`,
          paths,
        );
      }
      return;
    }
    paths.add(prefix);
  }

  function parentPath(path: string): string | null {
    if (path.endsWith("[]")) return path.slice(0, -2);
    const dot = path.lastIndexOf(".");
    if (dot === -1) return null;
    return path.slice(0, dot);
  }

  // Covered when the path, one of its ancestors (array containers), or a
  // documented extension of it (object containers) names a mapping entry.
  function isCovered(path: string): boolean {
    let candidate: string | null = path;
    while (candidate !== null) {
      if (PROJECTION_SOURCE_MAPPING[candidate] !== undefined) return true;
      candidate = parentPath(candidate);
    }
    return Object.keys(PROJECTION_SOURCE_MAPPING).some(
      (key) => key.startsWith(`${path}.`) || key.startsWith(`${path}[`),
    );
  }
  function gridPaths(grid: GridViewModel): Set<string> {
    const paths = new Set<string>();
    collectPaths(grid, "grid", paths);
    return paths;
  }

  function snapshotPaths(snapshot: UiSnapshot): Set<string> {
    const paths = new Set<string>();
    collectPaths(snapshot, "", paths);
    return paths;
  }

  test("every projected field has a frozen source-table entry", () => {
    expect(Object.isFrozen(PROJECTION_SOURCE_MAPPING)).toBe(true);
    const core = createCore("projection-mapping");
    enterDesign(core, 1);
    place(core, 2, "module-power-distribution", { x: 0, y: 0 }, 0);
    place(core, 3, "module-vacuum-tube-logic", { x: 3, y: 0 }, 0);
    const offer = core.getStateForSave().tasks.offers[0];
    if (offer !== undefined) {
      dispatchAccepted(core, {
        commandId: commandId(4),
        source: "player",
        kind: "ACCEPT_TASK",
        definitionId: offer,
      });
    }
    const instanceId = Object.keys(core.getStateForSave().tasks.instances)[0] ?? null;
    const { snapshot, grid } = core.getPresentation(
      parsePresentationContext({
        selectedIds: ["module-instance-00000001", "route-00000001"],
        inspectedEntityId: instanceId,
        heatmapEnabled: false,
      }),
    );

    const covered = new Set<string>();
    for (const paths of [snapshotPaths(snapshot), gridPaths(grid)]) {
      for (const path of paths) {
        // Root markers resolve to the section entries.
        if (path === "" || path === "grid") continue;
        expect(isCovered(path), `missing source entry for ${path}`).toBe(true);
        covered.add(path);
      }
    }
    expect(covered.size).toBeGreaterThan(40);
  });
});
