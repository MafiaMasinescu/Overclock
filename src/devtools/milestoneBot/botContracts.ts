import {
  assertCanonicalSerializable,
  hashCanonicalState,
} from "../../sim/replay/canonicalState.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import type { JsonObject, JsonValue } from "../../sim/core/types.ts";

export type MilestoneBotPolicyId =
  "baseline-balanced" | "conservative-thermal" | "aggressive-boost";

export type MilestoneBotRunStatus =
  | "completed"
  | "hard-lock"
  | "time-limit"
  | "command-rejected"
  | "benchmark-failed"
  | "task-failed"
  | "invariant-fatal"
  | "policy-error";

export type MilestoneId =
  | "first-layout-applied"
  | "first-task-accepted"
  | "first-task-completed"
  | "first-explainable-loss"
  | "first-blocking-bottleneck"
  | "first-overclock-applied"
  | "first-cooling-online"
  | "first-blueprint-saved"
  | "year-1947"
  | "year-1948"
  | "sustained-benchmark-passed"
  | "peak-benchmark-passed"
  | "transistor-revealed"
  | "vertical-slice-completed";

export const MILESTONE_IDS = Object.freeze([
  "first-layout-applied",
  "first-task-accepted",
  "first-task-completed",
  "first-explainable-loss",
  "first-blocking-bottleneck",
  "first-overclock-applied",
  "first-cooling-online",
  "first-blueprint-saved",
  "year-1947",
  "year-1948",
  "sustained-benchmark-passed",
  "peak-benchmark-passed",
  "transistor-revealed",
  "vertical-slice-completed",
] as const satisfies readonly MilestoneId[]);

export type BotBlockerCategory =
  | "cash"
  | "research-data"
  | "year"
  | "evidence"
  | "benchmark"
  | "research-prerequisite"
  | "inventory"
  | "layout"
  | "power"
  | "thermal"
  | "memory"
  | "routing-interconnect"
  | "stability"
  | "task-slot"
  | "configuration-lock"
  | "no-progress"
  | "unknown";

export type MilestoneOccurrence =
  | { readonly kind: "exact"; readonly tick: number }
  | {
      readonly kind: "observed-between";
      readonly afterTick: number;
      readonly atOrBeforeTick: number;
    }
  | { readonly kind: "missing" };

export type MilestoneClassification =
  "early" | "on-target" | "late" | "diagnostic" | "diagnostic-ambiguous" | "missing";

export interface MilestoneRecord {
  readonly id: MilestoneId;
  readonly status: "observed" | "missing";
  readonly occurrence: MilestoneOccurrence;
  readonly simulatedSeconds: number | null;
  readonly targetMinTick: number | null;
  readonly targetMaxTick: number | null;
  readonly classification: MilestoneClassification;
  readonly evidence: JsonObject;
}

export interface BotBlockerEpisode {
  readonly category: BotBlockerCategory;
  readonly reasonCode: string;
  readonly taskInstanceId: string | null;
  readonly startedAtTick: number;
  readonly endedAtTick: number;
  readonly durationTicks: number;
  readonly evidence: JsonObject;
}

export interface BotWaitEpisode {
  readonly kind: "productive" | "forced-deadtime";
  readonly startedAtTick: number;
  readonly endedAtTick: number;
  readonly durationTicks: number;
  readonly evidence: JsonObject;
}

export interface BotWaitSummary {
  readonly totalTicks: number;
  readonly maximumContiguousTicks: number;
  readonly episodeCount: number;
  readonly episodes: readonly BotWaitEpisode[];
}

export interface BotCommandSummary {
  readonly totalCommands: number;
  readonly acceptedCommands: number;
  readonly rejectedCommands: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly rejectionCounts: Readonly<Record<string, number>>;
}

export interface BotRunConfiguration {
  readonly decisionIntervalTicks: number;
  readonly replayCheckpointIntervalTicks: number;
  readonly hardLockWindowTicks: number;
  readonly blockingBottleneckWindowTicks: number;
  readonly maximumRunTicks: number;
}

export const DEFAULT_BOT_RUN_CONFIGURATION: BotRunConfiguration = Object.freeze({
  decisionIntervalTicks: 10,
  replayCheckpointIntervalTicks: 600,
  hardLockWindowTicks: 600,
  blockingBottleneckWindowTicks: 100,
  maximumRunTicks: 45_000,
});

/** Maximum calendar-only wait permitted by the canonical balance gate. */
export const MAXIMUM_FORCED_DEADTIME_TICKS = 3_000;

export interface BotPolicyParameters {
  readonly policyId: MilestoneBotPolicyId;
  readonly allowInfiniteService: boolean;
  readonly idleProfile: "eco" | "balanced";
  readonly taskProfile: "balanced" | "boost";
  readonly sustainedProfile: "eco" | "balanced";
  readonly peakProfile: "boost";
  readonly researchShareWithoutTask: number;
  readonly researchShareWithFiniteTask: number;
  readonly researchShareWithService: number;
  readonly prioritizeTemplateUpgrade: boolean;
  readonly boostEntryTemperatureMarginC: number;
  readonly boostExitTemperatureMarginC: number;
  readonly boostReentryStabilizationTicks: number;
}

export interface BuildTemplateModule {
  readonly key: string;
  readonly definitionId: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly rotation: 0 | 90 | 180 | 270;
}

export interface BuildTemplateRoute {
  readonly key: string;
  readonly kind: "power" | "data";
  readonly from: { readonly moduleKey: string; readonly portId: string };
  readonly to: { readonly moduleKey: string; readonly portId: string };
  readonly path: readonly { readonly x: number; readonly y: number }[];
}

