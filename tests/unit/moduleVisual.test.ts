import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, test } from "vitest";

import definitions from "../../content/modules.json";
import en from "../../content/en/common.json";
import ro from "../../content/ro/common.json";
import type { GridModuleViewModel } from "../../src/app/game-client/snapshots.ts";
import { createModuleVisual } from "../../src/rendering/pixi/moduleVisual.ts";

function makeModule(definition = definitions.modules[0]): GridModuleViewModel {
  if (definition === undefined) throw new Error("Missing module content fixture");
  return {
    id: "installed-instance-123456",
    definitionId: definition.id,
    // The production projector supplies category keys, which are not twelve identities.
    spriteKey: `module-${definition.category}`,
    position: { x: 2, y: 3 },
    footprint: { ...definition.footprint },
    ports: [],
    rotation: 0,
    operationalState: "online",
    selected: false,
    warning: "none",
    temperatureC: 22,
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  };
}

// Exclude color and labels: twelve differently tinted generic bodies must fail.
function primitivePaths(graphics: Graphics): string {
  return JSON.stringify(
    graphics.context.instructions.map((instruction) =>
      instruction.action === "texture"
        ? "texture"
        : { action: instruction.action, path: instruction.data.path.instructions },
    ),
  );
}

describe("local module visuals", () => {
  test("renders twelve distinct actual primitive designs for the content identities", () => {
    expect(definitions.modules).toHaveLength(12);
    const paths = new Set<string>();
    for (const definition of definitions.modules) {
      const visual = createModuleVisual(makeModule(definition), "Identity");
      expect(visual.container).toBeInstanceOf(Container);
      expect(visual.body).toBeInstanceOf(Graphics);
      expect(visual.design).toBeInstanceOf(Graphics);
      expect(visual.label).toBeInstanceOf(Text);
      expect(visual.design.context.instructions.length).toBeGreaterThan(1);
      expect(visual.design.context.instructions.some((item) => item.action === "texture")).toBe(
        false,
      );
      paths.add(primitivePaths(visual.design));
      visual.container.destroy({ children: true, context: true });
    }
    expect(paths.size).toBe(12);
  });

  test("uses caller supplied RO/EN short names and already rotated footprints at all quarter turns", () => {
    for (const locale of [en, ro]) {
      const shortNames = new Set<string>();
      for (const definition of definitions.modules) {
        const names = locale.modules[definition.id as keyof typeof locale.modules];
        expect(names.shortName.length).toBeGreaterThan(0);
        expect(names.shortName.length).toBeLessThanOrEqual(12);
        shortNames.add(names.shortName);
        for (const rotation of [0, 90, 180, 270] as const) {
          const model = makeModule(definition);
          model.rotation = rotation;
          if (rotation === 90 || rotation === 270) {
            model.footprint = {
              width: definition.footprint.height,
              height: definition.footprint.width,
            };
          }
          const before = structuredClone(model);
          const visual = createModuleVisual(model, names.shortName);
          expect(visual.label.text).toBe(names.shortName);
          expect(visual.label.rotation).toBe(0);
          expect(visual.container.rotation).toBe(0);
          expect(visual.container.position.x).toBe(64);
          expect(visual.container.position.y).toBe(96);
          const bounds = visual.body.context.bounds;
          expect(bounds.minX).toBeGreaterThanOrEqual(0);
          expect(bounds.minY).toBeGreaterThanOrEqual(0);
          expect(bounds.maxX).toBeLessThanOrEqual(model.footprint.width * 32);
          expect(bounds.maxY).toBeLessThanOrEqual(model.footprint.height * 32);
          expect(bounds.width).toBe(model.footprint.width * 32 - 4);
          expect(bounds.height).toBe(model.footprint.height * 32 - 4);
          expect(visual.design.rotation).toBeCloseTo((rotation * Math.PI) / 180);
          expect(visual.label.position.x).toBe(model.footprint.width * 16);
          expect(model).toEqual(before);
          visual.container.destroy({ children: true, context: true });
        }
      }
      expect(shortNames.size).toBe(12);
    }
  });

  test("reuses owned children and instructions on unchanged or temperature only updates", () => {
    const model = makeModule();
    const target = new Container();
    const visual = createModuleVisual(model, "Power", target);
    const children = [...target.children];
    const bodyInstructions = [...visual.body.context.instructions];
    const designInstructions = [...visual.design.context.instructions];
    const statusInstructions = [...visual.status.context.instructions];
    expect(visual.container).toBe(target);
    expect(visual.update(model, "Power")).toBe(false);
    expect(visual.update({ ...model, temperatureC: 81 }, "Power")).toBe(false);
    expect(visual.update({ ...model, temperatureC: null }, "Power")).toBe(false);
    target.children.forEach((child, index) => {
      expect(child).toBe(children[index]);
    });
    visual.body.context.instructions.forEach((item, index) => {
      expect(item).toBe(bodyInstructions[index]);
    });
    visual.design.context.instructions.forEach((item, index) => {
      expect(item).toBe(designInstructions[index]);
    });
    visual.status.context.instructions.forEach((item, index) => {
      expect(item).toBe(statusInstructions[index]);
    });
    expect(visual.update({ ...model, position: { x: 4, y: 5 } }, "Electric")).toBe(true);
    expect(target.position.x).toBe(128);
    expect(target.position.y).toBe(160);
    expect(visual.label.text).toBe("Electric");
    expect(visual.body.context.instructions[0]).toBe(bodyInstructions[0]);
    const bodyContext = visual.body.context;
    const designContext = visual.design.context;
    target.destroy({ children: true, context: true });
    expect(bodyContext.destroyed).toBe(true);
    expect(designContext.destroyed).toBe(true);
  });

  test("retains the definition design when warnings, state and selection change", () => {
    const model = makeModule();
    const visual = createModuleVisual(model, "Power");
    const originalDesign = visual.design.context.instructions[0];
    const states = new Set<string>();
    for (const operationalState of [
      "offline",
      "starting",
      "online",
      "brownout",
      "shutdown",
    ] as const) {
      visual.update({ ...model, operationalState }, "Power");
      states.add(primitivePaths(visual.status));
      expect(visual.design.context.instructions[0]).toBe(originalDesign);
    }
    expect(states.size).toBe(5);
    const warnings = new Set<string>();
    for (const warning of ["none", "power", "thermal", "route"] as const) {
      visual.update({ ...model, warning, selected: true }, "Power");
      warnings.add(primitivePaths(visual.status));
      expect(visual.design.context.instructions[0]).toBe(originalDesign);
      expect(
        visual.status.context.instructions.some(
          (item) => item.action === "stroke" && item.data.style.width === 3,
        ),
      ).toBe(true);
    }
    expect(warnings.size).toBe(4);
    visual.container.destroy({ children: true, context: true });
  });

  test("prefers exact definition identity, falls back to exact sprite identity and updates in place", () => {
    const model = makeModule();
    const visual = createModuleVisual(model, "Power");
    const powerPath = primitivePaths(visual.design);
    visual.update({ ...model, spriteKey: "module-air-mover" }, "Power");
    expect(primitivePaths(visual.design)).toBe(powerPath);
    visual.update({ ...model, definitionId: "unknown", spriteKey: "module-air-mover" }, "Fan");
    expect(primitivePaths(visual.design)).not.toBe(powerPath);
    const fan = createModuleVisual({ ...model, definitionId: "module-air-mover" }, "Fan");
    expect(primitivePaths(visual.design)).toBe(primitivePaths(fan.design));
    expect(visual.label.text).toBe("Fan");
    visual.container.destroy({ children: true, context: true });
    fan.container.destroy({ children: true, context: true });
  });
});
