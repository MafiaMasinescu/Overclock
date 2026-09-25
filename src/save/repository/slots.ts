import { PersistenceError, persistenceError } from "../persistenceErrors.ts";
import type { SaveRepositoryCore } from "./repository.ts";
import type { PreparedManualSave, RepositoryOperationToken, SlotMetaRecord } from "./types.ts";
import type { WriteAutosaveResult } from "./types.ts";
import type { SlotBusy, SlotLockHandle, WebLockAdapter } from "./webLocks.ts";

// Phase 2 Task 17.2: writer sessions bind Web Lock ownership to repository
// fencing. Opening a session acquires `overclock-slot:<slotId>`, then binds
// Worker writes to a fresh writerEpoch via rotateWriterEpoch, so messages
// from a released session can no longer commit even if delivered late.
// Reads (list/preview/export) never take the lock and stay available to a
// second tab that receives a busy signal for writing.

// Re-exported for consumers that only need the busy shape.
export type { SlotBusy };

export interface WriterSession {
  readonly slotId: string;
  readonly writerEpoch: number;
  readonly closed: boolean;
  currentRevision(): number;
  writeManual(
    prepared: PreparedManualSave,
    options?: { readonly token?: RepositoryOperationToken; readonly signal?: AbortSignal },
  ): Promise<SlotMetaRecord>;
  writeAutosave(
    prepared: PreparedManualSave,
    options?: { readonly token?: RepositoryOperationToken; readonly signal?: AbortSignal },
  ): Promise<WriteAutosaveResult>;
  refresh(): Promise<SlotMetaRecord>;
  close(): Promise<void>;
}

export type OpenWriterResult = WriterSession | SlotBusy;

export interface DeleteInactiveSlotOptions {
  readonly expectedRevision: number;
  readonly isSlotActive?: (slotId: string) => boolean;
  readonly signal?: AbortSignal;
}

export function isSlotBusy(result: SlotLockHandle | SlotBusy | WriterSession): result is SlotBusy {
  return "status" in result;
}

export async function openWriterSession(
  core: SaveRepositoryCore,
  locks: WebLockAdapter,
  slotId: string,
  options?: { ifAvailable?: boolean; createIfMissing?: boolean; signal?: AbortSignal },
): Promise<OpenWriterResult> {
  const handleOrBusy: SlotLockHandle | SlotBusy = await locks.acquire(slotId, options);
  if (isSlotBusy(handleOrBusy)) return handleOrBusy;
  const handle: SlotLockHandle = handleOrBusy;
  try {
    let meta: SlotMetaRecord;
    try {
      meta = await core.readSlotMeta(slotId, options?.signal);
    } catch (error: unknown) {
      if (
        options?.createIfMissing !== true ||
        !(error instanceof PersistenceError) ||
        error.code !== "INVALID_STATE"
      ) {
        throw error;
      }
      meta = await core.createSlot(slotId, 0, options.signal);
    }
    const rotated = await core.rotateWriterEpoch(slotId, meta.writerEpoch, options?.signal);
    return createSession(core, handle, slotId, rotated.writerEpoch, rotated.revision);
  } catch (error: unknown) {
    // A failed bind must not keep the lock: another tab could otherwise
    // wait behind a session that will never write.
    await handle.release();
    throw error;
  }
}

export async function deleteInactiveSlot(
  core: SaveRepositoryCore,
  locks: WebLockAdapter,
  slotId: string,
  options: DeleteInactiveSlotOptions,
): Promise<void> {
  if (options.isSlotActive?.(slotId) === true) {
    throw persistenceError("SLOT_ACTIVE", "The slot runs live and cannot be deleted.");
  }
  const handleOrBusy = await locks.acquire(slotId, {
    ifAvailable: true,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  if (isSlotBusy(handleOrBusy)) {
    throw persistenceError("SLOT_BUSY", "The slot is owned by another tab.");
  }
  try {
    if (options.isSlotActive?.(slotId) === true) {
      throw persistenceError("SLOT_ACTIVE", "The slot became active before deletion.");
    }
    const current = await core.readSlotMeta(slotId, options.signal);
    if (current.revision !== options.expectedRevision) {
      throw persistenceError(
        "STALE_REVISION",
        `Expected revision ${options.expectedRevision} but found ${current.revision}.`,
      );
    }
    await core.deleteSlot(slotId, {
      expectedRevision: current.revision,
      expectedWriterEpoch: current.writerEpoch,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } finally {
    await handleOrBusy.release();
  }
}

function createSession(
  core: SaveRepositoryCore,
  handle: SlotLockHandle,
  slotId: string,
  writerEpoch: number,
  revision: number,
): WriterSession {
  let currentRevision = revision;
  let closed = false;

  function requireOpen(): void {
    if (closed) {
      throw persistenceError("STORAGE_ABORTED", "The writer session is closed.");
    }
  }

  return {
    slotId,
    writerEpoch,
    get closed(): boolean {
      return closed;
    },
    currentRevision(): number {
      return currentRevision;
    },
    async writeManual(
      prepared: PreparedManualSave,
      options?: { readonly token?: RepositoryOperationToken; readonly signal?: AbortSignal },
    ): Promise<SlotMetaRecord> {
      requireOpen();
      const meta = await core.writeManualSave(slotId, prepared, {
        expectedRevision: currentRevision,
        expectedWriterEpoch: writerEpoch,
        ...(options?.token !== undefined ? { token: options.token } : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      });
      currentRevision = meta.revision;
      return meta;
    },
    async writeAutosave(
      prepared: PreparedManualSave,
      options?: { readonly token?: RepositoryOperationToken; readonly signal?: AbortSignal },
    ): Promise<WriteAutosaveResult> {
      requireOpen();
      const result = await core.writeAutosave(slotId, prepared, {
        expectedRevision: currentRevision,
        expectedWriterEpoch: writerEpoch,
        ...(options?.token !== undefined ? { token: options.token } : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      });
      currentRevision = result.meta.revision;
      return result;
    },
    async refresh(): Promise<SlotMetaRecord> {
      requireOpen();
      const meta = await core.readSlotMeta(slotId);
      currentRevision = meta.revision;
      return meta;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await handle.release();
    },
  };
}
