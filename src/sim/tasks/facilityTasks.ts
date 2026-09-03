import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import {
  advanceBenchmarkRun,
  clearBenchmarkAdvanceEvidence,
  validateFreshBenchmarkAdvance,
} from "../benchmarks/benchmarkDomain.ts";
import {
  assertValidContentAwareActiveBenchmarkState,
  assertValidContentAwareBenchmarkState,
  assertValidStoredBenchmarkState,
} from "../benchmarks/benchmarkState.ts";
import { assertValidInventoryEconomyState } from "../economy/inventoryEconomyState.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../core/tickSystems.ts";
import type { GameState } from "../core/types.ts";
import { advanceTaskSystem, validateFreshTaskAdvance } from "./taskDomain.ts";
import { assertValidStoredTaskState } from "./taskState.ts";

export interface TaskTickSystemOptions {
  /** Test/diagnostic-only observation after a fresh pure Task calculation. */
  readonly onTaskAdvance?: () => void;
}

export interface TaskBenchmarkTickSystemOptions extends TaskTickSystemOptions {
  /** Test/diagnostic-only observation after a fresh pure Benchmark calculation. */
  readonly onBenchmarkAdvance?: () => void;
}

function applyTaskResult(
  state: Readonly<GameState>,
  result: ReturnType<typeof advanceTaskSystem>["result"],
): GameState {
  const economyChanged =
    result.changed.economy || state.economy.lastTickIncomeUsd !== result.incomeUsdThisTick;
  if (
    !result.changed.tasks &&
    !result.changed.campaign &&
    !result.changed.research &&
    !economyChanged
  ) {
    return state;
  }
  return {
    ...state,
    ...(result.changed.tasks ? { tasks: result.tasks } : {}),
    ...(result.changed.campaign ? { campaign: result.campaign } : {}),
    ...(result.changed.research ? { research: result.research } : {}),
    ...(economyChanged
      ? {
          economy: {
            ...result.economy,
            lastTickIncomeUsd: result.incomeUsdThisTick,
          },
        }
      : {}),
  };
}

/** Registers only the Task portion of the approved Task/benchmark stage. */
export function createTaskTickSystems(
  content: ContentBundle,
  options: TaskTickSystemOptions = {},
): TickSystemRegistry {
  return Object.freeze({
    "advance-tasks-and-benchmarks": {
      createRuntime() {
        let calculation: ReturnType<typeof advanceTaskSystem> | undefined;
        return {
          executionMode: "structural-sharing" as const,
          validateLifecycleState(state: Readonly<GameState>) {
            assertValidStoredTaskState(state);
          },
          clearDerivedState() {
            calculation = undefined;
          },
          run({ state }: StructuralSharingTickSystemContext): GameState {
            try {
              calculation = advanceTaskSystem(state, content);
              options.onTaskAdvance?.();
              const issues = validateFreshTaskAdvance(
                state,
                content,
                calculation.result,
                calculation.witness,
              );
              if (issues.length > 0) {
                throw new Error(`Invalid Task advancement result:\n${issues.join("\n")}`);
              }
              const candidate = applyTaskResult(state, calculation.result);
              if (candidate.tasks !== state.tasks) assertValidStoredTaskState(candidate);
              if (candidate.economy !== state.economy) assertValidInventoryEconomyState(candidate);
              return candidate;
            } finally {
              calculation = undefined;
            }
          },
        };
      },
    },
  });
}

function applyBenchmarkResult(
  state: Readonly<GameState>,
  result: ReturnType<typeof advanceBenchmarkRun>["result"],
): GameState {
  if (result.benchmarks === state.benchmarks) return state;
  return { ...state, benchmarks: result.benchmarks };
}

/** Registers the single authoritative Task/Benchmark production stage. */
export function createTaskBenchmarkTickSystems(
  content: ContentBundle,
  options: TaskBenchmarkTickSystemOptions = {},
): TickSystemRegistry {
  return Object.freeze({
    "advance-tasks-and-benchmarks": {
      createRuntime() {
        let taskCalculation: ReturnType<typeof advanceTaskSystem> | undefined;
        let benchmarkCalculation: ReturnType<typeof advanceBenchmarkRun> | undefined;
        return {
          executionMode: "structural-sharing" as const,
          validateLifecycleState(state: Readonly<GameState>) {
            assertValidStoredTaskState(state);
            assertValidContentAwareBenchmarkState(state, content);
          },
          clearDerivedState() {
            taskCalculation = undefined;
            if (benchmarkCalculation !== undefined) {
              clearBenchmarkAdvanceEvidence(benchmarkCalculation.witness);
            }
            benchmarkCalculation = undefined;
          },
          run({ state }: StructuralSharingTickSystemContext): GameState {
            try {
              taskCalculation = advanceTaskSystem(state, content);
              options.onTaskAdvance?.();
              const taskIssues = validateFreshTaskAdvance(
                state,
                content,
                taskCalculation.result,
                taskCalculation.witness,
              );
              if (taskIssues.length > 0) {
                throw new Error(`Invalid Task advancement result:\n${taskIssues.join("\n")}`);
              }
              const taskCandidate = applyTaskResult(state, taskCalculation.result);
              if (taskCandidate.tasks !== state.tasks) assertValidStoredTaskState(taskCandidate);
              if (taskCandidate.economy !== state.economy) {
                assertValidInventoryEconomyState(taskCandidate);
              }

              const active = taskCandidate.benchmarks.active;
              if (active === null) return taskCandidate;

              benchmarkCalculation = advanceBenchmarkRun(active, taskCandidate, content, {
                useStructuralInputEvidence: options.onBenchmarkAdvance === undefined,
              });
              options.onBenchmarkAdvance?.();
              const benchmarkIssues = validateFreshBenchmarkAdvance(
                taskCandidate,
                content,
                benchmarkCalculation.result,
                benchmarkCalculation.witness,
              );
              if (benchmarkIssues.length > 0) {
                throw new Error(
                  `Invalid Benchmark advancement result:\n${benchmarkIssues.join("\n")}`,
                );
              }
              const candidate = applyBenchmarkResult(taskCandidate, benchmarkCalculation.result);
              if (benchmarkCalculation.result.completedResult === null) {
                assertValidContentAwareActiveBenchmarkState(candidate, content);
              } else {
                assertValidStoredBenchmarkState(candidate);
                assertValidContentAwareBenchmarkState(candidate, content);
              }
              return candidate;
            } finally {
              taskCalculation = undefined;
              if (benchmarkCalculation !== undefined) {
                clearBenchmarkAdvanceEvidence(benchmarkCalculation.witness);
              }
              benchmarkCalculation = undefined;
            }
          },
        };
      },
    },
  });
}
