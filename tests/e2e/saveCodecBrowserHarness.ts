import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { decodeSaveEnvelope, encodeSaveEnvelope } from "../../src/save/codec.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";

export async function runBrowserSaveCodecRoundTrip(): Promise<{
  readonly noneHash: string;
  readonly gzipHash: string;
  readonly stateHash: string;
  readonly nativeCrypto: boolean;
  readonly nativeCompression: boolean;
}> {
  const content = loadContentBundle();
  const gameState = createInitialGameState({ content, seed: "browser-codec-e2e" });
  const stateHash = hashCanonicalState(gameState);
  const payload: SavePayloadV1 = {
    schemaVersion: 1,
    saveVersion: gameState.saveVersion,
    contentVersion: gameState.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    createdAtIso: "2026-09-21T12:00:00.000Z",
    savedAtIso: "2026-09-21T12:00:00.000Z",
    slotId: "browser-codec-e2e",
    gameState,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence: 0,
      pendingCommandCount: 0,
      stateHash,
    },
    settings: {
      language: "en",
      telemetryPreset: "standard",
      reducedEffects: false,
      reducedMotion: false,
      frameCap: 60,
      volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
    },
    localStats: {
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    },
  };

  const none = await encodeSaveEnvelope(payload, { content, compression: "none" });
  const decodedNone = await decodeSaveEnvelope(none.bytes, { content });
  const gzip = await encodeSaveEnvelope(payload, { content, compression: "gzip" });
  const decodedGzip = await decodeSaveEnvelope(gzip.bytes, { content });

  if (decodedNone.payload.execution.stateHash !== stateHash) throw new Error("none state mismatch");
  if (decodedGzip.payload.execution.stateHash !== stateHash) throw new Error("gzip state mismatch");
  if (decodedNone.canonicalPayload !== decodedGzip.canonicalPayload)
    throw new Error("canonical payload mismatch");

  return {
    noneHash: none.envelope.checksum,
    gzipHash: gzip.envelope.checksum,
    stateHash,
    nativeCrypto: typeof globalThis.crypto.subtle !== "undefined",
    nativeCompression:
      typeof globalThis.CompressionStream !== "undefined" &&
      typeof globalThis.DecompressionStream !== "undefined",
  };
}
