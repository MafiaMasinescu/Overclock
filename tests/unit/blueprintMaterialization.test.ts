import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type {
  BlueprintModule,
  BlueprintRecord,
  BlueprintRoute,
  GameState,
  ModuleInstanceState,
  OverclockSettings,
  RouteState,
  Rotation,
} from "../../src/sim/core/types.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  planBlueprintMaterialization,
  transformBlueprintPoint,
} from "../../src/sim/blueprints/blueprintMaterialization.ts";

const content = loadContentBundle();
const LOGIC = "module-vacuum-tube-logic";
const RELAY = "module-data-relay";
const PRINTER = "module-line-printer";
const BLUEPRINT_RESEARCH = "research-blueprint-documentation";

function enableAllResearch(state: GameState): void {
  for (const researchId of Object.keys(state.research.statuses)) {
    state.research.statuses[researchId] = "completed";
  }
}

function overclock(
  profile: OverclockSettings["profile"] = "balanced",
  frequencyRatio = 1,
  voltageRatio = 1,
): OverclockSettings {
  return { profile, frequencyRatio, voltageRatio };
}

function blueprintModule(
  localId: string,
  definitionId: string,
  relativePosition: { x: number; y: number },
  rotation: Rotation = 0,
  defaultOverclock = overclock(),
): BlueprintModule {
  return { localId, definitionId, relativePosition, rotation, defaultOverclock };
}

function requiredResearchIds(modules: readonly BlueprintModule[]): string[] {
  const ids = new Set<string>(
    Object.values(content.research)
      .filter((node) => node.unlockFeatureIds.includes("subassembly-blueprints"))
      .map((node) => node.id),
  );
  for (const module of modules) {
    for (const researchId of content.modules[module.definitionId]?.unlockResearchIds ?? []) {
      ids.add(researchId);
    }
  }
  return [...ids].toSorted();
}

function blueprintRecord(
  modules: readonly BlueprintModule[],
  bounds: { width: number; height: number },
  routes: readonly BlueprintRoute[] = [],
): BlueprintRecord {
  return {
    id: "blueprint-00000001",
    name: "Materialization fixture",
    version: 1,
    kind: "subassembly",
    contentVersion: content.contentVersion,
    modules: modules.map((module) => ({
      ...module,
      relativePosition: { ...module.relativePosition },
      defaultOverclock: { ...module.defaultOverclock },
    })),
    routes: routes.map((route) => ({
      ...route,
      relativePath: route.relativePath.map((point) => ({ ...point })),
    })),
    requiredResearchIds: requiredResearchIds(modules),
    bounds: { ...bounds },
    summary: {
      theoreticalComputeFlops: 123,
      peakPowerWatts: 456,
      estimatedMaxTemperatureC: 50,
      estimatedCostUsd: 789,
    },
  };
}

function emptyDraft(): NonNullable<GameState["facility"]["designDraft"]> {
  return { revision: 4, modules: {}, routes: {}, undoStack: [], redoStack: [] };
}

function materializationState(
  record: BlueprintRecord,
  editState?: (state: GameState) => void,
): GameState {
  const state = createInitialGameState({ content, seed: "blueprint-materialization" });
  enableAllResearch(state);
  state.blueprints.records = { [record.id]: record };
  state.blueprints.nextBlueprintSequence = 2;
  state.facility.designDraft = emptyDraft();
  state.inventory.stacks[LOGIC] = {
    definitionId: LOGIC,
    quantity: 20,
    averageAcquisitionCostUsd: 1850,
  };
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 20,
    averageAcquisitionCostUsd: 700,
  };
  state.inventory.stacks[PRINTER] = {
    definitionId: PRINTER,
    quantity: 20,
    averageAcquisitionCostUsd: 3200,
  };
  editState?.(state);
  return state;
}

function routeFixture(): BlueprintRoute {
  return {
    localId: "route-0001",
    kind: "data",
    fromLocalModuleId: "module-0001",
    fromPortId: "data-east",
    toLocalModuleId: "module-0002",
    toPortId: "data-west",
    relativePath: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  };
}

function routeStateFixture(id: string, firstId: string, secondId: string): RouteState {
  return {
    id,
    kind: "data",
    from: { moduleInstanceId: firstId, portId: "data-east" },
    to: { moduleInstanceId: secondId, portId: "data-west" },
    path: [
      { x: 5, y: 0 },
      { x: 6, y: 0 },
      { x: 7, y: 0 },
    ],
    capacityPerSecond: 60_000,
    congestionRatio: 0,
  };
}

