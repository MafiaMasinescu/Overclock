import type { PlayerSettings, SaveEnvelope, SavePreview } from "../contracts.ts";

// Phase 2 Task 17.1: version-1 durable database schema and record types.
// Contract section 10 is normative. All ordering/recovery decisions live here
// as data shapes; the storage boundary (storage.ts / indexedDb.ts) and the
// atomic mutation logic (repository.ts) consume these types.

// Database identity. Version 1 is the first durable release; any future
// schema change needs a new version plus an explicit upgrade path. Never
// delete the database to recover an upgrade error.
export const OVERCLOCK_DB_NAME = "overclock" as const;
export const OVERCLOCK_DB_VERSION = 1 as const;

// Store names. `blueprints` is a reserved empty store that freezes the v1
// schema shape; it carries no standalone persistence behavior in Phase 2.
export const STORE_SAVES = "saves" as const;
export const STORE_AUTOSAVES = "autosaves" as const;
export const STORE_SLOT_META = "slotMeta" as const;
export const STORE_SETTINGS = "settings" as const;
export const STORE_REPORTS = "reports" as const;
export const STORE_BLUEPRINTS = "blueprints" as const;

export const SETTINGS_RECORD_KEY = "global" as const;

// Monotonic per-slot metadata. `revision` fences every mutation (compare and
// swap); `nextCaptureSequence` is consumed by manual saves and autosaves
// alike so recovery ordering stays total; `writerEpoch` binds committed
// writes to the Web Lock owner (Task 17.2 acquires it, 17.1 threads it
// through). `latestRecovery` is a locator persisted only in the same
// transaction as its referenced envelope. Recovery chooses by
// captureSequence, never by wall-clock timestamp.
export interface SlotMetaRecord {
  readonly slotId: string;
  readonly revision: number;
  readonly nextCaptureSequence: number;
  readonly writerEpoch: number;
  readonly latestRecovery: RecoveryLocator | null;
}

export interface RecoveryLocator {
  readonly kind: "manual" | "autosave";
  readonly captureSequence: number;
}

// Latest manual save per slot: the verified envelope, its derived preview
// and the capture generation that produced it. Manual records consume the
// shared capture sequence but never participate in three-rotation pruning.
export interface StoredManualSave {
  readonly slotId: string;
  readonly captureSequence: number;
  readonly revision: number;
  readonly envelope: SaveEnvelope;
  readonly preview: SavePreview;
}

// Autosave generation. The compound key is [slotId, captureSequence].
// Rotation to the newest three per slot is Task 17.2; 17.1 only owns the
// store shape and the shared sequence counter.
export interface StoredAutosave {
  readonly slotId: string;
  readonly captureSequence: number;
  readonly envelope: SaveEnvelope;
  readonly preview: SavePreview;
}

export interface SettingsRecord {
  readonly key: typeof SETTINGS_RECORD_KEY;
  readonly revision: number;
  readonly settings: PlayerSettings;
}

// Immutable operation token. Async preparation (canonical encode, SHA-256,
// gzip) happens before any readwrite transaction opens. The token is
// captured during preparation; if it is cancelled before the transaction
// opens, the mutation reports CANCELLED and never writes, so a late
// completion cannot commit after the user changed session.
export interface RepositoryOperationToken {
  readonly cancelled: boolean;
}

export function createOperationToken(): {
  readonly token: RepositoryOperationToken;
  readonly cancel: () => void;
} {
  let cancelled = false;
  return {
    token: {
      get cancelled(): boolean {
        return cancelled;
      },
    },
    cancel: (): void => {
      cancelled = true;
    },
  };
}

// A save already verified and encoded outside the transaction. The
// repository never runs crypto or compression; it only schema-validates
// these owned values (cheap, synchronous) and then writes atomically.
export interface PreparedManualSave {
  readonly envelope: SaveEnvelope;
  readonly preview: SavePreview;
}

export interface WriteManualSaveOptions {
  readonly expectedRevision: number;
  readonly expectedWriterEpoch: number;
  readonly token?: RepositoryOperationToken;
  readonly signal?: AbortSignal;
}

// Autosave writes fence exactly like manual writes; the alias keeps the
// shared fencing contract visible at each call site.
export type WriteAutosaveOptions = WriteManualSaveOptions;

export interface WriteAutosaveResult {
  readonly meta: SlotMetaRecord;
  readonly prunedCaptureSequences: readonly number[];
}

// Atomic import commit (Task 17.3): a confirmed import lands the slot
// record, its fencing metadata, and optionally the global settings in one
// transaction, so the slot list never shows a half-imported generation.
export type ImportDestination =
  | { readonly kind: "new-slot"; readonly slotId: string; readonly writerEpoch: number }
  | {
      readonly kind: "overwrite";
      readonly slotId: string;
      readonly expectedRevision: number;
      readonly expectedWriterEpoch: number;
    };

export interface ImportCommitRequest {
  readonly destination: ImportDestination;
  readonly prepared: PreparedManualSave;
  readonly applySettings: boolean;
  readonly settingsValue: PlayerSettings | null;
  readonly signal?: AbortSignal;
}

export interface ImportCommitResult {
  readonly meta: SlotMetaRecord;
  readonly settings: SettingsRecord | null;
}

export interface DeleteSlotOptions {
  readonly expectedRevision: number;
  readonly expectedWriterEpoch: number;
  readonly signal?: AbortSignal;
}

export interface WriteSettingsOptions {
  readonly expectedRevision: number | null;
  readonly signal?: AbortSignal;
}

export interface SlotListing {
  readonly slotId: string;
  readonly meta: SlotMetaRecord;
  readonly manual: StoredManualSave | null;
}
