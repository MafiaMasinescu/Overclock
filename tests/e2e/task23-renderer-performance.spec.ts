import { expect, test } from "@playwright/test";
import type { PixiGridAdapter } from "../../src/app/game-client/contracts.ts";
import type * as Pixi from "pixi.js";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
} from "../performance/thermalFixture.ts";
import { projectGridViewModel } from "../../src/sim/selectors/projector.ts";
import en from "../../content/en/common.json" with { type: "json" };

// This Windows-host diagnostic must identify/use the installed GPU, not silently
// certify headless SwiftShader. Ordinary correctness tests retain their defaults.
test.use({ launchOptions: { args: ["--use-angle=d3d11"] } });

test("measures actual dense adapter updates, render submission and input without rebuilding topology", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(page.locator("canvas[data-pixi-canvas]")).toBeVisible();
  const state = createTask9PerformanceFixture("task23-actual-renderer");
  const projected = projectGridViewModel(state, thermalPerformanceContent, {
    selectedIds: [],
    inspectedEntityId: null,
    heatmapEnabled: true,
  });
  const labels = Object.fromEntries(
    Object.entries(en.modules).map(([id, names]) => [id, names.shortName]),
  );
  const measurements = await page.evaluate(
    async ({ projected, labels }) => {
      const adapterUrl = "/src/rendering/pixi/pixiGridAdapter.ts";
      const { createPixiGridAdapter } = (await import(/* @vite-ignore */ adapterUrl)) as {
        createPixiGridAdapter: () => PixiGridAdapter;
      };
      const pixiUrl = performance
        .getEntriesByType("resource")
        .find((entry) => entry.name.includes("/pixi__js.js?"))?.name;
      if (pixiUrl === undefined) throw new Error("Loaded Pixi missing");
      const pixi = (await import(/* @vite-ignore */ pixiUrl)) as typeof Pixi;
      const submissions: number[] = [];
      const captured: { application: Pixi.Application | null } = { application: null };
      const prototype = pixi.Application.prototype as {
        init: (this: Pixi.Application, options?: Partial<Pixi.ApplicationOptions>) => Promise<void>;
      };
      const originalInit = prototype.init;
      prototype.init = async function (this: Pixi.Application, options): Promise<void> {
        await originalInit.call(this, options);
        captured.application = this;
      };
      const heatValues = Array.from({ length: 384 }, (_, index) => ({
        x: index % 24,
        y: Math.floor(index / 24),
        temperatureC: 22 + (index % 40),
      }));
      const model = { ...projected, heatmap: { full: true, values: heatValues } };
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;width:1920px;height:1080px;background:#0a0f10;z-index:100";
      document.body.append(host);
      const adapter = createPixiGridAdapter();
      adapter.setModuleLabels(labels);
      adapter.mount(host);
      adapter.resize(1920, 1080, 1);
      adapter.update(model);
      while (adapter.getStatus() === "initializing")
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        );
      if (adapter.getStatus() !== "ready") throw new Error("Dense renderer failed");
      const application = captured.application;
      if (application === null) throw new Error("Application capture missing");
      adapter.fit();
      const canvas = host.querySelector("canvas");
      if (canvas === null) throw new Error("Dense canvas missing");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      const gpu =
        gl === null || debug === undefined || debug === null
          ? "unavailable"
          : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
      const updates: number[] = [];
      const input: number[] = [];
      const renderPrototype = pixi.WebGLRenderer.prototype as unknown as {
        render: (this: unknown, ...args: unknown[]) => void;
      };
      const originalRender = renderPrototype.render;
      const pending: { resolve: ((duration: number) => void) | null } = { resolve: null };
      renderPrototype.render = function (...args): void {
        const start = performance.now();
        Reflect.apply(originalRender, this, args);
        if (this === application.renderer) {
          const resolve = pending.resolve;
          pending.resolve = null;
          resolve?.(performance.now() - start);
        }
      };
      try {
        for (let iteration = 0; iteration < 480; iteration += 1) {
          const submitted = new Promise<number>((resolve) => {
            pending.resolve = resolve;
          });
          const next = {
            ...model,
            revision: iteration + 1,
            thermalRevision: iteration + 1,
            heatmap: {
              full: true,
              values: heatValues.map((cell, index) =>
                index === 0 ? { ...cell, temperatureC: 30 + (iteration % 2) } : cell,
              ),
            },
            modules: model.modules.map((module) => ({
              ...module,
              temperatureC: (module.temperatureC ?? 20) + iteration * 0.01,
            })),
          };
          let start = performance.now();
          adapter.update(next);
          const update = performance.now() - start;
          start = performance.now();
          canvas.dispatchEvent(
            new PointerEvent("pointermove", {
              clientX: 600 + (iteration % 32),
              clientY: 400 + (iteration % 16),
            }),
          );
          const callback = performance.now() - start;
          // Observe the adapter's foreground submission instead of bypassing its
          // scheduler with an unbounded synchronous GPU command burst.
          const submission = await submitted;
          if (iteration >= 80) {
            updates.push(update);
            input.push(callback);
            submissions.push(submission);
          }
        }
        const summarize = (values: number[]) => {
          const sorted = [...values].sort((left, right) => left - right);
          return {
            samples: values.length,
            p50: sorted[Math.floor(values.length * 0.5)],
            p95: sorted[Math.floor(values.length * 0.95)],
            max: Math.max(...values),
          };
        };
        return {
          fixture: {
            grid: model.gridSize,
            modules: model.modules.length,
            routes: model.routes.length,
            occupiedTiles: model.modules.reduce(
              (count, module) => count + module.footprint.width * module.footprint.height,
              0,
            ),
            heatCells: heatValues.length,
          },
          warmup: 80,
          measured: 400,
          viewport: { width: 1920, height: 1080 },
          userAgent: navigator.userAgent,
          gpu,
          updateMs: summarize(updates),
          renderSubmissionMs: summarize(submissions),
          pointerCallbackMs: summarize(input),
          diagnostics: adapter.getDiagnostics(),
          classification:
            "Task23 diagnostic on development host; actual WebGL CPU submission, not GPU time or Task28 300/3000-frame target certification",
        };
      } finally {
        renderPrototype.render = originalRender;
        adapter.destroy();
        host.remove();
        prototype.init = originalInit;
      }
    },
    { projected, labels },
  );
  console.log(`TASK23_ACTUAL_RENDERER ${JSON.stringify(measurements)}`);
  expect(measurements.fixture.occupiedTiles).toBeGreaterThanOrEqual(288);
  expect(measurements.updateMs.samples).toBe(400);
  expect(measurements.renderSubmissionMs.samples).toBeGreaterThanOrEqual(400);
  expect(measurements.diagnostics.moduleUpdated).toBe(0);
  expect(measurements.diagnostics.gridUpdated).toBe(1);
  expect(measurements.diagnostics.portsUpdated).toBe(1);
});
