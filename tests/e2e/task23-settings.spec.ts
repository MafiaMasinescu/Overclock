import { expect, test, type Page } from "@playwright/test";
import type { mount } from "./fixtures/task23ShellHarness.tsx";
import type * as Pixi from "pixi.js";

declare global {
  interface Window {
    task23Shell: Awaited<ReturnType<typeof mount>>;
  }
}

async function renderedFrames(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const pixiUrl = performance
      .getEntriesByType("resource")
      .find((entry) => entry.name.includes("/pixi__js.js?"))?.name;
    if (pixiUrl === undefined) throw new Error("Loaded Pixi missing");
    const pixi = (await import(/* @vite-ignore */ pixiUrl)) as typeof Pixi;
    const renderPrototype = pixi.WebGLRenderer.prototype as unknown as {
      render: (this: unknown, ...args: unknown[]) => void;
    };
    const originalRender = renderPrototype.render;
    const originalRequest = window.requestAnimationFrame.bind(window);
    const originalCancel = window.cancelAnimationFrame.bind(window);
    const callbacks = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    let submissions = 0;
    renderPrototype.render = function (...args): void {
      Reflect.apply(originalRender, this, args);
      submissions += 1;
    };
    // Let an already-requested native frame settle before taking ownership of the test clock.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    submissions = 0;
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    };
    window.cancelAnimationFrame = (handle) => {
      callbacks.delete(handle);
    };
    const canvas = document.querySelector("canvas");
    if (canvas === null) throw new Error("Canvas missing");
    canvas.focus();
    let timestamp = performance.now() + 100;
    try {
      for (let index = 0; index < 120; index += 1) {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: index % 2 === 0 ? 1 : -1,
            clientX: canvas.getBoundingClientRect().left + 100,
            clientY: canvas.getBoundingClientRect().top + 100,
            cancelable: true,
          }),
        );
        timestamp += 1000 / 120;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(timestamp);
      }
      return submissions;
    } finally {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(timestamp + 1000);
      renderPrototype.render = originalRender;
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    }
  });
}

test("production shell consumes persisted and explicitly imported frame caps", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/task23ShellHarness.html");
  await page.evaluate(async () => {
    const url = "/tests/e2e/fixtures/task23ShellHarness.tsx";
    const module = (await import(/* @vite-ignore */ url)) as { mount: typeof mount };
    window.task23Shell = await module.mount();
  });
  await expect(page.locator("canvas")).toBeVisible();
  const bytes = await page.evaluate(async () => {
    const client = window.task23Shell.getClient();
    const { settings } = await client.queryBuild({
      kind: "context",
      mode: "live",
      clientIntentSequence: 81,
    });
    if (settings === null) throw new Error("Persisted settings missing");
    await client.updateSettings({ ...settings, language: "en", frameCap: 30 });
    const save = await client.requestSave("manual");
    const slot = (await client.listSlots()).find((entry) => entry.slotId === save.slotId);
    if (slot === undefined) throw new Error("Settings save missing");
    const exported = Array.from(await client.exportSlot(slot.slotId, slot.revision));
    await window.task23Shell.replace("client");
    return exported;
  });
  await expect(page.locator("canvas")).toBeVisible();
  // Observe metadata admission through the actual canvas behavior, not just query output.
  const at30 = await renderedFrames(page);
  expect(at30).toBeGreaterThanOrEqual(29);
  expect(at30).toBeLessThanOrEqual(31);
  await page.evaluate(async () => {
    const client = window.task23Shell.getClient();
    const { settings } = await client.queryBuild({
      kind: "context",
      mode: "live",
      clientIntentSequence: 82,
    });
    if (settings === null) throw new Error("Settings missing");
    await client.updateSettings({ ...settings, frameCap: 60 });
    await window.task23Shell.replace("client");
  });
  await expect(page.locator("canvas")).toBeVisible();
  const at60 = await renderedFrames(page);
  expect(at60).toBeGreaterThanOrEqual(59);
  expect(at60).toBeLessThanOrEqual(61);
  await page.getByTestId("persistence-controls").locator("summary").click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "task23-settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(bytes),
  });
  await page.getByRole("button", { name: "Verify file" }).click();
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Save imported" })).toBeVisible();
  const imported30 = await renderedFrames(page);
  expect(imported30).toBeGreaterThanOrEqual(29);
  expect(imported30).toBeLessThanOrEqual(31);
});
