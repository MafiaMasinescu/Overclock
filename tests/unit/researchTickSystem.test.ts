import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createResearchCommandHandlers } from "../../src/sim/research/researchCommands.ts";
import { createResearchTickSystems } from "../../src/sim/research/facilityResearch.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createTaskTickSystems } from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import { createTask9PerformanceFixture } from "../performance/thermalFixture.ts";

const content = loadContentBundle();
const ROOT = "research-stable-power-distribution";

function fullCore(
  state: GameState,
  onCompute?: (event: "calculated" | "reused") => void,
  onResearch?: () => void,
): SimCore {
  for (const task of Object.values(state.tasks.instances)) {
    if (task.definitionId === "task-census-tabulation-service") {
      task.serviceWindowCompliant = true;
    }
  }
  return new SimCore({
    initialState: state,
    commandHandlers: createResearchCommandHandlers(content),
    tickSystems: {
      ...createPowerTickSystems(content),
      ...createThermalTickSystems(content),
      ...createOverclockTickSystems(content),
      ...createComputeTickSystems(
        content,
        onCompute === undefined ? {} : { onComputeResultCacheEvent: onCompute },
      ),
      ...createTaskTickSystems(content),
      ...createResearchTickSystems(
        content,
        onResearch === undefined ? {} : { onResearchAdvance: onResearch },
      ),
    },
  });
}

function activeResearchState(state: GameState, completedOperations = 0): GameState {
  for (const task of Object.values(state.tasks.instances)) {
    if (task.definitionId === "task-census-tabulation-service") {
      task.serviceWindowCompliant = true;
    }
  }
  return {
    ...state,
    research: {
      ...state.research,
      statuses: { ...state.research.statuses, [ROOT]: "active" },
      active: {
        nodeId: ROOT,
        startedAtTick: state.tick,
        completedOperations,
        reservedComputeShare: 0.1,
      },
    },
  };
}

function startCommand(commandId: string, reservedComputeShare = 0.1) {
  return {
    commandId,
    source: "player" as const,
    kind: "START_RESEARCH" as const,
    nodeId: ROOT,
    reservedComputeShare,
  };
}

