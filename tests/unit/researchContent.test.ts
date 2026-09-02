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

function captureValidationError(pack: RawContentPack): ContentValidationError {
  try {
    validateContent(pack);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ContentValidationError);
    return error as ContentValidationError;
  }

  throw new Error("Expected content validation to fail");
}

function researchNode(pack: RawContentPack, id: string) {
  const node = pack.research.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`Missing research node ${id}`);
  return node;
}

function moduleDefinition(pack: RawContentPack, id: string) {
  const module = pack.modules.modules.find((candidate) => candidate.id === id);
  if (module === undefined) throw new Error(`Missing module ${id}`);
  return module;
}

describe("Research content validation", () => {
  test.each([
    [
      "zero required operations",
      (pack: RawContentPack) =>
        (researchNode(pack, "research-stable-power-distribution").requiredOperations = 0),
    ],
    [
      "non-finite required operations",
      (pack: RawContentPack) =>
        (researchNode(pack, "research-stable-power-distribution").requiredOperations =
          Number.POSITIVE_INFINITY),
    ],
    [
      "zero minimum Compute share",
      (pack: RawContentPack) =>
        (researchNode(pack, "research-stable-power-distribution").minimumComputeShare = 0),
    ],
    [
      "minimum Compute share above one",
      (pack: RawContentPack) =>
        (researchNode(pack, "research-stable-power-distribution").minimumComputeShare = 1.1),
    ],
    [
      "non-finite minimum Compute share",
      (pack: RawContentPack) =>
        (researchNode(pack, "research-stable-power-distribution").minimumComputeShare = Number.NaN),
    ],
  ])("requires positive finite Research numeric content: %s", (_name, mutate) => {
    const error = captureValidationError(
      (() => {
        const pack = clonePack();
        mutate(pack);
        return pack;
      })(),
    );

    expect(
      error.issues.some(
        (issue) =>
          issue.path.includes("requiredOperations") || issue.path.includes("minimumComputeShare"),
      ),
    ).toBe(true);
  });

  test.each([
    [
      "prerequisites",
      (node: ReturnType<typeof researchNode>) =>
        (node.prerequisites = [
          "research-stable-power-distribution",
          "research-stable-power-distribution",
        ]),
    ],
    [
      "required evidence tags",
      (node: ReturnType<typeof researchNode>) =>
        (node.requiredEvidenceTags = ["evidence-tube-failure-log", "evidence-tube-failure-log"]),
    ],
    [
      "required benchmark IDs",
      (node: ReturnType<typeof researchNode>) =>
        (node.requiredBenchmarkIds = ["benchmark-peak-throughput", "benchmark-peak-throughput"]),
    ],
    [
      "unlock module IDs",
      (node: ReturnType<typeof researchNode>) =>
        (node.unlockModuleIds = ["module-arithmetic-unit", "module-arithmetic-unit"]),
    ],
    [
      "unlock feature IDs",
      (node: ReturnType<typeof researchNode>) =>
        (node.unlockFeatureIds = ["feature-a", "feature-a"]),
    ],
  ])("requires unique %s", (_name, mutate) => {
    const pack = clonePack();
    mutate(researchNode(pack, "research-stable-power-distribution"));

    const error = captureValidationError(pack);

    expect(
      error.issues.some(
        (issue) =>
          issue.path.includes("research.nodes[0]") ||
          issue.path.includes("prerequisites") ||
          issue.path.includes("requiredEvidenceTags") ||
          issue.path.includes("requiredBenchmarkIds") ||
          issue.path.includes("unlockModuleIds") ||
          issue.path.includes("unlockFeatureIds"),
      ),
    ).toBe(true);
  });

  test("does not require a feature registry", () => {
    const pack = clonePack();
    researchNode(pack, "research-stable-power-distribution").unlockFeatureIds = [
      "feature-not-yet-registered",
    ];

    expect(
      validateContent(pack).research["research-stable-power-distribution"]?.unlockFeatureIds,
    ).toEqual(["feature-not-yet-registered"]);
  });

  test("requires unique Research sort orders", () => {
    const pack = clonePack();
    researchNode(pack, "research-vacuum-tube-reliability").sortOrder = 10;

    expect(
      captureValidationError(pack).issues.some(
        (issue) => issue.path === "research.nodes[1].sortOrder",
      ),
    ).toBe(true);
  });

  test.each([
    [
      "research prerequisite",
      (pack: RawContentPack) => {
        researchNode(pack, "research-vacuum-tube-reliability").prerequisites = ["research-missing"];
      },
    ],
    [
      "required evidence",
      (pack: RawContentPack) => {
        researchNode(pack, "research-vacuum-tube-reliability").requiredEvidenceTags = [
          "evidence-missing",
        ];
      },
    ],
    [
      "required benchmark",
      (pack: RawContentPack) => {
        researchNode(pack, "research-transistor-theory").requiredBenchmarkIds = [
          "benchmark-missing",
        ];
      },
    ],
    [
      "unlocked module",
      (pack: RawContentPack) => {
        researchNode(pack, "research-stable-power-distribution").unlockModuleIds = [
          "module-missing",
        ];
      },
    ],
    [
      "module unlock research",
      (pack: RawContentPack) => {
        moduleDefinition(pack, "module-arithmetic-unit").unlockResearchIds = ["research-missing"];
      },
    ],
  ])("requires every %s reference to exist", (_name, mutate) => {
    const pack = clonePack();
    mutate(pack);

    expect(captureValidationError(pack).issues.length).toBeGreaterThan(0);
  });

  test("continues to reject Research dependency cycles", () => {
    const pack = clonePack();
    researchNode(pack, "research-stable-power-distribution").prerequisites = [
      "research-transistor-theory",
    ];

    expect(captureValidationError(pack).message).toContain("dependency cycle");
  });

  test("requires exactly one final-reveal node", () => {
    const twoFinal = clonePack();
    researchNode(twoFinal, "research-stable-power-distribution").finalReveal = true;
    expect(
      captureValidationError(twoFinal).issues.some((issue) => issue.path === "research.nodes"),
    ).toBe(true);

    const noFinal = clonePack();
    researchNode(noFinal, "research-transistor-theory").finalReveal = false;
    expect(
      captureValidationError(noFinal).issues.some((issue) => issue.path === "research.nodes"),
    ).toBe(true);
  });

  test("requires the final node to be mandatory", () => {
    const pack = clonePack();
    researchNode(pack, "research-transistor-theory").mandatory = false;

    expect(
      captureValidationError(pack).issues.some(
        (issue) => issue.path === "research.nodes[9].mandatory",
      ),
    ).toBe(true);
  });

  test("requires mandatory non-final nodes to be prerequisites of the final node", () => {
    const pack = clonePack();
    researchNode(pack, "research-buffered-io").mandatory = true;

    expect(
      captureValidationError(pack).issues.some(
        (issue) => issue.path === "research.nodes[5].mandatory",
      ),
    ).toBe(true);
  });

  test("requires module unlock relationships to be bidirectional", () => {
    const missingFromModule = clonePack();
    moduleDefinition(missingFromModule, "module-arithmetic-unit").unlockResearchIds = [];
    expect(
      captureValidationError(missingFromModule).issues.some((issue) =>
        issue.path.includes("unlockResearchIds"),
      ),
    ).toBe(true);

    const missingFromResearch = clonePack();
    researchNode(missingFromResearch, "research-stable-power-distribution").unlockModuleIds = [];
    expect(
      captureValidationError(missingFromResearch).issues.some((issue) =>
        issue.path.includes("unlockResearchIds"),
      ),
    ).toBe(true);
  });

  test("preserves the supplied Research gameplay values", () => {
    const bundle = loadContentBundle();

    expect(bundle.research["research-transistor-theory"]).toMatchObject({
      cashCostUsd: 4200,
      researchDataCost: 70,
      requiredOperations: 1_800_000,
      minimumComputeShare: 0.2,
      finalReveal: true,
    });
  });
});
