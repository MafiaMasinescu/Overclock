import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { CommandHandlerRejection } from "../../src/sim/commands/commandHandlers.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { microdollarsToUsd } from "../../src/sim/economy/money.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createAppI18n } from "../../src/localization/i18n.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import { createResearchCommandHandlers } from "../../src/sim/research/researchCommands.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { BenchmarkResult, GameState } from "../../src/sim/core/types.ts";

const content = loadContentBundle();
const FIRST_NODE_ID = "research-stable-power-distribution";
const SECOND_NODE_ID = "research-vacuum-tube-reliability";
const FINAL_NODE_ID = "research-transistor-theory";

function commandId(sequence: number): string {
  return `70000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function startCommand(
  sequence: number,
  nodeId = FIRST_NODE_ID,
  reservedComputeShare = 0.1,
): Extract<SimCommand, { kind: "START_RESEARCH" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "START_RESEARCH",
    nodeId,
    reservedComputeShare,
  };
}

function cancelCommand(
  sequence: number,
  nodeId = FIRST_NODE_ID,
): Extract<SimCommand, { kind: "CANCEL_RESEARCH" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "CANCEL_RESEARCH",
    nodeId,
  };
}

function baseState(): GameState {
  const state = createInitialGameState({ content, seed: "research-command-tests" });
  state.research.researchData = 100;
  state.economy.cashUsd = 32_000;
  state.economy.lastTickExpenseUsd = 7.5;
  return state;
}

function availableState(nodeId = FIRST_NODE_ID): GameState {
  const state = baseState();
  state.research.statuses[nodeId] = "available";
  return state;
}

function stateWithPrerequisites(nodeId: string): GameState {
  const state = availableState(nodeId);
  const node = content.research[nodeId];
  if (node === undefined) throw new Error(`Missing Research fixture ${nodeId}.`);
  for (const prerequisite of node.prerequisites) {
    state.research.statuses[prerequisite] = "completed";
  }
  return state;
}

function activeState(nodeId = FIRST_NODE_ID, reservedComputeShare = 0.1): GameState {
  const state = baseState();
  state.research.statuses[nodeId] = "active";
  state.research.active = {
    nodeId,
    startedAtTick: state.tick,
    completedOperations: 17,
    reservedComputeShare,
  };
  return state;
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected one command result.");
  return result;
}

function expectRejected(result: ReturnType<typeof process>, code: string, reason?: string): void {
  expect(result).toMatchObject({ accepted: false, code });
  if (reason !== undefined) {
    expect(result).toMatchObject({ parameters: { reason } });
  }
}

function directStart(
  state: GameState,
  command: Extract<SimCommand, { kind: "START_RESEARCH" }>,
): undefined | CommandHandlerRejection {
  const handler = createResearchCommandHandlers(content).START_RESEARCH;
  if (handler === undefined) throw new Error("Missing START_RESEARCH handler.");
  const result = handler({ state, rng: createSeededRngFromState(state.rngState) }, command);
  if (result === undefined) return undefined;
  return result;
}

function validBenchmarkRun(runId: string, benchmarkId: string, passed = true): BenchmarkResult {
  return {
    runId,
    benchmarkId,
    passed,
    startedAtTick: 0,
    durationTicks: 10,
    averageUsefulComputeFlops: 100,
    peakUsefulComputeFlops: 100,
    peakPowerWatts: 10,
    averagePowerWatts: 10,
    maxTemperatureC: 30,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    overclockSummary: {},
  };
}

describe("Research command handlers", () => {
  test("starts an available node with exact accounting and no hardware requirement", () => {
    const state = availableState();
    state.economy.lastTickExpenseUsd = 4.25;
    const beforeRng = state.rngState;
    const beforeTick = state.tick;
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });
    const beforeCompute = core.getStateForSave().facility.compute;

    expect(process(core, startCommand(1))).toEqual({
      commandId: commandId(1),
      accepted: true,
      appliedAtTick: 0,
    });

    const after = core.getStateForSave();
    expect(after.research.statuses[FIRST_NODE_ID]).toBe("active");
    expect(after.research.active).toEqual({
      nodeId: FIRST_NODE_ID,
      startedAtTick: beforeTick,
      completedOperations: 0,
      reservedComputeShare: 0.1,
    });
    expect(Object.is(after.research.active?.completedOperations, 0)).toBe(true);
    expect(after.economy).toMatchObject({
      cashUsd: 31_100,
      totalExpenseUsd: 900,
      lastTickExpenseUsd: 4.25,
    });
    expect(after.research.researchData).toBe(88);
    expect(after.tick).toBe(beforeTick);
    expect(after.rngState).toBe(beforeRng);
    expect(after.facility.compute).toEqual(beforeCompute);
  });

  test("restarts a cancelled node after rechecking requirements and repayment", () => {
    const state = availableState();
    state.research.statuses[FIRST_NODE_ID] = "cancelled";
    state.research.researchData = 20;
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expect(process(core, startCommand(2))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().economy).toMatchObject({ cashUsd: 31_100, totalExpenseUsd: 900 });
    expect(core.getStateForSave().research.researchData).toBe(8);
  });

  test.each([
    ["unknown node", "missing-research", "unknown-node"],
    ["locked node", SECOND_NODE_ID, "locked"],
    ["completed node", FIRST_NODE_ID, "completed"],
  ])("rejects a %s with a stable reason", (_label, nodeId, status) => {
    const state = availableState();
    if (status === "completed" || status === "locked") {
      state.research.statuses[FIRST_NODE_ID] = status;
    }
    const before = structuredClone(state);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expectRejected(process(core, startCommand(3, nodeId)), "RESEARCH_NOT_AVAILABLE", status);
    expect(core.getStateForSave()).toEqual(before);
  });

  test("rejects every start while any Research is active before checking the target", () => {
    const state = activeState();
    const before = structuredClone(state);
    const result = directStart(state, startCommand(4, "unknown-node", Number.NaN));
    expect(result).toEqual({
      code: "RESEARCH_ALREADY_ACTIVE",
      messageKey: "errors.research-already-active",
    });
    expect(state).toEqual(before);
  });

  test("rejects a structurally valid target when it is otherwise not startable", () => {
    const state = availableState(FIRST_NODE_ID);
    Reflect.deleteProperty(state.research.statuses, SECOND_NODE_ID);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expectRejected(
      process(core, startCommand(5, SECOND_NODE_ID)),
      "RESEARCH_NOT_AVAILABLE",
      "status",
    );
  });

  test("rejects missing prerequisites, evidence, and benchmark requirements in order", () => {
    const prerequisiteState = availableState(SECOND_NODE_ID);
    const prerequisiteCore = new SimCore({
      initialState: prerequisiteState,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expectRejected(
      process(prerequisiteCore, startCommand(6, SECOND_NODE_ID, 0.12)),
      "RESEARCH_NOT_AVAILABLE",
      "prerequisite",
    );

    const evidenceState = stateWithPrerequisites(SECOND_NODE_ID);
    const evidenceCore = new SimCore({
      initialState: evidenceState,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expectRejected(
      process(evidenceCore, startCommand(7, SECOND_NODE_ID, 0.12)),
      "RESEARCH_NOT_AVAILABLE",
      "evidence-tag",
    );

    const benchmarkState = stateWithPrerequisites(FINAL_NODE_ID);
    const benchmarkCore = new SimCore({
      initialState: benchmarkState,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expectRejected(
      process(benchmarkCore, startCommand(8, FINAL_NODE_ID, 0.2)),
      "RESEARCH_NOT_AVAILABLE",
      "evidence-tag",
    );
    benchmarkState.research.evidenceTags = ["evidence-semiconductor-effect"];
    const benchmarkCoreAfterEvidence = new SimCore({
      initialState: benchmarkState,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expectRejected(
      process(benchmarkCoreAfterEvidence, startCommand(9, FINAL_NODE_ID, 0.2)),
      "RESEARCH_NOT_AVAILABLE",
      "benchmark",
    );
  });

  test.each([
    ["missing mapping", undefined, []],
    ["missing history", "run-missing", []],
    [
      "failed run",
      "run-failed",
      [validBenchmarkRun("run-failed", "benchmark-peak-throughput", false)],
    ],
    [
      "duplicate history",
      "run-duplicate",
      [
        validBenchmarkRun("run-duplicate", "benchmark-peak-throughput"),
        validBenchmarkRun("run-duplicate", "benchmark-peak-throughput"),
      ],
    ],
    [
      "wrong benchmark run",
      "run-wrong",
      [validBenchmarkRun("run-wrong", "benchmark-sustained-stability")],
    ],
  ])("rejects a %s benchmark mapping", (_label, runId, history) => {
    const state = stateWithPrerequisites(FINAL_NODE_ID);
    state.research.evidenceTags = ["evidence-semiconductor-effect"];
    if (runId !== undefined) {
      state.benchmarks.bestRunByBenchmark["benchmark-peak-throughput"] = runId;
    }
    state.benchmarks.history = history;
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expectRejected(
      process(core, startCommand(10, FINAL_NODE_ID, 0.2)),
      "RESEARCH_NOT_AVAILABLE",
      "benchmark",
    );
  });

  test("accepts a fully satisfied benchmark mapping only when every required run is exact and passed", () => {
    const state = stateWithPrerequisites(FINAL_NODE_ID);
    state.research.evidenceTags = ["evidence-semiconductor-effect"];
    state.benchmarks.bestRunByBenchmark = {
      "benchmark-peak-throughput": "run-peak",
      "benchmark-sustained-stability": "run-sustained",
    };
    state.benchmarks.history = [
      validBenchmarkRun("run-peak", "benchmark-peak-throughput"),
      validBenchmarkRun("run-sustained", "benchmark-sustained-stability"),
    ];
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expect(process(core, startCommand(11, FINAL_NODE_ID, 0.2))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().research.active?.nodeId).toBe(FINAL_NODE_ID);
  });

  test.each([
    ["below minimum", 0.099999, "compute-share"],
    ["negative zero", -0, "compute-share"],
    ["zero", 0, "compute-share"],
    ["above one", 1.000001, "compute-share"],
    ["NaN", Number.NaN, "compute-share"],
    ["Infinity", Number.POSITIVE_INFINITY, "compute-share"],
  ])("rejects %s reservation share", (_label, share, reason) => {
    const state = availableState();
    const before = structuredClone(state);
    const result = directStart(state, startCommand(12, FIRST_NODE_ID, share));
    expect(result).toEqual({
      code: "RESEARCH_NOT_AVAILABLE",
      messageKey: "errors.research-not-available",
      parameters: { reason },
    });
    expect(state).toEqual(before);
  });

  test("accepts the exact minimum share and a full reservation", () => {
    const minimumCore = new SimCore({
      initialState: availableState(),
      commandHandlers: createResearchCommandHandlers(content),
    });
    expect(process(minimumCore, startCommand(13, FIRST_NODE_ID, 0.1))).toMatchObject({
      accepted: true,
    });

    const fullCore = new SimCore({
      initialState: availableState(),
      commandHandlers: createResearchCommandHandlers(content),
    });
    expect(process(fullCore, startCommand(14, FIRST_NODE_ID, 1))).toMatchObject({ accepted: true });
    expect(fullCore.getStateForSave().research.active?.reservedComputeShare).toBe(1);
  });

  test("rejects insufficient cash at one microdollar beyond credit and accepts the exact boundary", () => {
    const exactState = availableState();
    exactState.economy.cashUsd = 0;
    exactState.economy.creditLimitUsd = 900;
    const exactCore = new SimCore({
      initialState: exactState,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expect(process(exactCore, startCommand(15))).toMatchObject({ accepted: true });
    expect(exactCore.getStateForSave().economy.cashUsd).toBe(-900);

    const beyondState = availableState();
    beyondState.economy.cashUsd = 0;
    beyondState.economy.creditLimitUsd = 899.999999;
    const before = structuredClone(beyondState);
    const beyondCore = new SimCore({
      initialState: beyondState,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expectRejected(process(beyondCore, startCommand(16)), "INSUFFICIENT_CASH");
    expect(beyondCore.getStateForSave()).toEqual(before);
  });

  test("rejects insufficient Research Data after cash/share checks", () => {
    const state = availableState();
    state.research.researchData = 11.999999;
    const before = structuredClone(state);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expectRejected(process(core, startCommand(17)), "INSUFFICIENT_RESEARCH_DATA");
    expect(core.getStateForSave()).toEqual(before);
  });

  test("rejects insufficient cash before insufficient Research Data when both are missing", () => {
    const state = availableState();
    state.economy.cashUsd = 0;
    state.economy.creditLimitUsd = 0;
    state.research.researchData = 0;
    const before = structuredClone(state);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expectRejected(process(core, startCommand(117)), "INSUFFICIENT_CASH");
    expect(core.getStateForSave()).toEqual(before);
  });

  test("turns cash arithmetic overflow into INVALID_SYSTEM atomically", () => {
    const state = availableState();
    state.economy.totalExpenseUsd = microdollarsToUsd(Number.MAX_SAFE_INTEGER - 100_000_000);
    const before = structuredClone(state);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expectRejected(process(core, startCommand(18)), "INVALID_SYSTEM");
    expect(core.getStateForSave()).toEqual(before);
  });

  test("treats corrupted Research Data as a fatal invariant without mutating state", () => {
    const state = availableState();
    state.research.researchData = Number.NaN;
    const before = structuredClone(state);
    const handler = createResearchCommandHandlers(content).START_RESEARCH;
    if (handler === undefined) throw new Error("Missing START_RESEARCH handler.");

    expect(() =>
      handler({ state, rng: createSeededRngFromState(state.rngState) }, startCommand(19)),
    ).toThrow(/research\.researchData/);
    expect(state).toEqual(before);
  });

  test("preserves command-only tick, RNG, per-tick expense, and Compute until the next real tick", () => {
    const state = availableState();
    state.facility.power = {
      layoutRevision: 0,
      totalRequestedPowerWatts: 0,
      totalDeliveredPowerWatts: 0,
      headroomWatts: 0,
      energyCostUsdThisTick: 0,
      byModule: {},
      byRoute: {},
    };
    state.facility.overclock = { layoutRevision: 0, thermalRevision: 0, byModule: {} };
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
      tickSystems: createComputeTickSystems(content),
    });

    core.step();
    const beforeCommand = core.getStateForSave();
    expect(beforeCommand.facility.compute.research).toBeNull();
    expect(process(core, startCommand(20))).toMatchObject({ accepted: true });
    const afterCommand = core.getStateForSave();
    expect(afterCommand.tick).toBe(beforeCommand.tick);
    expect(afterCommand.rngState).toBe(beforeCommand.rngState);
    expect(afterCommand.economy.lastTickExpenseUsd).toBe(beforeCommand.economy.lastTickExpenseUsd);
    expect(afterCommand.facility.compute).toEqual(beforeCommand.facility.compute);

    core.step();
    expect(core.getStateForSave().facility.compute.research).toEqual({
      nodeId: FIRST_NODE_ID,
      reservedComputeShare: 0.1,
      facilityAvailableComputeFlops: 0,
      deliveredUsefulComputeFlops: 0,
    });
  });

  test("cancels matching active Research with no refund and discards progress only", () => {
    const state = activeState();
    state.economy.lastTickExpenseUsd = 3.5;
    const before = structuredClone(state);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });

    expect(process(core, cancelCommand(21))).toMatchObject({ accepted: true });
    const after = core.getStateForSave();
    expect(after.research.statuses[FIRST_NODE_ID]).toBe("cancelled");
    expect(after.research.active).toBeNull();
    expect(after.research.evidenceTags).toEqual(before.research.evidenceTags);
    expect(after.research.researchData).toBe(before.research.researchData);
    expect(after.economy).toEqual(before.economy);
    expect(after.campaign).toEqual(before.campaign);
    expect(after.benchmarks).toEqual(before.benchmarks);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.facility).toEqual(before.facility);
    expect(after.museum).toEqual(before.museum);
    expect(after.tick).toBe(before.tick);
    expect(after.rngState).toBe(before.rngState);
  });

  test("rejects cancel for an inactive or wrong node without mutation", () => {
    const inactive = new SimCore({
      initialState: availableState(),
      commandHandlers: createResearchCommandHandlers(content),
    });
    const inactiveBefore = inactive.getStateForSave();
    expectRejected(process(inactive, cancelCommand(22)), "RESEARCH_NOT_AVAILABLE");
    expect(inactive.getStateForSave()).toEqual(inactiveBefore);

    const active = new SimCore({
      initialState: activeState(),
      commandHandlers: createResearchCommandHandlers(content),
    });
    const activeBefore = active.getStateForSave();
    expectRejected(process(active, cancelCommand(23, SECOND_NODE_ID)), "RESEARCH_NOT_AVAILABLE");
    expect(active.getStateForSave()).toEqual(activeBefore);
  });

  test("processes START_RESEARCH and CANCEL_RESEARCH FIFO and charges only the start", () => {
    const core = new SimCore({
      initialState: availableState(),
      commandHandlers: createResearchCommandHandlers(content),
    });
    core.enqueue(startCommand(24));
    core.enqueue(cancelCommand(25));

    expect(core.processPendingCommands()).toEqual([
      { commandId: commandId(24), accepted: true, appliedAtTick: 0 },
      { commandId: commandId(25), accepted: true, appliedAtTick: 0 },
    ]);
    expect(core.getStateForSave().research.active).toBeNull();
    expect(core.getStateForSave().research.statuses[FIRST_NODE_ID]).toBe("cancelled");
    expect(core.getStateForSave().economy).toMatchObject({ cashUsd: 31_100, totalExpenseUsd: 900 });
  });

  test("preserves state and RNG on rejected commands and on transaction failure", () => {
    const state = availableState();
    const before = structuredClone(state);
    const core = new SimCore({
      initialState: state,
      commandHandlers: createResearchCommandHandlers(content),
    });
    expectRejected(process(core, startCommand(26, FIRST_NODE_ID, 0.05)), "RESEARCH_NOT_AVAILABLE");
    expect(core.getStateForSave()).toEqual(before);

    const corrupted = availableState();
    corrupted.economy.totalExpenseUsd = Number.NaN;
    const corruptedBefore = structuredClone(corrupted);
    const handler = createResearchCommandHandlers(content).START_RESEARCH;
    if (handler === undefined) throw new Error("Missing START_RESEARCH handler.");
    expect(() =>
      handler(
        { state: corrupted, rng: createSeededRngFromState(corrupted.rngState) },
        startCommand(27),
      ),
    ).toThrow(/Total expense/);
    expect(corrupted).toEqual(corruptedBefore);
  });

  test("localizes the Research command rejection keys in English and Romanian", async () => {
    const ro = await createAppI18n("ro");
    expect(ro.t("errors.research-already-active")).toBe("Cercetarea este deja activă.");
    expect(ro.t("errors.research-not-available")).toBe("Cercetarea nu este disponibilă.");
    expect(ro.t("errors.insufficient-research-data")).toBe("Date de cercetare insuficiente.");
    await ro.changeLanguage("en");
    expect(ro.t("errors.research-already-active")).toBe("Research is already active.");
    expect(ro.t("errors.research-not-available")).toBe("Research is not available.");
    expect(ro.t("errors.insufficient-research-data")).toBe("Insufficient research data.");
  });
});
