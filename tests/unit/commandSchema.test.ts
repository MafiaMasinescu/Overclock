import { describe, expect, test } from "vitest";

import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { parseSimCommand } from "../../src/sim/commands/commandSchema.ts";

const COMMAND_ID = "00000000-0000-4000-8000-000000000001";
const meta = { commandId: COMMAND_ID, source: "player" } as const;

const commandByKind = {
  SET_PAUSED: { ...meta, kind: "SET_PAUSED", paused: true },
  SET_SPEED: { ...meta, kind: "SET_SPEED", speed: 2 },
  ENTER_DESIGN_MODE: { ...meta, kind: "ENTER_DESIGN_MODE" },
  BUY_MODULE: { ...meta, kind: "BUY_MODULE", definitionId: "module-a", quantity: 1 },
  SELL_INVENTORY_ITEM: {
    ...meta,
    kind: "SELL_INVENTORY_ITEM",
    definitionId: "module-a",
    quantity: 1,
  },
  PLACE_MODULE: {
    ...meta,
    kind: "PLACE_MODULE",
    definitionId: "module-a",
    position: { x: -1, y: 2 },
    rotation: 90,
  },
  MOVE_MODULE: {
    ...meta,
    kind: "MOVE_MODULE",
    moduleInstanceId: "module-instance-a",
    position: { x: 3, y: 4 },
  },
  ROTATE_MODULE: {
    ...meta,
    kind: "ROTATE_MODULE",
    moduleInstanceId: "module-instance-a",
    rotation: 180,
  },
  REMOVE_MODULE: {
    ...meta,
    kind: "REMOVE_MODULE",
    moduleInstanceId: "module-instance-a",
  },
  CONNECT_PORTS: {
    ...meta,
    kind: "CONNECT_PORTS",
    from: { moduleInstanceId: "module-instance-a", portId: "out" },
    to: { moduleInstanceId: "module-instance-b", portId: "in" },
    path: [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
  },
  DISCONNECT_ROUTE: { ...meta, kind: "DISCONNECT_ROUTE", routeId: "route-a" },
  UNDO_DESIGN: { ...meta, kind: "UNDO_DESIGN" },
  REDO_DESIGN: { ...meta, kind: "REDO_DESIGN" },
  APPLY_DESIGN: {
    ...meta,
    kind: "APPLY_DESIGN",
    expectedDraftRevision: 3,
    acceptedCostUsd: 12.5,
    acceptedDowntimeTicks: 4,
  },
  CANCEL_DESIGN: { ...meta, kind: "CANCEL_DESIGN" },
  ACCEPT_TASK: { ...meta, kind: "ACCEPT_TASK", definitionId: "task-a" },
  ALLOCATE_TASK: {
    ...meta,
    kind: "ALLOCATE_TASK",
    taskInstanceId: "task-instance-a",
    clusterModuleIds: ["module-instance-a", "module-instance-b"],
    requestedShare: 0.5,
  },
  SET_TASK_HOLD: {
    ...meta,
    kind: "SET_TASK_HOLD",
    taskInstanceId: "task-instance-a",
    hold: true,
  },
  ABANDON_TASK: {
    ...meta,
    kind: "ABANDON_TASK",
    taskInstanceId: "task-instance-a",
  },
  SET_OVERCLOCK_PROFILE: {
    ...meta,
    kind: "SET_OVERCLOCK_PROFILE",
    moduleInstanceIds: ["module-instance-a"],
    profile: "boost",
  },
  SET_MANUAL_OVERCLOCK: {
    ...meta,
    kind: "SET_MANUAL_OVERCLOCK",
    moduleInstanceIds: ["module-instance-a"],
    frequencyRatio: 1.25,
    voltageRatio: 1.1,
  },
  START_RESEARCH: {
    ...meta,
    kind: "START_RESEARCH",
    nodeId: "research-a",
    reservedComputeShare: 0.25,
  },
  CANCEL_RESEARCH: { ...meta, kind: "CANCEL_RESEARCH", nodeId: "research-a" },
  SAVE_BLUEPRINT: {
    ...meta,
    kind: "SAVE_BLUEPRINT",
    name: "Blueprint A",
    selectedModuleIds: ["module-instance-a"],
  },
  INSTANTIATE_BLUEPRINT: {
    ...meta,
    kind: "INSTANTIATE_BLUEPRINT",
    blueprintId: "blueprint-a",
    position: { x: 2, y: 3 },
    rotation: 270,
  },
  RENAME_BLUEPRINT: {
    ...meta,
    kind: "RENAME_BLUEPRINT",
    blueprintId: "blueprint-a",
    name: "Renamed Blueprint",
  },
  START_BENCHMARK: {
    ...meta,
    kind: "START_BENCHMARK",
    benchmarkId: "benchmark-a",
    clusterModuleIds: ["module-instance-a"],
  },
  CANCEL_BENCHMARK: { ...meta, kind: "CANCEL_BENCHMARK" },
  ACKNOWLEDGE_TUTORIAL_STEP: {
    ...meta,
    kind: "ACKNOWLEDGE_TUTORIAL_STEP",
    stepId: "step-a",
  },
  SET_GUIDANCE_MODE: { ...meta, kind: "SET_GUIDANCE_MODE", mode: "engineering" },
  TRIGGER_DIAGNOSTIC_PULSE: {
    ...meta,
    kind: "TRIGGER_DIAGNOSTIC_PULSE",
    moduleInstanceId: null,
  },
  DEBUG_ADD_CASH: { ...meta, kind: "DEBUG_ADD_CASH", amountUsd: -1.5 },
  DEBUG_ADD_RESEARCH_DATA: { ...meta, kind: "DEBUG_ADD_RESEARCH_DATA", amount: 2.5 },
} satisfies { [Kind in SimCommand["kind"]]: Extract<SimCommand, { kind: Kind }> };

describe("runtime SimCommand validation", () => {
  test("has strict runtime schema coverage for every existing command variant", () => {
    for (const command of Object.values(commandByKind)) {
      expect(parseSimCommand(command)).toEqual(command);
    }
  });

  test("returns fresh plain JSON-compatible command data", () => {
    const command = commandByKind.CONNECT_PORTS;
    const parsed = parseSimCommand(command);

    expect(parsed).toEqual(command);
    expect(parsed).not.toBe(command);
    if (parsed.kind !== "CONNECT_PORTS") {
      throw new Error("Expected CONNECT_PORTS fixture");
    }
    expect(parsed.from).not.toBe(command.from);
    expect(parsed.path).not.toBe(command.path);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  test.each([
    ["invalid UUID", { ...commandByKind.SET_PAUSED, commandId: "not-a-uuid" }],
    ["missing command ID", { source: "player", kind: "SET_PAUSED", paused: true }],
    ["unknown kind", { ...meta, kind: "UNKNOWN_COMMAND" }],
    ["unknown source", { ...commandByKind.SET_PAUSED, source: "network" }],
    ["negative expected tick", { ...commandByKind.SET_PAUSED, expectedTick: -1 }],
    [
      "unsafe expected tick",
      { ...commandByKind.SET_PAUSED, expectedTick: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["non-integer coordinate", { ...commandByKind.PLACE_MODULE, position: { x: 1.5, y: 2 } }],
    ["non-integer quantity", { ...commandByKind.BUY_MODULE, quantity: 1.5 }],
    ["unsupported rotation", { ...commandByKind.PLACE_MODULE, rotation: 45 }],
    ["unsupported speed", { ...commandByKind.SET_SPEED, speed: 3 }],
    ["non-finite number", { ...commandByKind.DEBUG_ADD_CASH, amountUsd: Number.NaN }],
    ["unknown property", { ...commandByKind.SET_PAUSED, extra: true }],
    ["malformed payload", { ...meta, kind: "SET_PAUSED", paused: "yes" }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseSimCommand(input)).toThrow();
  });

  test("rejects sparse arrays", () => {
    const clusterModuleIds = new Array<string>(2);
    clusterModuleIds[1] = "module-instance-b";

    expect(() => parseSimCommand({ ...commandByKind.ALLOCATE_TASK, clusterModuleIds })).toThrow();
  });

  test("rejects accessors and class instances", () => {
    const accessorCommand = { ...commandByKind.SET_PAUSED };
    Object.defineProperty(accessorCommand, "paused", {
      enumerable: true,
      get: () => true,
    });

    class CommandEnvelope {
      readonly commandId = COMMAND_ID;
      readonly source = "player";
      readonly kind = "SET_PAUSED";
      readonly paused = true;
    }

    expect(() => parseSimCommand(accessorCommand)).toThrow();
    expect(() => parseSimCommand(new CommandEnvelope())).toThrow();
  });
});
