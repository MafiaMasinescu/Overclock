import { describe, expect, test } from "vitest";

import type { GridViewModel } from "../../src/app/game-client/snapshots.ts";
import {
  applyEntitySelection,
  applyRectangleSelection,
  createSelectionController,
  pruneSelection,
  selectRectangle,
} from "../../src/ui/workspaces/selectionController.ts";

function grid(): GridViewModel {
  return {
    revision: 1,
    mode: "draft",
    layoutRevision: 3,
    thermalRevision: 7,
    gridSize: { width: 8, height: 6 },
    modules: [
      {
        id: "module-z",
        definitionId: "module-vacuum-tube-logic",
        spriteKey: "vacuum",
        position: { x: 1, y: 1 },
        footprint: { width: 2, height: 1 },
        ports: [],
        rotation: 90,
        operationalState: "offline",
        selected: false,
        warning: "none",
        temperatureC: null,
        overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
      {
        id: "module-a",
        definitionId: "module-control-unit",
        spriteKey: "control",
        position: { x: 4, y: 3 },
        footprint: { width: 1, height: 2 },
        ports: [],
        rotation: 0,
        operationalState: "online",
        selected: false,
        warning: "none",
        temperatureC: 30,
        overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
    ],
    routes: [
      {
        id: "route-1",
        kind: "power",
        path: [],
        from: { moduleInstanceId: "module-z", portId: "out" },
        to: { moduleInstanceId: "module-a", portId: "in" },
        utilizationRatio: null,
        selected: false,
      },
    ],
    heatmap: null,
    placementPreview: null,
    diagnosticHighlights: [],
  };
}

const liveConnection = {
  getConnectionStatus: () => "live" as const,
  subscribeConnection: () => () => undefined,
};

describe("selection controller", () => {
  test.each(["degraded", "resync-required"] as const)(
    "%s clears pending selection and synchronizes empty context on readmission",
    async (lostStatus) => {
      let status: "live" | "degraded" | "resync-required" = "live";
      let changed: () => void = () => undefined;
      let release: () => void = () => undefined;
      const sent: string[][] = [];
      const controller = createSelectionController({
        ...liveConnection,
        getSnapshot: () => ({}) as never,
        getGridViewModel: grid,
        subscribe: () => () => undefined,
        getConnectionStatus: () => status,
        subscribeConnection: (listener) => {
          changed = listener;
          return () => undefined;
        },
        setPresentationContext: (context) => {
          sent.push([...context.selectedIds]);
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      });
      const disconnect = controller.connect();
      controller.selectEntity("module-a");
      controller.selectEntity("module-z");
      status = lostStatus;
      changed();
      expect(controller.getSelection()).toEqual([]);
      controller.selectEntity("route-1");
      release();
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
      expect(controller.getSelection()).toEqual([]);
      expect(sent).toEqual([["module-a"]]);
      status = "live";
      changed();
      expect(sent).toEqual([["module-a"], []]);
      release();
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
      controller.selectEntity("route-1");
      expect(sent).toEqual([["module-a"], [], ["route-1"]]);
      disconnect();
    },
  );
  test("superseding back to the in-flight membership avoids a duplicate context", async () => {
    const sent: string[][] = [];
    let release: (() => void) | undefined;
    const controller = createSelectionController({
      ...liveConnection,
      getSnapshot: () => ({}) as never,
      getGridViewModel: grid,
      subscribe: () => () => undefined,
      setPresentationContext: (context) => {
        sent.push([...context.selectedIds]);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    controller.connect();
    controller.selectEntity("module-a");
    controller.selectEntity("module-z");
    controller.selectEntity("module-a");
    release?.();
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(sent).toEqual([["module-a"]]);
  });
  test("coalesces rapid inputs and publishes the latest membership after the outstanding context", async () => {
    const model = grid();
    const sent: readonly string[][] = [];
    const releases: (() => void)[] = [];
    const controller = createSelectionController({
      ...liveConnection,
      getSnapshot: () => ({}) as never,
      getGridViewModel: () => model,
      subscribe: () => () => undefined,
      setPresentationContext: (context) => {
        (sent as string[][]).push([...context.selectedIds]);
        return new Promise<void>((resolve) => releases.push(resolve));
      },
    });
    controller.connect();
    controller.selectEntity("module-a");
    controller.selectEntity("module-z");
    controller.selectEntity("route-1");
    expect(sent).toEqual([["module-a"]]);
    expect(controller.getSelection()).toEqual(["route-1"]);
    releases[0]?.();
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(sent).toEqual([["module-a"], ["route-1"]]);
  });

  test("preserves membership across rectangle ordering and does not republish unchanged input", () => {
    const sent: string[][] = [];
    const controller = createSelectionController({
      ...liveConnection,
      getSnapshot: () => ({}) as never,
      getGridViewModel: grid,
      subscribe: () => () => undefined,
      setPresentationContext: (context) => {
        sent.push([...context.selectedIds]);
        return Promise.resolve();
      },
    });
    controller.connect();
    controller.selectRectangle({ x: 0, y: 0 }, { x: 1, y: 1 }, false);
    const selection = controller.getSelection();
    controller.selectRectangle({ x: 0, y: 0 }, { x: 1, y: 1 }, true);
    expect(controller.getSelection()).toBe(selection);
    expect(sent).toHaveLength(1);
  });

  test("epoch reset drops pending old selection even when IDs exist in the replacement", async () => {
    let readable = true;
    let model = grid();
    let publish: () => void = () => undefined;
    const sent: string[][] = [];
    const releases: (() => void)[] = [];
    const controller = createSelectionController({
      ...liveConnection,
      getSnapshot: () => {
        if (!readable) throw new Error("epoch reset");
        return {} as never;
      },
      getGridViewModel: () => model,
      subscribe: (listener) => {
        publish = listener;
        return () => undefined;
      },
      setPresentationContext: (context) => {
        sent.push([...context.selectedIds]);
        return new Promise<void>((resolve) => releases.push(resolve));
      },
    });
    controller.connect();
    controller.selectEntity("module-a");
    controller.selectEntity("module-z");
    readable = false;
    publish();
    readable = true;
    publish();
    expect(controller.getSelection()).toEqual([]);
    releases[0]?.();
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(sent).toEqual([["module-a"]]);
    controller.selectEntity("route-1");
    releases[1]?.();
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    model = { ...model, routes: [] };
    publish();
    expect(controller.getSelection()).toEqual([]);
    expect(sent).toEqual([["module-a"], ["route-1"], []]);
  });
  test("retains unchanged membership identity across thermal and selected-flag publications", () => {
    const selected = ["module-a", "route-1", "tile:0:0"];
    const published = grid();
    published.thermalRevision += 1;
    expect(pruneSelection(selected, published)).toBe(selected);
    expect(applyEntitySelection(selected, "missing", false, published)).toBe(selected);
    expect(applyEntitySelection(["module-a"], "module-a", false, published)).toEqual(["module-a"]);
  });
  test("selects every tile in a dragged rectangle in stable row-major order", () => {
    expect(selectRectangle(grid(), { x: 2, y: 3 }, { x: 0, y: 2 })).toEqual([
      "tile:0:2",
      "tile:1:2",
      "tile:2:2",
      "tile:0:3",
      "tile:1:3",
      "tile:2:3",
    ]);
    expect(selectRectangle(grid(), { x: 7, y: 5 }, { x: 7, y: 5 })).toEqual(["tile:7:5"]);
  });

  test("supports direct toggle selection without mutating the input", () => {
    const previous = ["module-z", "module-a"];
    expect(applyEntitySelection(previous, "route-1", false, grid())).toEqual(["route-1"]);
    expect(applyEntitySelection(previous, "module-a", true, grid())).toEqual(["module-z"]);
    expect(previous).toEqual(["module-z", "module-a"]);
  });

  test("prunes removed entities and preserves valid tile selections", () => {
    expect(pruneSelection(["module-z", "missing", "tile:7:5", "tile:8:5"], grid())).toEqual([
      "module-z",
      "tile:7:5",
    ]);
  });

  test("merges rectangle selection only when additive", () => {
    const model = grid();
    const next = selectRectangle(model, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(applyRectangleSelection(["route-1"], next, false, model)).toEqual([
      "tile:0:0",
      "tile:1:0",
    ]);
    expect(applyRectangleSelection(["route-1"], next, true, model)).toEqual([
      "route-1",
      "tile:0:0",
      "tile:1:0",
    ]);
  });
});
