import { describe, expect, test } from "vitest";

import { parseSimCommand } from "../../src/sim/commands/commandSchema.ts";
import type { CommittedFactProjection } from "../../src/sim/events/contracts.ts";
import { summarizeSaveTransitions } from "../../src/app/worker/saveTransitions.ts";

const initialFacts: CommittedFactProjection = {
  tick: 10,
  campaignYear: 1,
  verticalSliceCompleted: false,
  cashUsd: 100,
  liveLayoutRevision: 2,
  tasks: [{ taskInstanceId: "task-1", status: "active" }],
  activeResearchNodeId: "research-1",
  completedResearchNodeIds: [],
  shutdownModules: [],
  blueprintIds: [],
  activeBenchmark: null,
  benchmarkHistoryCount: 0,
  latestBenchmarkResult: null,
  museumSnapshotIds: [],
  transistorRevealed: false,
};

describe("Worker save lifecycle transition classification", () => {
  test("coalesces Task, Research, Benchmark, year and final triggers from committed facts", () => {
    const next: CommittedFactProjection = {
      ...initialFacts,
      tick: 11,
      campaignYear: 2,
      verticalSliceCompleted: true,
      tasks: [{ taskInstanceId: "task-1", status: "completed" }],
      activeResearchNodeId: null,
      completedResearchNodeIds: ["research-1"],
      shutdownModules: [{ moduleInstanceId: "module-1", temperatureC: 500 }],
      activeBenchmark: { runId: "run-1", benchmarkId: "benchmark-1" },
    };

    const result = summarizeSaveTransitions(initialFacts, next);

    expect(result.reasons).toEqual(
      expect.arrayContaining(["task", "research", "benchmark", "year", "final"]),
    );
    expect(result.counters).toMatchObject({
      taskCompletions: 1,
      emergencyShutdowns: 1,
      benchmarkAttempts: 1,
    });
  });

  test("counts accepted one-shot outcomes and recognizes a cancelled Benchmark terminal", () => {
    const activeBenchmark: CommittedFactProjection = {
      ...initialFacts,
      activeBenchmark: { runId: "run-1", benchmarkId: "benchmark-1" },
    };
    const endedBenchmark: CommittedFactProjection = {
      ...activeBenchmark,
      activeBenchmark: null,
    };
    const abandon = parseSimCommand({
      commandId: "76000000-0000-4000-8000-000000000301",
      source: "player",
      kind: "ABANDON_TASK",
      taskInstanceId: "task-1",
    });
    const accepted = {
      commandId: abandon.commandId,
      accepted: true as const,
      appliedAtTick: 10,
    };

    expect(summarizeSaveTransitions(activeBenchmark, endedBenchmark).reasons).toContain(
      "benchmark",
    );
    expect(
      summarizeSaveTransitions(initialFacts, initialFacts, accepted, abandon).counters,
    ).toEqual({
      taskAbandons: 1,
    });
    expect(
      summarizeSaveTransitions(
        initialFacts,
        initialFacts,
        {
          commandId: accepted.commandId,
          accepted: false,
          rejectedAtTick: 10,
          code: "COMMAND_NOT_AVAILABLE",
          messageKey: "errors.no",
        },
        abandon,
      ).counters,
    ).toEqual({});
  });
});