function existingModule(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
    rotation: 0,
    operationalState: "online",
    overclock: overclock("boost", 1.1, 1.05),
    binComputeRatio: 0.8,
    binEfficiencyRatio: 0.8,
    binThermalRatio: 0.8,
    binStabilityRatio: 0.8,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

describe("pure Blueprint materialization planning", () => {
  test("transforms all four global rotations and uses the rotated bounds", () => {
    const record = blueprintRecord([blueprintModule("module-0001", LOGIC, { x: 1, y: 0 })], {
      width: 4,
      height: 3,
    });

    const positions = ([0, 90, 180, 270] as const).map((rotation) => {
      const result = planBlueprintMaterialization(
        materializationState(record),
        content,
        record.id,
        { x: 2, y: 1 },
        rotation,
      );
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected a ready plan.");
      const module = result.plan.addedModules[0];
      if (module === undefined) throw new Error("Expected a materialized module.");
      return {
        rotation,
        position: { ...module.position },
        moduleRotation: module.rotation,
      };
    });

    expect(positions).toEqual([
      { rotation: 0, position: { x: 3, y: 1 }, moduleRotation: 0 },
      { rotation: 90, position: { x: 4, y: 2 }, moduleRotation: 90 },
      { rotation: 180, position: { x: 3, y: 3 }, moduleRotation: 180 },
      { rotation: 270, position: { x: 2, y: 2 }, moduleRotation: 270 },
    ]);
  });

  test("transforms non-square route paths, translates them, and derives capacity from current ports", () => {
    const modules = [
      blueprintModule("module-0001", RELAY, { x: 0, y: 0 }),
      blueprintModule("module-0002", RELAY, { x: 2, y: 0 }),
    ];
    const record = blueprintRecord(modules, { width: 3, height: 2 }, [routeFixture()]);
    const result = planBlueprintMaterialization(
      materializationState(record),
      content,
      record.id,
      { x: 2, y: 2 },
      90,
    );

    expect(result).toMatchObject({ status: "ready" });
    if (result.status !== "ready") throw new Error("Expected a ready plan.");
    expect(
      result.plan.addedModules.map(({ id, position, rotation }) => ({ id, position, rotation })),
    ).toEqual([
      { id: "module-instance-00000001", position: { x: 3, y: 2 }, rotation: 90 },
      { id: "module-instance-00000002", position: { x: 3, y: 4 }, rotation: 90 },
    ]);
    expect(result.plan.addedRoutes).toEqual([
      expect.objectContaining({
        id: "route-00000001",
        from: { moduleInstanceId: "module-instance-00000001", portId: "data-east" },
        to: { moduleInstanceId: "module-instance-00000002", portId: "data-west" },
        path: [
          { x: 3, y: 2 },
          { x: 3, y: 3 },
          { x: 3, y: 4 },
        ],
        capacityPerSecond: 60_000,
        congestionRatio: 0,
      }),
    ]);
  });

  test("exposes the point transform as a pure canonical helper", () => {
    expect(transformBlueprintPoint({ x: 1, y: 0 }, { width: 4, height: 3 }, 90)).toEqual({
      x: 2,
      y: 1,
    });
    expect(transformBlueprintPoint({ x: 1, y: 0 }, { width: 4, height: 3 }, 270)).toEqual({
      x: 0,
      y: 2,
    });
  });

  test("combines stored module rotation with global rotation before deriving the anchor", () => {
    const record = blueprintRecord([blueprintModule("module-0001", LOGIC, { x: 0, y: 0 }, 90)], {
      width: 1,
      height: 2,
    });
    const result = planBlueprintMaterialization(
      materializationState(record),
      content,
      record.id,
      {
        x: 2,
        y: 2,
      },
      90,
    );

    expect(result).toMatchObject({ status: "ready" });
    if (result.status !== "ready") throw new Error("Expected a ready plan.");
    expect(result.plan.addedModules[0]).toMatchObject({
      position: { x: 2, y: 2 },
      rotation: 180,
    });
  });

  test("allocates deterministically in local ID order and initializes canonical module state", () => {
    const record = blueprintRecord(
      [
        blueprintModule("module-0002", LOGIC, { x: 2, y: 0 }, 90, overclock("boost", 1.18, 1.1)),
        blueprintModule("module-0001", RELAY, { x: 0, y: 0 }),
      ],
      { width: 4, height: 2 },
    );
    const state = materializationState(record, (candidate) => {
      candidate.facility.nextModuleInstanceSequence = 7;
      candidate.facility.nextRouteSequence = 9;
    });
    const result = planBlueprintMaterialization(state, content, record.id, { x: 1, y: 1 }, 0);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a ready plan.");
    expect(result.plan.addedModules.map(({ id, definitionId }) => ({ id, definitionId }))).toEqual([
      { id: "module-instance-00000007", definitionId: RELAY },
      { id: "module-instance-00000008", definitionId: LOGIC },
    ]);
    expect(result.plan.addedModules[1]).toMatchObject({
      position: { x: 3, y: 1 },
      rotation: 90,
      operationalState: "offline",
      startupTicksRemaining: 30,
      cooldownTicksRemaining: 0,
      overclock: { profile: "boost", frequencyRatio: 1.18, voltageRatio: 1.1 },
      binComputeRatio: 1,
      binEfficiencyRatio: 1,
      binThermalRatio: 1,
      binStabilityRatio: 1,
    });
    expect(result.plan.addedRoutes).toEqual([]);
    expect(result.plan.nextModuleInstanceSequence).toBe(9);
    expect(result.plan.nextRouteSequence).toBe(9);
    expect(result.plan.inventoryReservationDelta).toEqual([
      { definitionId: RELAY, quantity: 1 },
      { definitionId: LOGIC, quantity: 1 },
    ]);
  });

  test("accounts for existing draft reservations without consuming inventory", () => {
    const record = blueprintRecord([blueprintModule("module-0001", RELAY, { x: 0, y: 0 })], {
      width: 1,
      height: 1,
    });
    const state = materializationState(record, (candidate) => {
      candidate.facility.modules = {
        "live-relay": existingModule("live-relay", RELAY, { x: 5, y: 0 }),
      };
      candidate.facility.designDraft = {
        ...emptyDraft(),
        modules: {
          "draft-relay": existingModule("draft-relay", RELAY, { x: 7, y: 0 }),
        },
      };
      candidate.inventory.stacks[RELAY] = {
        definitionId: RELAY,
        quantity: 2,
        averageAcquisitionCostUsd: 700,
      };
    });
    const before = structuredClone(state);
    const result = planBlueprintMaterialization(state, content, record.id, { x: 0, y: 0 }, 0);

    expect(result).toMatchObject({ status: "ready" });
    if (result.status !== "ready") throw new Error("Expected a ready plan.");
    expect(result.plan.inventoryReservationDelta).toEqual([{ definitionId: RELAY, quantity: 1 }]);
    expect(state).toEqual(before);
  });

  test("accepts exact cumulative inventory sufficiency and rejects incomplete required Research", () => {
    const record = blueprintRecord([blueprintModule("module-0001", RELAY, { x: 0, y: 0 })], {
      width: 1,
      height: 1,
    });
    const state = materializationState(record, (candidate) => {
      candidate.facility.modules = {
        "live-relay": existingModule("live-relay", RELAY, { x: 5, y: 0 }),
      };
      candidate.facility.designDraft = {
        ...emptyDraft(),
        modules: {
          "draft-relay": existingModule("draft-relay", RELAY, { x: 7, y: 0 }),
        },
      };
      candidate.inventory.stacks[RELAY] = {
        definitionId: RELAY,
        quantity: 1,
        averageAcquisitionCostUsd: 700,
      };
    });
    expect(
      planBlueprintMaterialization(state, content, record.id, { x: 0, y: 0 }, 0),
    ).toMatchObject({
      status: "ready",
    });

    state.research.statuses["research-modular-wiring"] = "locked";
    expect(planBlueprintMaterialization(state, content, record.id, { x: 0, y: 0 }, 0)).toEqual({
      status: "rejected",
      code: "RESEARCH_INCOMPLETE",
      reason: "research-incomplete",
    });
  });

  test.each([
    { name: "negative target", target: { x: -1, y: 0 }, reason: "invalid-target" },
    { name: "facility boundary", target: { x: 23, y: 15 }, reason: "invalid-target" },
  ])("rejects $name without mutation", ({ target, reason }) => {
    const record = blueprintRecord([blueprintModule("module-0001", PRINTER, { x: 0, y: 0 })], {
      width: 3,
      height: 2,
    });
    const state = materializationState(record);
    const before = structuredClone(state);
    const result = planBlueprintMaterialization(state, content, record.id, target, 0);

    expect(result).toEqual({ status: "rejected", code: "INVALID_TARGET", reason });
    expect(state).toEqual(before);
  });

  test("rejects collisions with the draft and invalid stored module geometry", () => {
    const collisionRecord = blueprintRecord(
      [blueprintModule("module-0001", RELAY, { x: 0, y: 0 })],
      {
        width: 1,
        height: 1,
      },
    );
    const state = materializationState(collisionRecord, (candidate) => {
      candidate.facility.designDraft = {
        ...emptyDraft(),
        modules: { "draft-relay": existingModule("draft-relay", RELAY, { x: 0, y: 0 }) },
      };
    });
    expect(
      planBlueprintMaterialization(state, content, collisionRecord.id, { x: 0, y: 0 }, 0),
    ).toEqual({
      status: "rejected",
      code: "INVALID_TARGET",
      reason: "collision",
    });

    const invalidRecord = blueprintRecord([blueprintModule("module-0001", LOGIC, { x: 2, y: 0 })], {
      width: 2,
      height: 1,
    });
    const invalidState = materializationState(invalidRecord);
    expect(
      planBlueprintMaterialization(invalidState, content, invalidRecord.id, { x: 0, y: 0 }, 0),
    ).toEqual({ status: "rejected", code: "BLUEPRINT_INVALID", reason: "invalid-record" });

    const overlappingRecord = blueprintRecord(
      [
        blueprintModule("module-0001", RELAY, { x: 0, y: 0 }),
        blueprintModule("module-0002", RELAY, { x: 0, y: 0 }),
      ],
      { width: 1, height: 1 },
    );
    expect(
      planBlueprintMaterialization(
        materializationState(overlappingRecord),
        content,
        overlappingRecord.id,
        { x: 0, y: 0 },
        0,
      ),
    ).toEqual({ status: "rejected", code: "BLUEPRINT_INVALID", reason: "invalid-record" });
  });

  test("rejects invalid prerequisites, current content, unsupported kind, and inventory shortage", () => {
    const record = blueprintRecord([blueprintModule("module-0001", PRINTER, { x: 0, y: 0 })], {
      width: 3,
      height: 2,
    });
    const lockedState = materializationState(record, (state) => {
      state.research.statuses[BLUEPRINT_RESEARCH] = "locked";
    });
    expect(
      planBlueprintMaterialization(lockedState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({
      status: "rejected",
      code: "FEATURE_LOCKED",
      reason: "feature-locked",
    });

    const shortageState = materializationState(record, (state) => {
      state.inventory.stacks[PRINTER] = {
        definitionId: PRINTER,
        quantity: 0,
        averageAcquisitionCostUsd: 3200,
      };
    });
    expect(
      planBlueprintMaterialization(shortageState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({
      status: "rejected",
      code: "INSUFFICIENT_INVENTORY",
      reason: "inventory-shortage",
    });

    const mismatchedRecord = { ...record, contentVersion: "historical-content" };
    const mismatchState = materializationState(mismatchedRecord);
    expect(
      planBlueprintMaterialization(mismatchState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({
      status: "rejected",
      code: "BLUEPRINT_INVALID",
      reason: "content-version-mismatch",
    });

    const unsupportedRecord = { ...record, kind: "rack" as const };
    const unsupportedState = materializationState(unsupportedRecord);
    expect(
      planBlueprintMaterialization(unsupportedState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({ status: "rejected", code: "BLUEPRINT_INVALID", reason: "invalid-record" });

    const missingDefinitionRecord = blueprintRecord(
      [blueprintModule("module-0001", "module-missing", { x: 0, y: 0 })],
      { width: 1, height: 1 },
    );
    expect(
      planBlueprintMaterialization(
        materializationState(missingDefinitionRecord),
        content,
        missingDefinitionRecord.id,
        { x: 0, y: 0 },
        0,
      ),
    ).toEqual({ status: "rejected", code: "BLUEPRINT_INVALID", reason: "invalid-record" });
  });

  test("rejects sequence overflow and ID collision before returning any additions", () => {
    const record = blueprintRecord(
      [
        blueprintModule("module-0001", RELAY, { x: 0, y: 0 }),
        blueprintModule("module-0002", RELAY, { x: 2, y: 0 }),
      ],
      { width: 3, height: 1 },
      [routeFixture()],
    );
    const overflowState = materializationState(record, (state) => {
      state.facility.nextModuleInstanceSequence = Number.MAX_SAFE_INTEGER;
    });
    expect(
      planBlueprintMaterialization(overflowState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({ status: "rejected", code: "INVALID_SYSTEM", reason: "invalid-sequence" });

    const collisionState = materializationState(record, (state) => {
      state.facility.modules = {
        "module-instance-00000001": existingModule("module-instance-00000001", RELAY, {
          x: 7,
          y: 0,
        }),
      };
    });
    expect(
      planBlueprintMaterialization(collisionState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({ status: "rejected", code: "INVALID_SYSTEM", reason: "id-collision" });

    const routeOverflowState = materializationState(record, (state) => {
      state.facility.nextRouteSequence = Number.MAX_SAFE_INTEGER;
    });
    expect(
      planBlueprintMaterialization(routeOverflowState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({ status: "rejected", code: "INVALID_SYSTEM", reason: "invalid-sequence" });

    const routeCollisionState = materializationState(record, (state) => {
      state.facility.designDraft = {
        ...emptyDraft(),
        modules: {
          "draft-left": existingModule("draft-left", RELAY, { x: 5, y: 0 }),
          "draft-right": existingModule("draft-right", RELAY, { x: 7, y: 0 }),
        },
        routes: {
          "route-00000001": routeStateFixture("route-00000001", "draft-left", "draft-right"),
        },
      };
    });
    expect(
      planBlueprintMaterialization(routeCollisionState, content, record.id, { x: 0, y: 0 }, 0),
    ).toEqual({ status: "rejected", code: "INVALID_SYSTEM", reason: "id-collision" });
  });

  test("rejects invalid rotation and missing Design Mode without consuming RNG", () => {
    const record = blueprintRecord([blueprintModule("module-0001", RELAY, { x: 0, y: 0 })], {
      width: 1,
      height: 1,
    });
    const state = materializationState(record);
    const beforeRngState = state.rngState;
    expect(
      planBlueprintMaterialization(state, content, record.id, { x: 0, y: 0 }, 45 as Rotation),
    ).toEqual({ status: "rejected", code: "INVALID_ROTATION", reason: "invalid-rotation" });
    expect(state.rngState).toBe(beforeRngState);

    state.facility.designDraft = null;
    expect(planBlueprintMaterialization(state, content, record.id, { x: 0, y: 0 }, 0)).toEqual({
      status: "rejected",
      code: "NOT_IN_DESIGN_MODE",
      reason: "not-in-design-mode",
    });
  });

  test("returns immutable serializable output and is invariant to insertion order and repetition", () => {
    const modules = [
      blueprintModule("module-0002", RELAY, { x: 2, y: 0 }),
      blueprintModule("module-0001", RELAY, { x: 0, y: 0 }),
    ];
    const record = blueprintRecord(modules, { width: 3, height: 1 }, [routeFixture()]);
    const first = materializationState(record);
    const second = materializationState({
      ...record,
      modules: [...record.modules].reverse(),
      routes: [...record.routes].reverse(),
    });
    const firstResult = planBlueprintMaterialization(
      first,
      content,
      record.id,
      { x: 1, y: 1 },
      180,
    );
    const secondResult = planBlueprintMaterialization(
      second,
      content,
      record.id,
      { x: 1, y: 1 },
      180,
    );

    expect(secondResult).toEqual(firstResult);
    expect(planBlueprintMaterialization(first, content, record.id, { x: 1, y: 1 }, 180)).toEqual(
      firstResult,
    );
    expect(JSON.parse(JSON.stringify(firstResult))).toEqual(firstResult);
    if (firstResult.status === "ready") {
      expect(Object.isFrozen(firstResult.plan)).toBe(true);
      expect(Object.isFrozen(firstResult.plan.addedModules)).toBe(true);
      const firstModule = firstResult.plan.addedModules[0];
      if (firstModule === undefined) throw new Error("Expected a materialized module.");
      expect(() => {
        firstModule.position.x = 99;
      }).toThrow();
    }
  });
});
