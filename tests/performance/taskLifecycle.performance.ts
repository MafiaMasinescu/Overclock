import { cpus, release } from "node:os";

import { SimCore } from "../../src/sim/core/simCore.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import type { GameState, TaskInstanceState } from "../../src/sim/core/types.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createTaskCommandHandlers } from "../../src/sim/tasks/taskCommands.ts";
import { advanceTaskSystem, validateFreshTaskAdvance } from "../../src/sim/tasks/taskDomain.ts";
import { createTaskTickSystems } from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import {
  createTask9PerformanceFixture,
  thermalPerformanceContent,
  THERMAL_PERFORMANCE_HEIGHT,
  THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES,
  THERMAL_PERFORMANCE_WIDTH,
} from "./thermalFixture.ts";

const WARMUPS = 100;
const PURE_SAMPLES = 1_000;
const PRODUCTION_SAMPLES = 200;
const PROGRESS_SAMPLES = 500;
const TRANSITION_SAMPLES = 200;

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

function task(state: Readonly<GameState>, id: string): TaskInstanceState {
  const instance = state.tasks.instances[id];
  if (instance === undefined) throw new Error(`Task 10 performance fixture lacks ${id}.`);
  return instance;
}

function createTask10Fixture(seed: string): GameState {
  const state = createTask9PerformanceFixture(seed);
  const service = task(state, "task-9-bandwidth");
  state.tasks.instances[service.id] = { ...service, serviceWindowCompliant: true };
  return state;
}

function createProductionCore(seed: string): SimCore {
  return new SimCore({
    initialState: createTask10Fixture(seed),
    commandHandlers: createTaskCommandHandlers(thermalPerformanceContent),
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
      ...createOverclockTickSystems(thermalPerformanceContent),
      ...createComputeTickSystems(thermalPerformanceContent),
      ...createTaskTickSystems(thermalPerformanceContent),
    },
  });
}

function readyState(seed: string): GameState {
  const core = createProductionCore(seed);
  core.step(5);
  const state = core.getStateForSave();
  const project = task(state, "task-9-serial");
  const service = task(state, "task-9-bandwidth");
  if (
    project.allocation?.deliveredUsefulComputeFlops === undefined ||
    project.allocation.deliveredUsefulComputeFlops <= 0 ||
    service.allocation?.deliveredUsefulComputeFlops === undefined ||
    service.allocation.deliveredUsefulComputeFlops <= 0
  ) {
    throw new Error("Task 10 performance fixture requires positive shared Task 9 delivery.");
  }
  return state;
}

function measure(operation: () => void, warmups: number, samples: number): Summary {
  for (let warmup = 0; warmup < warmups; warmup += 1) operation();
  const values: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const start = process.hrtime.bigint();
    operation();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function measureWarmPure(): Summary {
  const state = readyState("task-10-warm-pure");
  return measure(() => advanceTaskSystem(state, thermalPerformanceContent), WARMUPS, PURE_SAMPLES);
}

function measureWarmProduction(): Summary {
  const core = createProductionCore("task-10-warm-production");
  core.step(WARMUPS);
  const samples: number[] = [];
  for (let sample = 0; sample < PRODUCTION_SAMPLES; sample += 1) {
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMs(start));
  }
  return summarize(samples);
}

function measureTwoTaskProgress(): Summary {
  const state = readyState("task-10-two-task-progress");
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    PROGRESS_SAMPLES,
  );
}

function withEligibleOffers(seed: string): GameState {
  const state = structuredClone(readyState(seed));
  state.campaign.currentYear = 1948;
  state.research.statuses = Object.fromEntries(
    Object.keys(state.research.statuses)
      .toSorted()
      .map((researchId) => [researchId, "completed"]),
  );
  state.tasks.offers = [];
  return state;
}

