import { describe, expect, test } from "vitest";

import {
  GRID_TILE_SIZE,
  clampCamera,
  fitCamera,
  panCamera,
  screenToGrid,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type CameraState,
} from "../../src/rendering/pixi/camera.ts";

const gridSize = { width: 24, height: 16 };
const viewport = { width: 800, height: 500 };

describe("Pixi camera coordinates", () => {
  test("round trips CSS pixels through world coordinates without DPR scaling", () => {
    const camera: CameraState = { centerWorld: { x: 384, y: 256 }, zoom: 1.25 };
    const screen = { x: 237.5, y: 161.25 };

    const world = screenToWorld(screen, viewport, camera);
    expect(worldToScreen(world, viewport, camera)).toEqual(screen);
    expect(screenToGrid({ x: 400, y: 250 }, viewport, camera)).toEqual({ x: 12, y: 8 });
  });

  test.each([0.35, 1, 3])("clamps fit and zoom to the contract at %s", (zoom) => {
    const camera = clampCamera({ centerWorld: { x: -1000, y: 1000 }, zoom }, viewport, gridSize);
    const halfVisible = { x: viewport.width / zoom / 2, y: viewport.height / zoom / 2 };
    expect(camera.zoom).toBe(zoom);
    expect(camera.centerWorld.x + halfVisible.x).toBeGreaterThanOrEqual(GRID_TILE_SIZE);
    expect(camera.centerWorld.y + halfVisible.y).toBeGreaterThanOrEqual(GRID_TILE_SIZE);
    expect(camera.centerWorld.x - halfVisible.x).toBeLessThanOrEqual(
      gridSize.width * GRID_TILE_SIZE - GRID_TILE_SIZE,
    );
    expect(camera.centerWorld.y - halfVisible.y).toBeLessThanOrEqual(
      gridSize.height * GRID_TILE_SIZE - GRID_TILE_SIZE,
    );
  });

  test("fits the whole facility with a 24 CSS pixel margin and pans without changing grid coordinates", () => {
    const camera = fitCamera(gridSize, viewport);
    expect(camera.zoom).toBeCloseTo(Math.min((800 - 48) / (24 * 32), (500 - 48) / (16 * 32)));
    expect(screenToGrid({ x: 400, y: 250 }, viewport, camera)).toEqual({ x: 12, y: 8 });

    const panned = panCamera(camera, { x: 80, y: -40 }, viewport, gridSize);
    expect(panned).not.toEqual(camera);
    expect(panned.zoom).toBe(camera.zoom);
  });

  test("allows bounded horizontal and vertical panning while the whole facility is visible", () => {
    const camera: CameraState = {
      centerWorld: { x: 12 * GRID_TILE_SIZE, y: 8 * GRID_TILE_SIZE },
      zoom: 0.35,
    };

    const horizontal = panCamera(camera, { x: 80, y: 0 }, viewport, gridSize);
    const vertical = panCamera(camera, { x: 0, y: 80 }, viewport, gridSize);

    expect(horizontal.centerWorld.x).toBeLessThan(camera.centerWorld.x);
    expect(horizontal.centerWorld.y).toBe(camera.centerWorld.y);
    expect(vertical.centerWorld.x).toBe(camera.centerWorld.x);
    expect(vertical.centerWorld.y).toBeLessThan(camera.centerWorld.y);
  });

  test("keeps the world point under the pointer fixed during zoom", () => {
    const camera = fitCamera(gridSize, viewport);
    const pointer = { x: 125, y: 175 };
    const before = screenToWorld(pointer, viewport, camera);
    const zoomed = zoomAt(camera, pointer, 2, viewport, gridSize);

    expect(screenToWorld(pointer, viewport, zoomed)).toEqual(before);
    expect(zoomed.zoom).toBeGreaterThan(camera.zoom);
  });

  test("leaves negative and out-of-bounds positions invalid instead of clamping them", () => {
    const camera = fitCamera(gridSize, viewport);
    expect(screenToGrid({ x: -10_000, y: -10_000 }, viewport, camera, gridSize)).toBeNull();
    expect(screenToGrid({ x: 10_000, y: 10_000 }, viewport, camera, gridSize)).toBeNull();
  });
});
