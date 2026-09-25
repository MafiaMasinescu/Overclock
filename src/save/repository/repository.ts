import type { PlayerSettings, SavePreview } from "../contracts.ts";
import { PersistenceError, persistenceError } from "../persistenceErrors.ts";
import {
  MAX_AUTOSAVE_ROTATIONS,
  MAX_INPUT_FILE_BYTES,
  MAX_ORDINARY_SLOT_COUNT,
  MAX_REPORT_BYTES,
  MAX_REPORT_COUNT,
  SLOT_ID_PATTERN,
} from "../persistenceLimits.ts";
import { assertSafeExternalData } from "../inputSafety.ts";
import {
  parseLocalReport,
  parsePlayerSettings,
  parseSaveEnvelope,
  parseSavePreview,
} from "../schema.ts";
import type { LocalReport } from "../schema.ts";
import { autosaveKey, mapStorageError, parseAutosaveKey, throwIfCancelled } from "./storage.ts";
import type { RepositoryStorage, RepositoryTransaction } from "./storage.ts";
import type {
  DeleteSlotOptions,
  ImportCommitRequest,
  ImportCommitResult,
  PreparedManualSave,
  RecoveryLocator,
  SettingsRecord,
  SlotListing,
  SlotMetaRecord,
  StoredAutosave,
  StoredManualSave,
  WriteAutosaveOptions,
  WriteAutosaveResult,
  WriteManualSaveOptions,
  WriteSettingsOptions,
} from "./types.ts";
import { SETTINGS_RECORD_KEY } from "./types.ts";

// Phase 2 Task 17.1/17.2: atomic repository core. Contract §10 (§11 for
// rotation) is normative. Every mutation runs in exactly one readwrite
// transaction that updates the slot record and its metadata atomically,
// checks expected revision plus writerEpoch fencing, and resolves only on
// transaction completion. All cryptographic/Hash/compression work (canonical
// encode, SHA-256, gzip) happens in the caller before this boundary opens a
// transaction; the core performs only cheap synchronous schema validation
// inside. Web Lock acquisition lives in webLocks.ts, import/export services
// belong to Task 17.3 and must not be smuggled in here.

export interface SaveRepositoryCore {
  createSlot(slotId: string, writerEpoch: number, signal?: AbortSignal): Promise<SlotMetaRecord>;
  listSlots(signal?: AbortSignal): Promise<readonly SlotListing[]>;
  readManualSaveOrNull(slotId: string, signal?: AbortSignal): Promise<StoredManualSave | null>;
  readManualSave(slotId: string, signal?: AbortSignal): Promise<StoredManualSave>;
  readManualSaveAtRevision(
    slotId: string,
    expectedRevision: number | undefined,
    signal?: AbortSignal,
  ): Promise<{ readonly meta: SlotMetaRecord; readonly save: StoredManualSave }>;
  readSlotMeta(slotId: string, signal?: AbortSignal): Promise<SlotMetaRecord>;
  writeManualSave(
    slotId: string,
    prepared: PreparedManualSave,
    options: WriteManualSaveOptions,
  ): Promise<SlotMetaRecord>;
  writeAutosave(
    slotId: string,
    prepared: PreparedManualSave,
    options: WriteAutosaveOptions,
  ): Promise<WriteAutosaveResult>;
  listAutosaves(slotId: string, signal?: AbortSignal): Promise<readonly StoredAutosave[]>;
  // Returns key-derived sequence candidates without parsing their values so
  // recovery can skip one corrupt generation and continue to older records.
  listAutosaveSequences(slotId: string, signal?: AbortSignal): Promise<readonly number[]>;
  readAutosave(
    slotId: string,
    captureSequence: number,
    signal?: AbortSignal,
  ): Promise<StoredAutosave>;
  readAutosaveAtRevision(
    slotId: string,
    captureSequence: number,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{ readonly meta: SlotMetaRecord; readonly autosave: StoredAutosave }>;
  getLatestRecovery(slotId: string, signal?: AbortSignal): Promise<RecoveryLocator | null>;
  deleteSlot(slotId: string, options: DeleteSlotOptions): Promise<void>;
  commitImport(request: ImportCommitRequest): Promise<ImportCommitResult>;
  readSettings(signal?: AbortSignal): Promise<SettingsRecord | null>;
  writeSettings(settings: PlayerSettings, options: WriteSettingsOptions): Promise<SettingsRecord>;
  rotateWriterEpoch(
    slotId: string,
    expectedWriterEpoch: number,
    signal?: AbortSignal,
  ): Promise<SlotMetaRecord>;
  writeReport(report: LocalReport): Promise<void>;
  listReports(): Promise<readonly LocalReport[]>;
  readReport(reportId: string): Promise<LocalReport>;
  deleteReport(reportId: string): Promise<void>;
}

function assertSlotId(slotId: string): void {
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw persistenceError("INVALID_FORMAT", `Slot id "${slotId}" is not valid.`);
  }
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw persistenceError("INVALID_FORMAT", `${name} must be a nonnegative safe integer.`);
  }
}

