import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  LocalStats,
  PlayerSettings,
  SaveEnvelope,
  SavePayloadV1,
  SavePreview,
} from "../../save/contracts.ts";
import {
  createDefaultSaveCodecAdapters,
  encodeEnvelopeBytes,
  encodeSaveEnvelope,
  decodeSaveEnvelope,
  type SaveCodecAdapters,
} from "../../save/codec.ts";
import { PersistenceError, persistenceError } from "../../save/persistenceErrors.ts";
import type { PersistenceErrorCode } from "../../save/persistenceErrors.ts";
import { openOverclockDatabase } from "../../save/repository/indexedDb.ts";
import {
  createSaveRepositoryCore,
  type SaveRepositoryCore,
} from "../../save/repository/repository.ts";
import { openWriterSession, isSlotBusy, type WriterSession } from "../../save/repository/slots.ts";
import {
  createOperationToken,
  type PreparedManualSave,
  type RepositoryOperationToken,
} from "../../save/repository/types.ts";
import { createWebLockAdapter, type WebLockAdapter } from "../../save/repository/webLocks.ts";
import {
  DEFAULT_PLAYER_SETTINGS,
  parseLocalStats,
  parsePlayerSettings,
} from "../../save/schema.ts";
import { hashCanonicalState } from "../../sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";
import { admitLoadedSave } from "../../save/load/loadAdmission.ts";
import { createImportService } from "../../save/import/importService.ts";
import { deleteInactiveSlot } from "../../save/repository/slots.ts";
import type { LocalReport } from "../../save/schema.ts";
import type {
  WorkerSaveCapture,
  WorkerSaveMetadata,
  WorkerSavePersistence,
  WorkerSaveReason,
  WorkerSaveSessionInfo,
  WorkerLoadCandidate,
  WorkerImportConfirmation,
  WorkerImportPreview,
  WorkerSlotSummary,
} from "./savePersistenceTypes.ts";

const REJECTED_SAVE_CANDIDATE_CODES = new Set<PersistenceErrorCode>([
  "INVALID_FORMAT",
  "LIMIT_EXCEEDED",
  "CHECKSUM_MISMATCH",
  "UNSUPPORTED_VERSION",
  "UNSUPPORTED_COMPRESSION",
  "INCOMPATIBLE_CONTENT",
  "INVALID_STATE",
  "MIGRATION_FAILED",
]);

function isRejectedSaveCandidate(
  error: unknown,
): error is Error & { readonly code: PersistenceErrorCode } {
  if (error instanceof PersistenceError) return REJECTED_SAVE_CANDIDATE_CODES.has(error.code);
  if (error === null || typeof error !== "object" || !("code" in error)) return false;
  const code: unknown = error.code;
  return (
    typeof code === "string" && REJECTED_SAVE_CANDIDATE_CODES.has(code as PersistenceErrorCode)
  );
}

export interface WorkerSavePersistenceOptions {
  readonly content: ContentBundle;
  readonly repository: SaveRepositoryCore;
  readonly locks: WebLockAdapter;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly codecAdapters?: SaveCodecAdapters;
}

const EMPTY_LOCAL_STATS: LocalStats = Object.freeze({
  realPlayTimeSeconds: 0,
  taskCompletions: 0,
  taskAbandons: 0,
  emergencyShutdowns: 0,
  benchmarkAttempts: 0,
  designApplications: 0,
});

function defaultCreateId(): string {
  const cryptoValue: unknown = Reflect.get(globalThis, "crypto");
  if (
    cryptoValue === null ||
    typeof cryptoValue !== "object" ||
    typeof Reflect.get(cryptoValue, "randomUUID") !== "function"
  ) {
    throw persistenceError("STORAGE_ABORTED", "Secure random slot identifiers are unavailable.");
  }
  return (Reflect.get(cryptoValue, "randomUUID") as () => string).call(cryptoValue);
}

