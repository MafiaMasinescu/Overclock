import { persistenceError } from "../persistenceErrors.ts";
import { SLOT_ID_PATTERN } from "../persistenceLimits.ts";
import { mapStorageError } from "./storage.ts";

// Phase 2 Task 17.2: Web Lock adapter for writer exclusion. Contract §10 is
// normative: the UI acquires `overclock-slot:<slotId>` before an active
// writable session; while another tab holds it, the second tab gets a clear
// busy signal plus read-only listing/export (reads never take the lock); no
// force takeover and no lease timeout exist. A missing Web Locks capability
// is a capability error, never a silent unsafe fallback.

// Narrow structural subset of the platform LockManager used here.
export interface SlotLock {
  readonly name: string;
}

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: SlotLock | null) => Promise<T>,
  ): Promise<T>;
}

export interface SlotLockHandle {
  readonly slotId: string;
  readonly name: string;
  release(): Promise<void>;
}

export interface SlotBusy {
  readonly status: "busy";
  readonly slotId: string;
  readonly name: string;
}

export function slotLockName(slotId: string): string {
  if (!SLOT_ID_PATTERN.test(slotId)) {
    throw persistenceError("INVALID_FORMAT", `Slot id "${slotId}" is not valid.`);
  }
  return `overclock-slot:${slotId}`;
}

function capabilityError(): Error {
  return persistenceError(
    "STORAGE_ABORTED",
    "Web Locks are unavailable; multi-tab writable sessions are unsupported in this environment.",
  );
}

export interface WebLockAdapter {
  readonly available: boolean;
  acquire(
    slotId: string,
    options?: { ifAvailable?: boolean; signal?: AbortSignal },
  ): Promise<SlotLockHandle | SlotBusy>;
}

export function createWebLockAdapter(options?: { locks?: LockManagerLike | null }): WebLockAdapter {
  let candidate: LockManagerLike | null = options?.locks ?? null;
  if (candidate === null && options?.locks === undefined) {
    const navigatorValue: unknown = Reflect.get(globalThis, "navigator");
    const locksValue: unknown =
      navigatorValue !== null && typeof navigatorValue === "object"
        ? Reflect.get(navigatorValue, "locks")
        : null;
    candidate =
      locksValue !== null &&
      typeof locksValue === "object" &&
      typeof (locksValue as LockManagerLike).request === "function"
        ? (locksValue as LockManagerLike)
        : null;
  }
  const locks = candidate;
  return {
    available: locks !== null,
    acquire(
      slotId: string,
      acquireOptions?: { ifAvailable?: boolean; signal?: AbortSignal },
    ): Promise<SlotLockHandle | SlotBusy> {
      const name = slotLockName(slotId);
      if (locks === null) return Promise.reject(capabilityError());
      if (acquireOptions?.signal?.aborted === true) {
        return Promise.reject(persistenceError("CANCELLED", "The lock request was cancelled."));
      }
      // The platform holds the lock while the callback promise is pending,
      // so the grant decision and the hold use two linked promises: the
      // callback reports the grant, and the handle release ends the hold.
      let grant: ((value: boolean) => void) | null = null;
      const granted = new Promise<boolean>((resolve) => {
        grant = resolve;
      });
      let releaseHold: (() => void) | null = null;
      const held = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      const settled = locks.request(
        name,
        {
          mode: "exclusive",
          ...(acquireOptions?.ifAvailable === true ? { ifAvailable: true } : {}),
          ...(acquireOptions?.signal !== undefined ? { signal: acquireOptions.signal } : {}),
        },
        (lock: SlotLock | null): Promise<unknown> => {
          if (lock === null) {
            grant?.(false);
            return Promise.resolve(null);
          }
          grant?.(true);
          return held;
        },
      );
      const decision = Promise.race([
        granted,
        settled.then(
          (): boolean => false,
          (error: unknown): never => {
            // An aborted wait is a cancellation, not a storage failure; any
            // other platform failure keeps its mapped storage code.
            if (acquireOptions?.signal?.aborted === true) {
              throw persistenceError("CANCELLED", "The lock request was cancelled.");
            }
            throw mapStorageError(error);
          },
        ),
      ]);
      return decision.then((wasGranted) => {
        if (!wasGranted) {
          return settled.then((): SlotLockHandle | SlotBusy => ({ status: "busy", slotId, name }));
        }
        let released = false;
        return {
          slotId,
          name,
          release: (): Promise<void> => {
            if (released) return Promise.resolve();
            released = true;
            releaseHold?.();
            return settled.then(
              () => undefined,
              (error: unknown) => Promise.reject(mapStorageError(error)),
            );
          },
        };
      });
    },
  };
}

