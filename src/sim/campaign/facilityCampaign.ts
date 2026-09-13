import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import {
  assertValidCampaignState,
  calculateCampaignYearForCompletedTick,
} from "./campaignDomain.ts";
import type { GameState } from "../core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  StructuralSharingTickSystemRuntime,
  TickSystemRegistry,
} from "../core/tickSystems.ts";

function runCampaignTick(state: Readonly<GameState>, content: ContentBundle): GameState {
  const completedTick = state.tick + 1;
  const nextYear = calculateCampaignYearForCompletedTick(
    state.campaign.currentYear,
    completedTick,
    content,
  );
  if (nextYear === state.campaign.currentYear) return state;

  return {
    ...state,
    campaign: {
      ...state.campaign,
      currentYear: nextYear,
    },
  };
}

function createCampaignRuntime(content: ContentBundle): StructuralSharingTickSystemRuntime {
  return {
    executionMode: "structural-sharing" as const,
    run({ state }: StructuralSharingTickSystemContext): GameState {
      return runCampaignTick(state, content);
    },
    validateLifecycleState(state: Readonly<GameState>): void {
      assertValidCampaignState(state.campaign, content);
    },
  };
}

export function createCampaignTickSystems(content: ContentBundle): TickSystemRegistry {
  return Object.freeze({
    "update-tutorial-achievements-and-campaign": {
      createRuntime() {
        return createCampaignRuntime(content);
      },
    },
  });
}
