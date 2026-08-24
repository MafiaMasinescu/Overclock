import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const RELAY = "module-data-relay";

function commandId(sequence: number): string {
  return `54000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function relay(id: string, x: number, y: number): ModuleInstanceState {
  return {
    id,
    definitionId: RELAY,
    position: { x, y },
    rotation: 0,
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

function createCore(editState?: (state: GameState) => void): SimCore {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "task-5-4-undo-redo" });
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 10,
    averageAcquisitionCostUsd: 1,
  };
  editState?.(state);
  return new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result === undefined) throw new Error("Expected a processed command result.");
  return result;
}

function command(
  sequence: number,
  kind: "UNDO_DESIGN" | "REDO_DESIGN" | "ENTER_DESIGN_MODE",
): SimCommand {
  return { commandId: commandId(sequence), source: "player", kind };
}

function connect(sequence: number): Extract<SimCommand, { kind: "CONNECT_PORTS" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "CONNECT_PORTS",
    from: { moduleInstanceId: "left", portId: "data-east" },
    to: { moduleInstanceId: "right", portId: "data-west" },
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  };
}

function connectedFixture(state: GameState): void {
  const left = relay("left", 0, 0);
  const right = relay("right", 3, 0);
  state.facility.modules = { left, right };
}

test("registers the production Design Mode undo and redo handlers", () => {
  const handlers = createDesignModeCommandHandlers(loadContentBundle());

  expect(Object.keys(handlers)).toEqual(expect.arrayContaining(["UNDO_DESIGN", "REDO_DESIGN"]));
});

describe("UNDO_DESIGN and REDO_DESIGN", () => {
  test("leaves APPLY_DESIGN unavailable and rejects outside Design Mode", () => {
    const core = createCore();
    expect(process(core, command(1, "UNDO_DESIGN"))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
    });
    expect(process(core, command(2, "REDO_DESIGN"))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
    });
    expect(
      process(core, {
        commandId: commandId(3),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: 0,
        acceptedCostUsd: 0,
        acceptedDowntimeTicks: 0,
      }),
    ).toMatchObject({ accepted: false, code: "COMMAND_NOT_AVAILABLE" });
  });

  test("accepts exact empty-stack no-ops, including at maximum revision", () => {
    const entered = createCore();
    expect(process(entered, command(1, "ENTER_DESIGN_MODE")).accepted).toBe(true);
    const before = entered.getStateForSave();
    expect(process(entered, command(2, "UNDO_DESIGN")).accepted).toBe(true);
    expect(process(entered, command(3, "REDO_DESIGN")).accepted).toBe(true);
    expect(entered.getStateForSave()).toEqual(before);

    const maximum = entered.getStateForSave();
    if (maximum.facility.designDraft === null) throw new Error("Expected draft.");
    maximum.facility.designDraft.revision = Number.MAX_SAFE_INTEGER;
    const core = new SimCore({
      initialState: maximum,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });
    const maximumBefore = core.getStateForSave();
    expect(process(core, command(4, "UNDO_DESIGN")).accepted).toBe(true);
    expect(process(core, command(5, "REDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave()).toEqual(maximumBefore);
  });

  test("rejects nonempty undo and redo revision overflow atomically", () => {
    const core = createCore();
    process(core, command(1, "ENTER_DESIGN_MODE"));
    process(core, {
      commandId: commandId(2),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    const overflow = core.getStateForSave();
    if (overflow.facility.designDraft === null) throw new Error("Expected draft.");
    overflow.facility.designDraft.revision = Number.MAX_SAFE_INTEGER;
    const undoCore = new SimCore({
      initialState: overflow,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });
    const undoBefore = hashCanonicalState(undoCore.getStateForSave());
    expect(process(undoCore, command(3, "UNDO_DESIGN"))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
    expect(hashCanonicalState(undoCore.getStateForSave())).toBe(undoBefore);

    const redoSeed = core.getStateForSave();
    const redoDraft = redoSeed.facility.designDraft;
    if (redoDraft === null) throw new Error("Expected draft.");
    redoDraft.revision = 1;
    const redoCore = new SimCore({
      initialState: redoSeed,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });
    process(redoCore, command(4, "UNDO_DESIGN"));
    const redoOverflow = redoCore.getStateForSave();
    if (redoOverflow.facility.designDraft === null) throw new Error("Expected draft.");
    redoOverflow.facility.designDraft.revision = Number.MAX_SAFE_INTEGER;
    const rejectedRedo = new SimCore({
      initialState: redoOverflow,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });
    const redoBefore = hashCanonicalState(rejectedRedo.getStateForSave());
    expect(process(rejectedRedo, command(5, "REDO_DESIGN"))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
    expect(hashCanonicalState(rejectedRedo.getStateForSave())).toBe(redoBefore);
  });

  test("round-trips place with its original operation and without sequence changes", () => {
    const core = createCore();
    process(core, command(1, "ENTER_DESIGN_MODE"));
    process(core, {
      commandId: commandId(2),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    const placed = core.getStateForSave();
    const draft = placed.facility.designDraft;
    if (draft === null) throw new Error("Expected draft.");
    const operation = structuredClone(draft.undoStack.at(-1));
    const moduleSequence = placed.facility.nextModuleInstanceSequence;
    const routeSequence = placed.facility.nextRouteSequence;
    expect(process(core, command(3, "UNDO_DESIGN")).accepted).toBe(true);
    expect(
      core.getStateForSave().facility.designDraft?.modules["module-instance-00000001"],
    ).toBeUndefined();
    expect(process(core, command(4, "REDO_DESIGN")).accepted).toBe(true);
    const restored = core.getStateForSave();
    expect(restored.facility.designDraft?.undoStack.at(-1)).toEqual(operation);
    expect(restored.facility.nextModuleInstanceSequence).toBe(moduleSequence);
    expect(restored.facility.nextRouteSequence).toBe(routeSequence);
  });

  test("round-trips move, rotate, remove, connect, and disconnect with exact route ids", () => {
    const core = createCore(connectedFixture);
    process(core, command(1, "ENTER_DESIGN_MODE"));
    process(core, connect(2));
    process(core, {
      commandId: commandId(3),
      source: "player",
      kind: "MOVE_MODULE",
      moduleInstanceId: "left",
      position: { x: 0, y: 2 },
    });
    expect(process(core, command(4, "UNDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave().facility.designDraft?.routes["route-00000001"]?.path).toEqual(
      connect(2).path,
    );
    expect(process(core, command(5, "REDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave().facility.designDraft?.routes).toEqual({});

    expect(process(core, command(6, "UNDO_DESIGN")).accepted).toBe(true);
    process(core, {
      commandId: commandId(7),
      source: "player",
      kind: "ROTATE_MODULE",
      moduleInstanceId: "left",
      rotation: 90,
    });
    expect(process(core, command(8, "UNDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave().facility.designDraft?.modules["left"]?.rotation).toBe(0);
    expect(process(core, command(9, "REDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave().facility.designDraft?.modules["left"]?.rotation).toBe(90);

    expect(process(core, command(10, "UNDO_DESIGN")).accepted).toBe(true);
    process(core, {
      commandId: commandId(11),
      source: "player",
      kind: "REMOVE_MODULE",
      moduleInstanceId: "left",
    });
    expect(process(core, command(12, "UNDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave().facility.designDraft?.modules["left"]?.id).toBe("left");
    expect(process(core, command(13, "REDO_DESIGN")).accepted).toBe(true);
    expect(core.getStateForSave().facility.designDraft?.modules["left"]).toBeUndefined();

    const routing = createCore(connectedFixture);
    process(routing, command(20, "ENTER_DESIGN_MODE"));
    process(routing, connect(21));
    expect(process(routing, command(22, "UNDO_DESIGN")).accepted).toBe(true);
    expect(routing.getStateForSave().facility.designDraft?.routes).toEqual({});
    expect(process(routing, command(23, "REDO_DESIGN")).accepted).toBe(true);
    process(routing, {
      commandId: commandId(24),
      source: "player",
      kind: "DISCONNECT_ROUTE",
      routeId: "route-00000001",
    });
    expect(process(routing, command(25, "UNDO_DESIGN")).accepted).toBe(true);
    expect(
      routing.getStateForSave().facility.designDraft?.routes["route-00000001"]?.capacityPerSecond,
    ).toBe(60_000);
    expect(
      routing.getStateForSave().facility.designDraft?.routes["route-00000001"]?.congestionRatio,
    ).toBe(0);
    expect(process(routing, command(26, "REDO_DESIGN")).accepted).toBe(true);
    expect(routing.getStateForSave().facility.designDraft?.routes).toEqual({});
  });

  test("uses LIFO history, clears redo after a new edit, and preserves live state", () => {
    const core = createCore();
    const live = structuredClone(core.getStateForSave().facility.modules);
    process(core, command(1, "ENTER_DESIGN_MODE"));
    process(core, {
      commandId: commandId(2),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    process(core, {
      commandId: commandId(3),
      source: "player",
      kind: "MOVE_MODULE",
      moduleInstanceId: "module-instance-00000001",
      position: { x: 1, y: 0 },
    });
    process(core, command(4, "UNDO_DESIGN"));
    expect(
      core.getStateForSave().facility.designDraft?.modules["module-instance-00000001"]?.position,
    ).toEqual({ x: 0, y: 0 });
    process(core, command(5, "UNDO_DESIGN"));
    expect(core.getStateForSave().facility.designDraft?.modules).toEqual({});
    process(core, command(6, "REDO_DESIGN"));
    process(core, {
      commandId: commandId(7),
      source: "player",
      kind: "MOVE_MODULE",
      moduleInstanceId: "module-instance-00000001",
      position: { x: 1, y: 0 },
    });
    const state = core.getStateForSave();
    expect(state.facility.designDraft?.redoStack).toEqual([]);
    expect(state.facility.modules).toEqual(live);
  });

  test("detaches caller-owned command and history payload data from all non-draft authority", () => {
    const core = createCore(connectedFixture);
    const before = core.getStateForSave();
    process(core, command(1, "ENTER_DESIGN_MODE"));
    const placement: Extract<SimCommand, { kind: "PLACE_MODULE" }> = {
      commandId: commandId(2),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 4 },
      rotation: 0,
    };
    process(core, placement);
    placement.position.x = 22;
    const detachedSnapshot = core.getStateForSave();
    const draft = detachedSnapshot.facility.designDraft;
    if (draft === null) throw new Error("Expected draft.");
    const stored = draft.undoStack.at(-1);
    if (stored?.kind !== "place") throw new Error("Expected place history operation.");
    const storedModule = stored.payload["module"];
    if (storedModule === null || typeof storedModule !== "object" || Array.isArray(storedModule)) {
      throw new Error("Expected stored module payload.");
    }
    (storedModule as { position: { x: number } }).position.x = 22;

    const unchanged = core.getStateForSave();
    expect(unchanged.facility.designDraft?.modules["module-instance-00000001"]?.position).toEqual({
      x: 0,
      y: 4,
    });
    expect(unchanged.facility.modules).toEqual(before.facility.modules);
    expect(unchanged.inventory).toEqual(before.inventory);
    expect(unchanged.economy).toEqual(before.economy);
    expect(unchanged.rngState).toBe(before.rngState);
    expect(unchanged.clock).toEqual(before.clock);
    expect(unchanged.tasks).toEqual(before.tasks);
    expect(unchanged.research).toEqual(before.research);
  });

  test("treats malformed history and current-state mismatch as fatal without committing", () => {
    const core = createCore();
    process(core, command(1, "ENTER_DESIGN_MODE"));
    const malformed = core.getStateForSave();
    if (malformed.facility.designDraft === null) throw new Error("Expected draft.");
    malformed.facility.designDraft.undoStack.push({
      operationId: "malformed",
      kind: "place",
      payload: {},
    });
    const malformedCore = new SimCore({
      initialState: malformed,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });
    expect(() => process(malformedCore, command(2, "UNDO_DESIGN"))).toThrow(
      SimulatorInvariantError,
    );

    const mismatch = createCore();
    process(mismatch, command(3, "ENTER_DESIGN_MODE"));
    process(mismatch, {
      commandId: commandId(4),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: RELAY,
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    const mismatchedState = mismatch.getStateForSave();
    if (mismatchedState.facility.designDraft === null) throw new Error("Expected draft.");
    const mismatchedModule =
      mismatchedState.facility.designDraft.modules["module-instance-00000001"];
    if (mismatchedModule === undefined) throw new Error("Expected placed draft module.");
    mismatchedModule.position.x = 1;
    const mismatchCore = new SimCore({
      initialState: mismatchedState,
      commandHandlers: createDesignModeCommandHandlers(loadContentBundle()),
    });
    expect(() => process(mismatchCore, command(5, "UNDO_DESIGN"))).toThrow(SimulatorInvariantError);
  });

  test("retains FIFO, expected-tick, canonical serialization, and rejection atomicity", () => {
    const core = createCore();
    const before = canonicalSerialize(core.getStateForSave());
    core.enqueue({
      commandId: commandId(1),
      source: "player",
      kind: "UNDO_DESIGN",
      expectedTick: 1,
    });
    core.enqueue(command(2, "ENTER_DESIGN_MODE"));
    expect(core.processPendingCommands()).toMatchObject([
      { accepted: false, code: "STALE_TICK" },
      { accepted: true },
    ]);
    expect(canonicalSerialize(core.getStateForSave())).not.toBe(before);
    expect(() => canonicalSerialize(core.getStateForSave())).not.toThrow();
  });
});
