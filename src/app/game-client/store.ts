// Immutable GameClientStore primitives (Phase 2 §7.2, Task 18.3).
//
// The store owns received values: it freeze-checks every publication,
// preserves equal section references across applies, and exposes stable
// getSnapshot/getGridViewModel results until a publication changes them.
// UI/grid publications apply atomically (both or neither). Selector
// subscriptions use Object.is by default with optional equality and
// unsubscribe cleanup. React selection/camera state stays outside. There
// is no per-tile subscription path and no event-mutation path: the store
// exposes no event-subscription API at all, so subscribers cannot mutate
// the store or the simulator. Real transport stays Task 19 work; tests
// drive this store through the fake transport adapter.

import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type { GridPublication } from "../../sim/selectors/gridPublication.ts";
import type { GridViewModel, UiSnapshot } from "../../sim/selectors/presentationTypes.ts";
import { freezeOwned } from "../../sim/selectors/freezeOwned.ts";

export type StoreConnectionStatus = "disconnected" | "live" | "degraded" | "resync-required";

export interface StoreState {
  readonly snapshot: UiSnapshot | null;
  readonly grid: GridViewModel | null;
}

export interface PublicationInput {
  readonly epoch: string;
  readonly snapshot: UiSnapshot;
  // Null grid means a snapshot-only message (command-only changes move no
  // grid revision, §7.1: UiSnapshot publishes at its own cadence). Atomicity
  // still holds: with a grid present both roots swap together; without one
  // only the snapshot swaps and no grid acknowledgement is owed.
  readonly grid: GridPublication | null;
}

export type ApplyRejectionReason = "stale-epoch" | "resync-required";

export type ApplyResult =
  { readonly applied: true } | { readonly applied: false; readonly reason: ApplyRejectionReason };

export type SnapshotListener = () => void;

export interface SelectorSubscription<T> {
  readonly value: T;
  readonly unsubscribe: () => void;
}

export interface GameClientStore {
  getSnapshot(): UiSnapshot | null;
  getGridViewModel(): GridViewModel | null;
  getConnectionStatus(): StoreConnectionStatus;
  setConnectionStatus(status: StoreConnectionStatus): void;
  applyPublication(input: PublicationInput): ApplyResult;
  // Host-driven epoch rotation (load/recovery handshake): clears owned
  // snapshots and requires the next publication to be full. Without this
  // explicit reset a new epoch stays stale-epoch rejected forever.
  resetForEpoch(epoch: string): void;
  subscribe(listener: SnapshotListener): () => void;
  select<T>(
    selector: (state: StoreState) => T,
    listener?: (value: T) => void,
    equality?: (left: T, right: T) => boolean,
  ): SelectorSubscription<T>;
  getSubscriptionCount(): number;
}

interface SelectorEntry {
  selector: (state: StoreState) => unknown;
  listener: (value: never) => void;
  equality: (left: unknown, right: unknown) => boolean;
  lastValue: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError("Store input must be an exact plain data record.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string") ||
    expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    throw new TypeError("Store input contains unknown or missing fields.");
  }
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError("Store input fields must be enumerable data properties.");
    }
    result[key] = descriptor.value;
  }
  return result;
}

// Bounded structural equality for section preservation. Early-exits on
// the first difference; allocates nothing. Plain-data only: direct
// indexed access instead of reflective calls.
function stableEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray || rightIsArray) {
    if (!leftIsArray || !rightIsArray) return false;
  } else if (!isPlainRecord(left) || !isPlainRecord(right)) {
    return false;
  }
  if (leftIsArray && rightIsArray) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!stableEqual(left[index], right[index])) return false;
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key)) return false;
    if (!stableEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function assertDeeplyFrozen(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (!Object.isFrozen(value)) {
    throw new TypeError("GameClientStore accepts only deeply frozen owned values.");
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new TypeError("GameClientStore rejects nonstandard array prototypes.");
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some((key) => typeof key !== "string") ||
      Object.getOwnPropertyDescriptor(value, "length")?.value !== value.length
    ) {
      throw new TypeError("GameClientStore accepts only dense ordinary arrays.");
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        throw new TypeError("GameClientStore arrays must contain data values only.");
      }
      assertDeeplyFrozen(descriptor.value, seen);
    }
    return;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("GameClientStore rejects non-plain frozen values.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError("GameClientStore rejects symbol properties.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError("GameClientStore accepts only enumerable data properties.");
    }
    assertDeeplyFrozen(descriptor.value, seen);
  }
}

function preserveSection<T>(current: T, next: T): T {
  return stableEqual(current, next) ? current : next;
}

