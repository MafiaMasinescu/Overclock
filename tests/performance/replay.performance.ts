import { cpus, release } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  createProductionSimCore,
  type ProductionSimCoreOptions,
} from "../../src/sim/core/productionSimCore.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type {
  ActiveBenchmarkState,
  BlueprintRecord,
  GameState,
  ModuleInstanceState,
  OverclockSettings,
} from "../../src/sim/core/types.ts";
import { createTask9PerformanceFixture } from "./thermalFixture.ts";
import {
  createReplayRecorder,
  createReplayRecorderForTests,
} from "../../src/sim/replay/replayRecorder.ts";
import {
  executeParsedReplay,
  executeReplayEntry,
  runReplay,
} from "../../src/sim/replay/replayRunner.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { parseReplayLog } from "../../src/sim/replay/replaySchema.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import {
  resumeReplay,
  verifyReplayAndCreateResumeArtifact,
} from "../../src/sim/replay/replayResume.ts";

const content = loadContentBundle();
const WARMUPS = 100;
const DIRECT_SAMPLES = 200;
const RECORDING_SAMPLES = 200;
const PLAYBACK_SAMPLES = 200;
const ENQUEUE_SAMPLES = 1_000;
const CLOCK_SAMPLES = 1_000;
const COMMAND_SAMPLES = 200;
const CHECKPOINT_SAMPLES = 200;
const FINGERPRINT_SAMPLES = 200;
const PARSE_SAMPLES = 200;
const FINALIZATION_SAMPLES = 200;
const END_TO_END_SAMPLES = 200;
const FATAL_SAMPLES = 200;
const RESUME_SAMPLES = 200;
const COLD_SAMPLES = 200;

interface MeasurementSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): MeasurementSummary {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    samples: samples.length,
  };
}

function format(summary: MeasurementSummary): string {
  return `median=${summary.medianMs.toFixed(4)} ms, p95=${summary.p95Ms.toFixed(4)} ms, max=${summary.maximumMs.toFixed(4)} ms, samples=${summary.samples}`;
}

function measure(operation: () => void, samples: number, warmups = WARMUPS): MeasurementSummary {
  for (let index = 0; index < warmups; index += 1) operation();
  const timings: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = process.hrtime.bigint();
    operation();
    timings.push(elapsedMs(start));
  }
  return summarize(timings);
}

function createBlueprintRecords(): GameState["blueprints"] {
  const primary: Omit<BlueprintRecord, "id" | "name"> = {
    version: 1,
    kind: "subassembly",
    contentVersion: content.contentVersion,
    modules: [
      {
        localId: "module-0001",
        definitionId: "module-vacuum-tube-logic",
        relativePosition: { x: 0, y: 0 },
        rotation: 0,
        defaultOverclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
      {
        localId: "module-0002",
        definitionId: "module-control-unit",
        relativePosition: { x: 2, y: 0 },
        rotation: 0,
        defaultOverclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
      },
    ],
    routes: [],
    requiredResearchIds: [],
    bounds: { width: 4, height: 2 },
    summary: {
      theoreticalComputeFlops: 1_000,
      peakPowerWatts: 2_000,
      estimatedMaxTemperatureC: 40,
      estimatedCostUsd: 100,
    },
  };
  const records: Record<string, BlueprintRecord> = {};
  for (let index = 1; index <= 128; index += 1) {
    const id = `blueprint-${index.toString().padStart(8, "0")}`;
    records[id] = { ...structuredClone(primary), id, name: `Replay fixture ${index}` };
  }
  return { records, nextBlueprintSequence: 129 };
}

function createActiveBenchmark(state: GameState): ActiveBenchmarkState {
  const clusterModuleIds = Object.keys(state.facility.modules)
    .toSorted()
    .filter((moduleId) => {
      const module = state.facility.modules[moduleId];
      const definition = module === undefined ? undefined : content.modules[module.definitionId];
      return definition !== undefined && definition.baseComputeFlops > 0;
    })
    .slice(0, 4);
  if (clusterModuleIds.length === 0) {
    throw new Error("Replay performance fixture has no compute-capable modules.");
  }
  const overclockSummary: Record<string, OverclockSettings> = {};
  for (const moduleId of clusterModuleIds) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) throw new Error(`Missing Replay fixture module ${moduleId}.`);
    overclockSummary[moduleId] = structuredClone(module.overclock);
  }
  return {
    runId: "benchmark-run-00000001",
    benchmarkId: "benchmark-sustained-stability",
    startedAtTick: state.tick,
    elapsedTicks: 0,
    clusterModuleIds,
    accumulatedUsefulComputeFlops: 0,
    peakUsefulComputeFlops: 0,
    accumulatedPowerWatts: 0,
    peakPowerWatts: 0,
    maxTemperatureC: null,
    minimumPowerHeadroomWatts: null,
    accumulatedRetryRate: 0,
    accumulatedValidSampleRate: 0,
    accumulatedCostUsd: 0,
    shutdownObserved: false,
    overclockSummary,
  };
}

