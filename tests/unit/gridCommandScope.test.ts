import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";

const commands: readonly SimCommand[] = [
  {
    commandId: "51000000-0000-4000-8000-000000000001",
    source: "player",
    kind: "ENTER_DESIGN_MODE",
  },
  {
    commandId: "51000000-0000-4000-8000-000000000002",
    source: "player",
    kind: "PLACE_MODULE",
    definitionId: "module-data-relay",
    position: { x: 0, y: 0 },
    rotation: 0,
  },
  {
    commandId: "51000000-0000-4000-8000-000000000003",
    source: "player",
    kind: "MOVE_MODULE",
    moduleInstanceId: "module-instance",
    position: { x: 1, y: 1 },
  },
  {
    commandId: "51000000-0000-4000-8000-000000000004",
    source: "player",
    kind: "ROTATE_MODULE",
    moduleInstanceId: "module-instance",
    rotation: 90,
  },
  {
    commandId: "51000000-0000-4000-8000-000000000005",
    source: "player",
    kind: "REMOVE_MODULE",
    moduleInstanceId: "module-instance",
  },
  {
    commandId: "51000000-0000-4000-8000-000000000006",
    source: "player",
    kind: "CONNECT_PORTS",
    from: { moduleInstanceId: "module-a", portId: "data-out" },
    to: { moduleInstanceId: "module-b", portId: "data-in" },
    path: [],
  },
  {
    commandId: "51000000-0000-4000-8000-000000000007",
    source: "player",
    kind: "DISCONNECT_ROUTE",
    routeId: "route-a",
  },
  { commandId: "51000000-0000-4000-8000-000000000008", source: "player", kind: "UNDO_DESIGN" },
  { commandId: "51000000-0000-4000-8000-000000000009", source: "player", kind: "REDO_DESIGN" },
  {
    commandId: "51000000-0000-4000-8000-000000000010",
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: 0,
    acceptedCostUsd: 0,
    acceptedDowntimeTicks: 0,
  },
  { commandId: "51000000-0000-4000-8000-000000000011", source: "player", kind: "CANCEL_DESIGN" },
];

test("keeps every existing build command unavailable in Task 5.1", () => {
  const initialState = createInitialGameState({
    content: loadContentBundle(),
    seed: "task-5-1-command-scope",
  });
  const core = new SimCore({ initialState });
  const before = canonicalSerialize(core.getStateForSave());

  for (const command of commands) {
    core.enqueue(command);
  }
  const results = core.processPendingCommands();

  expect(results).toHaveLength(commands.length);
  expect(results.map((result) => result.accepted)).toEqual(commands.map(() => false));
  expect(results.map((result) => (result.accepted ? null : result.code))).toEqual(
    commands.map(() => "COMMAND_NOT_AVAILABLE"),
  );
  expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  expect(core.getStateForSave().rngState).toBe(initialState.rngState);
});
