import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
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
