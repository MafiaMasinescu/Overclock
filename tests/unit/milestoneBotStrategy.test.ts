import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createReplayCommandDriver } from "../../src/devtools/milestoneBot/replayCommandDriver.ts";
import { createTemplateExecutor } from "../../src/devtools/milestoneBot/templateExecutor.ts";
import { BOT_POLICY_PARAMETERS } from "../../src/devtools/milestoneBot/baselinePolicy.ts";
import {
  canEnterBoost,
  canReenterBoost,
  countShutdownTransitions,
  mustExitBoost,
} from "../../src/devtools/milestoneBot/strategyGuards.ts";
import { compareMilestoneBotReports } from "../../src/devtools/milestoneBot/strategyComparison.ts";
import { runMilestoneBot } from "../../src/devtools/milestoneBot/milestoneBotRunner.ts";
import type { MilestoneBotReport } from "../../src/devtools/milestoneBot/botContracts.ts";
import { observeMilestones } from "../../src/devtools/milestoneBot/milestoneObserver.ts";
import { updateHardLockProgressAnchor } from "../../src/devtools/milestoneBot/progressProjection.ts";

describe("milestone bot strategy variants", () => {
  test("starts the hard-lock window after an interval that produced progress", () => {
    const progressed = updateHardLockProgressAnchor(null, {
      beforeTick: 0,
      beforeHash: "before",
      afterTick: 10,
      afterHash: "after",
    });
    expect(progressed).toEqual({ tick: 10, hash: "after" });

    const unchangedAt590 = updateHardLockProgressAnchor(progressed, {
      beforeTick: 590,
      beforeHash: "after",
      afterTick: 600,
      afterHash: "after",
    });
    expect(600 - unchangedAt590.tick).toBe(590);

    const unchangedAt600 = updateHardLockProgressAnchor(unchangedAt590, {
      beforeTick: 600,
      beforeHash: "after",
      afterTick: 610,
      afterHash: "after",
    });
    expect(610 - unchangedAt600.tick).toBe(600);

    expect(
      updateHardLockProgressAnchor(null, {
        beforeTick: 0,
        beforeHash: "same",
        afterTick: 10,
        afterHash: "same",
      }),
    ).toEqual({ tick: 0, hash: "same" });
  });

  test("uses one frozen parameter record with the approved policy differences", () => {
    expect(Object.keys(BOT_POLICY_PARAMETERS)).toEqual([
      "baseline-balanced",
      "conservative-thermal",
      "aggressive-boost",
    ]);
    expect(BOT_POLICY_PARAMETERS["conservative-thermal"]).toMatchObject({
      idleProfile: "eco",
      taskProfile: "balanced",
      sustainedProfile: "balanced",
      peakProfile: "boost",
      boostEntryTemperatureMarginC: 5,
    });
    expect(BOT_POLICY_PARAMETERS["aggressive-boost"]).toMatchObject({
      idleProfile: "balanced",
      taskProfile: "boost",
      sustainedProfile: "balanced",
      peakProfile: "boost",
      boostReentryStabilizationTicks: 100,
    });
    for (const parameters of Object.values(BOT_POLICY_PARAMETERS)) {
      expect(parameters.allowInfiniteService).toBe(false);
      expect(Object.isFrozen(parameters)).toBe(true);
    }
  });

  test("applies boost entry, exit, and stabilization guards through current state", () => {
    const content = loadContentBundle();
    const driver = createReplayCommandDriver({ content, seed: "task-15-guards" });
    driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
    const executor = createTemplateExecutor({ content, driver });
    executor.applyTemplate("starter-serial");
    driver.advanceTicks(100);
    const state = driver.getDetachedState();
    const ids = [
      state.facility.modules["module-instance-00000002"],
      state.facility.modules["module-instance-00000003"],
    ].flatMap((module) => (module === undefined ? [] : [module.id]));
    expect(canEnterBoost({ state, content, moduleIds: ids, stabilityMinimum: 0 })).toBe(true);
    expect(mustExitBoost({ state, content, moduleIds: ids, stabilityMinimum: 0 })).toBe(false);
    expect(canReenterBoost({ state, content, moduleIds: ids, stabilityMinimum: 0 }, 99, 100)).toBe(
      false,
    );
    expect(canReenterBoost({ state, content, moduleIds: ids, stabilityMinimum: 0 }, 100, 100)).toBe(
      true,
    );
  });

  test("deduplicates shutdown transitions between observations", () => {
    const content = loadContentBundle();
    const driver = createReplayCommandDriver({ content, seed: "task-15-shutdowns" });
    driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
    const executor = createTemplateExecutor({ content, driver });
    executor.applyTemplate("starter-serial");
    const first = driver.getDetachedState();
    const shutdown = structuredClone(first);
    const module = shutdown.facility.modules["module-instance-00000002"];
    if (module === undefined) throw new Error("Expected the starter template module to exist.");
    module.operationalState = "shutdown";
    expect(countShutdownTransitions(first, shutdown)).toBe(1);
    expect(countShutdownTransitions(shutdown, shutdown)).toBe(0);
  });

  test("comparison is exact and has no weighted score", () => {
    const content = loadContentBundle();
    const base = runMilestoneBot({
      content,
      seed: "task-15-comparison",
      configuration: {
        decisionIntervalTicks: 10,
        replayCheckpointIntervalTicks: 600,
        hardLockWindowTicks: 600,
        blockingBottleneckWindowTicks: 100,
        maximumRunTicks: 20,
      },
    }).report;
    const better = { ...base, status: "completed", finalTick: 10 } as MilestoneBotReport;
    const comparison = compareMilestoneBotReports(better, base);
    expect(
      comparison.axes.some(
        (axis) => axis.axis === "completion-tick" && axis.better === "unsupported",
      ),
    ).toBe(true);
    expect(
      comparison.axes.some((axis) => axis.axis === "completed" && axis.better === "left"),
    ).toBe(true);
    expect(comparison).not.toHaveProperty("score");
  });

  test("does not classify explainable non-unity compute loss as a blocking bottleneck", () => {
    const content = loadContentBundle();
    const result = runMilestoneBot({
      content,
      seed: "task-15-explainable-loss-is-not-blocking",
      configuration: {
        decisionIntervalTicks: 10,
        replayCheckpointIntervalTicks: 600,
        hardLockWindowTicks: 600,
        blockingBottleneckWindowTicks: 100,
        maximumRunTicks: 200,
      },
    }).report;

    expect(
      result.milestones.find((milestone) => milestone.id === "first-explainable-loss"),
    ).toMatchObject({ status: "observed" });
    expect(result.blockers).toEqual([]);
    expect(
      result.milestones.find((milestone) => milestone.id === "first-blocking-bottleneck"),
    ).toMatchObject({ status: "missing" });
  });

  test("replaces an initial missing milestone with its first observed occurrence", () => {
    const content = loadContentBundle();
    const before = createInitialGameState({ content, seed: "milestone-placeholder" });
    const initial = observeMilestones({
      content,
      state: before,
      previousState: null,
      decisionIntervalTicks: 10,
    });
    const after = structuredClone(before);
    after.facility.liveLayoutRevision += 1;

    const observed = observeMilestones({
      content,
      state: after,
      previousState: before,
      previousRecords: Object.fromEntries(initial.map((record) => [record.id, record])),
      decisionIntervalTicks: 10,
    });

    expect(observed.find((milestone) => milestone.id === "first-layout-applied")).toMatchObject({
      status: "observed",
      occurrence: { kind: "exact", tick: 0 },
    });
  });

  test("does not rebuild an observed cadence milestone during a same-tick command transition", () => {
    const content = loadContentBundle();
    const before = createInitialGameState({ content, seed: "milestone-same-tick" });
    const after = structuredClone(before);
    const observedLoss = observeMilestones({
      content,
      state: before,
      previousState: null,
      decisionIntervalTicks: 10,
    }).map((milestone) =>
      milestone.id === "first-explainable-loss"
        ? {
            ...milestone,
            status: "observed" as const,
            occurrence: { kind: "exact" as const, tick: 0 },
            simulatedSeconds: 0,
            classification: "diagnostic" as const,
          }
        : milestone,
    );
    after.facility.compute.byTask = {
      "task-instance-00000001": {
        taskInstanceId: "task-instance-00000001",
        taskDefinitionId: "task-ballistic-table-verification",
        phaseIndex: 0,
        phaseId: "phase-input-check",
        clusterModuleIds: [],
        requestedShare: 1,
        availableMemoryCapacityBytes: 0,
        availableMemoryBandwidthBytesPerSecond: 0,
        deliveredRouteBandwidthBytesPerSecond: 0,
        extraLatencyMicroseconds: 0,
        retryRate: 0,
        invalidSampleRate: 0,
        meetsStabilityMinimum: true,
        runnable: false,
        blockingReasons: ["no-active-compute"],
        warnings: [],
        breakdown: {
          theoreticalComputeFlops: 0,
          researchFactor: 1,
          powerFactor: 0,
          thermalFactor: 1,
          memoryFactor: 1,
          interconnectFactor: 1,
          suitabilityFactor: 1,
          stabilityFactor: 1,
          usefulComputeFlops: 0,
          bottlenecks: [
            {
              factor: "power",
              factorValue: 0,
              lostComputeFlops: 0,
              explanationKey: "compute.bottlenecks.power",
            },
          ],
        },
      },
    };

    expect(() =>
      observeMilestones({
        content,
        state: after,
        previousState: before,
        previousRecords: Object.fromEntries(observedLoss.map((record) => [record.id, record])),
        decisionIntervalTicks: 10,
      }),
    ).not.toThrow();
  });
});
