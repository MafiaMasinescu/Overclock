// Revision-aware grid and heatmap patch production (Phase 2 §7.2).
//
// The publisher keeps independent presentation revisions (never in
// GameState) and turns successive grid view models plus authoritative
// thermal tiles into full/delta publications. Deltas always diff against
// the last ACKNOWLEDGED state: heatmap tiles compare each current
// temperature to the last acknowledged transmitted temperature, so
// repeated sub-epsilon drift accumulates instead of being lost.
//
// Channel rules implemented here: one publication in flight (later
// changes coalesce into a single latest pending candidate, never chained
// onto an unacknowledged base); ACK applies the whole publication
// atomically to the acknowledged baseline; wrong sequence/base requests a
// full resync and applies nothing; full snapshot on first publication,
// mode/dimension change, observed load (revision decrease) or explicit
// resync; 1000 ms without ACK signals degraded transport and retains a
// single full-resync candidate. Epochs are opaque host values stamped on
// every envelope; a new epoch (load/recovery) takes a fresh publisher.
// No typed scratch array ever leaves this module; every produced value is
// owned and deeply frozen.

import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { freezeOwned } from "./freezeOwned.ts";
import {
  copyOwnedPlain,
  copyOwnedThermalTiles,
  isRegisteredProjectedGrid,
  isRegisteredProjectedThermalTiles,
  readExactDataFields,
} from "./ownedPlainData.ts";
import type { ThermalTileState } from "../core/types.ts";
import type {
  GridModuleViewModel,
  GridRouteViewModel,
  GridViewMode,
  GridViewModel,
  HeatmapPatch,
  ProjectionSource,
} from "./presentationTypes.ts";
import { valuesEqual } from "./valueEquality.ts";

// Shared with the projector read envelope (presentationTypes owns the
// shape); re-exported so publication consumers keep one import path.
export type GridPublicationSource = ProjectionSource;

export interface GridPublicationEntityLists {
  readonly upsertModules: readonly GridModuleViewModel[];
  readonly removeModuleIds: readonly string[];
  readonly upsertRoutes: readonly GridRouteViewModel[];
  readonly removeRouteIds: readonly string[];
}

export interface GridPublication {
  readonly epoch: string;
  readonly publicationSequence: number;
  readonly baseGridRevision: number;
  readonly nextGridRevision: number;
  readonly viewMode: GridViewMode;
  readonly source: GridPublicationSource;
  readonly entities: GridPublicationEntityLists;
  readonly heatmap: HeatmapPatch;
}

export interface GridPublishInput {
  readonly grid: GridViewModel;
  readonly thermalTiles: readonly ThermalTileState[];
  readonly source: GridPublicationSource;
  readonly heatmapEnabled: boolean;
  readonly nowMs: number;
}

interface OwnedGridPublishInput {
  readonly grid: GridViewModel;
  readonly thermalTiles: readonly ThermalTileState[];
  readonly source: GridPublicationSource;
  readonly heatmapEnabled: boolean;
  readonly nowMs: number;
}

export type AcknowledgeStatus = "acknowledged" | "unknown-sequence";

export interface AcknowledgeResult {
  readonly status: AcknowledgeStatus;
  readonly resyncRequired: boolean;
  readonly toSend: GridPublication | null;
}

export interface GridPublisherStatus {
  readonly epoch: string;
  readonly nextPublicationSequence: number;
  readonly lastAcknowledgedRevision: number;
  readonly inFlightSequence: number | null;
  readonly degraded: boolean;
  readonly resyncRequired: boolean;
  readonly hasPending: boolean;
}

export interface GridPublisherOptions {
  // Opaque host epoch (§9/§5.1 pattern, shared with the Task 19 host).
  readonly epoch: string;
  // Presentation-only epsilon; callers pass balancing.thermal.dirtyEpsilonC.
  readonly dirtyEpsilonC: number;
}

const ACK_TIMEOUT_MS = 1000;
const MAX_EPOCH_CHARACTERS = 64;

function assertValidEpoch(epoch: string): void {
  if (epoch.length === 0 || epoch.length > MAX_EPOCH_CHARACTERS || !/^[A-Za-z0-9-]+$/.test(epoch)) {
    throw new TypeError("GridPublisher epoch must be 1-64 ASCII alphanumeric/hyphen characters.");
  }
}