function buildPreview(payload: SavePayloadV1, canonicalBytes: number): SavePreview {
  return {
    sourceSchemaVersion: payload.schemaVersion,
    sourceSaveVersion: payload.saveVersion,
    contentVersion: payload.contentVersion,
    simulatedYear: payload.gameState.campaign.currentYear,
    tick: payload.gameState.tick,
    cashUsd: payload.gameState.economy.cashUsd,
    verticalSliceCompleted: payload.gameState.campaign.verticalSliceCompleted,
    savedAtIso: payload.savedAtIso,
    migrationRequired: false,
    compatibility: "compatible",
    destinationSuggestion: { kind: "overwrite", slotId: payload.slotId },
    compressedBytes: canonicalBytes,
    uncompressedBytes: canonicalBytes,
    slotId: payload.slotId,
  };
}

export function createWorkerSavePersistence(
  options: WorkerSavePersistenceOptions,
): WorkerSavePersistence {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? defaultCreateId;
  const fingerprint = hashSimulationContent(options.content);
  const imports = createImportService({
    repository: options.repository,
    locks: options.locks,
    loadContent: () => options.content,
    isSlotActive: (slotId) => writer?.slotId === slotId && !writer.closed,
  });
  let writer: WriterSession | null = null;
  let activeSlotId: string | null = null;
  let createdAtIso: string | null = null;
  let settings: PlayerSettings = structuredClone(DEFAULT_PLAYER_SETTINGS);
  let settingsRevision: number | null = null;
  let closed = false;
  const activeOperations = new Set<() => void>();

  function assertSessionActive(token?: RepositoryOperationToken): void {
    if (closed || token?.cancelled === true) {
      throw persistenceError("CANCELLED", "The persistence session was closed before committing.");
    }
  }

  async function startNewRun(): Promise<WorkerSaveSessionInfo> {
    if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
    if (createdAtIso !== null) {
      throw persistenceError("SLOT_ACTIVE", "A Worker save slot is already active.");
    }
    const created = now().toISOString();
    const slotId = `slot-${createId().toLowerCase()}`;
    const storedSettings = await options.repository.readSettings();
    assertSessionActive();
    settingsRevision = storedSettings?.revision ?? null;
    settings = parsePlayerSettings(storedSettings?.settings ?? DEFAULT_PLAYER_SETTINGS);
    activeSlotId = slotId;
    createdAtIso = created;
    return {
      slotId,
      createdAtIso: created,
      settings: structuredClone(settings),
      localStats: structuredClone(EMPTY_LOCAL_STATS),
    };
  }

  async function prepareLoad(slotId: string): Promise<WorkerLoadCandidate> {
    if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
    const reusesWriter = writer?.slotId === slotId && !writer.closed;
    let destinationWriter: WriterSession | null = reusesWriter ? writer : null;
    if (!reusesWriter) {
      const opened = await openWriterSession(options.repository, options.locks, slotId, {
        ifAvailable: true,
      });
      if (isSlotBusy(opened)) {
        throw persistenceError("SLOT_BUSY", "The destination slot is active in another tab.");
      }
      destinationWriter = opened;
    }

    let loaded: Awaited<ReturnType<typeof admitLoadedSave>> | null = null;
    let skippedCorruptRecords = 0;
    try {
      const meta = await options.repository.readSlotMeta(slotId);
      const sequences = await options.repository.listAutosaveSequences(slotId);
      let manualCaptureSequence: number | null = null;
      let manualCorrupt = false;
      try {
        manualCaptureSequence =
          (await options.repository.readManualSaveOrNull(slotId))?.captureSequence ?? null;
      } catch (error) {
        if (!isRejectedSaveCandidate(error)) throw error;
        manualCorrupt = true;
      }
      const candidates: {
        readonly kind: "manual" | "autosave";
        readonly captureSequence: number;
      }[] = sequences.map((captureSequence) => ({ kind: "autosave", captureSequence }));
      if (manualCaptureSequence !== null || manualCorrupt) {
        const corruptManualSequence =
          meta.latestRecovery?.kind === "manual" ? meta.latestRecovery.captureSequence : -1;
        candidates.push({
          kind: "manual",
          captureSequence: manualCaptureSequence ?? corruptManualSequence,
        });
      }
      candidates.sort((left, right) => right.captureSequence - left.captureSequence);
      for (const candidate of candidates) {
        try {
          loaded = await admitLoadedSave(options.repository, slotId, {
            content: options.content,
            ...(candidate.kind === "autosave"
              ? { captureSequence: candidate.captureSequence }
              : {}),
            ...(options.codecAdapters !== undefined ? { adapters: options.codecAdapters } : {}),
          });
          break;
        } catch (error) {
          if (!isRejectedSaveCandidate(error)) throw error;
          skippedCorruptRecords += 1;
        }
      }
      if (loaded === null) {
        throw persistenceError("INVALID_STATE", "No verified recovery generation is available.");
      }
      const candidate = loaded;
      const targetWriter = destinationWriter;
      if (targetWriter === null) throw new Error("Destination writer was not acquired.");
      const savedAtIso = candidate.payload.savedAtIso;
      const localStats = parseLocalStats(candidate.payload.localStats);
      let settled = false;
      return {
        state: structuredClone(candidate.gameState),
        nextQueueSequence: candidate.nextQueueSequence,
        createdAtIso: candidate.payload.createdAtIso,
        localStats,
        checkpoint: {
          slotId,
          savedAtIso,
          tick: candidate.gameState.tick,
          year: candidate.gameState.campaign.currentYear,
          captureSequence: candidate.captureSequence,
          sourceKind: candidate.sourceKind,
          skippedCorruptRecords,
        },
        async promote(): Promise<WorkerSaveSessionInfo> {
          if (settled)
            throw persistenceError("CANCELLED", "The load candidate is no longer active.");
          if (closed || targetWriter.closed) {
            throw persistenceError(
              "STALE_WRITER",
              "The destination writer was closed before promotion.",
            );
          }
          let nextSettings = settings;
          let nextSettingsRevision = settingsRevision;
          if (nextSettingsRevision === null) {
            const storedSettings = await options.repository.readSettings();
            nextSettingsRevision = storedSettings?.revision ?? null;
            nextSettings = parsePlayerSettings(storedSettings?.settings ?? DEFAULT_PLAYER_SETTINGS);
          }
          settled = true;
          const previousWriter = reusesWriter ? null : writer;
          writer = targetWriter;
          activeSlotId = targetWriter.slotId;
          createdAtIso = candidate.payload.createdAtIso;
          settingsRevision = nextSettingsRevision;
          settings = structuredClone(nextSettings);
          if (previousWriter !== null && previousWriter !== targetWriter) {
            try {
              await previousWriter.close();
            } catch {
              // The new writer is already authoritative; release is best effort.
            }
          }
          return {
            slotId: targetWriter.slotId,
            createdAtIso: candidate.payload.createdAtIso,
            settings: structuredClone(settings),
            localStats: structuredClone(localStats),
          };
        },
        async rollback(): Promise<void> {
          if (settled) return;
          settled = true;
          if (!reusesWriter) await targetWriter.close();
        },
      };
    } catch (error) {
      if (!reusesWriter && destinationWriter !== null) {
        try {
          await destinationWriter.close();
        } catch {
          // Preserve the original candidate failure.
        }
      }
      throw error;
    }
  }

  async function save(
    capture: WorkerSaveCapture,
    reason: WorkerSaveReason,
  ): Promise<WorkerSaveMetadata> {
    if (closed || activeSlotId === null || createdAtIso === null) {
      throw persistenceError("STORAGE_ABORTED", "There is no active save slot.");
    }
    if (capture.createdAtIso !== createdAtIso) {
      throw persistenceError("STALE_WRITER", "Save capture belongs to a different active run.");
    }
    const slotId = activeSlotId;
    const operation = createOperationToken();
    activeOperations.add(operation.cancel);
    try {
      const savedAtIso = now().toISOString();
      const payload: SavePayloadV1 = {
        schemaVersion: 1,
        saveVersion: 1,
        contentVersion: options.content.contentVersion,
        simulationContentHash: fingerprint,
        createdAtIso,
        savedAtIso,
        slotId,
        gameState: capture.state,
        execution: {
          simulatorProtocolVersion: 1,
          nextQueueSequence: capture.nextQueueSequence,
          pendingCommandCount: 0,
          stateHash: hashCanonicalState(capture.state),
        },
        settings: parsePlayerSettings(capture.settings),
        localStats: parseLocalStats(capture.localStats),
      };
      const encoded = await encodeSaveEnvelope(payload, {
        content: options.content,
        compression: "none",
        ...(options.codecAdapters !== undefined ? { adapters: options.codecAdapters } : {}),
      });
      if (operation.token.cancelled) {
        throw persistenceError(
          "CANCELLED",
          "The save was cancelled before its transaction opened.",
        );
      }
      const preview = buildPreview(payload, encoded.canonicalPayloadBytes.length);
      const prepared: PreparedManualSave = { envelope: encoded.envelope, preview };
      let activeWriter = writer;
      if (activeWriter === null) {
        const opened = await openWriterSession(options.repository, options.locks, slotId, {
          ifAvailable: true,
          createIfMissing: true,
        });
        if (isSlotBusy(opened)) {
          throw persistenceError("SLOT_BUSY", "The new save slot is active in another tab.");
        }
        try {
          assertSessionActive(operation.token);
        } catch (error) {
          await opened.close();
          throw error;
        }
        writer = opened;
        activeWriter = opened;
      }
      if (reason === "manual") await activeWriter.writeManual(prepared, { token: operation.token });
      else await activeWriter.writeAutosave(prepared, { token: operation.token });
      return {
        slotId: activeWriter.slotId,
        savedAtIso,
        tick: capture.state.tick,
        sizeBytes: encodeEnvelopeBytes(encoded.envelope).byteLength,
      };
    } finally {
      activeOperations.delete(operation.cancel);
    }
  }

  async function updateSettings(value: PlayerSettings): Promise<PlayerSettings> {
    if (closed || activeSlotId === null) {
      throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
    }
    const parsed = parsePlayerSettings(value);
    const updated = await options.repository.writeSettings(parsed, {
      expectedRevision: settingsRevision,
    });
    settingsRevision = updated.revision;
    settings = structuredClone(parsed);
    return structuredClone(settings);
  }

  async function listSlots(): Promise<readonly WorkerSlotSummary[]> {
    const listings = await options.repository.listSlots();
    const result: WorkerSlotSummary[] = [];
    for (const listing of listings) {
      let selected =
        listing.manual === null
          ? null
          : {
              captureSequence: listing.manual.captureSequence,
              preview: listing.manual.preview,
              envelope: listing.manual.envelope,
            };
      const sequences = await options.repository.listAutosaveSequences(listing.slotId);
      for (const captureSequence of sequences) {
        if (selected !== null && captureSequence <= selected.captureSequence) break;
        try {
          const autosave = await options.repository.readAutosave(listing.slotId, captureSequence);
          selected = {
            captureSequence: autosave.captureSequence,
            preview: autosave.preview,
            envelope: autosave.envelope,
          };
          break;
        } catch (error) {
          if (!isRejectedSaveCandidate(error)) throw error;
          // A damaged rotation remains stored while the list tries an older one.
        }
      }
      if (selected === null) continue;
      result.push({
        slotId: listing.slotId,
        revision: listing.meta.revision,
        tick: selected.preview.tick,
        savedAtIso: selected.preview.savedAtIso,
        sizeBytes: encodeEnvelopeBytes(selected.envelope).byteLength,
        verification: "unchecked",
      });
    }
    return result;
  }

  async function previewImport(
    bytes: Uint8Array,
    destination?:
      { readonly kind: "new-slot" } | { readonly kind: "overwrite"; readonly slotId: string },
  ): Promise<WorkerImportPreview> {
    return imports.previewImport({
      bytes: new Uint8Array(bytes),
      ...(destination !== undefined ? { destination } : {}),
    });
  }

  async function confirmImport(
    token: string,
    values: { readonly expectedRevision: number | undefined; readonly applySettings: boolean },
  ): Promise<WorkerImportConfirmation> {
    const confirmed = await imports.confirmImport(token, {
      ...(values.expectedRevision !== undefined
        ? { expectedRevision: values.expectedRevision }
        : {}),
      applySettings: values.applySettings,
    });
    if (confirmed.appliedSettings) {
      settingsRevision = confirmed.settingsRevision;
      settings = structuredClone(confirmed.settingsValue);
    }
    return {
      slotId: confirmed.slotId,
      revision: confirmed.meta.revision,
      tick: confirmed.preview.tick,
      savedAtIso: confirmed.preview.savedAtIso,
      sizeBytes: confirmed.sizeBytes,
      appliedSettings: confirmed.appliedSettings,
      settings: confirmed.appliedSettings ? structuredClone(settings) : null,
    };
  }

  async function exportSlot(slotId: string, expectedRevision: number): Promise<Uint8Array> {
    const candidates: { readonly captureSequence: number; readonly envelope: SaveEnvelope }[] = [];
    let lastFailure: unknown = null;
    try {
      const { save } = await options.repository.readManualSaveAtRevision(slotId, expectedRevision);
      candidates.push({ captureSequence: save.captureSequence, envelope: save.envelope });
    } catch (error) {
      if (!isRejectedSaveCandidate(error)) throw error;
      lastFailure = error;
    }
    const sequences = await options.repository.listAutosaveSequences(slotId);
    for (const captureSequence of sequences) {
      try {
        const { autosave } = await options.repository.readAutosaveAtRevision(
          slotId,
          captureSequence,
          expectedRevision,
        );
        candidates.push({ captureSequence, envelope: autosave.envelope });
      } catch (error) {
        if (!isRejectedSaveCandidate(error)) throw error;
        lastFailure = error;
      }
    }
    candidates.sort((left, right) => right.captureSequence - left.captureSequence);
    for (const candidate of candidates) {
      const bytes = encodeEnvelopeBytes(candidate.envelope);
      try {
        await decodeSaveEnvelope(bytes, {
          content: options.content,
          ...(options.codecAdapters !== undefined ? { adapters: options.codecAdapters } : {}),
        });
        return new Uint8Array(bytes);
      } catch (error) {
        if (!isRejectedSaveCandidate(error)) throw error;
        lastFailure = error;
      }
    }
    if (lastFailure instanceof Error) throw lastFailure;
    throw persistenceError("INVALID_STATE", "The slot has no verified committed save generation.");
  }

  async function deleteSlot(slotId: string, expectedRevision: number): Promise<void> {
    await deleteInactiveSlot(options.repository, options.locks, slotId, {
      expectedRevision,
      isSlotActive: (targetSlotId) => writer?.slotId === targetSlotId && !writer.closed,
    });
  }

  async function createReport(report: LocalReport): Promise<void> {
    await options.repository.writeReport(report);
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    for (const cancel of activeOperations) cancel();
    activeOperations.clear();
    const activeWriter = writer;
    writer = null;
    activeSlotId = null;
    createdAtIso = null;
    if (activeWriter !== null) await activeWriter.close();
  }

  return {
    startNewRun,
    save,
    updateSettings,
    prepareLoad,
    listSlots,
    previewImport,
    confirmImport,
    exportSlot,
    deleteSlot,
    createReport,
    listReports: () => options.repository.listReports(),
    readReport: (reportId) => options.repository.readReport(reportId),
    deleteReport: (reportId) => options.repository.deleteReport(reportId),
    close,
  };
}

