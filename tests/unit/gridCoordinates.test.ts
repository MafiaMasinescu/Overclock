import type { Text } from "pixi.js";
import { expect, test } from "vitest";

import { createGridCoordinates } from "../../src/rendering/pixi/gridCoordinates.ts";

test("labels actual grid cells from one without moving their world positions", () => {
  const coordinates = createGridCoordinates();
  const camera = { centerWorld: { x: 384, y: 256 }, zoom: 1 };
  coordinates.update({ width: 24, height: 16 }, camera, { width: 1000, height: 700 });
  const labels = coordinates.container.children as Text[];
  expect(labels[0]?.text).toBe("1");
  expect(labels[23]?.text).toBe("24");
  expect(labels[24]?.text).toBe("1");
  expect(labels[39]?.text).toBe("16");
  expect(labels[0]?.x).toBe(132);
  expect(labels[24]?.y).toBe(110);
  coordinates.update(
    { width: 24, height: 16 },
    { ...camera, zoom: 0.35 },
    { width: 1000, height: 700 },
  );
  expect(labels[0]?.visible).toBe(true);
  expect(labels[1]?.visible).toBe(false);
  expect(labels[3]?.visible).toBe(true);
  expect(labels[3]?.text).toBe("4");
  coordinates.container.destroy({ children: true });
});
