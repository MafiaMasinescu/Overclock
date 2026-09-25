import type {
  BenchmarkDefinitionId,
  BenchmarkRunId,
  BlueprintId,
  ModuleInstanceId,
  ResearchNodeId,
  TaskInstanceId,
  TaskStatus,
} from "../core/types.ts";
import type { CommandRejectionCode } from "../commands/contracts.ts";

export type EventSeverity = "info" | "success" | "warning" | "critical";

interface EventBase {
  eventId: string;
  tick: number;
  severity: EventSeverity;
}

export type SimEvent =
  | (EventBase & {
      kind: "COMMAND_REJECTED";
      commandId: string;
      code: CommandRejectionCode;
      messageKey: string;
    })
  | (EventBase & {
      kind: "DESIGN_APPLIED";
      revision: number;
      costUsd: number;
      downtimeTicks: number;
    })
  | (EventBase & {
      kind: "MODULE_PURCHASED";
      definitionId: string;
      quantity: number;
      costUsd: number;
    })
  | (EventBase & {
      kind: "MODULE_SHUTDOWN";
      moduleInstanceId: ModuleInstanceId;
      temperatureC: number;
    })
  | (EventBase & {
      kind: "THERMAL_WARNING_ENTERED" | "THERMAL_WARNING_CLEARED";
      moduleInstanceId: ModuleInstanceId;
      temperatureC: number;
    })
  | (EventBase & {
      kind: "TASK_ACCEPTED" | "TASK_COMPLETED" | "TASK_FAILED";
      taskInstanceId: TaskInstanceId;
    })
  | (EventBase & {
      kind: "TASK_PHASE_COMPLETED";
      taskInstanceId: TaskInstanceId;
      phaseIndex: number;
    })
  | (EventBase & {
      kind: "TASK_DEADLINE_AT_RISK";
      taskInstanceId: TaskInstanceId;
      projectedLateTicks: number;
    })
  | (EventBase & {
      kind: "RESEARCH_STARTED" | "RESEARCH_COMPLETED";
      nodeId: ResearchNodeId;
    })
  | (EventBase & {
      kind: "BLUEPRINT_SAVED" | "BLUEPRINT_INSTANTIATED";
      blueprintId: BlueprintId;
    })
  | (EventBase & {
      kind: "BENCHMARK_STARTED";
      runId: BenchmarkRunId;
      benchmarkId: BenchmarkDefinitionId;
    })
  | (EventBase & {
      kind: "BENCHMARK_COMPLETED" | "BENCHMARK_FAILED";
      runId: BenchmarkRunId;
      benchmarkId: BenchmarkDefinitionId;
      score: number;
    })
  | (EventBase & {
      kind: "TUTORIAL_STEP_COMPLETED";
      stepId: string;
    })
  | (EventBase & {
      kind: "ACHIEVEMENT_UNLOCKED";
      achievementId: string;
    })
  | (EventBase & {
      kind: "MUSEUM_SNAPSHOT_CREATED";
      snapshotId: string;
    })
  | (EventBase & { kind: "TRANSISTOR_REVEALED" })
  | (EventBase & {
      kind: "AUTOSAVE_REQUESTED";
      reason: "interval" | "task" | "research" | "benchmark" | "final";
    });

// Small read-only projection used by the host's post-commit fact observer.
// It contains only lifecycle transitions that have an exact state witness.
export interface CommittedFactProjection {
  readonly tick: number;
  readonly campaignYear: number;
  readonly verticalSliceCompleted: boolean;
  readonly cashUsd: number;
  readonly liveLayoutRevision: number;
  readonly tasks: readonly { readonly taskInstanceId: string; readonly status: TaskStatus }[];
  readonly activeResearchNodeId: string | null;
  readonly completedResearchNodeIds: readonly string[];
  readonly shutdownModules: readonly {
    readonly moduleInstanceId: string;
    readonly temperatureC: number | null;
  }[];
  readonly blueprintIds: readonly string[];
  readonly activeBenchmark: {
    readonly runId: string;
    readonly benchmarkId: string;
  } | null;
  readonly benchmarkHistoryCount: number;
  readonly latestBenchmarkResult: {
    readonly runId: string;
    readonly benchmarkId: string;
    readonly averageUsefulComputeFlops: number;
    readonly passed: boolean;
  } | null;
  readonly museumSnapshotIds: readonly string[];
  readonly transistorRevealed: boolean;
}
