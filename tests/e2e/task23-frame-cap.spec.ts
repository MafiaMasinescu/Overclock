import { expect, test } from "@playwright/test";
import type { PixiGridAdapter } from "../../src/app/game-client/contracts.ts";

test("caps dirty presentation at 30, 45 and 60 without hidden or destroyed submissions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas[data-pixi-canvas]")).toBeVisible();
  const result = await page.evaluate(async () => {
    const url = "/src/rendering/pixi/pixiGridAdapter.ts";
    const { createPixiGridAdapter } = (await import(/* @vite-ignore */ url)) as {
      createPixiGridAdapter: () => PixiGridAdapter & { setFrameCap?: (cap: 30 | 45 | 60) => void };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = createPixiGridAdapter();
    adapter.mount(host);
    adapter.resize(640, 400, 1);
    adapter.update({
      revision: 1,
      mode: "live",
      layoutRevision: 1,
      thermalRevision: 1,
      gridSize: { width: 24, height: 16 },
      modules: [],
      routes: [],
      heatmap: null,
      placementPreview: null,
      diagnosticHighlights: [],
    });
    while (adapter.getStatus() === "initializing")
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    const originalRequest = window.requestAnimationFrame.bind(window);
    const originalCancel = window.cancelAnimationFrame.bind(window);
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    let hidden = false;
    let sequence = 0;
    let time = performance.now() + 100;
    const callbacks = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    };
    window.cancelAnimationFrame = (handle) => {
      callbacks.delete(handle);
    };
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const advance = (): void => {
      time += 1000 / 120;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
    };
    try {
      const counts: number[] = [];
      for (const cap of [30, 45, 60] as const) {
        adapter.setFrameCap(cap);
        const before = adapter.getDiagnostics().renderCount;
        for (let frame = 0; frame < 120; frame += 1) {
          adapter.setSelectedEntities([`tile:${frame % 24}:${Math.floor(frame / 24)}`]);
          advance();
        }
        counts.push(adapter.getDiagnostics().renderCount - before);
      }
      const beforeHidden = adapter.getDiagnostics().renderCount;
      adapter.setSelectedEntities(["tile:0:0"]);
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      for (let frame = 0; frame < 120; frame += 1) advance();
      const hiddenCount = adapter.getDiagnostics().renderCount - beforeHidden;
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      advance();
      const resumedCount = adapter.getDiagnostics().renderCount - beforeHidden;
      adapter.setSelectedEntities(["tile:1:1"]);
      adapter.destroy();
      advance();
      return {
        counts,
        hiddenCount,
        resumedCount,
        pendingAfterDestroy: callbacks.size,
        canvases: host.querySelectorAll("canvas").length,
      };
    } finally {
      adapter.destroy();
      host.remove();
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
      if (hiddenDescriptor === undefined) Reflect.deleteProperty(document, "hidden");
      else Object.defineProperty(document, "hidden", hiddenDescriptor);
    }
  });
  for (const [index, cap] of [30, 45, 60].entries()) {
    expect(result.counts[index]).toBeGreaterThanOrEqual(cap - 1);
    expect(result.counts[index]).toBeLessThanOrEqual(cap + 1);
  }
  expect(result.hiddenCount).toBe(0);
  expect(result.resumedCount).toBe(1);
  expect(result.pendingAfterDestroy).toBe(0);
  expect(result.canvases).toBe(0);
});
