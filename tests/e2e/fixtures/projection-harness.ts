// Phase 2 Task 18.3 real-browser harness. Served by the Vite dev server
// for Playwright only; never referenced by production entries and never
// shipped in dist (vite build uses index.html alone). Every scenario below
// runs the REAL Task 18 stack in Chromium: content loading, production
// SimCore commands, the pure projector, the revision-aware publisher, the
// fake transport adapter and the immutable store with named selectors.

import { createFakeTransport } from "../../../src/app/game-client/fakeTransport.ts";
import * as selectors from "../../../src/app/game-client/selectors.ts";
import { createGameClientStore } from "../../../src/app/game-client/store.ts";
import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../../src/content/schemas/contentSchemas.ts";
import { createInitialGameState } from "../../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../../src/sim/core/productionSimCore.ts";
import type { SimCore } from "../../../src/sim/core/simCore.ts";
import type { GridPublication } from "../../../src/sim/selectors/gridPublication.ts";
import { createGridPublisher } from "../../../src/sim/selectors/gridPublication.ts";
import { projectGridViewModel, projectUiSnapshot } from "../../../src/sim/selectors/projector.ts";
import { createDefaultPresentationContext } from "../../../src/sim/selectors/presentationTypes.ts";

type Json = unknown;

interface ErrorJson {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

function toErrorJson(error: unknown): ErrorJson {
  return {
    ok: false,
    code: "HARNESS_FAILURE",
    message: error instanceof Error ? error.message : "Unknown harness failure.",
  };
}

function run<T extends Record<string, Json>>(
  work: () => T,
): { ok: true; data: T & { durationMs: number } } | ErrorJson {
  const started = performance.now();
  try {
    const data = work();
    return { ok: true, data: Object.assign(data, { durationMs: performance.now() - started }) };
  } catch (error: unknown) {
    return toErrorJson(error);
  }
}

let content: ContentBundle | null = null;
let sequence = 0;

function requireContent(): ContentBundle {
  content ??= loadContentBundle();
  return content;
}

function nextCommandId(): string {
  sequence += 1;
  return `66000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function createCore(seed: string): SimCore {
  const bundle = requireContent();
  return createProductionSimCore({
    content: bundle,
    initialState: createInitialGameState({ content: bundle, seed }),
  });
}

function acceptFirstResult(core: SimCore): void {
  const results = core.processPendingCommands();
  if (results.length !== 1 || results[0]?.accepted !== true) {
    throw new Error("Expected one accepted command result.");
  }
}

interface RoundTripStack {
  core: SimCore;
  publisher: ReturnType<typeof createGridPublisher>;
  store: ReturnType<typeof createGameClientStore>;
  transport: ReturnType<typeof createFakeTransport>;
  epoch: string;
  transportSequence: number;
}

function createStack(seed: string, epoch: string): RoundTripStack {
  const store = createGameClientStore();
  return {
    core: createCore(seed),
    publisher: createGridPublisher({
      epoch,
      dirtyEpsilonC: requireContent().balancing.thermal.dirtyEpsilonC,
    }),
    store,
    transport: createFakeTransport(store),
    epoch,
    transportSequence: 0,
  };
}

function roundTrip(stack: RoundTripStack): { gridRevision: number; heatTiles: number } {
  const bundle = requireContent();
  const state = stack.core.getStateForSave();
  const draft = state.facility.designDraft;
  const context = createDefaultPresentationContext();
  const snapshot = projectUiSnapshot(state, bundle, context);
  const publication = stack.publisher.publish({
    grid: projectGridViewModel(state, bundle, context),
    thermalTiles: state.facility.thermalTiles,
    source: {
      liveLayoutRevision: state.facility.liveLayoutRevision,
      draftRevision: draft?.revision ?? null,
      thermalRevision: state.facility.thermalRevision,
      viewMode: draft === null ? "live" : "draft",
      width: state.facility.size.width,
      height: state.facility.size.height,
    },
    heatmapEnabled: true,
    nowMs: stack.transportSequence,
  });
  const delivered = stack.transport.deliver({
    epoch: stack.epoch,
    sequence: stack.transportSequence,
    snapshot,
    grid: publication,
  });
  if (!delivered.delivered) throw new Error(`Delivery failed: ${delivered.reason}.`);
  stack.transportSequence += 1;
  if (publication !== null) {
    const ack = stack.publisher.acknowledge(publication.publicationSequence);
    if (ack.status !== "acknowledged") throw new Error("Acknowledgement failed.");
  }
  const grid = stack.store.getGridViewModel();
  if (grid === null) throw new Error("Store has no grid after delivery.");
  return { gridRevision: grid.revision, heatTiles: grid.heatmap?.values.length ?? -1 };
}

const harness = {
  roundTrip() {
    return run(() => {
      const stack = createStack("harness-round-trip", "harness-epoch-1");
      stack.core.enqueue({
        commandId: nextCommandId(),
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      });
      acceptFirstResult(stack.core);
      stack.core.enqueue({
        commandId: nextCommandId(),
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: "module-vacuum-tube-logic",
        position: { x: 0, y: 0 },
        rotation: 0,
      });
      acceptFirstResult(stack.core);
      const first = roundTrip(stack);
      const snapshot = stack.store.getSnapshot();
      if (snapshot === null) throw new Error("Store has no snapshot after delivery.");
      return {
        gridRevision: first.gridRevision,
        heatTiles: first.heatTiles,
        tick: snapshot.tick,
        mode: stack.store.getGridViewModel()?.mode ?? "missing",
        modules: stack.store.getGridViewModel()?.modules.length ?? -1,
        buildDesignMode: snapshot.build.designMode,
        headerYear:
          selectors.selectHeader({ snapshot, grid: stack.store.getGridViewModel() })?.year ?? -1,
        status: stack.store.getConnectionStatus(),
      };
    });
  },

  snapshotOnly() {
    return run(() => {
      const stack = createStack("harness-snapshot-only", "harness-epoch-2");
      roundTrip(stack);
      const offer = stack.core.getStateForSave().tasks.offers[0];
      if (offer === undefined) throw new Error("Expected an initial offer.");
      stack.core.enqueue({
        commandId: nextCommandId(),
        source: "player",
        kind: "ACCEPT_TASK",
        definitionId: offer,
      });
      acceptFirstResult(stack.core);
      const before = stack.store.getSnapshot();
      roundTrip(stack);
      const after = stack.store.getSnapshot();
      if (after === null) throw new Error("Store lost its snapshot.");
      return {
        tasks: after.tasks.length,
        headerPreserved: after.header === before?.header,
        rootChanged: after !== before,
        gridRevision: stack.store.getGridViewModel()?.revision ?? -1,
      };
    });
  },

  wrongBase() {
    return run(() => {
      const stack = createStack("harness-wrong-base", "harness-epoch-3");
      roundTrip(stack);
      const bundle = requireContent();
      const state = stack.core.getStateForSave();
      const context = createDefaultPresentationContext();
      const snapshot = projectUiSnapshot(state, bundle, context);
      const draft = state.facility.designDraft;
      const valid = stack.publisher.publish({
        grid: projectGridViewModel(state, bundle, context),
        thermalTiles: state.facility.thermalTiles,
        source: {
          liveLayoutRevision: state.facility.liveLayoutRevision,
          draftRevision: draft?.revision ?? null,
          thermalRevision: state.facility.thermalRevision + 1,
          viewMode: draft === null ? "live" : "draft",
          width: state.facility.size.width,
          height: state.facility.size.height,
        },
        heatmapEnabled: true,
        nowMs: stack.transportSequence + 1,
      });
      if (valid === null) throw new Error("Expected a valid publication to forge.");
      // A forged base on an otherwise valid envelope: protocol precedence
      // rejects it as resync-required before any ownership or application.
      const forged = {
        ...valid,
        baseGridRevision: (stack.store.getGridViewModel()?.revision ?? 0) + 100,
      } satisfies GridPublication;
      const result = stack.store.applyPublication({
        epoch: stack.epoch,
        snapshot,
        grid: forged,
      });
      if (result.applied || result.reason !== "resync-required") {
        throw new Error("Forged base was not rejected as resync-required.");
      }
      return { gridRevision: stack.store.getGridViewModel()?.revision ?? -1 };
    });
  },

  staleEpoch() {
    return run(() => {
      const stack = createStack("harness-stale-epoch", "harness-epoch-4");
      roundTrip(stack);
      const bundle = requireContent();
      const state = stack.core.getStateForSave();
      const context = createDefaultPresentationContext();
      const delivered = stack.transport.deliver({
        epoch: "foreign-epoch",
        sequence: stack.transportSequence,
        snapshot: projectUiSnapshot(state, bundle, context),
        grid: null,
      });
      if (delivered.delivered || delivered.reason !== "stale-epoch") {
        throw new Error("Foreign epoch was not rejected.");
      }
      return { status: stack.store.getConnectionStatus() };
    });
  },

  drift() {
    return run(() => {
      const stack = createStack("harness-drift", "harness-epoch-5");
      const bundle = requireContent();
      const publishTiles = (
        temperatures: readonly { x: number; y: number; temperatureC: number }[],
        thermalRevision: number,
        nowMs: number,
      ): number => {
        const state = stack.core.getStateForSave();
        const context = createDefaultPresentationContext();
        const tiles = state.facility.thermalTiles.map((tile, index) => {
          const override = temperatures[index];
          return override === undefined
            ? tile
            : { position: tile.position, temperatureC: override.temperatureC };
        });
        const publication = stack.publisher.publish({
          grid: projectGridViewModel(state, bundle, context),
          thermalTiles: tiles,
          source: {
            liveLayoutRevision: 0,
            draftRevision: null,
            thermalRevision,
            viewMode: "live",
            width: 24,
            height: 16,
          },
          heatmapEnabled: true,
          nowMs,
        });
        if (publication === null) throw new Error("Expected a source-advance emission.");
        const delivered = stack.transport.deliver({
          epoch: stack.epoch,
          sequence: stack.transportSequence,
          snapshot: projectUiSnapshot(state, bundle, context),
          grid: publication,
        });
        if (!delivered.delivered) throw new Error(`Delivery failed: ${delivered.reason}.`);
        stack.transportSequence += 1;
        const ack = stack.publisher.acknowledge(publication.publicationSequence);
        if (ack.status !== "acknowledged") throw new Error("Acknowledgement failed.");
        return publication.heatmap.values.length;
      };
      const base = stack.core.getStateForSave().facility.thermalTiles.map((tile) => ({
        x: tile.position.x,
        y: tile.position.y,
        temperatureC: tile.temperatureC,
      }));
      const first = publishTiles(base, 0, 0);
      const bumped = base.map((tile, index) =>
        index === 0 ? { ...tile, temperatureC: tile.temperatureC + 0.03 } : tile,
      );
      const drifted = publishTiles(bumped, 1, 1);
      const due = publishTiles(
        bumped.map((tile, index) =>
          index === 0 ? { ...tile, temperatureC: tile.temperatureC + 0.03 } : tile,
        ),
        2,
        2,
      );
      return { first, drifted, due };
    });
  },

  twentyCycles() {
    return run(() => {
      const store = createGameClientStore();
      const noop = (): void => undefined;
      for (let cycle = 0; cycle < 20; cycle += 1) {
        const release = store.subscribe(noop);
        const selection = store.select(selectors.selectHeader, noop);
        release();
        selection.unsubscribe();
      }
      return { subscriptions: store.getSubscriptionCount() };
    });
  },
};

type ProjectionHarness = typeof harness;

declare global {
  interface Window {
    __projectionHarness?: ProjectionHarness;
  }
}

window.__projectionHarness = harness;
document.getElementById("projection-harness")?.setAttribute("data-ready", "true");
