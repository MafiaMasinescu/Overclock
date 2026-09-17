import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import type { SimCore } from "../../src/sim/core/simCore.ts";
import {
  calculateDesignApplyPreview,
  isDesignApplyPreviewRejection,
} from "../../src/sim/design/designApplyPreview.ts";
import {
  createGridPublisher,
  type GridPublishInput,
  type GridPublisher,
} from "../../src/sim/selectors/gridPublication.ts";
import { projectGridViewModel } from "../../src/sim/selectors/projector.ts";
import { createDefaultPresentationContext } from "../../src/sim/selectors/presentationTypes.ts";
import type { ThermalTileState } from "../../src/sim/core/types.ts";

const content: ContentBundle = loadContentBundle();
const EPSILON = content.balancing.thermal.dirtyEpsilonC;

function commandId(sequence: number): string {
  return `64000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function createCore(seed: string): SimCore {
  return createProductionSimCore({
    content,
    initialState: createInitialGameState({ content, seed }),
  });
}

function dispatchAccepted(core: SimCore, command: SimCommand): void {
  core.enqueue(command);
  const results = core.processPendingCommands();
  expect(results).toHaveLength(1);
  expect(results[0]?.accepted).toBe(true);
}

function enterDesign(core: SimCore, sequence: number): void {
  dispatchAccepted(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "ENTER_DESIGN_MODE",
  });
}

function place(
  core: SimCore,
  sequence: number,
  definitionId: string,
  position: { x: number; y: number },
): void {
  dispatchAccepted(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "PLACE_MODULE",
    definitionId,
    position,
    rotation: 0,
  });
}

function createPublisher(epochSuffix: string): GridPublisher {
  return createGridPublisher({ epoch: `test-epoch-${epochSuffix}`, dirtyEpsilonC: EPSILON });
}

function applyDraft(core: SimCore, sequence: number): void {
  const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
  if (isDesignApplyPreviewRejection(preview))
    throw new Error("Apply preview blocked unexpectedly.");
  dispatchAccepted(core, {
    commandId: commandId(sequence),
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: preview.draftRevision,
    acceptedCostUsd: preview.netCostUsd,
    acceptedDowntimeTicks: preview.downtimeTicks,
  });
}

function publishInput(
  core: SimCore,
  nowMs: number,
  overrides?: {
    thermalTiles?: readonly ThermalTileState[];
    thermalRevision?: number;
    liveLayoutRevision?: number;
    heatmapEnabled?: boolean;
  },
): GridPublishInput {
  const state = core.getStateForSave();
  const draft = state.facility.designDraft;
  return {
    grid: projectGridViewModel(state, content, createDefaultPresentationContext()),
    thermalTiles: overrides?.thermalTiles ?? state.facility.thermalTiles,
    source: {
      liveLayoutRevision: overrides?.liveLayoutRevision ?? state.facility.liveLayoutRevision,
      draftRevision: draft?.revision ?? null,
      thermalRevision: overrides?.thermalRevision ?? state.facility.thermalRevision,
      viewMode: draft === null ? "live" : "draft",
      width: state.facility.size.width,
      height: state.facility.size.height,
    },
    heatmapEnabled: overrides?.heatmapEnabled ?? true,
    nowMs,
  };
}

function withTileBump(
  tiles: readonly ThermalTileState[],
  x: number,
  y: number,
  width: number,
  delta: number,
): ThermalTileState[] {
  return tiles.map((tile, index) => {
    if (index === y * width + x) {
      return { position: tile.position, temperatureC: tile.temperatureC + delta };
    }
    return tile;
  });
}

function assertNoExposedScratch(value: unknown): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    expect(ArrayBuffer.isView(current)).toBe(false);
    if (current !== null && typeof current === "object") {
      for (const key of Reflect.ownKeys(current)) {
        stack.push((current as Record<string | symbol, unknown>)[key as string]);
      }
    }
  }
}

describe("publisher options and input validation", () => {
  test("rejects malformed epochs and epsilons", () => {
    expect(() => createGridPublisher({ epoch: "", dirtyEpsilonC: EPSILON })).toThrow(TypeError);
    expect(() => createGridPublisher({ epoch: "has space", dirtyEpsilonC: EPSILON })).toThrow(
      TypeError,
    );
    expect(() => createGridPublisher({ epoch: "x".repeat(65), dirtyEpsilonC: EPSILON })).toThrow(
      TypeError,
    );
    expect(() => createGridPublisher({ epoch: "ok-1", dirtyEpsilonC: 0 })).toThrow(TypeError);
    expect(() => createGridPublisher({ epoch: "ok-1", dirtyEpsilonC: Number.NaN })).toThrow(
      TypeError,
    );
  });

  test("rejects inconsistent publish inputs", () => {
    const core = createCore("publication-validation");
    const publisher = createPublisher("validation");
    const base = publishInput(core, 0);
    expect(() => publisher.publish({ ...base, nowMs: Number.NaN })).toThrow(TypeError);
    expect(() => publisher.publish({ ...base, source: { ...base.source, width: 12 } })).toThrow(
      TypeError,
    );
    expect(() =>
      publisher.publish({ ...base, thermalTiles: base.thermalTiles.slice(0, 100) }),
    ).toThrow(TypeError);
    expect(() =>
      publisher.publish({ ...base, source: { ...base.source, liveLayoutRevision: -1 } }),
    ).toThrow(TypeError);
  });

  test("rejects accessor-backed input before invoking its getter", () => {
    const core = createCore("publication-accessor-boundary");
    const publisher = createPublisher("accessor-boundary");
    const input = { ...publishInput(core, 0) };
    let getterCalls = 0;
    Object.defineProperty(input, "grid", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return publishInput(core, 0).grid;
      },
    });
    expect(() => publisher.publish(input)).toThrow(TypeError);
    expect(getterCalls).toBe(0);
    expect(publisher.getStatus().nextPublicationSequence).toBe(0);
  });

  test("rejects frozen accessor-backed thermal tiles without invoking the getter", () => {
    const core = createCore("publication-frozen-thermal-accessor");
    const publisher = createPublisher("frozen-thermal-accessor");
    const input = publishInput(core, 0);
    const malicious = { position: { x: 0, y: 0 } };
    let getterCalls = 0;
    Object.defineProperty(malicious, "temperatureC", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 22;
      },
    });
    const thermalTiles = [...input.thermalTiles];
    thermalTiles[0] = Object.freeze(malicious) as ThermalTileState;
    Object.freeze(thermalTiles);
    expect(() => publisher.publish({ ...input, thermalTiles })).toThrow(TypeError);
    expect(getterCalls).toBe(0);
    expect(publisher.getStatus().nextPublicationSequence).toBe(0);
  });

  test("rejects accessor-backed nested source before invoking the getter", () => {
    const core = createCore("publication-source-accessor");
    const publisher = createPublisher("source-accessor");
    const input = publishInput(core, 0);
    const source = { ...input.source };
    let getterCalls = 0;
    Object.defineProperty(source, "width", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 24;
      },
    });
    expect(() => publisher.publish({ ...input, source })).toThrow(TypeError);
    expect(getterCalls).toBe(0);
    expect(publisher.getStatus().nextPublicationSequence).toBe(0);
  });
});

test("repeats owned projection and full publication exactly 100 times without changing state or RNG", () => {
  const initial = createInitialGameState({ content, seed: "task-18-exact-100" });
  const expectedHash = hashCanonicalState(initial);
  const expectedRngState = initial.rngState;
  const outputs = new Set<string>();
  for (let run = 0; run < 100; run += 1) {
    const core = createProductionSimCore({ content, initialState: initial });
    const presentation = core.getPresentation(createDefaultPresentationContext());
    const publisher = createPublisher("exact-100");
    const publication = publisher.publish({
      grid: presentation.grid,
      thermalTiles: presentation.thermalTiles,
      source: presentation.source,
      heatmapEnabled: true,
      nowMs: 0,
    });
    if (publication === null) throw new Error("Initial full publication is missing.");
    outputs.add(canonicalSerialize({ presentation, publication }));
    expect(publisher.acknowledge(publication.publicationSequence).status).toBe("acknowledged");
    const unchanged = core.getStateForSave();
    expect(hashCanonicalState(unchanged)).toBe(expectedHash);
    expect(unchanged.rngState).toBe(expectedRngState);
  }
  expect(outputs.size).toBe(1);
});

describe("full and delta publication", () => {
  test("first publish is a full snapshot with exact row-major tiles", () => {
    const core = createCore("publication-full");
    enterDesign(core, 1);
    place(core, 2, "module-power-distribution", { x: 0, y: 0 });
    place(core, 3, "module-vacuum-tube-logic", { x: 3, y: 0 });
    const publisher = createPublisher("full");

    const publication = publisher.publish(publishInput(core, 0));
    expect(publication).not.toBeNull();
    expect(publication?.epoch).toBe("test-epoch-full");
    expect(publication?.publicationSequence).toBe(0);
    expect(publication?.baseGridRevision).toBe(0);
    expect(publication?.nextGridRevision).toBe(1);
    expect(publication?.viewMode).toBe("draft");
    expect(publication?.source.liveLayoutRevision).toBe(0);
    expect(publication?.source.draftRevision).toBe(2);
    expect(publication?.entities.upsertModules.map((view) => view.id)).toEqual([
      "module-instance-00000001",
      "module-instance-00000002",
    ]);
    expect(publication?.entities.removeModuleIds).toEqual([]);
    expect(publication?.entities.upsertRoutes).toEqual([]);
    expect(publication?.entities.removeRouteIds).toEqual([]);
    expect(publication?.heatmap.full).toBe(true);
    expect(publication?.heatmap.values).toHaveLength(24 * 16);
    expect(publication?.heatmap.values[0]).toEqual({ x: 0, y: 0, temperatureC: 22 });
    expect(publication?.heatmap.values[24 * 16 - 1]).toEqual({ x: 23, y: 15, temperatureC: 22 });
    for (const [index, value] of (publication?.heatmap.values ?? []).entries()) {
      expect(value.x).toBe(index % 24);
      expect(value.y).toBe(Math.floor(index / 24));
    }
    expect(Object.isFrozen(publication)).toBe(true);
    expect(Object.isFrozen(publication?.entities)).toBe(true);
    expect(Object.isFrozen(publication?.heatmap)).toBe(true);
    expect(Object.isFrozen(publication?.heatmap.values)).toBe(true);
    if (publication !== null) assertNoExposedScratch(publication);
  });

  test("first full publication remains complete when heatmap rendering is disabled", () => {
    const core = createCore("publication-full-disabled");
    const publisher = createPublisher("full-disabled");
    const publication = publisher.publish(publishInput(core, 0, { heatmapEnabled: false }));
    expect(publication?.heatmap.full).toBe(true);
    expect(publication?.heatmap.values).toHaveLength(24 * 16);
    expect(publication?.heatmap.values[0]).toEqual({ x: 0, y: 0, temperatureC: 22 });
    expect(publication?.heatmap.values.at(-1)).toEqual({ x: 23, y: 15, temperatureC: 22 });
  });

  test("unchanged republish emits nothing and applies on acknowledgement", () => {
    const core = createCore("publication-nochange");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 });
    const publisher = createPublisher("nochange");

    const first = publisher.publish(publishInput(core, 0));
    expect(first).not.toBeNull();
    expect(publisher.publish(publishInput(core, 1))).toBeNull();
    expect(publisher.getStatus()).toEqual({
      epoch: "test-epoch-nochange",
      nextPublicationSequence: 1,
      lastAcknowledgedRevision: 0,
      inFlightSequence: 0,
      degraded: false,
      resyncRequired: false,
      hasPending: true,
    });

    const ack = publisher.acknowledge(0);
    expect(ack.status).toBe("acknowledged");
    expect(ack.resyncRequired).toBe(false);
    // Pending held the identical state: nothing new to send.
    expect(ack.toSend).toBeNull();
    expect(publisher.getStatus().lastAcknowledgedRevision).toBe(1);
    expect(publisher.publish(publishInput(core, 2))).toBeNull();
  });

  test("apply and remove produce minimal sorted deltas", () => {
    const core = createCore("publication-delta");
    enterDesign(core, 1);
    place(core, 2, "module-power-distribution", { x: 0, y: 0 });
    place(core, 3, "module-vacuum-tube-logic", { x: 3, y: 0 });
    place(core, 4, "module-accumulator-register", { x: 6, y: 0 });
    const publisher = createPublisher("delta");
    publisher.publish(publishInput(core, 0));
    publisher.acknowledge(0);

    dispatchAccepted(core, {
      commandId: commandId(5),
      source: "player",
      kind: "REMOVE_MODULE",
      moduleInstanceId: "module-instance-00000003",
    });
    dispatchAccepted(core, {
      commandId: commandId(6),
      source: "player",
      kind: "REMOVE_MODULE",
      moduleInstanceId: "module-instance-00000001",
    });
    const delta = publisher.publish(publishInput(core, 2));
    expect(delta?.baseGridRevision).toBe(1);
    expect(delta?.nextGridRevision).toBe(2);
    expect(delta?.heatmap.full).toBe(false);
    expect(delta?.entities.upsertModules).toEqual([]);
    expect(delta?.entities.removeModuleIds).toEqual([
      "module-instance-00000001",
      "module-instance-00000003",
    ]);
    // Draft advanced twice while live stayed stable.
    expect(delta?.source.draftRevision).toBe(5);
    expect(delta?.source.liveLayoutRevision).toBe(0);
    expect(publisher.acknowledge(1).status).toBe("acknowledged");
  });

  test("undo and redo surface as remove and upsert", () => {
    const core = createCore("publication-undoredo");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 });
    const publisher = createPublisher("undoredo");
    publisher.publish(publishInput(core, 0));
    publisher.acknowledge(0);

    dispatchAccepted(core, { commandId: commandId(3), source: "player", kind: "UNDO_DESIGN" });
    const undone = publisher.publish(publishInput(core, 1));
    expect(undone?.entities.removeModuleIds).toEqual(["module-instance-00000001"]);
    expect(undone?.entities.upsertModules).toEqual([]);
    publisher.acknowledge(1);

    dispatchAccepted(core, { commandId: commandId(4), source: "player", kind: "REDO_DESIGN" });
    const redone = publisher.publish(publishInput(core, 2));
    expect(redone?.entities.upsertModules.map((view) => view.id)).toEqual([
      "module-instance-00000001",
    ]);
    expect(redone?.entities.removeModuleIds).toEqual([]);
  });

  test("mode change forces a full snapshot", () => {
    const core = createCore("publication-mode");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 });
    const publisher = createPublisher("mode");
    publisher.publish(publishInput(core, 0));
    publisher.acknowledge(0);

    dispatchAccepted(core, { commandId: commandId(3), source: "player", kind: "CANCEL_DESIGN" });
    const live = publisher.publish(publishInput(core, 1));
    expect(live?.viewMode).toBe("live");
    expect(live?.heatmap.full).toBe(true);
    expect(live?.heatmap.values).toHaveLength(384);
    expect(live?.entities.upsertModules).toEqual([]);
  });
});

describe("heatmap epsilon against acknowledged values", () => {
  test("sub-epsilon drift accumulates and reports exact values once due", () => {
    const core = createCore("publication-epsilon");
    const publisher = createPublisher("epsilon");
    const base = publishInput(core, 0);
    publisher.publish(base);
    publisher.acknowledge(0);

    const thermalRevision = base.source.thermalRevision;
    const bumpedOnce = withTileBump(base.thermalTiles, 0, 0, 24, 0.03);
    const drifted = publisher.publish(
      publishInput(core, 1, { thermalTiles: bumpedOnce, thermalRevision: thermalRevision + 1 }),
    );
    // Source advanced, so a publication is due, but no tile reached epsilon.
    // Grid revision stays put on source-only advances.
    expect(drifted).not.toBeNull();
    expect(drifted?.heatmap.values).toEqual([]);
    expect(drifted?.nextGridRevision).toBe(drifted?.baseGridRevision);
    publisher.acknowledge(1);

    const bumpedTwice = withTileBump(bumpedOnce, 0, 0, 24, 0.03);
    const due = publisher.publish(
      publishInput(core, 2, { thermalTiles: bumpedTwice, thermalRevision: thermalRevision + 2 }),
    );
    expect(due?.heatmap.values).toHaveLength(1);
    expect(due?.heatmap.values[0]?.x).toBe(0);
    expect(due?.heatmap.values[0]?.y).toBe(0);
    expect(due?.heatmap.values[0]?.temperatureC).toBe(bumpedTwice[0]?.temperatureC);
    expect(due?.nextGridRevision).toBe((due?.baseGridRevision ?? 0) + 1);
  });

  test("disabled heatmap emits nothing but keeps accumulating drift", () => {
    const core = createCore("publication-disabled");
    const publisher = createPublisher("disabled");
    const base = publishInput(core, 0);
    publisher.publish(base);
    publisher.acknowledge(0);

    // +0.06 while disabled: no heat values transmitted...
    const bumped = withTileBump(base.thermalTiles, 5, 5, 24, 0.06);
    // ...but the source revision did not move either in this harness input,
    // so only enabling plus a revision step emits. First the disabled input:
    const silent = publisher.publish(
      publishInput(core, 1, {
        thermalTiles: bumped,
        thermalRevision: base.source.thermalRevision + 1,
        heatmapEnabled: false,
      }),
    );
    expect(silent?.heatmap.values).toEqual([]);
    publisher.acknowledge(1);

    // Re-enable: the unacknowledged +0.06 drift is still pending.
    const enabled = publisher.publish(
      publishInput(core, 2, {
        thermalTiles: bumped,
        thermalRevision: base.source.thermalRevision + 2,
      }),
    );
    expect(enabled?.heatmap.values).toHaveLength(1);
    expect(enabled?.heatmap.values[0]).toEqual({ x: 5, y: 5, temperatureC: 22 + 0.06 });
  });
});

describe("acknowledgement, coalescing and recovery", () => {
  test("wrong sequence applies nothing and forces a full resync", () => {
    const core = createCore("publication-wrongbase");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 });
    const publisher = createPublisher("wrongbase");
    publisher.publish(publishInput(core, 0));

    place(core, 3, "module-accumulator-register", { x: 6, y: 0 });
    expect(publisher.publish(publishInput(core, 1))).toBeNull();
    expect(publisher.getStatus().hasPending).toBe(true);

    const ack = publisher.acknowledge(999);
    expect(ack.status).toBe("unknown-sequence");
    expect(ack.resyncRequired).toBe(true);
    expect(ack.toSend).toBeNull();
    // Nothing applied: acknowledged revision and baseline are intact.
    expect(publisher.getStatus().lastAcknowledgedRevision).toBe(0);
    expect(publisher.getStatus().inFlightSequence).toBeNull();

    const resync = publisher.publish(publishInput(core, 2));
    expect(resync?.heatmap.full).toBe(true);
    expect(resync?.heatmap.values).toHaveLength(384);
    expect(resync?.baseGridRevision).toBe(0);
    expect(resync?.entities.upsertModules.map((view) => view.id)).toEqual([
      "module-instance-00000001",
      "module-instance-00000002",
    ]);
  });

  test("delayed acknowledgement coalesces intermediate changes into one send", () => {
    const core = createCore("publication-coalesce");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 });
    const publisher = createPublisher("coalesce");
    const first = publisher.publish(publishInput(core, 0));
    expect(first?.publicationSequence).toBe(0);

    place(core, 3, "module-accumulator-register", { x: 6, y: 0 });
    expect(publisher.publish(publishInput(core, 1))).toBeNull();
    dispatchAccepted(core, {
      commandId: commandId(4),
      source: "player",
      kind: "REMOVE_MODULE",
      moduleInstanceId: "module-instance-00000001",
    });
    expect(publisher.publish(publishInput(core, 2))).toBeNull();

    const ack = publisher.acknowledge(0);
    expect(ack.status).toBe("acknowledged");
    // Exactly one coalesced send reflecting the latest state.
    expect(ack.toSend?.publicationSequence).toBe(1);
    expect(ack.toSend?.baseGridRevision).toBe(1);
    expect(ack.toSend?.entities.upsertModules.map((view) => view.id)).toEqual([
      "module-instance-00000002",
    ]);
    expect(ack.toSend?.entities.removeModuleIds).toEqual(["module-instance-00000001"]);
  });

  test("owns a pending input against caller mutation before acknowledgement", () => {
    const core = createCore("publication-owned-pending");
    const publisher = createPublisher("owned-pending");
    const firstInput = publishInput(core, 0);
    const first = publisher.publish(firstInput);
    expect(first?.publicationSequence).toBe(0);

    const pendingInput = publishInput(core, 1, { thermalRevision: 1 });
    expect(publisher.publish(pendingInput)).toBeNull();
    Object.defineProperty(pendingInput.source, "width", { value: 1, writable: true });
    Object.defineProperty(pendingInput.source, "thermalRevision", { value: -99, writable: true });
    Object.defineProperty(pendingInput, "nowMs", { value: Number.NaN, writable: true });

    expect(() => publisher.acknowledge(0)).not.toThrow();
    const followup = publisher.acknowledge(1);
    expect(followup.status).toBe("acknowledged");
  });

  test("observed load forces a full snapshot on the same epoch", () => {
    const core = createCore("publication-load");
    enterDesign(core, 1);
    place(core, 2, "module-vacuum-tube-logic", { x: 0, y: 0 });
    applyDraft(core, 3);
    const publisher = createPublisher("load");
    const first = publisher.publish(publishInput(core, 0));
    expect(first?.source.liveLayoutRevision).toBe(1);
    publisher.acknowledge(0);

    // An older generation arrives on the same epoch (recovery path): the
    // decreased live revision observes a load and forces a full snapshot.
    const loaded = publisher.publish(publishInput(core, 1, { liveLayoutRevision: 0 }));
    expect(loaded?.heatmap.full).toBe(true);
    expect(loaded?.heatmap.values).toHaveLength(384);
  });

  test("missing acknowledgement degrades once and resyncs on next publish", () => {
    const core = createCore("publication-timeout");
    const publisher = createPublisher("timeout");
    publisher.publish(publishInput(core, 0));

    expect(publisher.checkTimeout(999).degraded).toBe(false);
    expect(publisher.checkTimeout(1001).degraded).toBe(true);
    expect(publisher.checkTimeout(5000).degraded).toBe(true);
    const status = publisher.getStatus();
    expect(status.resyncRequired).toBe(true);
    expect(status.inFlightSequence).toBeNull();

    const resync = publisher.publish(publishInput(core, 5001));
    expect(resync?.heatmap.full).toBe(true);
    expect(resync?.baseGridRevision).toBe(0);
    const ack = publisher.acknowledge(resync?.publicationSequence ?? -1);
    expect(ack.status).toBe("acknowledged");
    expect(publisher.getStatus().degraded).toBe(false);
  });

  test("explicit resync requests a full snapshot", () => {
    const core = createCore("publication-explicit");
    const publisher = createPublisher("explicit");
    publisher.publish(publishInput(core, 0));
    publisher.acknowledge(0);
    expect(publisher.publish(publishInput(core, 1))).toBeNull();

    publisher.requestResync();
    const resync = publisher.publish(publishInput(core, 2));
    expect(resync?.heatmap.full).toBe(true);
    expect(resync?.heatmap.values).toHaveLength(384);
  });
});
