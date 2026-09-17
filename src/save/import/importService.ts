import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { SavePayloadV1, SavePreview } from "../contracts.ts";
import { encodeSaveEnvelope, inspectSaveEnvelopeForImport, sha256Hex } from "../codec.ts";
import type { SaveCodecAdapters } from "../codec.ts";
import { persistenceError } from "../persistenceErrors.ts";
import { MAX_IMPORT_CANDIDATE_MINUTES, SLOT_ID_PATTERN } from "../persistenceLimits.ts";
import { parseSavePreview } from "../schema.ts";
import {
  admitGameStateForSave,
  admitSavePayloadForContent,
  inspectGameStateForImportPreview,
} from "../stateAdmission.ts";
import type { SaveRepositoryCore } from "../repository/repository.ts";
import type { SlotMetaRecord } from "../repository/types.ts";
import { isSlotBusy } from "../repository/slots.ts";
import type { WebLockAdapter } from "../repository/webLocks.ts";
import { canonicalSerialize } from "../../sim/replay/canonicalState.ts";
import { hashCanonicalState } from "../../sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";

// Phase 2 Task 17.3: verified import preview and confirmation. Contract §9
// is normative. Preview is read-only and derives display values only after
// envelope verification, migration, content compatibility, and full
// production state admission. Confirmation consumes a bound one-use token
// and commits atomically; it never touches the live run (an explicit load
// does that separately in Task 20.2) and never logs file paths.
//
// Typed errors for the future client (Task 20.3 dialogs):
// previewImport throws INVALID_FORMAT (unparseable envelope, duplicate keys,
// schema shape), LIMIT_EXCEEDED (file/payload/decompression bounds),
// CHECKSUM_MISMATCH (envelope digest), UNSUPPORTED_VERSION (future schema),
// MIGRATION_FAILED, CANCELLED, or INVALID_STATE (missing overwrite target).
// previewImport returns token null with preview.compatibility
// INCOMPATIBLE_CONTENT (contentVersion/fingerprint drift) or INVALID_STATE /
// CHECKSUM_MISMATCH (state admission failure).
// confirmImport throws TOKEN_CONSUMED (unknown, replaced, or consumed token),
// TOKEN_EXPIRED (older than five monotonic minutes), STALE_REVISION
// (destination moved or caller revision mismatch), STALE_WRITER (owner
// changed since preview), INCOMPATIBLE_CONTENT (content drifted since
// preview), SLOT_ACTIVE (destination runs live), QUOTA_EXCEEDED /
// STORAGE_ABORTED (commit failure; the token is retained for retry), or
// CANCELLED. A failed confirmation never consumes the token.

export const IMPORT_CANDIDATE_TTL_MS = MAX_IMPORT_CANDIDATE_MINUTES * 60 * 1000;

export interface ImportServiceOptions {
  readonly repository: SaveRepositoryCore;
  readonly locks: WebLockAdapter;
  readonly loadContent: () => ContentBundle;
  readonly nowMs?: () => number;
  readonly generateSlotId?: () => string;
  readonly isSlotActive?: (slotId: string) => boolean;
  readonly adapters?: SaveCodecAdapters;
  readonly scheduleExpiry?: (callback: () => void, delayMs: number) => () => void;
}

export interface PreviewImportRequest {
  readonly bytes: Uint8Array;
  readonly destination?:
    { readonly kind: "new-slot" } | { readonly kind: "overwrite"; readonly slotId: string };
  readonly signal?: AbortSignal;
}

export interface PreviewImportResult {
  readonly preview: SavePreview;
  readonly token: string | null;
  readonly allocatedSlotId: string | null;
}

export interface ConfirmImportOptions {
  readonly expectedRevision?: number;
  readonly applySettings?: boolean;
  readonly signal?: AbortSignal;
}

export interface ConfirmImportResult {
  readonly slotId: string;
  readonly meta: SlotMetaRecord;
  readonly appliedSettings: boolean;
  readonly settingsRevision: number | null;
}

type ImportPlan =
  | { readonly kind: "new-slot"; readonly slotId: string }
  | {
      readonly kind: "overwrite";
      readonly slotId: string;
      readonly expectedRevision: number;
      readonly expectedWriterEpoch: number;
    };

