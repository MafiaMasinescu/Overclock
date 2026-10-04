import { expect, test, type Locator, type Page } from "@playwright/test";

async function visibleSelectedTiles(
  page: Page,
  canvas: Locator,
  tiles: readonly { readonly x: number; readonly y: number }[],
  preview = false,
): Promise<readonly boolean[]> {
  const encoded = (await canvas.screenshot()).toString("base64");
  return page.evaluate(
    async ({ encoded, tiles, preview }) => {
      const source = new Image();
      source.src = `data:image/png;base64,${encoded}`;
      await source.decode();
      const copy = document.createElement("canvas");
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("2D canvas unavailable for selection verification.");
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      const isCyan = (x: number, y: number): boolean => {
        const index = (Math.round(y) * copy.width + Math.round(x)) * 4;
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        return preview
          ? green > 60 && green < 120 && blue - green > 20 && green - red > 20
          : green > 120 && green - red > 45 && blue - red > 45;
      };
      return tiles.map((tile) => {
        const centerX = copy.width / 2 - 384 + (tile.x + 0.5) * 32;
        const outlineY = copy.height / 2 - 256 + tile.y * 32 + 3;
        for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
          for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
            if (isCyan(centerX + offsetX, outlineY + offsetY)) return true;
          }
        }
        return false;
      });
    },
    { encoded, tiles, preview },
  );
}

interface BrowserAdapter {
  mount(container: HTMLElement): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  update(model: unknown): void;
  destroy(): void;
  getStatus(): string;
  retry(): void;
  getDiagnostics(): {
    initialized: boolean;
    listenerCount: number;
    cachedTextureCount: number;
    liveCanvasCount: number;
    moduleCreated: number;
    moduleUpdated: number;
    routeCreated: number;
  };
}

interface BrowserAdapterModule {
  createPixiGridAdapter: () => BrowserAdapter;
}

test("releases real Pixi resources across pending-init remount and twenty complete cycles", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const url = "/src/rendering/pixi/pixiGridAdapter.ts";
    const { createPixiGridAdapter } = (await import(
      /* @vite-ignore */ url
    )) as BrowserAdapterModule;
    const pixiUrl = performance
      .getEntriesByType("resource")
      .find((entry) => entry.name.includes("/pixi__js.js?"))?.name;
    if (pixiUrl === undefined) throw new Error("The loaded Pixi module URL is unavailable.");
    const { Graphics } = (await import(/* @vite-ignore */ pixiUrl)) as {
      Graphics: {
        prototype: {
          destroy: (this: { context: { destroyed: boolean } }, options?: unknown) => void;
        };
      };
    };
    const originalDestroy = Graphics.prototype.destroy;
    let retainedContexts = 0;
    Graphics.prototype.destroy = function (
      this: { context: { destroyed: boolean } },
      options?: unknown,
    ): void {
      const context = this.context;
      originalDestroy.call(this, options);
      if (!context.destroyed) retainedContexts += 1;
    };
    const adapter = createPixiGridAdapter();
    const abandoned = document.createElement("div");
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "400px";
    document.body.append(abandoned, host);
    const model = {
      revision: 0,
      mode: "live",
      layoutRevision: 0,
      thermalRevision: 0,
      gridSize: { width: 24, height: 16 },
      modules: [],
      routes: [],
      heatmap: null,
      placementPreview: null,
      diagnosticHighlights: [],
    };
    adapter.mount(abandoned);
    adapter.resize(640, 400, 2);
    adapter.update(model);
    adapter.destroy();
    const cycles: {
      ready: boolean;
      canvasCount: number;
      backingWidth: number;
      released: boolean;
    }[] = [];
    for (let index = 0; index < 20; index += 1) {
      adapter.mount(host);
      adapter.resize(640, 400, 2);
      adapter.update(model);
      while (adapter.getStatus() === "initializing") {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        );
      }
      const canvas = host.querySelector("canvas");
      const ready = adapter.getStatus() === "ready";
      const canvasCount = host.querySelectorAll("canvas").length;
      const backingWidth = canvas?.width ?? 0;
      adapter.destroy();
      adapter.destroy();
      const diagnostics = adapter.getDiagnostics();
      cycles.push({
        ready,
        canvasCount,
        backingWidth,
        released:
          !diagnostics.initialized &&
          diagnostics.liveCanvasCount === 0 &&
          diagnostics.listenerCount === 0 &&
          diagnostics.cachedTextureCount === 0 &&
          host.querySelectorAll("canvas").length === 0,
      });
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    const lateCanvasCount = abandoned.querySelectorAll("canvas").length;
    abandoned.remove();
    host.remove();
    Graphics.prototype.destroy = originalDestroy;
    return { cycles, lateCanvasCount, retainedContexts };
  });
  expect(result.cycles).toEqual(
    Array.from({ length: 20 }, () => ({
      ready: true,
      canvasCount: 1,
      backingWidth: 1280,
      released: true,
    })),
  );
  expect(result.lateCanvasCount).toBe(0);
  expect(result.retainedContexts).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("keeps persistence usable when renderer initialization fails without an unhandled rejection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
  });
  await page.goto("/");
  await expect
    .poll(async () => ({
      error: await page.getByTestId("center-workspace").locator(".status-chip--error").count(),
      pageErrors,
    }))
    .toEqual({ error: 1, pageErrors: [] });
  await expect(page.getByTestId("pixi-canvas-host").locator("canvas")).toHaveCount(0);
  const persistence = page.getByTestId("persistence-controls");
  await persistence.locator("summary").click();
  await expect(page.getByRole("button", { name: "Salvează acum" })).toBeEnabled();
  await page.getByRole("button", { name: "Salvează acum" }).click();
  await expect.poll(() => page.locator("#persistence-slot-select option").count()).toBe(2);
  await page.screenshot({ path: "test-results/task23-renderer-error-1600x900.png" });
  expect(pageErrors).toEqual([]);
});