function assertValidGridPublication(publication: GridPublication): void {
  const { source, entities, heatmap } = publication;
  const tileCount = source.width * source.height;
  if (!Number.isSafeInteger(publication.baseGridRevision) || publication.baseGridRevision < 0) {
    throw new TypeError("Grid publication base revision must be a nonnegative safe integer.");
  }
  if (!Number.isSafeInteger(publication.nextGridRevision) || publication.nextGridRevision < 0) {
    throw new TypeError("Grid publication next revision must be a nonnegative safe integer.");
  }
  if (publication.nextGridRevision < publication.baseGridRevision) {
    throw new TypeError("Grid publication revisions cannot move backwards.");
  }
  const assertUniqueIds = (ids: readonly string[], label: string): Set<string> => {
    const result = new Set<string>();
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0 || result.has(id)) {
        throw new TypeError(`Grid publication ${label} ids must be unique nonempty strings.`);
      }
      result.add(id);
    }
    return result;
  };
  const upsertModuleIds = assertUniqueIds(
    entities.upsertModules.map((view) => view.id),
    "module",
  );
  const removeModuleIds = assertUniqueIds(entities.removeModuleIds, "module removal");
  const upsertRouteIds = assertUniqueIds(
    entities.upsertRoutes.map((view) => view.id),
    "route",
  );
  const removeRouteIds = assertUniqueIds(entities.removeRouteIds, "route removal");
  if ([...upsertModuleIds].some((id) => removeModuleIds.has(id))) {
    throw new TypeError("Grid publication cannot upsert and remove the same module.");
  }
  if ([...upsertRouteIds].some((id) => removeRouteIds.has(id))) {
    throw new TypeError("Grid publication cannot upsert and remove the same route.");
  }
  const seenTiles = heatmap.full ? null : new Set<number>();
  if (heatmap.full && heatmap.values.length !== tileCount) {
    throw new TypeError("Full grid heatmaps must cover every declared tile.");
  }
  for (let index = 0; index < heatmap.values.length; index += 1) {
    const value = heatmap.values[index];
    if (
      value === undefined ||
      !Number.isInteger(value.x) ||
      !Number.isInteger(value.y) ||
      value.x < 0 ||
      value.x >= source.width ||
      value.y < 0 ||
      value.y >= source.height ||
      !Number.isFinite(value.temperatureC)
    ) {
      throw new TypeError("Grid publication heatmap contains an invalid tile.");
    }
    if (heatmap.full) {
      const expectedX = index % source.width;
      const expectedY = Math.floor(index / source.width);
      if (value.x !== expectedX || value.y !== expectedY) {
        throw new TypeError("Full grid heatmaps must use row-major order.");
      }
    } else if (seenTiles !== null) {
      const key = value.y * source.width + value.x;
      if (seenTiles.has(key))
        throw new TypeError("Grid publication heatmap contains a duplicate tile.");
      seenTiles.add(key);
    }
  }
}

