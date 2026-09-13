import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState, JsonObject } from "../../sim/core/types.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import {
  MILESTONE_IDS,
  type MilestoneClassification,
  type MilestoneId,
  type MilestoneOccurrence,
  type MilestoneRecord,
} from "./botContracts.ts";

interface TargetTicks {
  readonly min: number;
  readonly max: number;
}

const TARGETS: Partial<Record<MilestoneId, TargetTicks>> = {
  "first-task-completed": { min: 1200, max: 1800 },
  "first-blocking-bottleneck": { min: 2400, max: 3600 },
  "first-blueprint-saved": { min: 6000, max: 9000 },
  "vertical-slice-completed": { min: 27000, max: 45000 },
};

function exact(tick: number): MilestoneOccurrence {
  return { kind: "exact", tick };
}

function interval(afterTick: number, atOrBeforeTick: number, cadence: number): MilestoneOccurrence {
  if (afterTick >= atOrBeforeTick || atOrBeforeTick - afterTick > cadence) {
    throw new Error("Milestone observation interval is invalid.");
  }
  return { kind: "observed-between", afterTick, atOrBeforeTick };
}

function transitionOccurrence(
  previousState: Readonly<GameState> | null,
  state: Readonly<GameState>,
  decisionIntervalTicks: number,
): MilestoneOccurrence {
  return previousState === null || previousState.tick === state.tick
    ? exact(state.tick)
    : interval(previousState.tick, state.tick, decisionIntervalTicks);
}

function classify(
  occurrence: MilestoneOccurrence,
  target: TargetTicks | undefined,
): MilestoneClassification {
  if (occurrence.kind === "missing") return "missing";
  if (target === undefined)
    return occurrence.kind === "exact" ? "diagnostic" : "diagnostic-ambiguous";
  if (occurrence.kind === "exact") {
    if (occurrence.tick < target.min) return "early";
    if (occurrence.tick > target.max) return "late";
    return "on-target";
  }
  if (occurrence.afterTick >= target.min && occurrence.atOrBeforeTick <= target.max)
    return "on-target";
  if (occurrence.atOrBeforeTick < target.min) return "early";
  if (occurrence.afterTick > target.max) return "late";
  return "diagnostic-ambiguous";
}

function evidence(values: Record<string, string | number | boolean | null>): JsonObject {
  return values;
}

function record(
  id: MilestoneId,
  occurrence: MilestoneOccurrence,
  evidenceValue: JsonObject = {},
): MilestoneRecord {
  const tick =
    occurrence.kind === "exact"
      ? occurrence.tick
      : occurrence.kind === "observed-between"
        ? occurrence.atOrBeforeTick
        : null;
  return {
    id,
    status: occurrence.kind === "missing" ? "missing" : "observed",
    occurrence,
    simulatedSeconds: tick === null ? null : tick / 10,
    targetMinTick: TARGETS[id]?.min ?? null,
    targetMaxTick: TARGETS[id]?.max ?? null,
    classification: classify(occurrence, TARGETS[id]),
    evidence: evidenceValue,
  };
}

function findNewTask(
  state: Readonly<GameState>,
  previous: Readonly<GameState> | null,
  status: string,
): string | undefined {
  return Object.values(state.tasks.instances).find((task) =>
    status === "accepted"
      ? previous?.tasks.instances[task.id] === undefined && task.acceptedAtTick === state.tick
      : task.status === status && (previous?.tasks.instances[task.id]?.status ?? null) !== status,
  )?.id;
}

function hasNewPassedBenchmark(
  state: Readonly<GameState>,
  previous: Readonly<GameState> | null,
  id: string,
): boolean {
  return state.benchmarks.history.some(
    (run) =>
      run.benchmarkId === id &&
      run.passed &&
      !previous?.benchmarks.history.some((old) => old.runId === run.runId),
  );
}

export interface MilestoneObservationOptions {
  readonly content: ContentBundle;
  readonly state: Readonly<GameState>;
  readonly previousState: Readonly<GameState> | null;
  readonly previousRecords?: Readonly<Partial<Record<MilestoneId, MilestoneRecord>>>;
  readonly decisionIntervalTicks: number;
  readonly blockingOccurrence?: MilestoneOccurrence;
}

