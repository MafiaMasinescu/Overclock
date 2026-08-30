import { cpus, release } from "node:os";

import {
  buildComputeTopology,
  calculateFacilityCompute,
  calculateFacilityComputeWithWitness,
  validateFreshComputeWitness,
} from "../../src/sim/compute/computeDomain.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
  THERMAL_PERFORMANCE_HEIGHT,
  THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES,
  THERMAL_PERFORMANCE_WIDTH,
} from "./thermalFixture.ts";

const COLD_SAMPLES = 200;
const WARM_PURE_SAMPLES = 500;
const PRODUCTION_SAMPLES = 200;
const WARMUPS = 100;

interface Summary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly sampleCount: number;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): Summary {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    sampleCount: samples.length,
  };
}

function format(summary: Summary): string {
  return `median=${summary.medianMs.toFixed(4)} ms, p95=${summary.p95Ms.toFixed(4)} ms, max=${summary.maximumMs.toFixed(4)} ms, samples=${summary.sampleCount}`;
}

function createProductionCore(seed: string): SimCore {
  return new SimCore({
    initialState: createTask9PerformanceFixture(seed),
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
      ...createOverclockTickSystems(thermalPerformanceContent),
      ...createComputeTickSystems(thermalPerformanceContent),
    },
  });
}

function readyState(seed: string) {
  const core = createProductionCore(seed);
  core.step(3);
  return core.getStateForSave();
}

