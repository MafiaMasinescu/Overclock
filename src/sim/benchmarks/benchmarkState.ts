import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { isMicrodollarAlignedUsd } from "../economy/money.ts";
import { selectBestBenchmarkRun } from "./benchmarkDomain.ts";
import type {
  ActiveBenchmarkState,
  BenchmarkFailureReason,
  BenchmarkResult,
  BenchmarkState,
  GameState,
  OverclockProfile,
  OverclockSettings,
} from "../core/types.ts";

export interface BenchmarkStateIssue {
  readonly path: string;
  readonly message: string;
}

const BENCHMARK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BENCHMARK_RUN_ID_PATTERN = /^benchmark-run-(\d{8,})$/;
const MODULE_INSTANCE_ID_PATTERN = /^module-instance-(\d{8,})$/;
const OVERCLOCK_PROFILES: readonly OverclockProfile[] = ["eco", "balanced", "boost", "manual"];
const FAILURE_REASONS: readonly BenchmarkFailureReason[] = [
  "average-compute",
  "valid-sample-rate",
  "retry-rate",
  "maximum-temperature",
  "shutdown",
];

function pushIf(
  issues: BenchmarkStateIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && !Object.is(value, -0);
}

function isUnitRate(value: number): boolean {
  return isFiniteNonnegative(value) && value <= 1;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasStableDistinctOrder(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function parseBenchmarkRunSequence(runId: string): number | null {
  const match = BENCHMARK_RUN_ID_PATTERN.exec(runId);
  if (match?.[1] === undefined) return null;
  const sequence = Number(match[1]);
  return isPositiveSafeInteger(sequence) && formatBenchmarkRunId(sequence) === runId
    ? sequence
    : null;
}

export function formatBenchmarkRunId(sequence: number): string {
  if (!isPositiveSafeInteger(sequence)) {
    throw new RangeError("Benchmark run sequence must be a positive safe integer.");
  }
  return `benchmark-run-${String(sequence).padStart(8, "0")}`;
}

function validateOverclockSettings(
  settings: Readonly<OverclockSettings>,
  path: string,
  issues: BenchmarkStateIssue[],
): void {
  pushIf(
    issues,
    !OVERCLOCK_PROFILES.includes(settings.profile),
    `${path}.profile`,
    "must be a supported overclock profile",
  );
  pushIf(
    issues,
    !Number.isFinite(settings.frequencyRatio) || settings.frequencyRatio <= 0,
    `${path}.frequencyRatio`,
    "must be finite and strictly positive",
  );
  pushIf(
    issues,
    !Number.isFinite(settings.voltageRatio) || settings.voltageRatio <= 0,
    `${path}.voltageRatio`,
    "must be finite and strictly positive",
  );
}

function validateOverclockSummary(
  summary: Readonly<Record<string, OverclockSettings>>,
  path: string,
  issues: BenchmarkStateIssue[],
): void {
  const keys = Object.keys(summary);
  pushIf(
    issues,
    !hasStableDistinctOrder(keys),
    path,
    "keys must be unique and in stable lexical order",
  );
  for (const moduleId of keys) {
    pushIf(
      issues,
      !MODULE_INSTANCE_ID_PATTERN.test(moduleId),
      `${path}.${moduleId}`,
      "must use the canonical module instance ID format",
    );
    const settings = summary[moduleId];
    if (settings !== undefined) validateOverclockSettings(settings, `${path}.${moduleId}`, issues);
  }
}

function validateFailureReasons(
  reasons: readonly BenchmarkFailureReason[],
  path: string,
  issues: BenchmarkStateIssue[],
): void {
  let previousIndex = -1;
  for (const reason of reasons) {
    const reasonIndex = FAILURE_REASONS.indexOf(reason);
    pushIf(issues, reasonIndex < 0, path, "must contain only contract failure reasons");
    pushIf(
      issues,
      reasonIndex <= previousIndex,
      path,
      "must be unique and use fixed contract order",
    );
    previousIndex = reasonIndex;
  }
}

function validateClusterIds(
  clusterModuleIds: readonly string[],
  path: string,
  issues: BenchmarkStateIssue[],
): void {
  pushIf(
    issues,
    clusterModuleIds.length === 0 || !hasStableDistinctOrder(clusterModuleIds),
    path,
    "must contain stable-sorted distinct module instance IDs",
  );
  for (const moduleId of clusterModuleIds) {
    pushIf(
      issues,
      !MODULE_INSTANCE_ID_PATTERN.test(moduleId),
      `${path}.${moduleId}`,
      "must use the canonical module instance ID format",
    );
  }
}

function validateNumericResult(
  result: Readonly<BenchmarkResult>,
  path: string,
  issues: BenchmarkStateIssue[],
): void {
  for (const [field, value] of [
    ["averageUsefulComputeFlops", result.averageUsefulComputeFlops],
    ["peakUsefulComputeFlops", result.peakUsefulComputeFlops],
    ["peakPowerWatts", result.peakPowerWatts],
    ["averagePowerWatts", result.averagePowerWatts],
    ["costUsd", result.costUsd],
  ] as const) {
    pushIf(
      issues,
      !isFiniteNonnegative(value),
      `${path}.${field}`,
      "must be finite and nonnegative",
    );
  }
  pushIf(
    issues,
    !isFiniteNumber(result.maxTemperatureC),
    `${path}.maxTemperatureC`,
    "must be finite",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.minimumPowerHeadroomWatts),
    `${path}.minimumPowerHeadroomWatts`,
    "must be finite and nonnegative",
  );
  for (const [field, value] of [
    ["retryRate", result.retryRate],
    ["validSampleRate", result.validSampleRate],
  ] as const) {
    pushIf(issues, !isUnitRate(value), `${path}.${field}`, "must be finite and in [0, 1]");
  }
  pushIf(
    issues,
    !isMicrodollarAlignedUsd(result.costUsd),
    `${path}.costUsd`,
    "must be exactly microdollar-aligned",
  );
}

function validateResult(
  result: Readonly<BenchmarkResult>,
  index: number,
  issues: BenchmarkStateIssue[],
): number | null {
  const path = `benchmarks.history[${index}]`;
  pushIf(
    issues,
    !BENCHMARK_ID_PATTERN.test(result.benchmarkId),
    `${path}.benchmarkId`,
    "must be a valid benchmark ID",
  );
  const sequence = parseBenchmarkRunSequence(result.runId);
  pushIf(
    issues,
    sequence === null,
    `${path}.runId`,
    "must use the canonical benchmark run ID format",
  );
  pushIf(
    issues,
    !isNonnegativeSafeInteger(result.startedAtTick),
    `${path}.startedAtTick`,
    "must be a nonnegative safe integer",
  );
  pushIf(
    issues,
    !isPositiveSafeInteger(result.durationTicks),
    `${path}.durationTicks`,
    "must be a positive safe integer",
  );
  pushIf(issues, typeof result.passed !== "boolean", `${path}.passed`, "must be boolean");
  pushIf(
    issues,
    typeof result.shutdownObserved !== "boolean",
    `${path}.shutdownObserved`,
    "must be boolean",
  );
  validateClusterIds(result.clusterModuleIds, `${path}.clusterModuleIds`, issues);
  validateNumericResult(result, path, issues);
  validateFailureReasons(result.failureReasons, `${path}.failureReasons`, issues);
  pushIf(
    issues,
    result.passed !== (result.failureReasons.length === 0),
    `${path}.passed`,
    "must be true exactly when failureReasons is empty",
  );
  validateOverclockSummary(result.overclockSummary, `${path}.overclockSummary`, issues);
  return sequence;
}

function validateActive(
  active: Readonly<ActiveBenchmarkState>,
  state: Readonly<GameState>,
  issues: BenchmarkStateIssue[],
): number | null {
  const path = "benchmarks.active";
  const sequence = parseBenchmarkRunSequence(active.runId);
  pushIf(
    issues,
    sequence === null,
    `${path}.runId`,
    "must use the canonical benchmark run ID format",
  );
  pushIf(
    issues,
    !BENCHMARK_ID_PATTERN.test(active.benchmarkId),
    `${path}.benchmarkId`,
    "must be a valid benchmark ID",
  );
  pushIf(
    issues,
    !isNonnegativeSafeInteger(active.startedAtTick) || active.startedAtTick > state.tick,
    `${path}.startedAtTick`,
    "must be a nonnegative safe integer no greater than the state tick",
  );
  pushIf(
    issues,
    !isNonnegativeSafeInteger(active.elapsedTicks),
    `${path}.elapsedTicks`,
    "must be a nonnegative safe integer",
  );
  validateClusterIds(active.clusterModuleIds, `${path}.clusterModuleIds`, issues);
  for (const [field, value] of [
    ["accumulatedUsefulComputeFlops", active.accumulatedUsefulComputeFlops],
    ["peakUsefulComputeFlops", active.peakUsefulComputeFlops],
    ["accumulatedPowerWatts", active.accumulatedPowerWatts],
    ["peakPowerWatts", active.peakPowerWatts],
  ] as const) {
    pushIf(
      issues,
      !isFiniteNonnegative(value),
      `${path}.${field}`,
      "must be finite and nonnegative",
    );
  }
  for (const [field, value] of [
    ["accumulatedRetryRate", active.accumulatedRetryRate],
    ["accumulatedValidSampleRate", active.accumulatedValidSampleRate],
  ] as const) {
    pushIf(
      issues,
      !isFiniteNonnegative(value),
      `${path}.${field}`,
      "must be finite and nonnegative",
    );
  }
  pushIf(
    issues,
    !isFiniteNonnegative(active.accumulatedCostUsd) ||
      !isMicrodollarAlignedUsd(active.accumulatedCostUsd),
    `${path}.accumulatedCostUsd`,
    "must be a finite nonnegative microdollar-aligned USD value",
  );
  pushIf(
    issues,
    typeof active.shutdownObserved !== "boolean",
    `${path}.shutdownObserved`,
    "must be boolean",
  );
  pushIf(
    issues,
    active.accumulatedRetryRate > active.elapsedTicks ||
      active.accumulatedValidSampleRate > active.elapsedTicks,
    path,
    "accumulated rates must not exceed the number of samples",
  );
  const sampled = active.elapsedTicks > 0;
  pushIf(
    issues,
    sampled
      ? active.maxTemperatureC === null || active.minimumPowerHeadroomWatts === null
      : active.maxTemperatureC !== null || active.minimumPowerHeadroomWatts !== null,
    path,
    sampled
      ? "sampled nullable extrema must both be finite after the first sample"
      : "nullable extrema must both be null before the first sample",
  );
  if (active.maxTemperatureC !== null) {
    pushIf(
      issues,
      !isFiniteNumber(active.maxTemperatureC),
      `${path}.maxTemperatureC`,
      "must be finite or null",
    );
  }
  if (active.minimumPowerHeadroomWatts !== null) {
    pushIf(
      issues,
      !isFiniteNonnegative(active.minimumPowerHeadroomWatts),
      `${path}.minimumPowerHeadroomWatts`,
      "must be finite and nonnegative or null",
    );
  }
  if (!sampled) {
    for (const [field, value] of [
      ["accumulatedUsefulComputeFlops", active.accumulatedUsefulComputeFlops],
      ["peakUsefulComputeFlops", active.peakUsefulComputeFlops],
      ["accumulatedPowerWatts", active.accumulatedPowerWatts],
      ["peakPowerWatts", active.peakPowerWatts],
      ["accumulatedRetryRate", active.accumulatedRetryRate],
      ["accumulatedValidSampleRate", active.accumulatedValidSampleRate],
      ["accumulatedCostUsd", active.accumulatedCostUsd],
    ] as const) {
      pushIf(issues, value !== 0, `${path}.${field}`, "must be zero before the first sample");
    }
  }
  validateOverclockSummary(active.overclockSummary, `${path}.overclockSummary`, issues);
  return sequence;
}

export function validateStoredBenchmarkState(state: Readonly<GameState>): BenchmarkStateIssue[] {
  const issues: BenchmarkStateIssue[] = [];
  const benchmarks: Readonly<BenchmarkState> = state.benchmarks;
  pushIf(
    issues,
    !isPositiveSafeInteger(benchmarks.nextBenchmarkRunSequence),
    "benchmarks.nextBenchmarkRunSequence",
    "must be a positive safe integer",
  );
  const usedSequences = new Set<number>();
  let maximumSequence = 0;
  if (benchmarks.active !== null) {
    const sequence = validateActive(benchmarks.active, state, issues);
    if (sequence !== null) {
      pushIf(
        issues,
        usedSequences.has(sequence),
        "benchmarks.active.runId",
        "must not reuse a run sequence",
      );
      usedSequences.add(sequence);
      maximumSequence = Math.max(maximumSequence, sequence);
    }
  }
  const historyRunIds = new Set<string>();
  for (let index = 0; index < benchmarks.history.length; index += 1) {
    const result = benchmarks.history[index];
    if (result === undefined) continue;
    pushIf(
      issues,
      historyRunIds.has(result.runId),
      `benchmarks.history[${index}].runId`,
      "must be unique",
    );
    historyRunIds.add(result.runId);
    const sequence = validateResult(result, index, issues);
    if (sequence !== null) {
      pushIf(
        issues,
        usedSequences.has(sequence),
        `benchmarks.history[${index}].runId`,
        "must not reuse a run sequence",
      );
      usedSequences.add(sequence);
      maximumSequence = Math.max(maximumSequence, sequence);
    }
    pushIf(
      issues,
      benchmarks.active?.runId === result.runId,
      `benchmarks.history[${index}].runId`,
      "cancelled or active runs must not appear as partial history entries",
    );
  }
  const bestKeys = Object.keys(benchmarks.bestRunByBenchmark);
  pushIf(
    issues,
    !hasStableDistinctOrder(bestKeys),
    "benchmarks.bestRunByBenchmark",
    "keys must be unique and in stable lexical order",
  );
  for (const benchmarkId of bestKeys) {
    const runId = benchmarks.bestRunByBenchmark[benchmarkId];
    pushIf(
      issues,
      !BENCHMARK_ID_PATTERN.test(benchmarkId),
      `benchmarks.bestRunByBenchmark.${benchmarkId}`,
      "must use a valid benchmark ID",
    );
    const matching = benchmarks.history.filter((result) => result.runId === runId);
    const exactPassedMatch =
      matching.length === 1 &&
      matching.at(0)?.benchmarkId === benchmarkId &&
      matching.at(0)?.passed === true;
    pushIf(
      issues,
      !exactPassedMatch,
      `benchmarks.bestRunByBenchmark.${benchmarkId}`,
      "must resolve to exactly one passed history result with the matching benchmark ID",
    );
  }
  pushIf(
    issues,
    isPositiveSafeInteger(benchmarks.nextBenchmarkRunSequence) &&
      benchmarks.nextBenchmarkRunSequence <= maximumSequence,
    "benchmarks.nextBenchmarkRunSequence",
    "must exceed every active and historical run sequence",
  );
  return issues;
}

function appendContentAwareActiveIssues(
  state: Readonly<GameState>,
  content: ContentBundle,
  issues: BenchmarkStateIssue[],
): void {
  const active = state.benchmarks.active;
  if (active === null) return;

  const benchmark = content.era.benchmarkDefinitions.find(({ id }) => id === active.benchmarkId);
  if (benchmark === undefined) {
    issues.push({
      path: "benchmarks.active.benchmarkId",
      message: "must reference a known benchmark definition",
    });
  } else {
    const durationTicks = benchmark.durationSeconds * 10;
    pushIf(
      issues,
      !Number.isSafeInteger(durationTicks) || active.elapsedTicks >= durationTicks,
      "benchmarks.active.elapsedTicks",
      "must be compatible with the active benchmark duration",
    );
    const providerIds = Object.values(content.research)
      .filter((node) =>
        node.unlockFeatureIds.some((featureId) => benchmark.requiredFeatureIds.includes(featureId)),
      )
      .map((node) => node.id);
    for (const featureId of benchmark.requiredFeatureIds) {
      const unlocked = providerIds.some((nodeId) => {
        const provider = content.research[nodeId];
        return (
          provider !== undefined &&
          state.research.statuses[nodeId] === "completed" &&
          provider.unlockFeatureIds.includes(featureId)
        );
      });
      pushIf(
        issues,
        !unlocked,
        "benchmarks.active.benchmarkId",
        `required feature ${featureId} must be unlocked`,
      );
    }
  }

  const activeCluster = active.clusterModuleIds;
  for (const moduleId of activeCluster) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) {
      issues.push({
        path: "benchmarks.active.clusterModuleIds",
        message: `must reference existing live module ${moduleId}`,
      });
      continue;
    }
    const definition = content.modules[module.definitionId];
    pushIf(
      issues,
      definition === undefined || definition.baseComputeFlops <= 0,
      `benchmarks.active.clusterModuleIds.${moduleId}`,
      "must reference a currently compute-capable module",
    );
    const capturedSettings: OverclockSettings | undefined = Object.hasOwn(
      active.overclockSummary,
      moduleId,
    )
      ? (active.overclockSummary as Partial<Record<string, OverclockSettings>>)[moduleId]
      : undefined;
    const capturedMatches =
      capturedSettings?.profile === module.overclock.profile &&
      capturedSettings.frequencyRatio === module.overclock.frequencyRatio &&
      capturedSettings.voltageRatio === module.overclock.voltageRatio;
    pushIf(
      issues,
      !capturedMatches,
      `benchmarks.active.overclockSummary.${moduleId}`,
      "must equal the current requested overclock settings while active",
    );
  }
  const summaryKeys = Object.keys(active.overclockSummary);
  pushIf(
    issues,
    summaryKeys.join("\u0000") !== activeCluster.join("\u0000"),
    "benchmarks.active.overclockSummary",
    "must cover the selected cluster exactly once in stable order",
  );
  for (const [taskId, task] of Object.entries(state.tasks.instances)) {
    pushIf(
      issues,
      task.status === "active",
      `tasks.instances.${taskId}.status`,
      "no Task may be active while a benchmark is active",
    );
  }
  pushIf(
    issues,
    state.research.active !== null,
    "research.active",
    "Research must not be active while a benchmark is active",
  );
}

