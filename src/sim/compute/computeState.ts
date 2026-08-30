import type {
  ComputeBlockingReason,
  ComputeBreakdown,
  ComputeWarning,
  FacilityComputeState,
  GameState,
  ModuleComputeResultState,
  TaskComputeResultState,
} from "../core/types.ts";

export interface ComputeStateIssue {
  readonly path: string;
  readonly message: string;
}

const BLOCKING_REASONS: readonly ComputeBlockingReason[] = [
  "no-active-compute",
  "insufficient-memory-capacity",
  "data-disconnected",
];
const WARNINGS: readonly ComputeWarning[] = ["stability-below-minimum"];
const BOTTLENECK_FACTORS = [
  "power",
  "thermal",
  "memory",
  "interconnect",
  "suitability",
  "stability",
] as const;

function pushIf(
  issues: ComputeStateIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function isUnitRate(value: number): boolean {
  return isFiniteNonnegative(value) && value <= 1;
}

function hasStableOrder(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous > current) return false;
  }
  return true;
}

function isStableDistinctOrder(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function hasFixedDistinctOrder<T extends string>(
  values: readonly T[],
  supported: readonly T[],
): boolean {
  let previousIndex = -1;
  for (const value of values) {
    const index = supported.indexOf(value);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function validateRateIdentity(
  retryRate: number,
  invalidSampleRate: number,
  stabilityFactor: number,
  path: string,
  issues: ComputeStateIssue[],
): void {
  pushIf(issues, !isUnitRate(retryRate), `${path}.retryRate`, "must be in [0, 1]");
  pushIf(issues, !isUnitRate(invalidSampleRate), `${path}.invalidSampleRate`, "must be in [0, 1]");
  pushIf(issues, !isUnitRate(stabilityFactor), `${path}.stabilityFactor`, "must be in [0, 1]");
  pushIf(
    issues,
    retryRate + invalidSampleRate > 1,
    path,
    "retry and invalid sample rates must not exceed 1 together",
  );
  pushIf(
    issues,
    stabilityFactor !== 1 - retryRate - invalidSampleRate,
    `${path}.stabilityFactor`,
    "must exactly equal 1 minus retry and invalid sample rates",
  );
}

function validateModuleResult(
  result: Readonly<ModuleComputeResultState>,
  moduleId: string,
  issues: ComputeStateIssue[],
): void {
  const path = `facility.compute.byModule.${moduleId}`;
  pushIf(
    issues,
    result.moduleInstanceId !== moduleId,
    `${path}.moduleInstanceId`,
    "must match its record key",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.requestedFrequencyRatio),
    `${path}.requestedFrequencyRatio`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.operationalRatio),
    `${path}.operationalRatio`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.theoreticalComputeFlops),
    `${path}.theoreticalComputeFlops`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.availableComputeFlops),
    `${path}.availableComputeFlops`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isUnitRate(result.operationalRatio),
    `${path}.operationalRatio`,
    "must be in [0, 1]",
  );
  pushIf(issues, !isUnitRate(result.powerFactor), `${path}.powerFactor`, "must be in [0, 1]");
  pushIf(issues, !isUnitRate(result.thermalFactor), `${path}.thermalFactor`, "must be in [0, 1]");
  validateRateIdentity(
    result.retryRate,
    result.invalidSampleRate,
    result.stabilityFactor,
    path,
    issues,
  );
  pushIf(
    issues,
    result.availableComputeFlops !==
      result.theoreticalComputeFlops *
        result.powerFactor *
        result.thermalFactor *
        result.stabilityFactor,
    `${path}.availableComputeFlops`,
    "must equal theoretical compute after power, thermal, and stability factors",
  );
}

