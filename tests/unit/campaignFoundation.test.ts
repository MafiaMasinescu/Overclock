import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createRawContentPack } from "../../src/content/loader/rawContentPack.ts";
import {
  calculateCampaignTicksPerYear,
  calculateCampaignYearForCompletedTick,
  validateCampaignState,
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
    expect(calculateCampaignYearForCompletedTick(1946, tick, content)).toBe(expectedYear);
  });

  test("never decreases an already advanced valid year", () => {
    const content = loadContentBundle();
    expect(calculateCampaignYearForCompletedTick(1948, 0, content)).toBe(1948);
  });

  test("validates campaign state against the current era without mutation", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-foundation" });
    const before = structuredClone(state.campaign);

    expect(validateCampaignState(state.campaign, content)).toEqual([]);
    expect(state.campaign).toEqual(before);
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

    const issues = validateCampaignState(invalid, content);
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

    expect(validateCampaignState(reordered, content)).toEqual([]);
    expect(
      validateCampaignState({ ...reordered, eraId: "wrong-era" } as never, content),
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
