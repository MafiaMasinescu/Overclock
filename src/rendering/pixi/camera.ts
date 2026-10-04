export const GRID_TILE_SIZE = 32;
export const MIN_CAMERA_ZOOM = 0.35;
export const MAX_CAMERA_ZOOM = 3;
export const FIT_MARGIN_CSS_PIXELS = 24;

export interface CameraPoint {
  readonly x: number;
  readonly y: number;
}

export interface CameraViewport {
  readonly width: number;
  readonly height: number;
}

export interface CameraGridSize {
  readonly width: number;
  readonly height: number;
}

export interface CameraState {
  readonly centerWorld: CameraPoint;
  readonly zoom: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampZoom(zoom: number): number {
  return clamp(positive(zoom, 1), MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
}

function worldSize(gridSize: CameraGridSize): CameraPoint {
  return {
    x: Math.max(1, gridSize.width) * GRID_TILE_SIZE,
    y: Math.max(1, gridSize.height) * GRID_TILE_SIZE,
  };
}

function validViewport(viewport: CameraViewport): CameraViewport {
  return {
    width: positive(viewport.width, 1),
    height: positive(viewport.height, 1),
  };
}

export function clampCamera(
  camera: CameraState,
  viewportInput: CameraViewport,
  gridSize: CameraGridSize,
): CameraState {
  const viewport = validViewport(viewportInput);
  const size = worldSize(gridSize);
  const zoom = clampZoom(camera.zoom);
  const halfVisible = {
    x: viewport.width / zoom / 2,
    y: viewport.height / zoom / 2,
  };
  const centerBounds = (worldExtent: number, visibleHalfExtent: number) => {
    if (visibleHalfExtent >= worldExtent / 2) {
      return {
        minimum: GRID_TILE_SIZE - visibleHalfExtent,
        maximum: worldExtent - GRID_TILE_SIZE + visibleHalfExtent,
      };
    }
    return {
      minimum: Math.max(GRID_TILE_SIZE / 2, visibleHalfExtent - GRID_TILE_SIZE),
      maximum: Math.min(
        worldExtent - GRID_TILE_SIZE / 2,
        worldExtent - visibleHalfExtent + GRID_TILE_SIZE,
      ),
    };
  };
  const xBounds = centerBounds(size.x, halfVisible.x);
  const yBounds = centerBounds(size.y, halfVisible.y);
  const minimumCenter = {
    x: xBounds.minimum,
    y: yBounds.minimum,
  };
  const maximumCenter = {
    x: xBounds.maximum,
    y: yBounds.maximum,
  };
  return {
    zoom,
    centerWorld: {
      x: clamp(finite(camera.centerWorld.x, size.x / 2), minimumCenter.x, maximumCenter.x),
      y: clamp(finite(camera.centerWorld.y, size.y / 2), minimumCenter.y, maximumCenter.y),
    },
  };
}

export function fitCamera(
  gridSize: CameraGridSize,
  viewportInput: CameraViewport,
  margin = FIT_MARGIN_CSS_PIXELS,
): CameraState {
  const viewport = validViewport(viewportInput);
  const size = worldSize(gridSize);
  const usableWidth = Math.max(1, viewport.width - margin * 2);
  const usableHeight = Math.max(1, viewport.height - margin * 2);
  const zoom = clampZoom(Math.min(usableWidth / size.x, usableHeight / size.y));
  return clampCamera(
    {
      centerWorld: { x: size.x / 2, y: size.y / 2 },
      zoom,
    },
    viewport,
    gridSize,
  );
}

export function screenToWorld(
  screen: CameraPoint,
  viewportInput: CameraViewport,
  camera: CameraState,
): CameraPoint {
  const viewport = validViewport(viewportInput);
  const zoom = clampZoom(camera.zoom);
  return {
    x: camera.centerWorld.x + (screen.x - viewport.width / 2) / zoom,
    y: camera.centerWorld.y + (screen.y - viewport.height / 2) / zoom,
  };
}

export function worldToScreen(
  world: CameraPoint,
  viewportInput: CameraViewport,
  camera: CameraState,
): CameraPoint {
  const viewport = validViewport(viewportInput);
  const zoom = clampZoom(camera.zoom);
  return {
    x: viewport.width / 2 + (world.x - camera.centerWorld.x) * zoom,
    y: viewport.height / 2 + (world.y - camera.centerWorld.y) * zoom,
  };
}

export function screenToGrid(
  screen: CameraPoint,
  viewport: CameraViewport,
  camera: CameraState,
  gridSize?: CameraGridSize,
): CameraPoint | null {
  const world = screenToWorld(screen, viewport, camera);
  const tile = {
    x: Math.floor(world.x / GRID_TILE_SIZE),
    y: Math.floor(world.y / GRID_TILE_SIZE),
  };
  if (
    gridSize !== undefined &&
    (tile.x < 0 || tile.y < 0 || tile.x >= gridSize.width || tile.y >= gridSize.height)
  ) {
    return null;
  }
  return tile.x < 0 || tile.y < 0 ? null : tile;
}

export function panCamera(
  camera: CameraState,
  screenDelta: CameraPoint,
  viewport: CameraViewport,
  gridSize: CameraGridSize,
): CameraState {
  const zoom = clampZoom(camera.zoom);
  return clampCamera(
    {
      centerWorld: {
        x: camera.centerWorld.x - screenDelta.x / zoom,
        y: camera.centerWorld.y - screenDelta.y / zoom,
      },
      zoom,
    },
    viewport,
    gridSize,
  );
}

export function zoomAt(
  camera: CameraState,
  pointer: CameraPoint,
  zoomFactor: number,
  viewport: CameraViewport,
  gridSize: CameraGridSize,
): CameraState {
  const before = screenToWorld(pointer, viewport, camera);
  const zoom = clampZoom(camera.zoom * positive(zoomFactor, 1));
  const next = {
    centerWorld: {
      x: before.x - (pointer.x - viewport.width / 2) / zoom,
      y: before.y - (pointer.y - viewport.height / 2) / zoom,
    },
    zoom,
  };
  return clampCamera(next, viewport, gridSize);
}

export function tileCenter(tile: CameraPoint): CameraPoint {
  return {
    x: (tile.x + 0.5) * GRID_TILE_SIZE,
    y: (tile.y + 0.5) * GRID_TILE_SIZE,
  };
}