export function createGameClientStore(): GameClientStore {
  let epoch: string | null = null;
  let snapshot: UiSnapshot | null = null;
  let grid: GridViewModel | null = null;
  let gridRevision = 0;
  let heatTiles: { x: number; y: number; temperatureC: number }[] | null = null;
  let connectionStatus: StoreConnectionStatus = "disconnected";
  const snapshotListeners = new Set<SnapshotListener>();
  const selectorEntries = new Set<SelectorEntry>();

  function currentState(): StoreState {
    return { snapshot, grid };
  }

  function notify(): void {
    const state = currentState();
    for (const listener of [...snapshotListeners]) {
      try {
        listener();
      } catch {
        // One throwing subscriber cannot undo a committed publication or
        // break the remaining subscribers.
      }
    }
    for (const entry of [...selectorEntries]) {
      try {
        const next = entry.selector(state);
        if (entry.equality(entry.lastValue, next)) continue;
        const previous = entry.lastValue;
        entry.lastValue = next;
        try {
          entry.listener(next as never);
        } catch {
          // Retry a failed callback on the next relevant notification, but
          // do not overwrite a newer value established by reentrant work.
          if (Object.is(entry.lastValue, next)) entry.lastValue = previous;
        }
      } catch {
        // Selector, equality and listener failures are isolated. The last
        // successful selector value remains the subscription baseline so a
        // transient callback defect cannot suppress later notifications.
      }
    }
  }

  function buildNextGrid(publication: GridPublication): {
    readonly grid: GridViewModel;
    readonly heatTiles: { readonly x: number; readonly y: number; readonly temperatureC: number }[];
  } {
    const modules = new Map<string, GridViewModel["modules"][number]>();
    const routes = new Map<string, GridViewModel["routes"][number]>();
    if (grid !== null) {
      for (const view of grid.modules) modules.set(view.id, view);
      for (const view of grid.routes) routes.set(view.id, view);
    }
    for (const id of publication.entities.removeModuleIds) modules.delete(id);
    for (const view of publication.entities.upsertModules) modules.set(view.id, view);
    for (const id of publication.entities.removeRouteIds) routes.delete(id);
    for (const view of publication.entities.upsertRoutes) routes.set(view.id, view);

    const width = publication.source.width;
    let nextTiles: { x: number; y: number; temperatureC: number }[];
    if (publication.heatmap.full || heatTiles === null) {
      nextTiles = [...publication.heatmap.values];
    } else {
      nextTiles = [...heatTiles];
      for (const value of publication.heatmap.values) {
        nextTiles[value.y * width + value.x] = value;
      }
    }
    const next: GridViewModel = {
      revision: publication.nextGridRevision,
      mode: publication.viewMode,
      layoutRevision:
        publication.viewMode === "draft"
          ? (publication.source.draftRevision ?? publication.source.liveLayoutRevision)
          : publication.source.liveLayoutRevision,
      thermalRevision: publication.source.thermalRevision,
      gridSize: { width: publication.source.width, height: publication.source.height },
      modules: [...modules.values()].toSorted((left, right) =>
        compareStableStrings(left.id, right.id),
      ),
      routes: [...routes.values()].toSorted((left, right) =>
        compareStableStrings(left.id, right.id),
      ),
      heatmap: { full: true, values: nextTiles },
      placementPreview: null,
      diagnosticHighlights: [],
    };
    return { grid: freezeOwned(next), heatTiles: nextTiles };
  }

  function assertValidEpoch(epoch: string): void {
    if (epoch.length === 0 || epoch.length > 64 || !/^[A-Za-z0-9-]+$/.test(epoch)) {
      throw new TypeError("Store epoch must be 1-64 ASCII alphanumeric/hyphen characters.");
    }
  }

  function applyPublication(input: PublicationInput): ApplyResult {
    const fields = readExactDataRecord(input, ["epoch", "snapshot", "grid"]);
    const incomingEpoch = fields["epoch"];
    const incomingSnapshot = fields["snapshot"];
    const incomingGrid = fields["grid"];
    if (typeof incomingEpoch !== "string") {
      throw new TypeError("Publication epoch must be a string.");
    }
    if (incomingSnapshot === null || typeof incomingSnapshot !== "object") {
      throw new TypeError("Publication snapshot must be an object.");
    }
    if (incomingGrid !== null && typeof incomingGrid !== "object") {
      throw new TypeError("Publication grid must be an object or null.");
    }
    const parsedGrid = incomingGrid === null ? null : (incomingGrid as GridPublication);
    // Protocol checks precede ownership checks: epoch/base mismatches
    // reject without paying the deep freeze walk. Freeze verification
    // still gates every adopted value below.
    assertValidEpoch(incomingEpoch);
    if (epoch !== null && incomingEpoch !== epoch) {
      return { applied: false, reason: "stale-epoch" };
    }
    if (parsedGrid !== null) {
      const gridFields = readExactDataRecord(parsedGrid, [
        "epoch",
        "publicationSequence",
        "baseGridRevision",
        "nextGridRevision",
        "viewMode",
        "source",
        "entities",
        "heatmap",
      ]);
      if (gridFields["epoch"] !== incomingEpoch) {
        return { applied: false, reason: "stale-epoch" };
      }
      const heatmapFields = readExactDataRecord(gridFields["heatmap"], ["full", "values"]);
      if (grid === null && heatmapFields["full"] !== true) {
        return { applied: false, reason: "resync-required" };
      }
      if (grid !== null && gridFields["baseGridRevision"] !== gridRevision) {
        return { applied: false, reason: "resync-required" };
      }
    }
    assertDeeplyFrozen(incomingSnapshot, new Set());
    if (parsedGrid !== null) assertDeeplyFrozen(parsedGrid, new Set());
    if (parsedGrid !== null) assertValidGridPublication(parsedGrid);
    if (parsedGrid === null) {
      if (grid === null) return { applied: false, reason: "resync-required" };
    } else if (grid === null) {
      if (!parsedGrid.heatmap.full) return { applied: false, reason: "resync-required" };
    } else if (parsedGrid.baseGridRevision !== gridRevision) {
      return { applied: false, reason: "resync-required" };
    }
    let nextGrid: GridViewModel;
    let nextHeatTiles = heatTiles;
    if (parsedGrid === null) {
      // Snapshot-only messages never bootstrap grid state: the first
      // READY always carries a full grid snapshot (§7.2).
      if (grid === null) return { applied: false, reason: "resync-required" };
      nextGrid = grid;
    } else {
      if (grid === null) {
        if (!parsedGrid.heatmap.full) return { applied: false, reason: "resync-required" };
      } else if (parsedGrid.baseGridRevision !== gridRevision) {
        return { applied: false, reason: "resync-required" };
      }
      const builtGrid = buildNextGrid(parsedGrid);
      nextGrid = builtGrid.grid;
      nextHeatTiles = builtGrid.heatTiles;
    }

    const incoming = incomingSnapshot as UiSnapshot;
    let frozenSnapshot: UiSnapshot;
    if (snapshot === null) {
      frozenSnapshot = incoming;
    } else {
      const built: UiSnapshot = {
        revision: incoming.revision,
        tick: incoming.tick,
        header: preserveSection(snapshot.header, incoming.header),
        tasks: preserveSection(snapshot.tasks, incoming.tasks),
        alerts: preserveSection(snapshot.alerts, incoming.alerts),
        telemetry: preserveSection(snapshot.telemetry, incoming.telemetry),
        inspector: preserveSection(snapshot.inspector, incoming.inspector),
        research: preserveSection(snapshot.research, incoming.research),
        build: preserveSection(snapshot.build, incoming.build),
        tutorial: preserveSection(snapshot.tutorial, incoming.tutorial),
        commandAvailability: preserveSection(
          snapshot.commandAvailability,
          incoming.commandAvailability,
        ),
      };
      // Identical republications keep the root reference so selector
      // equality (and React external-store caching) observes no change.
      frozenSnapshot =
        built.revision === snapshot.revision &&
        built.tick === snapshot.tick &&
        built.header === snapshot.header &&
        built.tasks === snapshot.tasks &&
        built.alerts === snapshot.alerts &&
        built.telemetry === snapshot.telemetry &&
        built.inspector === snapshot.inspector &&
        built.research === snapshot.research &&
        built.build === snapshot.build &&
        built.tutorial === snapshot.tutorial &&
        built.commandAvailability === snapshot.commandAvailability
          ? snapshot
          : Object.freeze(built);
    }

    // Atomic swap: both roots change together or neither does. A fully
    // identical republication is still applied (the host acknowledgement
    // loop stays exact) but notifies nothing.
    const changed = frozenSnapshot !== snapshot || nextGrid !== grid;
    epoch = epoch ?? incomingEpoch;
    snapshot = frozenSnapshot;
    grid = nextGrid;
    heatTiles = nextHeatTiles;
    if (parsedGrid !== null) gridRevision = parsedGrid.nextGridRevision;
    if (connectionStatus === "disconnected") connectionStatus = "live";
    if (changed) notify();
    return { applied: true };
  }

  function subscribe(listener: SnapshotListener): () => void {
    if (typeof listener !== "function") throw new TypeError("Store listener must be a function.");
    snapshotListeners.add(listener);
    return () => {
      snapshotListeners.delete(listener);
    };
  }

  function select<T>(
    selector: (state: StoreState) => T,
    listener?: (value: T) => void,
    equality: (left: T, right: T) => boolean = Object.is,
  ): SelectorSubscription<T> {
    if (typeof selector !== "function") throw new TypeError("Store selector must be a function.");
    if (listener !== undefined && typeof listener !== "function") {
      throw new TypeError("Store selector listener must be a function.");
    }
    if (typeof equality !== "function") throw new TypeError("Store equality must be a function.");
    const value = selector(currentState());
    if (listener === undefined) return { value, unsubscribe: () => undefined };
    const entry: SelectorEntry = {
      selector: (state) => selector(state),
      listener: (value) => {
        listener(value);
      },
      equality: (left, right) => equality(left as T, right as T),
      lastValue: value,
    };
    selectorEntries.add(entry);
    return {
      value,
      unsubscribe: () => {
        selectorEntries.delete(entry);
      },
    };
  }

  return {
    getSnapshot: () => snapshot,
    getGridViewModel: () => grid,
    getConnectionStatus: () => connectionStatus,
    setConnectionStatus: (status: StoreConnectionStatus) => {
      // Literal comparison through unknown: the status arrives from the
      // host boundary and may carry any runtime value despite the type.
      const incoming: unknown = status;
      if (
        incoming !== "disconnected" &&
        incoming !== "live" &&
        incoming !== "degraded" &&
        incoming !== "resync-required"
      ) {
        throw new TypeError("Unknown store connection status.");
      }
      connectionStatus = status;
    },
    applyPublication,
    resetForEpoch: (next: string) => {
      assertValidEpoch(next);
      epoch = next;
      snapshot = null;
      grid = null;
      gridRevision = 0;
      heatTiles = null;
      connectionStatus = "disconnected";
      notify();
    },
    subscribe,
    select,
    getSubscriptionCount: () => snapshotListeners.size + selectorEntries.size,
  };
}
