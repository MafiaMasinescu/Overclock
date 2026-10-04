import { expect, test } from "@playwright/test";
import type { PixiGridAdapter } from "../../src/app/game-client/contracts.ts";
import type { GridViewModel } from "../../src/app/game-client/snapshots.ts";
import type { Container } from "pixi.js";
import type * as Pixi from "pixi.js";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { resolveRotatedFootprintSize } from "../../src/grid/domain/footprintGeometry.ts";
import en from "../../content/en/common.json" with { type: "json" };
import ro from "../../content/ro/common.json" with { type: "json" };

declare global {
  interface Window {
    task23Gallery: PixiGridAdapter;
  }
}

for (const [language, locale] of [
  ["en", en],
  ["ro", ro],
] as const) {
  test(`shows all twelve localized module identities and quarter-turn footprints in ${language}`, async ({
    page,
  }) => {
    const definitions = Object.values(loadContentBundle().modules);
    const labels = Object.fromEntries(
      Object.entries(locale.modules).map(([id, value]) => [id, value.shortName]),
    );
    const model: GridViewModel = {
      revision: 1,
      mode: "live",
      layoutRevision: 1,
      thermalRevision: 0,
      gridSize: { width: 24, height: 16 },
      modules: [0, 90].flatMap((angle, group) =>
        definitions.map((definition, index) => {
          const rotation = angle === 0 ? 0 : 90;
          return {
            id: `gallery-${group}-${index}`,
            definitionId: definition.id,
            spriteKey: `module-${definition.category}`,
            position: { x: (index % 6) * 4, y: (Math.floor(index / 6) + group * 2) * 4 },
            footprint: resolveRotatedFootprintSize(definition.footprint, rotation),
            rotation,
            ports: [],
            operationalState: "online" as const,
            selected: index === 1,
            warning:
              index === 2
                ? ("thermal" as const)
                : index === 3
                  ? ("power" as const)
                  : ("none" as const),
            temperatureC: 25,
            overclock: { profile: "balanced" as const, frequencyRatio: 1, voltageRatio: 1 },
          };
        }),
      ),
      routes: [],
      heatmap: null,
      placementPreview: null,
      diagnosticHighlights: [],
    };
    await page.goto("/");
    await expect(page.locator("canvas[data-pixi-canvas]")).toBeVisible();
    const drawn = await page.evaluate(
      async ({ model, labels }) => {
        const url = "/src/rendering/pixi/pixiGridAdapter.ts";
        const { createPixiGridAdapter } = (await import(/* @vite-ignore */ url)) as {
          createPixiGridAdapter: () => PixiGridAdapter;
        };
        const pixiUrl = performance
          .getEntriesByType("resource")
          .find((entry) => entry.name.includes("/pixi__js.js?"))?.name;
        if (pixiUrl === undefined) throw new Error("Loaded Pixi missing");
        const pixi = (await import(/* @vite-ignore */ pixiUrl)) as typeof Pixi;
        const captured: { world: Container | null } = { world: null };
        const prototype = pixi.Container.prototype as {
          addChild: <T extends Container[]>(this: Container, ...children: T) => T[0];
        };
        const original = prototype.addChild;
        prototype.addChild = function <T extends Container[]>(
          this: Container,
          ...children: T
        ): T[0] {
          for (const child of children)
            if (child.label === "facility-world") captured.world = child;
          return original.apply(this, children);
        };
        const host = document.createElement("div");
        host.id = "task23-gallery";
        host.style.cssText = "position:fixed;inset:0;background:#0a0f10;z-index:1100";
        document.body.append(host);
        const adapter = createPixiGridAdapter();
        window.task23Gallery = adapter;
        try {
          adapter.setModuleLabels(labels);
          adapter.mount(host);
          adapter.resize(innerWidth, innerHeight, 1);
          adapter.update(model);
          while (adapter.getStatus() === "initializing")
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => {
                resolve();
              }),
            );
          if (adapter.getStatus() !== "ready" || captured.world === null)
            throw new Error("Gallery failed");
          adapter.fit();
          const modules = captured.world.children.find(
            (layer) => layer.label === "facility-modules",
          );
          if (modules === undefined) throw new Error("Gallery modules missing");
          return modules.children.flatMap((module) =>
            module.children
              .filter((child): child is Pixi.Text => child instanceof pixi.Text)
              .map((text) => text.text),
          );
        } finally {
          prototype.addChild = original;
        }
      },
      { model, labels },
    );
    expect(new Set(drawn)).toEqual(new Set(Object.values(labels)));
    expect(drawn).toHaveLength(24);
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1600, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await page.evaluate(({ width, height }) => {
        window.task23Gallery.resize(width, height, 1);
        window.task23Gallery.fit();
      }, size);
      await page.screenshot({
        path: `test-results/task23-identities-${language}-${size.width}x${size.height}.png`,
      });
    }
    await page.evaluate(() => {
      window.task23Gallery.destroy();
    });
  });
}
