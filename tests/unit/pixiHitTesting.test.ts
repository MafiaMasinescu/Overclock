import { describe, expect, test } from "vitest";

import { fitCamera, tileCenter, worldToScreen } from "../../src/rendering/pixi/camera.ts";
import { hitTestGrid, type GridHitTarget } from "../../src/rendering/pixi/hitTesting.ts";
import type { GridViewModel } from "../../src/app/game-client/snapshots.ts";

function makeGrid(): GridViewModel {
  return {
    revision: 1,
    mode: "live",
    layoutRevision: 1,
    thermalRevision: 1,
    gridSize: { width: 8, height: 6 },
    modules: [
      {
        id: "module-b",
        definitionId: "module-control-unit",
        spriteKey: "module-control-unit",
        position: { x: 2, y: 2 },
        footprint: { width: 2, height: 1 },
        ports: [
          {
            portId: "data-east",
            kind: "data-bidirectional",
            facingSide: "east",
            moduleTile: { x: 3, y: 2 },
            adjacentTile: { x: 4, y: 2 },
            capacityPerSecond: 100,
          },
        ],
        rotation: 0,
        operationalState: "online",
        selected: false,
        warning: "none",
        temperatureC: 22,
        overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
      {
        id: "module-a",
        definitionId: "module-power-distribution",
        spriteKey: "module-power-distribution",
        position: { x: 5, y: 2 },
        footprint: { width: 1, height: 1 },
        ports: [],
        rotation: 0,
        operationalState: "online",
        selected: false,
        warning: "none",
        temperatureC: 22,
        overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
    ],
    routes: [
      {
        id: "route-b",
        kind: "data",
        path: [
          { x: 4, y: 2 },
          { x: 5, y: 2 },
        ],
        from: { moduleInstanceId: "module-b", portId: "data-east" },
        to: { moduleInstanceId: "module-a", portId: "data-east" },
        utilizationRatio: null,
        selected: false,
      },
    ],
    heatmap: null,
    placementPreview: null,
    diagnosticHighlights: [],
  };
}

describe("facility hit testing", () => {
  test("prioritizes the visible port, then the module, before a route or tile", () => {
    const grid = makeGrid();
    const camera = fitCamera(grid.gridSize, { width: 640, height: 480 });
    const portPoint = {
      x: camera.centerWorld.x,
      y: camera.centerWorld.y,
    };
    const viewport = { width: 640, height: 480 };
    const portScreen = {
      x: viewport.width / 2 + (4.5 * 32 - camera.centerWorld.x) * camera.zoom,
      y: viewport.height / 2 + (2.5 * 32 - camera.centerWorld.y) * camera.zoom,
    };
    expect(portPoint).toBeDefined();
    expect(hitTestGrid(grid, portScreen, viewport, camera)).toEqual({
      kind: "port",
      moduleInstanceId: "module-b",
      portId: "data-east",
    } satisfies GridHitTarget);
  });

  test("uses the exact route tolerance and stable ID tie-break", () => {
    const grid = makeGrid();
    const camera = fitCamera(grid.gridSize, { width: 640, height: 480 });
    const viewport = { width: 640, height: 480 };
    const routeCenter = {
      x: viewport.width / 2 + (4.5 * 32 - camera.centerWorld.x) * camera.zoom,
      y: viewport.height / 2 + (2.5 * 32 - camera.centerWorld.y) * camera.zoom,
    };

    expect(hitTestGrid(grid, routeCenter, viewport, camera)).toMatchObject({
      kind: "port",
    });
    const justOutside = { x: routeCenter.x, y: routeCenter.y + 7 };
    expect(hitTestGrid(grid, justOutside, viewport, camera)).not.toMatchObject({
      kind: "route",
    });
  });

  test("returns a valid tile only inside the facility", () => {
    const grid = makeGrid();
    const camera = fitCamera(grid.gridSize, { width: 640, height: 480 });
    const viewport = { width: 640, height: 480 };
    const tile = {
      x: viewport.width / 2 + (0.5 * 32 - camera.centerWorld.x) * camera.zoom,
      y: viewport.height / 2 + (0.5 * 32 - camera.centerWorld.y) * camera.zoom,
    };
    expect(hitTestGrid(grid, tile, viewport, camera)).toEqual({
      kind: "tile",
      position: { x: 0, y: 0 },
    });
  });

  test("hits a visible external port before rejecting its out-of-bounds adjacent tile", () => {
    const base = makeGrid();
    const anchor = base.modules[0];
    if (anchor === undefined) throw new Error("Missing edge-port fixture module.");
    const grid: GridViewModel = {
      ...base,
      modules: [
        {
          ...anchor,
          id: "module-edge",
          position: { x: 0, y: 0 },
          footprint: { width: 1, height: 1 },
          ports: [
            {
              portId: "airflow-north",
              kind: "airflow",
              facingSide: "north",
              moduleTile: { x: 0, y: 0 },
              adjacentTile: { x: 0, y: -1 },
              capacityPerSecond: 100,
            },
          ],
        },
      ],
      routes: [],
    };
    const viewport = { width: 640, height: 480 };
    const camera = { centerWorld: { x: 128, y: 96 }, zoom: 1 };
    const pointer = worldToScreen(tileCenter({ x: 0, y: -1 }), viewport, camera);

    expect(pointer).toEqual({ x: 208, y: 128 });
    expect(hitTestGrid(grid, pointer, viewport, camera)).toEqual({
      kind: "port",
      moduleInstanceId: "module-edge",
      portId: "airflow-north",
    });
  });
});
