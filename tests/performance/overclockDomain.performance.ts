import { cpus, release } from "node:os";

import { SimCore } from "../../src/sim/core/simCore.ts";
import { createDirtyOverclockState } from "../../src/sim/overclock/overclockState.ts";
import { createOverclockCommandHandlers } from "../../src/sim/overclock/overclockCommands.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import {
  calculateFacilityOverclockResult,
  createFacilityOverclockCalculationScratch,
  validateOverclockTickResult,
} from "../../src/sim/overclock/overclockStabilityDomain.ts";
import {
  calculateFacilityPower,
  createPowerTickSystems,
} from "../../src/sim/power/facilityPower.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import { buildThermalTopology } from "../../src/sim/thermal/thermalDomain.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  createTask8PerformanceFixture,
  THERMAL_PERFORMANCE_HEIGHT,
  THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES,
  THERMAL_PERFORMANCE_WIDTH,
  thermalPerformanceContent,
} from "./thermalFixture.ts";

const WARMUPS = 100;
const PURE_SAMPLES = 500;
const PRODUCTION_SAMPLES = 200;

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

function summarize(samples: number[]): Summary {
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

function createReadyTask8Fixture(seed: string) {
  const state = createTask8PerformanceFixture(seed);
  const calculated = calculateFacilityPower(state, thermalPerformanceContent);
  return {
    ...state,
    facility: { ...state.facility, modules: calculated.modules, power: calculated.power },
  };
}

function createProductionCore(seed: string): SimCore {
  return new SimCore({
    initialState: createTask8PerformanceFixture(seed),
    commandHandlers: createOverclockCommandHandlers(thermalPerformanceContent),
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
      ...createOverclockTickSystems(thermalPerformanceContent),
    },
  });
}

function eligibleModuleId(state: ReturnType<SimCore["getStateForSave"]>): string {
  const moduleId = Object.keys(state.facility.modules)
    .toSorted()
    .find((candidate) => {
      const module = state.facility.modules[candidate];
      return (
        module !== undefined &&
        thermalPerformanceContent.modules[module.definitionId]?.overclockable
      );
    });
  if (moduleId === undefined) throw new Error("Task 8 fixture requires an eligible module.");
  return moduleId;
}

