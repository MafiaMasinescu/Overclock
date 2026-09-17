import { describe, expect, test } from "vitest";

import * as selectors from "../../src/app/game-client/selectors.ts";
import {
  createFakeTransport,
  type FakeTransport,
} from "../../src/app/game-client/fakeTransport.ts";
import { createGameClientStore, type GameClientStore } from "../../src/app/game-client/store.ts";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import type { SimCore } from "../../src/sim/core/simCore.ts";
import type { GridPublication } from "../../src/sim/selectors/gridPublication.ts";
import {
  createGridPublisher,
  type GridPublisher,
} from "../../src/sim/selectors/gridPublication.ts";
import { projectGridViewModel, projectUiSnapshot } from "../../src/sim/selectors/projector.ts";
import { createDefaultPresentationContext } from "../../src/sim/selectors/presentationTypes.ts";
import type { UiSnapshot } from "../../src/sim/selectors/presentationTypes.ts";

const content: ContentBundle = loadContentBundle();

function commandId(sequence: number): string {
  return `65000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

interface Pipeline {
  core: SimCore;
  publisher: GridPublisher;
  store: GameClientStore;
  transport: FakeTransport;
  epoch: string;
  sequence: number;
  nowMs: number;
}

function createPipeline(seed: string, epoch: string): Pipeline {
  const core = createProductionSimCore({
    content,
    initialState: createInitialGameState({ content, seed }),
  });
  const store = createGameClientStore();
  return {
    core,
    publisher: createGridPublisher({
      epoch,
      dirtyEpsilonC: content.balancing.thermal.dirtyEpsilonC,
    }),
    store,
    transport: createFakeTransport(store),
    epoch,
    sequence: 0,
    nowMs: 0,
  };
}

function dispatchAccepted(core: SimCore, command: SimCommand): void {
  core.enqueue(command);
  const results = core.processPendingCommands();
  expect(results).toHaveLength(1);
  expect(results[0]?.accepted).toBe(true);
}

// Projects the current core state and publishes; the publication is null
// when the grid carries no change (snapshot-only cadence, §7.1).
function projectAndPublish(pipe: Pipeline): {
  snapshot: UiSnapshot;
  publication: GridPublication | null;
} {
  const state = pipe.core.getStateForSave();
  const draft = state.facility.designDraft;
  const snapshot = projectUiSnapshot(state, content, createDefaultPresentationContext());
  const publication = pipe.publisher.publish({
    grid: projectGridViewModel(state, content, createDefaultPresentationContext()),
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
    nowMs: pipe.nowMs,
  });
  return { snapshot, publication };
}

function deliverAndAck(
  pipe: Pipeline,
  snapshot: UiSnapshot,
  publication: GridPublication | null,
): void {
  const delivered = pipe.transport.deliver({
    epoch: pipe.epoch,
    sequence: pipe.sequence,
    snapshot,
    grid: publication,
  });
  expect(delivered).toEqual({ delivered: true });
  pipe.sequence += 1;
  pipe.nowMs += 1;
  if (publication === null) return;
  const ack = pipe.publisher.acknowledge(publication.publicationSequence);
  expect(ack.status).toBe("acknowledged");
  if (ack.toSend !== null) {
    // Coalesced pending follows the same host loop exactly once; these
    // tests never stack pending twice.
    const followup = pipe.transport.deliver({
      epoch: pipe.epoch,
      sequence: pipe.sequence,
      snapshot,
      grid: ack.toSend,
    });
    expect(followup).toEqual({ delivered: true });
    pipe.sequence += 1;
    expect(pipe.publisher.acknowledge(ack.toSend.publicationSequence).status).toBe("acknowledged");
  }
}

// Projects the current core state and moves one publisher/transport/store
// round trip, acknowledging the publisher like a healthy host would.
function roundTrip(pipe: Pipeline): { snapshot: UiSnapshot; publication: GridPublication | null } {
  const { snapshot, publication } = projectAndPublish(pipe);
  deliverAndAck(pipe, snapshot, publication);
  return { snapshot, publication };
}

describe("store lifecycle", () => {
  test("starts empty, disconnected and listener-free", () => {
    const store = createGameClientStore();
    expect(store.getSnapshot()).toBeNull();
    expect(store.getGridViewModel()).toBeNull();
    expect(store.getConnectionStatus()).toBe("disconnected");
    expect(store.getSubscriptionCount()).toBe(0);
  });

  test("adopts the first full publication atomically and goes live", () => {
    const pipe = createPipeline("store-first", "store-epoch-1");
    const { snapshot, publication } = roundTrip(pipe);

    expect(pipe.store.getSnapshot()).toBe(snapshot);
    const grid = pipe.store.getGridViewModel();
    expect(grid).not.toBeNull();
    expect(grid?.revision).toBe(1);
    expect(grid?.mode).toBe("live");
    expect(grid?.heatmap?.full).toBe(true);
    expect(grid?.heatmap?.values).toHaveLength(384);
    expect(pipe.store.getConnectionStatus()).toBe("live");
    expect(publication?.nextGridRevision).toBe(1);
  });

  test("rejects a non-full initial publication without applying anything", () => {
    const pipe = createPipeline("store-nonfull", "store-epoch-2");
    // Advance the publisher past its full snapshots so a real delta exists,
    // then replay that delta against a fresh store that never saw one.
    roundTrip(pipe);
    dispatchAccepted(pipe.core, {
      commandId: commandId(1),
      source: "player",
      kind: "ENTER_DESIGN_MODE",
    });
    roundTrip(pipe);
    dispatchAccepted(pipe.core, {
      commandId: commandId(2),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: "module-vacuum-tube-logic",
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    const { snapshot, publication } = projectAndPublish(pipe);
    expect(publication?.heatmap.full).toBe(false);
    if (publication === null) throw new Error("Expected a delta publication.");

    const fresh = createGameClientStore();
    const result = fresh.applyPublication({ epoch: pipe.epoch, snapshot, grid: publication });
    expect(result).toEqual({ applied: false, reason: "resync-required" });
    expect(fresh.getSnapshot()).toBeNull();
    expect(fresh.getGridViewModel()).toBeNull();
    expect(fresh.getConnectionStatus()).toBe("disconnected");
  });

  test("snapshot-only messages never bootstrap grid state", () => {
    const fresh = createGameClientStore();
    const pipe = createPipeline("store-boot", "store-epoch-2b");
    const { snapshot } = projectAndPublish(pipe);
    expect(fresh.applyPublication({ epoch: pipe.epoch, snapshot, grid: null })).toEqual({
      applied: false,
      reason: "resync-required",
    });
    expect(fresh.getSnapshot()).toBeNull();
  });

  test("wrong base applies nothing and keeps stable references", () => {
    const pipe = createPipeline("store-wrongbase", "store-epoch-3");
    const { snapshot, publication } = roundTrip(pipe);
    const gridBefore = pipe.store.getGridViewModel();
    if (publication === null) throw new Error("Expected a full publication.");

    const tampered: GridPublication = { ...publication, baseGridRevision: 999 };
    const result = pipe.store.applyPublication({ epoch: pipe.epoch, snapshot, grid: tampered });
    expect(result).toEqual({ applied: false, reason: "resync-required" });
    expect(pipe.store.getSnapshot()).toBe(snapshot);
    expect(pipe.store.getGridViewModel()).toBe(gridBefore);
  });

  test("stale epoch is rejected at transport and store boundaries", () => {
    const pipe = createPipeline("store-epoch", "store-epoch-4");
    const { snapshot, publication } = roundTrip(pipe);
    if (publication === null) throw new Error("Expected a full publication.");

    expect(
      pipe.transport.deliver({ epoch: "other-epoch", sequence: 1, snapshot, grid: publication }),
    ).toEqual({ delivered: false, reason: "stale-epoch" });
    expect(
      pipe.store.applyPublication({
        epoch: "other-epoch",
        snapshot,
        grid: { ...publication, epoch: "other-epoch" },
      }),
    ).toEqual({ applied: false, reason: "stale-epoch" });
    expect(pipe.store.getSnapshot()).toBe(snapshot);
  });

  test("unfrozen inputs throw and leave the store intact", () => {
    const pipe = createPipeline("store-frozen", "store-epoch-5");
    const { snapshot } = roundTrip(pipe);

    // Snapshot-only applies pass the protocol checks, so the freeze
    // boundary is what rejects these inputs.
    expect(() =>
      pipe.store.applyPublication({ epoch: pipe.epoch, snapshot: { ...snapshot }, grid: null }),
    ).toThrow(TypeError);
    const cloned = JSON.parse(JSON.stringify(snapshot)) as UiSnapshot;
    expect(() =>
      pipe.store.applyPublication({ epoch: pipe.epoch, snapshot: cloned, grid: null }),
    ).toThrow(TypeError);
    expect(pipe.store.getSnapshot()).toBe(snapshot);
  });

  test("epoch rotation resets explicitly and requires a fresh full snapshot", () => {
    const pipe = createPipeline("store-rotation", "store-epoch-6");
    roundTrip(pipe);
    expect(pipe.store.getSnapshot()).not.toBeNull();

    pipe.store.resetForEpoch("store-epoch-7");
    expect(pipe.store.getSnapshot()).toBeNull();
    expect(pipe.store.getGridViewModel()).toBeNull();
    expect(pipe.store.getConnectionStatus()).toBe("disconnected");
    expect(() => {
      pipe.store.resetForEpoch("bad epoch!");
    }).toThrow(TypeError);

    pipe.transport.resetForEpoch("store-epoch-7");
    pipe.epoch = "store-epoch-7";
    pipe.sequence = 0;
    // A new epoch takes a fresh publisher whose first emission is full.
    pipe.publisher = createGridPublisher({
      epoch: pipe.epoch,
      dirtyEpsilonC: content.balancing.thermal.dirtyEpsilonC,
    });
    const { snapshot } = roundTrip(pipe);
    expect(pipe.store.getSnapshot()).toBe(snapshot);
    expect(pipe.store.getConnectionStatus()).toBe("live");
  });
});

describe("section preservation and selectors", () => {
  test("deeply freezes every nested grid value adopted by the store", () => {
    const pipe = createPipeline("store-deep-freeze", "store-epoch-deep-freeze");
    roundTrip(pipe);
    const grid = pipe.store.getGridViewModel();
    expect(grid).not.toBeNull();
    expect(Object.isFrozen(grid)).toBe(true);
    expect(Object.isFrozen(grid?.gridSize)).toBe(true);
    expect(Object.isFrozen(grid?.modules)).toBe(true);
    expect(Object.isFrozen(grid?.routes)).toBe(true);
    expect(Object.isFrozen(grid?.heatmap)).toBe(true);
    expect(Object.isFrozen(grid?.heatmap?.values)).toBe(true);
    expect(Object.isFrozen(grid?.heatmap?.values[0])).toBe(true);
  });

  test("failed first admission does not bind the epoch", () => {
    const pipe = createPipeline("store-first-admission", "store-epoch-first");
    const { snapshot, publication } = projectAndPublish(pipe);
    if (publication === null) throw new Error("Expected a full publication.");
    const fresh = createGameClientStore();
    expect(() =>
      fresh.applyPublication({ epoch: pipe.epoch, snapshot: { ...snapshot }, grid: publication }),
    ).toThrow(TypeError);
    expect(fresh.getSnapshot()).toBeNull();
    expect(fresh.getGridViewModel()).toBeNull();
    expect(fresh.applyPublication({ epoch: pipe.epoch, snapshot, grid: publication })).toEqual({
      applied: true,
    });
  });

  test("rejects mismatched wrapper and nested publication epochs atomically", () => {
    const pipe = createPipeline("store-nested-epoch", "store-epoch-nested");
    const { snapshot, publication } = projectAndPublish(pipe);
    if (publication === null) throw new Error("Expected a full publication.");
    const fresh = createGameClientStore();
    expect(
      fresh.applyPublication({
        epoch: pipe.epoch,
        snapshot,
        grid: { ...publication, epoch: "different-grid-epoch" },
      }),
    ).toEqual({ applied: false, reason: "stale-epoch" });
    expect(fresh.getSnapshot()).toBeNull();
    expect(fresh.getGridViewModel()).toBeNull();
  });

  test("equal sections keep their references across applies", () => {
    const pipe = createPipeline("store-sections", "store-epoch-8");
    const first = roundTrip(pipe);
    const gridBefore = pipe.store.getGridViewModel();

    // A draft edit changes build/draft content while header, tasks and
    // telemetry values stay identical: fresh objects, preserved references.
    dispatchAccepted(pipe.core, {
      commandId: commandId(1),
      source: "player",
      kind: "ENTER_DESIGN_MODE",
    });
    const second = roundTrip(pipe);
    void second;
    const stored = pipe.store.getSnapshot();
    expect(stored).not.toBe(first.snapshot);
    expect(stored?.header).toBe(first.snapshot.header);
    expect(stored?.tasks).toBe(first.snapshot.tasks);
    expect(stored?.telemetry).toBe(first.snapshot.telemetry);
    expect(stored?.build).not.toBe(first.snapshot.build);
    expect(pipe.store.getSnapshot()).toBe(stored);
    // The grid changed mode and layout revision: a distinct reference.
    expect(pipe.store.getGridViewModel()).not.toBe(gridBefore);
    expect(pipe.store.getGridViewModel()?.mode).toBe("draft");
  });

  test("isolates selector and equality failures after a committed apply", () => {
    const pipe = createPipeline("store-callback-failure", "store-epoch-callback");
    roundTrip(pipe);
    let selectorCalls = 0;
    let listenerCalls = 0;
    let equalityCalls = 0;
    pipe.store.select(
      (state) => {
        selectorCalls += 1;
        if (selectorCalls === 2) throw new Error("selector failure");
        return state.snapshot?.tick ?? null;
      },
      () => {
        listenerCalls += 1;
      },
      () => {
        equalityCalls += 1;
        if (equalityCalls === 2) throw new Error("equality failure");
        return false;
      },
    );
    let ordinaryListenerCalls = 0;
    pipe.store.subscribe(() => {
      ordinaryListenerCalls += 1;
    });

    expect(
      pipe.core.applyClockCommand({
        commandId: commandId(101),
        source: "player",
        kind: "SET_PAUSED",
        paused: false,
      }).accepted,
    ).toBe(true);
    expect(() => roundTrip(pipe)).not.toThrow();
    expect(ordinaryListenerCalls).toBe(1);
    expect(listenerCalls).toBe(0);

    expect(
      pipe.core.applyClockCommand({
        commandId: commandId(102),
        source: "player",
        kind: "SET_PAUSED",
        paused: true,
      }).accepted,
    ).toBe(true);
    expect(() => roundTrip(pipe)).not.toThrow();
    expect(ordinaryListenerCalls).toBe(2);
    expect(listenerCalls).toBe(1);
  });

  test("a failed selector listener does not advance its notification baseline", () => {
    const pipe = createPipeline("store-listener-retry", "store-epoch-listener-retry");
    roundTrip(pipe);
    let calls = 0;
    pipe.store.select(
      (state) => state.snapshot?.header.paused ?? null,
      () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary listener failure");
      },
    );

    expect(
      pipe.core.applyClockCommand({
        commandId: commandId(103),
        source: "player",
        kind: "SET_PAUSED",
        paused: false,
      }).accepted,
    ).toBe(true);
    expect(() => roundTrip(pipe)).not.toThrow();
    expect(calls).toBe(1);

    expect(
      pipe.core.applyClockCommand({
        commandId: commandId(104),
        source: "player",
        kind: "SET_SPEED",
        speed: 2,
      }).accepted,
    ).toBe(true);
    expect(() => roundTrip(pipe)).not.toThrow();
    expect(calls).toBe(2);
  });

  test("selector subscriptions notify on change with default and custom equality", () => {
    const pipe = createPipeline("store-select", "store-epoch-9");
    roundTrip(pipe);

    const headerCalls: unknown[] = [];
    const taskCalls: unknown[] = [];
    const headerSub = pipe.store.select(selectors.selectHeader, (value) => {
      headerCalls.push(value);
    });
    const tasksSub = pipe.store.select(selectors.selectTasks, (value) => {
      taskCalls.push(value);
    });
    expect(pipe.store.getSubscriptionCount()).toBe(2);

    // Draft edit changes build/draft sections but not header or tasks.
    dispatchAccepted(pipe.core, {
      commandId: commandId(1),
      source: "player",
      kind: "ENTER_DESIGN_MODE",
    });
    roundTrip(pipe);
    expect(headerCalls).toHaveLength(0);
    expect(taskCalls).toHaveLength(0);

    // Accepting a task changes the task section only.
    const offer = pipe.core.getStateForSave().tasks.offers[0];
    expect(offer).toBeDefined();
    if (offer === undefined) throw new Error("Expected an initial offer.");
    dispatchAccepted(pipe.core, {
      commandId: commandId(2),
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: offer,
    });
    roundTrip(pipe);
    expect(headerCalls).toHaveLength(0);
    expect(taskCalls).toHaveLength(1);

    // Custom equality that never observes a difference silences notifies.
    const silentCalls: unknown[] = [];
    const silent = pipe.store.select(
      selectors.selectSnapshot,
      (value) => {
        silentCalls.push(value);
      },
      () => true,
    );
    dispatchAccepted(pipe.core, {
      commandId: commandId(3),
      source: "player",
      kind: "CANCEL_DESIGN",
    });
    roundTrip(pipe);
    expect(silentCalls).toHaveLength(0);

    headerSub.unsubscribe();
    tasksSub.unsubscribe();
    silent.unsubscribe();
    expect(pipe.store.getSubscriptionCount()).toBe(0);
    // Double unsubscribe is idempotent.
    headerSub.unsubscribe();
    expect(pipe.store.getSubscriptionCount()).toBe(0);
  });

  test("reentrant subscribe and throwing listeners are isolated", () => {
    const pipe = createPipeline("store-reentrant", "store-epoch-10");
    roundTrip(pipe);

    const order: string[] = [];
    const lateReleases: (() => void)[] = [];
    const firstUnsubscribe = pipe.store.subscribe(() => {
      order.push("first");
      if (lateReleases.length === 0) {
        lateReleases.push(
          pipe.store.subscribe(() => {
            order.push("late");
          }),
        );
      }
    });
    const throwingUnsubscribe = pipe.store.subscribe(() => {
      order.push("throwing");
      throw new Error("Listener failure must stay isolated.");
    });
    const secondUnsubscribe = pipe.store.subscribe(() => {
      order.push("second");
    });

    dispatchAccepted(pipe.core, {
      commandId: commandId(1),
      source: "player",
      kind: "ENTER_DESIGN_MODE",
    });
    roundTrip(pipe);
    expect(order).toEqual(["first", "throwing", "second"]);
    expect(pipe.store.getSnapshot()).not.toBeNull();

    // A snapshot-only change still notifies; the late subscriber joined
    // during the previous notify and now observes too.
    const offer = pipe.core.getStateForSave().tasks.offers[0];
    if (offer === undefined) throw new Error("Expected an initial offer.");
    dispatchAccepted(pipe.core, {
      commandId: commandId(2),
      source: "player",
      kind: "ACCEPT_TASK",
      definitionId: offer,
    });
    roundTrip(pipe);
    // Set insertion order: the late subscriber joined during the previous
    // notify, so it observes after the three initial subscribers.
    expect(order).toEqual(["first", "throwing", "second", "first", "throwing", "second", "late"]);

    firstUnsubscribe();
    throwingUnsubscribe();
    secondUnsubscribe();
    for (const release of lateReleases) release();
    expect(pipe.store.getSubscriptionCount()).toBe(0);
  });

  test("identical republications apply silently without notifying", () => {
    const pipe = createPipeline("store-silent", "store-epoch-10b");
    roundTrip(pipe);
    const snapshotBefore = pipe.store.getSnapshot();
    const gridBefore = pipe.store.getGridViewModel();

    const calls: string[] = [];
    const release = pipe.store.subscribe(() => {
      calls.push("notified");
    });
    // No state change: the grid publisher emits nothing and the snapshot
    // applies silently with stable references (the fresh projection object
    // is dropped in favor of the preserved root).
    const { publication } = roundTrip(pipe);
    expect(publication).toBeNull();
    expect(pipe.store.getSnapshot()).toBe(snapshotBefore);
    expect(pipe.store.getGridViewModel()).toBe(gridBefore);
    expect(calls).toEqual([]);
    release();
    expect(pipe.store.getSubscriptionCount()).toBe(0);
  });

  test("connection status is explicit and validated", () => {
    const store = createGameClientStore();
    expect(store.getConnectionStatus()).toBe("disconnected");
    store.setConnectionStatus("degraded");
    expect(store.getConnectionStatus()).toBe("degraded");
    store.setConnectionStatus("resync-required");
    expect(store.getConnectionStatus()).toBe("resync-required");
    store.setConnectionStatus("live");
    expect(store.getConnectionStatus()).toBe("live");
    expect(() => {
      store.setConnectionStatus("bogus" as unknown as "live");
    }).toThrow(TypeError);
  });

  test("store exposes no event-mutation path and a fixed surface", () => {
    const store = createGameClientStore();
    expect("subscribeEvents" in store).toBe(false);
    expect(Object.keys(store).toSorted()).toEqual([
      "applyPublication",
      "getConnectionStatus",
      "getGridViewModel",
      "getSnapshot",
      "getSubscriptionCount",
      "resetForEpoch",
      "select",
      "setConnectionStatus",
      "subscribe",
    ]);
  });

  test("named selectors cover sections and entities, never tiles", () => {
    for (const name of Object.keys(selectors)) {
      expect(name.toLowerCase()).not.toContain("tile");
    }
    const pipe = createPipeline("store-named", "store-epoch-11");
    const empty = { snapshot: null, grid: null };
    expect(selectors.selectHeader(empty)).toBeNull();
    expect(selectors.selectHeatmap(empty)).toBeNull();

    dispatchAccepted(pipe.core, {
      commandId: commandId(1),
      source: "player",
      kind: "ENTER_DESIGN_MODE",
    });
    dispatchAccepted(pipe.core, {
      commandId: commandId(2),
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: "module-vacuum-tube-logic",
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    roundTrip(pipe);
    const state = { snapshot: pipe.store.getSnapshot(), grid: pipe.store.getGridViewModel() };
    expect(selectors.selectHeader(state)?.year).toBe(1946);
    expect(selectors.selectGridModules(state)).toHaveLength(1);
    expect(selectors.selectGridModuleById(state, "module-instance-00000001")?.definitionId).toBe(
      "module-vacuum-tube-logic",
    );
    expect(selectors.selectGridModuleById(state, "ghost")).toBeNull();
    expect(selectors.selectHeatmap(state)?.values).toHaveLength(384);
    expect(selectors.selectBuild(state)?.designMode).toBe(true);
  });

  test("twenty mount and unmount cycles leave no subscriptions behind", () => {
    const store = createGameClientStore();
    const noop = (): void => undefined;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const releaseSnapshot = store.subscribe(noop);
      const selection = store.select(selectors.selectHeader, noop);
      const oneShot = store.select(selectors.selectGrid);
      expect(oneShot.value).toBeNull();
      releaseSnapshot();
      selection.unsubscribe();
    }
    expect(store.getSubscriptionCount()).toBe(0);
  });
});

describe("fake transport ordering", () => {
  test("rejects gaps and duplicates without touching the store", () => {
    const pipe = createPipeline("store-transport", "store-epoch-12");
    const state = pipe.core.getStateForSave();
    const snapshot = projectUiSnapshot(state, content, createDefaultPresentationContext());
    const publication = pipe.publisher.publish({
      grid: projectGridViewModel(state, content, createDefaultPresentationContext()),
      thermalTiles: state.facility.thermalTiles,
      source: {
        liveLayoutRevision: 0,
        draftRevision: null,
        thermalRevision: 0,
        viewMode: "live",
        width: 24,
        height: 16,
      },
      heatmapEnabled: true,
      nowMs: 0,
    });
    if (publication === null) throw new Error("Expected a publication.");

    expect(
      pipe.transport.deliver({ epoch: pipe.epoch, sequence: 1, snapshot, grid: publication }),
    ).toEqual({ delivered: false, reason: "sequence-gap" });
    expect(pipe.store.getSnapshot()).toBeNull();
    expect(
      pipe.transport.deliver({ epoch: pipe.epoch, sequence: 0, snapshot, grid: publication }),
    ).toEqual({ delivered: true });
    expect(
      pipe.transport.deliver({ epoch: pipe.epoch, sequence: 0, snapshot, grid: publication }),
    ).toEqual({ delivered: false, reason: "sequence-gap" });
    expect(pipe.store.getSnapshot()).toBe(snapshot);
  });
});
