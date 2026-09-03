import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import { isFeatureUnlocked } from "../research/researchDomain.ts";
import type { GameState, ModuleInstanceId, OverclockSettings } from "../core/types.ts";
import { assertValidStoredBenchmarkState, formatBenchmarkRunId } from "./benchmarkState.ts";

export type BenchmarkCommandHandlers = Pick<
  CommandHandlerRegistry,
  "START_BENCHMARK" | "CANCEL_BENCHMARK"
>;

const REJECTIONS = {
  alreadyActive: {
    code: "BENCHMARK_ALREADY_ACTIVE",
    messageKey: "errors.benchmark-already-active",
  },
  notActive: {
    code: "BENCHMARK_NOT_ACTIVE",
    messageKey: "errors.benchmark-not-active",
  },
  invalidSystem: {
    code: "INVALID_SYSTEM",
    messageKey: "errors.invalid-system",
  },
} as const satisfies Record<string, CommandHandlerRejection>;

function requirementMissing(reason: string): CommandHandlerRejection {
  return {
    code: "BENCHMARK_REQUIREMENT_MISSING",
    messageKey: "errors.benchmark-requirement-missing",
    parameters: { reason },
  };
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function resolveBenchmark(
  content: ContentBundle,
  benchmarkId: string,
): ContentBundle["era"]["benchmarkDefinitions"][number] | undefined {
  return content.era.benchmarkDefinitions.find((definition) => definition.id === benchmarkId);
}

function validateCluster(
  state: Readonly<GameState>,
  content: ContentBundle,
  requestedCluster: readonly ModuleInstanceId[],
): readonly ModuleInstanceId[] | CommandHandlerRejection {
  if (requestedCluster.length === 0) return requirementMissing("empty-cluster");

  const clusterModuleIds = [...requestedCluster].toSorted(compareStableStrings);
  for (let index = 1; index < clusterModuleIds.length; index += 1) {
    if (clusterModuleIds[index - 1] === clusterModuleIds[index]) {
      return requirementMissing("duplicate-module");
    }
  }

  for (const moduleId of clusterModuleIds) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) return requirementMissing("missing-module");
    const definition = content.modules[module.definitionId];
    if (definition === undefined || definition.baseComputeFlops <= 0) {
      return requirementMissing("non-compute-module");
    }
  }
  return clusterModuleIds;
}

function captureOverclockSummary(
  state: Readonly<GameState>,
  clusterModuleIds: readonly ModuleInstanceId[],
): Record<ModuleInstanceId, OverclockSettings> {
  const summary: Record<ModuleInstanceId, OverclockSettings> = {};
  for (const moduleId of clusterModuleIds) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) throw new Error(`Validated Benchmark module ${moduleId} is missing.`);
    summary[moduleId] = { ...module.overclock };
  }
  return summary;
}

function allocateRunId(
  state: Readonly<GameState>,
): { readonly sequence: number; readonly runId: string } | CommandHandlerRejection {
  const sequence = state.benchmarks.nextBenchmarkRunSequence;
  if (!isPositiveSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) {
    return REJECTIONS.invalidSystem;
  }

  let runId: string;
  try {
    runId = formatBenchmarkRunId(sequence);
  } catch (error: unknown) {
    if (error instanceof RangeError) return REJECTIONS.invalidSystem;
    throw error;
  }

  if (
    state.benchmarks.active?.runId === runId ||
    state.benchmarks.history.some((result) => result.runId === runId)
  ) {
    return REJECTIONS.invalidSystem;
  }
  return { sequence, runId };
}

function hasActiveTask(state: Readonly<GameState>): boolean {
  return Object.values(state.tasks.instances).some((task) => task.status === "active");
}

export function createBenchmarkCommandHandlers(content: ContentBundle): BenchmarkCommandHandlers {
  return Object.freeze({
    START_BENCHMARK({ state }, command) {
      // This is intentionally before every recoverable branch: invalid authoritative state is fatal.
      assertValidStoredBenchmarkState(state);
      if (state.benchmarks.active !== null) return REJECTIONS.alreadyActive;

      const definition = resolveBenchmark(content, command.benchmarkId);
      if (definition === undefined) return requirementMissing("unknown-definition");
      if (
        definition.requiredFeatureIds.some(
          (featureId) => !isFeatureUnlocked(featureId, state.research, content),
        )
      ) {
        return requirementMissing("feature-locked");
      }
      if (state.research.active !== null) return requirementMissing("active-research");
      if (hasActiveTask(state)) return requirementMissing("active-task");

      const cluster = validateCluster(state, content, command.clusterModuleIds);
      if ("code" in cluster) return cluster;

      const allocation = allocateRunId(state);
      if ("code" in allocation) return allocation;

      state.benchmarks = {
        ...state.benchmarks,
        nextBenchmarkRunSequence: allocation.sequence + 1,
        active: {
          runId: allocation.runId,
          benchmarkId: definition.id,
          startedAtTick: state.tick,
          elapsedTicks: 0,
          clusterModuleIds: [...cluster],
          accumulatedUsefulComputeFlops: 0,
          peakUsefulComputeFlops: 0,
          accumulatedPowerWatts: 0,
          peakPowerWatts: 0,
          maxTemperatureC: null,
          minimumPowerHeadroomWatts: null,
          accumulatedRetryRate: 0,
          accumulatedValidSampleRate: 0,
          accumulatedCostUsd: 0,
          shutdownObserved: false,
          overclockSummary: captureOverclockSummary(state, cluster),
        },
      };
    },

    CANCEL_BENCHMARK({ state }) {
      assertValidStoredBenchmarkState(state);
      if (state.benchmarks.active === null) return REJECTIONS.notActive;
      state.benchmarks = { ...state.benchmarks, active: null };
    },
  });
}
