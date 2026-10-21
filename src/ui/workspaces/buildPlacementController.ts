import {
  createBuildPreviewCoordinator,
  type BuildPreviewCoordinator,
} from "../../app/game-client/buildPreviewCoordinator.ts";
import {
  createBuyModuleCommand,
  createPlaceModuleCommand,
} from "../../app/game-client/buildCommands.ts";
import type {
  BuildPlacementGhost,
  BuildPlacementTool,
  BuildPlacementStatus,
  BuildQuery,
  BuildQueryResponse,
  BuildQueryResult,
  BuildPositionInput,
  BuildSourceStamp,
  GameClient,
  GridPoint,
  Rotation,
} from "../../app/game-client/contracts.ts";

type PlacementClient = Pick<
  GameClient,
  | "queryBuild"
  | "dispatchBuild"
  | "getGridViewModel"
  | "subscribe"
  | "getConnectionStatus"
  | "subscribeConnection"
>;

export interface BuildPlacementControllerCallbacks {
  readonly onGhost?: (ghost: BuildPlacementGhost | null) => void;
  readonly onStatus?: (status: BuildPlacementStatus) => void;
  readonly onPlaced?: (retainTool: boolean) => void;
  readonly onReset?: () => void;
}

export interface BuildPlacementController {
  setTool(tool: BuildPlacementTool | null): void;
  hover(position: GridPoint | null): void;
  confirm(position: GridPoint, retainTool: boolean): void;
  rotate(direction: "clockwise" | "counterclockwise"): void;
  cancel(): void;
  dispose(): void;
}

interface PlacementOperation {
  readonly position: GridPoint;
  readonly retainTool: boolean;
  readonly expectedDraftRevision: number;
}

function samePoint(left: GridPoint | null, right: GridPoint | null): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function sameTool(left: BuildPlacementTool | null, right: BuildPlacementTool | null): boolean {
  return (
    left?.definitionId === right?.definitionId &&
    left?.source === right?.source &&
    left?.generation === right?.generation &&
    left?.rotation === right?.rotation
  );
}

function nextRotation(rotation: Rotation, direction: "clockwise" | "counterclockwise"): Rotation {
  const rotations: readonly Rotation[] = [0, 90, 180, 270];
  const current = rotations.indexOf(rotation);
  const delta = direction === "clockwise" ? 1 : -1;
  return rotations[(current + delta + rotations.length) % rotations.length] ?? 0;
}

function isAccepted(outcome: Awaited<ReturnType<GameClient["dispatchBuild"]>>): boolean {
  return outcome.kind === "domain" && outcome.result.accepted;
}

function sourceRevision(source: BuildSourceStamp): number {
  return source.draftRevision ?? 0;
}

type PlacementQueryResult = Extract<BuildQueryResult, { kind: "placement"; data: unknown }>;

function placementResult(result: BuildQueryResult): PlacementQueryResult | null {
  return result.kind === "placement" && "data" in result ? result : null;
}

function localGhost(
  tool: BuildPlacementTool,
  position: GridPoint,
  pending: boolean,
): BuildPlacementGhost {
  return {
    definitionId: tool.definitionId,
    position: { ...position },
    rotation: tool.rotation,
    footprint: { ...tool.footprint },
    occupiedTiles: [],
    attachedRouteIds: [],
    valid: pending ? null : false,
    reason: pending ? null : "NOT_AVAILABLE",
    pending,
  };
}

