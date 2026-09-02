import { cpus, release } from "node:os";

import {
  buildComputeTopology,
  calculateFacilityCompute,
  calculateFacilityComputeWithWitness,
  validateFreshComputeWitness,
} from "../../src/sim/compute/computeDomain.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createResearchCommandHandlers } from "../../src/sim/research/researchCommands.ts";
import {
  advanceResearchSystem,
  validateFreshResearchAdvance,
} from "../../src/sim/research/researchDomain.ts";
import { createResearchTickSystems } from "../../src/sim/research/facilityResearch.ts";
import {
  calculateEffectiveTaskShare,
  calculateResearchComputeResult,
  calculateResearchFactor,
} from "../../src/sim/research/researchComputeDomain.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createTaskTickSystems } from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";
import { createTask9PerformanceFixture, thermalPerformanceContent } from "./thermalFixture.ts";
import type {
  ActiveResearchState,
  BenchmarkResult,
  GameState,
  TaskInstanceState,
} from "../../src/sim/core/types.ts";

const WARMUPS = 100;
const RESERVATION_SAMPLES = 1_000;
const LIFECYCLE_SAMPLES = 1_000;
const TASK_COMPUTE_SAMPLES = 500;
const PRODUCTION_SAMPLES = 200;
const CACHE_SAMPLES = 200;
const TRANSITION_SAMPLES = 200;
const COMPLETION_SAMPLES = 200;
const MUSEUM_SAMPLES = 200;
const WITNESS_SAMPLES = 200;

const ROOT_RESEARCH_ID = "research-stable-power-distribution";
const FINAL_RESEARCH_ID = "research-transistor-theory";
const TASK_PROJECT_ID = "task-9-serial";
const TASK_SERVICE_ID = "task-9-bandwidth";

interface Summary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly sampleCount: number;
}

type TimedOperation = () => number;

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

function measure(operation: TimedOperation, warmups: number, samples: number): Summary {
  for (let warmup = 0; warmup < warmups; warmup += 1) operation();
  const values: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const start = process.hrtime.bigint();
    operation();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function measurePrepared(operations: readonly TimedOperation[], warmup: TimedOperation): Summary {
  for (let iteration = 0; iteration < WARMUPS; iteration += 1) warmup();
  const values: number[] = [];
  for (const operation of operations) {
    const start = process.hrtime.bigint();
    operation();
    values.push(elapsedMs(start));
  }
  return summarize(values);
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function serviceTask(state: Readonly<GameState>): TaskInstanceState {
  const task = state.tasks.instances[TASK_SERVICE_ID];
  if (task === undefined) throw new Error(`Research diagnostic fixture lacks ${TASK_SERVICE_ID}.`);
  return task;
}

function projectTask(state: Readonly<GameState>): TaskInstanceState {
  const task = state.tasks.instances[TASK_PROJECT_ID];
  if (task === undefined) throw new Error(`Research diagnostic fixture lacks ${TASK_PROJECT_ID}.`);
  return task;
}

function createTask11Fixture(seed: string): GameState {
  const state = createTask9PerformanceFixture(seed);
  const service = serviceTask(state);
  state.tasks.instances[service.id] = { ...service, serviceWindowCompliant: true };
  state.research.researchData = 1_000_000;
  state.economy.cashUsd = 1_000_000;
  return state;
}

function createFullCore(state: GameState): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers: createResearchCommandHandlers(thermalPerformanceContent),
    tickSystems: {
      ...createPowerTickSystems(thermalPerformanceContent),
      ...createThermalTickSystems(thermalPerformanceContent),
      ...createOverclockTickSystems(thermalPerformanceContent),
      ...createComputeTickSystems(thermalPerformanceContent),
      ...createTaskTickSystems(thermalPerformanceContent),
      ...createResearchTickSystems(thermalPerformanceContent),
    },
  });
}

function activeResearch(
  state: GameState,
  nodeId: string,
  reservedComputeShare: number,
  completedOperations = 0,
): GameState {
  return {
    ...state,
    research: {
      ...state.research,
      statuses: { ...state.research.statuses, [nodeId]: "active" },
      active: {
        nodeId,
        startedAtTick: state.tick,
        completedOperations,
        reservedComputeShare,
      },
    },
  };
}

