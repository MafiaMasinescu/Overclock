import { describe, expect, test } from "vitest";

import {
  ContentValidationError,
  loadContentBundle,
  validateContent,
} from "../../src/content/loader/contentLoader.ts";
import {
  createRawContentPack,
  type RawContentPack,
} from "../../src/content/loader/rawContentPack.ts";

function clonePack(): RawContentPack {
  return structuredClone(createRawContentPack());
}

function firstItem<Item>(items: readonly Item[]): Item {
  const item = items[0];
  if (item === undefined) {
    throw new Error("Expected fixture to contain an item");
  }
  return item;
}

function captureValidationError(pack: RawContentPack): ContentValidationError {
  try {
    validateContent(pack);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ContentValidationError);
    return error as ContentValidationError;
  }

  throw new Error("Expected content validation to fail");
}

describe("content loading", () => {
  test("loads the complete supplied pack into a deeply immutable bundle", () => {
    const bundle = loadContentBundle();

    expect(bundle.contentVersion).toBe("0.1.0");
    expect(Object.keys(bundle.modules)).toHaveLength(12);
    expect(Object.keys(bundle.tasks)).toHaveLength(8);
    expect(Object.keys(bundle.research)).toHaveLength(10);
    expect(bundle.locales.en.ui["build"]).toBe("Build");
    expect(bundle.locales.ro.ui["build"]).toBe("Build");
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.modules["module-vacuum-tube-logic"]?.thermal)).toBe(true);
    expect(Object.isFrozen(bundle.locales.en.ui)).toBe(true);
  });

  test("loads explicit thermal behavior for every supplied module", () => {
    const bundle = loadContentBundle();

    expect(bundle.modules["module-vacuum-tube-logic"]).toMatchObject({
      thermalBehavior: { role: "none" },
    });
    expect(bundle.modules["module-air-mover"]).toMatchObject({
      thermalBehavior: { role: "local-airflow", rangeTiles: 4 },
    });
    expect(bundle.modules["module-room-cooling"]).toMatchObject({
      thermalBehavior: { role: "extraction" },
    });
  });

  test("reports the exact path for an unknown research prerequisite", () => {
    const pack = clonePack();
    firstItem(pack.research.nodes).prerequisites = ["research-does-not-exist"];

    const error = captureValidationError(pack);

    expect(error.message).toContain(
      "research.nodes[0].prerequisites[0]: unknown research node research-does-not-exist",
    );
  });

  test("rejects a dependency cycle with the involved research path", () => {
    const pack = clonePack();
    firstItem(pack.research.nodes).prerequisites = ["research-transistor-theory"];

    const error = captureValidationError(pack);

    expect(error.message).toContain(
      "research.nodes: dependency cycle research-stable-power-distribution -> research-transistor-theory",
    );
  });

  test("requires every referenced localization in both languages", () => {
    const pack = clonePack();
    const localizedModule = pack.locales.en.modules["module-power-distribution"] as {
      description?: string;
    };
    delete localizedModule.description;

    const error = captureValidationError(pack);

    expect(error.message).toContain(
      "locales.en.modules.module-power-distribution.description: missing localization",
    );
  });

  test("reports Zod paths for malformed content", () => {
    const pack = clonePack();
    firstItem(pack.modules.modules).footprint.width = 0;

    const error = captureValidationError(pack);

    expect(error.message).toContain("modules.modules[0].footprint.width");
  });

  test("rejects duplicate port IDs inside one module definition", () => {
    const pack = clonePack();
    const module = firstItem(pack.modules.modules);
    const firstPort = firstItem(module.ports);
    const secondPort = module.ports[1];
    if (secondPort === undefined) {
      throw new Error("Expected a second port fixture.");
    }
    secondPort.id = firstPort.id;

    const error = captureValidationError(pack);

    expect(error.issues).toContainEqual({
      path: "modules.modules[0].ports[1].id",
      message: `duplicate port id ${firstPort.id}`,
    });
  });

  test.each([
    { side: "north" as const, dimension: "width" as const },
    { side: "south" as const, dimension: "width" as const },
    { side: "east" as const, dimension: "height" as const },
    { side: "west" as const, dimension: "height" as const },
  ])("rejects a $side port offset outside the unrotated $dimension", ({ side, dimension }) => {
    const pack = clonePack();
    const module = firstItem(pack.modules.modules);
    const port = firstItem(module.ports);
    port.side = side;
    port.offset = module.footprint[dimension];

    const error = captureValidationError(pack);

    expect(error.issues).toContainEqual({
      path: "modules.modules[0].ports[0].offset",
      message: `${side} port offset must be smaller than footprint ${dimension}`,
    });
  });

  test("enforces the vertical-slice maximum unrotated footprint of 3 x 2", () => {
    const pack = clonePack();
    firstItem(pack.modules.modules).footprint.height = 3;

    const error = captureValidationError(pack);

    expect(error.issues.some(({ path }) => path === "modules.modules[0].footprint.height")).toBe(
      true,
    );
  });

  test("rejects module load power below idle power", () => {
    const pack = clonePack();
    const module = firstItem(pack.modules.modules);
    module.loadPowerWatts = module.idlePowerWatts - 1;

    const error = captureValidationError(pack);

    expect(error.issues).toContainEqual({
      path: "modules.modules[0].loadPowerWatts",
      message: "load power must be greater than or equal to idle power",
    });
  });

  test("rejects thermal behavior that contradicts cooling and airflow content", () => {
    const pack = clonePack();
    const airMover = pack.modules.modules.find(({ id }) => id === "module-air-mover");
    if (airMover === undefined) {
      throw new Error("Expected the supplied air mover module.");
    }
    airMover.thermalBehavior = { role: "local-airflow", rangeTiles: 4 };
    airMover.ports = airMover.ports.filter(({ kind }) => kind !== "airflow");

    const error = captureValidationError(pack);

    expect(error.issues).toContainEqual({
      path: "modules.modules[10].thermalBehavior",
      message: "local-airflow thermal behavior requires at least one airflow port",
    });
  });

  test("rejects cooling watts on a module with no thermal behavior", () => {
    const pack = clonePack();
    const logic = pack.modules.modules.find(({ id }) => id === "module-vacuum-tube-logic");
    if (logic === undefined) {
      throw new Error("Expected the supplied logic module.");
    }
    logic.coolingWatts = 1;

    const error = captureValidationError(pack);

    expect(error.issues).toContainEqual({
      path: "modules.modules[1].thermalBehavior",
      message: "none thermal behavior requires zero cooling watts",
    });
  });

  test("rejects an extraction module without cooling capacity", () => {
    const pack = clonePack();
    const roomCooling = pack.modules.modules.find(({ id }) => id === "module-room-cooling");
    if (roomCooling === undefined) {
      throw new Error("Expected the supplied room cooling module.");
    }
    roomCooling.coolingWatts = 0;

    const error = captureValidationError(pack);

    expect(error.issues).toContainEqual({
      path: "modules.modules[11].thermalBehavior",
      message: "extraction thermal behavior requires positive cooling watts",
    });
  });
});
