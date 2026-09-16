import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createReplayRecorder } from "../../src/sim/replay/replayRecorder.ts";
import { runReplay } from "../../src/sim/replay/replayRunner.ts";

const content = loadContentBundle();

function runCampaignBoundary() {
  const state = createInitialGameState({ content, seed: "campaign-exact-100" });
  state.tick = 11_999;
  state.clock.simulatedSeconds = 1_199.9;
  const initialRngState = state.rngState;
  const recorder = createReplayRecorder({ content, initialState: state });
  recorder.perform({ kind: "step", ticks: 2 });
  const artifact = recorder.finish();
  const report = runReplay({ content, initialState: artifact.initialState, log: artifact.log });
  const core = createProductionSimCore({ content, initialState: state });
  core.step(2);
  const finalState = core.getStateForSave();
  return {
    stateHash: hashCanonicalState(finalState),
    replayHash: report.replayHash,
    reportStatus: report.status,
    tick: finalState.tick,
    year: finalState.campaign.currentYear,
    rngUnchanged: finalState.rngState === initialRngState,
  };
}

describe("Campaign timeline determinism", () => {
  test("repeats the Campaign and Replay boundary result exactly 100 times without RNG use", () => {
    const expected = runCampaignBoundary();
    expect(expected).toMatchObject({
      reportStatus: "matched",
      tick: 12_001,
      year: 1947,
      rngUnchanged: true,
    });
    for (let run = 1; run < 100; run += 1) {
      expect(runCampaignBoundary()).toEqual(expected);
    }
  }, 30_000);
});