function benchmark(runId: string, benchmarkId: string): BenchmarkResult {
  return {
    runId,
    benchmarkId,
    passed: true,
    startedAtTick: 0,
    durationTicks: 100,
    averageUsefulComputeFlops: 10_000,
    peakUsefulComputeFlops: 12_000,
    peakPowerWatts: 50,
    averagePowerWatts: 25,
    maxTemperatureC: 70,
    retryRate: 0,
    validSampleRate: 1,
    costUsd: 0,
    overclockSummary: {},
  };
}

function finalResearchState(seed: string, completedOperations = 0): GameState {
  const state = createTask11Fixture(seed);
  const statuses = Object.fromEntries(
    Object.keys(state.research.statuses).map((nodeId) => [
      nodeId,
      nodeId === FINAL_RESEARCH_ID ? "active" : "completed",
    ]),
  ) as GameState["research"]["statuses"];
  state.research = {
    ...state.research,
    statuses,
    evidenceTags: [
      "evidence-clock-stability",
      "evidence-layout-study",
      "evidence-memory-timing",
      "evidence-semiconductor-effect",
      "evidence-tube-failure-log",
    ],
    active: {
      nodeId: FINAL_RESEARCH_ID,
      startedAtTick: state.tick,
      completedOperations,
      reservedComputeShare: 0.2,
    },
  };
  state.benchmarks.history = [
    benchmark("research-diagnostic-peak", "benchmark-peak-throughput"),
    benchmark("research-diagnostic-sustained", "benchmark-sustained-stability"),
  ];
  state.benchmarks.bestRunByBenchmark = {
    "benchmark-peak-throughput": "research-diagnostic-peak",
    "benchmark-sustained-stability": "research-diagnostic-sustained",
  };
  return state;
}

function syntheticLifecycleState(seed: string): GameState {
  const state = activeResearch(createTask11Fixture(seed), ROOT_RESEARCH_ID, 0.25);
  const active = state.research.active;
  if (active === null) throw new Error("Research diagnostic active fixture is incomplete.");
  const research = calculateResearchComputeResult(active, 100_000);
  if (research === null) throw new Error("Research diagnostic result fixture is incomplete.");
  state.facility.compute = {
    layoutRevision: state.facility.liveLayoutRevision,
    thermalRevision: state.facility.thermalRevision,
    byModule: {},
    byTask: {},
    research,
    totalTheoreticalComputeFlops: 0,
    totalAvailableComputeFlops: 0,
    totalAllocatedUsefulComputeFlops: 0,
  };
  return state;
}

function readyActiveDenseState(seed: string): GameState {
  const core = createFullCore(finalResearchState(seed));
  core.step();
  const state = core.getStateForSave();
  requireCondition(
    state.research.active !== null,
    "Research diagnostic active fixture completed too early.",
  );
  requireCondition(
    state.facility.compute.research?.nodeId === FINAL_RESEARCH_ID,
    "Research diagnostic Compute result is missing active Research.",
  );
  return state;
}

function createStartCommand(commandId: string, reservedComputeShare: number) {
  return {
    commandId,
    source: "player" as const,
    kind: "START_RESEARCH" as const,
    nodeId: ROOT_RESEARCH_ID,
    reservedComputeShare,
  };
}

function createCancelCommand(commandId: string) {
  return {
    commandId,
    source: "player" as const,
    kind: "CANCEL_RESEARCH" as const,
    nodeId: ROOT_RESEARCH_ID,
  };
}

