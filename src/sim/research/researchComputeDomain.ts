import type { ActiveResearchState, ResearchComputeResultState } from "../core/types.ts";

export interface ResearchComputeValidationIssue {
  readonly path: string;
  readonly message: string;
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

function assertFinitePositiveShare(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1 || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite, strictly positive, and at most one.`);
  }
}

function assertResearchFactor(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1 || Object.is(value, -0)) {
    throw new RangeError("researchFactor must be finite and in [0, 1].");
  }
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function pushIf(
  issues: ResearchComputeValidationIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function isFinitePositiveShare(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1 && !Object.is(value, -0);
}

export function calculateResearchFactor(
  activeResearch: Readonly<ActiveResearchState> | null,
): number {
  if (activeResearch === null) return 1;
  assertFinitePositiveShare(activeResearch.reservedComputeShare, "reservedComputeShare");
  return normalizeZero(1 - activeResearch.reservedComputeShare);
}

export function calculateEffectiveTaskShare(
  requestedShare: number,
  researchFactor: number,
): number {
  assertFinitePositiveShare(requestedShare, "requestedShare");
  assertResearchFactor(researchFactor);
  return normalizeZero(requestedShare * researchFactor);
}

export function calculateResearchComputeResult(
  activeResearch: Readonly<ActiveResearchState> | null,
  totalAvailableComputeFlops: number,
): ResearchComputeResultState | null {
  assertFiniteNonnegative(totalAvailableComputeFlops, "totalAvailableComputeFlops");
  if (activeResearch === null) return null;
  assertFinitePositiveShare(activeResearch.reservedComputeShare, "reservedComputeShare");
  if (typeof activeResearch.nodeId !== "string" || activeResearch.nodeId.length === 0) {
    throw new RangeError("nodeId must be nonempty.");
  }
  const deliveredUsefulComputeFlops = normalizeZero(
    totalAvailableComputeFlops * activeResearch.reservedComputeShare,
  );
  const result: ResearchComputeResultState = {
    nodeId: activeResearch.nodeId,
    reservedComputeShare: activeResearch.reservedComputeShare,
    facilityAvailableComputeFlops: normalizeZero(totalAvailableComputeFlops),
    deliveredUsefulComputeFlops,
  };
  const issues = validateResearchComputeResult(result);
  if (issues.length > 0) {
    throw new RangeError(
      `Calculated Research Compute result is invalid:\n${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return result;
}

export function validateResearchComputeResult(
  result: Readonly<ResearchComputeResultState> | null,
): ResearchComputeValidationIssue[] {
  if (result === null) return [];
  const issues: ResearchComputeValidationIssue[] = [];
  pushIf(
    issues,
    typeof result.nodeId !== "string" || result.nodeId.length === 0,
    "nodeId",
    "must be a nonempty string",
  );
  pushIf(
    issues,
    !isFinitePositiveShare(result.reservedComputeShare),
    "reservedComputeShare",
    "must be finite, strictly positive, and at most one",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.facilityAvailableComputeFlops),
    "facilityAvailableComputeFlops",
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.deliveredUsefulComputeFlops),
    "deliveredUsefulComputeFlops",
    "must be finite and nonnegative",
  );
  if (
    isFinitePositiveShare(result.reservedComputeShare) &&
    isFiniteNonnegative(result.facilityAvailableComputeFlops) &&
    isFiniteNonnegative(result.deliveredUsefulComputeFlops)
  ) {
    const expected = normalizeZero(
      result.facilityAvailableComputeFlops * result.reservedComputeShare,
    );
    pushIf(
      issues,
      result.deliveredUsefulComputeFlops !== expected,
      "deliveredUsefulComputeFlops",
      "must equal facilityAvailableComputeFlops multiplied by reservedComputeShare",
    );
  }
  return issues;
}

export function assertValidResearchComputeResult(
  result: Readonly<ResearchComputeResultState> | null,
): void {
  const issues = validateResearchComputeResult(result);
  if (issues.length > 0) {
    throw new Error(
      `Invalid Research Compute result:\n${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
}
