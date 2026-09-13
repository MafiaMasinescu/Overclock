import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createReplayCommandDriver } from "../../src/devtools/milestoneBot/replayCommandDriver.ts";
import type { MilestoneBotPolicyId } from "../../src/devtools/milestoneBot/botContracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { runReplay } from "../../src/sim/replay/replayRunner.ts";

const POLICY_IDS: readonly MilestoneBotPolicyId[] = [
  "baseline-balanced",
  "conservative-thermal",
  "aggressive-boost",
];

interface TraceFingerprint {
  readonly campaignYear: number;
  readonly finalRngState: number;
  readonly finalStateHash: string;
  readonly journalHash: string;
  readonly replayHash: string;
}

function runBoundaryTrace(policyId: MilestoneBotPolicyId): TraceFingerprint {
  const content = loadContentBundle();
  const initialState = createInitialGameState({ content, seed: `task-15-exact-100-${policyId}` });
  initialState.tick = 11_999;
  initialState.clock.simulatedSeconds = 1_199.9;
  const driver = createReplayCommandDriver({
    content,
    seed: `task-15-exact-100-${policyId}`,
    initialState,
  });

  driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
  driver.submitGameplayCommand({ kind: "ENTER_DESIGN_MODE" });
  driver.submitGameplayCommand({ kind: "CANCEL_DESIGN" });
  driver.advanceTicks(1);
  const finalState = driver.getDetachedState();
  expect(finalState.campaign.currentYear).toBe(1947);

  const artifact = driver.finishReplay();
  const replay = runReplay({ content, initialState: artifact.initialState, log: artifact.log });
  expect(replay.status).toBe("matched");

  return {
    campaignYear: finalState.campaign.currentYear,
    finalRngState: finalState.rngState,
    finalStateHash: hashCanonicalState(finalState),
    journalHash: hashCanonicalState(driver.getJournal()),
    replayHash: hashCanonicalState(artifact.log),
  };
}

describe("Task 15 exact-100 bounded determinism", () => {
  test.each(POLICY_IDS)(
    "preserves the campaign boundary and Replay trace for %s",
    (policyId) => {
      const expected = runBoundaryTrace(policyId);
      for (let run = 0; run < 99; run += 1) {
        expect(runBoundaryTrace(policyId)).toEqual(expected);
      }
    },
    120_000,
  );
});
