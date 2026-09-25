import type { LocalStats } from "../../save/contracts.ts";
import type { CommandResult, SimCommand } from "../../sim/commands/contracts.ts";
import type { CommittedFactProjection } from "../../sim/events/contracts.ts";

export type AutosaveTriggerReason =
  "interval" | "visibility" | "task" | "research" | "benchmark" | "year" | "final";

export interface SaveTransitionSummary {
  readonly reasons: readonly AutosaveTriggerReason[];
  readonly counters: Partial<Record<keyof LocalStats, number>>;
}

export function summarizeSaveTransitions(
  previous: CommittedFactProjection | null,
  next: CommittedFactProjection,
  commandResult?: CommandResult,
  command?: SimCommand,
): SaveTransitionSummary {
  if (previous === null) return { reasons: [], counters: {} };
  const reasons = new Set<AutosaveTriggerReason>();
  const counters: Partial<Record<keyof LocalStats, number>> = {};
  const increment = (field: keyof LocalStats, count = 1): void => {
    counters[field] = (counters[field] ?? 0) + count;
  };

  const previousTasks = new Map(previous.tasks.map((task) => [task.taskInstanceId, task.status]));
  for (const task of next.tasks) {
    if (task.status === "completed" && previousTasks.get(task.taskInstanceId) !== "completed") {
      increment("taskCompletions");
      reasons.add("task");
    }
  }

  const previousCompletedResearch = new Set(previous.completedResearchNodeIds);
  if (next.completedResearchNodeIds.some((nodeId) => !previousCompletedResearch.has(nodeId))) {
    reasons.add("research");
  }

  if (previous.activeBenchmark === null && next.activeBenchmark !== null) {
    increment("benchmarkAttempts");
    reasons.add("benchmark");
  }
  if (
    (previous.activeBenchmark !== null && next.activeBenchmark === null) ||
    next.benchmarkHistoryCount > previous.benchmarkHistoryCount
  ) {
    reasons.add("benchmark");
  }

  const previousShutdowns = new Set(
    previous.shutdownModules.map((module) => module.moduleInstanceId),
  );
  const newShutdowns = next.shutdownModules.filter(
    (module) => !previousShutdowns.has(module.moduleInstanceId),
  );
  if (newShutdowns.length > 0) increment("emergencyShutdowns", newShutdowns.length);

  if (next.campaignYear > previous.campaignYear) reasons.add("year");
  if (!previous.verticalSliceCompleted && next.verticalSliceCompleted) reasons.add("final");

  if (commandResult?.accepted === true && command !== undefined) {
    if (command.kind === "APPLY_DESIGN" && next.liveLayoutRevision > previous.liveLayoutRevision) {
      increment("designApplications");
    } else if (command.kind === "ABANDON_TASK") {
      increment("taskAbandons");
    }
  }

  return { reasons: [...reasons], counters };
}