export function observeMilestones({
  content,
  state,
  previousState,
  previousRecords = {},
  decisionIntervalTicks,
  blockingOccurrence,
}: MilestoneObservationOptions): readonly MilestoneRecord[] {
  const newlyAccepted = findNewTask(state, previousState, "accepted");
  const newlyCompleted = findNewTask(state, previousState, "completed");
  const layoutChanged =
    state.facility.liveLayoutRevision > (previousState?.facility.liveLayoutRevision ?? 0);
  const explainable = Object.values(state.facility.compute.byTask).find(
    (task) => task.breakdown.bottlenecks.length > 0,
  );
  const firstLoss =
    explainable === undefined
      ? undefined
      : record(
          "first-explainable-loss",
          transitionOccurrence(previousState, state, decisionIntervalTicks),
          evidence({
            ownerKind: "task",
            ownerId: explainable.taskInstanceId,
            factor: explainable.breakdown.bottlenecks[0]?.factor ?? null,
            factorValue: explainable.breakdown.bottlenecks[0]?.factorValue ?? null,
            lostComputeFlops: explainable.breakdown.bottlenecks[0]?.lostComputeFlops ?? null,
            explanationKey: explainable.breakdown.bottlenecks[0]?.explanationKey ?? null,
          }),
        );
  const cooling = Object.values(state.facility.modules).find(
    (module) =>
      content.modules[module.definitionId]?.category === "cooling" &&
      module.operationalState === "online",
  );
  const overclock = Object.values(state.facility.modules).find(
    (module) =>
      module.overclock.profile !== "balanced" &&
      previousState?.facility.modules[module.id]?.overclock.profile === "balanced",
  );
  const records: Partial<Record<MilestoneId, MilestoneRecord>> = { ...previousRecords };
  const assign = (id: MilestoneId, value: MilestoneRecord | undefined): void => {
    if (records[id]?.status !== "observed" && value !== undefined) records[id] = value;
  };
  assign(
    "first-layout-applied",
    layoutChanged
      ? record(
          "first-layout-applied",
          transitionOccurrence(previousState, state, decisionIntervalTicks),
          evidence({ liveLayoutRevision: state.facility.liveLayoutRevision }),
        )
      : undefined,
  );
  assign(
    "first-task-accepted",
    newlyAccepted === undefined
      ? undefined
      : record(
          "first-task-accepted",
          transitionOccurrence(previousState, state, decisionIntervalTicks),
          evidence({ taskInstanceId: newlyAccepted }),
        ),
  );
  assign(
    "first-task-completed",
    newlyCompleted === undefined
      ? undefined
      : record(
          "first-task-completed",
          transitionOccurrence(previousState, state, decisionIntervalTicks),
          evidence({ taskInstanceId: newlyCompleted }),
        ),
  );
  assign("first-explainable-loss", firstLoss);
  assign(
    "first-blocking-bottleneck",
    blockingOccurrence === undefined
      ? undefined
      : record("first-blocking-bottleneck", blockingOccurrence, {}),
  );
  assign(
    "first-overclock-applied",
    overclock === undefined
      ? undefined
      : record(
          "first-overclock-applied",
          transitionOccurrence(previousState, state, decisionIntervalTicks),
          evidence({ moduleInstanceId: overclock.id, profile: overclock.overclock.profile }),
        ),
  );
  assign(
    "first-cooling-online",
    cooling === undefined ||
      previousState?.facility.modules[cooling.id]?.operationalState === "online"
      ? undefined
      : record(
          "first-cooling-online",
          transitionOccurrence(previousState, state, decisionIntervalTicks),
          evidence({ moduleInstanceId: cooling.id }),
        ),
  );
  if (
    Object.keys(state.blueprints.records).length >
    Object.keys(previousState?.blueprints.records ?? {}).length
  )
    assign(
      "first-blueprint-saved",
      record(
        "first-blueprint-saved",
        transitionOccurrence(previousState, state, decisionIntervalTicks),
        evidence({ blueprintCount: Object.keys(state.blueprints.records).length }),
      ),
    );
  if (state.campaign.currentYear >= 1947 && (previousState?.campaign.currentYear ?? 1946) < 1947)
    assign(
      "year-1947",
      record("year-1947", exact(state.tick), evidence({ year: state.campaign.currentYear })),
    );
  if (state.campaign.currentYear >= 1948 && (previousState?.campaign.currentYear ?? 1947) < 1948)
    assign(
      "year-1948",
      record("year-1948", exact(state.tick), evidence({ year: state.campaign.currentYear })),
    );
  if (hasNewPassedBenchmark(state, previousState, "benchmark-sustained-stability"))
    assign(
      "sustained-benchmark-passed",
      record(
        "sustained-benchmark-passed",
        transitionOccurrence(previousState, state, decisionIntervalTicks),
        evidence({ benchmarkId: "benchmark-sustained-stability" }),
      ),
    );
  if (hasNewPassedBenchmark(state, previousState, "benchmark-peak-throughput"))
    assign(
      "peak-benchmark-passed",
      record(
        "peak-benchmark-passed",
        transitionOccurrence(previousState, state, decisionIntervalTicks),
        evidence({ benchmarkId: "benchmark-peak-throughput" }),
      ),
    );
  if (state.campaign.transistorRevealed && !(previousState?.campaign.transistorRevealed ?? false))
    assign(
      "transistor-revealed",
      record(
        "transistor-revealed",
        transitionOccurrence(previousState, state, decisionIntervalTicks),
        {},
      ),
    );
  if (
    state.campaign.verticalSliceCompleted &&
    !(previousState?.campaign.verticalSliceCompleted ?? false)
  )
    assign(
      "vertical-slice-completed",
      record(
        "vertical-slice-completed",
        transitionOccurrence(previousState, state, decisionIntervalTicks),
        {},
      ),
    );
  return detachAndFreezeReplayData(
    MILESTONE_IDS.map((id) => records[id] ?? record(id, { kind: "missing" }, {})),
  );
}