function validateBreakdown(
  breakdown: Readonly<ComputeBreakdown>,
  path: string,
  issues: ComputeStateIssue[],
): void {
  pushIf(
    issues,
    !isFiniteNonnegative(breakdown.theoreticalComputeFlops),
    `${path}.theoreticalComputeFlops`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(breakdown.usefulComputeFlops),
    `${path}.usefulComputeFlops`,
    "must be finite and nonnegative",
  );
  pushIf(issues, !isUnitRate(breakdown.powerFactor), `${path}.powerFactor`, "must be in [0, 1]");
  pushIf(
    issues,
    !isUnitRate(breakdown.thermalFactor),
    `${path}.thermalFactor`,
    "must be in [0, 1]",
  );
  pushIf(issues, !isUnitRate(breakdown.memoryFactor), `${path}.memoryFactor`, "must be in [0, 1]");
  pushIf(
    issues,
    !isUnitRate(breakdown.interconnectFactor),
    `${path}.interconnectFactor`,
    "must be in [0, 1]",
  );
  pushIf(
    issues,
    !isUnitRate(breakdown.stabilityFactor),
    `${path}.stabilityFactor`,
    "must be in [0, 1]",
  );
  pushIf(
    issues,
    !Number.isFinite(breakdown.suitabilityFactor) ||
      breakdown.suitabilityFactor < 0.7 ||
      breakdown.suitabilityFactor > 1.25,
    `${path}.suitabilityFactor`,
    "must be in [0.7, 1.25]",
  );
  pushIf(
    issues,
    breakdown.usefulComputeFlops !==
      breakdown.theoreticalComputeFlops *
        breakdown.powerFactor *
        breakdown.thermalFactor *
        breakdown.memoryFactor *
        breakdown.interconnectFactor *
        breakdown.suitabilityFactor *
        breakdown.stabilityFactor,
    `${path}.usefulComputeFlops`,
    "must equal the breakdown factors applied to theoretical compute",
  );
  const bottlenecks = breakdown.bottlenecks;
  const factorValues = [
    ["power", breakdown.powerFactor],
    ["thermal", breakdown.thermalFactor],
    ["memory", breakdown.memoryFactor],
    ["interconnect", breakdown.interconnectFactor],
    ["suitability", breakdown.suitabilityFactor],
    ["stability", breakdown.stabilityFactor],
  ] as const;
  let beforeFactor = breakdown.theoreticalComputeFlops;
  const expectedBottlenecks: {
    factor: (typeof BOTTLENECK_FACTORS)[number];
    factorValue: number;
    lostComputeFlops: number;
    index: number;
  }[] = [];
  for (let index = 0; index < factorValues.length; index += 1) {
    const entry = factorValues[index];
    if (entry === undefined) continue;
    const [factor, factorValue] = entry;
    const afterFactor = beforeFactor * factorValue;
    if (factorValue < 1) {
      expectedBottlenecks.push({
        factor,
        factorValue,
        lostComputeFlops: beforeFactor - afterFactor,
        index,
      });
    }
    beforeFactor = afterFactor;
  }
  expectedBottlenecks.sort(
    (left, right) => right.lostComputeFlops - left.lostComputeFlops || left.index - right.index,
  );
  let bottleneckCoverageMismatch = bottlenecks.length !== expectedBottlenecks.length;
  for (let index = 0; index < bottlenecks.length && !bottleneckCoverageMismatch; index += 1) {
    bottleneckCoverageMismatch = bottlenecks[index]?.factor !== expectedBottlenecks[index]?.factor;
  }
  pushIf(
    issues,
    bottleneckCoverageMismatch,
    `${path}.bottlenecks`,
    "must exactly cover below-one factors in descending lost-compute order",
  );
  for (let index = 0; index < bottlenecks.length; index += 1) {
    const bottleneck = bottlenecks[index];
    if (bottleneck === undefined) continue;
    const bottleneckPath = `${path}.bottlenecks.${bottleneck.factor}`;
    pushIf(
      issues,
      !BOTTLENECK_FACTORS.includes(bottleneck.factor),
      `${bottleneckPath}.factor`,
      "must be a supported factor",
    );
    pushIf(
      issues,
      !isUnitRate(bottleneck.factorValue),
      `${bottleneckPath}.factorValue`,
      "must be in [0, 1]",
    );
    pushIf(
      issues,
      !isFiniteNonnegative(bottleneck.lostComputeFlops),
      `${bottleneckPath}.lostComputeFlops`,
      "must be finite and nonnegative",
    );
    const expected = expectedBottlenecks[index];
    if (!expected) {
      issues.push({ path: bottleneckPath, message: "must match the sequential factor loss" });
    } else {
      pushIf(
        issues,
        bottleneck.factorValue !== expected.factorValue ||
          bottleneck.lostComputeFlops !== expected.lostComputeFlops,
        bottleneckPath,
        "must match the sequential factor loss",
      );
    }
    pushIf(
      issues,
      bottleneck.explanationKey !== `compute.bottlenecks.${bottleneck.factor}`,
      `${bottleneckPath}.explanationKey`,
      "must use the canonical factor localization key",
    );
  }
}