export type BuildTemplateClusterRole =
  | "task-primary"
  | "research-primary"
  | "benchmark-sustained"
  | "benchmark-peak"
  | "blueprint-selection";

export interface BuildTemplate {
  readonly templateVersion: 1;
  readonly id: "starter-serial" | "expanded-balanced" | "cooled-benchmark";
  readonly baseTemplateId: "starter-serial" | "expanded-balanced" | null;
  readonly purpose: string;
  readonly requiredResearchIds: readonly string[];
  readonly modules: readonly BuildTemplateModule[];
  readonly routes: readonly BuildTemplateRoute[];
  readonly clusterRoles: Readonly<Record<BuildTemplateClusterRole, readonly string[]>>;
}

export interface MilestoneBotReport {
  readonly reportVersion: 1;
  readonly policyId: MilestoneBotPolicyId;
  readonly seed: string;
  readonly simulationContentHash: string;
  readonly status: MilestoneBotRunStatus;
  readonly initialRngState: number;
  readonly finalRngState: number;
  readonly finalTick: number;
  readonly finalSimulatedSeconds: number;
  readonly commandSummary: BotCommandSummary;
  readonly replayEntryCount: number;
  readonly replayTickCount: number;
  readonly replayVerification: "matched" | "matched-fatal" | "not-run";
  readonly milestones: readonly MilestoneRecord[];
  readonly blockers: readonly BotBlockerEpisode[];
  readonly productiveWait: BotWaitSummary;
  readonly forcedDeadtime: BotWaitSummary;
  readonly completedTaskIds: readonly string[];
  readonly completedResearchIds: readonly string[];
  readonly passedBenchmarkIds: readonly string[];
  readonly savedBlueprintIds: readonly string[];
  readonly finalCashUsd: number;
  readonly totalIncomeUsd: number;
  readonly totalExpenseUsd: number;
  readonly moduleShutdownTransitionCount: number;
  readonly maximumTemperatureC: number;
  readonly minimumStabilityFactor: number;
  readonly finalStateHash: string;
  readonly replayHash: string;
  readonly reportHash: string;
}

export type ComparisonAxisId =
  | "completed"
  | "completion-tick"
  | "task-failures"
  | "benchmark-failures"
  | "hard-lock"
  | "shutdown-transitions"
  | "maximum-temperature"
  | "final-cash"
  | "total-expense"
  | "maximum-forced-deadtime";

export type ComparisonStatus = "dominant" | "equivalent" | "non-dominated" | "incomparable";

export interface MilestoneBotComparisonReport {
  readonly reportVersion: 1;
  readonly seed: string;
  readonly simulationContentHash: string;
  readonly policyReports: readonly MilestoneBotReport[];
  readonly comparisons: readonly {
    readonly leftPolicyId: MilestoneBotPolicyId;
    readonly rightPolicyId: MilestoneBotPolicyId;
    readonly status: ComparisonStatus;
    readonly axes: readonly {
      readonly axis: ComparisonAxisId;
      readonly supported: boolean;
      readonly left: JsonValue;
      readonly right: JsonValue;
      readonly better: "left" | "right" | "equal" | "unsupported";
    }[];
  }[];
  readonly milestoneTimingMatrix: readonly {
    readonly milestoneId: MilestoneId;
    readonly values: readonly {
      readonly policyId: MilestoneBotPolicyId;
      readonly occurrence: JsonValue;
      readonly classification: MilestoneClassification;
    }[];
  }[];
  readonly blockerMatrix: readonly {
    readonly policyId: MilestoneBotPolicyId;
    readonly firstBlocker: JsonValue;
    readonly maximumForcedDeadtimeTicks: number;
  }[];
  readonly unsupportedMetricIds: readonly ComparisonAxisId[];
  readonly reportHash: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}

function ownKeys(value: object): readonly string[] {
  return Reflect.ownKeys(value).filter((key): key is string => typeof key === "string");
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = [...ownKeys(value)].sort();
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonnegativeSafeInteger(value) && value > 0;
}

export function validateBotRunConfiguration(value: unknown): readonly string[] {
  if (!isPlainRecord(value)) return ["configuration must be a plain object"];
  if (!hasExactKeys(value, Object.keys(DEFAULT_BOT_RUN_CONFIGURATION))) {
    return ["configuration contains unexpected or missing keys"];
  }
  const issues: string[] = [];
  for (const key of Object.keys(DEFAULT_BOT_RUN_CONFIGURATION)) {
    if (!isPositiveSafeInteger(value[key])) issues.push(`${key} must be a positive safe integer`);
  }
  return Object.freeze(issues);
}

export function assertValidBotRunConfiguration(
  value: unknown,
): asserts value is BotRunConfiguration {
  assertCanonicalSerializable(value);
  const issues = validateBotRunConfiguration(value);
  if (issues.length > 0) throw new TypeError(issues.join("; "));
}

export function createDefaultBotRunConfiguration(): BotRunConfiguration {
  return detachAndFreezeReplayData(DEFAULT_BOT_RUN_CONFIGURATION);
}

export function freezeBotPolicyParameters(value: BotPolicyParameters): BotPolicyParameters {
  assertCanonicalSerializable(value);
  return detachAndFreezeReplayData(value);
}

export function hashReportProjection(value: Omit<MilestoneBotReport, "reportHash">): string {
  return hashCanonicalState(value);
}
