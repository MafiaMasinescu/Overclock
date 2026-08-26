import { cpus, release } from "node:os";

import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createPowerTopology } from "../../src/sim/power/powerTopology.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
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

function measureWarmPower(warmups: number, sampleCount: number): Summary {
  let state = createPowerPerformanceFixture("power-domain-performance");
  const registration =
    createPowerTickSystems(powerPerformanceContent)["calculate-power-demand-and-delivery"];
  if (registration === undefined || typeof registration === "function") {
    throw new Error("Power performance runtime factory is missing.");
  }
  const runtime = registration.createRuntime();
  if (runtime.executionMode !== "structural-sharing") {
    throw new Error("Power performance runtime must use structural sharing.");
  }
  runtime.clearDerivedState?.();
  runtime.validateLifecycleState?.(state);
  const rng = createSeededRngFromState(state.rngState);
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    state = runtime.run({ state, rng });
  }
  const samples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const start = process.hrtime.bigint();
    state = runtime.run({ state, rng });
    samples.push(elapsed(start));
  }
  return summarize(samples);
}

function measureColdTopology(warmups: number, sampleCount: number): Summary {
  const fixture = createPowerPerformanceFixture("power-topology-reconstruction");
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    createPowerTopology(fixture.facility, powerPerformanceContent);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const start = process.hrtime.bigint();
    createPowerTopology(fixture.facility, powerPerformanceContent);
    samples.push(elapsed(start));
  }
  return summarize(samples);
}

const warmPower = measureWarmPower(200, 500);
const coldTopology = measureColdTopology(50, 200);
const format = (value: number) => value.toFixed(4);
const formatSummary = (summary: Summary) =>
  `median=${format(summary.medianMs)} ms, p95=${format(summary.p95Ms)} ms, max=${format(summary.maximumMs)} ms, samples=${summary.sampleCount}`;

console.log("Task 6.1 warmed steady-state pure Power runtime diagnostic (target p95 < 1 ms)");
console.log(
  `fixture: ${POWER_FIXTURE_WIDTH} x ${POWER_FIXTURE_HEIGHT}, modules=${POWER_FIXTURE_MODULE_COUNT}, sources=${POWER_FIXTURE_SOURCE_COUNT}, powerRoutes=${POWER_FIXTURE_ROUTE_COUNT}, contractedWatts=${POWER_FIXTURE_CONTRACTED_WATTS}, startupAndBrownout=true, sharedSourceAndSinkCapacity=true`,
);
console.log(`warm topology/result cache hit: ${formatSummary(warmPower)}`);
console.log(
  `cold topology reconstruction (fixture setup excluded): ${formatSummary(coldTopology)}`,
);
console.log(
  `machine: ${cpus()[0]?.model ?? "unknown CPU"}; ${process.platform} ${release()} ${process.arch}; Node ${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; V8 JIT with Node TypeScript type stripping`,
);
console.log(`target: ${warmPower.p95Ms < 1 ? "PASS" : "FAIL"}`);
