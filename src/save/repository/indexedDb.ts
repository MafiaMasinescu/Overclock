import { persistenceError } from "../persistenceErrors.ts";
import { mapStorageError, throwIfCancelled } from "./storage.ts";
import type {
  RepositoryStorage,
  RepositoryTransaction,
  RepositoryKey,
  StoreName,
  TransactionMode,
} from "./storage.ts";
import { OVERCLOCK_DB_NAME, OVERCLOCK_DB_VERSION } from "./types.ts";

// Phase 2 Task 17.1: real IndexedDB adapter. Contract §10 is normative:
// hashing/compression/validation are prepared before a readwrite
// transaction opens; no async crypto or arbitrary await runs inside the
// live transaction; success resolves only on transaction completion, never
// on single-request success; versionchange closes the connection and
// blocks further mutations until reopened; an aborted upgrade preserves
// prior stores; the database is never deleted to recover an error.

const ALL_STORES: readonly StoreName[] = [
  "saves",
  "autosaves",
  "slotMeta",
  "settings",
  "reports",
  "blueprints",
];

export interface OpenDatabaseHooks {
  readonly onBlocked?: () => void;
  readonly onVersionChange?: () => void;
  readonly signal?: AbortSignal;
}

function getFactory(): IDBFactory {
  const factory: unknown = Reflect.get(globalThis, "indexedDB");
  if (
    factory === null ||
    typeof factory !== "object" ||
    typeof (factory as IDBFactory).open !== "function"
  ) {
    throw persistenceError("STORAGE_ABORTED", "IndexedDB is unavailable in this environment.");
  }
  return factory as IDBFactory;
}

function createMissingStores(database: IDBDatabase): void {
  // Additive only: create stores that do not exist yet, never delete or
  // reshape existing ones, so an aborted upgrade keeps prior data intact.
  for (const name of ALL_STORES) {
    if (!database.objectStoreNames.contains(name)) {
      if (name === "autosaves") {
        database.createObjectStore(name, { keyPath: ["slotId", "captureSequence"] });
      } else {
        database.createObjectStore(name);
      }
    }
  }
}

function hasAutosaveCompoundKey(database: IDBDatabase): boolean {
  try {
    const keyPath = database
      .transaction(["autosaves"], "readonly")
      .objectStore("autosaves").keyPath;
    return (
      Array.isArray(keyPath) &&
      keyPath.length === 2 &&
      keyPath[0] === "slotId" &&
      keyPath[1] === "captureSequence"
    );
  } catch {
    return false;
  }
}

function requestToPromise<T>(request: IDBRequest<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    throwIfCancelled(signal);
    request.onsuccess = (): void => {
      // Request success is NOT durability: the caller must still wait for
      // transaction.oncomplete before resolving the mutation.
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(mapStorageError(request.error));
    };
  });
}

