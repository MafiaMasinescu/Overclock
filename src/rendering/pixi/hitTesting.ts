import type { GridViewModel } from "../../app/game-client/snapshots.ts";

import {
  GRID_TILE_SIZE,
  screenToGrid,
  screenToWorld,
  tileCenter,
  worldToScreen,
  type CameraPoint,
  type CameraState,
  type CameraViewport,
} from "./camera.ts";

export type GridHitTarget =
  | { readonly kind: "port"; readonly moduleInstanceId: string; readonly portId: string }
  | { readonly kind: "module"; readonly moduleInstanceId: string }
  | { readonly kind: "route"; readonly routeId: string }
  | { readonly kind: "tile"; readonly position: CameraPoint };

const PORT_HIT_RADIUS_CSS_PIXELS = 8;
const ROUTE_HIT_TOLERANCE_CSS_PIXELS = 6;

function distanceSquared(left: CameraPoint, right: CameraPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function distanceToSegment(point: CameraPoint, start: CameraPoint, end: CameraPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.sqrt(distanceSquared(point, start));
  const ratio = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.sqrt(distanceSquared(point, { x: start.x + ratio * dx, y: start.y + ratio * dy }));
}

function moduleContains(module: GridViewModel["modules"][number], tile: CameraPoint): boolean {
  return (
    tile.x >= module.position.x &&
    tile.y >= module.position.y &&
    tile.x < module.position.x + module.footprint.width &&
    tile.y < module.position.y + module.footprint.height
  );
}

function portScreenPoint(
  port: GridViewModel["modules"][number]["ports"][number],
  viewport: CameraViewport,
  camera: CameraState,
): CameraPoint {
  return worldToScreen(tileCenter(port.adjacentTile), viewport, camera);
}

function routeDistance(
  route: GridViewModel["routes"][number],
  pointer: CameraPoint,
  viewport: CameraViewport,
  camera: CameraState,
): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < route.path.length; index += 1) {
    const startTile = route.path[index - 1];
    const endTile = route.path[index];
    if (startTile === undefined || endTile === undefined) continue;
    closest = Math.min(
      closest,
      distanceToSegment(
        pointer,
        worldToScreen(tileCenter(startTile), viewport, camera),
        worldToScreen(tileCenter(endTile), viewport, camera),
      ),
    );
  }
  return closest;
}

export function hitTestGrid(
  grid: GridViewModel,
  pointer: CameraPoint,
  viewport: CameraViewport,
  camera: CameraState,
): GridHitTarget | null {
  const tile = screenToGrid(pointer, viewport, camera, grid.gridSize);
  const orderedModules = [...grid.modules].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const module of orderedModules) {
    for (const port of module.ports) {
      if (
        distanceSquared(pointer, portScreenPoint(port, viewport, camera)) <=
        PORT_HIT_RADIUS_CSS_PIXELS ** 2
      ) {
        return { kind: "port", moduleInstanceId: module.id, portId: port.portId };
      }
    }
  }
  if (tile === null) return null;
  for (const module of orderedModules) {
    if (moduleContains(module, tile)) return { kind: "module", moduleInstanceId: module.id };
  }

  const orderedRoutes = [...grid.routes].toSorted((left, right) => left.id.localeCompare(right.id));
  for (const route of orderedRoutes) {
    if (routeDistance(route, pointer, viewport, camera) <= ROUTE_HIT_TOLERANCE_CSS_PIXELS) {
      return { kind: "route", routeId: route.id };
    }
  }

  const world = screenToWorld(pointer, viewport, camera);
  return {
    kind: "tile",
    position: {
      x: Math.floor(world.x / GRID_TILE_SIZE),
      y: Math.floor(world.y / GRID_TILE_SIZE),
    },
  };
}
