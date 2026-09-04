import { describe, expect, test } from "vitest";

import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import type { StructuralSharingTickSystemContext } from "../../src/sim/core/tickSystems.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createTaskCommandHandlers } from "../../src/sim/tasks/taskCommands.ts";
import { createTaskTickSystems } from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
} from "../performance/thermalFixture.ts";

function task9State(seed: string): GameState {
  const state = createTask9PerformanceFixture(seed);
  const service = state.tasks.instances["task-9-bandwidth"];
  if (service === undefined) throw new Error("Missing Task 9 service fixture.");
  service.serviceWindowCompliant = true;
  return state;
}

function fullTaskCore(
  state: GameState,
  onCompute?: (event: "calculated" | "reused") => void,
): SimCore {
  return new SimCore({
    initialState: state,
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
      ...createOverclockTickSystems(thermalPerformanceContent),
      ...createComputeTickSystems(
        thermalPerformanceContent,
        onCompute === undefined ? {} : { onComputeResultCacheEvent: onCompute },
      ),
      ...createTaskTickSystems(thermalPerformanceContent),
    },
  });
}

function prepareComputeState(seed: string): GameState {
  const core = fullTaskCore(task9State(seed));
  core.step(5);
  return core.getStateForSave();
}

function holdCommand(commandId: string): Extract<SimCommand, { kind: "SET_TASK_HOLD" }> {
  return {
    commandId,
    source: "debug",
    kind: "SET_TASK_HOLD",
    taskInstanceId: "task-9-serial",
    hold: true,
  };
}