function createProtocolModule(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function createProtocolInitialState(): GameState {
  const state = createInitialGameState({ content, seed: "replay-performance-protocol" });
  state.research.statuses["research-stable-power-distribution"] = "completed";
  state.research.statuses["research-modular-wiring"] = "completed";
  state.research.statuses["research-blueprint-documentation"] = "completed";
  state.research.evidenceTags = ["evidence-layout-study"];
  state.facility.modules = {
    "module-instance-00000001": createProtocolModule(
      "module-instance-00000001",
      "module-vacuum-tube-logic",
      { x: 1, y: 1 },
    ),
    "module-instance-00000002": createProtocolModule(
      "module-instance-00000002",
      "module-control-unit",
      { x: 5, y: 1 },
    ),
  };
  state.facility.nextModuleInstanceSequence = 3;
  return state;
}

function canonicalizeModuleIds(state: GameState): void {
  const sourceIds = Object.keys(state.facility.modules).toSorted();
  const ids = Object.fromEntries(
    sourceIds.map((sourceId, index) => [
      sourceId,
      `module-instance-${String(index + 1).padStart(8, "0")}`,
    ]),
  );
  const moduleId = (sourceId: string): string => ids[sourceId] ?? sourceId;
  state.facility.modules = Object.fromEntries(
    Object.entries(state.facility.modules).map(([sourceId, module]) => [
      moduleId(sourceId),
      { ...module, id: moduleId(sourceId) },
    ]),
  );
  state.facility.routes = Object.fromEntries(
    Object.entries(state.facility.routes).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        from: { ...route.from, moduleInstanceId: moduleId(route.from.moduleInstanceId) },
        to: { ...route.to, moduleInstanceId: moduleId(route.to.moduleInstanceId) },
      },
    ]),
  );
  state.facility.power.byModule = Object.fromEntries(
    Object.entries(state.facility.power.byModule).map(([sourceId, delivery]) => [
      moduleId(sourceId),
      { ...delivery, moduleInstanceId: moduleId(delivery.moduleInstanceId) },
    ]),
  );
  state.facility.overclock.byModule = Object.fromEntries(
    Object.entries(state.facility.overclock.byModule).map(([sourceId, result]) => [
      moduleId(sourceId),
      { ...result, moduleInstanceId: moduleId(result.moduleInstanceId) },
    ]),
  );
  state.facility.compute.byModule = Object.fromEntries(
    Object.entries(state.facility.compute.byModule).map(([sourceId, result]) => [
      moduleId(sourceId),
      { ...result, moduleInstanceId: moduleId(result.moduleInstanceId) },
    ]),
  );
  state.facility.nextModuleInstanceSequence = sourceIds.length + 1;
}

