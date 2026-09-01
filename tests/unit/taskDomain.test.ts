import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type {
  GameState,
  TaskComputeResultState,
  TaskInstanceState,
} from "../../src/sim/core/types.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  advanceTaskSystem,
  calculateTaskProgress,
  reconcileTaskOffers,
  validateFreshTaskAdvance,
} from "../../src/sim/tasks/taskDomain.ts";

const content = loadContentBundle();
const PROJECT_ID = "task-ballistic-table-verification";
const SERVICE_ID = "task-census-tabulation-service";
type TaskResultPatch = Omit<Readonly<Partial<TaskComputeResultState>>, "blockingReasons"> & {
  readonly blockingReasons?: readonly TaskComputeResultState["blockingReasons"][number][];
};

function createState(): GameState {
  return createInitialGameState({ content, seed: "task-advance-domain" });
}

function definitionFor(bundle: typeof content, definitionId: string) {
  const definition = bundle.tasks[definitionId];
  if (definition === undefined) throw new Error(`Missing fixture Task definition ${definitionId}.`);
  return definition;
}

function phaseFor(definition: ReturnType<typeof definitionFor>, phaseIndex: number) {
  const phase = definition.phases[phaseIndex];
  if (phase === undefined) throw new Error(`Missing fixture Task phase ${phaseIndex}.`);
  return phase;
}

function activeAllocation() {
  const allocation = activeTask().allocation;
  if (allocation === null) throw new Error("Active fixture must have an allocation.");
  return allocation;
}

function activeTask(overrides: Partial<TaskInstanceState> = {}): TaskInstanceState {
  return {
    id: "task-instance-00000001",
    definitionId: PROJECT_ID,
    status: "active",
    acceptedAtTick: 0,
    deadlineTick: 2_100,
    currentPhaseIndex: 0,
    phaseCompletedOperations: 0,
    totalCompletedOperations: 0,
    allocation: {
      clusterModuleIds: ["module-instance-00000001"],
      requestedShare: 1,
      deliveredUsefulComputeFlops: 100,
    },
    accruedPayoutUsd: 0,
    serviceWindowCompliant: null,
    ...overrides,
  };
}

function taskResult(
  task: TaskInstanceState,
  overrides: TaskResultPatch = {},
): TaskComputeResultState {
  const { blockingReasons, ...remainingOverrides } = overrides;
  return {
    taskInstanceId: task.id,
    taskDefinitionId: task.definitionId,
    phaseIndex: task.currentPhaseIndex,
    phaseId: content.tasks[task.definitionId]?.phases[task.currentPhaseIndex]?.id ?? "phase",
    clusterModuleIds: task.allocation?.clusterModuleIds ?? [],
    requestedShare: task.allocation?.requestedShare ?? 0,
    availableMemoryCapacityBytes: 1_024,
    availableMemoryBandwidthBytesPerSecond: 10_000,
    deliveredRouteBandwidthBytesPerSecond: 10_000,
    extraLatencyMicroseconds: 0,
    retryRate: 0,
    invalidSampleRate: 0,
    meetsStabilityMinimum: true,
    runnable: true,
    blockingReasons: blockingReasons === undefined ? [] : [...blockingReasons],
    warnings: [],
    breakdown: {
      theoreticalComputeFlops: 100,
      usefulComputeFlops: task.allocation?.deliveredUsefulComputeFlops ?? 0,
      powerFactor: 1,
      thermalFactor: 1,
      memoryFactor: 1,
      interconnectFactor: 1,
      suitabilityFactor: 1,
      stabilityFactor: 1,
      bottlenecks: [],
    },
    ...remainingOverrides,
  };
}

function installTask(
  state: GameState,
  task: TaskInstanceState,
  result?: TaskComputeResultState,
): void {
  state.tasks.instances = { [task.id]: task };
  state.tasks.offers = [];
  if (result !== undefined) state.facility.compute.byTask = { [task.id]: result };
}

