import { cpus, release } from "node:os";

import { SimCore } from "../../src/sim/core/simCore.ts";
import {
  calculateFacilityPower,
  createPowerTickSystems,
} from "../../src/sim/power/facilityPower.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  assertValidThermalTickResult,
  buildThermalTopology,
  calculateHeatGeneration,
  updateThermalState,
  validateThermalGeneration,
} from "../../src/sim/thermal/thermalDomain.ts";
import { assertValidThermalState } from "../../src/sim/thermal/thermalState.ts";
import {
  createThermalPerformanceFixture,
  THERMAL_PERFORMANCE_HEIGHT,
  THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES,
  THERMAL_PERFORMANCE_WIDTH,
  thermalPerformanceContent,
} from "./thermalFixture.ts";

const COLD_SAMPLES = 200;
const WARM_PURE_SAMPLES = 500;
const PRODUCTION_SAMPLES = 200;
const WARMUP_ITERATIONS = 100;

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
    sampleCount: sorted.length,
  };
}

function formatSummary(summary: Summary): string {
  return `median=${summary.medianMs.toFixed(4)} ms, p95=${summary.p95Ms.toFixed(4)} ms, max=${summary.maximumMs.toFixed(4)} ms, samples=${summary.sampleCount}`;
}

function createReadyThermalState(seed: string) {
  const state = createThermalPerformanceFixture(seed);
  const calculated = calculateFacilityPower(state, thermalPerformanceContent);
  return {
    ...state,
    facility: {
      ...state.facility,
      modules: calculated.modules,
      power: calculated.power,
    },
  };
}

function createProductionCore(seed: string): SimCore {
  return new SimCore({
    initialState: createThermalPerformanceFixture(seed),
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
    },
  });
}

