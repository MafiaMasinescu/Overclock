import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { decodeSaveEnvelope, encodeSaveEnvelope } from "../../src/save/codec.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import { DEFAULT_PLAYER_SETTINGS } from "../../src/save/schema.ts";
import { assertValidBlueprintState } from "../../src/sim/blueprints/blueprintState.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createReplayRecorderForTests } from "../../src/sim/replay/replayRecorder.ts";
import type { ReplayOperation } from "../../src/sim/replay/replayContracts.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { createWorkerNFixture } from "../performance/workerNFixture.ts";

const content = loadContentBundle();

function createTaskResearchHistoryState(): GameState {
  const state = createWorkerNFixture("save-domain-task-research-history", content);
  if (
    state.research.active === null ||
    !Object.values(state.tasks.instances).some((task) => task.status === "active") ||
    state.benchmarks.history.length === 0
  ) {
    throw new Error(
      "Worker N persistence fixture lost an active Task, Research, or history record.",
    );
  }
  return state;
}

function createHighIdBlueprintState(): GameState {
  const state = createWorkerNFixture("save-domain-high-blueprint", content);
  const existing = Object.values(state.blueprints.records)[0];
  if (existing === undefined) throw new Error("Worker N persistence fixture has no Blueprint.");
  const records = Object.fromEntries(
    Object.entries(state.blueprints.records).filter(([key]) => key !== existing.id),
  ) as typeof state.blueprints.records;
  const id = "blueprint-100000000";
  records[id] = { ...existing, id };
  state.blueprints = { records, nextBlueprintSequence: 100_000_001 };
  assertValidBlueprintState(state.blueprints);
  return state;
}

function apply(core: ReturnType<typeof createProductionSimCore>, command: SimCommand): void {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result?.accepted !== true) {
    throw new Error(`Persistence fixture command ${command.kind} was rejected.`);
  }
}

function createActiveBenchmarkState(): GameState {
  const core = createProductionSimCore({
    content,
    initialState: createInitialGameState({ content, seed: "save-domain-active-benchmark" }),
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000001",
    source: "player",
    kind: "ENTER_DESIGN_MODE",
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000002",
    source: "player",
    kind: "PLACE_MODULE",
    definitionId: "module-vacuum-tube-logic",
    position: { x: 1, y: 1 },
    rotation: 0,
  });
  const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
  if (preview.status !== "ready") throw new Error("Benchmark fixture Design preview is blocked.");
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000003",
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: preview.draftRevision,
    acceptedCostUsd: preview.netCostUsd,
    acceptedDowntimeTicks: preview.downtimeTicks,
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000004",
    source: "player",
    kind: "START_BENCHMARK",
    benchmarkId: "benchmark-sustained-stability",
    clusterModuleIds: ["module-instance-00000001"],
  });
  const state = core.getStateForSave();
  if (
    state.benchmarks.active === null ||
    state.research.active !== null ||
    Object.values(state.tasks.instances).some((task) => task.status === "active")
  ) {
    throw new Error("Active Benchmark persistence fixture is not a separate legal run.");
  }
  return state;
}

function createDesignDraftHistoryState(): GameState {
  const core = createProductionSimCore({
    content,
    initialState: createInitialGameState({ content, seed: "save-domain-design-draft" }),
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000011",
    source: "player",
    kind: "ENTER_DESIGN_MODE",
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000012",
    source: "player",
    kind: "PLACE_MODULE",
    definitionId: "module-vacuum-tube-logic",
    position: { x: 1, y: 1 },
    rotation: 0,
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000013",
    source: "player",
    kind: "PLACE_MODULE",
    definitionId: "module-vacuum-tube-logic",
    position: { x: 8, y: 1 },
    rotation: 0,
  });
  apply(core, {
    commandId: "89000000-0000-4000-8000-000000000014",
    source: "player",
    kind: "UNDO_DESIGN",
  });
  const state = core.getStateForSave();
  const draft = state.facility.designDraft;
  if (draft?.undoStack.length !== 1 || draft.redoStack.length !== 1) {
    throw new Error("Design persistence fixture does not retain both sides of its edit history.");
  }
  return state;
}

function createPayload(state: GameState, nextQueueSequence: number, slotId: string): SavePayloadV1 {
  return {
    schemaVersion: 1,
    saveVersion: 1,
    contentVersion: content.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    createdAtIso: "2026-09-25T12:00:00.000Z",
    savedAtIso: "2026-09-25T12:01:00.000Z",
    slotId,
    gameState: state,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence,
      pendingCommandCount: 0,
      stateHash: hashCanonicalState(state),
    },
    settings: structuredClone(DEFAULT_PLAYER_SETTINGS),
    localStats: {
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    },
  };
}

test("keeps active cross-domain and high-ID state intact through save admission", async () => {
  const scenarios = [
    { slotId: "domain-task-research-history", state: createTaskResearchHistoryState(), queue: 23 },
    { slotId: "domain-active-benchmark", state: createActiveBenchmarkState(), queue: 1 },
    { slotId: "domain-design-history", state: createDesignDraftHistoryState(), queue: 4 },
    { slotId: "domain-high-blueprint", state: createHighIdBlueprintState(), queue: 37 },
  ] as const;

  for (const scenario of scenarios) {
    const payload = createPayload(scenario.state, scenario.queue, scenario.slotId);
    const encoded = await encodeSaveEnvelope(payload, { content, compression: "none" });
    const decoded = await decodeSaveEnvelope(encoded.bytes, { content });
    expect(decoded.migrated, scenario.slotId).toBe(false);
    expect(decoded.payload, scenario.slotId).toEqual(payload);
    expect(hashCanonicalState(decoded.payload.gameState), scenario.slotId).toBe(
      payload.execution.stateHash,
    );
    expect(decoded.payload.execution.nextQueueSequence, scenario.slotId).toBe(scenario.queue);
  }
});

