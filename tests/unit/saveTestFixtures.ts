import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SaveEnvelope, SavePayloadV1, SavePreview } from "../../src/save/contracts.ts";
import { encodeSaveEnvelope } from "../../src/save/codec.ts";
import { DEFAULT_PLAYER_SETTINGS } from "../../src/save/schema.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";

// Shared Task 17 fixtures: a valid initial-state payload plus its matching
// preview, and a prepared (encoded) pair ready for repository writes. The
// expensive canonical encode/Hash runs here, before any transaction opens,
// mirroring the production preparation boundary.

export const saveTestContent = loadContentBundle();

export function createPayload(
  slotId: string,
  overrides?: { savedAtIso?: string; seedSuffix?: string },
): SavePayloadV1 {
  const content = saveTestContent;
  const gameState = createInitialGameState({
    content,
    seed: `repo-seed-${slotId}${overrides?.seedSuffix ?? ""}`,
  });
  return {
    schemaVersion: 1,
    saveVersion: 1,
    contentVersion: content.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    createdAtIso: "2026-09-17T10:00:00.000Z",
    savedAtIso: overrides?.savedAtIso ?? "2026-09-17T10:00:01.000Z",
    slotId,
    gameState,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence: 0,
      pendingCommandCount: 0,
      stateHash: hashCanonicalState(gameState),
    },
    settings: DEFAULT_PLAYER_SETTINGS,
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

export function previewFor(payload: SavePayloadV1, slotId: string): SavePreview {
  return {
    sourceSchemaVersion: 1,
    sourceSaveVersion: 1,
    contentVersion: payload.contentVersion,
    simulatedYear: payload.gameState.campaign.currentYear,
    tick: payload.gameState.tick,
    cashUsd: payload.gameState.economy.cashUsd,
    verticalSliceCompleted: payload.gameState.campaign.verticalSliceCompleted,
    savedAtIso: payload.savedAtIso,
    migrationRequired: false,
    compatibility: "compatible",
    destinationSuggestion: { kind: "new-slot" },
    compressedBytes: 100,
    uncompressedBytes: 200,
    slotId,
  };
}

export async function preparedPair(
  slotId: string,
  overrides?: { savedAtIso?: string; seedSuffix?: string },
): Promise<{ envelope: SaveEnvelope; preview: SavePreview }> {
  const payload = createPayload(slotId, overrides);
  const encoded = await encodeSaveEnvelope(payload, {
    content: saveTestContent,
    compression: "none",
  });
  return { envelope: encoded.envelope, preview: previewFor(payload, slotId) };
}
