import { describe, expect, test } from "vitest";

import { createFakeGameClient } from "../../src/app/game-client/fakeGameClient.ts";

describe("fake GameClient", () => {
  test("exposes immutable typed placeholder snapshots without grid entities", () => {
    const client = createFakeGameClient();
    const snapshot = client.getSnapshot();
    const grid = client.getGridViewModel();

    expect(snapshot.header.year).toBe(1946);
    expect(snapshot.tasks).toHaveLength(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.header)).toBe(true);
    expect(grid.gridSize).toEqual({ width: 24, height: 16 });
    expect(grid.modules).toEqual([]);
    expect(grid.routes).toEqual([]);
    expect(Object.isFrozen(grid)).toBe(true);
  });

  test("rejects dispatched gameplay commands because Phase 0 has no simulator", async () => {
    const client = createFakeGameClient();

    await expect(
      client.dispatch({
        commandId: "phase-0-command",
        source: "player",
        kind: "SET_PAUSED",
        paused: true,
      }),
    ).resolves.toEqual({
      commandId: "phase-0-command",
      accepted: false,
      rejectedAtTick: 0,
      code: "COMMAND_NOT_AVAILABLE",
      messageKey: "errors.phase-zero-no-simulator",
    });
  });
});
