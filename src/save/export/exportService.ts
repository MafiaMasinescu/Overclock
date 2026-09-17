import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { SaveEnvelope } from "../contracts.ts";
import { decodeSaveEnvelope, encodeEnvelopeBytes } from "../codec.ts";
import type { SaveCodecAdapters } from "../codec.ts";
import { persistenceError } from "../persistenceErrors.ts";
import { SLOT_ID_PATTERN } from "../persistenceLimits.ts";
import type { SaveRepositoryCore } from "../repository/repository.ts";

// Phase 2 Task 17.3: slot export. Contract §9 is normative: export reads a
// verified committed generation and produces new owned bytes without
// updating stored timestamps or contents. Export of unsaved live progress
// is a save-capture operation first and belongs to the host (Task 20.1),
// never to this service.

export interface ExportSlotOptions {
  readonly content: ContentBundle;
  readonly expectedRevision?: number;
  readonly adapters?: SaveCodecAdapters;
  readonly signal?: AbortSignal;
}

export interface ExportSlotResult {
  readonly bytes: Uint8Array;
  readonly envelope: SaveEnvelope;
  readonly slotId: string;
  readonly captureSequence: number;
  readonly revision: number;
}

export async function exportSlot(
  repository: SaveRepositoryCore,
  slotId: string,
  options: ExportSlotOptions,
): Promise<ExportSlotResult> {
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw persistenceError("INVALID_FORMAT", `Slot id "${slotId}" is not valid.`);
  }
  if (options.signal?.aborted === true) {
    throw persistenceError("CANCELLED", "The slot export was cancelled.");
  }
  // Metadata and generation are read in one readonly transaction so an
  // expected revision can never approve a different concurrent generation.
  const { save: stored } = await repository.readManualSaveAtRevision(
    slotId,
    options.expectedRevision,
    options.signal,
  );
  const bytes = encodeEnvelopeBytes(stored.envelope);
  // Verify the committed generation before handing out bytes: the checksum
  // must cover exactly these bytes.
  await decodeSaveEnvelope(bytes, {
    content: options.content,
    ...(options.adapters !== undefined ? { adapters: options.adapters } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return {
    bytes: new Uint8Array(bytes),
    envelope: structuredClone(stored.envelope),
    slotId,
    captureSequence: stored.captureSequence,
    revision: stored.revision,
  };
}
