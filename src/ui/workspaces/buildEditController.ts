import {
  createBuildPreviewCoordinator,
  type BuildPreviewCoordinator,
} from "../../app/game-client/buildPreviewCoordinator.ts";
import {
  createDisconnectRouteCommand,
  createMoveModuleCommand,
  createRedoDesignCommand,
  createRemoveModuleCommand,
  createRotateModuleCommand,
  createUndoDesignCommand,
} from "../../app/game-client/buildCommands.ts";
import type {
  BuildMoveTarget,
  BuildPlacementGhost,
  BuildPlacementStatus,
  BuildQuery,
  BuildQueryResponse,
  BuildQueryResult,
  BuildSourceStamp,
  GameClient,
  GridPoint,
  Rotation,
} from "../../app/game-client/contracts.ts";

type EditClient = Pick<
  GameClient,
  | "queryBuild"
  | "dispatchBuild"
  | "getGridViewModel"
  | "subscribe"
  | "getConnectionStatus"
  | "subscribeConnection"
>;

export interface BuildEditNotice {
  readonly kind: "remove" | "disconnect" | "history" | "operation";
  readonly accepted: number;
  readonly remaining: number;
  readonly failedId: string | null;
}

export interface BuildEditControllerCallbacks {
  readonly onGhost?: (ghost: BuildPlacementGhost | null) => void;
  readonly onStatus?: (status: BuildPlacementStatus) => void;
  readonly onNotice?: (notice: BuildEditNotice) => void;
  readonly onReset?: () => void;
}

export interface BuildEditController {
  setMoveTarget(target: BuildMoveTarget | null): void;
  hoverMove(moduleInstanceId: string, position: GridPoint): void;
  confirmMove(moduleInstanceId: string, position: GridPoint): void;
  rotateModule(moduleInstanceId: string, rotation: Rotation): void;
  removeModules(moduleInstanceIds: readonly string[]): void;
  disconnectRoutes(routeIds: readonly string[]): void;
  history(kind: "undo" | "redo"): void;
  cancel(): void;
  dispose(): void;
}

interface MoveOperation {
  readonly expectedDraftRevision: number;
}

type MoveQueryResult = Extract<BuildQueryResult, { kind: "move"; data: unknown }>;
type RemovalQueryResult = Extract<BuildQueryResult, { kind: "removal"; data: unknown }>;
type RotationQueryResult = Extract<BuildQueryResult, { kind: "rotate"; data: unknown }>;

function samePoint(left: GridPoint | null, right: GridPoint | null): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function sameMoveTarget(left: BuildMoveTarget | null, right: BuildMoveTarget | null): boolean {
  return (
    left?.moduleInstanceId === right?.moduleInstanceId &&
    left?.definitionId === right?.definitionId &&
    samePoint(left?.position ?? null, right?.position ?? null) &&
    left?.footprint.width === right?.footprint.width &&
    left?.footprint.height === right?.footprint.height &&
    left?.rotation === right?.rotation
  );
}

function moveResult(result: BuildQueryResult): MoveQueryResult | null {
  if (result.kind !== "move" || !("data" in result)) return null;
  return result;
}

function removalResult(result: BuildQueryResult): RemovalQueryResult | null {
  if (result.kind !== "removal" || !("data" in result)) return null;
  return result;
}

function rotationResult(result: BuildQueryResult): RotationQueryResult | null {
  if (result.kind !== "rotate" || !("data" in result)) return null;
  return result;
}

function isAccepted(outcome: Awaited<ReturnType<GameClient["dispatchBuild"]>>): boolean {
  return outcome.kind === "domain" && outcome.result.accepted;
}

function sourceRevision(source: BuildSourceStamp): number {
  return source.draftRevision ?? 0;
}

function rotated(rotation: Rotation, direction: "clockwise" | "counterclockwise"): Rotation {
  const values: readonly Rotation[] = [0, 90, 180, 270];
  const index = values.indexOf(rotation);
  return (
    values[(index + (direction === "clockwise" ? 1 : -1) + values.length) % values.length] ?? 0
  );
}

