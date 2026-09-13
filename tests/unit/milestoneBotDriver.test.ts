import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createReplayCommandDriver } from "../../src/devtools/milestoneBot/replayCommandDriver.ts";
import { createTemplateExecutor } from "../../src/devtools/milestoneBot/templateExecutor.ts";
import {
  calculatePostDecisionAdvanceTicks,
  runMilestoneBot,
} from "../../src/devtools/milestoneBot/milestoneBotRunner.ts";

describe("milestone bot replay driver", () => {
  test("does not add an automatic wait after an explicit advance decision", () => {
    expect(
      calculatePostDecisionAdvanceTicks({
        decisionKind: "advance",
        decisionIntervalTicks: 10,
        remainingRunTicks: 36_700,
        remainingBenchmarkTicks: 1_190,
      }),
    ).toBe(0);
    expect(
      calculatePostDecisionAdvanceTicks({
        decisionKind: "start-benchmark",
        decisionIntervalTicks: 10,
        remainingRunTicks: 36_700,
        remainingBenchmarkTicks: 1_200,
      }),
    ).toBe(10);
  });

  test("executes the starter template through public commands", () => {
    const content = loadContentBundle();
    const driver = createReplayCommandDriver({ content, seed: "task-15-driver" });
    driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
    const executor = createTemplateExecutor({ content, driver });

    const result = executor.applyTemplate("starter-serial");
    const state = driver.getDetachedState();

    expect(result.addedModuleIds).toHaveLength(5);
    expect(result.addedRouteIds).toHaveLength(7);
    expect(state.facility.designDraft).toBeNull();
    expect(Object.keys(state.facility.modules)).toHaveLength(5);
    expect(Object.keys(state.facility.routes)).toHaveLength(7);
    expect(executor.getModuleMapping()).toMatchObject({
      power: "module-instance-00000001",
      logic: "module-instance-00000002",
      control: "module-instance-00000003",
      memory: "module-instance-00000004",
      input: "module-instance-00000005",
    });

    const artifact = driver.finishReplay();
    expect(artifact.log.entries.length).toBeGreaterThan(0);
    expect(driver.getJournal()).toHaveLength(artifact.log.entries.length);
  });

  test("runs a bounded development session through Replay", () => {
    const content = loadContentBundle();
    const result = runMilestoneBot({
      content,
      seed: "task-15-bounded",
      configuration: {
        decisionIntervalTicks: 10,
        replayCheckpointIntervalTicks: 600,
        hardLockWindowTicks: 600,
        blockingBottleneckWindowTicks: 100,
        maximumRunTicks: 200,
      },
    });
    expect(result.report.finalTick).toBeLessThanOrEqual(200);
    expect(result.report.replayVerification).toBe("matched");
    expect(result.report.status).not.toBe("policy-error");
    expect(result.report.milestones).toHaveLength(14);
    expect(
      result.report.milestones.find((milestone) => milestone.id === "first-layout-applied"),
    ).toMatchObject({ status: "observed", occurrence: { kind: "exact", tick: 0 } });
    expect(
      result.report.milestones.find((milestone) => milestone.id === "first-task-accepted"),
    ).toMatchObject({ status: "observed", occurrence: { kind: "exact", tick: 10 } });
    expect(Object.isFrozen(result.report)).toBe(true);
  });

  test("rejects authoritative state injection at the public runner boundary", () => {
    const content = loadContentBundle();
    const injected = structuredClone(
      createInitialGameState({ content, seed: "injected-state-seed" }),
    );
    injected.campaign.currentYear = 1948;
    injected.economy.cashUsd = 999_999;

    expect(() =>
      runMilestoneBot({
        content,
        seed: "declared-run-seed",
        initialState: injected,
        configuration: {
          decisionIntervalTicks: 10,
          replayCheckpointIntervalTicks: 600,
          hardLockWindowTicks: 600,
          blockingBottleneckWindowTicks: 100,
          maximumRunTicks: 20,
        },
      } as never),
    ).toThrow(TypeError);
  });

  test("keeps the aggressive policy valid across a same-tick overclock observation", () => {
    const content = loadContentBundle();
    const result = runMilestoneBot({
      content,
      seed: "task-15-strategy-comparison-v1",
      policyId: "aggressive-boost",
      configuration: {
        decisionIntervalTicks: 10,
        replayCheckpointIntervalTicks: 600,
        hardLockWindowTicks: 600,
        blockingBottleneckWindowTicks: 100,
        maximumRunTicks: 40,
      },
    });

    expect(result.report.status).toBe("time-limit");
    expect(
      result.report.milestones.find((entry) => entry.id === "first-overclock-applied"),
    ).toMatchObject({ status: "observed", occurrence: { kind: "exact", tick: 20 } });
    expect(result.report.replayVerification).toBe("matched");
  });

  test("completes the canonical first task inside its target interval", () => {
    const content = loadContentBundle();
    expect(content.tasks["task-ballistic-table-verification"]?.phases[1]?.operations).toBe(100_000);

    const result = runMilestoneBot({
      content,
      seed: "task-15-strategy-comparison-v1",
      configuration: {
        decisionIntervalTicks: 10,
        replayCheckpointIntervalTicks: 600,
        hardLockWindowTicks: 600,
        blockingBottleneckWindowTicks: 100,
        maximumRunTicks: 1_800,
      },
    });
    const completion = result.report.milestones.find(
      (milestone) => milestone.id === "first-task-completed",
    );

    expect(result.report.completedTaskIds).toContain("task-ballistic-table-verification");
    expect(completion).toMatchObject({
      status: "observed",
      occurrence: { kind: "observed-between", afterTick: 1_780, atOrBeforeTick: 1_790 },
      classification: "on-target",
    });
    expect(result.report.replayVerification).toBe("matched");
  }, 30_000);

  test("observes the starter capacity bottleneck before applying its upgrade", () => {
    const content = loadContentBundle();
    const result = runMilestoneBot({
      content,
      seed: "task-15-strategy-comparison-v1",
      configuration: {
        decisionIntervalTicks: 10,
        replayCheckpointIntervalTicks: 600,
        hardLockWindowTicks: 600,
        blockingBottleneckWindowTicks: 100,
        maximumRunTicks: 3_600,
      },
    });
    const blocker = result.report.milestones.find(
      (milestone) => milestone.id === "first-blocking-bottleneck",
    );

    expect(blocker).toMatchObject({
      status: "observed",
      classification: "on-target",
    });
    expect(result.report.blockers[0]).toMatchObject({
      durationTicks: 100,
      taskInstanceId: "task-instance-00000002",
    });
    expect(result.report.replayVerification).toBe("matched");
  }, 60_000);
});