function cloneMeta(meta: SlotMetaRecord): SlotMetaRecord {
  return {
    slotId: meta.slotId,
    revision: meta.revision,
    nextCaptureSequence: meta.nextCaptureSequence,
    writerEpoch: meta.writerEpoch,
    latestRecovery:
      meta.latestRecovery === null
        ? null
        : { kind: meta.latestRecovery.kind, captureSequence: meta.latestRecovery.captureSequence },
  };
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw persistenceError("INVALID_STATE", "Stored repository record has unexpected fields.");
  }
}

function parseSlotMetaRecord(value: unknown, expectedSlotId?: string): SlotMetaRecord {
  assertSafeExternalData(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError("INVALID_STATE", "Stored slot metadata has an invalid shape.");
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, [
    "slotId",
    "revision",
    "nextCaptureSequence",
    "writerEpoch",
    "latestRecovery",
  ]);
  const slotId = record["slotId"];
  if (
    typeof slotId !== "string" ||
    !SLOT_ID_PATTERN.test(slotId) ||
    (expectedSlotId !== undefined && slotId !== expectedSlotId)
  ) {
    throw persistenceError("INVALID_STATE", "Stored slot metadata key does not match its slot id.");
  }
  const revision = record["revision"];
  const nextCaptureSequence = record["nextCaptureSequence"];
  const writerEpoch = record["writerEpoch"];
  if (typeof revision !== "number") throw persistenceError("INVALID_STATE", "Invalid revision.");
  if (typeof nextCaptureSequence !== "number")
    throw persistenceError("INVALID_STATE", "Invalid capture sequence.");
  if (typeof writerEpoch !== "number")
    throw persistenceError("INVALID_STATE", "Invalid writer epoch.");
  try {
    assertSafeInteger(revision, "stored revision");
    assertSafeInteger(nextCaptureSequence, "stored nextCaptureSequence");
    assertSafeInteger(writerEpoch, "stored writerEpoch");
  } catch {
    throw persistenceError("INVALID_STATE", "Stored slot counters are invalid.");
  }
  const locator = record["latestRecovery"];
  let latestRecovery: RecoveryLocator | null = null;
  if (locator !== null) {
    if (typeof locator !== "object" || Array.isArray(locator)) {
      throw persistenceError("INVALID_STATE", "Stored recovery locator is invalid.");
    }
    const fields = locator as Record<string, unknown>;
    assertExactKeys(fields, ["kind", "captureSequence"]);
    const kind = fields["kind"];
    const captureSequence = fields["captureSequence"];
    if (
      (kind !== "manual" && kind !== "autosave") ||
      typeof captureSequence !== "number" ||
      !Number.isSafeInteger(captureSequence) ||
      captureSequence < 0 ||
      Object.is(captureSequence, -0) ||
      captureSequence >= nextCaptureSequence
    ) {
      throw persistenceError("INVALID_STATE", "Stored recovery locator is invalid.");
    }
    latestRecovery = { kind, captureSequence };
  }
  return { slotId, revision, nextCaptureSequence, writerEpoch, latestRecovery };
}

function parseStoredManualSave(value: unknown, expectedSlotId: string): StoredManualSave {
  assertSafeExternalData(value, { maxDepth: 8, maxStringUnits: MAX_INPUT_FILE_BYTES });
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError("INVALID_STATE", `Slot "${expectedSlotId}" has no manual save.`);
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, ["slotId", "captureSequence", "revision", "envelope", "preview"]);
  if (record["slotId"] !== expectedSlotId) {
    throw persistenceError("INVALID_STATE", "Stored manual save key does not match its slot id.");
  }
  const captureSequence = record["captureSequence"];
  const revision = record["revision"];
  if (typeof captureSequence !== "number" || typeof revision !== "number") {
    throw persistenceError("INVALID_STATE", "Stored manual save counters are invalid.");
  }
  try {
    assertSafeInteger(captureSequence, "stored captureSequence");
    assertSafeInteger(revision, "stored revision");
  } catch {
    throw persistenceError("INVALID_STATE", "Stored manual save counters are invalid.");
  }
  const envelope = parseSaveEnvelope(record["envelope"]);
  const preview = parseSavePreview(record["preview"]);
  if (preview.slotId !== expectedSlotId) {
    throw persistenceError("INVALID_STATE", "Stored manual preview targets another slot.");
  }
  return { slotId: expectedSlotId, captureSequence, revision, envelope, preview };
}

function parseStoredAutosave(value: unknown, expectedSlotId: string): StoredAutosave {
  assertSafeExternalData(value, { maxDepth: 8, maxStringUnits: MAX_INPUT_FILE_BYTES });
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError(
      "INVALID_STATE",
      `Slot "${expectedSlotId}" has no such autosave generation.`,
    );
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, ["slotId", "captureSequence", "envelope", "preview"]);
  const captureSequence = record["captureSequence"];
  if (
    record["slotId"] !== expectedSlotId ||
    typeof captureSequence !== "number" ||
    !Number.isSafeInteger(captureSequence) ||
    captureSequence < 0 ||
    Object.is(captureSequence, -0)
  ) {
    throw persistenceError("INVALID_STATE", "Stored autosave identity is invalid.");
  }
  const envelope = parseSaveEnvelope(record["envelope"]);
  const preview = parseSavePreview(record["preview"]);
  if (preview.slotId !== expectedSlotId) {
    throw persistenceError("INVALID_STATE", "Stored autosave preview targets another slot.");
  }
  return { slotId: expectedSlotId, captureSequence, envelope, preview };
}

