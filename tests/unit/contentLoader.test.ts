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
});
