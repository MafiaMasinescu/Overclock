import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import {
  MILESTONE_IDS,
  type ComparisonAxisId,
  type ComparisonStatus,
  type MilestoneBotComparisonReport,
  type MilestoneBotPolicyId,
  type MilestoneBotReport,
} from "./botContracts.ts";
import type { JsonValue } from "../../sim/core/types.ts";
import { hashCanonicalState } from "../../sim/replay/canonicalState.ts";

const POLICY_ORDER: readonly MilestoneBotPolicyId[] = [
  "baseline-balanced",
  "conservative-thermal",
  "aggressive-boost",
];
const AXES: readonly ComparisonAxisId[] = [
  "completed",
  "completion-tick",
  "task-failures",
  "benchmark-failures",
  "hard-lock",
  "shutdown-transitions",
  "maximum-temperature",
  "final-cash",
  "total-expense",
  "maximum-forced-deadtime",
];

interface AxisResult {
  readonly axis: ComparisonAxisId;
  readonly supported: boolean;
  readonly left: JsonValue;
  readonly right: JsonValue;
  readonly better: "left" | "right" | "equal" | "unsupported";
}

function scalarFor(report: MilestoneBotReport, axis: ComparisonAxisId): JsonValue {
  switch (axis) {
    case "completed":
      return report.status === "completed";
    case "completion-tick":
      return report.status === "completed" ? report.finalTick : null;
    case "task-failures":
      return report.status === "task-failed" ? 1 : 0;
    case "benchmark-failures":
      return report.status === "benchmark-failed" ? 1 : 0;
    case "hard-lock":
      return report.status === "hard-lock";
    case "shutdown-transitions":
      return report.moduleShutdownTransitionCount;
    case "maximum-temperature":
      return report.maximumTemperatureC;
    case "final-cash":
      return report.finalCashUsd;
    case "total-expense":
      return report.totalExpenseUsd;
    case "maximum-forced-deadtime":
      return report.forcedDeadtime.maximumContiguousTicks;
  }
}

function compareAxis(
  axis: ComparisonAxisId,
  left: JsonValue,
  right: JsonValue,
): "left" | "right" | "equal" | "unsupported" {
  if (axis === "completion-tick" && (left === null || right === null)) return "unsupported";
  if (left === right) return "equal";
  if (axis === "completed" || axis === "hard-lock") {
    const leftBetter = axis === "completed" ? left === true : left === false;
    return leftBetter ? "left" : "right";
  }
  if (typeof left !== "number" || typeof right !== "number") return "unsupported";
  const lowerIsBetter =
    axis === "completion-tick" ||
    axis === "task-failures" ||
    axis === "benchmark-failures" ||
    axis === "shutdown-transitions" ||
    axis === "maximum-temperature" ||
    axis === "total-expense" ||
    axis === "maximum-forced-deadtime";
  return lowerIsBetter ? (left < right ? "left" : "right") : left > right ? "left" : "right";
}

export function compareMilestoneBotReports(
  left: MilestoneBotReport,
  right: MilestoneBotReport,
): MilestoneBotComparisonReport["comparisons"][number] {
  const axes: AxisResult[] = AXES.map((axis) => {
    const leftValue = scalarFor(left, axis);
    const rightValue = scalarFor(right, axis);
    const better = compareAxis(axis, leftValue, rightValue);
    return {
      axis,
      supported: better !== "unsupported",
      left: leftValue,
      right: rightValue,
      better,
    };
  });
  const supported = axes.filter((axis) => axis.supported);
  const leftWins = supported.some((axis) => axis.better === "left");
  const rightWins = supported.some((axis) => axis.better === "right");
  const status: ComparisonStatus =
    supported.length === 0
      ? "incomparable"
      : leftWins && rightWins
        ? "non-dominated"
        : leftWins
          ? "dominant"
          : rightWins
            ? "dominant"
            : "equivalent";
  return { leftPolicyId: left.policyId, rightPolicyId: right.policyId, status, axes };
}

export function createMilestoneBotComparisonReport(
  reports: readonly MilestoneBotReport[],
  content: ContentBundle,
  seed: string,
): MilestoneBotComparisonReport {
  const byPolicy = new Map(reports.map((report) => [report.policyId, report]));
  const ordered = POLICY_ORDER.map((id) => byPolicy.get(id)).filter(
    (report): report is MilestoneBotReport => report !== undefined,
  );
  const comparisons: MilestoneBotComparisonReport["comparisons"][number][] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex];
      const right = ordered[rightIndex];
      if (left !== undefined && right !== undefined)
        comparisons.push(compareMilestoneBotReports(left, right));
    }
  }
  const milestoneTimingMatrix = MILESTONE_IDS.map((milestoneId) => ({
    milestoneId,
    values: ordered.map((report) => {
      const milestone = report.milestones.find((candidate) => candidate.id === milestoneId);
      return {
        policyId: report.policyId,
        occurrence: milestone?.occurrence ?? { kind: "missing" },
        classification: milestone?.classification ?? "missing",
      };
    }),
  }));
  const blockerMatrix = ordered.map((report) => ({
    policyId: report.policyId,
    firstBlocker: (report.blockers[0] ?? null) as unknown as JsonValue,
    maximumForcedDeadtimeTicks: report.forcedDeadtime.maximumContiguousTicks,
  }));
  const unsupportedMetricIds = AXES.filter((axis) =>
    comparisons.every(
      (comparison) => comparison.axes.find((entry) => entry.axis === axis)?.supported !== true,
    ),
  );
  const projection = {
    reportVersion: 1 as const,
    seed,
    simulationContentHash: hashSimulationContent(content),
    policyReports: ordered,
    comparisons,
    milestoneTimingMatrix,
    blockerMatrix,
    unsupportedMetricIds,
  };
  return detachAndFreezeReplayData({ ...projection, reportHash: hashCanonicalState(projection) });
}