export function createBuildPlacementController(
  client: PlacementClient,
  callbacks: BuildPlacementControllerCallbacks = {},
): BuildPlacementController {
  let disposed = false;
  let tool: BuildPlacementTool | null = null;
  let hoverPosition: GridPoint | null = null;
  let ghost: BuildPlacementGhost | null = null;
  let operation: PlacementOperation | null = null;
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

  function emitStatus(next: BuildPlacementStatus): void {
    callbacks.onStatus?.(next);
  }

  function clearLocalState(notifyReset: boolean): void {
    coordinator.invalidate();
    hoverPosition = null;
    operation = null;
    emitGhost(null);
    emitStatus("idle");
    if (notifyReset) callbacks.onReset?.();
  }

  async function requestPreview(position: GridPoint): Promise<void> {
    const activeTool = tool;
    if (disposed || activeTool === null || operation !== null) return;
    const requestSequence = ++previewSequence;
    const query: BuildQuery = {
      kind: "placement",
      mode: "draft",
      clientIntentSequence: ++intentSequence,
      input: {
        definitionId: activeTool.definitionId,
        position: { ...position } satisfies BuildPositionInput,
        rotation: activeTool.rotation,
        source: activeTool.source,
      },
    };
    emitGhost(localGhost(activeTool, position, true));
    emitStatus("previewing");
    const result = await coordinator.request(query);
    if (isDisposed() || requestSequence !== previewSequence || result === null) return;
    const placement = placementResult(result);
    if (placement === null) {
      emitGhost(localGhost(activeTool, position, false));
      emitStatus("unknown");
      return;
    }
    const data = placement.data;
    emitGhost({
      definitionId: activeTool.definitionId,
      position: { ...data.position },
      rotation: data.rotation,
      footprint: { ...activeTool.footprint },
      occupiedTiles: data.occupiedTiles.map((tile) => ({ ...tile })),
      attachedRouteIds: data.attachedRouteIds.map((routeId) => routeId),
      valid: data.valid,
      reason: data.reason ?? placement.reason ?? null,
      pending: false,
    });
    emitStatus(data.valid ? "ready" : "invalid");
  }

  async function runConfirm(position: GridPoint, retainTool: boolean): Promise<void> {
    const activeTool = tool;
    const activeGhost = ghost;
    if (
      disposed ||
      activeTool === null ||
      operation !== null ||
      activeGhost === null ||
      activeGhost.pending ||
      !activeGhost.valid ||
      !samePoint(activeGhost.position, position)
    ) {
      return;
    }

    let generation = activeTool.generation;
    if (activeTool.source === "catalog") {
      emitStatus("buying");
      const purchase = await client.dispatchBuild(
        createBuyModuleCommand(activeTool.definitionId),
        generation,
      );
      if (isDisposed() || !isAccepted(purchase)) {
        emitStatus(purchase.kind === "domain" ? "rejected" : "unknown");
        return;
      }
      generation = purchase.source.generation;
      tool = { ...activeTool, generation };
      coordinator.invalidate();
      previewSequence += 1;
      const refreshedSequence = previewSequence;
      const refreshedQuery: BuildQuery = {
        kind: "placement",
        mode: "draft",
        clientIntentSequence: ++intentSequence,
        input: {
          definitionId: tool.definitionId,
          position: { ...position },
          rotation: tool.rotation,
          source: tool.source,
        },
      };
      emitGhost(localGhost(tool, position, true));
      emitStatus("previewing");
      const refreshed = await coordinator.request(refreshedQuery);
      if (isDisposed() || refreshedSequence !== previewSequence || refreshed === null) return;
      const placement = placementResult(refreshed);
      if (placement?.data.valid !== true) {
        if (placement !== null) {
          emitGhost({
            definitionId: tool.definitionId,
            position: { ...placement.data.position },
            rotation: placement.data.rotation,
            footprint: { ...tool.footprint },
            occupiedTiles: placement.data.occupiedTiles.map((tile) => ({ ...tile })),
            attachedRouteIds: placement.data.attachedRouteIds.map((routeId) => routeId),
            valid: false,
            reason: placement.data.reason ?? placement.reason ?? "INSUFFICIENT_INVENTORY",
            pending: false,
          });
          emitStatus("invalid");
        } else {
          emitGhost(localGhost(tool, position, false));
          emitStatus("unknown");
        }
        return;
      }
    }

    emitStatus("placing");
    const placement = await client.dispatchBuild(
      createPlaceModuleCommand(activeTool.definitionId, position, activeTool.rotation),
      generation,
    );
    if (isDisposed() || !isAccepted(placement)) {
      emitStatus(placement.kind === "domain" ? "rejected" : "unknown");
      return;
    }
    const expectedDraftRevision = sourceRevision(placement.source);
    operation = { position: { ...position }, retainTool, expectedDraftRevision };
    emitStatus("awaiting-publication");
    checkPublication();
  }

  function checkPublication(): void {
    if (disposed || operation === null) return;
    const grid = client.getGridViewModel();
    if (grid.mode !== "draft" || grid.layoutRevision < operation.expectedDraftRevision) return;
    const retainTool = operation.retainTool;
    operation = null;
    hoverPosition = null;
    emitGhost(null);
    emitStatus("idle");
    callbacks.onPlaced?.(retainTool);
  }

  const unsubscribeGrid = client.subscribe(checkPublication);
  const unsubscribeConnection = client.subscribeConnection(() => {
    if (client.getConnectionStatus() === "live") return;
    if (disposed) return;
    coordinator.invalidate();
    previewSequence += 1;
    operation = null;
    hoverPosition = null;
    emitGhost(null);
    emitStatus("unknown");
    callbacks.onReset?.();
  });

  return {
    setTool(nextTool) {
      if (disposed || sameTool(tool, nextTool)) return;
      const nextPosition = hoverPosition ?? (nextTool === null ? null : { x: 0, y: 0 });
      tool = nextTool;
      clearLocalState(false);
      hoverPosition = nextPosition;
      if (tool !== null && nextPosition !== null) void requestPreview(nextPosition);
    },
    hover(position) {
      if (disposed || operation !== null || samePoint(hoverPosition, position)) return;
      hoverPosition = position === null ? null : { ...position };
      if (position === null || tool === null) {
        previewSequence += 1;
        coordinator.invalidate();
        emitGhost(null);
        emitStatus("idle");
        return;
      }
      void requestPreview(position);
    },
    confirm(position, retainTool) {
      void runConfirm(position, retainTool);
    },
    rotate(direction) {
      if (disposed || tool === null) return;
      tool = { ...tool, rotation: nextRotation(tool.rotation, direction) };
      coordinator.invalidate();
      previewSequence += 1;
      emitGhost(null);
      emitStatus("idle");
      if (hoverPosition !== null) void requestPreview(hoverPosition);
    },
    cancel() {
      if (disposed) return;
      clearLocalState(true);
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
