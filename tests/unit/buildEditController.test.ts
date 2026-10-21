import { describe, expect, it, vi } from "vitest";

import type {
  BuildMoveTarget,
  BuildQuery,
  BuildQueryResponse,
  GameClient,
} from "../../src/app/game-client/contracts.ts";
import { createBuildEditController } from "../../src/ui/workspaces/buildEditController.ts";

const source = {
  mode: "draft" as const,
  observedTick: 0,
  liveLayoutRevision: 0,
  draftRevision: 1,
  generation: 4,
};

const target: BuildMoveTarget = {
  moduleInstanceId: "module-a",
  definitionId: "module-power-distribution",
  position: { x: 2, y: 2 },
  footprint: { width: 2, height: 1 },
  rotation: 0,
};

function moveResponse(query: BuildQuery, valid = true): BuildQueryResponse {
  return {
    settings: null,
    result: {
      kind: "move",
      status: valid ? "ready" : "rejected",
      ...(valid ? {} : { reason: "TILE_OCCUPIED" as const }),
      clientIntentSequence: query.clientIntentSequence,
      source,
      data: {
        status: valid ? "ready" : "rejected",
        valid,
        reason: valid ? null : "TILE_OCCUPIED",
        definitionId: target.definitionId,
        position: { x: 4, y: 3 },
        rotation: 0,
        occupiedTiles: [
          { x: 4, y: 3 },
          { x: 5, y: 3 },
        ],
        attachedRouteIds: ["route-a"],
        purchaseCostUsd: 0,
        requiresPurchase: false,
      },
    },
  };
}

function removalResponse(
  query: BuildQuery,
  moduleInstanceId: string,
  valid = true,
): BuildQueryResponse {
  return {
    settings: null,
    result: {
      kind: "removal",
      status: valid ? "ready" : "rejected",
      ...(valid ? {} : { reason: "INVALID_SYSTEM" as const }),
      clientIntentSequence: query.clientIntentSequence,
      source,
      data: {
        status: valid ? "ready" : "rejected",
        valid,
        reason: valid ? null : "INVALID_SYSTEM",
        moduleInstanceId,
        attachedRouteIds: [],
      },
    },
  };
}

function createHarness(
  queryBuild: (query: BuildQuery) => BuildQueryResponse,
  dispatchBuild: (
    command: Parameters<GameClient["dispatchBuild"]>[0],
  ) => ReturnType<GameClient["dispatchBuild"]>,
) {
  let grid = { mode: "draft" as const, layoutRevision: 0 };
  const listeners = new Set<() => void>();
  const connectionListeners = new Set<() => void>();
  const client = {
    queryBuild: vi.fn((query: BuildQuery) => Promise.resolve(queryBuild(query))),
    dispatchBuild: vi.fn(
      (command: Parameters<GameClient["dispatchBuild"]>[0], generation: number) => {
        void generation;
        return dispatchBuild(command);
      },
    ),
    getGridViewModel: vi.fn(() => grid as ReturnType<GameClient["getGridViewModel"]>),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getConnectionStatus: () => "live" as const,
    subscribeConnection(listener: () => void) {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
  } satisfies Pick<
    GameClient,
    | "queryBuild"
    | "dispatchBuild"
    | "getGridViewModel"
    | "subscribe"
    | "getConnectionStatus"
    | "subscribeConnection"
  >;
  return {
    client,
    publish(revision: number) {
      grid = { ...grid, layoutRevision: revision };
      for (const listener of listeners) listener();
    },
  };
}

describe("build edit controller", () => {
  it("previews a one-module move and waits for its publication", async () => {
    const commands: string[] = [];
    const ghosts: unknown[] = [];
    const harness = createHarness(
      (query) => moveResponse(query),
      (command) => {
        commands.push(command.kind);
        return Promise.resolve({
          kind: "domain" as const,
          result: { commandId: command.commandId, accepted: true, appliedAtTick: 0 },
          source: { ...source, draftRevision: 2 },
        });
      },
    );
    const controller = createBuildEditController(harness.client, {
      onGhost: (ghost) => {
        ghosts.push(ghost);
      },
    });
    controller.setMoveTarget(target);
    controller.hoverMove(target.moduleInstanceId, { x: 4, y: 3 });
    await vi.waitFor(() => {
      expect(ghosts.at(-1)).toMatchObject({ valid: true, pending: false });
    });
    controller.confirmMove(target.moduleInstanceId, { x: 4, y: 3 });
    await vi.waitFor(() => {
      expect(commands).toEqual(["MOVE_MODULE"]);
    });
    expect(ghosts.at(-1)).not.toBeNull();
    harness.publish(2);
    await vi.waitFor(() => {
      expect(ghosts.at(-1)).toBeNull();
    });
    controller.dispose();
  });

  it("removes stable ordered modules and stops on the first rejected preview", async () => {
    const commands: string[] = [];
    const notices: unknown[] = [];
    const harness = createHarness(
      (query) =>
        removalResponse(
          query,
          query.kind === "removal" ? query.moduleInstanceId : "unknown",
          query.kind === "removal" && query.moduleInstanceId === "a",
        ),
      (command) => {
        commands.push(command.kind);
        return Promise.resolve({
          kind: "domain" as const,
          result: { commandId: command.commandId, accepted: true, appliedAtTick: 0 },
          source,
        });
      },
    );
    const controller = createBuildEditController(harness.client, {
      onNotice: (notice) => notices.push(notice),
    });
    controller.removeModules(["b", "a"]);
    await vi.waitFor(() => {
      expect(notices.at(-1)).toMatchObject({ accepted: 1, failedId: "b" });
    });
    expect(commands).toEqual(["REMOVE_MODULE"]);
    controller.dispose();
  });
});
