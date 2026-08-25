import { cpus } from "node:os";

import { calculateFacilityPower } from "../../src/sim/power/facilityPower.ts";
import { allocatePowerDelivery } from "../../src/sim/power/powerAllocation.ts";
import { calculatePowerDemand } from "../../src/sim/power/powerDemand.ts";
import { createPowerTopology } from "../../src/sim/power/powerTopology.ts";
import { applyPowerOperationalTransitions } from "../../src/sim/power/powerTransitions.ts";
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

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function measure(warmups: number, sampleCount: number) {
  const fixture = createPowerPerformanceFixture("power-domain-performance");
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    calculateFacilityPower(fixture, powerPerformanceContent);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const start = process.hrtime.bigint();
    calculateFacilityPower(fixture, powerPerformanceContent);
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    sampleCount,
  };
}

const summary = measure(50, 500);
const format = (value: number) => value.toFixed(4);
console.log("Task 6 pure power-domain diagnostic (target p95 < 1 ms on i7-2600)");
console.log(
  `fixture: ${POWER_FIXTURE_WIDTH} x ${POWER_FIXTURE_HEIGHT}, modules=${POWER_FIXTURE_MODULE_COUNT}, sources=${POWER_FIXTURE_SOURCE_COUNT}, powerRoutes=${POWER_FIXTURE_ROUTE_COUNT}, contractedWatts=${POWER_FIXTURE_CONTRACTED_WATTS}, startupAndBrownout=true, sharedSourceAndSinkCapacity=true`,
);
console.log(
  `median=${format(summary.medianMs)} ms, p95=${format(summary.p95Ms)} ms, max=${format(summary.maximumMs)} ms, samples=${summary.sampleCount}`,
);
console.log(
  `development machine: ${cpus()[0]?.model ?? "unknown CPU"}; ${process.platform} ${process.arch}; Node ${process.version}`,
);
if (summary.p95Ms >= 1) {
  const fixture = createPowerPerformanceFixture("power-domain-split");
  const demandSamples: number[] = [];
  const topologySamples: number[] = [];
  const allocationSamples: number[] = [];
  const transitionSamples: number[] = [];
  for (let sample = 0; sample < 200; sample += 1) {
    let start = process.hrtime.bigint();
    const demands = calculatePowerDemand(fixture.facility.modules, powerPerformanceContent);
    demandSamples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    start = process.hrtime.bigint();
    const topology = createPowerTopology(fixture.facility, powerPerformanceContent);
    topologySamples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    start = process.hrtime.bigint();
    const allocation = allocatePowerDelivery(
      fixture.facility,
      demands,
      topology,
      powerPerformanceContent,
    );
    allocationSamples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    start = process.hrtime.bigint();
    applyPowerOperationalTransitions(fixture.facility.modules, allocation.byModule);
    transitionSamples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  for (const [label, samples] of [
    ["demand", demandSamples],
    ["topology", topologySamples],
    ["allocation", allocationSamples],
    ["transitions", transitionSamples],
  ] as const) {
    const sorted = samples.toSorted((left, right) => left - right);
    console.log(
      `${label}: median=${format(percentile(sorted, 0.5))} ms, p95=${format(percentile(sorted, 0.95))} ms, max=${format(sorted.at(-1) ?? 0)} ms, samples=${samples.length}`,
    );
  }
}