export function createBrowserWorkerSavePersistence(content: ContentBundle): WorkerSavePersistence {
  let closed = false;
  let resolved: WorkerSavePersistence | null = null;
  const persistencePromise = openOverclockDatabase()
    .then((storage) =>
      createWorkerSavePersistence({
        content,
        repository: createSaveRepositoryCore(storage),
        locks: createWebLockAdapter(),
        codecAdapters: createDefaultSaveCodecAdapters(),
      }),
    )
    .then((persistence) => {
      resolved = persistence;
      if (closed) void persistence.close();
      return persistence;
    });
  return {
    async startNewRun(): Promise<WorkerSaveSessionInfo> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      return (await persistencePromise).startNewRun();
    },
    async save(capture: WorkerSaveCapture, reason: WorkerSaveReason): Promise<WorkerSaveMetadata> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      return (await persistencePromise).save(capture, reason);
    },
    async updateSettings(settings: PlayerSettings): Promise<PlayerSettings> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      return (await persistencePromise).updateSettings(settings);
    },
    async prepareLoad(slotId: string): Promise<WorkerLoadCandidate> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.prepareLoad === undefined) {
        throw persistenceError("STORAGE_ABORTED", "Load support is unavailable.");
      }
      return persistence.prepareLoad(slotId);
    },
    async listSlots(): Promise<readonly WorkerSlotSummary[]> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.listSlots === undefined)
        throw persistenceError("STORAGE_ABORTED", "Slot listing is unavailable.");
      return persistence.listSlots();
    },
    async previewImport(bytes, destination): Promise<WorkerImportPreview> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.previewImport === undefined)
        throw persistenceError("STORAGE_ABORTED", "Import is unavailable.");
      return persistence.previewImport(bytes, destination);
    },
    async confirmImport(token, values): Promise<WorkerImportConfirmation> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.confirmImport === undefined)
        throw persistenceError("STORAGE_ABORTED", "Import is unavailable.");
      return persistence.confirmImport(token, values);
    },
    async exportSlot(slotId, expectedRevision): Promise<Uint8Array> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.exportSlot === undefined)
        throw persistenceError("STORAGE_ABORTED", "Export is unavailable.");
      return persistence.exportSlot(slotId, expectedRevision);
    },
    async deleteSlot(slotId, expectedRevision): Promise<void> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.deleteSlot === undefined)
        throw persistenceError("STORAGE_ABORTED", "Delete is unavailable.");
      await persistence.deleteSlot(slotId, expectedRevision);
    },
    async createReport(report): Promise<void> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.createReport === undefined)
        throw persistenceError("STORAGE_ABORTED", "Reports are unavailable.");
      await persistence.createReport(report);
    },
    async listReports() {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.listReports === undefined)
        throw persistenceError("STORAGE_ABORTED", "Reports are unavailable.");
      return persistence.listReports();
    },
    async readReport(reportId) {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.readReport === undefined)
        throw persistenceError("STORAGE_ABORTED", "Reports are unavailable.");
      return persistence.readReport(reportId);
    },
    async deleteReport(reportId): Promise<void> {
      if (closed) throw persistenceError("STORAGE_ABORTED", "The persistence session is closed.");
      const persistence = await persistencePromise;
      if (persistence.deleteReport === undefined)
        throw persistenceError("STORAGE_ABORTED", "Reports are unavailable.");
      await persistence.deleteReport(reportId);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (resolved !== null) await resolved.close();
      else
        await persistencePromise.then(
          (persistence) => persistence.close(),
          () => undefined,
        );
    },
  };
}