function validateTaskResult(
  result: Readonly<TaskComputeResultState>,
  taskId: string,
  byModule: Readonly<Record<string, ModuleComputeResultState>>,
  issues: ComputeStateIssue[],
): void {
  const path = `facility.compute.byTask.${taskId}`;
  pushIf(
    issues,
    result.taskInstanceId !== taskId,
    `${path}.taskInstanceId`,
    "must match its record key",
  );
  pushIf(
    issues,
    result.taskDefinitionId.length === 0,
    `${path}.taskDefinitionId`,
    "must be nonempty",
  );
  pushIf(
    issues,
    !Number.isSafeInteger(result.phaseIndex) || result.phaseIndex < 0,
    `${path}.phaseIndex`,
    "must be a nonnegative safe integer",
  );
  pushIf(issues, result.phaseId.length === 0, `${path}.phaseId`, "must be nonempty");
  pushIf(
    issues,
    !isStableDistinctOrder(result.clusterModuleIds),
    `${path}.clusterModuleIds`,
    "must use stable distinct module IDs",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.requestedShare),
    `${path}.requestedShare`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.availableMemoryCapacityBytes),
    `${path}.availableMemoryCapacityBytes`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.availableMemoryBandwidthBytesPerSecond),
    `${path}.availableMemoryBandwidthBytesPerSecond`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.deliveredRouteBandwidthBytesPerSecond),
    `${path}.deliveredRouteBandwidthBytesPerSecond`,
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !isFiniteNonnegative(result.extraLatencyMicroseconds),
    `${path}.extraLatencyMicroseconds`,
    "must be finite and nonnegative",
  );
  pushIf(issues, !isUnitRate(result.requestedShare), `${path}.requestedShare`, "must be in [0, 1]");
  validateRateIdentity(
    result.retryRate,
    result.invalidSampleRate,
    result.breakdown.stabilityFactor,
    path,
    issues,
  );
  const blockingReasons = result.blockingReasons;
  pushIf(
    issues,
    !hasFixedDistinctOrder(blockingReasons, BLOCKING_REASONS),
    `${path}.blockingReasons`,
    "must use stable unique reason ordering",
  );
  pushIf(
    issues,
    blockingReasons.some((reason) => !BLOCKING_REASONS.includes(reason)),
    `${path}.blockingReasons`,
    "must contain only approved reasons",
  );
  const warnings = result.warnings;
  pushIf(
    issues,
    !hasFixedDistinctOrder(warnings, WARNINGS),
    `${path}.warnings`,
    "must use stable unique warning ordering",
  );
  pushIf(
    issues,
    warnings.some((warning) => !WARNINGS.includes(warning)),
    `${path}.warnings`,
    "must contain only approved warnings",
  );
  pushIf(
    issues,
    result.runnable !== (blockingReasons.length === 0),
    `${path}.runnable`,
    "must match the absence of blocking reasons",
  );
  pushIf(
    issues,
    result.meetsStabilityMinimum === warnings.includes("stability-below-minimum"),
    `${path}.warnings`,
    "must report stability below minimum exactly when unmet",
  );
  validateBreakdown(result.breakdown, `${path}.breakdown`, issues);
  let expectedTheoretical = 0;
  let weightedPower = 0;
  let afterPowerTotal = 0;
  let weightedThermal = 0;
  let afterThermalTotal = 0;
  let weightedRetry = 0;
  let weightedInvalid = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in fresh tick validation.
  for (let index = 0; index < result.clusterModuleIds.length; index += 1) {
    const moduleId = result.clusterModuleIds[index];
    const record = moduleId === undefined ? undefined : byModule[moduleId];
    if (record === undefined) continue;
    const theoreticalWeight = result.requestedShare * record.theoreticalComputeFlops;
    expectedTheoretical += theoreticalWeight;
    weightedPower += record.powerFactor * theoreticalWeight;
    const afterPower = theoreticalWeight * record.powerFactor;
    afterPowerTotal += afterPower;
    weightedThermal += record.thermalFactor * afterPower;
    const afterThermal = afterPower * record.thermalFactor;
    afterThermalTotal += afterThermal;
    weightedRetry += record.retryRate * afterThermal;
    weightedInvalid += record.invalidSampleRate * afterThermal;
  }
  if (expectedTheoretical === 0) expectedTheoretical = 0;
  const expectedPower = expectedTheoretical === 0 ? 0 : weightedPower / expectedTheoretical;
  const expectedThermal = afterPowerTotal === 0 ? 0 : weightedThermal / afterPowerTotal;
  const expectedRetry = afterThermalTotal === 0 ? 0 : weightedRetry / afterThermalTotal;
  const expectedInvalid = afterThermalTotal === 0 ? 0 : weightedInvalid / afterThermalTotal;
  pushIf(
    issues,
    result.breakdown.theoreticalComputeFlops !== expectedTheoretical,
    `${path}.breakdown.theoreticalComputeFlops`,
    "must equal requested share times selected module theoretical compute",
  );
  pushIf(
    issues,
    result.breakdown.powerFactor !== expectedPower,
    `${path}.breakdown.powerFactor`,
    "must equal the theoretical-compute-weighted module Power Factor",
  );
  pushIf(
    issues,
    result.breakdown.thermalFactor !== expectedThermal,
    `${path}.breakdown.thermalFactor`,
    "must equal the post-Power-weighted module Thermal Factor",
  );
  pushIf(
    issues,
    result.retryRate !== expectedRetry,
    `${path}.retryRate`,
    "must equal the post-Power/post-Thermal-weighted module retry rate",
  );
  pushIf(
    issues,
    result.invalidSampleRate !== expectedInvalid,
    `${path}.invalidSampleRate`,
    "must equal the post-Power/post-Thermal-weighted module invalid-sample rate",
  );
  pushIf(
    issues,
    blockingReasons.includes("no-active-compute") !== (expectedTheoretical === 0) ||
      blockingReasons.includes("insufficient-memory-capacity") !==
        (result.breakdown.memoryFactor === 0) ||
      blockingReasons.includes("data-disconnected") !== (result.breakdown.interconnectFactor === 0),
    `${path}.blockingReasons`,
    "must exactly match zero theoretical, Memory, and Interconnect conditions",
  );
}

