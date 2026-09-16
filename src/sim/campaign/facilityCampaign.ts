import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import {
  assertTrustedCampaignTimelineCoherent,
  assertValidCampaignBranchStructure,
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
  assertTrustedCampaignTimelineCoherent(state, content);
  const nextYear = calculateCampaignYearForCompletedTick(completedTick, content);
  if (nextYear === state.campaign.currentYear) return state;

  const candidate = {
    ...state,
    campaign: {
      ...state.campaign,
      currentYear: nextYear,
    },
  };
  assertValidCampaignBranchStructure(candidate.campaign, content);
  if (candidate.campaign.currentYear !== nextYear) {
    throw new Error("Campaign output does not match the prospective completed tick.");
  }
  return candidate;
}

function createCampaignRuntime(content: ContentBundle): StructuralSharingTickSystemRuntime {
  return {
    executionMode: "structural-sharing" as const,
    run({ state }: StructuralSharingTickSystemContext): GameState {
      return runCampaignTick(state, content);
    },
    validateLifecycleState(state: Readonly<GameState>): void {
      assertValidCampaignBranchStructure(state.campaign, content);
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