function createDenseState(): GameState {
  const state = createTask9PerformanceFixture("replay-performance-dense");
  canonicalizeModuleIds(state);
  state.tasks.instances = {};
  state.tasks.offers = ["task-ballistic-table-verification"];
  state.blueprints = createBlueprintRecords();
  state.benchmarks.nextBenchmarkRunSequence = 2;
  state.benchmarks.active = createActiveBenchmark(state);
  return state;
}

function productionCore(state: GameState): SimCore {
  const options: ProductionSimCoreOptions = { content, initialState: state };
  return createProductionSimCore(options);
}

function protocolRecorder() {
  const initialState = createProtocolInitialState();
  const recorder = createReplayRecorder({ content, initialState });

  const command = (sequence: number, kind: Record<string, unknown>) => ({
    kind: "enqueue" as const,
    command: {
      commandId: `20800000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
      source: "player" as const,
      ...kind,
    },
  });
  const enqueueAndProcess = (sequence: number, kind: Record<string, unknown>) => {
    recorder.perform(command(sequence, kind));
    recorder.perform({ kind: "process-pending" });
  };

  enqueueAndProcess(1, {
    kind: "SAVE_BLUEPRINT",
    name: "Protocol Assembly",
    selectedModuleIds: ["module-instance-00000001", "module-instance-00000002"],
  });
  recorder.checkpoint();
  enqueueAndProcess(3, { kind: "ENTER_DESIGN_MODE" });
  enqueueAndProcess(5, {
    kind: "SAVE_BLUEPRINT",
    name: "Rejected While Editing",
    selectedModuleIds: ["module-instance-00000001"],
  });
  enqueueAndProcess(7, {
    kind: "INSTANTIATE_BLUEPRINT",
    blueprintId: "blueprint-00000001",
    position: { x: 10, y: 5 },
    rotation: 90,
  });
  enqueueAndProcess(9, { kind: "UNDO_DESIGN" });
  enqueueAndProcess(11, { kind: "REDO_DESIGN" });
  enqueueAndProcess(13, { kind: "CANCEL_DESIGN" });
  recorder.checkpoint();
  recorder.perform({
    kind: "clock",
    command: {
      commandId: "20800000-0000-4000-8000-000000000015",
      source: "player",
      kind: "SET_PAUSED",
      paused: false,
      expectedTick: 0,
    },
  });
  recorder.perform({ kind: "step", ticks: 0 });
  recorder.perform({ kind: "step", ticks: 1 });
  return recorder;
}

function protocolArtifact() {
  return protocolRecorder().finish();
}

function fatalArtifact() {
  const initialState = createInitialGameState({ content, seed: "replay-performance-fatal" });
  const core = new SimCore({
    initialState,
    tickSystems: {
      "rebuild-dirty-connectivity": ({ state }) => {
        if (state.tick === 0) throw new Error("diagnostic fatal");
      },
    },
  });
  const recorder = createReplayRecorderForTests({ content, initialState, core });
  recorder.perform({ kind: "step", ticks: 1 });
  return recorder.finish();
}

const denseState = createDenseState();
const denseDirect = productionCore(denseState);
const direct = measure(() => denseDirect.step(1), DIRECT_SAMPLES);

const recording = createReplayRecorder({ content, initialState: createDenseState() });
const recorded = measure(() => {
  recording.perform({ kind: "step", ticks: 1 });
}, RECORDING_SAMPLES);

const protocol = protocolArtifact();
const warmPlaybackArtifact = (() => {
  const recorder = createReplayRecorder({ content, initialState: createDenseState() });
  for (let index = 0; index < 320; index += 1) {
    recorder.perform({ kind: "step", ticks: 1 });
  }
  return recorder.finish();
})();
const warmPlaybackLog = parseReplayLog(warmPlaybackArtifact.log);
const warmPlaybackCore = productionCore(warmPlaybackArtifact.initialState);
warmPlaybackCore.step(100);
let warmPlaybackIndex = 100;
const playback = measure(
  () => {
    const entry = warmPlaybackLog.entries[warmPlaybackIndex];
    if (entry === undefined) throw new Error("Warm playback fixture is too short.");
    executeReplayEntry(warmPlaybackCore, entry);
    warmPlaybackIndex += 1;
  },
  PLAYBACK_SAMPLES,
  0,
);

const enqueueRecorder = createReplayRecorder({
  content,
  initialState: createInitialGameState({ content, seed: "replay-enqueue-performance" }),
});
const enqueue = measure(
  () => {
    const sequence = enqueueRecorder.getCommandQueuePosition().nextSequence + 1;
    enqueueRecorder.perform({
      kind: "enqueue",
      command: {
        commandId: `20800000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "engineering",
      },
    });
  },
  ENQUEUE_SAMPLES,
  20,
);