function validateTaskAllocations(state: Readonly<GameState>, issues: ComputeStateIssue[]): void {
  for (const taskId of Object.keys(state.tasks.instances).toSorted()) {
    const task = state.tasks.instances[taskId];
    if (task === undefined) continue;
    const allocation = task.allocation;
    if (allocation === null) continue;
    const path = `tasks.instances.${taskId}.allocation`;
    pushIf(
      issues,
      !isStableDistinctOrder(allocation.clusterModuleIds),
      `${path}.clusterModuleIds`,
      "must use stable distinct module IDs",
    );
    pushIf(
      issues,
      !isUnitRate(allocation.requestedShare),
      `${path}.requestedShare`,
      "must be in [0, 1]",
    );
    pushIf(
      issues,
      !isFiniteNonnegative(allocation.deliveredUsefulComputeFlops),
      `${path}.deliveredUsefulComputeFlops`,
      "must be finite and nonnegative",
    );
    // A later tick stage may transition an active task after Compute has recorded its result.
    // Stored Compute is historical, so this validator must not reinterpret that completed-tick output.
  }
}

export function createDirtyComputeState(): FacilityComputeState {
  return {
    layoutRevision: null,
    thermalRevision: null,
    byModule: {},
    byTask: {},
    totalTheoreticalComputeFlops: 0,
    totalAvailableComputeFlops: 0,
    totalAllocatedUsefulComputeFlops: 0,
  };
}

