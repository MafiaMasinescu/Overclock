import type {
  BenchmarkDefinition,
  ContentBundle,
  DeepReadonly,
} from "../../content/schemas/contentSchemas.ts";
import {
  addMicrodollars,
  isMicrodollarAlignedUsd,
  microdollarsToUsd,
  usdToMicrodollars,
} from "../economy/money.ts";
import { canonicalSerialize } from "../replay/canonicalState.ts";
import type {
  ActiveBenchmarkState,
  BenchmarkFailureReason,
  BenchmarkResult,
  BenchmarkState,
  FacilityComputeState,
  GameState,
  ModuleComputeResultState,
  OverclockSettings,
} from "../core/types.ts";

const FAILURE_REASONS: readonly BenchmarkFailureReason[] = [
  "average-compute",
  "valid-sample-rate",
  "retry-rate",
  "maximum-temperature",
  "shutdown",
];

type BenchmarkResultNumberField =
  | "averageUsefulComputeFlops"
  | "peakUsefulComputeFlops"
  | "validSampleRate"
  | "retryRate"
  | "averagePowerWatts"
  | "minimumPowerHeadroomWatts"
  | "maxTemperatureC"
  | "costUsd"
  | "peakPowerWatts";

const PEAK_COMPARATOR: readonly [BenchmarkResultNumberField, "higher" | "lower"][] = [
  ["averageUsefulComputeFlops", "higher"],
  ["peakUsefulComputeFlops", "higher"],
  ["validSampleRate", "higher"],
  ["retryRate", "lower"],
  ["averagePowerWatts", "lower"],
  ["minimumPowerHeadroomWatts", "higher"],
  ["maxTemperatureC", "lower"],
  ["costUsd", "lower"],
];

const SUSTAINED_COMPARATOR: readonly [BenchmarkResultNumberField, "higher" | "lower"][] = [
  ["averageUsefulComputeFlops", "higher"],
  ["retryRate", "lower"],
  ["validSampleRate", "higher"],
  ["averagePowerWatts", "lower"],
  ["minimumPowerHeadroomWatts", "higher"],
  ["maxTemperatureC", "lower"],
  ["costUsd", "lower"],
  ["peakUsefulComputeFlops", "higher"],
];

export interface BenchmarkTickSample {
  readonly totalWeight: number;
  readonly sampleUsefulComputeFlops: number;
  readonly sampleRetryRate: number;
  readonly sampleInvalidRate: number;
  readonly sampleValidRate: number;
  readonly totalDeliveredPowerWatts: number;
  readonly headroomWatts: number;
  readonly energyCostUsdThisTick: number;
  readonly maxTemperatureC: number;
  readonly shutdownObserved: boolean;
}

export interface BenchmarkAdvancementResult {
  readonly benchmarks: BenchmarkState;
  readonly completedResult: BenchmarkResult | null;
}

export interface BenchmarkAdvanceWitness {
  readonly expected: Readonly<BenchmarkAdvancementResult>;
}

export interface BenchmarkAdvancementCalculation {
  readonly result: BenchmarkAdvancementResult;
  readonly witness: BenchmarkAdvanceWitness;
}

/** Private production evidence mode for a structurally owned candidate branch. */
export interface BenchmarkAdvanceOptions {
  readonly useStructuralInputEvidence?: boolean;
}

export interface BenchmarkComparison {
  readonly passed: boolean;
  readonly failureReasons: readonly BenchmarkFailureReason[];
}

interface BenchmarkWitnessInputs {
  readonly state: Readonly<GameState>;
  readonly content: ContentBundle;
  readonly benchmarks: Readonly<GameState["benchmarks"]>;
  readonly active: Readonly<ActiveBenchmarkState>;
  readonly facility: Readonly<GameState["facility"]>;
  readonly compute: Readonly<FacilityComputeState>;
  readonly power: Readonly<GameState["facility"]["power"]>;
  readonly thermalTiles: Readonly<GameState["facility"]["thermalTiles"]>;
  readonly modules: Readonly<GameState["facility"]["modules"]>;
  readonly tick: number;
  readonly inputFingerprint: string | undefined;
}

const witnessInputs = new WeakMap<BenchmarkAdvanceWitness, BenchmarkWitnessInputs>();
const deeplyFrozenObjects = new WeakSet<object>();
const stableRecordKeys = new WeakMap<object, readonly string[]>();
const validatedBenchmarkCoverage = new WeakMap<
  object,
  {
    readonly benchmarks: Readonly<BenchmarkState>;
    readonly modules: Readonly<GameState["facility"]["modules"]>;
    readonly compute: Readonly<FacilityComputeState>;
  }