async function runBridgeSaveSchedule() {
  const initialState = createInitialGameState({ content, seed: "task-21-small-save-bridge" });
  const directCore = createProductionSimCore({ content, initialState });
  const direct = createReplayRecorderForTests({ content, initialState, core: directCore });
  const prefix: ReplayOperation[] = [
    {
      kind: "clock",
      command: {
        commandId: "89010000-0000-4000-8000-000000000001",
        source: "player",
        kind: "SET_PAUSED",
        paused: false,
      },
    },
    { kind: "step", ticks: 7 },
    {
      kind: "enqueue",
      command: {
        commandId: "89010000-0000-4000-8000-000000000002",
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "engineering",
      },
    },
    { kind: "process-pending" },
    {
      kind: "clock",
      command: {
        commandId: "89010000-0000-4000-8000-000000000003",
        source: "player",
        kind: "SET_PAUSED",
        paused: true,
      },
    },
  ];
  for (const operation of prefix) direct.perform(operation);
  const checkpoint = direct.checkpoint();
  const savedState = direct.getStateForSave();
  const savedQueueSequence = direct.getCommandQueuePosition().nextSequence;
  if (direct.getCommandQueuePosition().pendingCount !== 0) {
    throw new Error("Small save bridge schedule reached a non-quiescent boundary.");
  }

  const payload = createPayload(savedState, savedQueueSequence, "save-bridge-small");
  const encoded = await encodeSaveEnvelope(payload, { content, compression: "none" });
  const decoded = await decodeSaveEnvelope(encoded.bytes, { content });
  const restoredState = decoded.payload.gameState;
  const restoredCore = createProductionSimCore({
    content,
    initialState: restoredState,
    initialCommandQueueSequence: decoded.payload.execution.nextQueueSequence,
  });
  const resumed = createReplayRecorderForTests({
    content,
    initialState: restoredState,
    core: restoredCore,
  });
  const suffix: ReplayOperation[] = [
    {
      kind: "clock",
      command: {
        commandId: "89010000-0000-4000-8000-000000000004",
        source: "player",
        kind: "SET_PAUSED",
        paused: false,
      },
    },
    { kind: "step", ticks: 9 },
    {
      kind: "enqueue",
      command: {
        commandId: "89010000-0000-4000-8000-000000000005",
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "simple",
      },
    },
    { kind: "process-pending" },
    {
      kind: "clock",
      command: {
        commandId: "89010000-0000-4000-8000-000000000006",
        source: "player",
        kind: "SET_PAUSED",
        paused: true,
      },
    },
  ];
  for (const operation of suffix) {
    const expected = direct.perform(operation);
    const actual = resumed.perform(operation);
    if (
      expected.tickBefore !== actual.tickBefore ||
      expected.tickAfter !== actual.tickAfter ||
      JSON.stringify(expected.operation) !== JSON.stringify(actual.operation) ||
      JSON.stringify(expected.outcome) !== JSON.stringify(actual.outcome)
    ) {
      throw new Error(`Small save bridge schedule diverged at ${operation.kind}.`);
    }
  }

  const directFinalState = direct.getStateForSave();
  const resumedFinalState = resumed.getStateForSave();
  const directFinalHash = hashCanonicalState(directFinalState);
  const resumedFinalHash = hashCanonicalState(resumedFinalState);
  const directArtifact = direct.finish();
  const resumedArtifact = resumed.finish();
  const directSuffix = directArtifact.log.entries.slice(checkpoint.afterSequence).map((entry) => ({
    tickBefore: entry.tickBefore,
    tickAfter: entry.tickAfter,
    operation: entry.operation,
    outcome: entry.outcome,
  }));
  const resumedSuffix = resumedArtifact.log.entries.map((entry) => ({
    tickBefore: entry.tickBefore,
    tickAfter: entry.tickAfter,
    operation: entry.operation,
    outcome: entry.outcome,
  }));
  if (
    directFinalHash !== resumedFinalHash ||
    directFinalState.rngState !== resumedFinalState.rngState ||
    direct.getCommandQueuePosition().nextSequence !==
      resumed.getCommandQueuePosition().nextSequence ||
    JSON.stringify(directSuffix) !== JSON.stringify(resumedSuffix) ||
    !decoded.payload.gameState.seed.includes("task-21-small-save-bridge")
  ) {
    throw new Error("Small save bridge schedule failed exact suffix or boundary parity.");
  }
  return {
    checksum: encoded.envelope.checksum,
    savedTick: decoded.payload.gameState.tick,
    savedQueueSequence: decoded.payload.execution.nextQueueSequence,
    directFinalHash,
    resumedFinalHash,
    directFinalRng: directFinalState.rngState,
    resumedFinalRng: resumedFinalState.rngState,
    directFinalQueueSequence: direct.getCommandQueuePosition().nextSequence,
    resumedFinalQueueSequence: resumed.getCommandQueuePosition().nextSequence,
    directSuffix,
    resumedSuffix,
  };
}

test("repeats the small Replay-to-save bridge and exact suffix exactly 100 times", async () => {
  const expected = await runBridgeSaveSchedule();
  for (let run = 1; run < 100; run += 1) {
    expect(await runBridgeSaveSchedule()).toEqual(expected);
  }
}, 60_000);
