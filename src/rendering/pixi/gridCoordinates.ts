import { Container, Text } from "pixi.js";

import {
  GRID_TILE_SIZE,
  worldToScreen,
  type CameraGridSize,
  type CameraState,
  type CameraViewport,
} from "./camera.ts";

export function createGridCoordinates() {
  const container = new Container({ label: "facility-coordinates" });
  const columns: Text[] = [];
  const rows: Text[] = [];
  const populate = (labels: Text[], count: number, horizontal: boolean): void => {
    if (labels.length === count) return;
    for (const label of labels) label.destroy();
    labels.length = 0;
    for (let index = 0; index < count; index += 1) {
      const label = new Text({
        text: String(index + 1),
        style: { fontFamily: "monospace", fontSize: 12, fill: 0x9bb5c4 },
      });
      label.anchor.set(horizontal ? 0.5 : 1, horizontal ? 1 : 0.5);
      labels.push(label);
      container.addChild(label);
    }
  };

  const update = (grid: CameraGridSize, camera: CameraState, viewport: CameraViewport): void => {
    populate(columns, grid.width, true);
    populate(rows, grid.height, false);
    const origin = worldToScreen({ x: 0, y: 0 }, viewport, camera);
    const step = GRID_TILE_SIZE * camera.zoom;
    const stride = Math.max(1, Math.ceil(28 / step));
    for (const [index, label] of columns.entries()) {
      label.position.set(origin.x + (index + 0.5) * step, origin.y - 4);
      label.visible = index % stride === 0 && label.x >= 0 && label.x <= viewport.width;
    }
    for (const [index, label] of rows.entries()) {
      label.position.set(origin.x - 6, origin.y + (index + 0.5) * step);
      label.visible = index % stride === 0 && label.y >= 0 && label.y <= viewport.height;
    }
  };

  return { container, update };
}

export type GridCoordinates = ReturnType<typeof createGridCoordinates>;