>();
const validatedActiveAccumulators = new WeakSet<object>();
const validatedFacilities = new WeakSet<object>();
const validatedComputeResults = new WeakSet<object>();

function benchmarkInputFingerprint(
  active: Readonly<ActiveBenchmarkState>,
  state: Readonly<GameState>,
  content: ContentBundle,
): string {
  const definition = content.era.benchmarkDefinitions.find(({ id }) => id === active.benchmarkId);
  const moduleLifecycle = Object.keys(state.facility.modules)
    .toSorted()
    .map((moduleId) => ({
      moduleId,
      operationalState: state.facility.modules[moduleId]?.operationalState ?? null,
    }));
  const selectedCompute = active.clusterModuleIds.map((moduleId) => ({
    moduleId,
    result: state.facility.compute.byModule[moduleId] ?? null,
  }));
  return canonicalSerialize({
    active,
    definition,
    ...(isDeeplyFrozen(state.benchmarks)
      ? {}
      : {
          historicalBenchmarks: {
            history: state.benchmarks.history,
            bestRunByBenchmark: state.benchmarks.bestRunByBenchmark,
          },
        }),
    facility: {
      modules: moduleLifecycle,
      compute: selectedCompute,
      power: {
        totalDeliveredPowerWatts: state.facility.power.totalDeliveredPowerWatts,
        headroomWatts: state.facility.power.headroomWatts,
        energyCostUsdThisTick: state.facility.power.energyCostUsdThisTick,
      },
      thermalTiles: state.facility.thermalTiles,
    },
    tick: state.tick,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (deeplyFrozenObjects.has(value)) return value;
    if (!Object.isFrozen(value)) Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    deeplyFrozenObjects.add(value);
  }
  return value;
}

function benchmarkNeedsMutableInputFingerprint(
  active: Readonly<ActiveBenchmarkState>,
  state: Readonly<GameState>,
  options: BenchmarkAdvanceOptions,
): boolean {
  if (options.useStructuralInputEvidence === true) return false;
  return (
    !isDeeplyFrozen(active) || !isDeeplyFrozen(state.facility) || !isDeeplyFrozen(state.benchmarks)
  );
}

function stableKeys(record: Readonly<Record<string, unknown>>): readonly string[] {
  const cached = stableRecordKeys.get(record);
  if (cached !== undefined) return cached;
  const keys = Object.keys(record);
  if (isDeeplyFrozen(record)) stableRecordKeys.set(record, keys);
  return keys;
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function assertFiniteNonnegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

function assertUnitRate(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1 || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and in [0, 1].`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer.`);
  }
}

function addFinite(left: number, right: number, label: string): number {
  const result = left + right;
  assertFinite(result, label);
  return normalizeZero(result);
}