function parseSettingsRecord(value: unknown): SettingsRecord {
  assertSafeExternalData(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError("INVALID_STATE", "Stored settings have an invalid shape.");
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, ["key", "revision", "settings"]);
  const revision = record["revision"];
  if (
    record["key"] !== SETTINGS_RECORD_KEY ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    Object.is(revision, -0)
  ) {
    throw persistenceError("INVALID_STATE", "Stored settings metadata is invalid.");
  }
  return {
    key: SETTINGS_RECORD_KEY,
    revision,
    settings: parsePlayerSettings(record["settings"]),
  };
}

interface StoredLocalReport {
  readonly sequence: number;
  readonly report: LocalReport;
}

const REPORT_SEQUENCE_KEY = "__overclock_report_sequence__";

function parseStoredReportSequence(value: unknown): number {
  assertSafeExternalData(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError("INVALID_STATE", "Stored report sequence has an invalid shape.");
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, ["sequence"]);
  const sequence = record["sequence"];
  if (typeof sequence !== "number") {
    throw persistenceError("INVALID_STATE", "Stored report sequence is invalid.");
  }
  assertSafeInteger(sequence, "stored report sequence");
  return sequence;
}

function parseStoredLocalReport(value: unknown, expectedReportId?: string): StoredLocalReport {
  assertSafeExternalData(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError("INVALID_STATE", "Stored local report has an invalid shape.");
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, ["sequence", "report"]);
  const sequence = record["sequence"];
  if (typeof sequence !== "number") {
    throw persistenceError("INVALID_STATE", "Stored local report sequence is invalid.");
  }
  assertSafeInteger(sequence, "stored report sequence");
  const report = parseLocalReport(record["report"]);
  if (expectedReportId !== undefined && report.reportId !== expectedReportId) {
    throw persistenceError("INVALID_STATE", "Stored report key does not match its report id.");
  }
  return { sequence, report };
}

function assertIncrementable(value: number, name: string): void {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw persistenceError("LIMIT_EXCEEDED", `${name} is exhausted.`);
  }
}

function checkFencing(
  existing: SlotMetaRecord,
  expectedRevision: number,
  expectedWriterEpoch: number,
): void {
  // Ownership first: when the writer epoch moved, the revision comparison
  // belongs to a different owner generation and is meaningless.
  if (existing.writerEpoch !== expectedWriterEpoch) {
    throw persistenceError(
      "STALE_WRITER",
      "The writer epoch changed; another session owns this slot.",
    );
  }
  if (existing.revision !== expectedRevision) {
    throw persistenceError(
      "STALE_REVISION",
      `Expected revision ${expectedRevision} but found ${existing.revision}.`,
    );
  }
}

function validatePreparedPair(
  slotId: string,
  prepared: PreparedManualSave,
): { envelope: StoredManualSave["envelope"]; preview: StoredManualSave["preview"] } {
  // Synchronous schema validation before the transaction opens; the
  // expensive canonical encode/hash already ran in the caller.
  const envelope = parseSaveEnvelope(prepared.envelope);
  const preview = parseSavePreview(prepared.preview);
  if (preview.slotId !== slotId) {
    throw persistenceError("INVALID_FORMAT", "Prepared preview targets a different slot.");
  }
  return { envelope, preview };
}

function verifiedAutosave(value: unknown, slotId: string): StoredAutosave {
  // Stored generations are revalidated on read so a corrupted record can
  // never be mistaken for verified data; listing caches stay `unchecked`.
  if (value === undefined) {
    throw persistenceError("INVALID_STATE", `Slot "${slotId}" has no such autosave generation.`);
  }
  return parseStoredAutosave(value, slotId);
}

function applyImportSettings(
  tx: RepositoryTransaction,
  request: ImportCommitRequest,
): Promise<SettingsRecord | null> {
  if (!request.applySettings || request.settingsValue === null) {
    return Promise.resolve(null);
  }
  const value = parsePlayerSettings(request.settingsValue);
  return tx.get("settings", SETTINGS_RECORD_KEY).then((existing) => {
    const current = existing === undefined ? null : parseSettingsRecord(existing);
    if (current !== null) assertIncrementable(current.revision, "settings revision");
    const record: SettingsRecord = {
      key: SETTINGS_RECORD_KEY,
      revision: (current?.revision ?? -1) + 1,
      settings: value,
    };
    return tx.put("settings", SETTINGS_RECORD_KEY, record).then(() => record);
  });
}