export function openOverclockDatabase(hooks: OpenDatabaseHooks = {}): Promise<RepositoryStorage> {
  const factory = getFactory();
  throwIfCancelled(hooks.signal);
  return new Promise<RepositoryStorage>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(mapStorageError(error));
      }
    };
    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = factory.open(OVERCLOCK_DB_NAME, OVERCLOCK_DB_VERSION);
    } catch (error: unknown) {
      fail(error);
      return;
    }
    openRequest.onupgradeneeded = (): void => {
      try {
        createMissingStores(openRequest.result);
      } catch (error: unknown) {
        // An upgrade exception aborts the versionchange transaction and
        // preserves the previous stores; surfacing here keeps that abort.
        try {
          openRequest.transaction?.abort();
        } catch {
          // The original upgrade failure remains authoritative.
        }
        fail(error);
      }
    };
    openRequest.onsuccess = (): void => {
      if (settled) {
        openRequest.result.close();
        return;
      }
      settled = true;
      const database = openRequest.result;
      // A current-version database without our stores is foreign or left
      // behind by an aborted foreign upgrade: refuse it with a typed error
      // instead of failing mid-transaction with NotFoundError, and never
      // reshape or delete it here.
      const missing = ALL_STORES.filter((name) => !database.objectStoreNames.contains(name));
      const invalidAutosaveKey = missing.length === 0 && !hasAutosaveCompoundKey(database);
      if (missing.length > 0 || invalidAutosaveKey) {
        try {
          database.close();
        } catch {
          // Closing is best-effort; the typed failure below is what matters.
        }
        reject(
          persistenceError(
            "UPGRADE_BLOCKED",
            invalidAutosaveKey
              ? "The autosave store does not use the required compound key."
              : `The database schema is incomplete; missing stores: ${missing.join(", ")}.`,
          ),
        );
        return;
      }
      let closed = false;
      database.onversionchange = (): void => {
        // Another connection requested an upgrade: close promptly and stop
        // admitting mutations until the owner reopens.
        closed = true;
        try {
          database.close();
        } finally {
          hooks.onVersionChange?.();
        }
      };
      const storage: RepositoryStorage = {
        runTransaction<T>(
          stores: readonly StoreName[],
          mode: TransactionMode,
          work: (tx: RepositoryTransaction) => Promise<T>,
        ): Promise<T> {
          throwIfCancelled(hooks.signal);
          if (closed) {
            return Promise.reject(
              persistenceError(
                "STORAGE_ABORTED",
                "The database connection closed after a versionchange; reopen before mutating.",
              ),
            );
          }
          let transaction: IDBTransaction;
          try {
            transaction = database.transaction([...stores], mode);
          } catch (error: unknown) {
            return Promise.reject(mapStorageError(error));
          }
          // Transaction outcome is the durability boundary: resolve only on
          // complete, reject on abort, regardless of request outcomes. The
          // work promise settles before oncomplete (requests finish first),
          // so capturing its result here is race-free.
          return new Promise<T>((resolveTx, rejectTx) => {
            let workResult: T | undefined;
            let workSettled = false;
            let workFailed: unknown = null;
            let hasWorkFailure = false;
            transaction.oncomplete = (): void => {
              if (hasWorkFailure) {
                rejectTx(mapStorageError(workFailed));
                return;
              }
              if (!workSettled) {
                rejectTx(
                  persistenceError(
                    "STORAGE_ABORTED",
                    "The transaction completed before its work settled.",
                  ),
                );
                return;
              }
              resolveTx(workResult as T);
            };
            transaction.onabort = (): void => {
              if (hasWorkFailure) {
                rejectTx(mapStorageError(workFailed));
                return;
              }
              rejectTx(
                mapStorageError(transaction.error ?? new DOMException("AbortError", "AbortError")),
              );
            };
            transaction.onerror = (): void => {
              // Without preventDefault the platform aborts the transaction
              // and onabort settles the outcome; no direct reject here to
              // keep exactly one settlement path per failure.
            };
            const tx: RepositoryTransaction = {
              get: (store: StoreName, key: RepositoryKey): Promise<unknown> => {
                try {
                  const request = transaction.objectStore(store).get(key);
                  return requestToPromise(request, hooks.signal);
                } catch (error: unknown) {
                  return Promise.reject(mapStorageError(error));
                }
              },
              getAll: (
                store: StoreName,
              ): Promise<readonly { key: RepositoryKey; value: unknown }[]> => {
                try {
                  const objectStore = transaction.objectStore(store);
                  const keysRequest = objectStore.getAllKeys();
                  const valuesRequest = objectStore.getAll();
                  return Promise.all([
                    requestToPromise(keysRequest, hooks.signal),
                    requestToPromise(valuesRequest, hooks.signal),
                  ]).then(([keys, values]) => {
                    const keyList = keys as readonly unknown[];
                    const valueList = values as readonly unknown[];
                    return keyList.map((key, index) => ({
                      key: structuredClone(key) as RepositoryKey,
                      value: valueList[index],
                    }));
                  });
                } catch (error: unknown) {
                  return Promise.reject(mapStorageError(error));
                }
              },
              put: (store: StoreName, key: RepositoryKey, value: unknown): Promise<void> => {
                try {
                  const request =
                    store === "autosaves"
                      ? transaction.objectStore(store).put(value)
                      : transaction.objectStore(store).put(value, key);
                  return requestToPromise(request, hooks.signal).then(() => undefined);
                } catch (error: unknown) {
                  return Promise.reject(mapStorageError(error));
                }
              },
              delete: (store: StoreName, key: RepositoryKey): Promise<void> => {
                try {
                  const request = transaction.objectStore(store).delete(key);
                  return requestToPromise(request, hooks.signal).then(() => undefined);
                } catch (error: unknown) {
                  return Promise.reject(mapStorageError(error));
                }
              },
              count: (store: StoreName): Promise<number> => {
                try {
                  const request = transaction.objectStore(store).count();
                  return requestToPromise<number>(request, hooks.signal);
                } catch (error: unknown) {
                  return Promise.reject(mapStorageError(error));
                }
              },
            };
            // Run the work; a work failure aborts the transaction and the
            // onabort handler above settles the outcome with that failure.
            // Never resolve here: durability waits for oncomplete.
            work(tx).then(
              (result) => {
                workResult = result;
                workSettled = true;
              },
              (error: unknown) => {
                hasWorkFailure = true;
                workFailed = error;
                try {
                  transaction.abort();
                } catch {
                  // Already finishing; onabort/oncomplete will settle.
                }
              },
            );
          });
        },
        close(): void {
          closed = true;
          try {
            database.close();
          } catch {
            // Closing an already closed connection is a no-op for callers.
          }
        },
      };
      resolve(storage);
    };
    openRequest.onerror = (): void => {
      const error = openRequest.error;
      if (error instanceof DOMException && error.name === "VersionError") {
        hooks.onBlocked?.();
        fail(
          persistenceError("UPGRADE_BLOCKED", "The database upgrade is blocked; close other tabs."),
        );
        return;
      }
      fail(error ?? persistenceError("STORAGE_ABORTED", "Opening the database failed."));
    };
    openRequest.onblocked = (): void => {
      // Blocked upgrades surface an actionable message instead of hanging.
      hooks.onBlocked?.();
    };
  });
}