test("reports the actual camera zoom and one-based tile coordinates", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const workspace = page.getByTestId("center-workspace");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  const zoom = workspace.getByLabel("Zoom");
  await expect(canvas).toBeVisible();
  await expect(zoom).toHaveText("100%");
  await workspace.getByRole("button", { name: "Mărește" }).click();
  await expect(zoom).toHaveText("120%");
  await canvas.focus();
  await page.keyboard.press("-");
  await expect(zoom).toHaveText("100%");
  await canvas.hover();
  await page.mouse.wheel(0, 100);
  await expect(zoom).toHaveText("86%");
  for (let index = 0; index < 8; index += 1) {
    await workspace.getByRole("button", { name: "Micșorează" }).click();
  }
  await expect(zoom).toHaveText("35%");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const fitted = Math.round(Math.min((bounds.width - 48) / 768, (bounds.height - 48) / 512) * 100);
  await workspace.getByRole("button", { name: "Încadrează" }).click();
  await expect(zoom).toHaveText(`${fitted}%`);
  await page.reload();
  await expect(canvas).toBeVisible();
  await expect(zoom).toHaveText("100%");
  const initial = await canvas.boundingBox();
  if (initial === null) throw new Error("Canvas bounds unavailable.");
  await page.mouse.click(
    initial.x + initial.width / 2 - 384 + 16,
    initial.y + initial.height / 2 - 256 + 16,
  );
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:1:1");
});

test("mounts the live Pixi canvas and keeps camera input local", async ({ page }) => {
  const browserProblems: string[] = [];
  page.on("pageerror", (error) => browserProblems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserProblems.push(message.text());
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const workspace = page.getByTestId("center-workspace");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-pixi-canvas", "facility-grid");

  await workspace.getByRole("button", { name: "Mărește" }).click();
  await workspace.getByRole("button", { name: "Încadrează" }).click();
  await workspace.getByRole("button", { name: "Pan" }).click();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds !== null) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 28, bounds.y + bounds.height / 2 + 16);
    await page.mouse.up();
  }
  await workspace.getByRole("button", { name: "Selectează" }).click();
  if (bounds !== null) {
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }
  await expect(page.getByTestId("operations-stack")).toContainText("Inspector");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("operations-stack")).toContainText("tile:");

  await page.screenshot({ path: "test-results/task23-ordinary-1600x900.png", fullPage: false });
  expect(browserProblems).toEqual([]);
});

test("keeps the authoritative tile selection overlay aligned with the inspector", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) return;

  const clickTile = async (x: number, y: number): Promise<void> => {
    await page.mouse.click(
      bounds.x + bounds.width / 2 - 384 + (x + 0.5) * 32,
      bounds.y + bounds.height / 2 - 256 + (y + 0.5) * 32,
    );
  };

  const empty = await canvas.screenshot();
  await clickTile(3, 3);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:4:4");
  const selected = await canvas.screenshot();

  expect(selected.equals(empty)).toBe(false);
});