function requireDurableSlotCapacity(tx: RepositoryTransaction): Promise<void> {
  return tx.getAll("slotMeta").then((entries) => {
    const durableCount = entries.reduce((count, entry) => {
      if (typeof entry.key !== "string") {
        throw persistenceError("INVALID_STATE", "Stored slot metadata key is invalid.");
      }
      return count + (parseSlotMetaRecord(entry.value, entry.key).latestRecovery === null ? 0 : 1);
    }, 0);
    if (durableCount >= MAX_ORDINARY_SLOT_COUNT) {
      throw persistenceError(
        "LIMIT_EXCEEDED",
        `At most ${MAX_ORDINARY_SLOT_COUNT} durable slots are allowed.`,
      );
    }
  });
}

export function createSaveRepositoryCore(storage: RepositoryStorage): SaveRepositoryCore {
  return {
    async createSlot(
      slotId: string,
      writerEpoch: number,
      signal?: AbortSignal,
    ): Promise<SlotMetaRecord> {
      assertSlotId(slotId);
      assertSafeInteger(writerEpoch, "writerEpoch");
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta"], "readwrite", (tx) =>
          tx.get("slotMeta", slotId).then((existing) => {
            if (existing !== undefined) {
              throw persistenceError("INVALID_FORMAT", `Slot "${slotId}" already exists.`);
            }
            const meta: SlotMetaRecord = {
              slotId,
              revision: 0,
              nextCaptureSequence: 0,
              writerEpoch,
              latestRecovery: null,
            };
            return tx.put("slotMeta", slotId, meta).then(() => meta);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async listSlots(signal?: AbortSignal): Promise<readonly SlotListing[]> {
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta", "saves"], "readonly", (tx) =>
          Promise.all([tx.getAll("slotMeta"), tx.getAll("saves")]).then(([metas, saves]) => {
            const manualBySlot = new Map<string, StoredManualSave>();
            for (const entry of saves) {
              if (typeof entry.key !== "string") {
                throw persistenceError("INVALID_STATE", "Stored manual save key is invalid.");
              }
              try {
                manualBySlot.set(entry.key, parseStoredManualSave(entry.value, entry.key));
              } catch (error) {
                // Listing is informational. Preserve a damaged manual record
                // and continue to any healthy autosave for this slot.
                if (!(error instanceof PersistenceError)) throw error;
              }
            }
            const listings: SlotListing[] = [];
            for (const entry of metas) {
              if (typeof entry.key !== "string") {
                throw persistenceError("INVALID_STATE", "Stored slot metadata key is invalid.");
              }
              const meta = parseSlotMetaRecord(entry.value, entry.key);
              listings.push({
                slotId: entry.key,
                meta: cloneMeta(meta),
                manual: manualBySlot.get(entry.key) ?? null,
              });
            }
            listings.sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
            return listings;
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readManualSaveOrNull(
      slotId: string,
      signal?: AbortSignal,
    ): Promise<StoredManualSave | null> {
      assertSlotId(slotId);
      throwIfCancelled(signal);
      return storage
        .runTransaction(["saves"], "readonly", (tx) =>
          tx
            .get("saves", slotId)
            .then((value) => (value === undefined ? null : parseStoredManualSave(value, slotId))),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readManualSave(slotId: string, signal?: AbortSignal): Promise<StoredManualSave> {
      assertSlotId(slotId);
      throwIfCancelled(signal);
      return storage
        .runTransaction(["saves"], "readonly", (tx) =>
          tx.get("saves", slotId).then((value) => {
            if (value === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" has no manual save.`);
            }
            // Revalidate the stored envelope/preview shape on read so a
            // corrupted record can never be mistaken for verified data.
            // Listing may cache previews as `unchecked`; load never trusts it.
            return parseStoredManualSave(value, slotId);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readManualSaveAtRevision(
      slotId: string,
      expectedRevision: number | undefined,
      signal?: AbortSignal,
    ): Promise<{ readonly meta: SlotMetaRecord; readonly save: StoredManualSave }> {
      assertSlotId(slotId);
      if (expectedRevision !== undefined) assertSafeInteger(expectedRevision, "expectedRevision");
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta", "saves"], "readonly", (tx) =>
          Promise.all([tx.get("slotMeta", slotId), tx.get("saves", slotId)]).then(
            ([metaValue, saveValue]) => {
              if (metaValue === undefined || saveValue === undefined) {
                throw persistenceError("INVALID_STATE", `Slot "${slotId}" has no manual save.`);
              }
              const meta = parseSlotMetaRecord(metaValue, slotId);
              if (expectedRevision !== undefined && meta.revision !== expectedRevision) {
                throw persistenceError(
                  "STALE_REVISION",
                  `Expected revision ${expectedRevision} but found ${meta.revision}.`,
                );
              }
              const save = parseStoredManualSave(saveValue, slotId);
              if (save.revision > meta.revision) {
                throw persistenceError(
                  "INVALID_STATE",
                  "Stored manual save revision is ahead of its slot metadata.",
                );
              }
              return { meta: cloneMeta(meta), save };
            },
          ),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readSlotMeta(slotId: string, signal?: AbortSignal): Promise<SlotMetaRecord> {
      assertSlotId(slotId);
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta"], "readonly", (tx) =>
          tx.get("slotMeta", slotId).then((value) => {
            if (value === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            return cloneMeta(parseSlotMetaRecord(value, slotId));
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async writeManualSave(
      slotId: string,
      prepared: PreparedManualSave,
      options: WriteManualSaveOptions,
    ): Promise<SlotMetaRecord> {
      assertSlotId(slotId);
      assertSafeInteger(options.expectedRevision, "expectedRevision");
      assertSafeInteger(options.expectedWriterEpoch, "expectedWriterEpoch");
      throwIfCancelled(options.signal);
      if (options.token?.cancelled === true) {
        return Promise.reject(
          persistenceError("CANCELLED", "The write was cancelled before the transaction opened."),
        );
      }
      // Synchronous schema validation of the prepared envelope/preview
      // happens before the transaction opens; the expensive canonical
      // encode/hash already ran in the caller (codec boundary).
      const { envelope, preview } = validatePreparedPair(slotId, prepared);
      return storage
        .runTransaction(["slotMeta", "saves", "autosaves"], "readwrite", (tx) =>
          tx.get("slotMeta", slotId).then((existing) => {
            if (existing === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            const current = parseSlotMetaRecord(existing, slotId);
            checkFencing(current, options.expectedRevision, options.expectedWriterEpoch);
            assertIncrementable(current.revision, "slot revision");
            assertIncrementable(current.nextCaptureSequence, "capture sequence");
            const captureSequence = current.nextCaptureSequence;
            const stored: StoredManualSave = {
              slotId,
              captureSequence,
              revision: current.revision + 1,
              envelope,
              preview,
            };
            const meta: SlotMetaRecord = {
              slotId,
              revision: current.revision + 1,
              nextCaptureSequence: current.nextCaptureSequence + 1,
              writerEpoch: current.writerEpoch,
              latestRecovery: { kind: "manual", captureSequence },
            };
            // Slot record and metadata commit atomically; the locator is
            // persisted only in this same transaction as its envelope.
            const capacity =
              current.latestRecovery === null ? requireDurableSlotCapacity(tx) : Promise.resolve();
            return capacity.then(() =>
              tx
                .put("saves", slotId, stored)
                .then(() => tx.put("slotMeta", slotId, meta))
                .then(() => cloneMeta(meta)),
            );
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async writeAutosave(
      slotId: string,
      prepared: PreparedManualSave,
      options: WriteAutosaveOptions,
    ): Promise<WriteAutosaveResult> {
      assertSlotId(slotId);
      assertSafeInteger(options.expectedRevision, "expectedRevision");
      assertSafeInteger(options.expectedWriterEpoch, "expectedWriterEpoch");
      throwIfCancelled(options.signal);
      if (options.token?.cancelled === true) {
        return Promise.reject(
          persistenceError("CANCELLED", "The write was cancelled before the transaction opened."),
        );
      }
      const { envelope, preview } = validatePreparedPair(slotId, prepared);
      return storage
        .runTransaction(["slotMeta", "autosaves"], "readwrite", (tx) =>
          tx.get("slotMeta", slotId).then((existing) => {
            if (existing === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            const current = parseSlotMetaRecord(existing, slotId);
            checkFencing(current, options.expectedRevision, options.expectedWriterEpoch);
            assertIncrementable(current.revision, "slot revision");
            assertIncrementable(current.nextCaptureSequence, "capture sequence");
            const captureSequence = current.nextCaptureSequence;
            const stored: StoredAutosave = { slotId, captureSequence, envelope, preview };
            let prunedCaptureSequences: readonly number[] = [];
            const capacity =
              current.latestRecovery === null ? requireDurableSlotCapacity(tx) : Promise.resolve();
            return capacity
              .then(() => tx.put("autosaves", autosaveKey(slotId, captureSequence), stored))
              .then(() => tx.getAll("autosaves"))
              .then((entries) => {
                // Newest-first by capture sequence; retain exactly the
                // newest three distinct captures, prune the rest in this
                // same transaction. Manual saves never participate.
                const generations = entries
                  .filter((entry) => parseAutosaveKey(entry.key)?.slotId === slotId)
                  .map((entry) => verifiedAutosave(entry.value, slotId))
                  .sort((a, b) => b.captureSequence - a.captureSequence);
                const pruned = generations.slice(MAX_AUTOSAVE_ROTATIONS);
                prunedCaptureSequences = pruned.map((generation) => generation.captureSequence);
                const deletions = pruned.map((generation) =>
                  tx.delete("autosaves", autosaveKey(slotId, generation.captureSequence)),
                );
                return Promise.all(deletions);
              })
              .then(() => {
                const meta: SlotMetaRecord = {
                  slotId,
                  revision: current.revision + 1,
                  nextCaptureSequence: current.nextCaptureSequence + 1,
                  writerEpoch: current.writerEpoch,
                  latestRecovery: { kind: "autosave", captureSequence },
                };
                return tx.put("slotMeta", slotId, meta).then(() => cloneMeta(meta));
              })
              .then((meta) => ({
                meta,
                prunedCaptureSequences,
              }));
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async listAutosaves(slotId: string, signal?: AbortSignal): Promise<readonly StoredAutosave[]> {
      assertSlotId(slotId);
      throwIfCancelled(signal);
      return storage
        .runTransaction(["autosaves"], "readonly", (tx) =>
          tx.getAll("autosaves").then((entries) => {
            return entries
              .filter((entry) => parseAutosaveKey(entry.key)?.slotId === slotId)
              .map((entry) => verifiedAutosave(entry.value, slotId))
              .sort((a, b) => b.captureSequence - a.captureSequence);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async listAutosaveSequences(slotId: string, signal?: AbortSignal): Promise<readonly number[]> {
      assertSlotId(slotId);
      throwIfCancelled(signal);
      return storage
        .runTransaction(["autosaves"], "readonly", (tx) =>
          tx.getAll("autosaves").then((entries) =>
            entries
              .map((entry) => parseAutosaveKey(entry.key))
              .flatMap((key) =>
                key !== null && key.slotId === slotId ? [key.captureSequence] : [],
              )
              .sort((left, right) => right - left),
          ),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readAutosave(
      slotId: string,
      captureSequence: number,
      signal?: AbortSignal,
    ): Promise<StoredAutosave> {
      assertSlotId(slotId);
      assertSafeInteger(captureSequence, "captureSequence");
      throwIfCancelled(signal);
      return storage
        .runTransaction(["autosaves"], "readonly", (tx) =>
          tx.get("autosaves", autosaveKey(slotId, captureSequence)).then((value) => {
            const generation = verifiedAutosave(value, slotId);
            if (generation.slotId !== slotId || generation.captureSequence !== captureSequence) {
              throw persistenceError("INVALID_STATE", "Stored autosave key does not match.");
            }
            return generation;
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async getLatestRecovery(slotId: string, signal?: AbortSignal): Promise<RecoveryLocator | null> {
      // Locator only; recovery execution (fresh core promotion, Continue
      // gating) belongs to Task 20.2. Ordering is by captureSequence, never
      // by wall-clock timestamp.
      assertSlotId(slotId);
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta"], "readonly", (tx) =>
          tx.get("slotMeta", slotId).then((value) => {
            if (value === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            const locator = parseSlotMetaRecord(value, slotId).latestRecovery;
            return locator === null
              ? null
              : { kind: locator.kind, captureSequence: locator.captureSequence };
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async deleteSlot(slotId: string, options: DeleteSlotOptions): Promise<void> {
      assertSlotId(slotId);
      assertSafeInteger(options.expectedRevision, "expectedRevision");
      assertSafeInteger(options.expectedWriterEpoch, "expectedWriterEpoch");
      throwIfCancelled(options.signal);
      return storage
        .runTransaction(["slotMeta", "saves", "autosaves"], "readwrite", (tx) =>
          tx.get("slotMeta", slotId).then((existing) => {
            if (existing === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            checkFencing(
              parseSlotMetaRecord(existing, slotId),
              options.expectedRevision,
              options.expectedWriterEpoch,
            );
            // One transaction removes the slot, its autosave rotations and
            // its metadata; no related slot is touched.
            return tx
              .getAll("autosaves")
              .then((entries) => {
                const deletions: Promise<void>[] = [tx.delete("saves", slotId)];
                for (const entry of entries) {
                  if (parseAutosaveKey(entry.key)?.slotId === slotId) {
                    deletions.push(tx.delete("autosaves", entry.key));
                  }
                }
                deletions.push(tx.delete("slotMeta", slotId));
                return Promise.all(deletions);
              })
              .then(() => undefined);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async commitImport(request: ImportCommitRequest): Promise<ImportCommitResult> {
      // Bind the destination to a local const so discriminated-union
      // narrowing survives inside the transaction closures below.
      const destination = request.destination;
      const slotId = destination.slotId;
      assertSlotId(slotId);
      throwIfCancelled(request.signal);
      if (request.applySettings && request.settingsValue === null) {
        throw persistenceError("INVALID_FORMAT", "Import settings application needs a value.");
      }
      if (destination.kind === "new-slot") {
        assertSafeInteger(destination.writerEpoch, "writerEpoch");
      } else {
        assertSafeInteger(destination.expectedRevision, "expectedRevision");
        assertSafeInteger(destination.expectedWriterEpoch, "expectedWriterEpoch");
      }
      // The prepared pair must already target the destination: the import
      // service rebinds source bytes to an owned copy with a fresh checksum
      // before calling here, leaving the source bytes untouched.
      const { envelope, preview } = validatePreparedPair(slotId, request.prepared);
      return storage
        .runTransaction(["slotMeta", "saves", "settings"], "readwrite", (tx) =>
          tx.get("slotMeta", slotId).then((existing) => {
            if (destination.kind === "new-slot") {
              if (existing !== undefined) {
                throw persistenceError(
                  "INVALID_FORMAT",
                  `Slot "${slotId}" already exists; import cannot reuse it.`,
                );
              }
              return requireDurableSlotCapacity(tx).then(() => {
                const created: SlotMetaRecord = {
                  slotId,
                  revision: 1,
                  nextCaptureSequence: 1,
                  writerEpoch: destination.writerEpoch,
                  latestRecovery: { kind: "manual", captureSequence: 0 },
                };
                const stored: StoredManualSave = {
                  slotId,
                  captureSequence: 0,
                  revision: 1,
                  envelope,
                  preview,
                };
                return applyImportSettings(tx, request).then((settings) =>
                  tx
                    .put("saves", slotId, stored)
                    .then(() => tx.put("slotMeta", slotId, created))
                    .then((): ImportCommitResult => ({ meta: cloneMeta(created), settings })),
                );
              });
            }
            if (existing === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            const current = parseSlotMetaRecord(existing, slotId);
            checkFencing(current, destination.expectedRevision, destination.expectedWriterEpoch);
            assertIncrementable(current.revision, "slot revision");
            assertIncrementable(current.nextCaptureSequence, "capture sequence");
            const captureSequence = current.nextCaptureSequence;
            const updated: SlotMetaRecord = {
              slotId,
              revision: current.revision + 1,
              nextCaptureSequence: current.nextCaptureSequence + 1,
              writerEpoch: current.writerEpoch,
              latestRecovery: { kind: "manual", captureSequence },
            };
            const stored: StoredManualSave = {
              slotId,
              captureSequence,
              revision: current.revision + 1,
              envelope,
              preview,
            };
            return applyImportSettings(tx, request).then((settings) =>
              tx
                .put("saves", slotId, stored)
                .then(() => tx.put("slotMeta", slotId, updated))
                .then((): ImportCommitResult => ({ meta: cloneMeta(updated), settings })),
            );
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readSettings(signal?: AbortSignal): Promise<SettingsRecord | null> {
      throwIfCancelled(signal);
      return storage
        .runTransaction(["settings"], "readonly", (tx) =>
          tx.get("settings", SETTINGS_RECORD_KEY).then((value) => {
            if (value === undefined) return null;
            return parseSettingsRecord(value);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async writeSettings(
      settings: PlayerSettings,
      options: WriteSettingsOptions,
    ): Promise<SettingsRecord> {
      throwIfCancelled(options.signal);
      const parsedSettings = parsePlayerSettings(settings);
      return storage
        .runTransaction(["settings"], "readwrite", (tx) =>
          tx.get("settings", SETTINGS_RECORD_KEY).then((existing) => {
            const current = existing === undefined ? null : parseSettingsRecord(existing);
            if (options.expectedRevision !== null) {
              assertSafeInteger(options.expectedRevision, "expectedRevision");
              const found = current?.revision ?? null;
              if (found !== options.expectedRevision) {
                throw persistenceError(
                  "STALE_REVISION",
                  `Expected settings revision ${options.expectedRevision} but found ${String(found)}.`,
                );
              }
            }
            const record: SettingsRecord = {
              key: SETTINGS_RECORD_KEY,
              revision: (current?.revision ?? -1) + 1,
              settings: parsedSettings,
            };
            if (current !== null) assertIncrementable(current.revision, "settings revision");
            return tx.put("settings", SETTINGS_RECORD_KEY, record).then(() => record);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async rotateWriterEpoch(
      slotId: string,
      expectedWriterEpoch: number,
      signal?: AbortSignal,
    ): Promise<SlotMetaRecord> {
      // Lock-acquisition primitive for Task 17.2: after the UI acquires the
      // Web Lock `overclock-slot:<slotId>`, it binds Worker writes to the
      // incremented epoch. Old Worker messages carry the previous epoch and
      // can no longer commit even if delivered late.
      assertSlotId(slotId);
      assertSafeInteger(expectedWriterEpoch, "expectedWriterEpoch");
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta"], "readwrite", (tx) =>
          tx.get("slotMeta", slotId).then((existing) => {
            if (existing === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            const current = parseSlotMetaRecord(existing, slotId);
            if (current.writerEpoch !== expectedWriterEpoch) {
              throw persistenceError(
                "STALE_WRITER",
                "The writer epoch changed; another session owns this slot.",
              );
            }
            const meta: SlotMetaRecord = {
              ...cloneMeta(current),
              revision: current.revision + 1,
              writerEpoch: current.writerEpoch + 1,
            };
            assertIncrementable(current.revision, "slot revision");
            assertIncrementable(current.writerEpoch, "writer epoch");
            return tx.put("slotMeta", slotId, meta).then(() => cloneMeta(meta));
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readAutosaveAtRevision(
      slotId: string,
      captureSequence: number,
      expectedRevision: number,
      signal?: AbortSignal,
    ): Promise<{ readonly meta: SlotMetaRecord; readonly autosave: StoredAutosave }> {
      assertSlotId(slotId);
      assertSafeInteger(captureSequence, "captureSequence");
      assertSafeInteger(expectedRevision, "expectedRevision");
      throwIfCancelled(signal);
      return storage
        .runTransaction(["slotMeta", "autosaves"], "readonly", (tx) =>
          Promise.all([
            tx.get("slotMeta", slotId),
            tx.get("autosaves", autosaveKey(slotId, captureSequence)),
          ]).then(([metaValue, autosaveValue]) => {
            if (metaValue === undefined) {
              throw persistenceError("INVALID_STATE", `Slot "${slotId}" does not exist.`);
            }
            const meta = parseSlotMetaRecord(metaValue, slotId);
            if (meta.revision !== expectedRevision) {
              throw persistenceError(
                "STALE_REVISION",
                `Expected revision ${expectedRevision} but found ${meta.revision}.`,
              );
            }
            const autosave = verifiedAutosave(autosaveValue, slotId);
            if (autosave.captureSequence !== captureSequence) {
              throw persistenceError(
                "INVALID_STATE",
                "Stored autosave sequence does not match its key.",
              );
            }
            return { meta: cloneMeta(meta), autosave };
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async writeReport(report: LocalReport): Promise<void> {
      const parsed = parseLocalReport(report);
      if (parsed.reportId === REPORT_SEQUENCE_KEY) {
        throw persistenceError("INVALID_FORMAT", "The local report id is reserved.");
      }
      const byteLength = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
      if (byteLength > MAX_REPORT_BYTES) {
        throw persistenceError("LIMIT_EXCEEDED", "The local report exceeds its byte limit.");
      }
      return storage
        .runTransaction(["reports"], "readwrite", (tx) =>
          tx.getAll("reports").then((entries) => {
            const sequenceEntry = entries.find((entry) => entry.key === REPORT_SEQUENCE_KEY);
            const existing = entries
              .filter((entry) => entry.key !== REPORT_SEQUENCE_KEY)
              .map((entry) => ({
                key: entry.key,
                ...parseStoredLocalReport(entry.value),
              }));
            if (existing.some((entry) => entry.report.reportId === parsed.reportId)) {
              throw persistenceError("INVALID_FORMAT", "A report with this id already exists.");
            }
            const previousSequence =
              sequenceEntry === undefined
                ? existing.reduce((maximum, entry) => Math.max(maximum, entry.sequence), -1)
                : parseStoredReportSequence(sequenceEntry.value);
            assertIncrementable(previousSequence + 1, "report sequence");
            const added: StoredLocalReport = { sequence: previousSequence + 1, report: parsed };
            const all = [...existing, { key: parsed.reportId, ...added }].sort(
              (left, right) => left.sequence - right.sequence,
            );
            const pruned = all.slice(0, Math.max(0, all.length - MAX_REPORT_COUNT));
            return Promise.all([
              tx.put("reports", parsed.reportId, added),
              tx.put("reports", REPORT_SEQUENCE_KEY, { sequence: added.sequence }),
              ...pruned.map((entry) => tx.delete("reports", entry.key)),
            ]).then(() => undefined);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async listReports(): Promise<readonly LocalReport[]> {
      return storage
        .runTransaction(["reports"], "readonly", (tx) =>
          tx.getAll("reports").then((entries) =>
            entries
              .filter((entry) => entry.key !== REPORT_SEQUENCE_KEY)
              .map((entry) => parseStoredLocalReport(entry.value, String(entry.key)))
              .sort((left, right) => right.sequence - left.sequence)
              .map((entry) => structuredClone(entry.report)),
          ),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async readReport(reportId: string): Promise<LocalReport> {
      if (
        typeof reportId !== "string" ||
        reportId.length === 0 ||
        reportId.length > MAX_REPORT_BYTES ||
        reportId === REPORT_SEQUENCE_KEY
      ) {
        throw persistenceError("INVALID_FORMAT", "The local report id is invalid.");
      }
      return storage
        .runTransaction(["reports"], "readonly", (tx) =>
          tx.get("reports", reportId).then((value) => {
            if (value === undefined) {
              throw persistenceError("INVALID_STATE", "The requested local report is missing.");
            }
            return structuredClone(parseStoredLocalReport(value, reportId).report);
          }),
        )
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },

    async deleteReport(reportId: string): Promise<void> {
      if (
        typeof reportId !== "string" ||
        reportId.length === 0 ||
        reportId.length > MAX_REPORT_BYTES ||
        reportId === REPORT_SEQUENCE_KEY
      ) {
        throw persistenceError("INVALID_FORMAT", "The local report id is invalid.");
      }
      return storage
        .runTransaction(["reports"], "readwrite", (tx) => tx.delete("reports", reportId))
        .catch((error: unknown) => Promise.reject(mapStorageError(error)));
    },
  };
}

// Builds a verified preview for a stored manual save. Kept beside the core
// so future import/export services (Task 17.3) share one derivation rule.
export function previewForStoredSave(stored: StoredManualSave, preview: SavePreview): SavePreview {
  if (preview.slotId !== stored.slotId) {
    throw persistenceError("INVALID_FORMAT", "Preview targets a different slot.");
  }
  return structuredClone(preview);
}
