import { performance } from "node:perf_hooks";

import type { GridViewModel } from "../../src/app/game-client/snapshots.ts";
import { fitCamera } from "../../src/rendering/pixi/camera.ts";
import { hitTestGrid } from "../../src/rendering/pixi/hitTesting.ts";
import { createRectanglePreview } from "../../src/rendering/pixi/rectanglePreview.ts";
import { reconcileKeyedScene } from "../../src/rendering/pixi/sceneReconciliation.ts";

const MODULE_COUNT = 192;
const ROUTE_COUNT = 64;
const ITERATIONS = 400;

function createGrid(thermalRevision: number): GridViewModel {
  const modules = Array.from({ length: MODULE_COUNT }, (_, index) => ({
    id: `module-${String(index).padStart(3, "0")}`,
    definitionId: "module-vacuum-tube-logic" as const,
    spriteKey: "vacuum-tube-logic",
    position: { x: (index % 24) * 1, y: Math.floor(index / 24) * 2 },
    footprint: { width: 1, height: 1 },
    ports: [
      {
        portId: "power-in",
        kind: "power-in" as const,
        facingSide: "west" as const,
        moduleTile: { x: index % 24, y: Math.floor(index / 24) * 2 },
        adjacentTile: { x: Math.max(0, (index % 24) - 1), y: Math.floor(index / 24) * 2 },
        capacityPerSecond: 100,
      },
    ],
    rotation: 0 as const,
    operationalState: "online" as const,
    selected: index % 17 === 0,
    warning: "none" as const,
    temperatureC: 28 + (index % 10) + thermalRevision * 0.01,
    overclock: { profile: "balanced" as const, frequencyRatio: 1, voltageRatio: 1 },
  }));
  const moduleAt = (index: number) => {
    const module = modules[index];
    if (module === undefined) throw new Error(`Missing performance fixture module ${index}.`);
    return module;
  };
  const routes = Array.from({ length: ROUTE_COUNT }, (_, index) => ({
    id: `route-${String(index).padStart(3, "0")}`,
    kind: index % 2 === 0 ? ("power" as const) : ("data" as const),
    path: [
      { x: index % 24, y: 0 },
      { x: index % 24, y: 14 },
    ],
    from: { moduleInstanceId: moduleAt(index % MODULE_COUNT).id, portId: "power-in" },
    to: { moduleInstanceId: moduleAt((index + 24) % MODULE_COUNT).id, portId: "power-in" },
    utilizationRatio: index % 5 === 0 ? null : 0.4,
    selected: index % 19 === 0,
  }));
  return {
    revision: thermalRevision,
    mode: "live",
    layoutRevision: 1,
    thermalRevision,
    gridSize: { width: 24, height: 16 },
    modules,
    routes,
    heatmap: null,
    placementPreview: null,
    diagnosticHighlights: [],
  };
}

function toScene(grid: GridViewModel) {
  return {
    modules: new Map(
      grid.modules.map((module) => [module.id, `${module.position.x},${module.position.y}`]),
    ),
    routes: new Map(
      grid.routes.map((route) => [
        route.id,
        route.path.map((point) => `${point.x},${point.y}`).join(";"),
      ]),
    ),
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

const baseGrid = createGrid(1);
const thermalGrid = createGrid(2);
const baseScene = toScene(baseGrid);
const thermalScene = toScene(thermalGrid);
const viewport = { width: 1280, height: 720 };
const camera = fitCamera(baseGrid.gridSize, viewport);
const reconciliationDurations: number[] = [];
const hitTestDurations: number[] = [];
const preview = createRectanglePreview();
const previewStableDurations: number[] = [];
const previewBoundaryDurations: number[] = [];
const previewFrom = { x: 0, y: 0 };
const previewTo = { x: 23, y: 15 };
const previewSmaller = { x: 22, y: 15 };
preview.update(previewFrom, previewTo, baseGrid.gridSize);

for (let iteration = 0; iteration < 80; iteration += 1) {
  reconcileKeyedScene(baseScene, thermalScene);
  hitTestGrid(baseGrid, { x: 640, y: 360 }, viewport, camera);
  preview.update(previewFrom, previewTo, baseGrid.gridSize);
  preview.update(previewFrom, previewSmaller, baseGrid.gridSize);
  preview.update(previewFrom, previewTo, baseGrid.gridSize);
}

for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  let start = performance.now();
  reconcileKeyedScene(baseScene, thermalScene);
  reconciliationDurations.push(performance.now() - start);
  start = performance.now();
  hitTestGrid(baseGrid, { x: 640 + (iteration % 11), y: 360 + (iteration % 7) }, viewport, camera);
  hitTestDurations.push(performance.now() - start);
  start = performance.now();
  preview.update(previewFrom, previewTo, baseGrid.gridSize);
  previewStableDurations.push(performance.now() - start);
  start = performance.now();
  preview.update(previewFrom, previewSmaller, baseGrid.gridSize);
  preview.update(previewFrom, previewTo, baseGrid.gridSize);
  previewBoundaryDurations.push(performance.now() - start);
}

preview.clear();
preview.container.destroy();

console.log(
  JSON.stringify(
    {
      measurement: "Task 23 scene, hit-test and Pixi preview CPU diagnostics (no GPU rendering)",
      host: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: process.env["PROCESSOR_IDENTIFIER"] ?? "unavailable",
      },
      fixture: {
        modules: MODULE_COUNT,
        routes: ROUTE_COUNT,
        iterations: ITERATIONS,
        previewCells: 384,
        previewBoundaryCells: 16,
      },
      camera,
      reconciliationMs: {
        p50: percentile(reconciliationDurations, 0.5),
        p95: percentile(reconciliationDurations, 0.95),
        max: Math.max(...reconciliationDurations),
      },
      hitTestMs: {
        p50: percentile(hitTestDurations, 0.5),
        p95: percentile(hitTestDurations, 0.95),
        max: Math.max(...hitTestDurations),
      },
      previewStableMs: {
        p50: percentile(previewStableDurations, 0.5),
        p95: percentile(previewStableDurations, 0.95),
        max: Math.max(...previewStableDurations),
      },
      previewBoundaryMs: {
        p50: percentile(previewBoundaryDurations, 0.5),
        p95: percentile(previewBoundaryDurations, 0.95),
        max: Math.max(...previewBoundaryDurations),
      },
      certification: "informative host measurement; not target i7-2600/GTX1050 certification",
    },
    null,
    2,
  ),
);