function assertValidSource(source: GridPublicationSource): void {
  for (const revision of [source.liveLayoutRevision, source.thermalRevision]) {
    if (!Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) {
      throw new TypeError("Grid publication source revisions must be nonnegative safe integers.");
    }
  }
  if (
    source.draftRevision !== null &&
    (!Number.isSafeInteger(source.draftRevision) ||
      source.draftRevision < 0 ||
      Object.is(source.draftRevision, -0))
  ) {
    throw new TypeError("Grid publication draft revision must be null or a safe integer.");
  }
  // Literal comparison through unknown: the source arrives from the host
  // boundary and may carry any runtime value despite the static type.
  const viewMode: unknown = source.viewMode;
  if (viewMode !== "live" && viewMode !== "draft") {
    throw new TypeError("Grid publication view mode must be live or draft.");
  }
  for (const dimension of [source.width, source.height]) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new TypeError("Grid publication dimensions must be positive safe integers.");
    }
  }
}

function assertValidInput(input: GridPublishInput): void {
  assertValidSource(input.source);
  if (typeof input.heatmapEnabled !== "boolean") {
    throw new TypeError("Grid publish heatmapEnabled must be a boolean.");
  }
  if (!Number.isFinite(input.nowMs) || input.nowMs < 0) {
    throw new TypeError("Grid publish nowMs must be finite and nonnegative.");
  }
  if (
    input.grid.gridSize.width !== input.source.width ||
    input.grid.gridSize.height !== input.source.height ||
    input.grid.mode !== input.source.viewMode
  ) {
    throw new TypeError("Grid publish view model must match the declared source.");
  }
  if (input.thermalTiles.length !== input.source.width * input.source.height) {
    throw new TypeError("Grid publish thermal tiles must cover the declared dimensions.");
  }
}

interface InFlightPublication {
  readonly sequence: number;
  readonly nextRevision: number;
  readonly modules: ReadonlyMap<string, GridModuleViewModel>;
  readonly routes: ReadonlyMap<string, GridRouteViewModel>;
  readonly temperatures: Float64Array;
  readonly source: GridPublicationSource;
  readonly sentAtMs: number;
}

export interface GridPublisher {
  publish(input: GridPublishInput): GridPublication | null;
  acknowledge(sequence: number): AcknowledgeResult;
  requestResync(): void;
  checkTimeout(nowMs: number): { readonly degraded: boolean };
  getStatus(): GridPublisherStatus;
}

