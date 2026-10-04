import { describe, expect, test } from "vitest";
import { Graphics } from "pixi.js";

import { createRectanglePreview } from "../../src/rendering/pixi/rectanglePreview.ts";

describe("rectangle selection preview", () => {
  test("releases owned graphics contexts on shrink and cancellation", () => {
    const preview = createRectanglePreview();
    preview.update({ x: 0, y: 0 }, { x: 1, y: 0 }, { width: 4, height: 3 });
    const contexts = preview.container.children.map((child) => {
      if (!(child instanceof Graphics)) throw new Error("Expected owned cell graphics");
      return child.context;
    });
    preview.update({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: 4, height: 3 });
    expect(contexts[1]?.destroyed).toBe(true);
    expect(contexts[0]?.destroyed).toBe(false);
    preview.clear();
    expect(contexts[0]?.destroyed).toBe(true);
    preview.clear();
    preview.container.destroy();
  });
  test("retains existing cell graphics when adding rows and columns, and removes only cells outside a shrunken area", () => {
    const preview = createRectanglePreview();
    const grid = { width: 24, height: 16 };
    preview.update({ x: 2, y: 2 }, { x: 3, y: 3 }, grid);
    const original = [...preview.container.children];
    expect(original).toHaveLength(4);

    preview.update({ x: 2, y: 2 }, { x: 4, y: 4 }, grid);
    expect(preview.container.children).toHaveLength(9);
    for (const cell of original) {
      expect(preview.container.children).toContain(cell);
      expect(cell.destroyed).toBe(false);
    }

    preview.update({ x: 2, y: 2 }, { x: 3, y: 3 }, grid);
    expect(preview.container.children).toEqual(original);
    preview.clear();
    expect(preview.container.children).toHaveLength(0);
    expect(original.every((cell) => cell.destroyed)).toBe(true);
    preview.container.destroy();
  });

  test("normalizes reversed and clipped rectangles and does not rebuild an unchanged preview", () => {
    const preview = createRectanglePreview();
    const grid = { width: 4, height: 3 };
    preview.update({ x: 2, y: 1 }, { x: -5, y: -5 }, grid);
    const cells = [...preview.container.children];
    expect(cells).toHaveLength(6);
    preview.update({ x: 0, y: 0 }, { x: 2, y: 1 }, grid);
    expect(preview.container.children).toEqual(cells);
    preview.clear();
    preview.container.destroy();
  });
});