test("a direct click replaces the previous tile selection with one tile", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) return;

  const clickTile = async (x: number, y: number): Promise<void> => {
    await page.mouse.click(
      bounds.x + bounds.width / 2 - 384 + (x + 0.5) * 32,
      bounds.y + bounds.height / 2 - 256 + (y + 0.5) * 32,
    );
  };

  await clickTile(3, 3);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:4:4");
  await clickTile(5, 4);
  await expect
    .poll(() =>
      visibleSelectedTiles(page, canvas, [
        { x: 3, y: 3 },
        { x: 5, y: 4 },
      ]),
    )
    .toEqual([false, true]);
  await page.screenshot({
    path: "test-results/task23-single-select-1600x900.png",
    fullPage: false,
  });
  await clickTile(3, 3);
  await expect
    .poll(() =>
      visibleSelectedTiles(page, canvas, [
        { x: 3, y: 3 },
        { x: 5, y: 4 },
      ]),
    )
    .toEqual([true, false]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:4:4");
});

test("selects a rectangular tile area by dragging without a modifier", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) return;

  const tileCenter = (x: number, y: number) => ({
    x: bounds.x + bounds.width / 2 - 384 + (x + 0.5) * 32,
    y: bounds.y + bounds.height / 2 - 256 + (y + 0.5) * 32,
  });
  const from = tileCenter(2, 2);
  const to = tileCenter(4, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();

  const selectedArea = [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 4, y: 3 },
  ];
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, selectedArea))
    .toEqual([true, true, true, true, true, true]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:3:3");
  await page.screenshot({
    path: "test-results/task23-rectangle-select-1600x900.png",
    fullPage: false,
  });
  await page.mouse.click(from.x, from.y);
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, selectedArea))
    .toEqual([true, false, false, false, false, false]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:3:3");
});

test("previews the growing and shrinking area before release and cancels it with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  await canvas.focus();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const at = (x: number, y: number) => ({
    x: bounds.x + bounds.width / 2 - 384 + (x + 0.5) * 32,
    y: bounds.y + bounds.height / 2 - 256 + (y + 0.5) * 32,
  });
  const prior = at(7, 6);
  await page.mouse.click(prior.x, prior.y);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:8:7");
  const start = at(2, 2);
  const small = at(3, 3);
  const large = at(4, 4);
  const cells = [
    { x: 2, y: 2 },
    { x: 3, y: 3 },
    { x: 4, y: 4 },
  ];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(small.x, small.y);
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, cells, true))
    .toEqual([true, true, false]);
  await page.mouse.move(large.x, large.y);
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, cells, true))
    .toEqual([true, true, true]);
  await expect.poll(() => visibleSelectedTiles(page, canvas, cells)).toEqual([false, false, false]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:8:7");
  await page.screenshot({ path: "test-results/task23-area-preview-1600x900.png" });
  await page.mouse.move(small.x, small.y);
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, cells, true))
    .toEqual([true, true, false]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, cells, true))
    .toEqual([false, false, false]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:8:7");

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(large.x, large.y);
  await page.mouse.up();
  await expect.poll(() => visibleSelectedTiles(page, canvas, cells)).toEqual([true, true, true]);
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, cells, true))
    .toEqual([false, false, false]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:3:3");
});

test("shows coordinate labels aligned with the grid through pan and zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  const workspace = page.getByTestId("center-workspace");
  await expect(canvas).toBeVisible();
  const labelsVisible = async (panX: number, panY: number, zoom: number): Promise<boolean[]> => {
    const encoded = (await canvas.screenshot()).toString("base64");
    return page.evaluate(
      async ({ encoded, panX, panY, zoom }) => {
        const source = new Image();
        source.src = `data:image/png;base64,${encoded}`;
        await source.decode();
        const copy = document.createElement("canvas");
        copy.width = source.width;
        copy.height = source.height;
        const context = copy.getContext("2d", { willReadFrequently: true });
        if (context === null) throw new Error("2D canvas unavailable.");
        context.drawImage(source, 0, 0);
        const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
        const left = copy.width / 2 + (panX - 384) * zoom;
        const top = copy.height / 2 + (panY - 256) * zoom;
        return [
          { x: left + 6.5 * 32 * zoom, y: top - 10 },
          { x: left - 12, y: top + 6.5 * 32 * zoom },
        ].map(({ x, y }) => {
          for (let dx = -7; dx <= 7; dx += 1) {
            for (let dy = -6; dy <= 6; dy += 1) {
              const index = (Math.round(y + dy) * copy.width + Math.round(x + dx)) * 4;
              if ((pixels[index + 1] ?? 0) > 130) return true;
            }
          }
          return false;
        });
      },
      { encoded, panX, panY, zoom },
    );
  };
  await expect.poll(() => labelsVisible(0, 0, 1)).toEqual([true, true]);
  await workspace.getByRole("button", { name: "Pan" }).click();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 60);
  await page.mouse.up();
  await expect.poll(() => labelsVisible(80, 60, 1)).toEqual([true, true]);
  await expect.poll(() => labelsVisible(0, 0, 1)).toEqual([false, false]);
  await workspace.getByRole("button", { name: "Micșorează" }).click();
  await expect.poll(() => labelsVisible(80, 60, 1 / 1.2)).toEqual([true, true]);
  await page.screenshot({ path: "test-results/task23-coordinates-1600x900.png" });
});

