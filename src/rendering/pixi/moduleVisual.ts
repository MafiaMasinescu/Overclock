import { Container, Graphics, Text } from "pixi.js";

import type { GridModuleViewModel } from "../../app/game-client/snapshots.ts";

export interface ModuleVisual {
  readonly container: Container;
  readonly body: Graphics;
  readonly design: Graphics;
  readonly status: Graphics;
  readonly label: Text;
  /** Returns true only when presentation changed; temperature is not consumed here. */
  update(module: GridModuleViewModel, shortLabel: string): boolean;
}

type PrimitiveDesign = (graphics: Graphics) => void;
const INK = 0xc8d1d8;
const AMBER = 0xd5ac67;
const CYAN = 0x80bdc8;

// Cabinet pictograms, not additional gameplay geometry. Each uses a 100×100 local square.
const designs: Readonly<Record<string, PrimitiveDesign>> = {
  "module-power-distribution": (g) => {
    g.rect(12, 8, 76, 84).stroke({ color: AMBER, width: 5 });
    for (const y of [28, 50, 72]) {
      g.rect(24, y - 5, 15, 10).fill(AMBER);
      g.moveTo(49, y).lineTo(76, y).stroke({ color: INK, width: 5 });
    }
  },
  "module-vacuum-tube-logic": (g) => {
    for (const x of [24, 50, 76]) {
      g.roundRect(x - 9, 12, 18, 58, 9).stroke({ color: AMBER, width: 4 });
      g.moveTo(x, 26).lineTo(x, 56).stroke({ color: INK, width: 3 });
      g.rect(x - 12, 74, 24, 12).fill(INK);
    }
  },
  "module-arithmetic-unit": (g) => {
    g.poly([10, 15, 43, 15, 50, 30, 57, 15, 90, 15, 68, 50, 90, 85, 10, 85, 32, 50], true).stroke({
      color: AMBER,
      width: 5,
    });
    g.moveTo(38, 63).lineTo(62, 63).moveTo(50, 51).lineTo(50, 75).stroke({ color: INK, width: 5 });
  },
  "module-control-unit": (g) => {
    g.circle(30, 30, 15).stroke({ color: AMBER, width: 5 });
    g.moveTo(30, 30).lineTo(30, 19).moveTo(30, 30).lineTo(40, 36).stroke({ color: INK, width: 4 });
    for (const y of [25, 50, 75]) g.rect(62, y - 5, 24, 10).fill(INK);
    g.moveTo(15, 62).lineTo(45, 62).lineTo(45, 85).stroke({ color: CYAN, width: 5 });
  },
  "module-accumulator-register": (g) => {
    for (const y of [18, 42, 66]) {
      g.rect(12, y, 76, 16).stroke({ color: CYAN, width: 4 });
      for (const x of [25, 50, 75]) g.circle(x, y + 8, 3).fill(INK);
    }
  },
  "module-delay-line-memory": (g) => {
    g.roundRect(8, 18, 84, 64, 22).stroke({ color: CYAN, width: 5 });
    g.moveTo(20, 36)
      .lineTo(34, 36)
      .lineTo(34, 64)
      .lineTo(50, 64)
      .lineTo(50, 36)
      .lineTo(66, 36)
      .lineTo(66, 64)
      .lineTo(80, 64)
      .stroke({ color: INK, width: 5 });
  },
  "module-punch-card-reader": (g) => {
    g.poly([16, 10, 72, 10, 86, 24, 86, 76, 16, 76], true).fill(INK);
    for (const x of [30, 50, 70]) {
      for (const y of [30, 52]) g.rect(x - 4, y, 8, 12).fill(0x1a2630);
    }
    g.moveTo(8, 88).lineTo(92, 88).stroke({ color: AMBER, width: 6 });
  },
  "module-paper-tape-reader": (g) => {
    g.circle(24, 28, 16).stroke({ color: INK, width: 5 });
    g.circle(76, 72, 16).stroke({ color: INK, width: 5 });
    g.poly([24, 16, 86, 60, 76, 84, 14, 40], true).fill(AMBER);
    for (const p of [32, 50, 68]) g.circle(p, p, 4).fill(0x1a2630);
  },
  "module-line-printer": (g) => {
    g.rect(24, 8, 52, 58).fill(INK);
    for (const y of [20, 33, 46])
      g.moveTo(33, y).lineTo(67, y).stroke({ color: 0x1a2630, width: 4 });
    g.rect(8, 62, 84, 30).stroke({ color: AMBER, width: 5 });
    g.moveTo(20, 76).lineTo(80, 76).stroke({ color: INK, width: 5 });
  },
  "module-data-relay": (g) => {
    g.moveTo(8, 50)
      .lineTo(35, 50)
      .lineTo(65, 27)
      .moveTo(65, 50)
      .lineTo(92, 50)
      .stroke({ color: CYAN, width: 7 });
    g.circle(35, 50, 6).fill(INK);
    g.circle(65, 50, 6).fill(INK);
    g.rect(32, 74, 36, 14).stroke({ color: AMBER, width: 4 });
  },
  "module-air-mover": (g) => {
    g.circle(50, 50, 41).stroke({ color: CYAN, width: 4 });
    g.ellipse(50, 28, 10, 18)
      .ellipse(72, 50, 18, 10)
      .ellipse(50, 72, 10, 18)
      .ellipse(28, 50, 18, 10)
      .fill(INK);
    g.circle(50, 50, 9).fill(AMBER);
  },
  "module-room-cooling": (g) => {
    g.rect(8, 10, 84, 80).stroke({ color: CYAN, width: 5 });
    for (const x of [24, 38, 52]) g.moveTo(x, 22).lineTo(x, 78).stroke({ color: INK, width: 5 });
    g.circle(74, 36, 10).stroke({ color: AMBER, width: 4 });
    g.moveTo(68, 62).lineTo(80, 62).moveTo(68, 74).lineTo(80, 74).stroke({ color: CYAN, width: 4 });
  },
};