function measureColdTopology(): Summary {
  const facility = createTask9PerformanceFixture("task-9-cold").facility;
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    buildComputeTopology(facility, thermalPerformanceContent);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < COLD_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    buildComputeTopology(facility, thermalPerformanceContent);
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureWarmPure(): Summary {
  const state = readyState("task-9-warm-pure");
  const topology = buildComputeTopology(state.facility, thermalPerformanceContent);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    calculateFacilityCompute(state, thermalPerformanceContent, topology);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < WARM_PURE_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    calculateFacilityCompute(state, thermalPerformanceContent, topology);
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureWarmProduction(): Summary {
  const core = createProductionCore("task-9-warm-production");
  core.step(WARMUPS);
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureDynamicRecalculation(): Summary {
  const state = readyState("task-9-dynamic");
  const topology = buildComputeTopology(state.facility, thermalPerformanceContent);
  const congested = structuredClone(state);
  const route = congested.facility.routes["data-control-memory"];
  const task = congested.tasks.instances["task-9-bandwidth"];
  const allocation = task?.allocation;
  if (
    route === undefined ||
    task === undefined ||
    allocation === null ||
    allocation === undefined
  ) {
    throw new Error("Task 9 dynamic diagnostic fixture is incomplete.");
  }
  congested.facility.routes["data-control-memory"] = { ...route, congestionRatio: 0.7 };
  congested.tasks.instances["task-9-bandwidth"] = {
    ...task,
    allocation: { ...allocation, requestedShare: 0.4 },
  };
  const dynamicTopology = buildComputeTopology(congested.facility, thermalPerformanceContent);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    calculateFacilityCompute(
      warmup % 2 === 0 ? state : congested,
      thermalPerformanceContent,
      warmup % 2 === 0 ? topology : dynamicTopology,
    );
  }
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const dynamic = sample % 2 === 0;
    const start = process.hrtime.bigint();
    calculateFacilityCompute(
      dynamic ? congested : state,
      thermalPerformanceContent,
      dynamic ? dynamicTopology : topology,
    );
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureLifecycleTransitions(): Summary {
  const state = readyState("task-9-transitions");
  const starting = structuredClone(state);
  const shutdown = structuredClone(state);
  const startingModule = starting.facility.modules["thermal-003"];
  const shutdownModule = shutdown.facility.modules["thermal-008"];
  if (startingModule === undefined || shutdownModule === undefined) {
    throw new Error("Task 9 transition diagnostic fixture is incomplete.");
  }
  starting.facility.modules["thermal-003"] = {
    ...startingModule,
    operationalState: "starting",
    startupTicksRemaining: 1,
  };
  shutdown.facility.modules["thermal-008"] = {
    ...shutdownModule,
    operationalState: "shutdown",
    cooldownTicksRemaining: 1,
  };
  const startingTopology = buildComputeTopology(starting.facility, thermalPerformanceContent);
  const shutdownTopology = buildComputeTopology(shutdown.facility, thermalPerformanceContent);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    calculateFacilityCompute(
      warmup % 2 === 0 ? starting : shutdown,
      thermalPerformanceContent,
      warmup % 2 === 0 ? startingTopology : shutdownTopology,
    );
  }
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const startup = sample % 2 === 0;
    const start = process.hrtime.bigint();
    calculateFacilityCompute(
      startup ? starting : shutdown,
      thermalPerformanceContent,
      startup ? startingTopology : shutdownTopology,
    );
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureFreshCalculationAndValidation(): {
  readonly calculation: Summary;
  readonly validation: Summary;
} {
  const state = readyState("task-9-validation");
  const topology = buildComputeTopology(state.facility, thermalPerformanceContent);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    const calculation = calculateFacilityComputeWithWitness(
      state,
      thermalPerformanceContent,
      topology,
    );
    if (
      validateFreshComputeWitness(
        state,
        thermalPerformanceContent,
        calculation.compute,
        calculation.witness,
        topology,
      ).length
    ) {
      throw new Error("Task 9 validation diagnostic calculation is invalid.");
    }
  }
  const calculationSamples: number[] = [];
  const validationSamples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const calculationStart = process.hrtime.bigint();
    const calculation = calculateFacilityComputeWithWitness(
      state,
      thermalPerformanceContent,
      topology,
    );
    calculationSamples.push(elapsedMs(calculationStart));
    const validationStart = process.hrtime.bigint();
    if (
      validateFreshComputeWitness(
        state,
        thermalPerformanceContent,
        calculation.compute,
        calculation.witness,
        topology,
      ).length
    ) {
      throw new Error("Task 9 validation diagnostic calculation is invalid.");
    }
    validationSamples.push(elapsedMs(validationStart));
  }
  return {
    calculation: summarize(calculationSamples),
    validation: summarize(validationSamples),
  };
}

function fixtureStatistics(): string {
  const state = createTask9PerformanceFixture("task-9-fixture-statistics");
  const moduleIds = Object.keys(state.facility.modules);
  const routes = Object.values(state.facility.routes);
  const allocations = Object.values(state.tasks.instances).flatMap((task) =>
    task.allocation === null ? [] : [task.allocation],
  );
  const useCount = new Map<string, number>();
  for (const allocation of allocations) {
    for (const moduleId of allocation.clusterModuleIds) {
      useCount.set(moduleId, (useCount.get(moduleId) ?? 0) + 1);
    }
  }
  const sharedModules = [...useCount.values()].filter((count) => count > 1).length;
  const transitionModules = moduleIds.filter((moduleId) => {
    const lifecycle = state.facility.modules[moduleId]?.operationalState;
    return lifecycle === "starting" || lifecycle === "shutdown";
  }).length;
  return [
    `modules=${moduleIds.length}`,
    `routes=${routes.length}`,
    `routePathPoints=${routes.reduce((total, route) => total + route.path.length, 0)}`,
    `activeAllocations=${allocations.length}`,
    `sharedModules=${sharedModules}`,
    `transitionModules=${transitionModules}`,
    `inventoryStacks=${Object.keys(state.inventory.stacks).length}`,
  ].join(", ");
}

const coldTopology = measureColdTopology();
const warmPure = measureWarmPure();
const warmProduction = measureWarmProduction();
const dynamicRecalculation = measureDynamicRecalculation();
const lifecycleTransitions = measureLifecycleTransitions();
const fresh = measureFreshCalculationAndValidation();

console.log("Task 9.4 audited Useful Compute diagnostic");
console.log(
  `fixture: extends Task 7/8 ${THERMAL_PERFORMANCE_WIDTH} x ${THERMAL_PERFORMANCE_HEIGHT}, occupied>=${THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES}, mixed footprints/rotations, Power contention, airflow, extraction, nonuniform temperatures, active shared allocations, directed and bidirectional data routes, real route lengths/congestion, startup and shutdown inputs.`,
);
console.log(`fixture statistics: ${fixtureStatistics()}`);
console.log(`cold compute topology construction: ${format(coldTopology)}`);
console.log(`warm pure Task 9 module and task calculation: ${format(warmPure)}`);
console.log(`warm complete production tick through Task 9: ${format(warmProduction)}`);
console.log(`changed congestion and allocation recalculation: ${format(dynamicRecalculation)}`);
console.log(`startup and shutdown transition paths: ${format(lifecycleTransitions)}`);
console.log(`fresh calculate-once Compute result and witness: ${format(fresh.calculation)}`);
console.log(`fresh exact Compute witness validation: ${format(fresh.validation)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT; warmups=${WARMUPS} excluded; fixture construction is excluded.`,
);
console.log(
  `hard targets: warm pure Task 9 p95 < 0.35 ms=${warmPure.p95Ms < 0.35 ? "PASS" : "FAIL"}; complete production p95 < 4 ms=${warmProduction.p95Ms < 4 ? "PASS" : "FAIL"}; existing thermal/Overclock targets are reported by their unchanged diagnostics; preferred production p95 < 3.7 ms=${warmProduction.p95Ms < 3.7 ? "PASS" : "REPORT"}.`,
);
if (warmPure.p95Ms >= 0.35 || warmProduction.p95Ms >= 4) {
  throw new Error("Task 9.4 hard performance gate failed.");
}
