import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import {
  createReplayRecorder,
  createReplayRecorderForTests,
} from "../../src/sim/replay/replayRecorder.ts";
import { parseReplayLog } from "../../src/sim/replay/replaySchema.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";

const IDS = {
  first: "20400000-0000-4000-8000-000000000001",
  second: "20400000-0000-4000-8000-000000000002",
  third: "20400000-0000-4000-8000-000000000003",
  fourth: "20400000-0000-4000-8000-000000000004",
} as const;

function guidanceCommand(commandId: string, expectedTick?: number): SimCommand {
  return {
    commandId,
    source: "player",
    kind: "SET_GUIDANCE_MODE",
    mode: "engineering",
    ...(expectedTick === undefined ? {} : { expectedTick }),
  };
}

function createFixture(seed = "replay-recorder-test") {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed });
  return { content, initialState };
}

describe("Replay recorder", () => {
  test("records ordered public operations and emits an initial and terminal checkpoint", () => {
    const { content, initialState } = createFixture();
    const recorder = createReplayRecorder({ content, initialState });

    const enqueue = recorder.perform({
      kind: "enqueue",
      command: guidanceCommand(IDS.first, 0),
    });
    const clock = recorder.perform({
      kind: "clock",
      command: {
        commandId: IDS.second,
        source: "player",
        kind: "SET_SPEED",
        speed: 2,
        expectedTick: 0,
      },
    });
    const process = recorder.perform({ kind: "process-pending" });
    const step = recorder.perform({ kind: "step", ticks: 0 });
    const checkpoint = recorder.checkpoint();
    const artifact = recorder.finish();

    expect(enqueue).toMatchObject({
      sequence: 1,
      tickBefore: 0,
      tickAfter: 0,
      operation: { kind: "enqueue" },
      outcome: {
        kind: "receipt",
        receipt: { commandId: IDS.first, queued: true, queueSequence: 0 },
      },
    });
    expect(clock.outcome).toEqual({
      kind: "clock-result",
      result: { commandId: IDS.second, accepted: true, appliedAtTick: 0 },
    });
    expect(process.outcome).toEqual({
      kind: "command-results",
      results: [
        {
          commandId: IDS.first,
          accepted: false,
          rejectedAtTick: 0,
          code: "COMMAND_NOT_AVAILABLE",
          messageKey: "errors.command-not-available",
        },
      ],
    });
    expect(step.outcome).toEqual({
      kind: "step-result",
      result: {
        startTick: 0,
        endTick: 0,
        ticksExecuted: 0,
        simulatedSecondsAdvanced: 0,
        commandResults: [],
      },
    });
    expect(checkpoint).toEqual({
      afterSequence: 4,
      tick: 0,
      stateHash: hashCanonicalState(recorder.getStateForSave()),
      nextQueueSequence: 1,
      pendingCommandCount: 0,
    });
    expect(artifact.log.entries).toHaveLength(4);
    expect(artifact.log.terminal).toEqual({ kind: "completed", afterSequence: 4 });
    expect(artifact.log.checkpoints).toHaveLength(2);
    expect(artifact.log.checkpoints.at(-1)).toEqual(checkpoint);
    expect(parseReplayLog(artifact.log)).toEqual(artifact.log);
    expect(Object.isFrozen(artifact.log)).toBe(true);
    expect(Object.isFrozen(artifact.log.entries[0])).toBe(true);
  });

  test("supports a seed-created session and does not flush or checkpoint pending commands", () => {
    const { content } = createFixture();
    const recorder = createReplayRecorder({ content, seed: "replay-seed-created" });

    recorder.perform({ kind: "enqueue", command: guidanceCommand(IDS.first) });
    expect(() => recorder.checkpoint()).toThrow("empty command queue");
    expect(() => recorder.finish()).toThrow("empty command queue");

    const process = recorder.perform({ kind: "process-pending" });
    expect(process.outcome.kind).toBe("command-results");
    expect(recorder.finish().log.terminal).toEqual({ kind: "completed", afterSequence: 2 });
  });

  test("owns operation inputs, entries, and returned artifacts", () => {
    const { content, initialState } = createFixture();
    const recorder = createReplayRecorder({ content, initialState });
    const command = guidanceCommand(IDS.first);
    const operation = { kind: "enqueue" as const, command };
    const entry = recorder.perform(operation);
    command.source = "debug";
    command.kind = "SET_GUIDANCE_MODE";
    operation.kind = "enqueue";

    expect(entry.operation).toEqual({ kind: "enqueue", command: guidanceCommand(IDS.first) });
    expect(recorder.perform({ kind: "process-pending" }).outcome).toMatchObject({
      kind: "command-results",
      results: [{ commandId: IDS.first }],
    });

    const artifact = recorder.finish();
    try {
      artifact.log.entries.push(entry);
    } catch {
      // Frozen artifacts are the expected ownership boundary.
    }
    expect(artifact.log.entries).toHaveLength(2);
  });

  test("records a command fatal as the terminal operation and preserves the pending tail", () => {
    const { content, initialState } = createFixture();
    const core = new SimCore({
      initialState,
      commandHandlers: {
        SET_GUIDANCE_MODE: ({ state }) => {
          state.clock = { ...state.clock, paused: !state.clock.paused };
          throw new Error("injected command failure");
        },
      },
    });
    const recorder = createReplayRecorderForTests({ content, initialState, core });
    recorder.perform({ kind: "enqueue", command: guidanceCommand(IDS.first) });
    recorder.perform({ kind: "enqueue", command: guidanceCommand(IDS.second) });
    const fatal = recorder.perform({ kind: "process-pending" });
    const artifact = recorder.finish();

    expect(fatal.outcome).toEqual({
      kind: "fatal",
      code: "SIMULATOR_INVARIANT_VIOLATION",
      origin: "command",
      commandId: IDS.first,
      tick: 0,
    });
    expect(artifact.log.terminal).toEqual({ kind: "fatal", afterSequence: 3 });
    expect(artifact.log.checkpoints.at(-1)).toMatchObject({
      afterSequence: 3,
      tick: 0,
      nextQueueSequence: 2,
      pendingCommandCount: 1,
    });
    expect(recorder.getCommandQueuePosition()).toEqual({ nextSequence: 2, pendingCount: 1 });
    expect(recorder.getStateForSave().clock.paused).toBe(true);
  });

  test("records a tick-system fatal after keeping earlier completed ticks", () => {
    const { content, initialState } = createFixture("replay-tick-fatal");
    const core = new SimCore({
      initialState,
      tickSystems: {
        "rebuild-dirty-connectivity": ({ state }) => {
          if (state.tick === 1) throw new Error("injected tick failure");
        },
      },
    });
    const recorder = createReplayRecorderForTests({ content, initialState, core });

    const fatal = recorder.perform({ kind: "step", ticks: 2 });
    const artifact = recorder.finish();

    expect(fatal).toMatchObject({
      sequence: 1,
      tickBefore: 0,
      tickAfter: 1,
      outcome: {
        kind: "fatal",
        code: "SIMULATOR_INVARIANT_VIOLATION",
        origin: "tick-system",
        commandId: null,
        tick: 1,
        stage: "rebuild-dirty-connectivity",
      },
    });
    expect(artifact.log.terminal).toEqual({ kind: "fatal", afterSequence: 1 });
    expect(recorder.getStateForSave().tick).toBe(1);
  });

  test("rejects operations after a fatal session and never changes the authoritative state", () => {
    const { content, initialState } = createFixture();
    const core = new SimCore({
      initialState,
      commandHandlers: {
        SET_GUIDANCE_MODE: () => {
          throw new Error("fatal");
        },
      },
    });
    const recorder = createReplayRecorderForTests({ content, initialState, core });
    recorder.perform({ kind: "enqueue", command: guidanceCommand(IDS.first) });
    const before = hashCanonicalState(recorder.getStateForSave());
    recorder.perform({ kind: "process-pending" });
    expect(() => recorder.perform({ kind: "step", ticks: 0 })).toThrow(
      "Replay recording session is already terminal.",
    );
    expect(hashCanonicalState(recorder.getStateForSave())).toBe(before);
  });

  test("never exports a certified artifact when fatal checkpoint capture fails", () => {
    const { content, initialState } = createFixture("replay-fatal-checkpoint-capture");
    class FailingCheckpointCore extends SimCore {
      private saveCalls = 0;

      override getStateForSave() {
        this.saveCalls += 1;
        if (this.saveCalls >= 2) throw new Error("injected checkpoint capture failure");
        return super.getStateForSave();
      }
    }
    const core = new FailingCheckpointCore({
      initialState,
      commandHandlers: {
        SET_GUIDANCE_MODE: () => {
          throw new Error("injected command failure");
        },
      },
    });
    const recorder = createReplayRecorderForTests({ content, initialState, core });
    recorder.perform({ kind: "enqueue", command: guidanceCommand(IDS.first) });

    expect(() => recorder.perform({ kind: "process-pending" })).toThrow(
      "Replay recording failed because the simulator raised an unexpected internal error.",
    );
    expect(() => recorder.finish()).toThrow(
      "Replay recording failed because the simulator raised an unexpected internal error.",
    );
    expect(() => recorder.checkpoint()).toThrow(
      "Replay recording failed because the simulator raised an unexpected internal error.",
    );
  });
});
