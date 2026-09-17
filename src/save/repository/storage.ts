import { PersistenceError, persistenceError } from "../persistenceErrors.ts";
import type {
  STORE_AUTOSAVES,
  STORE_BLUEPRINTS,
  STORE_REPORTS,
  STORE_SAVES,
  STORE_SETTINGS,
  STORE_SLOT_META,
} from "./types.ts";

// Phase 2 Task 17.1: injected storage boundary with IndexedDB completion
// semantics. Production uses the real IndexedDB adapter (indexedDb.ts); Node
// unit tests use the in-memory fake below. Both resolve a mutation only when
// the whole transaction commits (the `transaction.oncomplete` analogue). A
// single request succeeding never counts as durable acknowledgment.

export type RepositoryKey = string | [string, number];

export function autosaveKey(slotId: string, captureSequence: number): [string, number] {
  return [slotId, captureSequence];
}

export function parseAutosaveKey(
  key: RepositoryKey,
): { slotId: string; captureSequence: number } | null {
  if (
    !Array.isArray(key) ||
    typeof key[0] !== "string" ||
    typeof key[1] !== "number" ||
    !Number.isSafeInteger(key[1]) ||
    key[1] < 0 ||
    Object.is(key[1], -0)
  ) {
    return null;
  }
  return { slotId: key[0], captureSequence: key[1] };
}

export type StoreName =
  | typeof STORE_SAVES
  | typeof STORE_AUTOSAVES
  | typeof STORE_SLOT_META
  | typeof STORE_SETTINGS
  | typeof STORE_REPORTS
  | typeof STORE_BLUEPRINTS;

export type TransactionMode = "readonly" | "readwrite";

// Narrow transactional surface. Implementations stage writes and expose
// them to later reads inside the same transaction; nothing is durable
// until the transaction commits.
export interface RepositoryTransaction {
  get(store: StoreName, key: RepositoryKey): Promise<unknown>;
  getAll(store: StoreName): Promise<readonly { key: RepositoryKey; value: unknown }[]>;
  put(store: StoreName, key: RepositoryKey, value: unknown): Promise<void>;
  delete(store: StoreName, key: RepositoryKey): Promise<void>;
  count(store: StoreName): Promise<number>;
}

export interface RepositoryStorage {
  runTransaction<T>(
    stores: readonly StoreName[],
    mode: TransactionMode,
    work: (tx: RepositoryTransaction) => Promise<T>,
  ): Promise<T>;
  close(): void;
}

// Maps platform failures to the stable persistence codes. Contract §10:
// QuotaExceededError, AbortError and version errors become typed failures;
// a declared cancellation becomes CANCELLED, never a silent success.
export function mapStorageError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") {
      return persistenceError("QUOTA_EXCEEDED", "The durable store reported quota exceeded.");
    }
    if (error.name === "VersionError") {
      return persistenceError("UPGRADE_BLOCKED", "The database version upgrade is blocked.");
    }
    if (error.name === "AbortError" || error.name === "TransactionInactiveError") {
      return persistenceError("STORAGE_ABORTED", `The storage transaction aborted: ${error.name}.`);
    }
    return persistenceError("STORAGE_ABORTED", `The storage layer failed: ${error.name}.`);
  }
  if (error instanceof Error && error.name === "QuotaExceededError") {
    return persistenceError("QUOTA_EXCEEDED", "The durable store reported quota exceeded.");
  }
  return persistenceError(
    "STORAGE_ABORTED",
    error instanceof Error
      ? `The storage transaction failed: ${error.message}.`
      : "The storage transaction failed.",
  );
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw persistenceError("CANCELLED", "The repository operation was cancelled.");
  }
}

// In-memory fake with faithful commit/abort semantics for Node unit tests.
// Writes are staged per transaction and applied only on commit; an abort
// (explicit fault or work-function throw) discards the staged writes while
// preserving previously committed data.
export interface InMemoryStorageControls {
  readonly storage: RepositoryStorage;
  // Next commit reports request success, then aborts the transaction, so
  // tests prove that request success alone is never treated as durable.
  abortAfterRequestSuccessOnce(): void;
  // Next commit fails with a quota error; prior data must be preserved.
  failNextCommitWithQuotaExceeded(): void;
  // Next commit fails with a generic abort; prior data must be preserved.
  failNextCommitWithAbort(): void;
  committedWriteCount(): number;
}

