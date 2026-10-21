import { describe, expect, it, vi } from "vitest";

import type {
  BuildQuery,
  BuildQueryResponse,
  GameClient,
} from "../../src/app/game-client/contracts.ts";
import { createBuildPlacementController } from "../../src/ui/workspaces/buildPlacementController.ts";

const source = {
  mode: "draft" as const,
  observedTick: 0,
  liveLayoutRevision: 0,
  draftRevision: 0,
  generation: 0,
};

function response(
  query: BuildQuery,
  options: {
    valid: boolean;
    requiresPurchase: boolean;
    generation?: number;
    draftRevision?: number;
  },
): BuildQueryResponse {
  const nextSource = {
    ...source,
    generation: options.generation ?? source.generation,
    draftRevision: options.draftRevision ?? source.draftRevision,
  };
  const data = {
    status: options.valid ? ("ready" as const) : ("rejected" as const),
    valid: options.valid,
    reason: options.valid ? null : ("TILE_OCCUPIED" as const),
    definitionId: "module-power-distribution",
    position: { x: 2, y: 2 },
    rotation: 0 as const,
    occupiedTiles: [{ x: 2, y: 2 }],
    attachedRouteIds: [],
    purchaseCostUsd: options.requiresPurchase ? 100 : 0,
    requiresPurchase: options.requiresPurchase,
  };
  if (options.valid) {
    return {
      settings: null,
      result: {
        kind: "placement",
        status: "ready",
        clientIntentSequence: query.clientIntentSequence,
        source: nextSource,
        data,
      },
    };
  }
  return {
    settings: null,
    result: {
      kind: "placement",
      status: "rejected",
      reason: "TILE_OCCUPIED",
      clientIntentSequence: query.clientIntentSequence,
      source: nextSource,
      data,
    },
  };
}

function createHarness(
  queryResult: (query: BuildQuery) => BuildQueryResponse,
  dispatchResult: (
    command: Parameters<GameClient["dispatchBuild"]>[0],
  ) => ReturnType<GameClient["dispatchBuild"]>,
) {
  let grid = { mode: "draft" as const, layoutRevision: 0 };
  const listeners = new Set<() => void>();
  const connectionListeners = new Set<() => void>();
  const client = {
    queryBuild: vi.fn((query: BuildQuery) => Promise.resolve(queryResult(query))),
    dispatchBuild: vi.fn(
      (command: Parameters<GameClient["dispatchBuild"]>[0], generation: number) => {
        void generation;
        return dispatchResult(command);
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
    publishLayoutRevision(revision: number) {
      grid = { ...grid, layoutRevision: revision };
      for (const listener of listeners) listener();
    },
    notifyConnection() {
      for (const listener of connectionListeners) listener();
    },
  };
}

const tool = {
  definitionId: "module-power-distribution",
  source: "catalog" as const,
  generation: 0,
  rotation: 0 as const,
  footprint: { width: 2, height: 2 },
};

describe("build placement controller", () => {
  it("does not place when the catalog purchase is rejected", async () => {
    const commands: string[] = [];
    const statuses: string[] = [];
    const harness = createHarness(
      (query) => response(query, { valid: true, requiresPurchase: true }),
      (command) => {
        commands.push(command.kind);
        return Promise.resolve({
          kind: "domain" as const,
          result: {
            commandId: command.commandId,
            accepted: false,
            rejectedAtTick: 0,
            code: "INSUFFICIENT_CASH" as const,
            messageKey: "errors.insufficient-cash",
          },
          source,
        });
      },
    );
    const controller = createBuildPlacementController(harness.client, {
      onStatus: (status) => statuses.push(status),
    });
    controller.setTool(tool);
    controller.hover({ x: 2, y: 2 });
    await vi.waitFor(() => {
      expect(harness.client.queryBuild).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(statuses).toContain("ready");
    });
    controller.confirm({ x: 2, y: 2 }, false);
    await vi.waitFor(() => {
      expect(commands).toEqual(["BUY_MODULE"]);
    });
    expect(commands).not.toContain("PLACE_MODULE");
    controller.dispose();
  });

  it("keeps the accepted placement ghost until the draft revision is published", async () => {
    const ghosts: unknown[] = [];
    const statuses: string[] = [];
    const harness = createHarness(
      (query) => response(query, { valid: true, requiresPurchase: false, draftRevision: 1 }),
      (command) =>
        Promise.resolve({
          kind: "domain" as const,
          result: {
            commandId: command.commandId,
            accepted: true,
            appliedAtTick: 0,
          },
          source: { ...source, draftRevision: 1 },
        }),
    );
    const controller = createBuildPlacementController(harness.client, {
      onGhost: (ghost) => {
        ghosts.push(ghost);
      },
      onStatus: (status) => {
        statuses.push(status);
      },
    });
    controller.setTool({ ...tool, source: "inventory" });
    controller.hover({ x: 2, y: 2 });
    await vi.waitFor(() => {
      expect(harness.client.queryBuild).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(statuses).toContain("ready");
    });
    controller.confirm({ x: 2, y: 2 }, false);
    await vi.waitFor(() => {
      expect(statuses).toContain("awaiting-publication");
    });
    expect(ghosts.at(-1)).not.toBeNull();
    harness.publishLayoutRevision(1);
    await vi.waitFor(() => {
      expect(ghosts.at(-1)).toBeNull();
    });
    controller.dispose();
  });
});