export function createGridPublisher(options: GridPublisherOptions): GridPublisher {
  assertValidEpoch(options.epoch);
  if (!Number.isFinite(options.dirtyEpsilonC) || options.dirtyEpsilonC <= 0) {
    throw new TypeError("GridPublisher dirtyEpsilonC must be finite and positive.");
  }
  const epoch = options.epoch;
  const dirtyEpsilonC = options.dirtyEpsilonC;

  let nextSequence = 0;
  let lastAcknowledgedRevision = 0;
  // Acknowledged baselines retain shared frozen views (never copied, never
  // mutated); change detection walks them with valuesEqual instead of
  // canonical serialization, so steady publications allocate nothing.
  let acknowledgedModules = new Map<string, GridModuleViewModel>();
  let acknowledgedRoutes = new Map<string, GridRouteViewModel>();
  let acknowledgedTemperatures: Float64Array | null = null;
  let acknowledgedSource: GridPublicationSource | null = null;
  let inFlight: InFlightPublication | null = null;
  let degraded = false;
  let resyncRequired = false;
  let hasPending = false;
  let latestInput: OwnedGridPublishInput | null = null;
  // Reusable diff scratch. Sized to the declared dimensions, reallocated
  // on dimension change, never exposed outside this closure.
  let scratch = new Float64Array(0);

  function sourceChanged(source: GridPublicationSource): boolean {
    const previous = acknowledgedSource;
    if (previous === null) return true;
    return (
      source.liveLayoutRevision !== previous.liveLayoutRevision ||
      source.draftRevision !== previous.draftRevision ||
      source.thermalRevision !== previous.thermalRevision ||
      source.viewMode !== previous.viewMode ||
      source.width !== previous.width ||
      source.height !== previous.height
    );
  }

  function loadObserved(source: GridPublicationSource): boolean {
    const previous = acknowledgedSource;
    if (previous === null) return false;
    if (
      source.width !== previous.width ||
      source.height !== previous.height ||
      source.viewMode !== previous.viewMode
    ) {
      return true;
    }
    if (source.liveLayoutRevision < previous.liveLayoutRevision) return true;
    if (source.thermalRevision < previous.thermalRevision) return true;
    if (
      source.draftRevision !== null &&
      previous.draftRevision !== null &&
      source.draftRevision < previous.draftRevision
    ) {
      return true;
    }
    return false;
  }

  function moduleEntries(grid: GridViewModel): { id: string; view: GridModuleViewModel }[] {
    return grid.modules
      .map((view) => ({ id: view.id, view }))
      .toSorted((left, right) => compareStableStrings(left.id, right.id));
  }

  function routeEntries(grid: GridViewModel): { id: string; view: GridRouteViewModel }[] {
    return grid.routes
      .map((view) => ({ id: view.id, view }))
      .toSorted((left, right) => compareStableStrings(left.id, right.id));
  }

  function temperatureAt(
    tiles: readonly ThermalTileState[],
    source: GridPublicationSource,
    x: number,
    y: number,
  ): number {
    const tile = tiles[y * source.width + x];
    if (tile === undefined) throw new TypeError("Thermal tile coverage is incomplete.");
    return tile.temperatureC;
  }

  function buildPublication(
    input: GridPublishInput,
    full: boolean,
  ): { publication: GridPublication; transmitted: Float64Array; contentChanged: boolean } {
    const { grid, thermalTiles, source, heatmapEnabled } = input;
    const tileCount = source.width * source.height;
    if (scratch.length !== tileCount) scratch = new Float64Array(tileCount);
    const transmitted = new Float64Array(tileCount);

    const upsertModules: GridModuleViewModel[] = [];
    const removeModuleIds: string[] = [];
    const upsertRoutes: GridRouteViewModel[] = [];
    const removeRouteIds: string[] = [];

    if (full) {
      for (const entry of moduleEntries(grid)) upsertModules.push(entry.view);
      for (const entry of routeEntries(grid)) upsertRoutes.push(entry.view);
    } else {
      for (const entry of moduleEntries(grid)) {
        if (!valuesEqual(acknowledgedModules.get(entry.id), entry.view)) {
          upsertModules.push(entry.view);
        }
      }
      const presentModules = new Set(grid.modules.map((view) => view.id));
      for (const id of [...acknowledgedModules.keys()].toSorted(compareStableStrings)) {
        if (!presentModules.has(id)) removeModuleIds.push(id);
      }
      for (const entry of routeEntries(grid)) {
        if (!valuesEqual(acknowledgedRoutes.get(entry.id), entry.view)) {
          upsertRoutes.push(entry.view);
        }
      }
      const presentRoutes = new Set(grid.routes.map((view) => view.id));
      for (const id of [...acknowledgedRoutes.keys()].toSorted(compareStableStrings)) {
        if (!presentRoutes.has(id)) removeRouteIds.push(id);
      }
    }

    const heatValues: { x: number; y: number; temperatureC: number }[] = [];
    if (full || (heatmapEnabled && acknowledgedTemperatures === null)) {
      {
        for (let y = 0; y < source.height; y += 1) {
          for (let x = 0; x < source.width; x += 1) {
            const temperatureC = temperatureAt(thermalTiles, source, x, y);
            scratch[y * source.width + x] = temperatureC;
            transmitted[y * source.width + x] = temperatureC;
            heatValues.push({ x, y, temperatureC });
          }
        }
      }
    } else if (heatmapEnabled) {
      if (acknowledgedTemperatures === null) {
        throw new TypeError("Acknowledged heatmap baseline is missing.");
      }
      for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
          const temperatureC = temperatureAt(thermalTiles, source, x, y);
          const index = y * source.width + x;
          const baseline = acknowledgedTemperatures[index] ?? temperatureC;
          scratch[index] = temperatureC;
          if (Math.abs(temperatureC - baseline) >= dirtyEpsilonC) {
            transmitted[index] = temperatureC;
            heatValues.push({ x, y, temperatureC });
          } else {
            transmitted[index] = baseline;
          }
        }
      }
    } else if (acknowledgedTemperatures !== null) {
      transmitted.set(acknowledgedTemperatures);
    }

    const contentChanged =
      upsertModules.length > 0 ||
      removeModuleIds.length > 0 ||
      upsertRoutes.length > 0 ||
      removeRouteIds.length > 0 ||
      heatValues.length > 0;
    const publication: GridPublication = {
      epoch,
      publicationSequence: nextSequence,
      baseGridRevision: lastAcknowledgedRevision,
      nextGridRevision:
        full || contentChanged ? lastAcknowledgedRevision + 1 : lastAcknowledgedRevision,
      viewMode: source.viewMode,
      source: { ...source },
      entities: { upsertModules, removeModuleIds, upsertRoutes, removeRouteIds },
      heatmap: { full, values: heatValues },
    };
    return { publication: freezeOwned(publication), transmitted, contentChanged };
  }

  function snapshotViews(
    entries: { id: string; view: GridModuleViewModel }[],
  ): Map<string, GridModuleViewModel>;
  function snapshotViews(
    entries: { id: string; view: GridRouteViewModel }[],
  ): Map<string, GridRouteViewModel>;
  function snapshotViews(
    entries: { id: string; view: GridModuleViewModel | GridRouteViewModel }[],
  ): Map<string, GridModuleViewModel | GridRouteViewModel> {
    const snapshot = new Map<string, GridModuleViewModel | GridRouteViewModel>();
    for (const entry of entries) snapshot.set(entry.id, entry.view);
    return snapshot;
  }

  // Presented-content difference against the acknowledged baseline,
  // without emitting. Source-revision movement is checked separately.
  // Coalescing path only; the emit path below reuses its single build.
  function contentDiffers(input: GridPublishInput): boolean {
    return buildPublication(input, false).contentChanged;
  }

  function emitBuilt(
    input: GridPublishInput,
    built: { publication: GridPublication; transmitted: Float64Array },
  ): GridPublication {
    const frozen: GridPublication = built.publication;
    inFlight = {
      sequence: frozen.publicationSequence,
      nextRevision: frozen.nextGridRevision,
      modules: snapshotViews(moduleEntries(input.grid)),
      routes: snapshotViews(routeEntries(input.grid)),
      temperatures: built.transmitted,
      source: { ...input.source },
      sentAtMs: input.nowMs,
    };
    nextSequence += 1;
    return frozen;
  }

  function publish(input: GridPublishInput): GridPublication | null {
    const fields = readExactDataFields(input, [
      "grid",
      "thermalTiles",
      "source",
      "heatmapEnabled",
      "nowMs",
    ]);
    const incomingGrid = fields["grid"];
    const source = copyOwnedPlain(fields["source"]) as GridPublicationSource;
    assertValidSource(source);
    const ownedInput: OwnedGridPublishInput = Object.freeze({
      grid: (isRegisteredProjectedGrid(incomingGrid)
        ? incomingGrid
        : copyOwnedPlain(incomingGrid)) as GridViewModel,
      thermalTiles: (isRegisteredProjectedThermalTiles(fields["thermalTiles"])
        ? fields["thermalTiles"]
        : copyOwnedThermalTiles(
            fields["thermalTiles"],
            source.width,
            source.height,
          )) as readonly ThermalTileState[],
      source,
      heatmapEnabled: fields["heatmapEnabled"] as boolean,
      nowMs: fields["nowMs"] as number,
    });
    assertValidInput(ownedInput);
    latestInput = ownedInput;
    const full = acknowledgedSource === null || resyncRequired || loadObserved(ownedInput.source);
    if (inFlight !== null) {
      // One publication in flight: coalesce into the single latest
      // pending candidate instead of chaining onto an unacknowledged base.
      // The pending delta is recomputed from the acknowledged baseline
      // when the in-flight publication is acknowledged.
      hasPending = full || contentDiffers(ownedInput) || sourceChanged(ownedInput.source);
      return null;
    }
    // Single build reused for the emptiness check and the emission.
    const built = buildPublication(ownedInput, full);
    if (!full && !built.contentChanged && !sourceChanged(ownedInput.source)) return null;
    resyncRequired = false;
    return emitBuilt(ownedInput, built);
  }

  function acknowledge(sequence: number): AcknowledgeResult {
    const current = inFlight;
    if (current !== null && sequence === current.sequence) {
      acknowledgedModules = new Map(current.modules);
      acknowledgedRoutes = new Map(current.routes);
      acknowledgedTemperatures = current.temperatures.slice();
      acknowledgedSource = { ...current.source };
      lastAcknowledgedRevision = current.nextRevision;
      inFlight = null;
      degraded = false;
      const pending = hasPending;
      hasPending = false;
      const retained = latestInput;
      let toSend: GridPublication | null = null;
      if (pending && retained !== null) toSend = publish(retained);
      return { status: "acknowledged", resyncRequired: false, toSend };
    }
    // Wrong sequence/base: request a full resync and apply nothing. The
    // presumed-dead in-flight publication is dropped, never chained onto.
    inFlight = null;
    hasPending = false;
    resyncRequired = true;
    return { status: "unknown-sequence", resyncRequired: true, toSend: null };
  }

  function requestResync(): void {
    resyncRequired = true;
  }

  function checkTimeout(nowMs: number): { readonly degraded: boolean } {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new TypeError("Grid checkTimeout nowMs must be finite and nonnegative.");
    }
    const current = inFlight;
    if (current !== null && !degraded && nowMs - current.sentAtMs > ACK_TIMEOUT_MS) {
      // Presumed lost: keep only the resync flag (the single latest
      // full-resync candidate is produced by the next publish call) and
      // signal degraded transport.
      inFlight = null;
      hasPending = false;
      resyncRequired = true;
      degraded = true;
    }
    return { degraded };
  }

  function getStatus(): GridPublisherStatus {
    return {
      epoch,
      nextPublicationSequence: nextSequence,
      lastAcknowledgedRevision,
      inFlightSequence: inFlight?.sequence ?? null,
      degraded,
      resyncRequired,
      hasPending,
    };
  }

  return { publish, acknowledge, requestResync, checkTimeout, getStatus };
}
