import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { assertCanonicalSerializable } from "../replay/canonicalState.ts";
import type { CampaignState, GameState } from "../core/types.ts";

export interface CampaignStateIssue {
  readonly path: string;
  readonly message: string;
}

type CampaignInput = Readonly<CampaignState> | Pick<Readonly<GameState>, "campaign">;

function getCampaignState(input: CampaignInput): Readonly<CampaignState> {
  if ("campaign" in input) return input.campaign;
  return input;
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
  currentYear: number,
  completedTick: number,
  content: ContentBundle,
): number {
  if (!isNonnegativeSafeInteger(completedTick)) {
    throw new RangeError("completedTick must be a nonnegative safe integer.");
  }
  if (
    !Number.isSafeInteger(currentYear) ||
    currentYear < content.era.startYear ||
    currentYear > content.era.endYear ||
    Object.is(currentYear, -0)
  ) {
    throw new RangeError("currentYear must be a valid year in the current era.");
  }

  const elapsedYears = Math.floor(completedTick / calculateCampaignTicksPerYear(content));
  const derivedYear = Math.min(content.era.endYear, content.era.startYear + elapsedYears);
  return Math.max(currentYear, derivedYear);
}

export function validateCampaignState(
  input: CampaignInput,
  content: ContentBundle,
): readonly CampaignStateIssue[] {
  const issues: CampaignStateIssue[] = [];
  let campaign: Readonly<CampaignState>;

  try {
    assertCanonicalSerializable(input);
    campaign = getCampaignState(input);
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

export function assertValidCampaignState(input: CampaignInput, content: ContentBundle): void {
  const issues = validateCampaignState(input, content);
  if (issues.length > 0) {
    throw new Error(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
  }
}