function designFor(module: GridModuleViewModel): PrimitiveDesign {
  return designs[module.definitionId] ?? designs[module.spriteKey] ?? unknownDesign;
}

function unknownDesign(g: Graphics): void {
  g.rect(15, 15, 70, 70).stroke({ color: INK, width: 5 });
  g.moveTo(30, 30).lineTo(70, 70).moveTo(70, 30).lineTo(30, 70).stroke({ color: INK, width: 5 });
}

function drawStatus(g: Graphics, module: GridModuleViewModel, width: number, height: number): void {
  const color =
    module.warning === "thermal"
      ? 0xe9724c
      : module.warning === "power"
        ? 0xf0c95a
        : module.warning === "route"
          ? 0xd78df2
          : module.operationalState === "online"
            ? 0x68d6b0
            : module.operationalState === "starting"
              ? 0x71a9ef
              : module.operationalState === "brownout"
                ? 0xd9a441
                : 0x7a8598;
  g.clear()
    .roundRect(2, 2, width - 4, height - 4, 4)
    .stroke({ color, width: module.selected ? 3 : 1.5, alignment: 1 });
  // A separate state mark survives warnings; shape conveys state without color alone.
  const x = 7;
  const y = 7;
  switch (module.operationalState) {
    case "online":
      g.circle(x, y, 2).fill(0x68d6b0);
      break;
    case "offline":
      g.circle(x, y, 2).stroke({ color: INK, width: 1 });
      break;
    case "starting":
      g.poly([x, y - 3, x + 3, y + 2, x - 3, y + 2], true).fill(0x71a9ef);
      break;
    case "brownout":
      g.moveTo(x - 2, y - 2)
        .lineTo(x + 2, y + 2)
        .moveTo(x + 2, y - 2)
        .lineTo(x - 2, y + 2)
        .stroke({ color: 0xd9a441, width: 1.5 });
      break;
    case "shutdown":
      g.rect(x - 2, y - 2, 4, 4).fill(INK);
      break;
  }
  // Warning marks stay in the upper-right corner, clear of the localized name.
  const right = width - 8;
  if (module.warning === "thermal") {
    g.circle(right, 10, 2).fill(color);
    g.moveTo(right, 4).lineTo(right, 9).stroke({ color, width: 2 });
  } else if (module.warning === "power") {
    g.poly(
      [right + 1, 3, right - 3, 8, right, 8, right - 1, 12, right + 3, 6, right, 6],
      true,
    ).fill(color);
  } else if (module.warning === "route") {
    g.moveTo(right - 3, 5)
      .lineTo(right, 5)
      .lineTo(right, 10)
      .lineTo(right + 3, 10)
      .stroke({ color, width: 2 });
  }
}