const clockRecorder = createReplayRecorder({
  content,
  initialState: createInitialGameState({ content, seed: "replay-clock-performance" }),
});
let clockSequence = 0;
const clock = measure(
  () => {
    clockSequence += 1;
    clockRecorder.perform({
      kind: "clock",
      command: {
        commandId: `20800000-0000-4000-8000-${clockSequence.toString().padStart(12, "0")}`,
        source: "player",
        kind: "SET_SPEED",
        speed: (clockSequence - 1) % 3 === 0 ? 1 : (clockSequence - 1) % 3 === 1 ? 2 : 4,
        expectedTick: 0,
      },
    });
  },
  CLOCK_SAMPLES,
  20,
);

const commandRecorder = createReplayRecorder({
  content,
  initialState: createInitialGameState({ content, seed: "replay-command-performance" }),
});
let commandSequence = 0;
const commandOnly = measure(
  () => {
    commandSequence += 1;
    commandRecorder.perform({
      kind: "enqueue",
      command: {
        commandId: `20800000-0000-4000-8000-${commandSequence.toString().padStart(12, "0")}`,
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "engineering",
      },
    });
    commandRecorder.perform({ kind: "process-pending" });
  },
  COMMAND_SAMPLES,
  20,
);

const checkpointCore = productionCore(createDenseState());
const checkpoint = measure(
  () => {
    hashCanonicalState(checkpointCore.getStateForSave());
  },
  CHECKPOINT_SAMPLES,
  20,
);

const fingerprint = measure(
  () => {
    hashSimulationContent(content);
  },
  FINGERPRINT_SAMPLES,
  20,
);

const parse = measure(
  () => {
    parseReplayLog(protocol.log);
  },
  PARSE_SAMPLES,
  20,
);

const finalizationRecorders = Array.from({ length: FINALIZATION_SAMPLES }, () =>
  protocolRecorder(),
);
let finalizationIndex = 0;
const finalization = measure(
  () => {
    const recorder = finalizationRecorders[finalizationIndex];
    if (recorder === undefined) throw new Error("Replay finalization fixture is too short.");
    recorder.finish();
    finalizationIndex += 1;
  },
  FINALIZATION_SAMPLES,
  0,
);

const endToEnd = measure(
  () => {
    const report = runReplay({
      content,
      initialState: protocol.initialState,
      log: protocol.log,
    });
    if (report.status !== "matched") throw new Error("Replay protocol fixture did not match.");
  },
  END_TO_END_SAMPLES,
  10,
);

const fatal = fatalArtifact();
const parsedFatal = parseReplayLog(fatal.log);
const fatalReplay = measure(
  () => {
    const core = new SimCore({
      initialState: structuredClone(fatal.initialState),
      tickSystems: {
        "rebuild-dirty-connectivity": ({ state }) => {
          if (state.tick === 0) throw new Error("diagnostic fatal");
        },
      },
    });
    const report = executeParsedReplay({ content, log: parsedFatal, core });
    if (report.report.status !== "matched-fatal")
      throw new Error("Fatal Replay fixture did not match.");
  },
  FATAL_SAMPLES,
  20,
);