describe("production Task lifecycle tick system", () => {
  test("consumes current-tick Task 9 delivery after Compute", () => {
    const events: string[] = [];
    const initialState = task9State("task-10-4-ordering");
    const core = new SimCore({
      initialState,
      tickSystems: {
        ...createPowerTickSystems(thermalPerformanceContent),
        ...createThermalTickSystems(thermalPerformanceContent),
        ...createOverclockTickSystems(thermalPerformanceContent),
        ...createComputeTickSystems(thermalPerformanceContent, {
          onFacilityCalculation() {
            events.push("compute");
          },
        }),
        ...createTaskTickSystems(thermalPerformanceContent, {
          onTaskAdvance() {
            events.push("tasks");
          },
        }),
      },
    });

    core.step();

    const state = core.getStateForSave();
    const task = state.tasks.instances["task-9-serial"];
    expect(events).toEqual(["compute", "tasks"]);
    expect(task?.phaseCompletedOperations).toBe(
      (task?.allocation?.deliveredUsefulComputeFlops ?? 0) * 0.1,
    );
    expect(state.economy.lastTickIncomeUsd).toBe(0);
  });

  test("reuses Compute after progress-only Task changes but recalculates after a phase change", () => {
    const reuseEvents: ("calculated" | "reused")[] = [];
    const reusedCore = new SimCore({
      initialState: prepareComputeState("task-10-4-cache-reuse"),
      tickSystems: {
        ...createComputeTickSystems(thermalPerformanceContent, {
          onComputeResultCacheEvent(event) {
            reuseEvents.push(event);
          },
        }),
        ...createTaskTickSystems(thermalPerformanceContent),
      },
    });
    reusedCore.step(2);
    expect(reuseEvents).toEqual(["calculated", "reused"]);

    const phaseState = prepareComputeState("task-10-4-phase-cache");
    const task = phaseState.tasks.instances["task-9-serial"];
    const definition = thermalPerformanceContent.tasks[task?.definitionId ?? ""];
    const delivery = task?.allocation?.deliveredUsefulComputeFlops;
    if (task === undefined || definition === undefined || delivery === undefined || delivery <= 0) {
      throw new Error("Missing phase-transition fixture delivery.");
    }
    const firstPhase = definition.phases[0];
    if (firstPhase === undefined) throw new Error("Missing phase-transition fixture phase.");
    task.phaseCompletedOperations = firstPhase.operations - delivery * 0.1;
    task.totalCompletedOperations = task.phaseCompletedOperations;
    const phaseEvents: ("calculated" | "reused")[] = [];
    const phaseCore = new SimCore({
      initialState: phaseState,
      tickSystems: {
        ...createComputeTickSystems(thermalPerformanceContent, {
          onComputeResultCacheEvent(event) {
            phaseEvents.push(event);
          },
        }),
        ...createTaskTickSystems(thermalPerformanceContent),
      },
    });
    phaseCore.step(2);
    expect(phaseEvents).toEqual(["calculated", "calculated"]);
    expect(phaseCore.getStateForSave().tasks.instances[task.id]?.currentPhaseIndex).toBe(1);
  });

  test("does no Task work for step(0) or command-only processing, then holds across a real tick", () => {
    const core = new SimCore({
      initialState: prepareComputeState("task-10-4-command-only"),
      commandHandlers: createTaskCommandHandlers(thermalPerformanceContent),
      tickSystems: {
        ...createComputeTickSystems(thermalPerformanceContent),
        ...createTaskTickSystems(thermalPerformanceContent),
      },
    });
    const before = core.getStateForSave();
    expect(core.step(0)).toMatchObject({ ticksExecuted: 0, endTick: before.tick });
    expect(core.getStateForSave()).toEqual(before);

    core.enqueue(holdCommand("10400000-0000-4000-8000-000000000001"));
    expect(core.processPendingCommands()[0]).toMatchObject({ accepted: true });
    const held = core.getStateForSave();
    expect(held.tick).toBe(before.tick);
    expect(held.tasks.instances["task-9-serial"]?.phaseCompletedOperations).toBe(
      before.tasks.instances["task-9-serial"]?.phaseCompletedOperations,
    );

    core.step();
    const after = core.getStateForSave();
    expect(after.tasks.instances["task-9-serial"]?.status).toBe("hold");
    expect(after.tasks.instances["task-9-serial"]?.phaseCompletedOperations).toBe(
      held.tasks.instances["task-9-serial"]?.phaseCompletedOperations,
    );
  });

  test("keeps accepted no-allocation tasks pending while reconciling offers on real ticks", () => {
    const state = createInitialGameState({
      content: thermalPerformanceContent,
      seed: "task-10-4-accepted",
    });
    state.tasks.instances = {
      "task-instance-00000001": {
        id: "task-instance-00000001",
        definitionId: "task-ballistic-table-verification",
        status: "accepted",
        acceptedAtTick: 0,
        deadlineTick: 2_100,
        currentPhaseIndex: 0,
        phaseCompletedOperations: 0,
        totalCompletedOperations: 0,
        allocation: null,
        accruedPayoutUsd: 0,
        serviceWindowCompliant: null,
      },
    };
    state.tasks.offers = [];
    state.tasks.nextTaskInstanceSequence = 2;
    const core = new SimCore({
      initialState: state,
      tickSystems: createTaskTickSystems(thermalPerformanceContent),
    });

    core.step();
    const after = core.getStateForSave();
    expect(after.tasks.instances["task-instance-00000001"]?.status).toBe("accepted");
    expect(after.tasks.offers).toEqual(["task-census-tabulation-service"]);
  });

  test("observes research completion after the Task stage and offers its Task on the next tick", () => {
    const state = createInitialGameState({
      content: thermalPerformanceContent,
      seed: "task-10-4-research-order",
    });
    state.tasks.offers = [];
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        ...createTaskTickSystems(thermalPerformanceContent),
        "advance-research": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                if (candidate.tick !== 0) return candidate;
                return {
                  ...candidate,
                  research: {
                    ...candidate.research,
                    statuses: {
                      ...candidate.research.statuses,
                      "research-stable-power-distribution": "completed" as const,
                    },
                  },
                };
              },
            };
          },
        },
      },
    });

    core.step();
    expect(core.getStateForSave().tasks.offers).not.toContain("task-wiring-layout-study");
    core.step();
    expect(core.getStateForSave().tasks.offers).toContain("task-wiring-layout-study");
  });

  test("rolls back the complete tick, delivery, rewards, and RNG after a later-stage failure", () => {
    const core = new SimCore({
      initialState: task9State("task-10-4-rollback"),
      tickSystems: {
        ...createPowerTickSystems(thermalPerformanceContent),
        ...createThermalTickSystems(thermalPerformanceContent),
        ...createOverclockTickSystems(thermalPerformanceContent),
        ...createComputeTickSystems(thermalPerformanceContent),
        ...createTaskTickSystems(thermalPerformanceContent),
        "advance-research": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ rng }: StructuralSharingTickSystemContext) {
                rng.nextUint32();
                throw new Error("forced post-Task failure");
              },
            };
          },
        },
      },
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(/advance-research/);
    expect(core.getStateForSave()).toEqual(before);
  });

  test("rolls back the complete tick when completion money overflows", () => {
    const state = prepareComputeState("task-10-4-money-overflow");
    const project = state.tasks.instances["task-9-serial"];
    const sourceDefinition = thermalPerformanceContent.tasks[project?.definitionId ?? ""];
    const delivery = project?.allocation?.deliveredUsefulComputeFlops;
    if (
      project === undefined ||
      sourceDefinition === undefined ||
      delivery === undefined ||
      delivery <= 0
    ) {
      throw new Error("Missing completion-overflow fixture delivery.");
    }
    const finalPhaseIndex = sourceDefinition.phases.length - 1;
    const finalPhase = sourceDefinition.phases[finalPhaseIndex];
    const result = state.facility.compute.byTask[project.id];
    if (
      finalPhase === undefined ||
      result === undefined ||
      delivery * 0.1 >= finalPhase.operations
    ) {
      throw new Error("Invalid completion-overflow fixture phase.");
    }
    const priorOperations = sourceDefinition.phases
      .slice(0, finalPhaseIndex)
      .reduce((total, phase) => total + phase.operations, 0);
    state.tasks.instances[project.id] = {
      ...project,
      currentPhaseIndex: finalPhaseIndex,
      phaseCompletedOperations: finalPhase.operations - delivery * 0.1,
      totalCompletedOperations: priorOperations + finalPhase.operations - delivery * 0.1,
    };
    state.facility.compute = {
      ...state.facility.compute,
      byTask: {
        ...state.facility.compute.byTask,
        [project.id]: {
          ...result,
          phaseIndex: finalPhaseIndex,
          phaseId: finalPhase.id,
        },
      },
    };
    const overflowContent = structuredClone(thermalPerformanceContent);
    const overflowDefinition = overflowContent.tasks[project.definitionId];
    if (overflowDefinition === undefined) throw new Error("Missing overflow Task definition.");
    (overflowDefinition as { payoutUsd: number }).payoutUsd = Number.MAX_SAFE_INTEGER;
    const core = new SimCore({
      initialState: state,
      tickSystems: createTaskTickSystems(overflowContent),
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(/advance-tasks-and-benchmarks/);
    expect(core.getStateForSave()).toEqual(before);
  });

  test("rolls back when a later stage tampers Compute-owned Task delivery", () => {
    const core = new SimCore({
      initialState: task9State("task-10-4-delivery-rollback"),
      tickSystems: {
        ...createPowerTickSystems(thermalPerformanceContent),
        ...createThermalTickSystems(thermalPerformanceContent),
        ...createOverclockTickSystems(thermalPerformanceContent),
        ...createComputeTickSystems(thermalPerformanceContent),
        ...createTaskTickSystems(thermalPerformanceContent),
        "advance-research": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state: candidate }: StructuralSharingTickSystemContext) {
                const task = candidate.tasks.instances["task-9-serial"];
                if (task?.allocation === null || task === undefined) {
                  throw new Error("Missing Task delivery fixture.");
                }
                const allocation = task.allocation;
                return {
                  ...candidate,
                  tasks: {
                    ...candidate.tasks,
                    instances: {
                      ...candidate.tasks.instances,
                      [task.id]: {
                        ...task,
                        allocation: {
                          ...allocation,
                          deliveredUsefulComputeFlops: allocation.deliveredUsefulComputeFlops + 1,
                        },
                      },
                    },
                  },
                };
              },
            };
          },
        },
      },
    });
    const before = core.getStateForSave();

    expect(() => core.step()).toThrow(/advance-research/);
    expect(core.getStateForSave()).toEqual(before);
  });

  test("commits an earlier requested tick before rolling back a later requested tick", () => {
    let advanceResearchRuns = 0;
    const core = new SimCore({
      initialState: createInitialGameState({
        content: thermalPerformanceContent,
        seed: "task-10-4-partial-commit",
      }),
      tickSystems: {
        ...createTaskTickSystems(thermalPerformanceContent),
        "advance-research": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                advanceResearchRuns += 1;
                if (advanceResearchRuns === 2) throw new Error("forced second-tick failure");
                return state;
              },
            };
          },
        },
      },
    });

    expect(() => core.step(2)).toThrow(/advance-research/);
    expect(core.tick).toBe(1);
    expect(core.getStateForSave().clock.simulatedSeconds).toBe(0.1);
  });

  test("shares unrelated branches and keeps independent Task runtimes isolated", () => {
    let inventoryShared = false;
    function systems(observeInventory: boolean) {
      let priorInventory: GameState["inventory"] | undefined;
      return {
        ...createComputeTickSystems(thermalPerformanceContent),
        ...createTaskTickSystems(thermalPerformanceContent),
        "advance-research": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run({ state }: StructuralSharingTickSystemContext) {
                if (observeInventory) {
                  inventoryShared =
                    priorInventory === undefined || priorInventory === state.inventory;
                }
                priorInventory = state.inventory;
                return state;
              },
            };
          },
        },
      };
    }
    const first = new SimCore({
      initialState: prepareComputeState("task-10-4-runtime-first"),
      tickSystems: systems(true),
    });
    const second = new SimCore({
      initialState: prepareComputeState("task-10-4-runtime-second"),
      tickSystems: systems(false),
    });

    first.step(2);
    const firstProgress =
      first.getStateForSave().tasks.instances["task-9-serial"]?.totalCompletedOperations;
    second.step();
    expect(inventoryShared).toBe(true);
    expect(
      second.getStateForSave().tasks.instances["task-9-serial"]?.totalCompletedOperations,
    ).not.toBe(firstProgress);
  });

  test("repeats the exact 100-tick Task lifecycle sequence and final hash", () => {
    function run() {
      const core = fullTaskCore(task9State("task-10-4-exact-100"));
      const initialRngState = core.getStateForSave().rngState;
      core.step(100);
      const state = core.getStateForSave();
      return {
        tick: state.tick,
        rngUnchanged: state.rngState === initialRngState,
        serialProgress: state.tasks.instances["task-9-serial"]?.totalCompletedOperations,
        servicePayout: state.tasks.instances["task-9-bandwidth"]?.accruedPayoutUsd,
        priorShapeHash: hashCanonicalState({
          ...state,
          blueprints: { records: state.blueprints.records },
        }),
        hash: hashCanonicalState(state),
      };
    }

    const expected = run();
    expect(expected.tick).toBe(100);
    expect(expected.rngUnchanged).toBe(true);
    expect(expected.priorShapeHash).toBe("046b2a57813e53a9");
    expect(expected.hash).toBe("03ebe1a5b7fba123");
    expect(run()).toEqual(expected);
  }, 30_000);
});
