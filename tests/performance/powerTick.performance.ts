import { cpus } from "node:os";

import { SimCore } from "../../src/sim/core/simCore.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import {
  calculateFacilityPower,
  createPowerTickSystems,
} from "../../src/sim/power/facilityPower.ts";
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

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function profilePhases(sampleCount: number): Record<string, Summary> {
  const fixture = createPowerPerformanceFixture("power-tick-profile");
  const cloneSamples: number[] = [];
  const canonicalSamples: number[] = [];
  const powerSamples: number[] = [];
  const freezeCommitSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    let start = process.hrtime.bigint();
    const candidate = structuredClone(fixture);
    cloneSamples.push(elapsed(start));

    start = process.hrtime.bigint();
    canonicalSerialize(candidate);
    canonicalSamples.push(elapsed(start));

    start = process.hrtime.bigint();
    const calculation = calculateFacilityPower(candidate, powerPerformanceContent);
    powerSamples.push(elapsed(start));

    candidate.facility.modules = calculation.modules;
    candidate.facility.power = calculation.power;
    start = process.hrtime.bigint();
    deepFreeze(candidate);
    const committed = { ...candidate, tick: candidate.tick + 1 };
    void committed;
    freezeCommitSamples.push(elapsed(start));
  }
  return {
    "candidate cloning": summarize(cloneSamples),
    "canonical validation": summarize(canonicalSamples),
    "power calculation": summarize(powerSamples),
    "freezing and commit": summarize(freezeCommitSamples),
  };
}

const summary = measureStep(20, 200);
const format = (value: number) => value.toFixed(4);
console.log("Task 6 complete production power-tick diagnostic (vertical-slice gate p95 < 4 ms)");
console.log(
  `fixture: ${POWER_FIXTURE_WIDTH} x ${POWER_FIXTURE_HEIGHT}, modules=${POWER_FIXTURE_MODULE_COUNT}, sources=${POWER_FIXTURE_SOURCE_COUNT}, powerRoutes=${POWER_FIXTURE_ROUTE_COUNT}, contractedWatts=${POWER_FIXTURE_CONTRACTED_WATTS}, startupAndBrownout=true, sharedSourceAndSinkCapacity=true`,
);
console.log(
  `median=${format(summary.medianMs)} ms, p95=${format(summary.p95Ms)} ms, max=${format(summary.maximumMs)} ms, samples=${summary.sampleCount}`,
);
console.log(
  `development machine: ${cpus()[0]?.model ?? "unknown CPU"}; ${process.platform} ${process.arch}; Node ${process.version}`,
);
if (summary.p95Ms > 4) {
  console.log(
    "p95 exceeded 4 ms on this development machine; isolated phase proxies and residual follow:",
  );
  const phases = profilePhases(100);
  let proxyMedianTotal = 0;
  let proxyP95Total = 0;
  for (const [label, phase] of Object.entries(phases)) {
    proxyMedianTotal += phase.medianMs;
    proxyP95Total += phase.p95Ms;
    console.log(
      `${label}: median=${format(phase.medianMs)} ms, p95=${format(phase.p95Ms)} ms, max=${format(phase.maximumMs)} ms, samples=${phase.sampleCount}`,
    );
  }
  console.log(
    `stage validation/orchestration residual: median=${format(Math.max(0, summary.medianMs - proxyMedianTotal))} ms, p95=${format(Math.max(0, summary.p95Ms - proxyP95Total))} ms (derived from complete step minus isolated proxies)`,
  );
  console.log(
    "profiling note: phase proxies run the same operations in isolation; the residual includes SimCore system-field, RNG, inventory, Design Mode, and power invariant validation plus cross-phase runtime effects.",
  );
}
