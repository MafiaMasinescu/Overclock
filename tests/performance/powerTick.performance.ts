import { cpus, release } from "node:os";

import { SimCore } from "../../src/sim/core/simCore.ts";
import { createPowerAllocationScratch } from "../../src/sim/power/powerAllocation.ts";
import {
  calculateFacilityPower,
  createPowerTickSystems,
} from "../../src/sim/power/facilityPower.ts";
import {
  assertValidPowerTickResult,
  createPowerTickValidationScratch,
} from "../../src/sim/power/powerTickValidation.ts";
import { createPowerTopology } from "../../src/sim/power/powerTopology.ts";
import {
  assertPowerPerformanceFixtureExercisesConstraints,
  createPowerPerformanceFixture,
  POWER_FIXTURE_CONTRACTED_WATTS,
  POWER_FIXTURE_HEIGHT,
  POWER_FIXTURE_MODULE_COUNT,
  POWER_FIXTURE_ROUTE_COUNT,
  POWER_FIXTURE_SOURCE_COUNT,
  POWER_FIXTURE_WIDTH,
  powerPerformanceContent,
} from "./powerFixture.ts";

assertPowerPerformanceFixtureExercisesConstraints();

interface Summary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly sampleCount: number;
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples: number[]): Summary {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    sampleCount: samples.length,
  };
}

function elapsed(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function measureStep(warmups: number, sampleCount: number): Summary {
  const core = new SimCore({
    initialState: createPowerPerformanceFixture("power-tick-performance"),
    tickSystems: createPowerTickSystems(powerPerformanceContent),
  });
  core.step(warmups);
  const samples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsed(start));
  }
  return summarize(samples);
}

function createStartupTransitionCore(seed: string): SimCore {
  const state = createPowerPerformanceFixture(seed);
  const source = state.facility.modules["source-00"];
  if (source === undefined) throw new Error("Missing audited startup-transition source.");
  source.operationalState = "starting";
  source.startupTicksRemaining = 2;
  return new SimCore({
    initialState: state,
    tickSystems: createPowerTickSystems(powerPerformanceContent),
  });
}

function measureStartupTransitionPaths(warmups: number, sampleCount: number) {
  const startupCompletionSamples: number[] = [];
  const followingTickRecalculationSamples: number[] = [];
  for (let iteration = 0; iteration < warmups + sampleCount; iteration += 1) {
    const core = createStartupTransitionCore(`power-startup-transition-${iteration}`);
    core.step();
    let start = process.hrtime.bigint();
    core.step();
    const startupCompletionMs = elapsed(start);
    start = process.hrtime.bigint();
    core.step();
    const followingTickRecalculationMs = elapsed(start);
    if (iteration >= warmups) {
      startupCompletionSamples.push(startupCompletionMs);
      followingTickRecalculationSamples.push(followingTickRecalculationMs);
    }
  }
  return {
    "startup-completion tick (warm topology)": summarize(startupCompletionSamples),
    "following-tick forced recalculation (warm topology)": summarize(
      followingTickRecalculationSamples,
    ),
  };
}

function profileOptimizedPhases(warmups: number, sampleCount: number): Record<string, Summary> {
  const state = createPowerPerformanceFixture("power-tick-profile");
  const topology = createPowerTopology(state.facility, powerPerformanceContent);
  const allocationScratch = createPowerAllocationScratch(topology);
  const validationScratch = createPowerTickValidationScratch(topology);
  const demandScratch = {};
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    const result = calculateFacilityPower(
      state,
      powerPerformanceContent,
      topology,
      allocationScratch,
      demandScratch,
    );
    state.facility.modules = result.modules;
    state.facility.power = result.power;
  }
  const powerSamples: number[] = [];
  const validationSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    let start = process.hrtime.bigint();
    const result = calculateFacilityPower(
      state,
      powerPerformanceContent,
      topology,
      allocationScratch,
      demandScratch,
    );
    powerSamples.push(elapsed(start));
    start = process.hrtime.bigint();
    assertValidPowerTickResult(state, result, topology, powerPerformanceContent, validationScratch);
    validationSamples.push(elapsed(start));
  }
  return {
    "forced cached Power recalculation proxy": summarize(powerSamples),
    "targeted validation after recalculation proxy": summarize(validationSamples),
  };
}

const summary = measureStep(100, 200);
const phases = profileOptimizedPhases(100, 200);
const startupPaths = measureStartupTransitionPaths(50, 200);
const format = (value: number) => value.toFixed(4);
const formatSummary = (value: Summary) =>
  `median=${format(value.medianMs)} ms, p95=${format(value.p95Ms)} ms, max=${format(value.maximumMs)} ms, samples=${value.sampleCount}`;

console.log("Task 6.1 complete production power-tick diagnostic (target p95 < 4 ms)");
console.log(
  `fixture: ${POWER_FIXTURE_WIDTH} x ${POWER_FIXTURE_HEIGHT}, modules=${POWER_FIXTURE_MODULE_COUNT}, sources=${POWER_FIXTURE_SOURCE_COUNT}, powerRoutes=${POWER_FIXTURE_ROUTE_COUNT}, contractedWatts=${POWER_FIXTURE_CONTRACTED_WATTS}, startupAndBrownout=true, sharedSourceAndSinkCapacity=true`,
);
console.log(`complete tick: ${formatSummary(summary)}`);
for (const [label, phase] of Object.entries(phases)) {
  console.log(`${label}: ${formatSummary(phase)}`);
}
for (const [label, pathSummary] of Object.entries(startupPaths)) {
  console.log(`${label}: ${formatSummary(pathSummary)}`);
}
console.log(
  "profiling note: the warmed complete tick uses the validated result-cache hit; forced recalculation and validation proxies show the dirty-input path and are not additive to the steady-state tick.",
);
console.log(
  "startup profiling note: fixture construction and the first topology-building tick are excluded; startup completion and following-tick recalculation are measured as separate production SimCore ticks.",
);
console.log(
  `machine: ${cpus()[0]?.model ?? "unknown CPU"}; ${process.platform} ${release()} ${process.arch}; Node ${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; V8 JIT with Node TypeScript type stripping`,
);
console.log(`target: ${summary.p95Ms < 4 ? "PASS" : "FAIL"}`);
