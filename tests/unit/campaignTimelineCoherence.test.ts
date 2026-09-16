import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { StructuralSharingTickSystemContext } from "../../src/sim/core/tickSystems.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createReplayRecorder } from "../../src/sim/replay/replayRecorder.ts";
import { runReplay } from "../../src/sim/replay/replayRunner.ts";
import {
  resumeReplay,
  verifyReplayAndCreateResumeArtifact,
} from "../../src/sim/replay/replayResume.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import { createTaskBenchmarkTickSystems } from "../../src/sim/tasks/facilityTasks.ts";

function stateAtTick(tick: number, year: number, seed = `campaign-${tick}`) {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed });
  state.tick = tick;
  state.clock.simulatedSeconds = tick / 10;
  state.campaign.currentYear = year;
  return { content, state };
}

describe("Campaign timeline coherence", () => {
  test.each([
    [-0, 1946],
    [-1, 1946],
    [0.5, 1946],
    [Number.NaN, 1946],
    [Number.POSITIVE_INFINITY, 1946],
    [Number.MAX_SAFE_INTEGER + 1, 1948],
  ])("rejects invalid authoritative tick %s", (tick, year) => {
    const { content, state } = stateAtTick(tick, year);
    expect(() => createProductionSimCore({ content, initialState: state })).toThrow(
      /tick|serializable|non-finite/i,
    );
  });

  test.each([
    [0, 1948, "research-forced-airflow"],
    [24_000, 1946, null],
  ] as const)(
    "rejects incoherent year %i at tick %i during production construction",
    (tick, year, prerequisite) => {
      const { content, state } = stateAtTick(tick, year, `campaign-construction-${tick}`);
      if (prerequisite !== null) state.research.statuses[prerequisite] = "completed";

      expect(() => createProductionSimCore({ content, initialState: state })).toThrow(
        /campaign\.currentYear/i,
      );
    },
  );

  test("does not allow direct SimCore construction to omit Campaign content validation", () => {
    const { content, state } = stateAtTick(0, 1948, "campaign-direct-core");
    state.research.statuses["research-forced-airflow"] = "completed";

    expect(
      () =>
        new SimCore({
          initialState: state,
          tickSystems: createTaskBenchmarkTickSystems(content),
        }),
    ).toThrow(/campaign\.currentYear/i);
  });

  test("rejects future and stale years at replacement without changing authority or RNG", () => {
    const content = loadContentBundle();
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "campaign-replacement" }),
    });
    const before = core.getStateForSave();
    const beforeHash = hashCanonicalState(before);

    for (const [tick, year] of [
      [0, 1948],
      [24_000, 1946],
    ] as const) {
      const replacement = structuredClone(before);
      replacement.tick = tick;
      replacement.clock.simulatedSeconds = tick / 10;
      replacement.campaign.currentYear = year;

      expect(() => {
        core.replaceState(replacement);
      }).toThrow(/campaign\.currentYear/i);
      expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
      expect(core.getStateForSave().rngState).toBe(before.rngState);
    }
  });

  test.each([
    [11_999, 1946, 12_000, 1947],
    [23_999, 1947, 24_000, 1948],
  ] as const)(
    "commits the exact next Campaign year once across tick %i",
    (startTick, startYear, endTick, endYear) => {
      const { content, state } = stateAtTick(startTick, startYear);
      const core = createProductionSimCore({ content, initialState: state });

      expect(core.step(1)).toMatchObject({ startTick, endTick, ticksExecuted: 1 });
      expect(core.getStateForSave()).toMatchObject({
        tick: endTick,
        campaign: { currentYear: endYear },
      });
    },
  );

  test("preserves Task offer timing at the 1947 transition", () => {
    const { content, state } = stateAtTick(11_999, 1946, "campaign-offer-timing");
    state.research.statuses["research-forced-airflow"] = "completed";
    const core = createProductionSimCore({ content, initialState: state });

    core.step(1);
    expect(core.getStateForSave().campaign.currentYear).toBe(1947);
    expect(core.getStateForSave().tasks.offers).not.toContain("task-reactor-diffusion-study");

    core.step(1);
    expect(core.getStateForSave().tasks.offers).toContain("task-reactor-diffusion-study");
  });

  test("preserves Task offer timing at the 1948 transition", () => {
    const { content, state } = stateAtTick(23_999, 1947, "campaign-1948-offer-timing");
    state.research.statuses["research-delay-line-memory"] = "completed";
    const core = createProductionSimCore({ content, initialState: state });

    core.step(1);
    expect(core.getStateForSave().campaign.currentYear).toBe(1948);
    expect(core.getStateForSave().tasks.offers).not.toContain("task-semiconductor-effect-analysis");

    core.step(1);
    expect(core.getStateForSave().tasks.offers).toContain("task-semiconductor-effect-analysis");
  });

  test("does not advance Campaign through step(0), command-only clock changes, pause, or speed", () => {
    const { content, state } = stateAtTick(11_999, 1946, "campaign-clock-controls");
    const core = createProductionSimCore({ content, initialState: state });
    const before = hashCanonicalState(core.getStateForSave());

    core.step(0);
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
    core.applyClockCommand({
      commandId: "21580000-0000-4000-8000-000000000001",
      source: "player",
      kind: "SET_PAUSED",
      paused: false,
    });
    core.applyClockCommand({
      commandId: "21580000-0000-4000-8000-000000000002",
      source: "player",
      kind: "SET_SPEED",
      speed: 4,
    });
    expect(core.getStateForSave()).toMatchObject({
      tick: 11_999,
      campaign: { currentYear: 1946 },
      clock: { paused: false, speed: 4 },
    });
  });

  test.each(["missing", "incorrect"] as const)(
    "rejects %s Campaign output and rolls back the failing tick and RNG",
    (mode) => {
      const { content, state } = stateAtTick(11_998, 1946, `campaign-fatal-${mode}`);
      const expectedRng = createSeededRngFromState(state.rngState);
      expectedRng.nextUint32();
      const core = new SimCore({
        content,
        initialState: state,
        tickSystems: {
          "update-tutorial-achievements-and-campaign": ({ state: candidate, rng }) => {
            rng.nextUint32();
            if (candidate.tick !== 11_999) return;
            if (mode === "incorrect") candidate.campaign.currentYear = 1948;
          },
        },
      });

      expect(() => core.step(3)).toThrow(SimulatorInvariantError);
      expect(core.getStateForSave()).toMatchObject({
        tick: 11_999,
        rngState: expectedRng.getState(),
        campaign: { currentYear: 1946 },
      });
    },
  );

  test("returns a coherent detached save whose references cannot mutate authority", () => {
    const { content, state } = stateAtTick(12_000, 1947, "campaign-save-ownership");
    const core = createProductionSimCore({ content, initialState: state });
    const saved = core.getStateForSave();
    saved.campaign.currentYear = 1948;
    saved.tick = 0;

    expect(core.getStateForSave()).toMatchObject({
      tick: 12_000,
      campaign: { currentYear: 1947 },
    });
  });

  test("rejects an incoherent Replay initial state even when its hashes are recomputed", () => {
    const content = loadContentBundle();
    const recorder = createReplayRecorder({ content, seed: "campaign-replay-initial" });
    const artifact = recorder.finish();
    const initialState = structuredClone(artifact.initialState);
    const log = structuredClone(artifact.log);
    initialState.campaign.currentYear = 1948;
    const forgedHash = hashCanonicalState(initialState);
    log.initialStateHash = forgedHash;
    const initialCheckpoint = log.checkpoints[0];
    if (initialCheckpoint === undefined) throw new Error("Expected initial Replay checkpoint.");
    log.checkpoints[0] = { ...initialCheckpoint, stateHash: forgedHash };

    expect(runReplay({ content, initialState, log }).status).toBe("invalid-initial-state");
    expect(() => createReplayRecorder({ content, initialState })).toThrow(/campaign\.currentYear/i);
  });

  test("rejects Replay initial-state accessors and custom prototypes before cloning", () => {
    const content = loadContentBundle();
    const recording = createReplayRecorder({ content, seed: "campaign-replay-ownership" }).finish();
    const accessorState = structuredClone(recording.initialState);
    let reads = 0;
    Object.defineProperty(accessorState, "campaign", {
      enumerable: true,
      get() {
        reads += 1;
        return recording.initialState.campaign;
      },
    });

    expect(runReplay({ content, initialState: accessorState, log: recording.log }).status).toBe(
      "invalid-initial-state",
    );
    expect(reads).toBe(0);

    const prototypeState = structuredClone(recording.initialState);
    Object.setPrototypeOf(prototypeState, { forged: true });
    expect(runReplay({ content, initialState: prototypeState, log: recording.log }).status).toBe(
      "invalid-initial-state",
    );
  });

  test("rejects incoherent resume construction and use through supported public APIs", () => {
    const content = loadContentBundle();
    const recorder = createReplayRecorder({ content, seed: "campaign-replay-resume" });
    recorder.perform({ kind: "step", ticks: 1 });
    recorder.checkpoint();
    recorder.perform({ kind: "step", ticks: 1 });
    const recording = recorder.finish();

    const invalidInitial = structuredClone(recording.initialState);
    invalidInitial.campaign.currentYear = 1948;
    expect(() =>
      verifyReplayAndCreateResumeArtifact({
        content,
        initialState: invalidInitial,
        log: recording.log,
        afterSequence: 1,
      }),
    ).toThrow();

    const artifact = structuredClone(
      verifyReplayAndCreateResumeArtifact({
        content,
        initialState: recording.initialState,
        log: recording.log,
        afterSequence: 1,
      }),
    );
    const log = structuredClone(recording.log);
    artifact.state.campaign.currentYear = 1948;
    const forgedStateHash = hashCanonicalState(artifact.state);
    const checkpoint = log.checkpoints.find((item) => item.afterSequence === 1);
    if (checkpoint === undefined) throw new Error("Expected resumable checkpoint.");
    checkpoint.stateHash = forgedStateHash;
    artifact.replayHash = hashCanonicalState(log);

    expect(resumeReplay({ content, log, artifact }).status).toBe("invalid-initial-state");
  });

  test("rejects a resume-source accessor before cloning or prefix execution", () => {
    const content = loadContentBundle();
    const recorder = createReplayRecorder({ content, seed: "campaign-resume-accessor" });
    recorder.perform({ kind: "step", ticks: 1 });
    recorder.checkpoint();
    recorder.perform({ kind: "step", ticks: 1 });
    const recording = recorder.finish();
    const initialState = structuredClone(recording.initialState);
    let reads = 0;
    Object.defineProperty(initialState, "tick", {
      enumerable: true,
      get() {
        reads += 1;
        return 0;
      },
    });

    expect(() =>
      verifyReplayAndCreateResumeArtifact({
        content,
        initialState,
        log: recording.log,
        afterSequence: 1,
      }),
    ).toThrow();
    expect(reads).toBe(0);
  });

  test("rejects accessors before reading external tick or Campaign fields", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-accessor" });
    let reads = 0;
    Object.defineProperty(state, "tick", {
      enumerable: true,
      get() {
        reads += 1;
        return 0;
      },
    });

    expect(() => createProductionSimCore({ content, initialState: state })).toThrow(
      /accessor|serializable/i,
    );
    expect(reads).toBe(0);
  });

  test("rejects replacement accessors without clearing runtime evidence", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "campaign-replacement-accessor" });
    let clearCount = 0;
    let reads = 0;
    const core = new SimCore({
      content,
      initialState,
      tickSystems: {
        "update-tutorial-achievements-and-campaign": {
          createRuntime: () => ({
            executionMode: "structural-sharing",
            run: ({ state }) => state,
            clearDerivedState: () => {
              clearCount += 1;
            },
          }),
        },
      },
    });
    const invalid = core.getStateForSave();
    Object.defineProperty(invalid, "campaign", {
      enumerable: true,
      get() {
        reads += 1;
        return initialState.campaign;
      },
    });

    expect(() => {
      core.replaceState(invalid);
    }).toThrow(/accessor|serializable/i);
    expect(reads).toBe(0);
    expect(clearCount).toBe(1);
    expect(core.getStateForSave()).toEqual(initialState);
  });

  test("keeps independent runtimes isolated after a rejected replacement", () => {
    const content = loadContentBundle();
    const first = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "campaign-runtime-first" }),
    });
    const second = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "campaign-runtime-second" }),
    });
    const invalid = first.getStateForSave();
    invalid.campaign.currentYear = 1948;

    expect(() => {
      first.replaceState(invalid);
    }).toThrow(/campaign\.currentYear/i);
    second.step(1);

    expect(first.getStateForSave()).toMatchObject({
      tick: 0,
      campaign: { currentYear: 1946 },
    });
    expect(second.getStateForSave()).toMatchObject({
      tick: 1,
      campaign: { currentYear: 1946 },
    });
  });

  test("does not leak validation evidence from a replacement rejected by a later runtime", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "campaign-runtime-evidence" });
    let liveEvidenceTick = -1;
    let runtimeSequence = 0;
    let rejectNextTickOneValidation = false;
    const core = new SimCore({
      content,
      initialState,
      tickSystems: {
        "calculate-power-demand-and-delivery": {
          createRuntime: () => {
            const isLiveRuntime = runtimeSequence === 0;
            runtimeSequence += 1;
            let evidenceTick = -1;
            return {
              executionMode: "structural-sharing" as const,
              validateLifecycleState(state) {
                evidenceTick = state.tick;
                if (isLiveRuntime) liveEvidenceTick = evidenceTick;
              },
              run({ state }: StructuralSharingTickSystemContext) {
                if (evidenceTick !== state.tick) {
                  throw new Error(`leaked-evidence:${evidenceTick}!=${state.tick}`);
                }
                return state;
              },
              clearDerivedState() {
                evidenceTick = -1;
                if (isLiveRuntime) liveEvidenceTick = -1;
              },
            };
          },
        },
        "update-tutorial-achievements-and-campaign": {
          createRuntime: () => ({
            executionMode: "structural-sharing" as const,
            validateLifecycleState(state) {
              if (state.tick === 1 && rejectNextTickOneValidation) {
                rejectNextTickOneValidation = false;
                throw new Error("reject-late");
              }
            },
            run: ({ state }: StructuralSharingTickSystemContext) => state,
          }),
        },
      },
    });
    expect(liveEvidenceTick).toBe(0);
    const replacement = core.getStateForSave();
    replacement.tick = 1;
    replacement.clock.simulatedSeconds = 0.1;
    rejectNextTickOneValidation = true;

    expect(() => {
      core.replaceState(replacement);
    }).toThrow(/reject-late/);
    expect(liveEvidenceTick).toBe(0);
    expect(() => core.step(1)).not.toThrow();
    expect(core.getStateForSave().tick).toBe(1);
  });

  test("promotes validated replacement runtimes before the first tick after an accepted replacement", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "campaign-runtime-promotion" });
    const core = new SimCore({
      content,
      initialState,
      tickSystems: {
        "calculate-power-demand-and-delivery": {
          createRuntime: () => {
            let evidenceTick = -1;
            return {
              executionMode: "structural-sharing" as const,
              validateLifecycleState(state) {
                evidenceTick = state.tick;
              },
              run({ state }: StructuralSharingTickSystemContext) {
                if (evidenceTick !== state.tick) {
                  throw new Error(`missing-live-evidence:${evidenceTick}!=${state.tick}`);
                }
                return state;
              },
              clearDerivedState() {
                evidenceTick = -1;
              },
            };
          },
        },
      },
    });
    const replacement = core.getStateForSave();
    replacement.tick = 1;
    replacement.clock.simulatedSeconds = 0.1;

    expect(() => {
      core.replaceState(replacement);
    }).not.toThrow();
    expect(() => core.step(1)).not.toThrow();
    expect(core.getStateForSave().tick).toBe(2);
  });

  test("cannot corrupt the retained runtime when retirement cleanup throws", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "campaign-runtime-retirement" });
    let runtimeSequence = 0;
    let failLiveRetirement = false;
    const core = new SimCore({
      content,
      initialState,
      tickSystems: {
        "calculate-power-demand-and-delivery": {
          createRuntime: () => {
            const isInitialRuntime = runtimeSequence === 0;
            runtimeSequence += 1;
            let evidenceTick = -1;
            return {
              executionMode: "structural-sharing" as const,
              validateLifecycleState(state) {
                evidenceTick = state.tick;
              },
              run({ state }: StructuralSharingTickSystemContext) {
                if (evidenceTick !== state.tick) {
                  throw new Error(`retirement-evidence:${evidenceTick}!=${state.tick}`);
                }
                return state;
              },
              clearDerivedState() {
                evidenceTick = -1;
                if (isInitialRuntime && failLiveRetirement) throw new Error("clear-failed");
              },
            };
          },
        },
      },
    });
    const replacement = core.getStateForSave();
    replacement.tick = 1;
    replacement.clock.simulatedSeconds = 0.1;
    failLiveRetirement = true;

    expect(() => {
      core.replaceState(replacement);
    }).not.toThrow();
    expect(() => core.step(1)).not.toThrow();
    expect(core.getStateForSave().tick).toBe(2);
  });
});
