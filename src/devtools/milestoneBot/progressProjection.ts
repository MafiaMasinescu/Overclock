import type { JsonObject, GameState } from "../../sim/core/types.ts";
import { hashCanonicalState } from "../../sim/replay/canonicalState.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";

export interface HardLockProgressAnchor {
  readonly tick: number;
  readonly hash: string;
}

export interface HardLockProgressInterval {
  readonly beforeTick: number;
  readonly beforeHash: string;
  readonly afterTick: number;
  readonly afterHash: string;
}

export function updateHardLockProgressAnchor(
  previous: HardLockProgressAnchor | null,
  interval: HardLockProgressInterval,
): HardLockProgressAnchor {
  if (interval.afterHash !== interval.beforeHash) {
    return Object.freeze({ tick: interval.afterTick, hash: interval.afterHash });
  }
  if (previous?.hash === interval.afterHash) return previous;
  return Object.freeze({ tick: interval.beforeTick, hash: interval.afterHash });
}

export function createProgressProjection(
  state: Readonly<GameState>,
  appliedTemplateIds: readonly string[],
): JsonObject {
  const taskInstances = Object.values(state.tasks.instances)
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((task) => ({
      id: task.id,
      definitionId: task.definitionId,
      status: task.status,
      phase: task.currentPhaseIndex,
      phaseCompletedOperations: task.phaseCompletedOperations,
      totalCompletedOperations: task.totalCompletedOperations,
      deadlineTick: task.deadlineTick,
      serviceWindowCompliant: task.serviceWindowCompliant,
      allocation:
        task.allocation === null
          ? null
          : {
              clusterModuleIds: [...task.allocation.clusterModuleIds],
              requestedShare: task.allocation.requestedShare,
            },
    }));
  const modules = Object.values(state.facility.modules)
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((module) => ({
      id: module.id,
      definitionId: module.definitionId,
      operationalState: module.operationalState,
      startupTicksRemaining: module.startupTicksRemaining,
      cooldownTicksRemaining: module.cooldownTicksRemaining,
      overclock: module.overclock,
    }));
  const projection = {
    campaign: {
      currentYear: state.campaign.currentYear,
      transistorRevealed: state.campaign.transistorRevealed,
      verticalSliceCompleted: state.campaign.verticalSliceCompleted,
      reputation: state.campaign.reputation,
    },
    economy: {
      cashUsd: state.economy.cashUsd,
      totalIncomeUsd: state.economy.totalIncomeUsd,
      totalExpenseUsd: state.economy.totalExpenseUsd,
    },
    research: {
      researchData: state.research.researchData,
      statuses: { ...state.research.statuses },
      active:
        state.research.active === null
          ? null
          : {
              nodeId: state.research.active.nodeId,
              completedOperations: state.research.active.completedOperations,
              reservedComputeShare: state.research.active.reservedComputeShare,
            },
      evidenceTags: [...state.research.evidenceTags],
    },
    tasks: {
      offers: [...state.tasks.offers],
      instances: taskInstances,
    },
    benchmarks: {
      active:
        state.benchmarks.active === null
          ? null
          : {
              runId: state.benchmarks.active.runId,
              benchmarkId: state.benchmarks.active.benchmarkId,
              elapsedTicks: state.benchmarks.active.elapsedTicks,
              accumulatedUsefulComputeFlops: state.benchmarks.active.accumulatedUsefulComputeFlops,
            },
      history: state.benchmarks.history,
      bestRunByBenchmark: { ...state.benchmarks.bestRunByBenchmark },
    },
    blueprints: {
      ids: Object.keys(state.blueprints.records).toSorted(),
    },
    facility: {
      liveLayoutRevision: state.facility.liveLayoutRevision,
      modules,
    },
    appliedTemplateIds: [...appliedTemplateIds],
  } as unknown as JsonObject;
  return detachAndFreezeReplayData(projection);
}

export function hashProgressProjection(projection: JsonObject): string {
  return hashCanonicalState(projection);
}

export function progressFingerprint(
  state: Readonly<GameState>,
  appliedTemplateIds: readonly string[],
): string {
  return hashProgressProjection(createProgressProjection(state, appliedTemplateIds));
}
