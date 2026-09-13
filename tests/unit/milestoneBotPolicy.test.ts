import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { BenchmarkResult } from "../../src/sim/core/types.ts";
import { createReplayCommandDriver } from "../../src/devtools/milestoneBot/replayCommandDriver.ts";
import { createTemplateExecutor } from "../../src/devtools/milestoneBot/templateExecutor.ts";
import {
  BOT_POLICY_PARAMETERS,
  calculateResearchReservedShare,
  compareResearchSelectionTuple,
  compareTaskSelectionTuple,
  isResearchEligibilityReconciliationPending,
  selectBaselineDecision,
  selectNextResearch,
  selectNextTask,
} from "../../src/devtools/milestoneBot/baselinePolicy.ts";
import { createMilestonePolicyResearchGraph } from "../../src/devtools/milestoneBot/policyGraph.ts";
import {
  createProgressProjection,
  hashProgressProjection,
} from "../../src/devtools/milestoneBot/progressProjection.ts";

describe("milestone bot policy foundations", () => {
  const passedBenchmark = (runId: string, benchmarkId: string): BenchmarkResult => ({
    runId,
    benchmarkId,
    clusterModuleIds: ["module-instance-00000001"],
    passed: true,
    startedAtTick: 0,
    durationTicks: 10,
    averageUsefulComputeFlops: 13_000,
    peakUsefulComputeFlops: 13_000,
    peakPowerWatts: 100,
    averagePowerWatts: 100,
    maxTemperatureC: 30,
    minimumPowerHeadroomWatts: 10,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    shutdownObserved: false,
    failureReasons: [],
    overclockSummary: {},
  });

  test("derives critical-path distances and evidence providers from content", () => {
    const content = loadContentBundle();
    const graph = createMilestonePolicyResearchGraph(content);
    expect(graph.finalNodeId).toBe("research-transistor-theory");
    expect(graph.distanceToFinal["research-transistor-theory"]).toBe(0);
    expect(graph.distanceToFinal["research-stable-power-distribution"]).toBe(3);
    expect(graph.firstBlueprintNodeId).toBe("research-blueprint-documentation");
    expect(graph.distanceToFirstBlueprint["research-blueprint-documentation"]).toBe(0);
    expect(graph.distanceToFirstBlueprint["research-modular-wiring"]).toBe(1);
    expect(graph.evidenceTasks["evidence-tube-failure-log"]).toEqual([
      "task-ballistic-table-verification",
    ]);
    expect(graph.evidenceTasks["evidence-layout-study"]).toEqual(["task-wiring-layout-study"]);
  });

  test("prioritizes the first Blueprint path once wiring evidence is available", () => {
    const content = loadContentBundle();
    const graph = createMilestonePolicyResearchGraph(content);
    const state = createInitialGameState({ content, seed: "blueprint-path" });
    state.research.researchData = 100;
    state.economy.cashUsd = 100_000;
    state.research.statuses["research-stable-power-distribution"] = "completed";
    state.research.statuses["research-vacuum-tube-reliability"] = "available";
    state.research.statuses["research-modular-wiring"] = "available";
    state.research.evidenceTags.push("evidence-tube-failure-log", "evidence-layout-study");

    expect(selectNextResearch(state, content, graph)?.node.id).toBe("research-modular-wiring");
  });

  test("does not spend Blueprint-path Research Data before its offered evidence task", () => {
    const content = loadContentBundle();
    const graph = createMilestonePolicyResearchGraph(content);
    const state = createInitialGameState({ content, seed: "blueprint-evidence-priority" });
    state.research.researchData = 100;
    state.economy.cashUsd = 100_000;
    state.research.statuses["research-stable-power-distribution"] = "completed";
    state.research.statuses["research-forced-airflow"] = "available";
    state.research.statuses["research-modular-wiring"] = "locked";
    state.research.evidenceTags.push("evidence-tube-failure-log");
    state.tasks.offers = ["task-wiring-layout-study"];

    expect(selectNextResearch(state, content, graph)).toBeUndefined();
    expect(selectNextTask(state, content, graph, false)?.task.id).toBe("task-wiring-layout-study");
  });

  test("balances the canonical pre-Blueprint Research Data ledger exactly", () => {
    const content = loadContentBundle();
    const initial = createInitialGameState({ content, seed: "blueprint-ledger" });
    const firstTask = content.tasks["task-ballistic-table-verification"];
    const wiringTask = content.tasks["task-wiring-layout-study"];
    const stablePower = content.research["research-stable-power-distribution"];
    const forcedAirflow = content.research["research-forced-airflow"];
    const modularWiring = content.research["research-modular-wiring"];
    const blueprintDocumentation = content.research["research-blueprint-documentation"];
    if (
      firstTask === undefined ||
      wiringTask === undefined ||
      stablePower === undefined ||
      forcedAirflow === undefined ||
      modularWiring === undefined ||
      blueprintDocumentation === undefined
    ) {
      throw new Error("Canonical Blueprint ledger content is incomplete.");
    }

    const availableBeforeBlueprint =
      initial.research.researchData +
      firstTask.researchDataReward -
      stablePower.researchDataCost +
      wiringTask.researchDataReward -
      modularWiring.researchDataCost;

    expect(availableBeforeBlueprint).toBe(102);
    expect(blueprintDocumentation.researchDataCost).toBe(24);
    expect(blueprintDocumentation.requiredOperations).toBe(2_980_000);
    expect(availableBeforeBlueprint - blueprintDocumentation.researchDataCost).toBe(78);
    expect(wiringTask.researchDataReward).toBe(112);
    expect(forcedAirflow.researchDataCost).toBe(18);
    expect(content.research["research-vacuum-tube-reliability"]?.researchDataCost).toBe(24);
    expect(
      availableBeforeBlueprint -
        blueprintDocumentation.researchDataCost -
        forcedAirflow.researchDataCost -
        (content.research["research-vacuum-tube-reliability"]?.researchDataCost ?? 0) -
        (content.research["research-accumulator-design"]?.researchDataCost ?? 0) -
        (content.research["research-buffered-io"]?.researchDataCost ?? 0),
    ).toBe(0);
  });

  test("keeps the reactor study inside the measured canonical throughput envelope", () => {
    const content = loadContentBundle();
    const reactor = content.tasks["task-reactor-diffusion-study"];
    if (reactor === undefined) throw new Error("Missing reactor diffusion Task.");

    expect(reactor.phases.map((phase) => phase.operations)).toEqual([420_000, 1_300_000]);
    expect(reactor.phases.reduce((total, phase) => total + phase.operations, 0)).toBe(1_720_000);
  });

  test("keeps the aerodynamic study inside the measured canonical throughput envelope", () => {
    const content = loadContentBundle();
    const aerodynamic = content.tasks["task-aerodynamic-load-matrix"];
    if (aerodynamic === undefined) throw new Error("Missing aerodynamic load Task.");

    expect(aerodynamic.phases.map((phase) => phase.operations)).toEqual([700_000]);
  });

  test("waits one production interval for newly satisfied Blueprint Research eligibility", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "blueprint-reconciliation" });
    const node = content.research["research-blueprint-documentation"];
    if (node === undefined) throw new Error("Missing Blueprint documentation Research.");
    state.research.statuses["research-modular-wiring"] = "completed";
    state.research.statuses[node.id] = "locked";
    state.research.researchData = node.researchDataCost;
    state.economy.cashUsd = node.cashCostUsd;

    expect(isResearchEligibilityReconciliationPending(node, state)).toBe(true);
  });

  test("uses exact reserved-share rules and stable tuple comparators", () => {
    const content = loadContentBundle();
    const graph = createMilestonePolicyResearchGraph(content);
    const state = createInitialGameState({ content, seed: "policy" });
    const node = content.research["research-stable-power-distribution"];
    if (node === undefined) throw new Error("Missing fixture research node");
    expect(calculateResearchReservedShare(node, state)).toEqual({ share: 1, blocker: null });
    expect(
      compareResearchSelectionTuple(
        { node, reservedComputeShare: 1, tuple: [0, 1, 0, 10, "a"] },
        { node, reservedComputeShare: 1, tuple: [0, 2, 0, 10, "b"] },
      ),
    ).toBeLessThan(0);
    const task = content.tasks["task-ballistic-table-verification"];
    if (task === undefined) throw new Error("Missing fixture task");
    expect(
      compareTaskSelectionTuple(
        { task, tuple: [0, -2, -20, 1, 100, 10, "a"] },
        { task, tuple: [1, -2, -20, 1, 100, 10, "b"] },
      ),
    ).toBeLessThan(0);
    expect(selectNextTask(state, content, graph, false)?.task.id).toBe(
      "task-ballistic-table-verification",
    );
    expect(selectNextResearch(state, content, graph)).toBeUndefined();
  });

  test("baseline starts with the starter template and policy parameters are frozen", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "policy" });
    const graph = createMilestonePolicyResearchGraph(content);
    const decision = selectBaselineDecision({
      state,
      content,
      graph,
      policy: BOT_POLICY_PARAMETERS["baseline-balanced"],
      runtime: {
        appliedTemplateIds: [],
        moduleMapping: {},
        blueprintSelectionModuleIds: [],
        lastAcceptedAction: null,
      },
    });
    expect(decision).toMatchObject({ kind: "apply-template", templateId: "starter-serial" });
    expect(Object.isFrozen(BOT_POLICY_PARAMETERS["baseline-balanced"])).toBe(true);
    const projection = createProgressProjection(state, []);
    expect(hashProgressProjection(projection)).toHaveLength(16);
  });

  test("does not restart a Peak Benchmark that already passed", () => {
    const content = loadContentBundle();
    const initial = createInitialGameState({ content, seed: "peak-complete" });
    initial.economy.cashUsd = 100_000;
    initial.research.statuses["research-stable-power-distribution"] = "completed";
    initial.research.statuses["research-vacuum-tube-reliability"] = "completed";
    initial.research.statuses["research-delay-line-memory"] = "completed";
    const driver = createReplayCommandDriver({
      content,
      seed: "peak-complete",
      initialState: initial,
    });
    const executor = createTemplateExecutor({ content, driver });
    executor.applyTemplate("starter-serial");
    executor.applyTemplate("expanded-balanced");
    executor.applyTemplate("cooled-benchmark");
    const state = structuredClone(driver.getDetachedState());
    const graph = createMilestonePolicyResearchGraph(content);
    state.research.researchData = 100;
    state.economy.cashUsd = 100_000;
    for (const nodeId of Object.keys(state.research.statuses)) {
      state.research.statuses[nodeId] = "completed";
    }
    state.research.statuses["research-transistor-theory"] = "available";
    state.research.evidenceTags.push("evidence-semiconductor-effect");
    state.benchmarks.history = [
      passedBenchmark("benchmark-run-00000001", "benchmark-sustained-stability"),
      passedBenchmark("benchmark-run-00000002", "benchmark-peak-throughput"),
    ];

    const decision = selectBaselineDecision({
      state,
      content,
      graph,
      policy: BOT_POLICY_PARAMETERS["baseline-balanced"],
      runtime: {
        appliedTemplateIds: ["starter-serial", "expanded-balanced", "cooled-benchmark"],
        moduleMapping: executor.getModuleMapping(),
        blueprintSelectionModuleIds: [],
        lastAcceptedAction: null,
      },
    });

    expect(decision).toMatchObject({
      kind: "start-research",
      nodeId: "research-transistor-theory",
    });
  });

  test("boosts only the dedicated fifth arithmetic unit for the power-limited Peak run", () => {
    const content = loadContentBundle();
    const initial = createInitialGameState({ content, seed: "peak-power-budget" });
    initial.economy.cashUsd = 100_000;
    initial.research.statuses["research-stable-power-distribution"] = "completed";
    initial.research.statuses["research-vacuum-tube-reliability"] = "completed";
    initial.research.statuses["research-delay-line-memory"] = "completed";
    initial.research.statuses["research-high-frequency-clock"] = "completed";
    const driver = createReplayCommandDriver({
      content,
      seed: "peak-power-budget",
      initialState: initial,
    });
    const executor = createTemplateExecutor({ content, driver });
    executor.applyTemplate("starter-serial");
    executor.applyTemplate("expanded-balanced");
    executor.applyTemplate("cooled-benchmark");
    const state = structuredClone(driver.getDetachedState());
    state.benchmarks.history = [
      passedBenchmark("benchmark-run-00000001", "benchmark-sustained-stability"),
    ];

    const decision = selectBaselineDecision({
      state,
      content,
      graph: createMilestonePolicyResearchGraph(content),
      policy: BOT_POLICY_PARAMETERS["baseline-balanced"],
      runtime: {
        appliedTemplateIds: ["starter-serial", "expanded-balanced", "cooled-benchmark"],
        moduleMapping: executor.getModuleMapping(),
        blueprintSelectionModuleIds: [],
        lastAcceptedAction: null,
      },
    });

    expect(decision).toMatchObject({
      kind: "start-benchmark",
      benchmarkId: "benchmark-peak-throughput",
      profile: "boost",
      profileModuleSymbolicKeys: ["arithmetic-5"],
    });
  });

  test("accepts the wiring study before upgrading the starter layout", () => {
    const content = loadContentBundle();
    const driver = createReplayCommandDriver({ content, seed: "policy-observed-upgrade" });
    const executor = createTemplateExecutor({ content, driver });
    executor.applyTemplate("starter-serial");
    const state = structuredClone(driver.getDetachedState());
    const graph = createMilestonePolicyResearchGraph(content);
    state.research.statuses["research-stable-power-distribution"] = "completed";
    state.research.evidenceTags.push("evidence-tube-failure-log");
    state.tasks.offers = ["task-wiring-layout-study"];

    const decision = selectBaselineDecision({
      state,
      content,
      graph,
      policy: BOT_POLICY_PARAMETERS["baseline-balanced"],
      runtime: {
        appliedTemplateIds: ["starter-serial"],
        moduleMapping: executor.getModuleMapping(),
        blueprintSelectionModuleIds: [],
        lastAcceptedAction: null,
      },
    });

    expect(decision).toMatchObject({
      kind: "accept-and-allocate-task",
      definitionId: "task-wiring-layout-study",
    });
  });
});