function measureColdTopology(): Summary {
  const facility = createThermalPerformanceFixture("thermal-cold-topology").facility;
  for (let warmup = 0; warmup < WARMUP_ITERATIONS; warmup += 1) {
    buildThermalTopology(facility, thermalPerformanceContent);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < COLD_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    buildThermalTopology(facility, thermalPerformanceContent);
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureWarmPureDomain(): Summary {
  const state = createReadyThermalState("thermal-warm-pure");
  const topology = buildThermalTopology(state.facility, thermalPerformanceContent);
  const generationScratch = {
    heatWattsOnTile: new Float64Array(topology.tileCount),
    localCoolingWattsOnTile: new Float64Array(topology.tileCount),
  };
  const updateScratch = { nextTemperatureC: new Float64Array(topology.tileCount) };
  for (let warmup = 0; warmup < WARMUP_ITERATIONS; warmup += 1) {
    const generation = calculateHeatGeneration(
      state.facility,
      thermalPerformanceContent,
      topology,
      generationScratch,
    );
    updateThermalState(
      state.facility,
      generation,
      thermalPerformanceContent.balancing.thermal,
      0.1,
      updateScratch,
    );
  }
  const samples: number[] = [];
  for (let sample = 0; sample < WARM_PURE_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    const generation = calculateHeatGeneration(
      state.facility,
      thermalPerformanceContent,
      topology,
      generationScratch,
    );
    updateThermalState(
      state.facility,
      generation,
      thermalPerformanceContent.balancing.thermal,
      0.1,
      updateScratch,
    );
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureWarmProductionTick(): Summary {
  const core = createProductionCore("thermal-warm-production");
  core.step(WARMUP_ITERATIONS);
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function createDirtyLayoutFixture(seed: string) {
  const state = createThermalPerformanceFixture(seed);
  const moved = state.facility.modules["thermal-006"];
  if (moved?.definitionId !== "module-air-mover") {
    throw new Error("Thermal dirty-layout fixture requires the audited air mover.");
  }
  state.facility.modules = {
    ...state.facility.modules,
    [moved.id]: { ...moved, position: { x: 23, y: 15 } },
  };
  state.facility.liveLayoutRevision += 1;
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  return state;
}

function measureDirtyLayoutRebuild(): Summary {
  const samples: number[] = [];
  for (let iteration = 0; iteration < WARMUP_ITERATIONS + PRODUCTION_SAMPLES; iteration += 1) {
    const core = createProductionCore(`thermal-dirty-warm-${iteration}`);
    core.step(2);
    core.replaceState(createDirtyLayoutFixture(`thermal-dirty-${iteration}`));
    const start = process.hrtime.bigint();
    core.step();
    if (iteration >= WARMUP_ITERATIONS) samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureStartupTransition(): Summary {
  const samples: number[] = [];
  for (let iteration = 0; iteration < WARMUP_ITERATIONS + PRODUCTION_SAMPLES; iteration += 1) {
    const core = createProductionCore(`thermal-startup-${iteration}`);
    core.step();
    const start = process.hrtime.bigint();
    core.step();
    if (iteration >= WARMUP_ITERATIONS) samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureForcedThermalValidation(): Summary {
  const state = createReadyThermalState("thermal-validation");
  const topology = buildThermalTopology(state.facility, thermalPerformanceContent);
  const generation = calculateHeatGeneration(state.facility, thermalPerformanceContent, topology);
  const update = updateThermalState(
    state.facility,
    generation,
    thermalPerformanceContent.balancing.thermal,
    0.1,
  );
  for (let warmup = 0; warmup < WARMUP_ITERATIONS; warmup += 1) {
    assertValidThermalState(state.facility, thermalPerformanceContent.balancing.thermal);
    if (validateThermalGeneration(generation, topology.tileCount).length > 0) {
      throw new Error("Thermal validation fixture generation is invalid.");
    }
    assertValidThermalTickResult(
      state.facility,
      generation,
      update,
      thermalPerformanceContent.balancing.thermal,
    );
  }
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    assertValidThermalState(state.facility, thermalPerformanceContent.balancing.thermal);
    if (validateThermalGeneration(generation, topology.tileCount).length > 0) {
      throw new Error("Thermal validation fixture generation is invalid.");
    }
    assertValidThermalTickResult(
      state.facility,
      generation,
      update,
      thermalPerformanceContent.balancing.thermal,
    );
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

const coldTopology = measureColdTopology();
const warmPure = measureWarmPureDomain();
const warmProduction = measureWarmProductionTick();
const dirtyLayout = measureDirtyLayoutRebuild();
const startupTransition = measureStartupTransition();
const thermalValidation = measureForcedThermalValidation();

console.log("Task 7.4 audited thermal diagnostic");
console.log(
  `fixture: ${THERMAL_PERFORMANCE_WIDTH} x ${THERMAL_PERFORMANCE_HEIGHT}, occupied>=${THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES}, mixed footprints=1x1..3x2, rotations=0/90/180/270, Power routes with shared source/sink capacity, startup/brownout, local airflow, extraction, nonuniform temperatures`,
);
console.log(`cold thermal topology construction: ${formatSummary(coldTopology)}`);
console.log(`warm pure heat generation plus update: ${formatSummary(warmPure)}`);
console.log(`warm complete Power plus thermal production tick: ${formatSummary(warmProduction)}`);
console.log(`dirty-layout rebuild production tick: ${formatSummary(dirtyLayout)}`);
console.log(`startup Power-transition production tick: ${formatSummary(startupTransition)}`);
console.log(`forced thermal validation path: ${formatSummary(thermalValidation)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT`,
);
console.log(
  `warm-up: ${WARMUP_ITERATIONS} unmeasured iterations per direct path; fixture construction and state replacement are outside the measured interval; production transition paths use ${WARMUP_ITERATIONS} unmeasured fresh cores before ${PRODUCTION_SAMPLES} measured cores.`,
);
console.log(
  `targets: warm pure p95 < 0.5 ms=${warmPure.p95Ms < 0.5 ? "PASS" : "FAIL"}; complete production p95 < 4 ms=${warmProduction.p95Ms < 4 ? "PASS" : "FAIL"}; preferred warm production p95 < 1 ms=${warmProduction.p95Ms < 1 ? "PASS" : "REPORT"}`,
);