// In-memory LockManager fake for Node unit tests. Clients model browser
// tabs: closing a client releases every lock it holds and drops its queued
// waiters, mirroring platform release on tab death.
export interface InMemoryLockClient extends LockManagerLike {
  close(): void;
  readonly closed: boolean;
}

interface QueuedWaiter {
  readonly grant: () => void;
  readonly refuse: (error: unknown) => void;
  readonly signal: AbortSignal | undefined;
}

export function createInMemoryLockManager(): { createClient(): InMemoryLockClient } {
  const holders = new Map<string, InMemoryLockClient>();
  const queues = new Map<string, QueuedWaiter[]>();
  const heldByClient = new Map<InMemoryLockClient, Set<string>>();

  function pump(name: string): void {
    if (holders.has(name)) return;
    const queue = queues.get(name);
    const next = queue?.shift();
    if (next === undefined) return;
    const owner = waiterOwners.get(next);
    if (owner === undefined || owner.closed) {
      pump(name);
      return;
    }
    holders.set(name, owner);
    let set = heldByClient.get(owner);
    if (set === undefined) {
      set = new Set<string>();
      heldByClient.set(owner, set);
    }
    set.add(name);
    next.grant();
  }

  const waiterOwners = new Map<QueuedWaiter, InMemoryLockClient>();

  function release(client: InMemoryLockClient, name: string): void {
    if (holders.get(name) !== client) return;
    holders.delete(name);
    heldByClient.get(client)?.delete(name);
    pump(name);
  }

  return {
    createClient(): InMemoryLockClient {
      let closed = false;
      const client: InMemoryLockClient = {
        get closed(): boolean {
          return closed;
        },
        close(): void {
          if (closed) return;
          closed = true;
          for (const name of [...(heldByClient.get(client) ?? [])]) release(client, name);
          for (const [name, queue] of queues) {
            const remaining = queue.filter((waiter) => waiterOwners.get(waiter) !== client);
            if (remaining.length !== queue.length) {
              queues.set(name, remaining);
              for (const waiter of queue) {
                if (waiterOwners.get(waiter) === client) {
                  waiterOwners.delete(waiter);
                  waiter.refuse(new DOMException("AbortError", "AbortError"));
                }
              }
            }
          }
          heldByClient.delete(client);
        },
        request<T>(
          name: string,
          requestOptions: { mode: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal },
          callback: (lock: SlotLock | null) => Promise<T>,
        ): Promise<T> {
          if (closed) {
            return Promise.reject(new DOMException("AbortError", "AbortError"));
          }
          if (requestOptions.signal?.aborted === true) {
            return Promise.reject(new DOMException("AbortError", "AbortError"));
          }
          if (!holders.has(name)) {
            holders.set(name, client);
            let set = heldByClient.get(client);
            if (set === undefined) {
              set = new Set<string>();
              heldByClient.set(client, set);
            }
            set.add(name);
            // The platform invokes the callback asynchronously; defer it so
            // a synchronously throwing test callback still rejects.
            return Promise.resolve()
              .then(() => callback({ name }))
              .finally(() => {
                release(client, name);
              });
          }
          if (requestOptions.ifAvailable === true) {
            return callback(null);
          }
          return new Promise<T>((resolve, reject) => {
            const waiter: QueuedWaiter = {
              grant: (): void => {
                waiterOwners.delete(waiter);
                void Promise.resolve()
                  .then(() => callback({ name }))
                  .then(resolve, reject)
                  .finally(() => {
                    release(client, name);
                  });
              },
              refuse: (error: unknown): void => {
                waiterOwners.delete(waiter);
                reject(error instanceof Error ? error : new Error("Lock request refused."));
              },
              signal: requestOptions.signal,
            };
            waiterOwners.set(waiter, client);
            const queue = queues.get(name) ?? [];
            queue.push(waiter);
            queues.set(name, queue);
            requestOptions.signal?.addEventListener(
              "abort",
              () => {
                const current = queues.get(name) ?? [];
                const index = current.indexOf(waiter);
                if (index >= 0) {
                  current.splice(index, 1);
                  waiterOwners.delete(waiter);
                  waiter.refuse(new DOMException("AbortError", "AbortError"));
                }
              },
              { once: true },
            );
          });
        },
      };
      return client;
    },
  };
}