describe("Task advancement domain", () => {
  test("reconciles persistent, year, prerequisite, and terminal offers in stable content order", () => {
    const state = createState();
    state.tasks.offers = [SERVICE_ID, PROJECT_ID];
    state.tasks.instances = {
      "task-instance-00000001": activeTask({ status: "completed" }),
    };
    state.campaign.currentYear = 1947;
    state.research.statuses["research-stable-power-distribution"] = "completed";
    state.research.statuses["research-forced-airflow"] = "completed";

    expect(reconcileTaskOffers(state, content)).toEqual([
      SERVICE_ID,
      "task-wiring-layout-study",
      "task-reactor-diffusion-study",
    ]);
  });

  test("does not offer a prerequisite definition until the following call after research completes", () => {
    const state = createState();
    state.campaign.currentYear = 1946;
    expect(reconcileTaskOffers(state, content)).not.toContain("task-wiring-layout-study");
    state.research.statuses["research-stable-power-distribution"] = "completed";
    expect(reconcileTaskOffers(state, content)).toContain("task-wiring-layout-study");
  });

  test.each([
    ["accepted", 10, "failed"],
    ["hold", 10, "failed"],
    ["active", 10, "failed"],
  ] as const)("fails %s tasks at deadline before progress", (status, tick, expectedStatus) => {
    const state = createState();
    const task = activeTask({
      status,
      deadlineTick: 10,
      allocation: status === "accepted" ? null : activeTask().allocation,
    });
    state.tick = tick;
    installTask(state, task, status === "active" ? taskResult(task) : undefined);

    const calculation = advanceTaskSystem(state, content);
    const next = calculation.result.tasks.instances[task.id];
    expect(next?.status).toBe(expectedStatus);
    expect(next?.phaseCompletedOperations).toBe(0);
    expect(next?.allocation?.deliveredUsefulComputeFlops ?? null).toBe(
      status === "accepted" ? null : 100,
    );
  });

  test("allows final deadline-tick-minus-one progress and calculates the runnable formula", () => {
    const state = createState();
    const task = activeTask({ deadlineTick: 10 });
    state.tick = 9;
    installTask(state, task, taskResult(task));

    expect(
      calculateTaskProgress(task, definitionFor(content, PROJECT_ID), taskResult(task)),
    ).toMatchObject({
      appliedOperations: 10,
      compliantThisTick: true,
    });
    expect(
      advanceTaskSystem(state, content).result.tasks.instances[task.id]?.phaseCompletedOperations,
    ).toBe(10);
  });

  test.each([
    ["no-active-compute", { runnable: false, blockingReasons: ["no-active-compute"] }, false],
    [
      "insufficient-memory",
      { runnable: false, blockingReasons: ["insufficient-memory-capacity"] },
      false,
    ],
    ["disconnected", { runnable: false, blockingReasons: ["data-disconnected"] }, false],
    ["unstable", { meetsStabilityMinimum: false }, false],
    ["zero-delivery", {}, true],
  ] as const)(
    "keeps active progress at zero when Task 9 is %s",
    (_label, resultPatch, zeroDelivery) => {
      const state = createState();
      const task = activeTask({
        allocation: {
          ...activeAllocation(),
          deliveredUsefulComputeFlops: zeroDelivery ? 0 : 100,
        },
      });
      installTask(state, task, taskResult(task, resultPatch));

      const next = advanceTaskSystem(state, content).result.tasks.instances[task.id];
      expect(next?.status).toBe("active");
      expect(next?.phaseCompletedOperations).toBe(0);
    },
  );

  test.each([
    ["missing", undefined],
    ["wrong-task", taskResult(activeTask(), { taskInstanceId: "task-instance-00000002" })],
    ["wrong-definition", taskResult(activeTask(), { taskDefinitionId: SERVICE_ID })],
    ["wrong-phase", taskResult(activeTask(), { phaseIndex: 1 })],
  ] as const)("rejects %s active Task 9 evidence as a fatal invariant", (_label, result) => {
    const state = createState();
    const task = activeTask();
    installTask(state, task, result);

    expect(() => advanceTaskSystem(state, content)).toThrow("current Task 9 result");
  });

  test("clamps exactly, discards surplus, and starts the next phase on the next tick", () => {
    const state = createState();
    const firstPhase = phaseFor(definitionFor(content, PROJECT_ID), 0);
    const task = activeTask({
      phaseCompletedOperations: firstPhase.operations - 5,
      totalCompletedOperations: firstPhase.operations - 5,
      allocation: { ...activeAllocation(), deliveredUsefulComputeFlops: 100 },
    });
    installTask(state, task, taskResult(task));

    const first = advanceTaskSystem(state, content).result.tasks.instances[task.id];
    if (first === undefined) throw new Error("Expected completed first phase fixture task.");
    expect(first).toMatchObject({
      currentPhaseIndex: 1,
      phaseCompletedOperations: 0,
      totalCompletedOperations: firstPhase.operations,
    });
    const nextState = structuredClone(state);
    nextState.tasks.instances = { [task.id]: first };
    nextState.tick += 1;
    nextState.facility.compute.byTask = { [task.id]: taskResult(first) };
    expect(
      advanceTaskSystem(nextState, content).result.tasks.instances[task.id]
        ?.phaseCompletedOperations,
    ).toBe(10);
  });

  test("completes once with quantized money, reputation, Research Data, and sorted evidence", () => {
    const state = createState();
    const definition = definitionFor(content, PROJECT_ID);
    const lastPhase = phaseFor(definition, 1);
    const task = activeTask({
      currentPhaseIndex: 1,
      phaseCompletedOperations: lastPhase.operations - 10,
      totalCompletedOperations: phaseFor(definition, 0).operations + lastPhase.operations - 10,
    });
    state.research.evidenceTags = ["evidence-alpha", "evidence-tube-failure-log"];
    installTask(state, task, taskResult(task));

    const calculation = advanceTaskSystem(state, content);
    const result = calculation.result;
    expect(result.tasks.instances[task.id]).toMatchObject({
      status: "completed",
      accruedPayoutUsd: 6_200,
    });
    expect(result.economy.cashUsd).toBe(state.economy.cashUsd + 6_200);
    expect(result.economy.totalIncomeUsd).toBe(state.economy.totalIncomeUsd + 6_200);
    expect(result.campaign.reputation).toBe(8);
    expect(result.research.researchData).toBe(state.research.researchData + 20);
    expect(result.research.evidenceTags).toEqual(["evidence-alpha", "evidence-tube-failure-log"]);
    expect(result.incomeUsdThisTick).toBe(6_200);
    expect(
      advanceTaskSystem({ ...state, tasks: result.tasks }, content).result.incomeUsdThisTick,
    ).toBe(0);
  });

  test("pays a fully compliant service window and resets a nonterminal next window", () => {
    const state = createState();
    const task = activeTask({
      definitionId: SERVICE_ID,
      deadlineTick: null,
      acceptedAtTick: 0,
      serviceWindowCompliant: true,
    });
    state.tick = 599;
    installTask(state, task, taskResult(task));

    const result = advanceTaskSystem(state, content).result;
    expect(result.economy.cashUsd).toBe(state.economy.cashUsd + 520);
    expect(result.tasks.instances[task.id]).toMatchObject({
      accruedPayoutUsd: 520,
      serviceWindowCompliant: true,
    });
  });

  test.each([
    ["hold", false, 100],
    ["disconnected", true, 100],
    ["unstable", true, 100],
    ["zero-delivery", true, 0],
  ] as const)("pays no service window after a %s tick", (kind, previousCompliant, delivery) => {
    const state = createState();
    const task = activeTask({
      definitionId: SERVICE_ID,
      status: kind === "hold" ? "hold" : "active",
      deadlineTick: null,
      acceptedAtTick: 0,
      serviceWindowCompliant: previousCompliant,
      allocation: { ...activeAllocation(), deliveredUsefulComputeFlops: delivery },
    });
    state.tick = 599;
    installTask(
      state,
      task,
      task.status === "active"
        ? taskResult(task, {
            runnable: kind === "disconnected" ? false : true,
            meetsStabilityMinimum: kind === "unstable" ? false : true,
          })
        : undefined,
    );

    const result = advanceTaskSystem(state, content).result;
    expect(result.incomeUsdThisTick).toBe(0);
    expect(result.tasks.instances[task.id]?.serviceWindowCompliant).toBe(true);
  });

  test("does not catch up an interrupted service payout in the next compliant window", () => {
    const state = createState();
    const task = activeTask({
      definitionId: SERVICE_ID,
      deadlineTick: null,
      acceptedAtTick: 0,
      serviceWindowCompliant: false,
    });
    state.tick = 599;
    installTask(state, task, taskResult(task));

    const interrupted = advanceTaskSystem(state, content).result;
    expect(interrupted.incomeUsdThisTick).toBe(0);
    const nextWindow = structuredClone(state);
    nextWindow.tick = 1_199;
    nextWindow.tasks = structuredClone(interrupted.tasks);
    nextWindow.economy = structuredClone(interrupted.economy);
    const nextTask = nextWindow.tasks.instances[task.id];
    if (nextTask === undefined) throw new Error("Expected next-window service fixture.");
    nextWindow.facility.compute.byTask = { [task.id]: taskResult(nextTask) };

    const compliant = advanceTaskSystem(nextWindow, content).result;
    expect(compliant.incomeUsdThisTick).toBe(520);
    expect(compliant.tasks.instances[task.id]?.accruedPayoutUsd).toBe(520);
  });

  test("applies both a final completion payout and a service boundary payout", () => {
    const state = createState();
    const service = definitionFor(content, SERVICE_ID);
    const phase = phaseFor(service, 0);
    const task = activeTask({
      definitionId: SERVICE_ID,
      deadlineTick: null,
      acceptedAtTick: 0,
      phaseCompletedOperations: phase.operations - 10,
      totalCompletedOperations: phase.operations - 10,
      serviceWindowCompliant: true,
    });
    state.tick = 599;
    installTask(state, task, taskResult(task));

    const result = advanceTaskSystem(state, content).result;
    expect(result.tasks.instances[task.id]).toMatchObject({
      status: "completed",
      accruedPayoutUsd: 520,
    });
    expect(result.incomeUsdThisTick).toBe(520);
  });

  test("quantizes completion and periodic payouts through microdollars", () => {
    const fractionalContent = structuredClone(content);
    const definition = definitionFor(fractionalContent, PROJECT_ID);
    (definition as unknown as { payoutUsd: number }).payoutUsd = 0.0000005;
    const state = createState();
    const phase = phaseFor(definition, 1);
    const task = activeTask({
      currentPhaseIndex: 1,
      phaseCompletedOperations: phase.operations - 10,
      totalCompletedOperations: phaseFor(definition, 0).operations + phase.operations - 10,
    });
    installTask(state, task, taskResult(task));

    const result = advanceTaskSystem(state, fractionalContent).result;
    expect(result.incomeUsdThisTick).toBe(0.000001);
    expect(result.economy.cashUsd).toBe(state.economy.cashUsd + 0.000001);
  });

  test("processes task IDs stably and accumulates simultaneous payouts exactly", () => {
    const state = createState();
    const first = activeTask({ id: "task-instance-00000002" });
    const project = definitionFor(content, PROJECT_ID);
    const phase = phaseFor(project, 1);
    const second = activeTask({
      id: "task-instance-00000001",
      currentPhaseIndex: 1,
      phaseCompletedOperations: phase.operations - 10,
      totalCompletedOperations: phaseFor(project, 0).operations + phase.operations - 10,
    });
    first.definitionId = "task-wiring-layout-study";
    first.currentPhaseIndex = 0;
    const firstPhase = phaseFor(definitionFor(content, first.definitionId), 0);
    first.phaseCompletedOperations = firstPhase.operations - 10;
    first.totalCompletedOperations = firstPhase.operations - 10;
    installTask(state, second, taskResult(second));
    state.tasks.instances = { [first.id]: first, [second.id]: second };
    state.facility.compute.byTask = {
      [first.id]: taskResult(first),
      [second.id]: taskResult(second),
    };

    const result = advanceTaskSystem(state, content).result;
    expect(Object.keys(result.tasks.instances)).toEqual([second.id, first.id]);
    expect(result.incomeUsdThisTick).toBe(8_800);
  });

  test("returns detached immutable serializable calculation evidence and rejects stale or tampered candidates", () => {
    const state = createState();
    const task = activeTask();
    installTask(state, task, taskResult(task));
    const before = structuredClone(state);

    const calculation = advanceTaskSystem(state, content);
    expect(state).toEqual(before);
    expect(JSON.parse(JSON.stringify(calculation.result))).toEqual(calculation.result);
    expect(
      validateFreshTaskAdvance(state, content, calculation.result, calculation.witness),
    ).toEqual([]);
    expect(
      validateFreshTaskAdvance(
        state,
        content,
        structuredClone(calculation.result),
        calculation.witness,
      ),
    ).not.toEqual([]);
    state.tick += 1;
    expect(
      validateFreshTaskAdvance(state, content, calculation.result, calculation.witness),
    ).not.toEqual([]);
  });

  test("does not share returned data or mutable scratch between independent calls", () => {
    const state = createState();
    const task = activeTask();
    installTask(state, task, taskResult(task));

    const first = advanceTaskSystem(state, content);
    const second = advanceTaskSystem(state, content);
    expect(first.result).not.toBe(second.result);
    expect(first.result.tasks).not.toBe(second.result.tasks);
    expect(Object.isFrozen(first.result)).toBe(true);
    expect(first.result.tasks.instances[task.id]?.phaseCompletedOperations).toBe(10);
    expect(second.result.tasks.instances[task.id]?.phaseCompletedOperations).toBe(10);
  });

  test("returns equal plain results for equivalent task insertion orders without touching RNG", () => {
    const firstState = createState();
    const secondState = createState();
    const first = activeTask({ id: "task-instance-00000002" });
    const second = activeTask({ id: "task-instance-00000001" });
    first.definitionId = "task-wiring-layout-study";
    firstState.tasks.instances = { [first.id]: first, [second.id]: second };
    secondState.tasks.instances = {
      [second.id]: structuredClone(second),
      [first.id]: structuredClone(first),
    };
    firstState.facility.compute.byTask = {
      [first.id]: taskResult(first),
      [second.id]: taskResult(second),
    };
    secondState.facility.compute.byTask = {
      [second.id]: taskResult(second),
      [first.id]: taskResult(first),
    };
    const firstRng = firstState.rngState;
    const secondRng = secondState.rngState;

    const firstResult = advanceTaskSystem(firstState, content).result;
    const secondResult = advanceTaskSystem(secondState, content).result;
    expect(firstResult).toEqual(secondResult);
    expect(JSON.stringify(firstResult)).toBe(JSON.stringify(secondResult));
    expect(firstState.rngState).toEqual(firstRng);
    expect(secondState.rngState).toEqual(secondRng);
  });

  test("rejects a forged witness even when the candidate result is otherwise exact", () => {
    const state = createState();
    const task = activeTask();
    installTask(state, task, taskResult(task));
    const calculation = advanceTaskSystem(state, content);
    const forgedWitness = { ...calculation.witness, tick: state.tick + 1 };

    expect(validateFreshTaskAdvance(state, content, calculation.result, forgedWitness)).not.toEqual(
      [],
    );
  });
});