export function createInMemoryRepositoryStorage(): InMemoryStorageControls {
  interface StoredEntry {
    readonly key: RepositoryKey;
    readonly value: unknown;
  }
  const committed = new Map<StoreName, Map<string, StoredEntry>>();
  const storeNames: readonly StoreName[] = [
    "saves",
    "autosaves",
    "slotMeta",
    "settings",
    "reports",
    "blueprints",
  ];
  for (const name of storeNames) committed.set(name, new Map<string, StoredEntry>());

  function keyIdentity(key: RepositoryKey): string {
    return typeof key === "string" ? `s:${key}` : `a:${key[0]}:${key[1]}`;
  }

  let abortAfterSuccess = false;
  let failQuota = false;
  let failAbort = false;
  let writes = 0;
  let closed = false;

  function requireOpen(): void {
    if (closed) throw persistenceError("STORAGE_ABORTED", "The repository storage is closed.");
  }

  const storage: RepositoryStorage = {
    runTransaction<T>(
      _stores: readonly StoreName[],
      mode: TransactionMode,
      work: (tx: RepositoryTransaction) => Promise<T>,
    ): Promise<T> {
      requireOpen();
      // Staged writes sit on top of committed data; deletions are tracked
      // in a separate tombstone set because `unknown` already includes null.
      const stagedWrites = new Map<StoreName, Map<string, StoredEntry>>();
      const stagedDeletes = new Map<StoreName, Set<string>>();
      for (const name of storeNames) {
        stagedWrites.set(name, new Map<string, StoredEntry>());
        stagedDeletes.set(name, new Set<string>());
      }

      function stagedGet(store: StoreName, key: RepositoryKey): unknown {
        const identity = keyIdentity(key);
        if (stagedDeletes.get(store)?.has(identity) === true) return undefined;
        if (stagedWrites.get(store)?.has(identity) === true) {
          return stagedWrites.get(store)?.get(identity)?.value;
        }
        return committed.get(store)?.get(identity)?.value;
      }

      function stagedEntries(store: StoreName): { key: RepositoryKey; value: unknown }[] {
        const merged = new Map<string, StoredEntry>();
        for (const [key, value] of committed.get(store) ?? []) merged.set(key, value);
        for (const key of stagedDeletes.get(store) ?? []) merged.delete(key);
        for (const [key, value] of stagedWrites.get(store) ?? []) merged.set(key, value);
        return [...merged.values()].map((entry) => ({
          key: structuredClone(entry.key),
          value: structuredClone(entry.value),
        }));
      }

      function stagedCount(store: StoreName): number {
        const merged = new Set<string>(committed.get(store)?.keys() ?? []);
        for (const key of stagedDeletes.get(store) ?? []) merged.delete(key);
        for (const key of stagedWrites.get(store)?.keys() ?? []) merged.add(key);
        return merged.size;
      }

      function commitStaged(): void {
        for (const name of storeNames) {
          const target = committed.get(name);
          if (target === undefined) continue;
          for (const key of stagedDeletes.get(name) ?? []) target.delete(key);
          for (const [key, value] of stagedWrites.get(name) ?? []) target.set(key, value);
        }
      }

      let requestSucceeded = false;
      const tx: RepositoryTransaction = {
        get: (store: StoreName, key: RepositoryKey): Promise<unknown> => {
          return Promise.resolve(structuredClone(stagedGet(store, key)));
        },
        getAll: (store: StoreName): Promise<readonly { key: RepositoryKey; value: unknown }[]> => {
          return Promise.resolve(stagedEntries(store));
        },
        put: (store: StoreName, key: RepositoryKey, value: unknown): Promise<void> => {
          if (mode !== "readwrite") {
            return Promise.reject(
              persistenceError("STORAGE_ABORTED", "Cannot write inside a readonly transaction."),
            );
          }
          const identity = keyIdentity(key);
          stagedDeletes.get(store)?.delete(identity);
          stagedWrites
            .get(store)
            ?.set(identity, { key: structuredClone(key), value: structuredClone(value) });
          requestSucceeded = true;
          return Promise.resolve();
        },
        delete: (store: StoreName, key: RepositoryKey): Promise<void> => {
          if (mode !== "readwrite") {
            return Promise.reject(
              persistenceError("STORAGE_ABORTED", "Cannot delete inside a readonly transaction."),
            );
          }
          const identity = keyIdentity(key);
          stagedWrites.get(store)?.delete(identity);
          stagedDeletes.get(store)?.add(identity);
          requestSucceeded = true;
          return Promise.resolve();
        },
        count: (store: StoreName): Promise<number> => {
          return Promise.resolve(stagedCount(store));
        },
      };

      return work(tx).then(
        (result) => {
          // Fault injection runs at commit time, after request success, to
          // mirror IndexedDB abort-after-success behavior.
          if (abortAfterSuccess) {
            abortAfterSuccess = false;
            if (!requestSucceeded) {
              return Promise.reject(
                persistenceError("STORAGE_ABORTED", "Injected abort before any request."),
              );
            }
            return Promise.reject(
              persistenceError(
                "STORAGE_ABORTED",
                "Injected abort after request success; nothing was committed.",
              ),
            );
          }
          if (failQuota) {
            failQuota = false;
            return Promise.reject(
              persistenceError("QUOTA_EXCEEDED", "Injected quota failure; nothing was committed."),
            );
          }
          if (failAbort) {
            failAbort = false;
            return Promise.reject(
              persistenceError("STORAGE_ABORTED", "Injected transaction abort."),
            );
          }
          // Commit: apply staged writes atomically. Readonly transactions
          // commit nothing but still resolve through the same path.
          if (mode === "readwrite") {
            commitStaged();
            writes += 1;
          }
          return Promise.resolve(result);
        },
        (error: unknown) => Promise.reject(mapStorageError(error)),
      );
    },
    close(): void {
      closed = true;
    },
  };

  return {
    storage,
    abortAfterRequestSuccessOnce: (): void => {
      abortAfterSuccess = true;
    },
    failNextCommitWithQuotaExceeded: (): void => {
      failQuota = true;
    },
    failNextCommitWithAbort: (): void => {
      failAbort = true;
    },
    committedWriteCount: (): number => writes,
  };
}