export function validateComputeState(state: Readonly<GameState>): ComputeStateIssue[] {
  const issues: ComputeStateIssue[] = [];
  validateTaskAllocations(state, issues);
  const compute = state.facility.compute;
  const moduleIds = Object.keys(compute.byModule);
  const taskIds = Object.keys(compute.byTask);
  for (const [field, value] of [
    ["totalTheoreticalComputeFlops", compute.totalTheoreticalComputeFlops],
    ["totalAvailableComputeFlops", compute.totalAvailableComputeFlops],
    ["totalAllocatedUsefulComputeFlops", compute.totalAllocatedUsefulComputeFlops],
  ] as const) {
    pushIf(
      issues,
      !isFiniteNonnegative(value),
      `facility.compute.${field}`,
      "must be finite and nonnegative",
    );
  }
  pushIf(
    issues,
    !hasStableOrder(moduleIds),
    "facility.compute.byModule",
    "keys must use stable ordering",
  );
  pushIf(
    issues,
    !hasStableOrder(taskIds),
    "facility.compute.byTask",
    "keys must use stable ordering",
  );
  if (compute.layoutRevision === null || compute.thermalRevision === null) {
    pushIf(
      issues,
      compute.layoutRevision !== null,
      "facility.compute.layoutRevision",
      "dirty state must be null",
    );
    pushIf(
      issues,
      compute.thermalRevision !== null,
      "facility.compute.thermalRevision",
      "dirty state must be null",
    );
    pushIf(
      issues,
      moduleIds.length !== 0,
      "facility.compute.byModule",
      "dirty state must be empty",
    );
    pushIf(issues, taskIds.length !== 0, "facility.compute.byTask", "dirty state must be empty");
    for (const [field, value] of [
      ["totalTheoreticalComputeFlops", compute.totalTheoreticalComputeFlops],
      ["totalAvailableComputeFlops", compute.totalAvailableComputeFlops],
      ["totalAllocatedUsefulComputeFlops", compute.totalAllocatedUsefulComputeFlops],
    ] as const) {
      pushIf(issues, value !== 0, `facility.compute.${field}`, "dirty state must be zero");
    }
    return issues;
  }
  for (const [field, value] of [
    ["layoutRevision", compute.layoutRevision],
    ["thermalRevision", compute.thermalRevision],
  ] as const) {
    pushIf(
      issues,
      !Number.isSafeInteger(value) || value < 0,
      `facility.compute.${field}`,
      "must be a nonnegative safe integer or null",
    );
  }
  for (const moduleId of moduleIds) {
    const result = compute.byModule[moduleId];
    if (result !== undefined) validateModuleResult(result, moduleId, issues);
  }
  for (const taskId of taskIds) {
    const result = compute.byTask[taskId];
    if (result !== undefined) validateTaskResult(result, taskId, compute.byModule, issues);
  }
  let totalTheoreticalComputeFlops = 0;
  let totalAvailableComputeFlops = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in fresh tick validation.
  for (let index = 0; index < moduleIds.length; index += 1) {
    const id = moduleIds[index];
    if (id === undefined) continue;
    totalTheoreticalComputeFlops += compute.byModule[id]?.theoreticalComputeFlops ?? 0;
    totalAvailableComputeFlops += compute.byModule[id]?.availableComputeFlops ?? 0;
  }
  if (totalTheoreticalComputeFlops === 0) totalTheoreticalComputeFlops = 0;
  if (totalAvailableComputeFlops === 0) totalAvailableComputeFlops = 0;
  let totalAllocatedUsefulComputeFlops = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in fresh tick validation.
  for (let index = 0; index < taskIds.length; index += 1) {
    const id = taskIds[index];
    if (id !== undefined) {
      totalAllocatedUsefulComputeFlops += compute.byTask[id]?.breakdown.usefulComputeFlops ?? 0;
    }
  }
  if (totalAllocatedUsefulComputeFlops === 0) totalAllocatedUsefulComputeFlops = 0;
  pushIf(
    issues,
    compute.totalTheoreticalComputeFlops !== totalTheoreticalComputeFlops,
    "facility.compute.totalTheoreticalComputeFlops",
    "must equal the stable sum of module theoretical compute",
  );
  pushIf(
    issues,
    compute.totalAvailableComputeFlops !== totalAvailableComputeFlops,
    "facility.compute.totalAvailableComputeFlops",
    "must equal the stable sum of module available compute",
  );
  pushIf(
    issues,
    compute.totalAllocatedUsefulComputeFlops !== totalAllocatedUsefulComputeFlops,
    "facility.compute.totalAllocatedUsefulComputeFlops",
    "must equal the stable sum of task useful compute",
  );
  return issues;
}

export function assertValidStoredComputeState(state: Readonly<GameState>): void {
  const issues = validateComputeState(state);
  if (issues.length > 0) {
    throw new Error(
      `Invalid compute state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}