function createTransitionOperation(index: number): TimedOperation {
  const kind = index % 3;
  const state =
    kind === 0
      ? createTask11Fixture(`research-transition-start-${index}`)
      : activeResearch(
          createTask11Fixture(`research-transition-active-${index}`),
          ROOT_RESEARCH_ID,
          0.1,
        );
  const core = createFullCore(state);
  core.step(3);
  if (kind === 0) {
    const command = createStartCommand(
      `a1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      0.1,
    );
    return () => {
      core.enqueue(command);
      return core.step().endTick;
    };
  }
  if (kind === 1) {
    const command = createCancelCommand(
      `a1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    return () => {
      core.enqueue(command);
      return core.step().endTick;
    };
  }
  const cancel = createCancelCommand(
    `a1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const restart = createStartCommand(
    `b1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    0.2,
  );
  return () => {
    core.enqueue(cancel);
    core.enqueue(restart);
    return core.step().endTick;
  };
}

function runEvidenceUnlockScenario(): void {
  const core = createFullCore(createTask11Fixture("research-evidence-unlock"));
  core.step(3);
  const state = core.getStateForSave();
  const project = projectTask(state);
  const definition = thermalPerformanceContent.tasks[project.definitionId];
  const delivery = project.allocation?.deliveredUsefulComputeFlops;
  requireCondition(definition !== undefined, "Research diagnostic Task definition is missing.");
  requireCondition(
    delivery !== undefined && delivery > 0,
    "Research diagnostic Task delivery is missing.",
  );
  const finalPhaseIndex = definition.phases.length - 1;
  const finalPhase = definition.phases[finalPhaseIndex];
  requireCondition(finalPhase !== undefined, "Research diagnostic final Task phase is missing.");
  const completedPriorOperations = definition.phases
    .slice(0, finalPhaseIndex)
    .reduce((total, phase) => total + phase.operations, 0);
  core.replaceState({
    ...state,
    tasks: {
      ...state.tasks,
      instances: {
        ...state.tasks.instances,
        [project.id]: {
          ...project,
          currentPhaseIndex: finalPhaseIndex,
          phaseCompletedOperations: finalPhase.operations,
          totalCompletedOperations: completedPriorOperations + finalPhase.operations,
        },
      },
    },
  });
  core.step();
  requireCondition(
    core.getStateForSave().research.evidenceTags.includes("evidence-tube-failure-log"),
    "Research diagnostic Task evidence unlock did not occur.",
  );
}

function runCancellationRestartScenario(): void {
  const core = createFullCore(createTask11Fixture("research-cancel-restart"));
  core.enqueue(createStartCommand("c1000000-0000-4000-8000-000000000001", 0.1));
  const started = core.processPendingCommands()[0];
  requireCondition(started?.accepted === true, "Research diagnostic start scenario was rejected.");
  core.enqueue(createCancelCommand("c1000000-0000-4000-8000-000000000002"));
  const cancelled = core.processPendingCommands()[0];
  requireCondition(
    cancelled?.accepted === true,
    "Research diagnostic cancel scenario was rejected.",
  );
  core.enqueue(createStartCommand("c1000000-0000-4000-8000-000000000003", 0.2));
  const restarted = core.processPendingCommands()[0];
  requireCondition(
    restarted?.accepted === true,
    "Research diagnostic restart scenario was rejected.",
  );
  const state = core.getStateForSave();
  requireCondition(
    state.research.active?.completedOperations === 0,
    "Research restart retained progress.",
  );
  core.step();
  requireCondition(
    core.getStateForSave().research.active?.reservedComputeShare === 0.2,
    "Research restart share is incorrect.",
  );
}

function measureResearchReservation(): Summary {
  const active: ActiveResearchState = {
    nodeId: ROOT_RESEARCH_ID,
    startedAtTick: 0,
    completedOperations: 0,
    reservedComputeShare: 0.25,
  };
  return measure(
    () => {
      const factor = calculateResearchFactor(active);
      const effectiveShare = calculateEffectiveTaskShare(0.5, factor);
      const result = calculateResearchComputeResult(active, 100_000);
      if (result === null) throw new Error("Research reservation diagnostic returned null.");
      return factor + effectiveShare + result.deliveredUsefulComputeFlops;
    },
    WARMUPS,
    RESERVATION_SAMPLES,
  );
}

function measureResearchLifecycle(): Summary {
  const state = syntheticLifecycleState("research-lifecycle-pure");
  return measure(
    () => {
      const calculation = advanceResearchSystem(state, thermalPerformanceContent);
      const issues = validateFreshResearchAdvance(
        state,
        thermalPerformanceContent,
        calculation.result,
        calculation.witness,
      );
      if (issues.length > 0) throw new Error(issues.join("\n"));
      return calculation.result.research.active?.completedOperations ?? 0;
    },
    WARMUPS,
    LIFECYCLE_SAMPLES,
  );
}

function measureTaskComputeWithResearch(): Summary {
  const state = readyActiveDenseState("research-task-compute");
  const topology = buildComputeTopology(state.facility, thermalPerformanceContent);
  return measure(
    () => {
      const compute = calculateFacilityCompute(state, thermalPerformanceContent, topology);
      return (
        compute.totalAllocatedUsefulComputeFlops +
        (compute.research?.deliveredUsefulComputeFlops ?? 0)
      );
    },
    WARMUPS,
    TASK_COMPUTE_SAMPLES,
  );
}

function measureFullProduction(): Summary {
  const core = createFullCore(finalResearchState("research-full-production"));
  core.step(WARMUPS);
  const state = core.getStateForSave();
  requireCondition(state.research.active !== null, "Research completed during production warm-up.");
  requireCondition(
    state.research.active.completedOperations > 0,
    "Research production warm-up made no progress.",
  );
  return measure(() => core.step().endTick, 0, PRODUCTION_SAMPLES);
}

function measureProgressOnlyCache(): Summary {
  const warmCore = createFullCore(finalResearchState("research-progress-cache-source"));
  warmCore.step();
  const events: string[] = [];
  const core = new SimCore({
    initialState: warmCore.getStateForSave(),
    tickSystems: {
      ...createComputeTickSystems(thermalPerformanceContent, {
        onComputeResultCacheEvent: (event) => events.push(event),
      }),
      ...createResearchTickSystems(thermalPerformanceContent),
    },
  });
  core.step(WARMUPS);
  const eventStart = events.length;
  const summary = measure(() => core.step().endTick, 0, CACHE_SAMPLES);
  const measuredEvents = events.slice(eventStart);
  requireCondition(
    measuredEvents.length === CACHE_SAMPLES && measuredEvents.every((event) => event === "reused"),
    "Research progress-only cache diagnostic observed a non-hit.",
  );
  return summary;
}

function measureTransitions(): Summary {
  const operations = Array.from({ length: TRANSITION_SAMPLES }, (_, index) =>
    createTransitionOperation(index),
  );
  return measurePrepared(operations, createTransitionOperation(TRANSITION_SAMPLES + 1));
}

function completionCore(seed: string): SimCore {
  const requiredOperations =
    thermalPerformanceContent.research[FINAL_RESEARCH_ID]?.requiredOperations;
  if (requiredOperations === undefined)
    throw new Error("Research diagnostic final content is missing.");
  return createFullCore(finalResearchState(seed, requiredOperations - 1));
}

function measureCompletionTransition(): Summary {
  const operations = Array.from({ length: COMPLETION_SAMPLES }, (_, index) => {
    const core = completionCore(`research-completion-${index}`);
    return () => {
      const result = core.step();
      const state = core.getStateForSave();
      requireCondition(
        state.research.active === null,
        "Research completion did not clear active state.",
      );
      return result.endTick;
    };
  });
  return measurePrepared(
    operations,
    () => completionCore("research-completion-warmup").step().endTick,
  );
}

function measureMuseumCreation(): Summary {
  const operations = Array.from({ length: MUSEUM_SAMPLES }, (_, index) => {
    const core = completionCore(`research-museum-${index}`);
    return () => {
      core.step();
      const snapshots = core.getStateForSave().museum.snapshots;
      requireCondition(
        snapshots.length === 1,
        "Research Museum diagnostic did not create exactly one snapshot.",
      );
      return snapshots[0]?.totalCostUsd ?? 0;
    };
  });
  return measurePrepared(operations, () => completionCore("research-museum-warmup").step().endTick);
}

function ownershipCore(seed: string): SimCore {
  const fullCore = createFullCore(finalResearchState(seed));
  fullCore.step();
  return new SimCore({
    initialState: fullCore.getStateForSave(),
    tickSystems: {
      ...createComputeTickSystems(thermalPerformanceContent),
      ...createTaskTickSystems(thermalPerformanceContent),
      ...createResearchTickSystems(thermalPerformanceContent),
      "emit-events": {
        createRuntime() {
          return {
            executionMode: "structural-sharing" as const,
            run({ state }: { readonly state: Readonly<GameState> }) {
              return state;
            },
          };
        },
      },
    },
  });
}

function measureWitnessAndOwnership(): Summary {
  const state = readyActiveDenseState("research-witness-pure");
  const topology = buildComputeTopology(state.facility, thermalPerformanceContent);
  const pureOperation = (): number => {
    const calculation = calculateFacilityComputeWithWitness(
      state,
      thermalPerformanceContent,
      topology,
    );
    const candidate = {
      ...state,
      facility: { ...state.facility, compute: calculation.compute },
    };
    const computeIssues = validateFreshComputeWitness(
      state,
      thermalPerformanceContent,
      calculation.compute,
      state.tasks.instances,
      calculation.witness,
      topology,
    );
    const researchCalculation = advanceResearchSystem(candidate, thermalPerformanceContent);
    const researchIssues = validateFreshResearchAdvance(
      candidate,
      thermalPerformanceContent,
      researchCalculation.result,
      researchCalculation.witness,
    );
    if (computeIssues.length > 0 || researchIssues.length > 0) {
      throw new Error([...computeIssues, ...researchIssues].join("\n"));
    }
    return calculation.compute.totalAvailableComputeFlops;
  };
  const core = ownershipCore("research-witness-ownership");
  const summary = measure(
    () => {
      pureOperation();
      return core.step().endTick;
    },
    WARMUPS,
    WITNESS_SAMPLES,
  );
  return summary;
}

runEvidenceUnlockScenario();
runCancellationRestartScenario();

const reservation = measureResearchReservation();
const lifecycle = measureResearchLifecycle();
const taskCompute = measureTaskComputeWithResearch();
const fullProduction = measureFullProduction();
const cache = measureProgressOnlyCache();
const transitions = measureTransitions();
const completion = measureCompletionTransition();
const museum = measureMuseumCreation();
const witness = measureWitnessAndOwnership();

console.log("Task 11.7 audited Research reservation and lifecycle diagnostic");
console.log(
  "fixture: dense 24 x 16 Task 9 production fixture, active powered Compute, Power, Thermal, Overclock, Compute, Tasks, and Research stages, two active Tasks, nonzero Research reservation/progress, Task evidence unlock, cancellation/restart, completion transition, final reveal/Museum creation, nonuniform temperatures, realistic routes and shared contention.",
);
console.log(`pure Research reservation helpers: ${format(reservation)}`);
console.log(`pure Research lifecycle advancement: ${format(lifecycle)}`);
console.log(`warm Task 9 Compute with Research: ${format(taskCompute)}`);
console.log(`warm full production tick: ${format(fullProduction)}`);
console.log(`Compute cache hit during progress-only Research: ${format(cache)}`);
console.log(`start/cancel/share-change recalculation paths: ${format(transitions)}`);
console.log(`Research completion transition: ${format(completion)}`);
console.log(`final reveal and Museum creation: ${format(museum)}`);
console.log(`forced exact witness and ownership validation: ${format(witness)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT; warmups=${WARMUPS} excluded; fixture/core/command construction is excluded from measured intervals.`,
);
console.log(
  `hard targets: pure reservation p95 < 0.05 ms=${reservation.p95Ms < 0.05 ? "PASS" : "FAIL"}; pure Research lifecycle p95 < 0.15 ms=${lifecycle.p95Ms < 0.15 ? "PASS" : "FAIL"}; Task 9 Compute p95 < 0.35 ms=${taskCompute.p95Ms < 0.35 ? "PASS" : "FAIL"}; complete production p95 < 4 ms=${fullProduction.p95Ms < 4 ? "PASS" : "FAIL"}; preferred production p95 < 3 ms=${fullProduction.p95Ms < 3 ? "PASS" : "REPORT"}.`,
);
if (
  reservation.p95Ms >= 0.05 ||
  lifecycle.p95Ms >= 0.15 ||
  taskCompute.p95Ms >= 0.35 ||
  fullProduction.p95Ms >= 4
) {
  throw new Error("Task 11.7 Research hard performance gate failed.");
}