function measurePureFacilityDomain(): Summary {
  const state = createReadyTask8Fixture("task-8.5-pure");
  const topology = buildThermalTopology(state.facility, thermalPerformanceContent);
  const scratch = createFacilityOverclockCalculationScratch(thermalPerformanceContent, topology);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    calculateFacilityOverclockResult(state.facility, thermalPerformanceContent, topology, scratch);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < PURE_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    calculateFacilityOverclockResult(state.facility, thermalPerformanceContent, topology, scratch);
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureWarmProduction(): Summary {
  const core = createProductionCore("task-8.5-warm-production");
  core.step(WARMUPS);
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureOverclockSettingTransition(kind: "profile" | "manual"): Summary {
  const core = createProductionCore(`task-8.5-${kind}-change`);
  core.step(WARMUPS);
  const targetId = eligibleModuleId(core.getStateForSave());
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const commandId = `81000000-0000-4000-8000-${String(sample).padStart(12, "0")}`;
    core.enqueue(
      kind === "profile"
        ? {
            commandId,
            source: "player",
            kind: "SET_OVERCLOCK_PROFILE",
            moduleInstanceIds: [targetId],
            profile: sample % 2 === 0 ? "boost" : "eco",
          }
        : {
            commandId,
            source: "player",
            kind: "SET_MANUAL_OVERCLOCK",
            moduleInstanceIds: [targetId],
            frequencyRatio: sample % 2 === 0 ? 1.1734567 : 1.2265432,
            voltageRatio: sample % 2 === 0 ? 1.0467891 : 1.0932109,
          },
    );
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function withTargetTemperature(
  seed: string,
  kind: "thermal-factor" | "shutdown" | "cooldown-hold" | "cooldown-decrement" | "recovery",
) {
  const state = createReadyTask8Fixture(seed);
  const targetId = eligibleModuleId(state);
  const target = state.facility.modules[targetId];
  if (target === undefined) throw new Error("Task 8 lifecycle fixture target is missing.");
  const definition = thermalPerformanceContent.modules[target.definitionId];
  if (definition === undefined) throw new Error("Task 8 lifecycle fixture content is missing.");
  const topology = buildThermalTopology(state.facility, thermalPerformanceContent);
  const indexes = topology.occupiedTileIndexesByModule[targetId];
  if (indexes === undefined) throw new Error("Task 8 lifecycle fixture topology is missing.");
  const temperatureC =
    kind === "thermal-factor"
      ? (definition.thermal.warningMaxC + definition.thermal.criticalMaxC) / 2
      : kind === "shutdown" || kind === "cooldown-hold"
        ? definition.thermal.shutdownC + 5
        : definition.thermal.warningMaxC;
  state.facility.thermalTiles = state.facility.thermalTiles.map((tile, index) =>
    indexes.includes(index) ? { ...tile, temperatureC } : tile,
  );
  if (kind === "cooldown-hold" || kind === "cooldown-decrement" || kind === "recovery") {
    state.facility.modules = {
      ...state.facility.modules,
      [targetId]: {
        ...target,
        operationalState: "shutdown",
        cooldownTicksRemaining: kind === "recovery" ? 1 : 2,
        startupTicksRemaining: 0,
      },
    };
  }
  state.facility.overclock = createDirtyOverclockState();
  return state;
}

function measureLifecycleTransition(
  kind: "thermal-factor" | "shutdown" | "cooldown-hold" | "cooldown-decrement" | "recovery",
): Summary {
  const core = createProductionCore(`task-8.5-${kind}-runtime`);
  core.step(WARMUPS);
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    core.replaceState(withTargetTemperature(`task-8.5-${kind}-${sample}`, kind));
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function createDirtyLayoutFixture(seed: string) {
  const state = createTask8PerformanceFixture(seed);
  const moved = state.facility.modules["thermal-006"];
  if (moved?.definitionId !== "module-air-mover") {
    throw new Error("Task 8 cold fixture requires the audited thermal air mover.");
  }
  state.facility.modules = {
    ...state.facility.modules,
    [moved.id]: { ...moved, position: { x: 23, y: 15 } },
  };
  state.facility.liveLayoutRevision += 1;
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  state.facility.overclock = createDirtyOverclockState();
  return state;
}

function measureColdTopologyStateReplacement(): Summary {
  const core = createProductionCore("task-8.5-cold-runtime");
  core.step(WARMUPS);
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const replacement = createDirtyLayoutFixture(`task-8.5-cold-${sample}`);
    const start = process.hrtime.bigint();
    core.replaceState(replacement);
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureForcedValidation(): Summary {
  const state = createReadyTask8Fixture("task-8.5-validation");
  const topology = buildThermalTopology(state.facility, thermalPerformanceContent);
  const scratch = createFacilityOverclockCalculationScratch(thermalPerformanceContent, topology);
  const result = calculateFacilityOverclockResult(
    state.facility,
    thermalPerformanceContent,
    topology,
    scratch,
  );
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    if (
      validateOverclockTickResult(state.facility, thermalPerformanceContent, topology, result)
        .length
    ) {
      throw new Error("Task 8 forced-validation fixture is invalid.");
    }
  }
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    if (
      validateOverclockTickResult(state.facility, thermalPerformanceContent, topology, result)
        .length
    ) {
      throw new Error("Task 8 forced-validation fixture is invalid.");
    }
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

const pureDomain = measurePureFacilityDomain();
const warmProduction = measureWarmProduction();
const profileChange = measureOverclockSettingTransition("profile");
const manualChange = measureOverclockSettingTransition("manual");
const thermalFactorTransition = measureLifecycleTransition("thermal-factor");
const shutdown = measureLifecycleTransition("shutdown");
const cooldownHold = measureLifecycleTransition("cooldown-hold");
const cooldownDecrement = measureLifecycleTransition("cooldown-decrement");
const recoveryRestart = measureLifecycleTransition("recovery");
const forcedValidation = measureForcedValidation();
const coldReplacement = measureColdTopologyStateReplacement();

console.log("Task 8.5 final Overclock performance diagnostic");
console.log(
  `fixture: extends Task 7 dense ${THERMAL_PERFORMANCE_WIDTH} x ${THERMAL_PERFORMANCE_HEIGHT}, occupied>=${THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES}, mixed footprints/rotations, Power contention, airflow, extraction, nonuniform temperatures, and Eco/Balanced/Boost/Manual across all three eligible definitions.`,
);
console.log(`warm pure full-facility Task 8 domain: ${format(pureDomain)}`);
console.log(`warm full production tick: ${format(warmProduction)}`);
console.log(`profile-setting transition production tick: ${format(profileChange)}`);
console.log(`Manual-setting transition production tick: ${format(manualChange)}`);
console.log(`Thermal Factor transition production tick: ${format(thermalFactorTransition)}`);
console.log(`thermal-shutdown transition production tick: ${format(shutdown)}`);
console.log(`cooldown-hold transition production tick: ${format(cooldownHold)}`);
console.log(`cooldown-decrement transition production tick: ${format(cooldownDecrement)}`);
console.log(`recovery and restart transition production tick: ${format(recoveryRestart)}`);
console.log(`forced complete-result validation: ${format(forcedValidation)}`);
console.log(`cold topology plus state-replacement production path: ${format(coldReplacement)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT; warmups=${WARMUPS} excluded per warm path.`,
);
console.log(
  `hard targets: pure Task 8 p95 < 0.25 ms=${pureDomain.p95Ms < 0.25 ? "PASS" : "FAIL"}; warm complete production p95 < 4 ms=${warmProduction.p95Ms < 4 ? "PASS" : "FAIL"}; preferred production p95 < 3 ms=${warmProduction.p95Ms < 3 ? "PASS" : "REPORT"}.`,
);
if (pureDomain.p95Ms >= 0.25 || warmProduction.p95Ms >= 4) {
  throw new Error("Task 8.5 hard performance gate failed.");
}