export function validateContentAwareActiveBenchmarkState(
  state: Readonly<GameState>,
  content: ContentBundle,
): BenchmarkStateIssue[] {
  const issues: BenchmarkStateIssue[] = [];
  if (state.benchmarks.active !== null) validateActive(state.benchmarks.active, state, issues);
  appendContentAwareActiveIssues(state, content, issues);
  return issues;
}

export function validateContentAwareBenchmarkState(
  state: Readonly<GameState>,
  content: ContentBundle,
): BenchmarkStateIssue[] {
  const issues = validateStoredBenchmarkState(state);
  const contentBenchmarkIds = new Set(content.era.benchmarkDefinitions.map(({ id }) => id));
  for (const benchmarkId of Object.keys(state.benchmarks.bestRunByBenchmark)) {
    pushIf(
      issues,
      !contentBenchmarkIds.has(benchmarkId),
      `benchmarks.bestRunByBenchmark.${benchmarkId}`,
      "must reference a known benchmark definition",
    );
  }
  if (issues.length === 0) {
    for (const benchmark of content.era.benchmarkDefinitions) {
      const expected = selectBestBenchmarkRun(state.benchmarks.history, benchmark);
      const actual = state.benchmarks.bestRunByBenchmark[benchmark.id];
      pushIf(
        issues,
        actual !== expected?.runId,
        `benchmarks.bestRunByBenchmark.${benchmark.id}`,
        "must be the exact best passed result under the benchmark comparator",
      );
    }
  }
  appendContentAwareActiveIssues(state, content, issues);
  return issues;
}

/** Validates only the active branch for warm production ticks; history is intentionally untouched. */
export function validateActiveBenchmarkState(state: Readonly<GameState>): BenchmarkStateIssue[] {
  const issues: BenchmarkStateIssue[] = [];
  if (state.benchmarks.active !== null) validateActive(state.benchmarks.active, state, issues);
  return issues;
}

export function assertValidStoredBenchmarkState(state: Readonly<GameState>): void {
  const issues = validateStoredBenchmarkState(state);
  if (issues.length > 0) {
    throw new Error(
      `Invalid benchmark state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

export function assertValidActiveBenchmarkState(state: Readonly<GameState>): void {
  const issues = validateActiveBenchmarkState(state);
  if (issues.length > 0) {
    throw new Error(
      `Invalid active benchmark state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

export function assertValidContentAwareBenchmarkState(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  const issues = validateContentAwareBenchmarkState(state, content);
  if (issues.length > 0) {
    throw new Error(
      `Invalid content-aware benchmark state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

export function assertValidContentAwareActiveBenchmarkState(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  const issues = validateContentAwareActiveBenchmarkState(state, content);
  if (issues.length > 0) {
    throw new Error(
      `Invalid content-aware active benchmark state:\n${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
}
