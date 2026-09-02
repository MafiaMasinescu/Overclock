import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../core/tickSystems.ts";
import type { GameState } from "../core/types.ts";
import {
  advanceResearchSystem,
  assertValidResearchLifecycleState,
  validateFreshResearchAdvance,
} from "./researchDomain.ts";
import { assertValidContentAwareResearchState } from "./researchState.ts";

export interface ResearchTickSystemOptions {
  /** Test/diagnostic-only observation after a fresh pure Research calculation. */
  readonly onResearchAdvance?: () => void;
}

function applyResearchResult(
  state: Readonly<GameState>,
  result: ReturnType<typeof advanceResearchSystem>["result"],
): GameState {
  if (
    result.research === state.research &&
    result.campaign === state.campaign &&
    result.museum === state.museum
  ) {
    return state;
  }
  return {
    ...state,
    ...(result.research === state.research ? {} : { research: result.research }),
    ...(result.campaign === state.campaign ? {} : { campaign: result.campaign }),
    ...(result.museum === state.museum ? {} : { museum: result.museum }),
  };
}

/** Registers the authoritative Research lifecycle at the fixed advance-research stage. */
export function createResearchTickSystems(
  content: ContentBundle,
  options: ResearchTickSystemOptions = {},
): TickSystemRegistry {
  return Object.freeze({
    "advance-research": {
      createRuntime() {
        let calculation: ReturnType<typeof advanceResearchSystem> | undefined;
        return {
          executionMode: "structural-sharing" as const,
          validateLifecycleState(state: Readonly<GameState>) {
            assertValidResearchLifecycleState(state, content);
          },
          clearDerivedState() {
            calculation = undefined;
          },
          run({ state }: StructuralSharingTickSystemContext): GameState {
            try {
              calculation = advanceResearchSystem(state, content);
              options.onResearchAdvance?.();
              const issues = validateFreshResearchAdvance(
                state,
                content,
                calculation.result,
                calculation.witness,
              );
              if (issues.length > 0) {
                throw new Error(`Invalid Research advancement result:\n${issues.join("\n")}`);
              }

              const candidate = applyResearchResult(state, calculation.result);
              assertValidContentAwareResearchState(candidate, content);
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
