import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, TaskInstanceState, TaskStatus } from "../../src/sim/core/types.ts";

export const taskContent = loadContentBundle();

export function createTaskInstanceFixture(
  status: Exclude<TaskStatus, "offered"> = "active",
): TaskInstanceState {
  const allocation = {
    clusterModuleIds: ["module-instance-00000001"],
    requestedShare: 1,
    deliveredUsefulComputeFlops: 0,
  };

  return {
    id: "task-instance-00000001",
    definitionId: "task-ballistic-table-verification",
    status,
    acceptedAtTick: 0,
    deadlineTick: 2_100,
    currentPhaseIndex: 0,
    phaseCompletedOperations: 0,
    totalCompletedOperations: 0,
    allocation: status === "accepted" ? null : allocation,
    accruedPayoutUsd: 0,
    serviceWindowCompliant: null,
  };
}

export function createTaskStateFixture(
  status: Exclude<TaskStatus, "offered"> = "active",
): GameState {
  const state = createInitialGameState({ content: taskContent, seed: "task-state-fixture" });
  const instance = createTaskInstanceFixture(status);
  state.tasks.offers = ["task-census-tabulation-service"];
  state.tasks.nextTaskInstanceSequence = 2;
  state.tasks.instances = { [instance.id]: instance };
  return state;
}
