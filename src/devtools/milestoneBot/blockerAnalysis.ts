import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState, TaskComputeResultState } from "../../sim/core/types.ts";
import type { BotBlockerCategory, BotBlockerEpisode, MilestoneOccurrence } from "./botContracts.ts";

export interface BlockingCause {
  readonly category: BotBlockerCategory;
  readonly reasonCode: string;
  readonly taskInstanceId: string;
  readonly evidence: Record<string, string | number | boolean | null>;
}

export interface BlockingTracker {
  readonly cause: BlockingCause | null;
  readonly startedAtTick: number | null;
  readonly lastTick: number;
  readonly qualifyingTicks: number;
  readonly reported: boolean;
}

export interface BlockingTrackerUpdate {
  readonly tracker: BlockingTracker;
  readonly occurrence: MilestoneOccurrence | undefined;
  readonly episode: BotBlockerEpisode | undefined;
}

const INITIAL_TRACKER: BlockingTracker = Object.freeze({
  cause: null,
  startedAtTick: null,
  lastTick: 0,
  qualifyingTicks: 0,
  reported: false,
});

function categoryForReason(reason: string): BotBlockerCategory {
  if (reason.includes("memory")) return "memory";
  if (reason.includes("data")) return "routing-interconnect";
  return "no-progress";
}

function causeForTask(
  state: Readonly<GameState>,
  taskId: string,
  result: TaskComputeResultState,
  content?: ContentBundle,
): BlockingCause | null {
  if (!result.runnable && result.blockingReasons.length > 0) {
    const reasonCode = result.blockingReasons[0] ?? "unknown";
    return {
      category: categoryForReason(reasonCode),
      reasonCode,
      taskInstanceId: taskId,
      evidence: { runnable: false },
    };
  }
  if (
    result.breakdown.usefulComputeFlops === 0 ||
    state.tasks.instances[taskId]?.allocation?.deliveredUsefulComputeFlops === 0
  ) {
    return {
      category: "no-progress",
      reasonCode: "zero-useful-compute",
      taskInstanceId: taskId,
      evidence: { usefulComputeFlops: result.breakdown.usefulComputeFlops },
    };
  }
  const task = state.tasks.instances[taskId];
  if (
    task?.deadlineTick !== null &&
    task?.deadlineTick !== undefined &&
    task.deadlineTick > state.tick
  ) {
    const definition = content?.tasks[task.definitionId];
    const currentPhase = definition?.phases[task.currentPhaseIndex];
    const remaining =
      definition === undefined || currentPhase === undefined
        ? null
        : Math.max(0, currentPhase.operations - task.phaseCompletedOperations) +
          definition.phases
            .slice(task.currentPhaseIndex + 1)
            .reduce((total, phase) => total + phase.operations, 0);
    const estimatedTicks =
      remaining === null || result.breakdown.usefulComputeFlops <= 0
        ? Number.POSITIVE_INFINITY
        : remaining / (result.breakdown.usefulComputeFlops * 0.1);
    if (estimatedTicks > task.deadlineTick - state.tick) {
      return {
        category: "no-progress",
        reasonCode: "deadline-risk",
        taskInstanceId: taskId,
        evidence: { deadlineTick: task.deadlineTick, remainingOperations: remaining },
      };
    }
  }
  // A non-unity Compute factor is explainable loss, not by itself a blocking
  // condition. The blocking milestone is restricted to the explicit progress
  // failures above so a healthy but imperfect machine does not become a false
  // blocker merely because its first breakdown entry persists.
  return null;
}

export function findBlockingCause(
  state: Readonly<GameState>,
  content?: ContentBundle,
): BlockingCause | null {
  const tasks = Object.values(state.tasks.instances)
    .filter(
      (task) => task.status === "active" && task.definitionId !== "task-census-tabulation-service",
    )
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const task of tasks) {
    const result = state.facility.compute.byTask[task.id];
    if (result === undefined) continue;
    const cause = causeForTask(state, task.id, result, content);
    if (cause !== null) return cause;
  }
  return null;
}

export function updateBlockingTracker(
  previous: BlockingTracker = INITIAL_TRACKER,
  state: Readonly<GameState>,
  windowTicks: number,
  content?: ContentBundle,
): BlockingTrackerUpdate {
  const cause = findBlockingCause(state, content);
  const elapsed = Math.max(0, state.tick - previous.lastTick);
  if (cause === null) {
    return {
      tracker: Object.freeze({
        cause: null,
        startedAtTick: null,
        lastTick: state.tick,
        qualifyingTicks: 0,
        reported: false,
      }),
      occurrence: undefined,
      episode: undefined,
    };
  }
  const same =
    previous.cause?.taskInstanceId === cause.taskInstanceId &&
    previous.cause.reasonCode === cause.reasonCode &&
    previous.cause.category === cause.category;
  const startedAtTick =
    same && previous.startedAtTick !== null ? previous.startedAtTick : state.tick;
  const qualifyingTicks = same ? previous.qualifyingTicks + elapsed : 0;
  const reported = same ? previous.reported : false;
  const next = Object.freeze({
    cause,
    startedAtTick,
    lastTick: state.tick,
    qualifyingTicks,
    reported,
  });
  if (!same || reported || qualifyingTicks < windowTicks)
    return { tracker: next, occurrence: undefined, episode: undefined };
  const afterTick = Math.max(startedAtTick, state.tick - Math.max(1, elapsed));
  const occurrence: MilestoneOccurrence = {
    kind: "observed-between",
    afterTick,
    atOrBeforeTick: state.tick,
  };
  const episode: BotBlockerEpisode = {
    category: cause.category,
    reasonCode: cause.reasonCode,
    taskInstanceId: cause.taskInstanceId,
    startedAtTick,
    endedAtTick: state.tick,
    durationTicks: qualifyingTicks,
    evidence: cause.evidence,
  };
  return { tracker: Object.freeze({ ...next, reported: true }), occurrence, episode };
}

export const initialBlockingTracker = INITIAL_TRACKER;