test("cancels preview on focus loss and clips a reversed drag to the facility edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const left = bounds.x + bounds.width / 2 - 384;
  const top = bounds.y + bounds.height / 2 - 256;
  await page.mouse.click(left + 7.5 * 32, top + 6.5 * 32);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:8:7");
  await page.mouse.move(left + 4.5 * 32, top + 3.5 * 32);
  await page.mouse.down();
  await page.mouse.move(left + 2.5 * 32, top + 2.5 * 32);
  const cells = [
    { x: 2, y: 2 },
    { x: 4, y: 3 },
  ];
  await expect.poll(() => visibleSelectedTiles(page, canvas, cells, true)).toEqual([true, true]);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect.poll(() => visibleSelectedTiles(page, canvas, cells, true)).toEqual([false, false]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:8:7");

  await page.mouse.move(left + 4.5 * 32, top + 3.5 * 32);
  await page.mouse.down();
  await page.mouse.move(left - 20, top + 2.5 * 32);
  const edgeCells = [
    { x: 0, y: 2 },
    { x: 4, y: 3 },
  ];
  await expect
    .poll(() => visibleSelectedTiles(page, canvas, edgeCells, true))
    .toEqual([true, true]);
  await page.mouse.up();
  await expect.poll(() => visibleSelectedTiles(page, canvas, edgeCells)).toEqual([true, true]);
  await expect(page.locator(".inspector-title-row strong")).toHaveText("tile:1:3");
});

test("keeps every grid line visible at minimum zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const workspace = page.getByTestId("center-workspace");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();

  for (let index = 0; index < 12; index += 1) {
    await workspace.getByRole("button", { name: "Micșorează" }).click();
  }
  await page.waitForTimeout(100);
  await page.screenshot({ path: "test-results/task23-min-zoom-1600x900.png", fullPage: false });

  const raster = (await canvas.screenshot()).toString("base64");
  const lineContrast = await page.evaluate(async (encoded) => {
    const source = new Image();
    source.src = `data:image/png;base64,${encoded}`;
    await source.decode();
    const width = source.width;
    const height = source.height;
    const copy = document.createElement("canvas");
    copy.width = width;
    copy.height = height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("2D canvas unavailable for renderer verification.");
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const green = (x: number, y: number): number => {
      const safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
      const safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
      return pixels[(safeY * width + safeX) * 4 + 1] ?? 0;
    };
    const zoom = 0.35;
    const left = width / 2 - 384 * zoom;
    const top = height / 2 - 256 * zoom;
    const sampleY = height / 2 + 5;
    const sampleX = width / 2 + 5;
    const vertical = Array.from({ length: 25 }, (_, index) => {
      const lineX = left + index * 32 * zoom;
      const cellX = left + (index + 0.5) * 32 * zoom;
      return (
        Math.max(...[-2, -1, 0, 1, 2].map((offset) => green(lineX + offset, sampleY))) -
        green(cellX, sampleY)
      );
    });
    const horizontal = Array.from({ length: 17 }, (_, index) => {
      const lineY = top + index * 32 * zoom;
      const cellY = top + (index + 0.5) * 32 * zoom;
      return (
        Math.max(...[-2, -1, 0, 1, 2].map((offset) => green(sampleX, lineY + offset))) -
        green(sampleX, cellY)
      );
    });
    return { vertical, horizontal };
  }, raster);

  expect(Math.min(...lineContrast.vertical), JSON.stringify(lineContrast)).toBeGreaterThan(3);
  expect(Math.min(...lineContrast.horizontal), JSON.stringify(lineContrast)).toBeGreaterThan(3);
});

test("pans the zoomed-out facility horizontally and vertically", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const workspace = page.getByTestId("center-workspace");
  const canvas = page.getByTestId("pixi-canvas-host").locator("canvas");
  await expect(canvas).toBeVisible();
  for (let index = 0; index < 12; index += 1) {
    await workspace.getByRole("button", { name: "Micșorează" }).click();
  }
  await workspace.getByRole("button", { name: "Pan" }).click();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) return;

  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const initial = await canvas.screenshot();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y);
  await page.mouse.up();
  const horizontal = await canvas.screenshot();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x, center.y + 80);
  await page.mouse.up();
  const vertical = await canvas.screenshot();

  expect(horizontal.equals(initial)).toBe(false);
  expect(vertical.equals(horizontal)).toBe(false);
});

