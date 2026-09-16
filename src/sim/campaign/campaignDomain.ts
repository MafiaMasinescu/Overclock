import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { assertCanonicalSerializable } from "../replay/canonicalState.ts";
import type { CampaignState, GameState } from "../core/types.ts";

export interface CampaignStateIssue {
  readonly path: string;
  readonly message: string;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

export function calculateCampaignTicksPerYear(content: ContentBundle): number {
  const secondsPerYear = content.balancing.campaign.secondsPerYear;
  const tickMilliseconds = content.balancing.tickMilliseconds;
  const numerator = secondsPerYear * 1000;
  const ticksPerYear = numerator / tickMilliseconds;

  if (
    !Number.isSafeInteger(secondsPerYear) ||
    secondsPerYear <= 0 ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(ticksPerYear) ||
    ticksPerYear <= 0
  ) {
    throw new Error("Campaign secondsPerYear must produce a positive safe integer ticksPerYear.");
  }

  return ticksPerYear;
}

export function calculateCampaignYearForCompletedTick(
  completedTick: number,
  content: ContentBundle,
): number {
  if (!isNonnegativeSafeInteger(completedTick)) {
    throw new RangeError("completedTick must be a nonnegative safe integer.");
  }
  const { startYear, endYear } = content.era;
  const eraSpan = endYear - startYear;
  if (
    !Number.isSafeInteger(startYear) ||
    !Number.isSafeInteger(endYear) ||
    !Number.isSafeInteger(eraSpan) ||
    eraSpan < 0
  ) {
    throw new RangeError("Campaign era years must define a safe nonnegative span.");
  }
  const elapsedYears = Math.floor(completedTick / calculateCampaignTicksPerYear(content));
  return startYear + Math.min(eraSpan, elapsedYears);
}

export function validateCampaignBranchStructure(
  campaign: Readonly<CampaignState>,
  content: ContentBundle,
): readonly CampaignStateIssue[] {
  const issues: CampaignStateIssue[] = [];

  try {
    assertCanonicalSerializable(campaign);
  } catch {
    return [{ path: "campaign", message: "must be a canonical plain serializable object" }];
  }

  if (campaign.eraId !== content.era.id) {
    issues.push({ path: "campaign.eraId", message: "must match the current content era" });
  }
  if (
    !isNonnegativeSafeInteger(campaign.currentYear) ||
    campaign.currentYear < content.era.startYear ||
    campaign.currentYear > content.era.endYear
  ) {
    issues.push({
      path: "campaign.currentYear",
      message: "must be a nonnegative safe integer within the current era",
    });
  }
  if (typeof campaign.objectiveKey !== "string" || campaign.objectiveKey.length === 0) {
    issues.push({ path: "campaign.objectiveKey", message: "must be a nonempty string" });
  }
  if (typeof campaign.transistorRevealed !== "boolean") {
    issues.push({ path: "campaign.transistorRevealed", message: "must be a boolean" });
  }
  if (typeof campaign.verticalSliceCompleted !== "boolean") {
    issues.push({ path: "campaign.verticalSliceCompleted", message: "must be a boolean" });
  }
  if (!isFiniteNonnegative(campaign.reputation)) {
    issues.push({
      path: "campaign.reputation",
      message: "must be finite, nonnegative, and not negative zero",
    });
  }

  return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}

export function assertValidCampaignBranchStructure(
  campaign: Readonly<CampaignState>,
  content: ContentBundle,
): void {
  const issues = validateCampaignBranchStructure(campaign, content);
  if (issues.length > 0) {
    throw new Error(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
  }
}

export function validateTrustedCampaignTimelineCoherence(
  state: Readonly<GameState>,
  content: ContentBundle,
): readonly CampaignStateIssue[] {
  const issues = [...validateCampaignBranchStructure(state.campaign, content)];
  if (!isNonnegativeSafeInteger(state.tick)) {
    issues.push({ path: "tick", message: "must be a nonnegative safe integer" });
    return Object.freeze(issues.map((issue) => Object.freeze(issue)));
  }
  if (issues.length > 0) {
    return Object.freeze(issues.map((issue) => Object.freeze(issue)));
  }
  const expectedYear = calculateCampaignYearForCompletedTick(state.tick, content);
  if (state.campaign.currentYear !== expectedYear) {
    issues.push({
      path: "campaign.currentYear",
      message: `must equal ${expectedYear} for completed tick ${state.tick}`,
    });
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}

export function validateCampaignTimelineCoherence(
  state: Readonly<GameState>,
  content: ContentBundle,
): readonly CampaignStateIssue[] {
  try {
    assertCanonicalSerializable(state);
  } catch {
    return Object.freeze([
      Object.freeze({
        path: "state",
        message: "must be a canonical plain serializable object",
      }),
    ]);
  }
  return validateTrustedCampaignTimelineCoherence(state, content);
}

export function assertCampaignTimelineCoherent(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  const issues = validateCampaignTimelineCoherence(state, content);
  if (issues.length > 0) {
    throw new Error(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
  }
}

export function assertTrustedCampaignTimelineCoherent(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  const issues = validateTrustedCampaignTimelineCoherence(state, content);
  if (issues.length > 0) {
    throw new Error(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
  }
}