interface ImportCandidate {
  readonly token: string;
  readonly payload: SavePayloadV1;
  readonly previewBase: SavePreview;
  readonly sourceDigest: string;
  readonly candidateDigest: string;
  readonly contentFingerprint: string;
  readonly plan: ImportPlan;
  readonly createdAtMs: number;
}

function defaultNowMs(): number {
  const performanceValue: unknown = Reflect.get(globalThis, "performance");
  if (
    performanceValue !== null &&
    typeof performanceValue === "object" &&
    typeof (performanceValue as { now?: unknown }).now === "function"
  ) {
    return (performanceValue as { now: () => number }).now();
  }
  throw persistenceError("STORAGE_ABORTED", "A monotonic performance clock is unavailable.");
}

function defaultGenerateSlotId(): string {
  const cryptoValue: unknown = Reflect.get(globalThis, "crypto");
  const randomUuid: unknown =
    cryptoValue !== null && typeof cryptoValue === "object"
      ? Reflect.get(cryptoValue, "randomUUID")
      : null;
  if (typeof randomUuid !== "function") {
    throw persistenceError("STORAGE_ABORTED", "No random slot-id generator is available.");
  }
  const slotId: string = (randomUuid as () => string).call(cryptoValue);
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw persistenceError("STORAGE_ABORTED", "The generated slot id is not valid.");
  }
  return slotId;
}

function defaultScheduleExpiry(callback: () => void, delayMs: number): () => void {
  const handle = globalThis.setTimeout(callback, delayMs);
  const opaqueHandle: unknown = handle;
  if (opaqueHandle !== null && typeof opaqueHandle === "object" && "unref" in opaqueHandle) {
    const unref = opaqueHandle.unref;
    if (typeof unref === "function") Reflect.apply(unref, opaqueHandle, []);
  }
  return (): void => {
    globalThis.clearTimeout(handle);
  };
}

export interface ImportService {
  previewImport(request: PreviewImportRequest): Promise<PreviewImportResult>;
  confirmImport(token: string, options?: ConfirmImportOptions): Promise<ConfirmImportResult>;
}

