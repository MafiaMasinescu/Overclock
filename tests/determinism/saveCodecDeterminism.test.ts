import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import { encodeSaveEnvelope } from "../../src/save/codec.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";

function createPayload(): SavePayloadV1 {
  const content = loadContentBundle();
  const gameState = createInitialGameState({ content, seed: "deterministic-save-ș" });
  return {
    schemaVersion: 1,
    saveVersion: 1,
    contentVersion: content.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    createdAtIso: "2026-09-16T12:00:00.000Z",
    savedAtIso: "2026-09-16T12:00:00.000Z",
    slotId: "save-determinism",
    gameState,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence: 0,
      pendingCommandCount: 0,
      stateHash: hashCanonicalState(gameState),
    },
    settings: {
      language: "ro",
      telemetryPreset: "diagnostics",
      reducedEffects: true,
      reducedMotion: true,
      frameCap: 30,
      volumes: { master: 0.9, music: 0.8, ui: 0.7, machinery: 0.6, alerts: 1 },
    },
    localStats: {
      realPlayTimeSeconds: 12,
      taskCompletions: 2,
      taskAbandons: 1,
      emergencyShutdowns: 0,
      benchmarkAttempts: 3,
      designApplications: 4,
    },
  };
}

describe("save codec determinism", () => {
  test("repeats canonical bytes, checksum, and envelope exactly 100 times", async () => {
    const payload = createPayload();
    const first = await encodeSaveEnvelope(payload, { compression: "none" });

    for (let index = 0; index < 100; index += 1) {
      const current = await encodeSaveEnvelope(payload, { compression: "none" });
      expect(current.canonicalPayload).toBe(first.canonicalPayload);
      expect(current.envelope.checksum).toBe(first.envelope.checksum);
      expect(current.bytes).toEqual(first.bytes);
    }
  }, 30_000);
});
