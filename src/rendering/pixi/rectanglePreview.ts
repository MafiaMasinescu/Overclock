import { Container, Graphics } from "pixi.js";

import { GRID_TILE_SIZE, type CameraGridSize, type CameraPoint } from "./camera.ts";

export function createRectanglePreview() {
  const container = new Container({ label: "facility-selection-preview" });
  const cells = new Map<string, Graphics>();

  const clear = (): void => {
    for (const cell of cells.values()) cell.destroy();
    cells.clear();
  };

  const update = (from: CameraPoint, to: CameraPoint, grid: CameraGridSize): void => {
    const left = Math.max(0, Math.min(from.x, to.x));
    const right = Math.min(grid.width - 1, Math.max(from.x, to.x));
    const top = Math.max(0, Math.min(from.y, to.y));
    const bottom = Math.min(grid.height - 1, Math.max(from.y, to.y));
    // Retain each existing graphic throughout the gesture; only its boundary changes
    // require adding or removing cells. Committed selection lives in a separate layer.
    for (const [id, cell] of cells) {
      const x = cell.position.x / GRID_TILE_SIZE;
      const y = cell.position.y / GRID_TILE_SIZE;
      if (x < left || x > right || y < top || y > bottom) {
        cell.destroy();
        cells.delete(id);
      }
    }
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const id = `${x}:${y}`;
        if (cells.has(id)) continue;
        const cell = new Graphics();
        cell
          .rect(3, 3, GRID_TILE_SIZE - 6, GRID_TILE_SIZE - 6)
          .fill({ color: 0x326f9d, alpha: 0.3 })
          .stroke({ color: 0x326f9d, alpha: 0.95, width: 1, pixelLine: true });
        cell.position.set(x * GRID_TILE_SIZE, y * GRID_TILE_SIZE);
        cells.set(id, cell);
        container.addChild(cell);
      }
    }
  };

  return { container, update, clear };
}

export type RectanglePreview = ReturnType<typeof createRectanglePreview>;