export function createBuildEditController(
  client: EditClient,
  callbacks: BuildEditControllerCallbacks = {},
): BuildEditController {
  let disposed = false;
  let target: BuildMoveTarget | null = null;
  let ghost: BuildPlacementGhost | null = null;
  let moveSource: BuildSourceStamp | null = null;
  let movePosition: GridPoint | null = null;
  let operation: MoveOperation | null = null;
  let intentSequence = 0;
  let previewSequence = 0;
  const isDisposed = (): boolean => disposed;
  const coordinator: BuildPreviewCoordinator = createBuildPreviewCoordinator(
    (query: BuildQuery): Promise<BuildQueryResponse> => client.queryBuild(query),
    {
      now: () => performance.now(),
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (handle) => {
        globalThis.clearTimeout(handle as number);
      },
    },
  );

  function emitGhost(next: BuildPlacementGhost | null): void {
    ghost = next;
    callbacks.onGhost?.(next);
  }

  function emitStatus(status: BuildPlacementStatus): void {
    callbacks.onStatus?.(status);
  }

  function clear(): void {
    coordinator.invalidate();
    previewSequence += 1;
    target = null;
    ghost = null;
    moveSource = null;
    movePosition = null;
    operation = null;
    emitGhost(null);
    emitStatus("idle");
  }

  async function requestMove(moduleInstanceId: string, position: GridPoint): Promise<void> {
    const activeTarget = target;
    if (isDisposed() || activeTarget?.moduleInstanceId !== moduleInstanceId || operation !== null)
      return;
    const requestSequence = ++previewSequence;
    movePosition = { ...position };
    emitGhost({
      definitionId: activeTarget.definitionId,
      position: { ...position },
      rotation: activeTarget.rotation,
      footprint: { ...activeTarget.footprint },
      occupiedTiles: [],
      attachedRouteIds: [],
      valid: null,
      reason: null,
      pending: true,
    });
    emitStatus("previewing");
    const result = await coordinator.request({
      kind: "move",
      mode: "draft",
      clientIntentSequence: ++intentSequence,
      moduleInstanceId,
      position: { ...position },
    });
    if (isDisposed() || requestSequence !== previewSequence) return;
    if (result === null) {
      moveSource = null;
      emitStatus("unknown");
      return;
    }
    const move = moveResult(result);
    if (move === null) {
      moveSource = null;
      emitStatus("unknown");
      return;
    }
    moveSource = move.source;
    emitGhost({
      definitionId: activeTarget.definitionId,
      position: { ...move.data.position },
      rotation: move.data.rotation,
      footprint: { ...activeTarget.footprint },
      occupiedTiles: move.data.occupiedTiles.map((tile) => ({ ...tile })),
      attachedRouteIds: move.data.attachedRouteIds.map((routeId) => routeId),
      valid: move.data.valid,
      reason: move.data.reason ?? move.reason ?? null,
      pending: false,
    });
    emitStatus(move.data.valid ? "ready" : "invalid");
  }

  async function confirmMove(moduleInstanceId: string, position: GridPoint): Promise<void> {
    const activeTarget = target;
    if (
      isDisposed() ||
      activeTarget?.moduleInstanceId !== moduleInstanceId ||
      operation !== null ||
      ghost === null ||
      ghost.pending ||
      !ghost.valid ||
      !samePoint(ghost.position, position) ||
      moveSource === null
    )
      return;
    emitStatus("placing");
    const outcome = await client.dispatchBuild(
      createMoveModuleCommand(moduleInstanceId, position),
      moveSource.generation,
    );
    if (isDisposed() || !isAccepted(outcome)) {
      emitStatus(outcome.kind === "domain" ? "rejected" : "unknown");
      return;
    }
    operation = { expectedDraftRevision: sourceRevision(outcome.source) };
    emitStatus("awaiting-publication");
    checkPublication();
  }

  function checkPublication(): void {
    if (isDisposed() || operation === null) return;
    const grid = client.getGridViewModel();
    if (grid.mode !== "draft" || grid.layoutRevision < operation.expectedDraftRevision) return;
    operation = null;
    clear();
    callbacks.onReset?.();
    callbacks.onNotice?.({ kind: "operation", accepted: 1, remaining: 0, failedId: null });
  }

  async function dispatchWithFreshGeneration(
    command: Parameters<GameClient["dispatchBuild"]>[0],
  ): Promise<Awaited<ReturnType<GameClient["dispatchBuild"]>> | null> {
    const context = await client.queryBuild({
      kind: "context",
      mode: "draft",
      clientIntentSequence: ++intentSequence,
    });
    if (context.result.kind !== "context" || context.result.status !== "ready") return null;
    return client.dispatchBuild(command, context.result.source.generation);
  }

  async function rotateModule(moduleInstanceId: string, rotation: Rotation): Promise<void> {
    if (isDisposed()) return;
    emitStatus("previewing");
    const result = await client.queryBuild({
      kind: "rotate",
      mode: "draft",
      clientIntentSequence: ++intentSequence,
      moduleInstanceId,
      rotation,
    });
    if (isDisposed()) return;
    const preview = rotationResult(result.result);
    if (preview?.data.valid !== true) {
      emitStatus(preview === null ? "unknown" : "invalid");
      return;
    }
    const outcome = await client.dispatchBuild(
      createRotateModuleCommand(moduleInstanceId, rotation),
      preview.source.generation,
    );
    if (isDisposed() || !isAccepted(outcome)) {
      emitStatus(outcome.kind === "domain" ? "rejected" : "unknown");
      return;
    }
    operation = { expectedDraftRevision: sourceRevision(outcome.source) };
    emitStatus("awaiting-publication");
    checkPublication();
  }

  async function removeModules(moduleInstanceIds: readonly string[]): Promise<void> {
    const ids = [...new Set(moduleInstanceIds)].toSorted();
    let accepted = 0;
    for (const moduleInstanceId of ids) {
      if (isDisposed()) return;
      const previewResponse = await client.queryBuild({
        kind: "removal",
        mode: "draft",
        clientIntentSequence: ++intentSequence,
        moduleInstanceId,
      });
      const preview = removalResult(previewResponse.result);
      if (preview?.data.valid !== true) {
        callbacks.onNotice?.({
          kind: "remove",
          accepted,
          remaining: ids.length - accepted,
          failedId: moduleInstanceId,
        });
        return;
      }
      const outcome = await client.dispatchBuild(
        createRemoveModuleCommand(moduleInstanceId),
        preview.source.generation,
      );
      if (isDisposed() || !isAccepted(outcome)) {
        callbacks.onNotice?.({
          kind: "remove",
          accepted,
          remaining: ids.length - accepted,
          failedId: moduleInstanceId,
        });
        return;
      }
      accepted += 1;
    }
    callbacks.onNotice?.({ kind: "remove", accepted, remaining: 0, failedId: null });
  }

  async function disconnectRoutes(routeIds: readonly string[]): Promise<void> {
    const ids = [...new Set(routeIds)].toSorted();
    let accepted = 0;
    for (const routeId of ids) {
      if (isDisposed()) return;
      const outcome = await dispatchWithFreshGeneration(createDisconnectRouteCommand(routeId));
      if (outcome === null || isDisposed() || !isAccepted(outcome)) {
        callbacks.onNotice?.({
          kind: "disconnect",
          accepted,
          remaining: ids.length - accepted,
          failedId: routeId,
        });
        return;
      }
      accepted += 1;
    }
    callbacks.onNotice?.({ kind: "disconnect", accepted, remaining: 0, failedId: null });
  }

  async function history(kind: "undo" | "redo"): Promise<void> {
    const context = await client.queryBuild({
      kind: "context",
      mode: "draft",
      clientIntentSequence: ++intentSequence,
    });
    if (context.result.kind !== "context" || context.result.status !== "ready") return;
    if (kind === "undo" && !context.result.context.canUndo) return;
    if (kind === "redo" && !context.result.context.canRedo) return;
    const outcome = await client.dispatchBuild(
      kind === "undo" ? createUndoDesignCommand() : createRedoDesignCommand(),
      context.result.source.generation,
    );
    callbacks.onNotice?.({
      kind: "history",
      accepted: isAccepted(outcome) ? 1 : 0,
      remaining: 0,
      failedId: isAccepted(outcome) ? null : "history",
    });
  }

  const unsubscribeGrid = client.subscribe(checkPublication);
  const unsubscribeConnection = client.subscribeConnection(() => {
    if (client.getConnectionStatus() === "live" || isDisposed()) return;
    coordinator.invalidate();
    clear();
    emitStatus("unknown");
    callbacks.onReset?.();
  });

  return {
    setMoveTarget(nextTarget) {
      if (disposed) return;
      if (sameMoveTarget(target, nextTarget)) return;
      clear();
      target = nextTarget;
      if (nextTarget !== null) void requestMove(nextTarget.moduleInstanceId, nextTarget.position);
    },
    hoverMove(moduleInstanceId, position) {
      if (disposed || operation !== null || samePoint(movePosition, position)) return;
      void requestMove(moduleInstanceId, position);
    },
    confirmMove(moduleInstanceId, position) {
      void confirmMove(moduleInstanceId, position);
    },
    rotateModule(moduleInstanceId, rotation) {
      void rotateModule(moduleInstanceId, rotation);
    },
    removeModules(moduleInstanceIds) {
      void removeModules(moduleInstanceIds);
    },
    disconnectRoutes(routeIds) {
      void disconnectRoutes(routeIds);
    },
    history(kind) {
      void history(kind);
    },
    cancel() {
      if (disposed) return;
      clear();
      callbacks.onReset?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeGrid();
      unsubscribeConnection();
      coordinator.clear();
      emitGhost(null);
      emitStatus("idle");
    },
  };
}

export function rotateModuleQuarter(
  rotation: Rotation,
  direction: "clockwise" | "counterclockwise",
): Rotation {
  return rotated(rotation, direction);
}
