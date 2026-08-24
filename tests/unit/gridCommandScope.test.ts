import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";

const commands: readonly SimCommand[] = [
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
];

test("keeps routing and deferred build commands unavailable without a production registry", () => {
  const initialState = createInitialGameState({
    content: loadContentBundle(),
    seed: "task-5-2-command-scope",
  });
  const core = new SimCore({ initialState });
  const before = canonicalSerialize(core.getStateForSave());

  for (const command of commands) {
    core.enqueue(command);
  }
  const results = core.processPendingCommands();

  expect(results).toHaveLength(5);
  expect(results.map((result) => result.accepted)).toEqual([false, false, false, false, false]);
  expect(results.map((result) => (result.accepted ? null : result.code))).toEqual([
    "COMMAND_NOT_AVAILABLE",
    "COMMAND_NOT_AVAILABLE",
    "COMMAND_NOT_AVAILABLE",
    "COMMAND_NOT_AVAILABLE",
    "COMMAND_NOT_AVAILABLE",
  ]);
  expect(canonicalSerialize(core.getStateForSave())).toBe(before);
  expect(core.getStateForSave().rngState).toBe(initialState.rngState);
});
