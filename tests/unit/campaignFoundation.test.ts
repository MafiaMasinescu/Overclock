import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createRawContentPack } from "../../src/content/loader/rawContentPack.ts";
import {
  calculateCampaignTicksPerYear,
  calculateCampaignYearForCompletedTick,
  validateCampaignBranchStructure,
  validateCampaignTimelineCoherence,
} from "../../src/sim/campaign/campaignDomain.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  DEFAULT_BOT_RUN_CONFIGURATION,
  MAXIMUM_FORCED_DEADTIME_TICKS,
  MILESTONE_IDS,
  createDefaultBotRunConfiguration,
  validateBotRunConfiguration,
} from "../../src/devtools/milestoneBot/botContracts.ts";

describe("Task 15 campaign foundations", () => {
  test("uses the exact 1,200-second calendar contract", () => {
    const content = loadContentBundle();

    expect(content.balancing.campaign.secondsPerYear).toBe(1200);
    expect(calculateCampaignTicksPerYear(content)).toBe(12_000);
  });

  test.each([
    [0, 1946],
    [11_999, 1946],
    [12_000, 1947],
    [23_999, 1947],
    [24_000, 1948],
    [45_000, 1948],
  ])("derives the canonical year at completed tick %i", (tick, expectedYear) => {
    const content = loadContentBundle();
    expect(calculateCampaignYearForCompletedTick(tick, content)).toBe(expectedYear);
  });

  test("rejects a forward year that is not the exact tick projection", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-forward-year" });
    state.campaign.currentYear = 1948;
    expect(validateCampaignTimelineCoherence(state, content)).toContainEqual({
      path: "campaign.currentYear",
      message: "must equal 1946 for completed tick 0",
    });
  });

  test("validates campaign state against the current era without mutation", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-foundation" });
    const before = structuredClone(state.campaign);

    expect(validateCampaignBranchStructure(state.campaign, content)).toEqual([]);
    expect(validateCampaignTimelineCoherence(state, content)).toEqual([]);
    expect(state.campaign).toEqual(before);
  });

  test("reports a missing Campaign branch without dereferencing malformed input", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-missing-branch" });
    const malformed = { ...state } as Partial<typeof state>;
    delete malformed.campaign;

    expect(() => validateCampaignTimelineCoherence(malformed as never, content)).not.toThrow();
    expect(validateCampaignTimelineCoherence(malformed as never, content)).toEqual([
      { path: "campaign", message: "must be a canonical plain serializable object" },
    ]);
  });

  test("rejects a Campaign accessor without executing it through the public full-state validator", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-public-accessor" });
    let reads = 0;
    Object.defineProperty(state, "campaign", {
      enumerable: true,
      get() {
        reads += 1;
        return createInitialGameState({ content, seed: "unreachable" }).campaign;
      },
    });

    expect(validateCampaignTimelineCoherence(state, content)).toEqual([
      { path: "state", message: "must be a canonical plain serializable object" },
    ]);
    expect(reads).toBe(0);
  });

  test.each([
    ["currentYear", -0],
    ["currentYear", 1945],
    ["currentYear", 1949],
    ["currentYear", 1946.5],
    ["currentYear", Number.NaN],
    ["currentYear", Number.POSITIVE_INFINITY],
    ["reputation", -0],
    ["reputation", -1],
  ])("rejects invalid %s value", (field, value) => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "invalid-campaign" });
    const invalid = { ...state.campaign, [field]: value };

    const issues = validateCampaignBranchStructure(invalid, content);
    expect(
      issues.some((issue) => issue.path === `campaign.${field}` || issue.path === "campaign"),
    ).toBe(true);
  });

  test("rejects a wrong era and never depends on insertion order", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-order" });
    const reordered = {
      reputation: state.campaign.reputation,
      verticalSliceCompleted: state.campaign.verticalSliceCompleted,
      transistorRevealed: state.campaign.transistorRevealed,
      objectiveKey: state.campaign.objectiveKey,
      currentYear: state.campaign.currentYear,
      eraId: state.campaign.eraId,
    };

    expect(validateCampaignBranchStructure(reordered, content)).toEqual([]);
    expect(
      validateCampaignBranchStructure({ ...reordered, eraId: "wrong-era" } as never, content),
    ).toContainEqual({ path: "campaign.eraId", message: "must match the current content era" });
  });

  test("exposes the frozen bot defaults and fixed milestone order", () => {
    const configuration = createDefaultBotRunConfiguration();

    expect(configuration).toEqual(DEFAULT_BOT_RUN_CONFIGURATION);
    expect(MAXIMUM_FORCED_DEADTIME_TICKS).toBe(3_000);
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(MILESTONE_IDS).toHaveLength(14);
    expect(validateBotRunConfiguration(configuration)).toEqual([]);
  });

  test("rejects bot configuration key drift and nonstandard objects", () => {
    expect(validateBotRunConfiguration({ ...DEFAULT_BOT_RUN_CONFIGURATION, extra: 1 })).not.toEqual(
      [],
    );
    expect(validateBotRunConfiguration(Object.create(null))).not.toEqual([]);
  });

  test("content source includes only the approved campaign addition", () => {
    const raw = createRawContentPack();
    expect(raw.balancing.campaign).toEqual({ secondsPerYear: 1200 });
    expect(raw.balancing.tickMilliseconds).toBe(100);
  });
});