const resumeArtifact = (() => {
  const recorder = createReplayRecorder({ content, initialState: protocol.initialState });
  recorder.perform({
    kind: "enqueue",
    command: {
      commandId: "20800000-0000-4000-8000-000000000011",
      source: "player",
      kind: "SET_GUIDANCE_MODE",
      mode: "engineering",
    },
  });
  recorder.perform({ kind: "process-pending" });
  recorder.checkpoint();
  recorder.perform({ kind: "step", ticks: 1 });
  return { artifact: recorder.finish(), boundary: 2 };
})();
const certifiedResume = verifyReplayAndCreateResumeArtifact({
  content,
  initialState: resumeArtifact.artifact.initialState,
  log: resumeArtifact.artifact.log,
  afterSequence: resumeArtifact.boundary,
});
const resumeVerification = measure(
  () => {
    verifyReplayAndCreateResumeArtifact({
      content,
      initialState: resumeArtifact.artifact.initialState,
      log: resumeArtifact.artifact.log,
      afterSequence: resumeArtifact.boundary,
    });
  },
  RESUME_SAMPLES,
  5,
);
const resumeSourceReport = runReplay({
  content,
  initialState: resumeArtifact.artifact.initialState,
  log: resumeArtifact.artifact.log,
});
if (resumeSourceReport.status !== "matched")
  throw new Error("Resume source fixture did not match.");
const resumed = measure(
  () => {
    const resumedReport = resumeReplay({
      content,
      log: resumeArtifact.artifact.log,
      artifact: certifiedResume,
    });
    if (resumedReport.status !== "matched") throw new Error("Resumed Replay did not match.");
  },
  RESUME_SAMPLES,
  5,
);

const cold = measure(
  () => {
    productionCore(createDenseState());
  },
  COLD_SAMPLES,
  5,
);

console.log("Task 14 Replay performance diagnostic (Intel i7-2600 target-hardware run)");
console.log(`CPU=${cpus()[0]?.model ?? "unknown"}`);
console.log(
  `OS=${process.platform} ${release()}, Node=${process.version}, build=development TypeScript`,
);
console.log(
  `warm-up: ${WARMUPS} iterations unless stated; fixture construction excluded from timed samples`,
);
console.log(
  `dense fixture: 24x16, active production stages, storedBlueprintRecords=${Object.keys(denseState.blueprints.records).length}`,
);
console.log(
  `protocol fixture: entries=${protocol.log.entries.length}, checkpoints=${protocol.log.checkpoints.length}, logBytes=${Buffer.byteLength(canonicalSerialize(protocol.log), "utf8")}`,
);
console.log(
  `resume artifact bytes=${Buffer.byteLength(canonicalSerialize(certifiedResume), "utf8")}`,
);
console.log(`direct production step(1): ${format(direct)}`);
console.log(`recording production step(1), no checkpoint: ${format(recorded)}`);
console.log(`playback production trace: ${format(playback)}`);
console.log(`enqueue recording: ${format(enqueue)}`);
console.log(`clock recording: ${format(clock)}`);
console.log(`command-only processing: ${format(commandOnly)}`);
console.log(`full-state checkpoint serialization/hash input: ${format(checkpoint)}`);
console.log(`simulation-content fingerprint input: ${format(fingerprint)}`);
console.log(`strict Replay parsing: ${format(parse)}`);
console.log(`normal Replay finalization: ${format(finalization)}`);
console.log(`normal end-to-end Replay: ${format(endToEnd)}`);
console.log(`expected-fatal Replay: ${format(fatalReplay)}`);
console.log(`resume artifact verification/construction: ${format(resumeVerification)}`);
console.log(`resumed remaining execution: ${format(resumed)}`);
console.log(`cold production SimCore construction: ${format(cold)}`);
console.log(
  "hard target references: direct <4 ms p95; recording <5 ms p95; playback <5 ms p95 on Intel i7-2600",
);
