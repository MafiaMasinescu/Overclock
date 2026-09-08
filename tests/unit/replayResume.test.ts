import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createReplayRecorder } from "../../src/sim/replay/replayRecorder.ts";
import {
  resumeReplay,
  verifyReplayAndCreateResumeArtifact,
} from "../../src/sim/replay/replayResume.ts";

const IDS = {
  first: "20600000-0000-4000-8000-000000000001",
  second: "20600000-0000-4000-8000-000000000002",
} as const;

function createArtifact() {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed: "replay-resume-test" });
  const recorder = createReplayRecorder({ content, initialState });
  recorder.perform({
    kind: "enqueue",
    command: {
      commandId: IDS.first,
      source: "player",
      kind: "SET_GUIDANCE_MODE",
      mode: "engineering",
    },
  });
  recorder.perform({ kind: "process-pending" });
  recorder.checkpoint();
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
  recorder.perform({ kind: "step", ticks: 1 });
  return { content, ...recorder.finish() };
}

describe("Replay resume", () => {
  test("certifies a detached nonzero checkpoint and resumes the remaining operations", () => {
    const artifact = createArtifact();
    const resumeArtifact = verifyReplayAndCreateResumeArtifact({
      content: artifact.content,
      initialState: artifact.initialState,
      log: artifact.log,
      afterSequence: 2,
    });

    expect(resumeArtifact).toMatchObject({
      resumeVersion: 1,
      afterSequence: 2,
      state: { tick: 0, seed: "replay-resume-test" },
      nextQueueSequence: 1,
    });
    expect(typeof resumeArtifact.replayHash).toBe("string");
    expect(resumeArtifact.state).not.toBe(artifact.initialState);

    const resumed = resumeReplay({
      content: artifact.content,
      log: artifact.log,
      artifact: resumeArtifact,
    });
    expect(resumed).toMatchObject({
      status: "matched",
      finalTick: 1,
      finalQueuePosition: { nextSequence: 1, pendingCount: 0 },
      lastMatchingCheckpointAfterSequence: 4,
    });
  });

  test("supports the initial empty boundary and rejects unknown or terminal boundaries", () => {
    const artifact = createArtifact();
    expect(
      verifyReplayAndCreateResumeArtifact({
        content: artifact.content,
        initialState: artifact.initialState,
        log: artifact.log,
        afterSequence: 0,
      }).afterSequence,
    ).toBe(0);

    expect(() =>
      verifyReplayAndCreateResumeArtifact({
        content: artifact.content,
        initialState: artifact.initialState,
        log: artifact.log,
        afterSequence: 1,
      }),
    ).toThrow("checkpoint boundary");
    expect(() =>
      verifyReplayAndCreateResumeArtifact({
        content: artifact.content,
        initialState: artifact.initialState,
        log: artifact.log,
        afterSequence: artifact.log.terminal.afterSequence,
      }),
    ).toThrow("terminal");
  });

  test("rejects negative-zero resume boundaries", () => {
    const artifact = createArtifact();

    expect(() =>
      verifyReplayAndCreateResumeArtifact({
        content: artifact.content,
        initialState: artifact.initialState,
        log: artifact.log,
        afterSequence: -0,
      }),
    ).toThrow("nonnegative safe integer");
  });

  test("rejects tampered artifacts before executing the remaining entries", () => {
    const artifact = createArtifact();
    const resumeArtifact = verifyReplayAndCreateResumeArtifact({
      content: artifact.content,
      initialState: artifact.initialState,
      log: artifact.log,
      afterSequence: 2,
    });
    const tampered = structuredClone(resumeArtifact);
    tampered.replayHash = "0000000000000000";

    const report = resumeReplay({
      content: artifact.content,
      log: artifact.log,
      artifact: tampered,
    });
    expect(report.status).toBe("invalid-log");
    expect(report.executedEntries).toBe(0);
  });

  test("rejects a checkpoint with pending commands and does not rebase the log", () => {
    const artifact = createArtifact();
    const tampered = structuredClone(artifact.log);
    const checkpoint = tampered.checkpoints.find((item) => item.afterSequence === 2);
    if (checkpoint === undefined) throw new Error("fixture checkpoint missing");
    checkpoint.pendingCommandCount = 1;

    expect(() =>
      verifyReplayAndCreateResumeArtifact({
        content: artifact.content,
        initialState: artifact.initialState,
        log: tampered,
        afterSequence: 2,
      }),
    ).toThrow("pending command");
  });

  test("rejects an artifact borrowed from another valid log", () => {
    const first = createArtifact();
    const secondInitialState = createInitialGameState({
      content: first.content,
      seed: "replay-resume-other-log",
    });
    const secondRecorder = createReplayRecorder({
      content: first.content,
      initialState: secondInitialState,
    });
    secondRecorder.perform({ kind: "step", ticks: 1 });
    const second = secondRecorder.finish();
    const artifact = verifyReplayAndCreateResumeArtifact({
      content: first.content,
      initialState: first.initialState,
      log: first.log,
      afterSequence: 2,
    });

    const result = resumeReplay({ content: first.content, log: second.log, artifact });

    expect(result.status).toBe("invalid-log");
    expect(result.executedEntries).toBe(0);
  });

  test("rejects a same-tick artifact rebound to the wrong operation checkpoint", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "replay-resume-boundary" });
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
    recorder.checkpoint();
    recorder.perform({
      kind: "clock",
      command: {
        commandId: IDS.second,
        source: "player",
        kind: "SET_SPEED",
        speed: 4,
      },
    });
    recorder.checkpoint();
    recorder.perform({ kind: "step", ticks: 1 });
    const log = recorder.finish().log;
    const artifact = verifyReplayAndCreateResumeArtifact({
      content,
      initialState,
      log,
      afterSequence: 1,
    });
    const rebound = structuredClone(artifact);
    rebound.afterSequence = 2;

    const result = resumeReplay({ content, log, artifact: rebound });

    expect(result.status).toBe("invalid-initial-state");
    expect(result.executedEntries).toBe(0);
  });

  test("returns detached immutable artifacts and isolates simultaneous resumptions", () => {
    const artifact = createArtifact();
    const resumeArtifact = verifyReplayAndCreateResumeArtifact({
      content: artifact.content,
      initialState: artifact.initialState,
      log: artifact.log,
      afterSequence: 2,
    });
    const originalSpeed = resumeArtifact.state.clock.speed;
    const mutableView = resumeArtifact as unknown as {
      state: { clock: { speed: number } };
    };
    try {
      mutableView.state.clock.speed = 4;
    } catch {
      // Deep freezing is the expected public ownership boundary.
    }

    const first = resumeReplay({
      content: artifact.content,
      log: artifact.log,
      artifact: resumeArtifact,
    });
    const second = resumeReplay({
      content: artifact.content,
      log: artifact.log,
      artifact: resumeArtifact,
    });

    expect(resumeArtifact.state.clock.speed).toBe(originalSpeed);
    expect(Object.isFrozen(resumeArtifact)).toBe(true);
    expect(Object.isFrozen(resumeArtifact.state.clock)).toBe(true);
    expect(first).toEqual(second);
    expect(first.status).toBe("matched");
  });
});