function measureOfferReconciliation(): Summary {
  const state = withEligibleOffers("task-10-offers");
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function withProjectAtPhaseBoundary(seed: string, completeFinalPhase: boolean): GameState {
  const state = structuredClone(readyState(seed));
  const project = task(state, "task-9-serial");
  const definition = thermalPerformanceContent.tasks[project.definitionId];
  const delivery = project.allocation?.deliveredUsefulComputeFlops;
  if (definition === undefined || delivery === undefined || delivery <= 0) {
    throw new Error("Task 10 phase fixture requires the project definition and delivery.");
  }
  const phaseIndex = completeFinalPhase ? definition.phases.length - 1 : 0;
  const phase = definition.phases[phaseIndex];
  if (phase === undefined) throw new Error("Task 10 phase fixture lacks its selected phase.");
  const appliedOperations = delivery * 0.1;
  if (appliedOperations >= phase.operations) {
    throw new Error("Task 10 phase fixture delivery must not exceed a whole phase.");
  }
  const completedPriorOperations = definition.phases
    .slice(0, phaseIndex)
    .reduce((total, candidate) => total + candidate.operations, 0);
  state.tasks.instances[project.id] = {
    ...project,
    currentPhaseIndex: phaseIndex,
    phaseCompletedOperations: phase.operations - appliedOperations,
    totalCompletedOperations: completedPriorOperations + phase.operations - appliedOperations,
  };
  const result = state.facility.compute.byTask[project.id];
  if (result === undefined) throw new Error("Task 10 phase fixture lacks its Task 9 result.");
  state.facility.compute = {
    ...state.facility.compute,
    byTask: {
      ...state.facility.compute.byTask,
      [project.id]: { ...result, phaseIndex },
    },
  };
  return state;
}

function measurePhaseCompletion(): Summary {
  const state = withProjectAtPhaseBoundary("task-10-phase", false);
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function withDeadlineDue(seed: string): GameState {
  const state = structuredClone(readyState(seed));
  const project = task(state, "task-9-serial");
  state.tasks.instances[project.id] = { ...project, deadlineTick: state.tick };
  return state;
}

function measureDeadlineTransition(): Summary {
  const state = withDeadlineDue("task-10-deadline");
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function withServicePayoutDue(seed: string, serviceWindowCompliant = true): GameState {
  const state = structuredClone(readyState(seed));
  const service = task(state, "task-9-bandwidth");
  const definition = thermalPerformanceContent.tasks[service.definitionId];
  const intervalSeconds = definition?.periodicPayoutSeconds;
  if (intervalSeconds === null || intervalSeconds === undefined) {
    throw new Error("Task 10 SLA fixture requires a service interval.");
  }
  const intervalTicks = intervalSeconds * 10;
  state.tick = intervalTicks;
  state.clock = { ...state.clock, simulatedSeconds: intervalSeconds };
  state.tasks.instances[service.id] = {
    ...service,
    acceptedAtTick: 1,
    serviceWindowCompliant,
  };
  return state;
}

function measureSlaPayout(): Summary {
  const state = withServicePayoutDue("task-10-sla");
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function measureInterruptedSlaWindow(): Summary {
  const state = withServicePayoutDue("task-10-sla-interrupted", false);
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function measureCompletionRewards(): Summary {
  const state = withProjectAtPhaseBoundary("task-10-completion", true);
  return measure(
    () => advanceTaskSystem(state, thermalPerformanceContent),
    WARMUPS,
    TRANSITION_SAMPLES,
  );
}

function createCommandCore(seed: string): SimCore {
  return new SimCore({
    initialState: createTask10Fixture(seed),
    commandHandlers: createTaskCommandHandlers(thermalPerformanceContent),
  });
}

function commandId(path: string, iteration: number): string {
  const encodedPath = path.charCodeAt(0).toString().padStart(4, "0");
  return `10000000-0000-4000-8000-${encodedPath}${String(iteration).padStart(8, "0")}`;
}

function measureCommand(
  path: string,
  createCore: (iteration: number) => SimCore,
  createCommand: (iteration: number) => SimCommand,
): Summary {
  const run = (iteration: number, collect: boolean): number | undefined => {
    const core = createCore(iteration);
    core.enqueue(createCommand(iteration));
    const start = process.hrtime.bigint();
    const [result] = core.processPendingCommands();
    const elapsed = elapsedMs(start);
    if (result?.accepted !== true)
      throw new Error(`Task command ${path} was unexpectedly rejected.`);
    return collect ? elapsed : undefined;
  };
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) run(warmup, false);
  const samples: number[] = [];
  for (let sample = 0; sample < TRANSITION_SAMPLES; sample += 1) {
    const value = run(WARMUPS + sample, true);
    if (value === undefined) throw new Error("Task command measurement omitted a sample.");
    samples.push(value);
  }
  return summarize(samples);
}

function measureCommandAcceptance(): Summary {
  return measureCommand(
    "acceptance",
    (iteration) =>
      new SimCore({
        initialState: createInitialGameState({
          content: thermalPerformanceContent,
          seed: `task-10-accept-${iteration}`,
        }),
        commandHandlers: createTaskCommandHandlers(thermalPerformanceContent),
      }),
    (iteration) => ({
      commandId: commandId("a", iteration),
      source: "debug",
      kind: "ACCEPT_TASK",
      definitionId: "task-ballistic-table-verification",
    }),
  );
}

function measureCommandAllocation(): Summary {
  return measureCommand(
    "allocation",
    (iteration) => createCommandCore(`task-10-allocation-${iteration}`),
    (iteration) => ({
      commandId: commandId("l", iteration),
      source: "debug",
      kind: "ALLOCATE_TASK",
      taskInstanceId: "task-9-serial",
      clusterModuleIds: ["thermal-004", "thermal-003"],
      requestedShare: 0.5,
    }),
  );
}

function measureCommandHold(): Summary {
  return measureCommand(
    "hold",
    (iteration) => createCommandCore(`task-10-hold-${iteration}`),
    (iteration) => ({
      commandId: commandId("h", iteration),
      source: "debug",
      kind: "SET_TASK_HOLD",
      taskInstanceId: "task-9-serial",
      hold: true,
    }),
  );
}

function measureCommandRecovery(): Summary {
  return measureCommand(
    "recovery",
    (iteration) => {
      const core = createCommandCore(`task-10-recovery-${iteration}`);
      core.enqueue({
        commandId: commandId("r", iteration),
        source: "debug",
        kind: "SET_TASK_HOLD",
        taskInstanceId: "task-9-serial",
        hold: true,
      });
      const [held] = core.processPendingCommands();
      if (held?.accepted !== true) throw new Error("Task recovery setup could not hold the task.");
      return core;
    },
    (iteration) => ({
      commandId: commandId("R", iteration),
      source: "debug",
      kind: "SET_TASK_HOLD",
      taskInstanceId: "task-9-serial",
      hold: false,
    }),
  );
}

function measureCommandAbandonment(): Summary {
  return measureCommand(
    "abandonment",
    (iteration) => createCommandCore(`task-10-abandon-${iteration}`),
    (iteration) => ({
      commandId: commandId("b", iteration),
      source: "debug",
      kind: "ABANDON_TASK",
      taskInstanceId: "task-9-serial",
    }),
  );
}

function measureFreshWitness(): { readonly construction: Summary; readonly validation: Summary } {
  const state = readyState("task-10-fresh-witness");
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    const calculation = advanceTaskSystem(state, thermalPerformanceContent);
    if (
      validateFreshTaskAdvance(
        state,
        thermalPerformanceContent,
        calculation.result,
        calculation.witness,
      ).length > 0
    ) {
      throw new Error("Task fresh witness warm-up validation failed.");
    }
  }
  const constructionSamples: number[] = [];
  const validationSamples: number[] = [];
  for (let sample = 0; sample < TRANSITION_SAMPLES; sample += 1) {
    const constructionStart = process.hrtime.bigint();
    const calculation = advanceTaskSystem(state, thermalPerformanceContent);
    constructionSamples.push(elapsedMs(constructionStart));
    const validationStart = process.hrtime.bigint();
    const issues = validateFreshTaskAdvance(
      state,
      thermalPerformanceContent,
      calculation.result,
      calculation.witness,
    );
    validationSamples.push(elapsedMs(validationStart));
    if (issues.length > 0)
      throw new Error(`Task fresh witness validation failed: ${issues.join(" ")}`);
  }
  return { construction: summarize(constructionSamples), validation: summarize(validationSamples) };
}

function fixtureStatistics(): string {
  const state = createTask10Fixture("task-10-fixture-statistics");
  const allocations = Object.values(state.tasks.instances).flatMap((instance) =>
    instance.allocation === null ? [] : [instance.allocation],
  );
  const sharedModules = new Map<string, number>();
  for (const allocation of allocations) {
    for (const moduleId of allocation.clusterModuleIds) {
      sharedModules.set(moduleId, (sharedModules.get(moduleId) ?? 0) + 1);
    }
  }
  return [
    `modules=${Object.keys(state.facility.modules).length}`,
    `routes=${Object.keys(state.facility.routes).length}`,
    `activeTasks=${Object.keys(state.tasks.instances).length}`,
    `sharedTaskModules=${[...sharedModules.values()].filter((count) => count > 1).length}`,
    `servicePaths=1`,
    `projectPhases=${thermalPerformanceContent.tasks["task-ballistic-table-verification"]?.phases.length ?? 0}`,
  ].join(", ");
}

const warmPure = measureWarmPure();
const warmProduction = measureWarmProduction();
const twoTaskProgress = measureTwoTaskProgress();
const offerReconciliation = measureOfferReconciliation();
const phaseCompletion = measurePhaseCompletion();
const deadlineTransition = measureDeadlineTransition();
const slaPayout = measureSlaPayout();
const interruptedSlaWindow = measureInterruptedSlaWindow();
const completionRewards = measureCompletionRewards();
const commandAcceptance = measureCommandAcceptance();
const commandAllocation = measureCommandAllocation();
const commandHold = measureCommandHold();
const commandRecovery = measureCommandRecovery();
const commandAbandonment = measureCommandAbandonment();
const freshWitness = measureFreshWitness();

console.log("Task 10 audited deterministic lifecycle diagnostic");
console.log(
  `fixture: extends the Task 7/8/9 dense ${THERMAL_PERFORMANCE_WIDTH} x ${THERMAL_PERFORMANCE_HEIGHT} fixture, occupied>=${THERMAL_PERFORMANCE_MINIMUM_OCCUPIED_TILES}, mixed footprints/rotations, Power contention, thermal nonuniformity, Overclock, congested data routes, two simultaneous active tasks sharing a Compute module, a service window, and a multi-phase project.`,
);
console.log(`fixture statistics: ${fixtureStatistics()}`);
console.log(`warm pure Task advancement: ${format(warmPure)}`);
console.log(`warm complete production tick through Task advancement: ${format(warmProduction)}`);
console.log(`two-task progress path: ${format(twoTaskProgress)}`);
console.log(`offer reconciliation path: ${format(offerReconciliation)}`);
console.log(`multi-phase boundary: ${format(phaseCompletion)}`);
console.log(`deadline failure transition: ${format(deadlineTransition)}`);
console.log(`SLA boundary and payout: ${format(slaPayout)}`);
console.log(`interrupted SLA boundary without payout: ${format(interruptedSlaWindow)}`);
console.log(`final completion rewards: ${format(completionRewards)}`);
console.log(`command acceptance: ${format(commandAcceptance)}`);
console.log(`command allocation: ${format(commandAllocation)}`);
console.log(`command hold: ${format(commandHold)}`);
console.log(`command hold recovery: ${format(commandRecovery)}`);
console.log(`command abandonment: ${format(commandAbandonment)}`);
console.log(`fresh Task witness construction: ${format(freshWitness.construction)}`);
console.log(`fresh Task witness validation: ${format(freshWitness.validation)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT.`,
);
console.log(
  `warm-up: ${WARMUPS} unmeasured iterations per direct path; fixture and core construction, held-state setup, and command enqueueing are outside timed samples. No sample is filtered.`,
);
console.log(
  `hard targets: warm pure Task p95 < 0.20 ms=${warmPure.p95Ms < 0.2 ? "PASS" : "FAIL"}; complete production p95 < 4 ms=${warmProduction.p95Ms < 4 ? "PASS" : "FAIL"}; preferred production p95 < 3.7 ms=${warmProduction.p95Ms < 3.7 ? "PASS" : "REPORT"}.`,
);

if (warmPure.p95Ms >= 0.2 || warmProduction.p95Ms >= 4) {
  throw new Error("Task 10 hard performance gate failed.");
}
