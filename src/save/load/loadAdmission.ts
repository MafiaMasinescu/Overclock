import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState } from "../../sim/core/types.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";
import type { SavePayloadV1 } from "../contracts.ts";
import { decodeSaveEnvelope, encodeEnvelopeBytes } from "../codec.ts";
import type { SaveCodecAdapters } from "../codec.ts";
import { persistenceError } from "../persistenceErrors.ts";
import { SLOT_ID_PATTERN } from "../persistenceLimits.ts";
import type { SaveRepositoryCore } from "../repository/repository.ts";
import { admitGameStateForSave } from "../stateAdmission.ts";

// Phase 2 Task 17.3: load admission. Contract §9 is normative: LOAD reads
// and verifies a committed generation, then admits it through a fresh
// production core privately; only success promotes. This service performs
// the read plus admission half and returns an isolated owned candidate. It
// never mutates the live run, the slot list, or any store; promotion and
// epoch handshake belong to the host (Task 20.2).

export interface AdmitLoadedSaveOptions {
  readonly content: ContentBundle;
  readonly captureSequence?: number;
  readonly adapters?: SaveCodecAdapters;
  readonly signal?: AbortSignal;
}

export interface LoadedSaveCandidate {
  readonly payload: SavePayloadV1;
  readonly gameState: GameState;
  readonly nextQueueSequence: number;
  readonly slotId: string;
  readonly captureSequence: number;
  readonly sourceKind: "manual" | "autosave";
}

export async function admitLoadedSave(
  repository: SaveRepositoryCore,
  slotId: string,
  options: AdmitLoadedSaveOptions,
): Promise<LoadedSaveCandidate> {
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw persistenceError("INVALID_FORMAT", `Slot id "${slotId}" is not valid.`);
  }
  if (options.signal?.aborted === true) {
    throw persistenceError("CANCELLED", "The load admission was cancelled.");
  }
  const stored =
    options.captureSequence === undefined
      ? await repository.readManualSave(slotId, options.signal)
      : await repository.readAutosave(slotId, options.captureSequence, options.signal);
  // Verify the envelope checksum over the exact committed bytes, then admit
  // the migrated payload through a fresh production core with the captured
  // queue sequence. The execution state hash must certify the embedded state.
  const decoded = await decodeSaveEnvelope(encodeEnvelopeBytes(stored.envelope), {
    content: options.content,
    ...(options.adapters !== undefined ? { adapters: options.adapters } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  const payload = decoded.payload;
  if (payload.contentVersion !== options.content.contentVersion) {
    throw persistenceError(
      "INCOMPATIBLE_CONTENT",
      "The saved content version does not match current content.",
    );
  }
  if (payload.simulationContentHash !== hashSimulationContent(options.content)) {
    throw persistenceError(
      "INCOMPATIBLE_CONTENT",
      "The saved content fingerprint does not match current content.",
    );
  }
  const gameState = admitGameStateForSave({
    state: payload.gameState,
    content: options.content,
    nextQueueSequence: payload.execution.nextQueueSequence,
    expectedStateHash: payload.execution.stateHash,
  });
  return {
    payload: structuredClone(payload),
    gameState,
    nextQueueSequence: payload.execution.nextQueueSequence,
    slotId,
    captureSequence: stored.captureSequence,
    sourceKind: options.captureSequence === undefined ? "manual" : "autosave",
  };
}
