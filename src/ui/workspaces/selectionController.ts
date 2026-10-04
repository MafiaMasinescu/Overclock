import type { GameClient } from "../../app/game-client/contracts.ts";
import type { GridViewModel } from "../../app/game-client/snapshots.ts";

interface GridPoint {
  readonly x: number;
  readonly y: number;
}

function isTileId(value: string, grid: GridViewModel): boolean {
  const match = /^tile:(\d+):(\d+)$/.exec(value);
  if (match === null) return false;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return x >= 0 && y >= 0 && x < grid.gridSize.width && y < grid.gridSize.height;
}

export function isSelectableEntityId(value: string, grid: GridViewModel): boolean {
  return (
    grid.modules.some((module) => module.id === value) ||
    grid.routes.some((route) => route.id === value) ||
    isTileId(value, grid)
  );
}

export function pruneSelection(
  selection: readonly string[],
  grid: GridViewModel,
): readonly string[] {
  const valid = selection.filter((value) => isSelectableEntityId(value, grid));
  return valid.length === selection.length ? selection : valid;
}

export function applyEntitySelection(
  previous: readonly string[],
  entityId: string | null,
  additive: boolean,
  grid: GridViewModel,
): readonly string[] {
  if (entityId === null) return [];
  const validPrevious = pruneSelection(previous, grid);
  if (!isSelectableEntityId(entityId, grid)) return validPrevious;
  if (!additive) return [entityId];
  return validPrevious.includes(entityId)
    ? validPrevious.filter((value) => value !== entityId)
    : [...validPrevious, entityId].toSorted();
}

export function selectRectangle(
  grid: GridViewModel,
  from: GridPoint,
  to: GridPoint,
): readonly string[] {
  const left = Math.max(0, Math.min(from.x, to.x));
  const right = Math.min(grid.gridSize.width - 1, Math.max(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const bottom = Math.min(grid.gridSize.height - 1, Math.max(from.y, to.y));
  const selected: string[] = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) selected.push(`tile:${x}:${y}`);
  }
  return selected;
}

export function applyRectangleSelection(
  previous: readonly string[],
  next: readonly string[],
  additive: boolean,
  grid: GridViewModel,
): readonly string[] {
  if (!additive) return [...next];
  return [...new Set([...pruneSelection(previous, grid), ...next])].toSorted();
}

/** One local owner for both input surfaces; at most one context request and one latest intent. */
export function createSelectionController(
  client: Pick<
    GameClient,
    | "getSnapshot"
    | "getGridViewModel"
    | "subscribe"
    | "setPresentationContext"
    | "getConnectionStatus"
    | "subscribeConnection"
  >,
) {
  let selection: readonly string[] = [];
  let grid: GridViewModel | null = null;
  let generation = 0;
  let inFlight = false;
  let pending = false;
  let submitted: readonly string[] | null = null;
  let synchronizeOnAdmission = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    listeners.forEach((listener) => {
      listener();
    });
  };

  function flush(): void {
    if (grid === null || inFlight || !pending) return;
    pending = false;
    if (
      submitted !== null &&
      submitted.length === selection.length &&
      submitted.every((id, index) => id === selection[index])
    )
      return;
    submitted = selection;
    inFlight = true;
    const admittedGeneration = generation;
    void client
      .setPresentationContext({
        selectedIds: selection,
        inspectedEntityId: selection[0] ?? null,
        heatmapEnabled: false,
      })
      .catch(() => {
        // Transport failures are presented by the shell connection banner. Never retry in a loop.
      })
      .finally(() => {
        if (admittedGeneration !== generation) return;
        inFlight = false;
        flush();
      });
  }

  function setSelection(next: readonly string[]): void {
    if (next === selection) return;
    const ordered = [...new Set(next)].toSorted();
    if (
      ordered.length === selection.length &&
      ordered.every((id, index) => id === selection[index])
    )
      return;
    selection = ordered;
    pending = true;
    notify();
    flush();
  }

  function reset(): void {
    generation += 1;
    grid = null;
    pending = false;
    submitted = null;
    inFlight = false;
    if (selection.length > 0) {
      selection = [];
      notify();
    }
  }

  return {
    getSelection: () => selection,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      const publication = () => {
        if (client.getConnectionStatus() !== "live") {
          synchronizeOnAdmission ||= selection.length > 0 || submitted !== null;
          reset();
          return;
        }
        try {
          client.getSnapshot();
          grid = client.getGridViewModel();
          setSelection(pruneSelection(selection, grid));
          if (synchronizeOnAdmission) {
            // A same-epoch full resync can retain the Worker's previous context.
            // Clear it once on readmission instead of reviving stale selection.
            synchronizeOnAdmission = false;
            pending = true;
            flush();
          }
        } catch {
          // Epoch reset is observable synchronously, even if React batches away its empty snapshot.
          reset();
          synchronizeOnAdmission = false;
        }
      };
      publication();
      const unsubscribe = client.subscribe(publication);
      const unsubscribeConnection = client.subscribeConnection(publication);
      return () => {
        unsubscribe();
        unsubscribeConnection();
        reset();
        synchronizeOnAdmission = false;
      };
    },
    selectEntity(entityId: string | null, additive = false) {
      if (grid !== null) setSelection(applyEntitySelection(selection, entityId, additive, grid));
    },
    selectRectangle(from: GridPoint, to: GridPoint, additive: boolean) {
      if (grid !== null)
        setSelection(
          applyRectangleSelection(selection, selectRectangle(grid, from, to), additive, grid),
        );
    },
  };
}

export type SelectionController = ReturnType<typeof createSelectionController>;
