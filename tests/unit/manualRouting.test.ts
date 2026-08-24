import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { validateRouteState } from "../../src/sim/routing/manualRouting.ts";

const RELAY = "module-data-relay";

function commandId(sequence: number): string {
  return `53000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function relay(id: string, x: number, y = 0): ModuleInstanceState {
  return module(id, RELAY, x, y);
}

function module(id: string, definitionId: string, x: number, y = 0): ModuleInstanceState {
  return {
    id,
    definitionId,
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
  const initialState = createInitialGameState({ content, seed: "task-5-3-routing" });
  editState?.(initialState);
  return new SimCore({ initialState, commandHandlers: createDesignModeCommandHandlers(content) });
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result === undefined) {
    throw new Error("Expected exactly one command result.");
  }
  return result;
}

function enter(sequence: number): Extract<SimCommand, { kind: "ENTER_DESIGN_MODE" }> {
  return { commandId: commandId(sequence), source: "player", kind: "ENTER_DESIGN_MODE" };
}

function connect(
  sequence: number,
  from = { moduleInstanceId: "left", portId: "data-east" },
  to = { moduleInstanceId: "right", portId: "data-west" },
  path = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ],
): Extract<SimCommand, { kind: "CONNECT_PORTS" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "CONNECT_PORTS",
    from,
    to,
    path,
  };
}

function disconnect(
  sequence: number,
  routeId: string,
): Extract<SimCommand, { kind: "DISCONNECT_ROUTE" }> {
  return { commandId: commandId(sequence), source: "player", kind: "DISCONNECT_ROUTE", routeId };
}

function twoRelays(state: GameState): void {
  const left = relay("left", 0);
  const right = relay("right", 3);
  state.facility.modules = { [left.id]: left, [right.id]: right };
}

function activeDraft(core: SimCore) {
  const draft = core.getStateForSave().facility.designDraft;
  if (draft === null) {
    throw new Error("Expected active Design Mode draft.");
  }
  return draft;
}

describe("manual routing", () => {
  test("registers CONNECT_PORTS and creates a detached canonical draft route", () => {
    const core = createCore(twoRelays);
    const liveBefore = structuredClone(core.getStateForSave().facility);
    process(core, enter(1));

    expect(process(core, connect(2))).toMatchObject({ accepted: true });
    const state = core.getStateForSave();
    const draft = state.facility.designDraft;
    expect(draft?.routes["route-00000001"]).toEqual({
      id: "route-00000001",
      kind: "data",
      from: { moduleInstanceId: "left", portId: "data-east" },
      to: { moduleInstanceId: "right", portId: "data-west" },
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      capacityPerSecond: 60_000,
      congestionRatio: 0,
    });
    expect(draft?.revision).toBe(1);
    expect(state.facility.nextRouteSequence).toBe(2);
    expect(draft?.undoStack).toEqual([
      {
        operationId: `design-operation-1-${commandId(2)}`,
        kind: "connect",
        payload: { route: draft?.routes["route-00000001"] },
      },
    ]);
    expect(state.facility.routes).toEqual(liveBefore.routes);
    expect(state.facility.modules).toEqual(liveBefore.modules);
  });

  test("normalizes bidirectional endpoints and reverses the submitted path", () => {
    const core = createCore((state) => {
      const submittedFrom = relay("z-module", 0);
      const submittedTo = relay("a-module", 3);
      state.facility.modules = {
        [submittedFrom.id]: submittedFrom,
        [submittedTo.id]: submittedTo,
      };
    });
    process(core, enter(3));

    expect(
      process(
        core,
        connect(
          4,
          { moduleInstanceId: "z-module", portId: "data-east" },
          { moduleInstanceId: "a-module", portId: "data-west" },
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: true });

    expect(core.getStateForSave().facility.designDraft?.routes["route-00000001"]?.from).toEqual({
      moduleInstanceId: "a-module",
      portId: "data-west",
    });
    expect(core.getStateForSave().facility.designDraft?.routes["route-00000001"]?.path).toEqual([
      { x: 3, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  test("rejects invalid manual paths atomically with stable reasons", () => {
    const core = createCore(twoRelays);
    process(core, enter(5));
    const before = core.getStateForSave();

    expect(process(core, connect(6, undefined, undefined, [{ x: 0, y: 0 }]))).toMatchObject({
      accepted: false,
      code: "INVALID_ROUTE",
      parameters: { reason: "PATH_TOO_SHORT" },
    });
    expect(
      process(
        core,
        connect(7, undefined, undefined, [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ]),
      ),
    ).toMatchObject({
      accepted: false,
      code: "INVALID_ROUTE",
      parameters: { reason: "NON_ORTHOGONAL_SEGMENT" },
    });
    expect(core.getStateForSave()).toEqual(before);
    expect(hashCanonicalState(core.getStateForSave())).toBe(hashCanonicalState(before));
  });

  test("rejects duplicate normalized endpoint pairs without consuming a route sequence", () => {
    const core = createCore(twoRelays);
    process(core, enter(8));
    process(core, connect(9));
    const before = core.getStateForSave();

    expect(
      process(
        core,
        connect(
          10,
          { moduleInstanceId: "right", portId: "data-west" },
          { moduleInstanceId: "left", portId: "data-east" },
          [
            { x: 3, y: 0 },
            { x: 2, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 0 },
          ],
        ),
      ),
    ).toMatchObject({
      accepted: false,
      code: "INVALID_ROUTE",
      parameters: { reason: "DUPLICATE_ENDPOINT_PAIR" },
    });
    expect(core.getStateForSave()).toEqual(before);
  });

  test("disconnects exactly one route and keeps its ID sequence consumed", () => {
    const core = createCore(twoRelays);
    process(core, enter(11));
    process(core, connect(12));
    const beforeLive = structuredClone(core.getStateForSave().facility.routes);

    expect(process(core, disconnect(13, "route-00000001"))).toMatchObject({ accepted: true });
    const state = core.getStateForSave();
    expect(state.facility.designDraft?.routes).toEqual({});
    expect(state.facility.nextRouteSequence).toBe(2);
    expect(state.facility.designDraft?.undoStack.at(-1)).toEqual({
      operationId: `design-operation-2-${commandId(13)}`,
      kind: "disconnect",
      payload: {
        route: {
          id: "route-00000001",
          kind: "data",
          from: { moduleInstanceId: "left", portId: "data-east" },
          to: { moduleInstanceId: "right", portId: "data-west" },
          path: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
          ],
          capacityPerSecond: 60_000,
          congestionRatio: 0,
        },
      },
    });
    expect(state.facility.routes).toEqual(beforeLive);
  });

  test("does not restore a consumed route sequence after cancel", () => {
    const core = createCore(twoRelays);
    process(core, enter(14));
    process(core, connect(15));
    expect(
      process(core, {
        commandId: commandId(16),
        source: "player",
        kind: "CANCEL_DESIGN",
      }),
    ).toMatchObject({ accepted: true });
    process(core, enter(17));
    expect(process(core, connect(18))).toMatchObject({ accepted: true });
    expect(activeDraft(core).routes).toHaveProperty("route-00000002");
    expect(core.getStateForSave().facility.nextRouteSequence).toBe(3);
  });

  test("keeps APPLY_DESIGN unavailable and gates undo and redo on Design Mode", () => {
    const core = createCore();
    for (const command of [
      { commandId: commandId(20), source: "player", kind: "UNDO_DESIGN" },
      { commandId: commandId(21), source: "player", kind: "REDO_DESIGN" },
    ] as const satisfies readonly SimCommand[]) {
      expect(process(core, command)).toMatchObject({
        accepted: false,
        code: "NOT_IN_DESIGN_MODE",
      });
    }
    expect(
      process(core, {
        commandId: commandId(22),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: 0,
        acceptedCostUsd: 0,
        acceptedDowntimeTicks: 0,
      }),
    ).toMatchObject({ accepted: false, code: "COMMAND_NOT_AVAILABLE" });
  });

  test("rejects both routing commands outside Design Mode", () => {
    const core = createCore(twoRelays);
    const before = core.getStateForSave();

    expect(process(core, connect(30))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
    });
    expect(process(core, disconnect(31, "route-00000001"))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
    });
    expect(core.getStateForSave()).toEqual(before);
  });

  test.each([
    [
      "missing from module",
      { moduleInstanceId: "missing", portId: "data-east" },
      { moduleInstanceId: "right", portId: "data-west" },
    ],
    [
      "missing to module",
      { moduleInstanceId: "left", portId: "data-east" },
      { moduleInstanceId: "missing", portId: "data-west" },
    ],
    [
      "missing from port",
      { moduleInstanceId: "left", portId: "missing" },
      { moduleInstanceId: "right", portId: "data-west" },
    ],
    [
      "missing to port",
      { moduleInstanceId: "left", portId: "data-east" },
      { moduleInstanceId: "right", portId: "missing" },
    ],
  ] as const)("rejects %s", (_label, from, to) => {
    const core = createCore(twoRelays);
    process(core, enter(32));

    expect(process(core, connect(33, from, to))).toMatchObject({
      accepted: false,
      code: "INVALID_PORT",
    });
  });

  test("rejects same-module, airflow, and incompatible endpoints", () => {
    const same = createCore((state) => {
      const instance = relay("same", 3);
      state.facility.modules = { same: instance };
    });
    process(same, enter(34));
    expect(
      process(
        same,
        connect(
          35,
          { moduleInstanceId: "same", portId: "data-west" },
          { moduleInstanceId: "same", portId: "data-east" },
          [
            { x: 3, y: 0 },
            { x: 4, y: 0 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: false, code: "INVALID_PORT" });

    const airflow = createCore((state) => {
      state.facility.modules = {
        air: module("air", "module-air-mover", 0),
        relay: relay("relay", 3),
      };
    });
    process(airflow, enter(36));
    expect(
      process(
        airflow,
        connect(
          37,
          { moduleInstanceId: "air", portId: "airflow-east" },
          { moduleInstanceId: "relay", portId: "data-west" },
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: false, code: "INVALID_PORT" });

    const incompatible = createCore((state) => {
      state.facility.modules = {
        source: module("source", "module-power-distribution", 0),
        relay: relay("relay", 4),
      };
    });
    process(incompatible, enter(38));
    expect(
      process(
        incompatible,
        connect(
          39,
          { moduleInstanceId: "source", portId: "power-out-east" },
          { moduleInstanceId: "relay", portId: "data-west" },
          [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: false, code: "INCOMPATIBLE_PORTS" });
  });

  test("accepts direct paths and validates path failures in the approved order", () => {
    const direct = createCore((state) => {
      state.facility.modules = { left: relay("left", 0), right: relay("right", 1) };
    });
    process(direct, enter(40));
    expect(
      process(
        direct,
        connect(41, undefined, undefined, [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ]),
      ),
    ).toMatchObject({ accepted: true });
    const core = createCore(twoRelays);
    process(core, enter(43));
    const cases: readonly (readonly [number, readonly { x: number; y: number }[], string])[] = [
      [
        44,
        [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        "PATH_ENDPOINT_MISMATCH",
      ],
      [
        45,
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
        "PATH_ENDPOINT_MISMATCH",
      ],
      [
        46,
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
        "NON_ORTHOGONAL_SEGMENT",
      ],
      [
        47,
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
        "REPEATED_PATH_TILE",
      ],
    ];
    for (const [sequence, path, reason] of cases) {
      expect(process(core, connect(sequence, undefined, undefined, [...path]))).toMatchObject({
        accepted: false,
        code: "INVALID_ROUTE",
        parameters: { reason },
      });
    }
    const tooLong = Array.from({ length: 24 * 16 + 1 }, (_, index) => ({ x: index, y: 0 }));
    expect(process(core, connect(48, undefined, undefined, tooLong))).toMatchObject({
      accepted: false,
      code: "INVALID_ROUTE",
      parameters: { reason: "PATH_TOO_LONG" },
    });
    expect(
      process(
        core,
        connect(49, undefined, undefined, [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 24, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ]),
      ),
    ).toMatchObject({
      accepted: false,
      code: "OUT_OF_BOUNDS",
    });
  });

  test("allows crossings, shared tiles and multiple routes on a port without capacity reservation", () => {
    const core = createCore((state) => {
      state.facility.modules = {
        power: module("power", "module-power-distribution", 0, 0),
        "power-target": relay("power-target", 4, 0),
        "data-left": relay("data-left", 0, 3),
        "data-right": relay("data-right", 4, 3),
        "shared-target": relay("shared-target", 4, 5),
      };
    });
    process(core, enter(50));
    expect(
      process(
        core,
        connect(
          51,
          { moduleInstanceId: "power", portId: "power-out-east" },
          { moduleInstanceId: "power-target", portId: "power-in-south" },
          [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
            { x: 4, y: 1 },
            { x: 4, y: 0 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: true });
    expect(activeDraft(core).routes["route-00000001"]).toMatchObject({
      kind: "power",
      capacityPerSecond: 350,
      congestionRatio: 0,
    });
    expect(
      process(
        core,
        connect(
          52,
          { moduleInstanceId: "data-left", portId: "data-east" },
          { moduleInstanceId: "data-right", portId: "data-west" },
          [
            { x: 0, y: 3 },
            { x: 1, y: 3 },
            { x: 2, y: 3 },
            { x: 2, y: 2 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 2 },
            { x: 3, y: 3 },
            { x: 4, y: 3 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: true });
    expect(
      process(
        core,
        connect(
          53,
          { moduleInstanceId: "data-left", portId: "data-east" },
          { moduleInstanceId: "shared-target", portId: "data-west" },
          [
            { x: 0, y: 3 },
            { x: 1, y: 3 },
            { x: 1, y: 4 },
            { x: 2, y: 4 },
            { x: 3, y: 4 },
            { x: 3, y: 5 },
            { x: 4, y: 5 },
          ],
        ),
      ),
    ).toMatchObject({ accepted: true });
    expect(activeDraft(core).routes).toHaveProperty("route-00000003");
  });

  test("handles route ID and revision boundaries atomically", () => {
    const collision = createCore((state) => {
      const left = relay("left", 0);
      const right = relay("right", 3);
      const otherLeft = relay("other-left", 0, 2);
      const otherRight = relay("other-right", 3, 2);
      state.facility.modules = { left, right, "other-left": otherLeft, "other-right": otherRight };
      state.facility.nextRouteSequence = 1;
      state.facility.routes["route-00000001"] = {
        id: "route-00000001",
        kind: "data",
        from: { moduleInstanceId: "other-left", portId: "data-east" },
        to: { moduleInstanceId: "other-right", portId: "data-west" },
        path: [
          { x: 0, y: 2 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
          { x: 3, y: 2 },
        ],
        capacityPerSecond: 60_000,
        congestionRatio: 0,
      };
    });
    process(collision, enter(53));
    const beforeCollision = collision.getStateForSave();
    expect(process(collision, connect(54))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
    expect(collision.getStateForSave()).toEqual(beforeCollision);

    const overflow = createCore((state) => {
      twoRelays(state);
      state.facility.nextRouteSequence = Number.MAX_SAFE_INTEGER;
    });
    process(overflow, enter(55));
    expect(process(overflow, connect(56))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
    const revision = createCore((state) => {
      twoRelays(state);
      state.facility.designDraft = {
        revision: Number.MAX_SAFE_INTEGER,
        modules: structuredClone(state.facility.modules),
        routes: {},
        undoStack: [],
        redoStack: [],
      };
    });
    expect(process(revision, connect(58))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
  });

  test("validates route-state records and validates live routes before cloning", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "route-validator" });
    twoRelays(state);
    const route: RouteState = {
      id: "route-live",
      kind: "data",
      from: { moduleInstanceId: "left", portId: "data-east" },
      to: { moduleInstanceId: "right", portId: "data-west" },
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      capacityPerSecond: 60_000,
      congestionRatio: 0,
    };
    state.facility.routes = { wrong: route };
    expect(validateRouteState(state.facility, content)).toContainEqual(
      expect.objectContaining({ reason: "ROUTE_RECORD_KEY_MISMATCH" }),
    );
    state.facility.routes = {
      [route.id]: { ...route, capacityPerSecond: 0, congestionRatio: 2 },
    };
    expect(validateRouteState(state.facility, content)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "INVALID_ROUTE_CAPACITY" }),
        expect.objectContaining({ reason: "INVALID_CONGESTION_RATIO" }),
      ]),
    );
    state.facility.routes = { wrong: route };
    const core = new SimCore({
      initialState: state,
      commandHandlers: createDesignModeCommandHandlers(content),
    });
    expect(() => process(core, enter(59))).toThrow("Simulator invariant violation");
  });
});