/**
 * Attach once per keyed module: createModuleVisual(model, t(`modules.${model.definitionId}.shortName`), target).
 * Then call visual.update(model, localizedName); it reuses every child and returns actual dirty work.
 * target must be a dedicated module container. Destroy it with { children: true, context: true }.
 * Footprint is already rotated: the cabinet/label remain upright; only its pictogram rotates.
 * No textures, timers, translation lookup, or authoritative model mutation are performed here.
 */
export function createModuleVisual(
  module: GridModuleViewModel,
  shortLabel: string,
  target = new Container(),
): ModuleVisual {
  const body = new Graphics();
  const design = new Graphics();
  const status = new Graphics();
  // These bounded cabinet primitives share Pixi's ordinary batch shader. Keep
  // detailed pictograms in the same batch instead of a draw call per cabinet.
  for (const graphic of [body, design, status]) graphic.context.batchMode = "batch";
  const label = new Text({
    text: shortLabel,
    style: { fill: 0xf4f7fa, fontFamily: "monospace", fontSize: 8, align: "center" },
  });
  label.anchor.set(0.5, 1);
  target.addChild(body, design, status, label);
  let geometry = "";
  let state = "";
  let previousDesign: PrimitiveDesign | undefined;

  const visual: ModuleVisual = {
    container: target,
    body,
    design,
    status,
    label,
    update(next, localizedName) {
      let changed = false;
      const width = next.footprint.width * 32;
      const height = next.footprint.height * 32;
      const nextGeometry = `${width}/${height}`;
      const geometryChanged = geometry !== nextGeometry;
      if (geometryChanged) {
        body
          .clear()
          .roundRect(2, 2, width - 4, height - 4, 4)
          .fill(0x1a2630);
        // Square pictograms fit every quarter turn without swapping the projected footprint.
        const size = Math.min(width - 12, height - 16);
        design.scale.set(size / 100);
        design.pivot.set(50, 50);
        design.position.set(width / 2, (height - 10) / 2);
        label.position.set(width / 2, height - 4);
        geometry = nextGeometry;
        changed = true;
      }
      const draw = designFor(next);
      if (draw !== previousDesign) {
        design.clear();
        draw(design);
        previousDesign = draw;
        changed = true;
      }
      const angle = (next.rotation * Math.PI) / 180;
      if (design.rotation !== angle) {
        design.rotation = angle;
        changed = true;
      }
      const nextState = `${next.operationalState}/${next.warning}/${next.selected}`;
      if (geometryChanged || nextState !== state) {
        drawStatus(status, next, width, height);
        state = nextState;
        changed = true;
      }
      if (label.text !== localizedName) {
        label.text = localizedName;
        changed = true;
      }
      if (target.x !== next.position.x * 32 || target.y !== next.position.y * 32) {
        target.position.set(next.position.x * 32, next.position.y * 32);
        changed = true;
      }
      return changed;
    },
  };
  visual.update(module, shortLabel);
  return visual;
}
