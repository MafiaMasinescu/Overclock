import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import {
  calculateDesignInventoryReservations,
  createDesignModeCommandHandlers,
} from "../../src/sim/design/designModeCommands.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";
const PRINTER = "module-line-printer";
const VACUUM_TUBE = "module-vacuum-tube-logic";

function commandId(sequence: number): string {
  return `52000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function enter(sequence: number): Extract<SimCommand, { kind: "ENTER_DESIGN_MODE" }> {
  return { commandId: commandId(sequence), source: "player", kind: "ENTER_DESIGN_MODE" };
}

function cancel(sequence: number): Extract<SimCommand, { kind: "CANCEL_DESIGN" }> {
  return { commandId: commandId(sequence), source: "player", kind: "CANCEL_DESIGN" };
}

function place(
  sequence: number,
  definitionId = RELAY,
  position = { x: 0, y: 0 },
  rotation: 0 | 90 | 180 | 270 = 0,
): Extract<SimCommand, { kind: "PLACE_MODULE" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "PLACE_MODULE",
    definitionId,
    position,
    rotation,
  };
}

function remove(
  sequence: number,
  moduleInstanceId: string,
): Extract<SimCommand, { kind: "REMOVE_MODULE" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "REMOVE_MODULE",
    moduleInstanceId,
  };
}

function move(
  sequence: number,
  moduleInstanceId: string,
  position: { x: number; y: number },
): Extract<SimCommand, { kind: "MOVE_MODULE" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "MOVE_MODULE",
    moduleInstanceId,
    position,
  };
}

function rotate(
  sequence: number,
  moduleInstanceId: string,
  rotation: 0 | 90 | 180 | 270,
): Extract<SimCommand, { kind: "ROTATE_MODULE" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "ROTATE_MODULE",
    moduleInstanceId,
    rotation,
  };
}

function moduleFixture(
  id: string,
  definitionId = RELAY,
  position = { x: 0, y: 0 },
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "boost", frequencyRatio: 1.1, voltageRatio: 1.05 },
    binComputeRatio: 0.91,
    binEfficiencyRatio: 0.92,
    binThermalRatio: 0.93,
    binStabilityRatio: 0.94,
    startupTicksRemaining: 3,
    cooldownTicksRemaining: 4,
  };
}

function routeFixture(id: string, from: string, to: string): RouteState {
  return {
    id,
    kind: "data",
    from: { moduleInstanceId: from, portId: "data" },
    to: { moduleInstanceId: to, portId: "data" },
    path: [{ x: 0, y: 0 }],
    capacityPerSecond: 12,
    congestionRatio: 0.25,
  };
}

function createCore(
  options: {
    content?: ContentBundle;
    seed?: string;
    editState?: (state: GameState) => void;
  } = {},
): { core: SimCore; initialState: GameState; content: ContentBundle } {
  const content = options.content ?? loadContentBundle();
  const initialState = createInitialGameState({
    content,
    seed: options.seed ?? "task-5-2-design-mode",
  });
  options.editState?.(initialState);
  return {
    core: new SimCore({
      initialState,
      commandHandlers: createDesignModeCommandHandlers(content),
    }),
    initialState,
    content,
  };
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result === undefined) {
    throw new Error("Expected one command result.");
  }
  return result;
}

function populatedState(state: GameState): void {
  const left = moduleFixture("live-left", RELAY, { x: 0, y: 0 });
  const right = moduleFixture("live-right", RELAY, { x: 2, y: 0 });
  state.facility.modules = { [left.id]: left, [right.id]: right };
  const route = routeFixture("route-live", left.id, right.id);
  state.facility.routes = { [route.id]: route };
  state.facility.liveLayoutRevision = 7;
}

function coreWithSeededRedo(editState: (state: GameState) => void): {
  core: SimCore;
  before: GameState;
} {
  const entered = createCore({ editState });
  process(entered.core, enter(900));
  const state = entered.core.getStateForSave();
  if (state.facility.designDraft === null) {
    throw new Error("Expected active draft.");
  }
  state.facility.designDraft.redoStack.push({
    operationId: "future-redo",
    kind: "disconnect",
    payload: { routeId: "future-route" },
  });
  return {
    core: new SimCore({
      initialState: state,
      commandHandlers: createDesignModeCommandHandlers(entered.content),
    }),
    before: state,
  };
}

describe("ENTER_DESIGN_MODE and CANCEL_DESIGN", () => {
  test("clones a valid live layout into a detached revision-zero draft with empty stacks", () => {
    const { core, initialState } = createCore({ editState: populatedState });
    const liveBefore = structuredClone(initialState.facility);
    const inventoryBefore = structuredClone(initialState.inventory);
    const economyBefore = structuredClone(initialState.economy);

    expect(process(core, enter(1))).toEqual({
      commandId: commandId(1),
      accepted: true,
      appliedAtTick: 0,
    });
    const state = core.getStateForSave();
    expect(state.facility.designDraft).toEqual({
      revision: 0,
      modules: liveBefore.modules,
      routes: liveBefore.routes,
      undoStack: [],
      redoStack: [],
    });
    expect(state.facility.modules).toEqual(liveBefore.modules);
    expect(state.facility.routes).toEqual(liveBefore.routes);
    expect(state.facility.liveLayoutRevision).toBe(7);
    expect(state.inventory).toEqual(inventoryBefore);
    expect(state.economy).toEqual(economyBefore);
    expect(state.clock).toEqual(initialState.clock);
    expect(state.rngState).toBe(initialState.rngState);
  });

  test("does not retain live module or route references in the draft", () => {
    const { core } = createCore({ editState: populatedState });
    process(core, enter(2));
    const state = core.getStateForSave();
    const draft = state.facility.designDraft;
    if (draft === null) {
      throw new Error("Expected active draft.");
    }
    const module = draft.modules["live-left"];
    const routeTile = draft.routes["route-live"]?.path[0];
    if (module === undefined || routeTile === undefined) {
      throw new Error("Expected detached module and route fixtures.");
    }
    module.position.x = 99;
    routeTile.x = 99;

    const unchanged = core.getStateForSave();
    expect(unchanged.facility.modules["live-left"]?.position.x).toBe(0);
    expect(unchanged.facility.routes["route-live"]?.path[0]?.x).toBe(0);
    expect(unchanged.facility.designDraft?.modules["live-left"]?.position.x).toBe(0);
    expect(unchanged.facility.designDraft?.routes["route-live"]?.path[0]?.x).toBe(0);
  });

  test("rejects entering twice without changing state or RNG", () => {
    const { core } = createCore();
    process(core, enter(3));
    const before = core.getStateForSave();

    expect(process(core, enter(4))).toMatchObject({
      accepted: false,
      code: "ALREADY_IN_DESIGN_MODE",
      messageKey: "errors.already-in-design-mode",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(hashCanonicalState(before));
    expect(core.getStateForSave().rngState).toBe(before.rngState);
  });

  test("rejects every draft edit outside Design Mode", () => {
    const { core, initialState } = createCore();
    const before = hashCanonicalState(initialState);

    for (const command of [
      place(5),
      move(6, "missing", { x: 0, y: 0 }),
      rotate(7, "missing", 90),
      remove(8, "missing"),
    ]) {
      expect(process(core, command)).toMatchObject({
        accepted: false,
        code: "NOT_IN_DESIGN_MODE",
      });
    }
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("treats an invalid live grid as a fatal invariant before cloning", () => {
    const { core } = createCore({
      editState(state) {
        const invalid = moduleFixture("invalid-live", PRINTER, { x: 23, y: 15 });
        state.facility.modules[invalid.id] = invalid;
      },
    });
    core.enqueue(enter(9));

    expect(() => core.processPendingCommands()).toThrow(SimulatorInvariantError);
    expect(core.getStateForSave().facility.designDraft).toBeNull();
  });

  test("rejects cancel when no draft is active", () => {
    const { core, initialState } = createCore();

    expect(process(core, cancel(7))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
      messageKey: "errors.not-in-design-mode",
    });
    expect(core.getStateForSave()).toEqual(initialState);
  });

  test("discards a populated draft without applying any live or non-facility effects", () => {
    const { core } = createCore({ editState: populatedState });
    const before = core.getStateForSave();
    process(core, enter(8));
    process(core, place(9, VACUUM_TUBE, { x: 4, y: 0 }));

    expect(process(core, cancel(10))).toMatchObject({ accepted: true });
    const state = core.getStateForSave();
    expect(state.facility.designDraft).toBeNull();
    expect(state.facility.modules).toEqual(before.facility.modules);
    expect(state.facility.routes).toEqual(before.facility.routes);
    expect(state.facility.liveLayoutRevision).toBe(before.facility.liveLayoutRevision);
    expect(state.inventory).toEqual(before.inventory);
    expect(state.economy).toEqual(before.economy);
    expect(state.tasks).toEqual(before.tasks);
    expect(state.research).toEqual(before.research);
    expect(state.rngState).toBe(before.rngState);
    expect(state.facility.nextModuleInstanceSequence).toBe(2);
  });
});

describe("PLACE_MODULE", () => {
  test("derives reservations in stable definition order without storing them", () => {
    const liveRelay = moduleFixture("z-live-relay", RELAY, { x: 0, y: 0 });
    const livePrinter = moduleFixture("a-live-printer", PRINTER, { x: 3, y: 0 });
    const draftRelay = moduleFixture("a-draft-relay", RELAY, { x: 0, y: 3 });
    const draftTube = moduleFixture("z-draft-tube", VACUUM_TUBE, { x: 3, y: 3 });

    expect(
      calculateDesignInventoryReservations(
        { modules: { [liveRelay.id]: liveRelay, [livePrinter.id]: livePrinter } },
        { modules: { [draftTube.id]: draftTube, [draftRelay.id]: draftRelay } },
        { [VACUUM_TUBE]: { quantity: 2 } },
      ),
    ).toEqual([
      {
        definitionId: RELAY,
        liveCount: 1,
        draftCount: 1,
        requiredFromInventory: 0,
        availableInventory: 0,
      },
      {
        definitionId: PRINTER,
        liveCount: 1,
        draftCount: 0,
        requiredFromInventory: 0,
        availableInventory: 0,
      },
      {
        definitionId: VACUUM_TUBE,
        liveCount: 0,
        draftCount: 1,
        requiredFromInventory: 1,
        availableInventory: 2,
      },
    ]);
  });
  test("places only in the draft and initializes every approved neutral field", () => {
    const { core, initialState, content } = createCore({
      editState(state) {
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 1,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    const liveBefore = structuredClone(initialState.facility.modules);
    const inventoryBefore = structuredClone(initialState.inventory);
    const economyBefore = structuredClone(initialState.economy);
    process(core, enter(20));

    expect(process(core, place(21, RELAY, { x: 3, y: 4 }, 270))).toMatchObject({
      accepted: true,
    });
    const state = core.getStateForSave();
    const created = state.facility.designDraft?.modules["module-instance-00000001"];
    expect(created).toEqual({
      id: "module-instance-00000001",
      definitionId: RELAY,
      position: { x: 3, y: 4 },
      rotation: 270,
      operationalState: "offline",
      overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      binComputeRatio: 1,
      binEfficiencyRatio: 1,
      binThermalRatio: 1,
      binStabilityRatio: 1,
      startupTicksRemaining: content.modules[RELAY]?.startupTicks,
      cooldownTicksRemaining: 0,
    });
    expect(state.facility.modules).toEqual(liveBefore);
    expect(state.inventory).toEqual(inventoryBefore);
    expect(state.economy).toEqual(economyBefore);
    expect(state.facility.designDraft?.revision).toBe(1);
    expect(state.facility.designDraft?.redoStack).toEqual([]);
    expect(state.facility.nextModuleInstanceSequence).toBe(2);
    expect(state.rngState).toBe(initialState.rngState);
  });

  test("rejects unknown definitions, bounds failures, and collisions atomically", () => {
    const { core } = createCore({
      editState(state) {
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 2,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    process(core, enter(22));
    process(core, place(23, RELAY, { x: 0, y: 0 }));
    const before = core.getStateForSave();

    expect(process(core, place(24, "module-unknown", { x: 4, y: 4 }))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(process(core, place(25, PRINTER, { x: 23, y: 15 }))).toMatchObject({
      accepted: false,
      code: "OUT_OF_BOUNDS",
    });
    expect(process(core, place(26, RELAY, { x: 0, y: 0 }))).toMatchObject({
      accepted: false,
      code: "TILE_OCCUPIED",
    });
    expect(core.getStateForSave()).toEqual(before);
  });

  test("accepts exactly the available inventory reservation and rejects the next unit", () => {
    const { core, initialState } = createCore({
      editState(state) {
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 2,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    process(core, enter(27));

    expect(process(core, place(28, RELAY, { x: 0, y: 0 })).accepted).toBe(true);
    expect(process(core, place(29, RELAY, { x: 1, y: 0 })).accepted).toBe(true);
    const beforeRejected = core.getStateForSave();
    expect(process(core, place(30, RELAY, { x: 2, y: 0 }))).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_INVENTORY",
    });
    expect(core.getStateForSave()).toEqual(beforeRejected);
    expect(core.getStateForSave().inventory).toEqual(initialState.inventory);
  });

  test("reuses removed live hardware and releases a removed new-module reservation", () => {
    const live = moduleFixture("installed-relay", RELAY, { x: 0, y: 0 });
    const { core } = createCore({
      editState(state) {
        Reflect.deleteProperty(state.inventory.stacks, RELAY);
        state.facility.modules[live.id] = live;
      },
    });
    process(core, enter(31));
    expect(process(core, place(32, RELAY, { x: 1, y: 0 }))).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_INVENTORY",
    });
    expect(process(core, remove(33, live.id))).toMatchObject({ accepted: true });
    expect(process(core, place(34, RELAY, { x: 1, y: 0 })).accepted).toBe(true);
    expect(process(core, remove(35, "module-instance-00000001")).accepted).toBe(true);
    expect(process(core, place(36, RELAY, { x: 2, y: 0 })).accepted).toBe(true);
    expect(core.getStateForSave().facility.nextModuleInstanceSequence).toBe(3);
  });

  test("does not check research when locked hardware already exists in inventory", () => {
    const { core } = createCore({
      editState(state) {
        state.inventory.stacks[PRINTER] = {
          definitionId: PRINTER,
          quantity: 1,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    process(core, enter(37));

    expect(process(core, place(38, PRINTER, { x: 0, y: 0 })).accepted).toBe(true);
  });

  test("allocates deterministic sequential IDs and never restores consumed sequences", () => {
    const { core } = createCore({
      editState(state) {
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 4,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    process(core, enter(39));
    process(core, place(40, RELAY, { x: 0, y: 0 }));
    process(core, place(41, RELAY, { x: 1, y: 0 }));
    process(core, remove(42, "module-instance-00000001"));
    process(core, cancel(43));
    process(core, enter(44));
    process(core, place(45, RELAY, { x: 2, y: 0 }));

    expect(Object.keys(core.getStateForSave().facility.designDraft?.modules ?? {})).toEqual([
      "module-instance-00000003",
    ]);
    expect(core.getStateForSave().facility.nextModuleInstanceSequence).toBe(4);
  });

  test("does not consume a sequence for any rejected placement", () => {
    const { core } = createCore({
      editState(state) {
        Reflect.deleteProperty(state.inventory.stacks, RELAY);
      },
    });
    process(core, enter(46));

    process(core, place(47, "module-unknown", { x: 0, y: 0 }));
    process(core, place(48, RELAY, { x: -1, y: 0 }));
    process(core, place(49, RELAY, { x: 0, y: 0 }));
    expect(core.getStateForSave().facility.nextModuleInstanceSequence).toBe(1);
  });

  test("rejects generated ID collisions and sequence overflow without mutation", () => {
    const collision = createCore({
      editState(state) {
        const existing = moduleFixture("module-instance-00000001", RELAY, { x: 5, y: 5 });
        state.facility.modules[existing.id] = existing;
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 2,
          averageAcquisitionCostUsd: 1,
        };
      },
    }).core;
    process(collision, enter(50));
    const collisionBefore = collision.getStateForSave();
    expect(process(collision, place(51, RELAY, { x: 0, y: 0 }))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
    expect(collision.getStateForSave()).toEqual(collisionBefore);

    const overflow = createCore({
      editState(state) {
        state.facility.nextModuleInstanceSequence = Number.MAX_SAFE_INTEGER;
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 1,
          averageAcquisitionCostUsd: 1,
        };
      },
    }).core;
    process(overflow, enter(52));
    const overflowBefore = overflow.getStateForSave();
    expect(process(overflow, place(53, RELAY, { x: 0, y: 0 }))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
    expect(overflow.getStateForSave()).toEqual(overflowBefore);
  });

  test("records a detached complete place operation and clears redo only on the real edit", () => {
    const { core } = createCore({
      editState(state) {
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 1,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    process(core, enter(54));
    const stateWithRedo = core.getStateForSave();
    if (stateWithRedo.facility.designDraft === null) {
      throw new Error("Expected draft.");
    }
    stateWithRedo.facility.designDraft.redoStack.push({
      operationId: "future-redo",
      kind: "remove",
      payload: { marker: true },
    });
    const seededCore = new SimCore({
      initialState: stateWithRedo,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });

    expect(process(seededCore, place(55, RELAY, { x: 0, y: 0 })).accepted).toBe(true);
    const draft = seededCore.getStateForSave().facility.designDraft;
    expect(draft?.redoStack).toEqual([]);
    expect(draft?.undoStack).toHaveLength(1);
    expect(draft?.undoStack[0]).toEqual({
      operationId: `design-operation-1-${commandId(55)}`,
      kind: "place",
      payload: { module: draft?.modules["module-instance-00000001"] },
    });
    expect(JSON.parse(canonicalSerialize(draft))).toEqual(draft);
  });
});

describe("MOVE_MODULE", () => {
  test("moves a known draft module while preserving every non-position field", () => {
    const target = moduleFixture("move-target", PRINTER, { x: 0, y: 0 });
    const { core, before } = coreWithSeededRedo((state) => {
      state.facility.modules[target.id] = target;
    });
    const previous = structuredClone(before.facility.designDraft?.modules[target.id]);

    expect(process(core, move(100, target.id, { x: 5, y: 6 }))).toMatchObject({ accepted: true });
    const state = core.getStateForSave();
    expect(state.facility.designDraft?.modules[target.id]).toEqual({
      ...previous,
      position: { x: 5, y: 6 },
    });
    expect(state.facility.modules[target.id]).toEqual(target);
    expect(state.facility.designDraft?.revision).toBe(1);
    expect(state.facility.designDraft?.redoStack).toEqual([]);
    expect(state.facility.nextModuleInstanceSequence).toBe(1);
    expect(state.rngState).toBe(before.rngState);
  });

  test("rejects unknown IDs, collisions, and bounds failures atomically", () => {
    const moved = moduleFixture("moved", RELAY, { x: 0, y: 0 });
    const blocker = moduleFixture("blocker", RELAY, { x: 2, y: 0 });
    const { core } = coreWithSeededRedo((state) => {
      state.facility.modules = { [moved.id]: moved, [blocker.id]: blocker };
    });

    for (const [command, code] of [
      [move(101, "missing", { x: 1, y: 1 }), "INVALID_PAYLOAD"],
      [move(102, moved.id, { x: 2, y: 0 }), "TILE_OCCUPIED"],
      [move(103, moved.id, { x: -1, y: 0 }), "OUT_OF_BOUNDS"],
    ] as const) {
      const before = core.getStateForSave();
      expect(process(core, command)).toMatchObject({ accepted: false, code });
      expect(core.getStateForSave()).toEqual(before);
    }
  });

  test("accepts movement to the current position as an exact no-op", () => {
    const moved = moduleFixture("moved", RELAY, { x: 4, y: 4 });
    const { core, before } = coreWithSeededRedo((state) => {
      state.facility.modules[moved.id] = moved;
    });
    const beforeHash = hashCanonicalState(before);

    expect(process(core, move(104, moved.id, { x: 4, y: 4 }))).toMatchObject({ accepted: true });
    const after = core.getStateForSave();
    expect(hashCanonicalState(after)).toBe(beforeHash);
    expect(after).toEqual(before);
  });
});

describe("ROTATE_MODULE", () => {
  test("applies an absolute clockwise rotation to a non-square module", () => {
    const target = moduleFixture("rotate-target", PRINTER, { x: 0, y: 0 });
    const { core, before } = coreWithSeededRedo((state) => {
      state.facility.modules[target.id] = target;
    });

    expect(process(core, rotate(110, target.id, 90))).toMatchObject({ accepted: true });
    const state = core.getStateForSave();
    expect(state.facility.designDraft?.modules[target.id]).toEqual({
      ...target,
      position: { x: 0, y: 0 },
      rotation: 90,
    });
    expect(state.facility.modules[target.id]).toEqual(target);
    expect(state.facility.designDraft?.revision).toBe(1);
    expect(state.facility.designDraft?.redoStack).toEqual([]);
    expect(state.facility.nextModuleInstanceSequence).toBe(1);
    expect(state.rngState).toBe(before.rngState);
  });

  test("rejects unknown IDs, rotated collisions, and rotated bounds failures atomically", () => {
    const target = moduleFixture("rotate-target", PRINTER, { x: 0, y: 0 });
    const blocker = moduleFixture("rotate-blocker", RELAY, { x: 0, y: 2 });
    const collision = coreWithSeededRedo((state) => {
      state.facility.modules = { [target.id]: target, [blocker.id]: blocker };
    }).core;
    const unknownBefore = collision.getStateForSave();
    expect(process(collision, rotate(111, "missing", 90))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(collision.getStateForSave()).toEqual(unknownBefore);
    const collisionBefore = collision.getStateForSave();
    expect(process(collision, rotate(112, target.id, 90))).toMatchObject({
      accepted: false,
      code: "TILE_OCCUPIED",
    });
    expect(collision.getStateForSave()).toEqual(collisionBefore);

    const edge = moduleFixture("edge-printer", PRINTER, { x: 21, y: 14 });
    const bounds = coreWithSeededRedo((state) => {
      state.facility.modules[edge.id] = edge;
    }).core;
    const boundsBefore = bounds.getStateForSave();
    expect(process(bounds, rotate(113, edge.id, 90))).toMatchObject({
      accepted: false,
      code: "OUT_OF_BOUNDS",
    });
    expect(bounds.getStateForSave()).toEqual(boundsBefore);
  });

  test("accepts rotation to the current absolute value as an exact no-op", () => {
    const target = moduleFixture("rotate-target", PRINTER, { x: 0, y: 0 });
    const { core, before } = coreWithSeededRedo((state) => {
      state.facility.modules[target.id] = target;
    });

    expect(process(core, rotate(114, target.id, 0))).toMatchObject({ accepted: true });
    expect(core.getStateForSave()).toEqual(before);
  });
});

describe("REMOVE_MODULE and attached routes", () => {
  test.each(["move", "rotate", "remove"] as const)(
    "%s removes sorted attached routes, records them, and preserves unrelated routes",
    (kind) => {
      const target = moduleFixture("route-target", RELAY, { x: 0, y: 0 });
      const neighbor = moduleFixture("route-neighbor", RELAY, { x: 2, y: 0 });
      const unrelatedLeft = moduleFixture("unrelated-left", RELAY, { x: 4, y: 0 });
      const unrelatedRight = moduleFixture("unrelated-right", RELAY, { x: 6, y: 0 });
      const routeZ = routeFixture("route-z", target.id, neighbor.id);
      const routeA = routeFixture("route-a", neighbor.id, target.id);
      const unrelated = routeFixture("route-unrelated", unrelatedLeft.id, unrelatedRight.id);
      const { core, before } = coreWithSeededRedo((state) => {
        state.facility.modules = {
          [target.id]: target,
          [neighbor.id]: neighbor,
          [unrelatedLeft.id]: unrelatedLeft,
          [unrelatedRight.id]: unrelatedRight,
        };
        state.facility.routes = {
          [routeZ.id]: routeZ,
          [unrelated.id]: unrelated,
          [routeA.id]: routeA,
        };
      });

      const command =
        kind === "move"
          ? move(120, target.id, { x: 0, y: 3 })
          : kind === "rotate"
            ? rotate(121, target.id, 90)
            : remove(122, target.id);
      expect(process(core, command)).toMatchObject({ accepted: true });
      const state = core.getStateForSave();
      const draft = state.facility.designDraft;
      expect(draft?.routes).toEqual({ [unrelated.id]: unrelated });
      expect(state.facility.routes).toEqual(before.facility.routes);
      expect(draft?.revision).toBe(1);
      expect(draft?.redoStack).toEqual([]);
      const operation = draft?.undoStack[0];
      expect(operation?.kind).toBe(kind);
      expect(operation?.payload["removedRoutes"]).toEqual([routeA, routeZ]);
      if (kind === "remove") {
        expect(operation?.payload["module"]).toEqual(target);
        expect(draft?.modules[target.id]).toBeUndefined();
      } else {
        expect(draft?.modules[target.id]).toBeDefined();
      }
      expect(JSON.parse(canonicalSerialize(operation))).toEqual(operation);
      expect(state.inventory).toEqual(before.inventory);
      expect(state.economy).toEqual(before.economy);
      expect(state.rngState).toBe(before.rngState);
    },
  );

  test("rejects unknown removal IDs without clearing redo or changing revision", () => {
    const { core, before } = coreWithSeededRedo(() => undefined);

    expect(process(core, remove(123, "missing"))).toMatchObject({
      accepted: false,
      code: "INVALID_PAYLOAD",
    });
    expect(core.getStateForSave()).toEqual(before);
  });
});

describe("draft revisions, operation history, and pipeline composition", () => {
  test.each([
    ["move", "__proto__"],
    ["move", "constructor"],
    ["rotate", "__proto__"],
    ["rotate", "constructor"],
    ["remove", "__proto__"],
    ["remove", "constructor"],
  ] as const)(
    "rejects inherited %s module ID %s and continues FIFO processing",
    (kind, inheritedId) => {
      const target = moduleFixture("own-module", RELAY, { x: 0, y: 0 });
      const { core, before } = coreWithSeededRedo((state) => {
        state.facility.modules[target.id] = target;
      });
      const invalid =
        kind === "move"
          ? move(125, inheritedId, { x: 2, y: 0 })
          : kind === "rotate"
            ? rotate(126, inheritedId, 90)
            : remove(127, inheritedId);
      const validNoOp = move(128, target.id, { x: 0, y: 0 });
      core.enqueue(invalid);
      core.enqueue(validNoOp);

      expect(core.processPendingCommands()).toEqual([
        {
          commandId: invalid.commandId,
          accepted: false,
          rejectedAtTick: 0,
          code: "INVALID_PAYLOAD",
          messageKey: "errors.invalid-payload",
        },
        { commandId: validNoOp.commandId, accepted: true, appliedAtTick: 0 },
      ]);
      expect(core.getStateForSave()).toEqual(before);
    },
  );

  test("records complete reversible move, rotate, and remove payloads with command-based IDs", () => {
    const target = moduleFixture("history-target", PRINTER, { x: 0, y: 0 });
    const { core } = createCore({
      editState(state) {
        state.facility.modules[target.id] = target;
      },
    });
    process(core, enter(130));
    process(core, move(131, target.id, { x: 5, y: 5 }));
    process(core, rotate(132, target.id, 90));
    process(core, remove(133, target.id));

    const draft = core.getStateForSave().facility.designDraft;
    expect(draft?.revision).toBe(3);
    expect(draft?.undoStack).toEqual([
      {
        operationId: `design-operation-1-${commandId(131)}`,
        kind: "move",
        payload: {
          moduleInstanceId: target.id,
          previousPosition: { x: 0, y: 0 },
          newPosition: { x: 5, y: 5 },
          removedRoutes: [],
        },
      },
      {
        operationId: `design-operation-2-${commandId(132)}`,
        kind: "rotate",
        payload: {
          moduleInstanceId: target.id,
          previousRotation: 0,
          newRotation: 90,
          removedRoutes: [],
        },
      },
      {
        operationId: `design-operation-3-${commandId(133)}`,
        kind: "remove",
        payload: {
          module: { ...target, position: { x: 5, y: 5 }, rotation: 90 },
          removedRoutes: [],
        },
      },
    ]);
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });

  test.each(["place", "move", "rotate", "remove"] as const)(
    "rejects %s when its real edit would overflow the draft revision",
    (kind) => {
      const target = moduleFixture("overflow-target", RELAY, { x: 0, y: 0 });
      const { core } = createCore({
        editState(state) {
          state.facility.modules[target.id] = target;
          state.inventory.stacks[RELAY] = {
            definitionId: RELAY,
            quantity: 1,
            averageAcquisitionCostUsd: 1,
          };
        },
      });
      process(core, enter(140));
      const state = core.getStateForSave();
      if (state.facility.designDraft === null) {
        throw new Error("Expected draft.");
      }
      state.facility.designDraft.revision = Number.MAX_SAFE_INTEGER;
      const overflowCore = new SimCore({
        initialState: state,
        commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
      });
      const before = overflowCore.getStateForSave();
      const command =
        kind === "place"
          ? place(141, RELAY, { x: 2, y: 0 })
          : kind === "move"
            ? move(142, target.id, { x: 2, y: 0 })
            : kind === "rotate"
              ? rotate(143, target.id, 90)
              : remove(144, target.id);

      expect(process(overflowCore, command)).toMatchObject({
        accepted: false,
        code: "INVALID_SYSTEM",
      });
      expect(overflowCore.getStateForSave()).toEqual(before);
    },
  );

  test("accepts move and rotation no-ops even at the maximum draft revision", () => {
    const target = moduleFixture("maximum-no-op", PRINTER, { x: 0, y: 0 });
    const { core } = createCore({
      editState(state) {
        state.facility.modules[target.id] = target;
      },
    });
    process(core, enter(145));
    const state = core.getStateForSave();
    if (state.facility.designDraft === null) {
      throw new Error("Expected draft.");
    }
    state.facility.designDraft.revision = Number.MAX_SAFE_INTEGER;
    state.facility.designDraft.redoStack.push({
      operationId: "preserved-redo",
      kind: "connect",
      payload: { marker: true },
    });
    const noOpCore = new SimCore({
      initialState: state,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });

    expect(process(noOpCore, move(146, target.id, { x: 0, y: 0 })).accepted).toBe(true);
    expect(process(noOpCore, rotate(147, target.id, 0)).accepted).toBe(true);
    expect(noOpCore.getStateForSave()).toEqual(state);
  });

  test("keeps live state unchanged through FIFO enter, place, move, rotate, remove, and cancel", () => {
    const { core, initialState } = createCore({
      editState(state) {
        state.inventory.stacks[RELAY] = {
          definitionId: RELAY,
          quantity: 1,
          averageAcquisitionCostUsd: 1,
        };
      },
    });
    const liveBefore = structuredClone(initialState.facility.modules);
    const commands = [
      enter(150),
      place(151, RELAY, { x: 0, y: 0 }),
      move(152, "module-instance-00000001", { x: 2, y: 2 }),
      rotate(153, "module-instance-00000001", 90),
      remove(154, "module-instance-00000001"),
      cancel(155),
    ];
    const receipts = commands.map((command) => core.enqueue(command));

    expect(core.processPendingCommands()).toEqual(
      commands.map((command) => ({
        commandId: command.commandId,
        accepted: true,
        appliedAtTick: 0,
      })),
    );
    expect(receipts.map(({ queueSequence }) => queueSequence)).toEqual([0, 1, 2, 3, 4, 5]);
    const state = core.getStateForSave();
    expect(state.facility.modules).toEqual(liveBefore);
    expect(state.facility.designDraft).toBeNull();
    expect(state.inventory).toEqual(initialState.inventory);
    expect(state.economy).toEqual(initialState.economy);
    expect(state.rngState).toBe(initialState.rngState);
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid authoritative module sequence of %s",
    (sequence) => {
      const state = createInitialGameState({ content: loadContentBundle(), seed: "bad-sequence" });
      state.facility.nextModuleInstanceSequence = sequence;
      expect(() => new SimCore({ initialState: state })).toThrow(
        "next module instance sequence must be a positive safe integer",
      );
    },
  );
});
