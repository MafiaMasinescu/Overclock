import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  createReplayRecorder,
  createReplayRecorderForTests,
} from "../../src/sim/replay/replayRecorder.ts";
import { executeParsedReplay, runReplay } from "../../src/sim/replay/replayRunner.ts";
import { parseReplayLog } from "../../src/sim/replay/replaySchema.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";

const IDS = {
  first: "20500000-0000-4000-8000-000000000001",
  second: "20500000-0000-4000-8000-000000000002",
} as const;

function createArtifact() {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed: "replay-runner-test" });
  const recorder = createReplayRecorder({ content, initialState });
  recorder.perform({
    kind: "enqueue",
    command: {
      commandId: IDS.first,
      source: "player",
      kind: "SET_GUIDANCE_MODE",
      mode: "engineering",
      expectedTick: 0,
    },
  });
  recorder.perform({
    kind: "clock",
    command: {
      commandId: IDS.second,
      source: "player",
      kind: "SET_SPEED",
      speed: 2,
      expectedTick: 0,
    },
  });
  recorder.perform({ kind: "process-pending" });
  recorder.perform({ kind: "step", ticks: 1 });
  recorder.checkpoint();
  return { content, ...recorder.finish() };
}

describe("Replay runner", () => {
  test("replays a recorded production session and verifies every checkpoint", () => {
    const artifact = createArtifact();
    const report = runReplay({
      content: artifact.content,
      initialState: artifact.initialState,
      log: artifact.log,
    });

    expect(report).toMatchObject({
      status: "matched",
      finalTick: 1,
      finalStateHash: artifact.log.checkpoints.at(-1)?.stateHash,
      finalQueuePosition: { nextSequence: 1, pendingCount: 0 },
      executedEntries: 4,
      executedTicks: 1,
      lastMatchingCheckpointAfterSequence: 4,
    });
    expect(report.mismatch).toBeUndefined();
  });

  test("reports a stable first difference for a modified expected outcome", () => {
    const artifact = createArtifact();
    const log = structuredClone(artifact.log);
    const processEntry = log.entries[2];
    if (processEntry?.outcome.kind !== "command-results") throw new Error("fixture mismatch");
    processEntry.outcome.results[0] = {
      commandId: IDS.first,
      accepted: true,
      appliedAtTick: 0,
    };

    const report = runReplay({
      content: artifact.content,
      initialState: artifact.initialState,
      log,
    });

    expect(report.status).toBe("diverged");
    expect(report.mismatch).toMatchObject({
      kind: "entry",
      sequence: 3,
      category: "value",
      path: "$.outcome.results[0].accepted",
      expected: true,
      actual: false,
      lastMatchingCheckpointAfterSequence: 0,
    });
  });

  test("rejects an incompatible content fingerprint before constructing a simulator", () => {
    const artifact = createArtifact();
    const changedContent = structuredClone(artifact.content);
    changedContent.era = { ...changedContent.era, nameKey: "ui.changed-era" };

    const report = runReplay({
      content: changedContent,
      initialState: artifact.initialState,
      log: artifact.log,
    });

    expect(report.status).toBe("incompatible");
    expect(report.executedEntries).toBe(0);
  });

  test("reports malformed logs, invalid initial state, and budget exhaustion distinctly", () => {
    const artifact = createArtifact();
    const malformed = runReplay({
      content: artifact.content,
      initialState: artifact.initialState,
      log: { nope: true },
    });
    expect(malformed.status).toBe("invalid-log");

    const invalidInitialState = runReplay({
      content: artifact.content,
      initialState: { ...artifact.initialState, tick: -1 },
      log: artifact.log,
    });
    expect(invalidInitialState.status).toBe("invalid-initial-state");

    const limited = runReplay({
      content: artifact.content,
      initialState: artifact.initialState,
      log: artifact.log,
      limits: { maxEntries: 3 },
    });
    expect(limited.status).toBe("limit-exceeded");
  });

  test("rejects accessor-bearing incompatible headers without invoking the accessor", () => {
    const artifact = createArtifact();
    let getterCalls = 0;
    const log = structuredClone(artifact.log) as unknown as Record<string, unknown>;
    Object.defineProperty(log, "replayVersion", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return 999;
      },
    });

    const result = runReplay({
      content: artifact.content,
      initialState: artifact.initialState,
      log,
    });

    expect(result.status).toBe("invalid-log");
    expect(getterCalls).toBe(0);
  });

  test("accepts explicit zero-tick operations and preserves the empty-boundary checkpoint", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "replay-zero-step" });
    const recorder = createReplayRecorder({ content, initialState });
    recorder.perform({ kind: "step", ticks: 0 });
    const artifact = recorder.finish();
    const report = runReplay({
      content,
      initialState: artifact.initialState,
      log: artifact.log,
    });

    expect(report.status).toBe("matched");
    expect(report.finalTick).toBe(0);
    expect(report.executedTicks).toBe(0);
  });

  test("preserves duplicate UUID occurrences and distinguishes queued from synchronous clock commands", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({
      content,
      seed: "replay-duplicate-clock-routing",
    });
    const recorder = createReplayRecorder({ content, initialState });
    const queuedClock = {
      commandId: IDS.first,
      source: "player" as const,
      kind: "SET_SPEED" as const,
      speed: 2 as const,
    };

    recorder.perform({ kind: "enqueue", command: queuedClock });
    recorder.perform({ kind: "enqueue", command: queuedClock });
    const queued = recorder.perform({ kind: "process-pending" });
    const synchronous = recorder.perform({
      kind: "clock",
      command: { ...queuedClock, commandId: IDS.second, speed: 4 },
    });
    const artifact = recorder.finish();

    expect(artifact.log.entries.slice(0, 2).map((entry) => entry.outcome)).toEqual([
      {
        kind: "receipt",
        receipt: { commandId: IDS.first, queued: true, queueSequence: 0 },
      },
      {
        kind: "receipt",
        receipt: { commandId: IDS.first, queued: true, queueSequence: 1 },
      },
    ]);
    expect(queued.outcome).toMatchObject({
      kind: "command-results",
      results: [
        { commandId: IDS.first, accepted: false, code: "COMMAND_NOT_AVAILABLE" },
        { commandId: IDS.first, accepted: false, code: "COMMAND_NOT_AVAILABLE" },
      ],
    });
    expect(synchronous.outcome).toMatchObject({
      kind: "clock-result",
      result: { commandId: IDS.second, accepted: true },
    });
    expect(runReplay({ content, initialState, log: artifact.log }).status).toBe("matched");
  });

  test("detects same-tick operation reordering at the first proving checkpoint", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "replay-same-tick-order" });
    const recorder = createReplayRecorder({ content, initialState });
    recorder.perform({
      kind: "clock",
      command: {
        commandId: IDS.first,
        source: "player",
        kind: "SET_SPEED",
        speed: 2,
      },
    });
    recorder.perform({
      kind: "clock",
      command: {
        commandId: IDS.second,
        source: "player",
        kind: "SET_SPEED",
        speed: 4,
      },
    });
    const artifact = recorder.finish();
    const reordered = structuredClone(artifact.log);
    const first = reordered.entries[0];
    const second = reordered.entries[1];
    if (first === undefined || second === undefined) throw new Error("fixture mismatch");
    [first.operation, second.operation] = [second.operation, first.operation];
    [first.outcome, second.outcome] = [second.outcome, first.outcome];

    const result = runReplay({ content, initialState, log: reordered });

    expect(result.status).toBe("diverged");
    expect(result.mismatch).toMatchObject({
      kind: "checkpoint",
      sequence: 2,
      path: "$.stateHash",
      lastMatchingCheckpointAfterSequence: 0,
    });
  });

  test("compares optional command-result parameters and checkpoint queue data exactly", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "replay-exact-result-shape" });
    const recorder = createReplayRecorder({ content, initialState });
    recorder.perform({
      kind: "enqueue",
      command: {
        commandId: IDS.first,
        source: "player",
        kind: "ACCEPT_TASK",
        definitionId: "unknown-task",
      },
    });
    recorder.perform({ kind: "process-pending" });
    const artifact = recorder.finish();
    const changedResult = structuredClone(artifact.log);
    const processEntry = changedResult.entries[1];
    if (processEntry?.outcome.kind !== "command-results") throw new Error("fixture mismatch");
    const rejected = processEntry.outcome.results[0];
    if (rejected === undefined || rejected.accepted) throw new Error("fixture mismatch");
    delete rejected.parameters;

    const resultDifference = runReplay({ content, initialState, log: changedResult });
    expect(resultDifference.status).toBe("diverged");
    expect(resultDifference.mismatch).toMatchObject({
      kind: "entry",
      sequence: 2,
      category: "key-set",
      path: "$.outcome.results[0]",
    });

    for (const field of ["stateHash", "nextQueueSequence"] as const) {
      const changedCheckpoint = structuredClone(artifact.log);
      const checkpoint = changedCheckpoint.checkpoints.at(-1);
      if (checkpoint === undefined) throw new Error("fixture mismatch");
      if (field === "stateHash") checkpoint.stateHash = "0000000000000000";
      else checkpoint.nextQueueSequence += 1;
      const checkpointDifference = runReplay({ content, initialState, log: changedCheckpoint });
      expect(checkpointDifference.status).toBe("diverged");
      expect(checkpointDifference.mismatch).toMatchObject({
        kind: "checkpoint",
        sequence: 2,
        path: `$.${field}`,
      });
    }
  });

  test("allows locale-only changes and isolates simultaneous fresh runners", () => {
    const artifact = createArtifact();
    const localeOnly = structuredClone(artifact.content);
    const localeUi = localeOnly.locales.en.ui as unknown as Record<string, string>;
    localeUi["objective"] = "Replay-localized objective";

    const first = runReplay({
      content: localeOnly,
      initialState: artifact.initialState,
      log: artifact.log,
    });
    const second = runReplay({
      content: artifact.content,
      initialState: artifact.initialState,
      log: artifact.log,
    });

    expect(first).toEqual(second);
    expect(first.status).toBe("matched");
    expect(Object.isFrozen(first)).toBe(true);
  });

  test("matches normalized command fatals after preserving an earlier commit and pending tail", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "replay-command-fatal-match" });
    const createFatalCore = () =>
      new SimCore({
        initialState,
        commandHandlers: {
          SET_GUIDANCE_MODE: ({ state }, command) => {
            if (command.commandId === IDS.second) throw new Error("host-only command detail");
            state.tutorial = { ...state.tutorial, guidanceMode: "engineering" };
          },
        },
      });
    const recordingCore = createFatalCore();
    const recorder = createReplayRecorderForTests({ content, initialState, core: recordingCore });
    recorder.perform({
      kind: "enqueue",
      command: {
        commandId: IDS.first,
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "engineering",
      },
    });
    recorder.perform({
      kind: "enqueue",
      command: {
        commandId: IDS.second,
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "simple",
      },
    });
    recorder.perform({
      kind: "enqueue",
      command: {
        commandId: "20500000-0000-4000-8000-000000000003",
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "simple",
      },
    });
    recorder.perform({ kind: "process-pending" });
    const log = parseReplayLog(recorder.finish().log);

    const execution = executeParsedReplay({ content, log, core: createFatalCore() });

    expect(execution.report.status).toBe("matched-fatal");
    expect(execution.report.finalQueuePosition).toEqual({ nextSequence: 3, pendingCount: 1 });
    expect(execution.core.getStateForSave().tutorial.guidanceMode).toBe("engineering");
    const fatal = log.entries.at(-1)?.outcome;
    expect(fatal).toEqual({
      kind: "fatal",
      code: "SIMULATOR_INVARIANT_VIOLATION",
      origin: "command",
      commandId: IDS.second,
      tick: 0,
    });
  });

  test("matches a grouped-step tick fatal after retaining its earlier completed tick", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "replay-tick-fatal-match" });
    const createFatalCore = () =>
      new SimCore({
        initialState,
        tickSystems: {
          "rebuild-dirty-connectivity": ({ state }) => {
            if (state.tick === 1) throw new Error("host-only tick detail");
          },
        },
      });
    const recorder = createReplayRecorderForTests({
      content,
      initialState,
      core: createFatalCore(),
    });
    recorder.perform({ kind: "step", ticks: 2 });
    const log = parseReplayLog(recorder.finish().log);

    const execution = executeParsedReplay({ content, log, core: createFatalCore() });

    expect(execution.report).toMatchObject({
      status: "matched-fatal",
      finalTick: 1,
      executedEntries: 1,
      executedTicks: 1,
    });
    expect(execution.core.getStateForSave().tick).toBe(1);
  });
});