describe("production Research lifecycle tick system", () => {
  test("uses the fixed Compute, Task, Research order and advances after Task", () => {
    const events: string[] = [];
    const state = createTask9PerformanceFixture("research-tick-order");
    const core = new SimCore({
      initialState: activeResearchState(state),
      tickSystems: {
        ...createPowerTickSystems(content),
        ...createThermalTickSystems(content),
        ...createOverclockTickSystems(content),
        ...createComputeTickSystems(content, {
          onFacilityCalculation: () => events.push("compute"),
        }),
        ...createTaskTickSystems(content, { onTaskAdvance: () => events.push("task") }),
        ...createResearchTickSystems(content, { onResearchAdvance: () => events.push("research") }),
      },
    });

    core.step();

    expect(events).toEqual(["compute", "task", "research"]);
    expect(core.getStateForSave().research.active?.completedOperations).toBeGreaterThan(0);
  });

  test("reconciles Research unlocked by Task Evidence in the same tick", () => {
    const prepared = fullCore(createTask9PerformanceFixture("research-same-tick-evidence"));
    prepared.step(5);
    const state = prepared.getStateForSave();
    state.research.statuses[ROOT] = "completed";
    const task = state.tasks.instances["task-9-serial"];
    const definition = content.tasks[task?.definitionId ?? ""];
    const deliveredUsefulComputeFlops = task?.allocation?.deliveredUsefulComputeFlops;
    if (
      task === undefined ||
      definition === undefined ||
      deliveredUsefulComputeFlops === undefined ||
      deliveredUsefulComputeFlops <= 0
    ) {
      throw new Error("Missing Task fixture delivery.");
    }
    const finalPhaseIndex = definition.phases.length - 1;
    const completedBeforeFinal = definition.phases
      .slice(0, finalPhaseIndex)
      .reduce((total, phase) => total + phase.operations, 0);
    const finalOperations = definition.phases[finalPhaseIndex]?.operations;
    if (finalOperations === undefined) throw new Error("Missing final Task phase.");
    task.currentPhaseIndex = finalPhaseIndex;
    const remainingOperations = deliveredUsefulComputeFlops * 0.05;
    task.phaseCompletedOperations = finalOperations - remainingOperations;
    task.totalCompletedOperations = completedBeforeFinal + finalOperations - remainingOperations;

    const core = fullCore(state);
    core.step();
    const after = core.getStateForSave();

    expect(after.tasks.instances["task-9-serial"]?.status).toBe("completed");
    expect(after.research.evidenceTags).toContain("evidence-tube-failure-log");
    expect(after.research.statuses["research-vacuum-tube-reliability"]).toBe("available");
  });

  test("starts, computes, and advances Research in the same real tick", () => {
    const state = createTask9PerformanceFixture("research-start-tick");
    state.research.researchData = 100;
    const core = fullCore(state);
    core.enqueue(startCommand("a1000000-0000-4000-8000-000000000001"));

    const result = core.step();
    const after = core.getStateForSave();

    expect(result.commandResults[0]).toMatchObject({ accepted: true, appliedAtTick: 0 });
    expect(after.research.active?.completedOperations).toBeGreaterThan(0);
    expect(after.facility.compute.research).toMatchObject({
      nodeId: ROOT,
      reservedComputeShare: 0.1,
    });
  });

  test("stalls at zero delivery and preserves the active Research record", () => {
    const state = activeResearchState(createInitialGameState({ content, seed: "research-zero" }));
    const before = state.research.active;
    const core = fullCore(state);

    core.step();

    expect(core.getStateForSave().research.active).toEqual(before);
    expect(core.getStateForSave().facility.compute.research).toMatchObject({
      facilityAvailableComputeFlops: 0,
      deliveredUsefulComputeFlops: 0,
    });
  });

  test("reuses Compute for progress-only Research changes", () => {
    const events: string[] = [];
    const prepared = fullCore(createTask9PerformanceFixture("research-cache"));
    prepared.step();
    const core = new SimCore({
      initialState: activeResearchState(prepared.getStateForSave()),
      tickSystems: {
        ...createComputeTickSystems(content, {
          onComputeResultCacheEvent: (event) => events.push(event),
        }),
        ...createResearchTickSystems(content),
      },
    });

    core.step(3);

    expect(events).toEqual(["calculated", "reused", "reused"]);
  });

  test("keeps the current-tick Research result historical after completion and clears it next tick", () => {
    const state = activeResearchState(createTask9PerformanceFixture("research-complete"));
    const required = content.research[ROOT]?.requiredOperations;
    const active = state.research.active;
    if (required === undefined || active === null) throw new Error("Missing Research fixture.");
    state.research.active = { ...active, completedOperations: required - 1 };
    const core = fullCore(state);

    core.step();
    const completedTick = core.getStateForSave();
    expect(completedTick.research.active).toBeNull();
    expect(completedTick.research.statuses[ROOT]).toBe("completed");
    expect(completedTick.facility.compute.research?.nodeId).toBe(ROOT);

    core.step();
    expect(core.getStateForSave().facility.compute.research).toBeNull();
  });

  test("invalidates the shared Compute cache after a Research node/share change", () => {
    const events: string[] = [];
    const state = createTask9PerformanceFixture("research-invalidation");
    state.research.researchData = 100;
    const core = fullCore(state, (event) => events.push(event));

    core.step();
    core.enqueue(startCommand("a1000000-0000-4000-8000-000000000002", 0.2));
    core.processPendingCommands();
    core.step();

    expect(events).toEqual(["calculated", "calculated"]);
    expect(core.getStateForSave().facility.compute.research?.reservedComputeShare).toBe(0.2);
  });

  test("does not advance Research for command-only processing or step(0)", () => {
    const state = createTask9PerformanceFixture("research-command-only");
    state.research.researchData = 100;
    const core = fullCore(state);
    const before = core.getStateForSave();
    const zero = core.step(0);
    expect(zero.ticksExecuted).toBe(0);
    expect(core.getStateForSave()).toEqual(before);

    core.enqueue(startCommand("a1000000-0000-4000-8000-000000000003"));
    core.processPendingCommands();
    expect(core.getStateForSave().research.active?.completedOperations).toBe(0);
  });

  test("rolls back Task, Research, Compute, and RNG when Research fails", () => {
    const initial = activeResearchState(createTask9PerformanceFixture("research-rollback"));
    const before = structuredClone(initial);
    const core = new SimCore({
      initialState: initial,
      tickSystems: {
        ...createPowerTickSystems(content),
        ...createThermalTickSystems(content),
        ...createOverclockTickSystems(content),
        ...createComputeTickSystems(content),
        ...createTaskTickSystems(content),
        "advance-research": {
          createRuntime() {
            return {
              executionMode: "structural-sharing" as const,
              run() {
                throw new Error("forced Research failure");
              },
            };
          },
        },
      },
    });

    expect(() => core.step()).toThrow(/advance-research/);
    expect(core.getStateForSave()).toEqual(before);
  });

  test("keeps independent Research runtimes isolated", () => {
    const first = fullCore(activeResearchState(createTask9PerformanceFixture("research-first")));
    const second = fullCore(createTask9PerformanceFixture("research-second"));

    first.step();
    second.step();

    expect(first.getStateForSave().research.active?.completedOperations).toBeGreaterThan(0);
    expect(second.getStateForSave().research.active).toBeNull();
  });

  test("rejects replacement with an ineligible available Research status", () => {
    const initial = createInitialGameState({ content, seed: "research-replacement-validation" });
    const core = new SimCore({
      initialState: initial,
      tickSystems: createResearchTickSystems(content),
    });
    const contradictory = structuredClone(initial);
    contradictory.research.statuses["research-vacuum-tube-reliability"] = "available";

    expect(() => {
      core.replaceState(contradictory);
    }).toThrow(/available node/i);
    expect(core.getStateForSave()).toEqual(initial);
  });
});