export function createImportService(serviceOptions: ImportServiceOptions): ImportService {
  const repository = serviceOptions.repository;
  const locks = serviceOptions.locks;
  const adapters = serviceOptions.adapters;
  const nowMs = serviceOptions.nowMs ?? defaultNowMs;
  const generateSlotId = serviceOptions.generateSlotId ?? defaultGenerateSlotId;
  const isSlotActive = serviceOptions.isSlotActive ?? ((): boolean => false);
  const scheduleExpiry = serviceOptions.scheduleExpiry ?? defaultScheduleExpiry;
  let pending: ImportCandidate | null = null;
  let cancelPendingExpiry: (() => void) | null = null;
  let tokenSequence = 0;
  let previewGeneration = 0;

  function clearPending(): void {
    cancelPendingExpiry?.();
    cancelPendingExpiry = null;
    pending = null;
  }

  // Optional codec/signal plumbing that stays key-absent (never
  // undefined-valued) to satisfy exactOptionalPropertyTypes downstream.
  function codecOptions(signal?: AbortSignal): {
    adapters?: SaveCodecAdapters;
    signal?: AbortSignal;
  } {
    return {
      ...(adapters !== undefined ? { adapters } : {}),
      ...(signal !== undefined ? { signal } : {}),
    };
  }

  return {
    async previewImport(request: PreviewImportRequest): Promise<PreviewImportResult> {
      const invocationGeneration = ++previewGeneration;
      clearPending();
      if (request.signal?.aborted === true) {
        throw persistenceError("CANCELLED", "The import preview was cancelled.");
      }
      // Copy the caller's bytes; the service never retains the input buffer.
      const input = new Uint8Array(request.bytes);
      const content = serviceOptions.loadContent();
      const decoded = await inspectSaveEnvelopeForImport(input, codecOptions(request.signal));
      if (invocationGeneration !== previewGeneration) {
        throw persistenceError("CANCELLED", "The import preview was superseded.");
      }
      const unadmittedPayload = decoded.payload;
      const fingerprint = hashSimulationContent(content);
      const previewState = inspectGameStateForImportPreview(unadmittedPayload.gameState);

      // A preview may describe a checksum-certified file whose outer content
      // fingerprint is incompatible, but it must never read display fields
      // from an uninspected GameState. Full current-content admission is only
      // meaningful once the recorded content identity matches this runtime.
      let compatibility: SavePreview["compatibility"] = "compatible";
      if (
        unadmittedPayload.contentVersion !== content.contentVersion ||
        unadmittedPayload.simulationContentHash !== fingerprint ||
        previewState.contentVersion !== content.contentVersion
      ) {
        compatibility = "INCOMPATIBLE_CONTENT";
      } else {
        const admittedState = admitGameStateForSave({
          state: unadmittedPayload.gameState,
          content,
          nextQueueSequence: unadmittedPayload.execution.nextQueueSequence,
        });
        if (hashCanonicalState(admittedState) !== unadmittedPayload.execution.stateHash) {
          compatibility = "CHECKSUM_MISMATCH";
        }
      }

      const requested = request.destination ?? { kind: "new-slot" as const };
      const suggestion =
        requested.kind === "new-slot"
          ? { kind: "new-slot" as const }
          : { kind: "overwrite" as const, slotId: requested.slotId };
      const preview = parseSavePreview({
        sourceSchemaVersion: decoded.sourceSchemaVersion,
        sourceSaveVersion: unadmittedPayload.saveVersion,
        contentVersion: unadmittedPayload.contentVersion,
        simulatedYear: previewState.currentYear,
        tick: previewState.tick,
        cashUsd: previewState.cashUsd,
        verticalSliceCompleted: previewState.verticalSliceCompleted,
        savedAtIso: unadmittedPayload.savedAtIso,
        migrationRequired: decoded.migrated,
        compatibility,
        destinationSuggestion: suggestion,
        compressedBytes: input.length,
        uncompressedBytes: decoded.uncompressedBytes,
        slotId: unadmittedPayload.slotId,
      });

      if (compatibility !== "compatible") {
        // Informative only: nothing committable is retained.
        return { preview, token: null, allocatedSlotId: null };
      }

      const payload = admitSavePayloadForContent({ payload: unadmittedPayload, content });

      let plan: ImportPlan;
      if (requested.kind === "new-slot") {
        plan = { kind: "new-slot", slotId: generateSlotId() };
      } else {
        if (!SLOT_ID_PATTERN.test(requested.slotId)) {
          throw persistenceError("INVALID_FORMAT", "Import overwrite target is not valid.");
        }
        const target = await repository.readSlotMeta(requested.slotId, request.signal);
        plan = {
          kind: "overwrite",
          slotId: requested.slotId,
          expectedRevision: target.revision,
          expectedWriterEpoch: target.writerEpoch,
        };
      }

      // Bind digests with the injected adapters when present so tests and
      // production hash through the same configured primitives.
      const hashBytes = adapters?.sha256 ?? sha256Hex;
      const sourceDigest = await hashBytes(input, request.signal);
      // Digest the migrated canonical form (not the source bytes) so
      // confirmation can re-prove the owned candidate is unchanged.
      const migratedCanonical = new TextEncoder().encode(canonicalSerialize(decoded.payload));
      const candidateDigest = await hashBytes(migratedCanonical, request.signal);
      if (invocationGeneration !== previewGeneration) {
        throw persistenceError("CANCELLED", "The import preview was superseded.");
      }
      tokenSequence += 1;
      const token = `import-${tokenSequence}-${sourceDigest.slice(0, 16)}`;
      // One candidate only: a new preview invalidates the previous token,
      // so a stale confirmation can never substitute candidate bytes.
      pending = {
        token,
        payload: structuredClone(payload),
        previewBase: preview,
        sourceDigest,
        candidateDigest,
        contentFingerprint: fingerprint,
        plan,
        createdAtMs: nowMs(),
      };
      const scheduledToken = token;
      cancelPendingExpiry = scheduleExpiry(() => {
        if (pending?.token === scheduledToken) {
          pending = null;
          cancelPendingExpiry = null;
        }
      }, IMPORT_CANDIDATE_TTL_MS);
      return { preview, token, allocatedSlotId: plan.kind === "new-slot" ? plan.slotId : null };
    },

    async confirmImport(
      token: string,
      options: ConfirmImportOptions = {},
    ): Promise<ConfirmImportResult> {
      const candidate = pending !== null && pending.token === token ? pending : null;
      if (candidate === null) {
        throw persistenceError(
          "TOKEN_CONSUMED",
          "The import token is unknown, replaced, or already consumed.",
        );
      }
      if (nowMs() - candidate.createdAtMs > IMPORT_CANDIDATE_TTL_MS) {
        clearPending();
        throw persistenceError("TOKEN_EXPIRED", "The import candidate expired.");
      }
      if (options.signal?.aborted === true) {
        throw persistenceError("CANCELLED", "The import confirmation was cancelled.");
      }
      // Re-prove the owned candidate is byte-identical to the previewed one;
      // a substituted candidate fails the bound digest instead of committing.
      const hashBytes = adapters?.sha256 ?? sha256Hex;
      const freshDigest = await hashBytes(
        new TextEncoder().encode(canonicalSerialize(candidate.payload)),
        options.signal,
      );
      if (freshDigest !== candidate.candidateDigest) {
        throw persistenceError(
          "TOKEN_CONSUMED",
          "The import candidate changed after preview; preview again.",
        );
      }
      if (candidate.plan.kind === "new-slot") {
        if (options.expectedRevision !== undefined) {
          throw persistenceError("INVALID_FORMAT", "New slots take no expected revision.");
        }
      } else if (options.expectedRevision !== candidate.plan.expectedRevision) {
        throw persistenceError(
          "STALE_REVISION",
          "The confirmation revision does not match the preview binding.",
        );
      }
      const content = serviceOptions.loadContent();
      if (hashSimulationContent(content) !== candidate.contentFingerprint) {
        throw persistenceError(
          "INCOMPATIBLE_CONTENT",
          "Content changed since the import preview; preview again.",
        );
      }
      const slotId = candidate.plan.slotId;
      if (isSlotActive(slotId)) {
        throw persistenceError(
          "SLOT_ACTIVE",
          "The destination slot runs live; close it or choose a new slot.",
        );
      }

      const lock = await locks.acquire(slotId, {
        ifAvailable: true,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (isSlotBusy(lock)) {
        throw persistenceError("SLOT_BUSY", "The destination slot is owned by another tab.");
      }
      try {
        if (candidate.plan.kind === "overwrite") {
          const current = await repository.readSlotMeta(slotId, options.signal);
          if (
            current.revision !== candidate.plan.expectedRevision ||
            current.writerEpoch !== candidate.plan.expectedWriterEpoch
          ) {
            throw persistenceError(
              current.writerEpoch !== candidate.plan.expectedWriterEpoch
                ? "STALE_WRITER"
                : "STALE_REVISION",
              "The destination changed after import preview.",
            );
          }
        }

        // Rebind the owned candidate to the destination with a fresh checksum;
        // source bytes stay untouched and the candidate itself is unmodified.
        const rebound = { ...candidate.payload, slotId };
        const encoded = await encodeSaveEnvelope(rebound, {
          content,
          compression: "none",
          ...codecOptions(options.signal),
        });
        const preview = parseSavePreview({
          ...candidate.previewBase,
          slotId,
          destinationSuggestion:
            candidate.plan.kind === "new-slot"
              ? { kind: "new-slot" as const }
              : { kind: "overwrite" as const, slotId },
        });
        const applySettings = options.applySettings === true;
        const result = await repository.commitImport({
          destination:
            candidate.plan.kind === "new-slot"
              ? { kind: "new-slot", slotId, writerEpoch: 0 }
              : {
                  kind: "overwrite",
                  slotId,
                  expectedRevision: candidate.plan.expectedRevision,
                  expectedWriterEpoch: candidate.plan.expectedWriterEpoch,
                },
          prepared: { envelope: encoded.envelope, preview },
          applySettings,
          settingsValue: applySettings ? rebound.settings : null,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        });
        // Consumed exactly once, only after the durable commit.
        clearPending();
        return {
          slotId,
          meta: result.meta,
          appliedSettings: applySettings,
          settingsRevision: result.settings?.revision ?? null,
        };
      } finally {
        await lock.release();
      }
    },
  };
}