function hasStableDistinctOrder(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function assertStableCluster(clusterModuleIds: readonly string[], label: string): void {
  if (
    clusterModuleIds.length === 0 ||
    clusterModuleIds.some((moduleId) => moduleId.length === 0) ||
    !hasStableDistinctOrder(clusterModuleIds)
  ) {
    throw new RangeError(`${label} must be nonempty, unique, and lexically ordered.`);
  }
}

function cloneOverclockSummary(
  summary: Readonly<Record<string, OverclockSettings>>,
): Record<string, OverclockSettings> {
  const clone: Record<string, OverclockSettings> = {};
  for (const moduleId of Object.keys(summary)) {
    const settings = summary[moduleId];
    if (settings === undefined) throw new RangeError(`Missing overclock settings for ${moduleId}.`);
    clone[moduleId] = { ...settings };
  }
  return clone;
}

function cloneBenchmarkResult(result: Readonly<BenchmarkResult>): BenchmarkResult {
  return {
    ...result,
    clusterModuleIds: [...result.clusterModuleIds],
    failureReasons: [...result.failureReasons],
    overclockSummary: cloneOverclockSummary(result.overclockSummary),
  };
}

function cloneActiveBenchmark(active: Readonly<ActiveBenchmarkState>): ActiveBenchmarkState {
  return {
    ...active,
    clusterModuleIds: isDeeplyFrozen(active.clusterModuleIds)
      ? active.clusterModuleIds
      : [...active.clusterModuleIds],
    overclockSummary: isDeeplyFrozen(active.overclockSummary)
      ? active.overclockSummary
      : cloneOverclockSummary(active.overclockSummary),
  };
}

function isDeeplyFrozen(value: unknown, visited = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (deeplyFrozenObjects.has(value)) return true;
  if (visited.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  visited.add(value);
  const result = Object.values(value).every((child) => isDeeplyFrozen(child, visited));
  if (result) deeplyFrozenObjects.add(value);
  return result;
}

function stableHistory(history: readonly BenchmarkResult[]): BenchmarkResult[] {
  return isDeeplyFrozen(history)
    ? (history as BenchmarkResult[])
    : deepFreeze(history.map((result) => cloneBenchmarkResult(result)));
}

function stableRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(record).toSorted()) {
    const value = record[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function assertBenchmarkDefinition(definition: DeepReadonly<BenchmarkDefinition>): number {
  assertPositiveSafeInteger(definition.durationSeconds, "Benchmark durationSeconds");
  const durationTicks = definition.durationSeconds * 10;
  assertPositiveSafeInteger(durationTicks, "Benchmark duration ticks");
  assertFinite(definition.targetAverageUsefulComputeFlops, "Benchmark target Compute");
  if (definition.targetAverageUsefulComputeFlops <= 0) {
    throw new RangeError("Benchmark target Compute must be strictly positive.");
  }
  assertUnitRate(definition.minimumValidSampleRate, "Benchmark minimum valid sample rate");
  if (definition.minimumValidSampleRate === 0) {
    throw new RangeError("Benchmark minimum valid sample rate must be strictly positive.");
  }
  assertUnitRate(definition.maximumRetryRate, "Benchmark maximum retry rate");
  if (definition.maximumRetryRate >= 1) {
    throw new RangeError("Benchmark maximum retry rate must be strictly below one.");
  }
  assertFinite(definition.maximumTemperatureC, "Benchmark maximum temperature");
  if (typeof definition.allowShutdowns !== "boolean") {
    throw new RangeError("Benchmark allowShutdowns must be boolean.");
  }
  return durationTicks;
}

function assertModuleComputeResult(
  result: Readonly<ModuleComputeResultState>,
  moduleId: string,
): void {
  if (result.moduleInstanceId !== moduleId) {
    throw new RangeError(`Compute result coverage is contradictory for ${moduleId}.`);
  }
  if (validatedComputeResults.has(result)) return;
  assertFiniteNonnegative(result.theoreticalComputeFlops, `${moduleId} theoretical Compute`);
  assertUnitRate(result.powerFactor, `${moduleId} Power factor`);
  assertUnitRate(result.thermalFactor, `${moduleId} Thermal factor`);
  assertUnitRate(result.retryRate, `${moduleId} retry rate`);
  assertUnitRate(result.invalidSampleRate, `${moduleId} invalid sample rate`);
  assertUnitRate(result.stabilityFactor, `${moduleId} stability factor`);
  assertFiniteNonnegative(result.availableComputeFlops, `${moduleId} available Compute`);
  if (isDeeplyFrozen(result)) validatedComputeResults.add(result);
}

function assertActiveCoverage(
  state: Readonly<GameState>,
  active: Readonly<ActiveBenchmarkState>,
): void {
  if (state.benchmarks.active !== active) {
    throw new RangeError("Benchmark active input is not the current active state.");
  }
  const cached = validatedBenchmarkCoverage.get(active);
  if (
    cached?.benchmarks === state.benchmarks &&
    cached.modules === state.facility.modules &&
    cached.compute === state.facility.compute
  ) {
    return;
  }
  assertStableCluster(active.clusterModuleIds, "Benchmark cluster");
  const summaryKeys = stableKeys(active.overclockSummary);
  if (
    summaryKeys.length !== active.clusterModuleIds.length ||
    summaryKeys.some((moduleId, index) => moduleId !== active.clusterModuleIds[index])
  ) {
    throw new RangeError("Benchmark overclock summary must exactly cover the selected cluster.");
  }
  for (const moduleId of active.clusterModuleIds) {
    if (state.facility.modules[moduleId] === undefined) {
      throw new RangeError(`Benchmark cluster module ${moduleId} is not live.`);
    }
    if (state.facility.compute.byModule[moduleId] === undefined) {
      throw new RangeError(`Benchmark Compute result ${moduleId} is missing.`);
    }
    if (active.overclockSummary[moduleId] === undefined) {
      throw new RangeError(`Benchmark overclock summary ${moduleId} is missing.`);
    }
  }
  if (
    isDeeplyFrozen(active) &&
    isDeeplyFrozen(state.facility.modules) &&
    isDeeplyFrozen(state.facility.compute)
  ) {
    validatedBenchmarkCoverage.set(active, {
      benchmarks: state.benchmarks,
      modules: state.facility.modules,
      compute: state.facility.compute,
    });
  }
}

function assertFacilitySampleInputs(state: Readonly<GameState>): void {
  if (validatedFacilities.has(state.facility)) return;
  assertFiniteNonnegative(
    state.facility.power.totalDeliveredPowerWatts,
    "Facility delivered Power",
  );
  assertFiniteNonnegative(state.facility.power.headroomWatts, "Facility Power headroom");
  assertFiniteNonnegative(state.facility.power.energyCostUsdThisTick, "Facility energy cost");
  if (!isMicrodollarAlignedUsd(state.facility.power.energyCostUsdThisTick)) {
    throw new RangeError("Facility energy cost must be microdollar-aligned.");
  }
  if (state.facility.thermalTiles.length === 0) {
    throw new RangeError("Facility Thermal tiles must not be empty.");
  }
  for (const tile of state.facility.thermalTiles)
    assertFinite(tile.temperatureC, "Facility tile temperature");
  if (isDeeplyFrozen(state.facility)) validatedFacilities.add(state.facility);
}

function calculateBenchmarkTickSampleFromValidatedCoverage(
  active: Readonly<ActiveBenchmarkState>,
  state: Readonly<GameState>,
): BenchmarkTickSample {
  assertFacilitySampleInputs(state);

  let totalWeight = 0;
  let sampleUsefulComputeFlops = 0;
  let weightedRetryRate = 0;
  let weightedInvalidRate = 0;
  for (const moduleId of active.clusterModuleIds) {
    const result = state.facility.compute.byModule[moduleId];
    if (result === undefined) throw new RangeError(`Compute result ${moduleId} is missing.`);
    assertModuleComputeResult(result, moduleId);
    const weight = result.theoreticalComputeFlops * result.powerFactor * result.thermalFactor;
    assertFiniteNonnegative(weight, `${moduleId} Benchmark weight`);
    totalWeight = addFinite(totalWeight, weight, "Benchmark total weight");
    sampleUsefulComputeFlops = addFinite(
      sampleUsefulComputeFlops,
      result.availableComputeFlops,
      "Benchmark useful Compute sample",
    );
    weightedRetryRate = addFinite(
      weightedRetryRate,
      weight * result.retryRate,
      "Benchmark weighted retry rate",
    );
    weightedInvalidRate = addFinite(
      weightedInvalidRate,
      weight * result.invalidSampleRate,
      "Benchmark weighted invalid rate",
    );
  }

  const sampleRetryRate = totalWeight > 0 ? normalizeZero(weightedRetryRate / totalWeight) : 0;
  const sampleInvalidRate = totalWeight > 0 ? normalizeZero(weightedInvalidRate / totalWeight) : 0;
  const sampleValidRate = totalWeight > 0 ? normalizeZero(1 - sampleInvalidRate) : 0;
  assertUnitRate(sampleRetryRate, "Benchmark sampled retry rate");
  assertUnitRate(sampleInvalidRate, "Benchmark sampled invalid rate");
  assertUnitRate(sampleValidRate, "Benchmark sampled valid rate");

  let maxTemperatureC = Number.NEGATIVE_INFINITY;
  for (const tile of state.facility.thermalTiles) {
    maxTemperatureC = Math.max(maxTemperatureC, tile.temperatureC);
  }
  maxTemperatureC = normalizeZero(maxTemperatureC);

  let shutdownObserved = false;
  for (const moduleId in state.facility.modules) {
    if (
      Object.hasOwn(state.facility.modules, moduleId) &&
      state.facility.modules[moduleId]?.operationalState === "shutdown"
    ) {
      shutdownObserved = true;
      break;
    }
  }

  const sample = {
    totalWeight: normalizeZero(totalWeight),
    sampleUsefulComputeFlops: normalizeZero(sampleUsefulComputeFlops),
    sampleRetryRate,
    sampleInvalidRate,
    sampleValidRate,
    totalDeliveredPowerWatts: normalizeZero(state.facility.power.totalDeliveredPowerWatts),
    headroomWatts: normalizeZero(state.facility.power.headroomWatts),
    energyCostUsdThisTick: normalizeZero(state.facility.power.energyCostUsdThisTick),
    maxTemperatureC,
    shutdownObserved,
  } satisfies BenchmarkTickSample;
  for (const [label, value] of [
    ["Benchmark sample useful Compute", sample.sampleUsefulComputeFlops],
    ["Benchmark sample max temperature", sample.maxTemperatureC],
  ] as const) {
    assertFinite(value, label);
  }
  return Object.freeze(sample);
}

export function calculateBenchmarkTickSample(
  active: Readonly<ActiveBenchmarkState>,
  state: Readonly<GameState>,
): BenchmarkTickSample {
  assertActiveCoverage(state, active);
  return calculateBenchmarkTickSampleFromValidatedCoverage(active, state);
}

export function clearBenchmarkAdvanceEvidence(witness: BenchmarkAdvanceWitness): void {
  witnessInputs.delete(witness);
}

function assertActiveAccumulators(active: Readonly<ActiveBenchmarkState>): void {
  if (validatedActiveAccumulators.has(active)) return;
  assertNonnegativeSafeInteger(active.elapsedTicks, "Benchmark elapsed ticks");
  assertFiniteNonnegative(
    active.accumulatedUsefulComputeFlops,
    "Benchmark accumulated useful Compute",
  );
  assertFiniteNonnegative(active.peakUsefulComputeFlops, "Benchmark peak useful Compute");
  assertFiniteNonnegative(active.accumulatedPowerWatts, "Benchmark accumulated Power");
  assertFiniteNonnegative(active.peakPowerWatts, "Benchmark peak Power");
  assertFiniteNonnegative(active.accumulatedRetryRate, "Benchmark accumulated retry rate");
  assertFiniteNonnegative(
    active.accumulatedValidSampleRate,
    "Benchmark accumulated valid sample rate",
  );
  assertFiniteNonnegative(active.accumulatedCostUsd, "Benchmark accumulated cost");
  if (!isMicrodollarAlignedUsd(active.accumulatedCostUsd)) {
    throw new RangeError("Benchmark accumulated cost must be microdollar-aligned.");
  }
  if (active.maxTemperatureC !== null)
    assertFinite(active.maxTemperatureC, "Benchmark max temperature");
  if (active.minimumPowerHeadroomWatts !== null) {
    assertFinite(active.minimumPowerHeadroomWatts, "Benchmark minimum Power headroom");
  }
  if (typeof active.shutdownObserved !== "boolean") {
    throw new RangeError("Benchmark shutdownObserved must be boolean.");
  }
  if (isDeeplyFrozen(active)) validatedActiveAccumulators.add(active);
}

function completedResult(
  active: Readonly<ActiveBenchmarkState>,
  nextActive: Readonly<ActiveBenchmarkState>,
  definition: DeepReadonly<BenchmarkDefinition>,
  durationTicks: number,
): BenchmarkResult {
  if (nextActive.maxTemperatureC === null || nextActive.minimumPowerHeadroomWatts === null) {
    throw new RangeError("Completed Benchmark requires sampled extrema.");
  }
  const result: BenchmarkResult = {
    runId: active.runId,
    benchmarkId: active.benchmarkId,
    clusterModuleIds: [...active.clusterModuleIds],
    passed: true,
    startedAtTick: active.startedAtTick,
    durationTicks,
    averageUsefulComputeFlops: normalizeZero(
      nextActive.accumulatedUsefulComputeFlops / durationTicks,
    ),
    peakUsefulComputeFlops: nextActive.peakUsefulComputeFlops,
    peakPowerWatts: nextActive.peakPowerWatts,
    averagePowerWatts: normalizeZero(nextActive.accumulatedPowerWatts / durationTicks),
    maxTemperatureC: nextActive.maxTemperatureC,
    minimumPowerHeadroomWatts: nextActive.minimumPowerHeadroomWatts,
    retryRate: normalizeZero(nextActive.accumulatedRetryRate / durationTicks),
    validSampleRate: normalizeZero(nextActive.accumulatedValidSampleRate / durationTicks),
    costUsd: nextActive.accumulatedCostUsd,
    shutdownObserved: nextActive.shutdownObserved,
    failureReasons: [],
    overclockSummary: cloneOverclockSummary(active.overclockSummary),
  };
  const comparison = compareBenchmarkResults(result, definition);
  return deepFreeze({
    ...result,
    passed: comparison.passed,
    failureReasons: [...comparison.failureReasons],
  });
}

export function advanceBenchmarkRun(
  active: Readonly<ActiveBenchmarkState>,
  state: Readonly<GameState>,
  content: ContentBundle,
  options: BenchmarkAdvanceOptions = {},
): BenchmarkAdvancementCalculation {
  assertActiveCoverage(state, active);
  assertActiveAccumulators(active);
  const definition = content.era.benchmarkDefinitions.find(({ id }) => id === active.benchmarkId);
  if (definition === undefined) throw new RangeError(`Unknown Benchmark ${active.benchmarkId}.`);
  const durationTicks = assertBenchmarkDefinition(definition);
  if (active.elapsedTicks >= durationTicks) {
    throw new RangeError("Benchmark cannot advance after its exact duration boundary.");
  }

  const sample = calculateBenchmarkTickSampleFromValidatedCoverage(active, state);
  const nextElapsedTicks = active.elapsedTicks + 1;
  assertNonnegativeSafeInteger(nextElapsedTicks, "Benchmark next elapsed ticks");
  const nextMaxTemperatureC =
    active.maxTemperatureC === null
      ? sample.maxTemperatureC
      : Math.max(active.maxTemperatureC, sample.maxTemperatureC);
  const nextMinimumPowerHeadroomWatts =
    active.minimumPowerHeadroomWatts === null
      ? sample.headroomWatts
      : Math.min(active.minimumPowerHeadroomWatts, sample.headroomWatts);
  const nextCostMicrodollars = addMicrodollars(
    usdToMicrodollars(active.accumulatedCostUsd),
    usdToMicrodollars(sample.energyCostUsdThisTick),
  );
  const nextActive = cloneActiveBenchmark({
    ...active,
    elapsedTicks: nextElapsedTicks,
    accumulatedUsefulComputeFlops: addFinite(
      active.accumulatedUsefulComputeFlops,
      sample.sampleUsefulComputeFlops,
      "Benchmark accumulated useful Compute",
    ),
    peakUsefulComputeFlops: Math.max(
      active.peakUsefulComputeFlops,
      sample.sampleUsefulComputeFlops,
    ),
    accumulatedPowerWatts: addFinite(
      active.accumulatedPowerWatts,
      sample.totalDeliveredPowerWatts,
      "Benchmark accumulated Power",
    ),
    peakPowerWatts: Math.max(active.peakPowerWatts, sample.totalDeliveredPowerWatts),
    maxTemperatureC: normalizeZero(nextMaxTemperatureC),
    minimumPowerHeadroomWatts: normalizeZero(nextMinimumPowerHeadroomWatts),
    accumulatedRetryRate: addFinite(
      active.accumulatedRetryRate,
      sample.sampleRetryRate,
      "Benchmark accumulated retry rate",
    ),
    accumulatedValidSampleRate: addFinite(
      active.accumulatedValidSampleRate,
      sample.sampleValidRate,
      "Benchmark accumulated valid sample rate",
    ),
    accumulatedCostUsd: microdollarsToUsd(nextCostMicrodollars),
    shutdownObserved: active.shutdownObserved || sample.shutdownObserved,
  });

  if (nextElapsedTicks < durationTicks) {
    const benchmarks = deepFreeze({
      ...state.benchmarks,
      active: nextActive,
      history: stableHistory(state.benchmarks.history),
      bestRunByBenchmark: isDeeplyFrozen(state.benchmarks.bestRunByBenchmark)
        ? state.benchmarks.bestRunByBenchmark
        : deepFreeze(stableRecord(state.benchmarks.bestRunByBenchmark)),
    });
    const result = Object.freeze({ benchmarks, completedResult: null });
    const witness = Object.freeze({ expected: result });
    witnessInputs.set(witness, {
      state,
      content,
      benchmarks: state.benchmarks,
      active,
      facility: state.facility,
      compute: state.facility.compute,
      power: state.facility.power,
      thermalTiles: state.facility.thermalTiles,
      modules: state.facility.modules,
      tick: state.tick,
      inputFingerprint: benchmarkNeedsMutableInputFingerprint(active, state, options)
        ? benchmarkInputFingerprint(active, state, content)
        : undefined,
    });
    return Object.freeze({ result, witness });
  }

  const resultRecord = completedResult(active, nextActive, definition, durationTicks);
  const history = deepFreeze([
    ...state.benchmarks.history.map((result) => cloneBenchmarkResult(result)),
    resultRecord,
  ]);
  const best = selectBestBenchmarkRun(history, definition);
  const currentBestRunId = state.benchmarks.bestRunByBenchmark[definition.id];
  const bestRunByBenchmark =
    best?.runId === currentBestRunId || (best === undefined && currentBestRunId === undefined)
      ? isDeeplyFrozen(state.benchmarks.bestRunByBenchmark)
        ? state.benchmarks.bestRunByBenchmark
        : deepFreeze(stableRecord(state.benchmarks.bestRunByBenchmark))
      : stableRecord({
          ...state.benchmarks.bestRunByBenchmark,
          ...(best === undefined ? {} : { [definition.id]: best.runId }),
        });
  const benchmarks = deepFreeze({
    ...state.benchmarks,
    active: null,
    history,
    bestRunByBenchmark,
  });
  const result = Object.freeze({ benchmarks, completedResult: resultRecord });
  const witness = Object.freeze({ expected: result });
  witnessInputs.set(witness, {
    state,
    content,
    benchmarks: state.benchmarks,
    active,
    facility: state.facility,
    compute: state.facility.compute,
    power: state.facility.power,
    thermalTiles: state.facility.thermalTiles,
    modules: state.facility.modules,
    tick: state.tick,
    inputFingerprint: benchmarkNeedsMutableInputFingerprint(active, state, options)
      ? benchmarkInputFingerprint(active, state, content)
      : undefined,
  });
  return Object.freeze({ result, witness });
}

function assertResultMetrics(result: Readonly<BenchmarkResult>): void {
  if (typeof result.passed !== "boolean" || typeof result.shutdownObserved !== "boolean") {
    throw new RangeError("Benchmark result booleans must be valid.");
  }
  assertStableCluster(result.clusterModuleIds, "Benchmark result cluster");
  assertPositiveSafeInteger(result.durationTicks, "Benchmark result duration ticks");
  assertNonnegativeSafeInteger(result.startedAtTick, "Benchmark result start tick");
  for (const [label, value] of [
    ["Benchmark average useful Compute", result.averageUsefulComputeFlops],
    ["Benchmark peak useful Compute", result.peakUsefulComputeFlops],
    ["Benchmark peak Power", result.peakPowerWatts],
    ["Benchmark average Power", result.averagePowerWatts],
    ["Benchmark result cost", result.costUsd],
  ] as const) {
    assertFiniteNonnegative(value, label);
  }
  assertFinite(result.maxTemperatureC, "Benchmark result maximum temperature");
  assertFiniteNonnegative(
    result.minimumPowerHeadroomWatts,
    "Benchmark result minimum Power headroom",
  );
  assertUnitRate(result.retryRate, "Benchmark result retry rate");
  assertUnitRate(result.validSampleRate, "Benchmark result valid sample rate");
  if (!isMicrodollarAlignedUsd(result.costUsd)) {
    throw new RangeError("Benchmark result cost must be microdollar-aligned.");
  }
  let previousReasonIndex = -1;
  for (const reason of result.failureReasons) {
    const reasonIndex = FAILURE_REASONS.indexOf(reason);
    if (reasonIndex < 0 || reasonIndex <= previousReasonIndex) {
      throw new RangeError("Benchmark result failure reasons must use fixed unique order.");
    }
    previousReasonIndex = reasonIndex;
  }
  if (result.passed !== (result.failureReasons.length === 0)) {
    throw new RangeError("Benchmark result passed must match its failure reasons.");
  }
  const summaryKeys = Object.keys(result.overclockSummary);
  if (!hasStableDistinctOrder(summaryKeys)) {
    throw new RangeError("Benchmark result overclock summary keys must be stable.");
  }
  for (const moduleId of summaryKeys) {
    const settings = result.overclockSummary[moduleId];
    if (settings === undefined)
      throw new RangeError(`Missing result overclock settings ${moduleId}.`);
    if (
      !Number.isFinite(settings.frequencyRatio) ||
      settings.frequencyRatio <= 0 ||
      !Number.isFinite(settings.voltageRatio) ||
      settings.voltageRatio <= 0
    ) {
      throw new RangeError("Benchmark result overclock settings must be finite and positive.");
    }
  }
}

function compareBestResults(
  candidate: Readonly<BenchmarkResult>,
  incumbent: Readonly<BenchmarkResult>,
  definition: DeepReadonly<BenchmarkDefinition>,
): number {
  assertResultMetrics(candidate);
  assertResultMetrics(incumbent);
  if (candidate.benchmarkId !== definition.id || incumbent.benchmarkId !== definition.id) {
    throw new RangeError("Benchmark results must match the compared definition.");
  }
  if (candidate.passed !== incumbent.passed) return candidate.passed ? 1 : -1;
  const comparator = definition.type === "peak" ? PEAK_COMPARATOR : SUSTAINED_COMPARATOR;
  for (const [field, direction] of comparator) {
    const candidateValue = candidate[field];
    const incumbentValue = incumbent[field];
    if (typeof candidateValue !== "number" || typeof incumbentValue !== "number") {
      throw new RangeError(`Benchmark comparator field ${field} must be numeric.`);
    }
    if (candidateValue === incumbentValue) continue;
    const candidateIsBetter =
      direction === "higher" ? candidateValue > incumbentValue : candidateValue < incumbentValue;
    return candidateIsBetter ? 1 : -1;
  }
  return 0;
}

export function compareBenchmarkResults(
  result: Readonly<BenchmarkResult>,
  definition: DeepReadonly<BenchmarkDefinition>,
): BenchmarkComparison;
export function compareBenchmarkResults(
  candidate: Readonly<BenchmarkResult>,
  incumbent: Readonly<BenchmarkResult>,
  definition: DeepReadonly<BenchmarkDefinition>,
): number;
export function compareBenchmarkResults(
  first: Readonly<BenchmarkResult>,
  second: DeepReadonly<BenchmarkDefinition> | Readonly<BenchmarkResult>,
  definition?: DeepReadonly<BenchmarkDefinition>,
): BenchmarkComparison | number {
  if (definition === undefined) {
    const benchmarkDefinition = second as Readonly<BenchmarkDefinition>;
    assertResultMetrics(first);
    assertBenchmarkDefinition(benchmarkDefinition);
    const failureReasons: BenchmarkFailureReason[] = [];
    if (first.averageUsefulComputeFlops < benchmarkDefinition.targetAverageUsefulComputeFlops) {
      failureReasons.push("average-compute");
    }
    if (first.validSampleRate < benchmarkDefinition.minimumValidSampleRate) {
      failureReasons.push("valid-sample-rate");
    }
    if (first.retryRate > benchmarkDefinition.maximumRetryRate) {
      failureReasons.push("retry-rate");
    }
    if (first.maxTemperatureC > benchmarkDefinition.maximumTemperatureC) {
      failureReasons.push("maximum-temperature");
    }
    if (first.shutdownObserved && !benchmarkDefinition.allowShutdowns) {
      failureReasons.push("shutdown");
    }
    return Object.freeze({
      passed: failureReasons.length === 0,
      failureReasons: Object.freeze(failureReasons),
    });
  }
  return compareBestResults(first, second as Readonly<BenchmarkResult>, definition);
}

export function selectBestBenchmarkRun(
  results: readonly BenchmarkResult[],
  definition: DeepReadonly<BenchmarkDefinition>,
): BenchmarkResult | undefined {
  assertBenchmarkDefinition(definition);
  let best: BenchmarkResult | undefined;
  for (const result of results) {
    if (result.benchmarkId !== definition.id) continue;
    assertResultMetrics(result);
    if (!result.passed) continue;
    if (best === undefined || compareBestResults(result, best, definition) > 0) {
      best = result;
    }
  }
  return best;
}

export function validateFreshBenchmarkAdvance(
  state: Readonly<GameState>,
  content: ContentBundle,
  result: Readonly<BenchmarkAdvancementResult>,
  witness: Readonly<BenchmarkAdvanceWitness>,
): string[] {
  try {
    const inputs = witnessInputs.get(witness);
    if (inputs === undefined) {
      return ["Benchmark advancement inputs changed before candidate-state validation."];
    }
    const currentActive = state.benchmarks.active;
    if (currentActive === null) {
      return ["Benchmark advancement inputs changed before candidate-state validation."];
    }
    if (
      inputs.state !== state ||
      inputs.content !== content ||
      inputs.benchmarks !== state.benchmarks ||
      inputs.active !== currentActive ||
      inputs.facility !== state.facility ||
      inputs.compute !== state.facility.compute ||
      inputs.power !== state.facility.power ||
      inputs.thermalTiles !== state.facility.thermalTiles ||
      inputs.modules !== state.facility.modules ||
      inputs.tick !== state.tick ||
      (inputs.inputFingerprint !== undefined &&
        inputs.inputFingerprint !== benchmarkInputFingerprint(currentActive, state, content))
    ) {
      return ["Benchmark advancement inputs changed before candidate-state validation."];
    }
    return result === inputsExpected(witness)
      ? []
      : ["Benchmark candidate does not match detached exact calculation evidence."];
  } catch (error: unknown) {
    return [error instanceof Error ? error.message : "Benchmark advancement validation failed."];
  }
}

function inputsExpected(witness: BenchmarkAdvanceWitness): Readonly<BenchmarkAdvancementResult> {
  return witness.expected;
}
