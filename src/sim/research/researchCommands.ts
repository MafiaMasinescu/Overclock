import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type { GameState, ResearchNodeId } from "../core/types.ts";
import { addMicrodollars, microdollarsToUsd, usdToMicrodollars } from "../economy/money.ts";
import { assertValidInventoryEconomyState } from "../economy/inventoryEconomyState.ts";
import { assertValidStoredResearchState } from "./researchState.ts";

export type ResearchCommandHandlers = Pick<
  CommandHandlerRegistry,
  "START_RESEARCH" | "CANCEL_RESEARCH"
>;

const REJECTIONS = {
  alreadyActive: {
    code: "RESEARCH_ALREADY_ACTIVE",
    messageKey: "errors.research-already-active",
  },
  insufficientCash: {
    code: "INSUFFICIENT_CASH",
    messageKey: "errors.insufficient-cash",
  },
  insufficientResearchData: {
    code: "INSUFFICIENT_RESEARCH_DATA",
    messageKey: "errors.insufficient-research-data",
  },
  invalidSystem: {
    code: "INVALID_SYSTEM",
    messageKey: "errors.invalid-system",
  },
} as const satisfies Record<string, CommandHandlerRejection>;

function researchNotAvailable(reason?: string): CommandHandlerRejection {
  return {
    code: "RESEARCH_NOT_AVAILABLE",
    messageKey: "errors.research-not-available",
    ...(reason === undefined ? {} : { parameters: { reason } }),
  };
}

function resolveResearchNode(
  content: ContentBundle,
  nodeId: ResearchNodeId,
): ContentBundle["research"][string] | undefined {
  return content.research[nodeId];
}

function hasRequiredEvidence(
  evidenceTags: readonly string[],
  requiredEvidenceTags: readonly string[],
): boolean {
  return requiredEvidenceTags.every((evidenceTag) => evidenceTags.includes(evidenceTag));
}

function hasPassingBenchmark(state: Readonly<GameState>, benchmarkId: string): boolean {
  const runId = state.benchmarks.bestRunByBenchmark[benchmarkId];
  if (runId === undefined) return false;

  let matchingRuns = 0;
  let matchingRun: GameState["benchmarks"]["history"][number] | undefined;
  for (const run of state.benchmarks.history) {
    if (run.runId !== runId) continue;
    matchingRuns += 1;
    matchingRun = run;
  }
  return matchingRuns === 1 && matchingRun?.benchmarkId === benchmarkId && matchingRun.passed;
}

function hasRequiredBenchmarks(
  state: Readonly<GameState>,
  requiredBenchmarkIds: readonly string[],
): boolean {
  return requiredBenchmarkIds.every((benchmarkId) => hasPassingBenchmark(state, benchmarkId));
}

function validateStartRequirements(
  state: Readonly<GameState>,
  content: ContentBundle,
  nodeId: ResearchNodeId,
  reservedComputeShare: number,
): ContentBundle["research"][string] | CommandHandlerRejection {
  const node = resolveResearchNode(content, nodeId);
  if (node === undefined) return researchNotAvailable("unknown-node");

  const status = state.research.statuses[nodeId];
  if (status === "completed") return researchNotAvailable("completed");
  if (status === "locked") return researchNotAvailable("locked");
  if (status === "active") return researchNotAvailable("active");
  if (status !== "available" && status !== "cancelled") {
    return researchNotAvailable("status");
  }

  if (
    !node.prerequisites.every(
      (prerequisiteId) => state.research.statuses[prerequisiteId] === "completed",
    )
  ) {
    return researchNotAvailable("prerequisite");
  }
  if (!hasRequiredEvidence(state.research.evidenceTags, node.requiredEvidenceTags)) {
    return researchNotAvailable("evidence-tag");
  }
  if (!hasRequiredBenchmarks(state, node.requiredBenchmarkIds)) {
    return researchNotAvailable("benchmark");
  }
  if (
    !Number.isFinite(reservedComputeShare) ||
    Object.is(reservedComputeShare, -0) ||
    reservedComputeShare < node.minimumComputeShare ||
    reservedComputeShare > 1
  ) {
    return researchNotAvailable("compute-share");
  }
  return node;
}

function applyStart(
  state: GameState,
  node: NonNullable<ReturnType<typeof resolveResearchNode>>,
  reservedComputeShare: number,
): undefined | CommandHandlerRejection {
  try {
    const cashCostMicrodollars = usdToMicrodollars(node.cashCostUsd);
    const cashMicrodollars = usdToMicrodollars(state.economy.cashUsd);
    const creditLimitMicrodollars = usdToMicrodollars(state.economy.creditLimitUsd);
    const nextCashMicrodollars = addMicrodollars(cashMicrodollars, -cashCostMicrodollars);
    if (nextCashMicrodollars < -creditLimitMicrodollars) {
      return REJECTIONS.insufficientCash;
    }
    if (state.research.researchData < node.researchDataCost) {
      return REJECTIONS.insufficientResearchData;
    }

    const nextTotalExpenseMicrodollars = addMicrodollars(
      usdToMicrodollars(state.economy.totalExpenseUsd),
      cashCostMicrodollars,
    );
    const nextResearchData = state.research.researchData - node.researchDataCost;
    if (!Number.isFinite(nextResearchData) || nextResearchData < 0) {
      return REJECTIONS.invalidSystem;
    }

    state.economy.cashUsd = microdollarsToUsd(nextCashMicrodollars);
    state.economy.totalExpenseUsd = microdollarsToUsd(nextTotalExpenseMicrodollars);
    state.research = {
      ...state.research,
      researchData: nextResearchData === 0 ? 0 : nextResearchData,
      statuses: { ...state.research.statuses, [node.id]: "active" },
      active: {
        nodeId: node.id,
        startedAtTick: state.tick,
        completedOperations: 0,
        reservedComputeShare,
      },
    };
    return;
  } catch (error: unknown) {
    if (error instanceof RangeError) return REJECTIONS.invalidSystem;
    throw error;
  }
}

export function createResearchCommandHandlers(content: ContentBundle): ResearchCommandHandlers {
  return Object.freeze({
    START_RESEARCH({ state }, command) {
      assertValidInventoryEconomyState(state);
      assertValidStoredResearchState(state);
      if (state.research.active !== null) return REJECTIONS.alreadyActive;

      const requirement = validateStartRequirements(
        state,
        content,
        command.nodeId,
        command.reservedComputeShare,
      );
      if ("code" in requirement) return requirement;

      return applyStart(state, requirement, command.reservedComputeShare);
    },

    CANCEL_RESEARCH({ state }, command) {
      assertValidInventoryEconomyState(state);
      assertValidStoredResearchState(state);
      const active = state.research.active;
      if (active === null) return researchNotAvailable();
      if (command.nodeId !== active.nodeId || state.research.statuses[active.nodeId] !== "active") {
        return researchNotAvailable();
      }

      state.research = {
        ...state.research,
        statuses: { ...state.research.statuses, [active.nodeId]: "cancelled" },
        active: null,
      };
    },
  });
}
