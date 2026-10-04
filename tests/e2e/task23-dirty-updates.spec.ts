import { expect, test } from "@playwright/test";
import type { PixiGridAdapter } from "../../src/app/game-client/contracts.ts";
import type { GridViewModel } from "../../src/app/game-client/snapshots.ts";
import type { Container } from "pixi.js";
import type * as Pixi from "pixi.js";

test("retains unaffected Pixi resources across publications and counts real visual updates", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas[data-pixi-canvas]")).toBeVisible();
  const result = await page.evaluate(async () => {
    const pixiUrl = performance
      .getEntriesByType("resource")
      .find((entry) => entry.name.includes("/pixi__js.js?"))?.name;
    if (pixiUrl === undefined) throw new Error("Loaded Pixi URL missing");
    const pixi = (await import(/* @vite-ignore */ pixiUrl)) as typeof Pixi;
    const url = "/src/rendering/pixi/pixiGridAdapter.ts";
    const { createPixiGridAdapter } = (await import(/* @vite-ignore */ url)) as {
      createPixiGridAdapter: () => PixiGridAdapter;
    };
    const captured: { world: Container | null } = { world: null };
    const prototype = pixi.Container.prototype as {
      addChild: <T extends Container[]>(this: Container, ...children: T) => T[0];
    };
    const original = prototype.addChild;
    prototype.addChild = function <T extends Container[]>(this: Container, ...children: T): T[0] {
      for (const child of children) if (child.label === "facility-world") captured.world = child;
      return original.apply(this, children);
    };
    const host = document.createElement("div");
    host.style.cssText = "width:960px;height:560px";
    document.body.append(host);
    const adapter = createPixiGridAdapter();
    const model: GridViewModel = {
      revision: 1,
      mode: "live",
      layoutRevision: 1,
      thermalRevision: 1,
      gridSize: { width: 24, height: 16 },
      modules: [
        {
          id: "module-a",
          definitionId: "module-vacuum-tube-logic",
          spriteKey: "vacuum-tube-logic",
          position: { x: 2, y: 2 },
          footprint: { width: 2, height: 1 },
          rotation: 0,
          operationalState: "online",
          selected: false,
          warning: "none",
          temperatureC: 25,
          overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
          ports: [
            {
              portId: "power",
              kind: "power-in",
              facingSide: "west",
              moduleTile: { x: 2, y: 2 },
              adjacentTile: { x: 1, y: 2 },
              capacityPerSecond: 100,
            },
          ],
        },
      ],
      routes: [],
      heatmap: {
        full: true,
        values: [
          { x: 0, y: 0, temperatureC: 25 },
          { x: 1, y: 0, temperatureC: 30 },
        ],
      },
      placementPreview: null,
      diagnosticHighlights: [],
    };
    try {
      adapter.mount(host);
      adapter.resize(960, 560, 1);
      adapter.update(model);
      while (adapter.getStatus() === "initializing")
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        );
      if (captured.world === null || adapter.getStatus() !== "ready")
        throw new Error("Fixture not ready");
      const scene = captured.world;
      const layer = (name: string): Container => {
        const found = scene.children.find((child) => child.label === `facility-${name}`);
        if (found === undefined) throw new Error(`Missing ${name} layer`);
        return found;
      };
      const body = layer("modules").children[0]?.children[0];
      const grid = layer("grid").children[0];
      const ports = layer("ports").children[0];
      const selection = layer("selection").children[0];
      const heat = [...layer("heat").children];
      adapter.update(structuredClone(model));
      const retainedUnchanged = [
        body === layer("modules").children[0]?.children[0],
        grid === layer("grid").children[0],
        ports === layer("ports").children[0],
        selection === layer("selection").children[0],
        heat.every((child, index) => child === layer("heat").children[index]),
      ];
      const thermal: GridViewModel = {
        ...model,
        revision: 2,
        thermalRevision: 2,
        modules: model.modules.map((module) => ({ ...module, temperatureC: 55 })),
      };
      adapter.update(thermal);
      const retainedThermal =
        body === layer("modules").children[0]?.children[0] &&
        !body?.destroyed &&
        grid === layer("grid").children[0] &&
        ports === layer("ports").children[0] &&
        selection === layer("selection").children[0];
      const thermalDiagnostics = adapter.getDiagnostics();
      adapter.update({
        ...thermal,
        revision: 3,
        modules: thermal.modules.map((module) => ({ ...module, warning: "thermal" })),
      });
      const warningDiagnostics = adapter.getDiagnostics();
      adapter.update({
        ...thermal,
        revision: 4,
        heatmap: {
          full: true,
          values: [
            { x: 0, y: 0, temperatureC: 50 },
            { x: 1, y: 0, temperatureC: 30 },
          ],
        },
      });
      const retainedHeat =
        heat.length === 2 &&
        heat.every((child, index) => child === layer("heat").children[index] && !child.destroyed);
      return {
        retainedUnchanged,
        retainedThermal,
        thermalDiagnostics,
        warningDiagnostics,
        retainedHeat,
      };
    } finally {
      adapter.destroy();
      host.remove();
      prototype.addChild = original;
    }
  });
  expect(result.retainedUnchanged).toEqual([true, true, true, true, true]);
  expect(result.retainedThermal).toBe(true);
  expect(result.thermalDiagnostics.moduleUpdated).toBe(0);
  expect(result.thermalDiagnostics.gridUpdated).toBe(1);
  expect(result.thermalDiagnostics.portsUpdated).toBe(1);
  expect(result.thermalDiagnostics.selectionUpdated).toBe(1);
  expect(result.thermalDiagnostics.heatCellsUpdated).toBe(2);
  expect(result.warningDiagnostics.moduleUpdated).toBe(1);
  expect(result.retainedHeat).toBe(true);
});