test("maps a CSS-scaled canvas center to the logical grid center without applying DPR", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const host = page.getByTestId("pixi-canvas-host");
  const canvas = host.locator("canvas");
  await expect(canvas).toBeVisible();

  await host.evaluate((element) => {
    element.style.transform = "scale(0.5)";
    element.style.transformOrigin = "top left";
  });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) return;

  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId("operations-stack")).toContainText("tile:13:9");
});

test("renders a dense owned-model fixture in real Chromium WebGL", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const moduleUrl = "/src/rendering/pixi/pixiGridAdapter.ts";
    const rendererModule = (await import(/* @vite-ignore */ moduleUrl)) as BrowserAdapterModule;
    const host = document.createElement("div");
    host.style.width = "960px";
    host.style.height = "560px";
    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.background = "#0a0f10";
    document.body.append(host);
    const adapter = rendererModule.createPixiGridAdapter();
    const modules = Array.from({ length: 24 }, (_, index) => ({
      id: `dense-module-${String(index).padStart(2, "0")}`,
      definitionId: "module-vacuum-tube-logic",
      spriteKey: "vacuum-tube-logic",
      position: { x: (index % 8) * 3, y: Math.floor(index / 8) * 4 + 1 },
      footprint: { width: 2, height: 1 },
      ports: [
        {
          portId: "power-in",
          kind: "power-in",
          facingSide: "west",
          moduleTile: { x: (index % 8) * 3, y: Math.floor(index / 8) * 4 + 1 },
          adjacentTile: { x: (index % 8) * 3 - 1, y: Math.floor(index / 8) * 4 + 1 },
          capacityPerSecond: 100,
        },
      ],
      rotation: 0,
      operationalState: index % 5 === 0 ? "starting" : "online",
      selected: index % 7 === 0,
      warning: index % 9 === 0 ? "thermal" : "none",
      temperatureC: 35 + index,
      overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    }));
    const firstModule = modules[0];
    const eighthModule = modules[8];
    if (firstModule === undefined || eighthModule === undefined) {
      throw new Error("Dense fixture did not create its anchor modules.");
    }
    const routes = Array.from({ length: 7 }, (_, index) => ({
      id: `dense-route-${index}`,
      kind: index % 2 === 0 ? "power" : "data",
      path: [
        { x: 1 + index * 3, y: 2 },
        { x: 1 + index * 3, y: 13 },
      ],
      from: { moduleInstanceId: modules[index]?.id ?? firstModule.id, portId: "power-in" },
      to: { moduleInstanceId: modules[index + 8]?.id ?? eighthModule.id, portId: "power-in" },
      utilizationRatio: index % 3 === 0 ? null : 0.42,
      selected: index === 1,
    }));
    adapter.mount(host);
    adapter.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio);
    const model = {
      revision: 1,
      mode: "live",
      layoutRevision: 1,
      thermalRevision: 1,
      gridSize: { width: 24, height: 16 },
      modules,
      routes,
      heatmap: null,
      placementPreview: null,
      diagnosticHighlights: [],
    };
    adapter.update(model);
    while (adapter.getStatus() === "initializing") {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
    }
    if (adapter.getStatus() !== "ready")
      throw new Error("Dense fixture renderer did not initialize.");
    adapter.update({
      ...model,
      revision: 2,
      thermalRevision: 2,
      modules: modules.map((module) => ({
        ...module,
        temperatureC: module.temperatureC + 1,
      })),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const canvas = host.querySelector("canvas");
    const result = {
      canvas: canvas?.dataset["pixiCanvas"] ?? null,
      diagnostics: adapter.getDiagnostics(),
    };
    adapter.retry();
    while (adapter.getStatus() === "initializing") {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
    }
    return { ...result, recreated: adapter.getDiagnostics() };
  });
  expect(fixture.canvas).toBe("facility-grid");
  expect(fixture.diagnostics.liveCanvasCount).toBe(1);
  expect(fixture.diagnostics.moduleCreated).toBe(24);
  expect(fixture.diagnostics.moduleUpdated).toBe(0);
  expect(fixture.diagnostics.routeCreated).toBe(7);
  expect(fixture.recreated.moduleCreated).toBe(48);
  expect(fixture.recreated.routeCreated).toBe(14);
  await page.screenshot({ path: "test-results/task23-dense-1280x760.png", fullPage: false });
});
