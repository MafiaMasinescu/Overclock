import { afterEach, describe, expect, test } from "vitest";

import { openOverclockDatabase } from "../../src/save/repository/indexedDb.ts";

// Narrow structural stubs for the platform IndexedDB factory. They drive
// only the open-level wiring (upgrade creation, blocked/versionchange
// hooks, version errors, schema-shape guard); transaction lifetime is proven
// against real Chromium in tests/e2e/repositoryFaults.spec.ts.

interface StubOpenRequest {
  onupgradeneeded: ((event: unknown) => void) | null;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onblocked: ((event: unknown) => void) | null;
  result: StubDatabase;
  error: DOMException | null;
  transaction: { abort(): void; abortCalls: number } | null;
}

interface StubDatabase {
  closedCalls: number;
  created: string[];
  createdKeyPaths: Record<string, string | readonly string[] | null>;
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: IDBObjectStoreParameters): void;
  transaction(
    storeNames: string[],
    mode: IDBTransactionMode,
  ): {
    objectStore(name: string): { keyPath: string | readonly string[] | null };
  };
  close(): void;
  onversionchange: ((event: unknown) => void) | null;
}

function makeDatabase(existing: readonly string[], failOnStore?: string): StubDatabase {
  const stores = new Set<string>(existing);
  return {
    closedCalls: 0,
    created: [],
    createdKeyPaths: {},
    objectStoreNames: { contains: (name: string): boolean => stores.has(name) },
    createObjectStore(name: string, options?: IDBObjectStoreParameters): void {
      if (name === failOnStore) throw new DOMException("Injected upgrade failure", "AbortError");
      this.created.push(name);
      this.createdKeyPaths[name] = options?.keyPath ?? null;
      stores.add(name);
    },
    transaction() {
      return {
        objectStore: (name: string) => ({
          keyPath:
            name === "autosaves"
              ? Object.prototype.hasOwnProperty.call(this.createdKeyPaths, name)
                ? (this.createdKeyPaths[name] ?? null)
                : ["slotId", "captureSequence"]
              : null,
        }),
      };
    },
    close(): void {
      this.closedCalls += 1;
    },
    onversionchange: null,
  };
}

function makeRequest(database: StubDatabase): StubOpenRequest {
  const transaction = {
    abortCalls: 0,
    abort(): void {
      this.abortCalls += 1;
    },
  };
  return {
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
    result: database,
    error: null,
    transaction,
  };
}

const originalIndexedDB: unknown = Reflect.get(globalThis, "indexedDB");

function installStub(open: (name: string, version: number) => StubOpenRequest): {
  calls: { name: string; version: number }[];
  requests: StubOpenRequest[];
} {
  const calls: { name: string; version: number }[] = [];
  const requests: StubOpenRequest[] = [];
  const factory = {
    open: (name: string, version: number): IDBOpenDBRequest => {
      calls.push({ name, version });
      const request = open(name, version);
      requests.push(request);
      return request as unknown as IDBOpenDBRequest;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    value: factory,
    configurable: true,
    writable: true,
  });
  return { calls, requests };
}

afterEach(() => {
  if (originalIndexedDB === undefined) {
    Reflect.deleteProperty(globalThis, "indexedDB");
  } else {
    Object.defineProperty(globalThis, "indexedDB", {
      value: originalIndexedDB,
      configurable: true,
      writable: true,
    });
  }
});

function fireSuccess(request: StubOpenRequest): void {
  request.onsuccess?.({});
}

describe("indexeddb open wiring", () => {
  test("opens version 1 of the overclock database and creates missing stores", async () => {
    const database = makeDatabase([]);
    const { calls, requests } = installStub(() => makeRequest(database));
    const pending = openOverclockDatabase();
    expect(calls).toEqual([{ name: "overclock", version: 1 }]);
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    // Upgrade path first: missing stores are created additively.
    request.onupgradeneeded?.({});
    expect(database.created).toEqual([
      "saves",
      "autosaves",
      "slotMeta",
      "settings",
      "reports",
      "blueprints",
    ]);
    expect(database.createdKeyPaths["autosaves"]).toEqual(["slotId", "captureSequence"]);
    fireSuccess(request);
    const storage = await pending;
    expect(storage).toBeDefined();
    storage.close();
    expect(database.closedCalls).toBe(1);
  });

  test("aborts a partially-created schema when store creation fails", async () => {
    const database = makeDatabase([], "slotMeta");
    const { requests } = installStub(() => makeRequest(database));
    const pending = openOverclockDatabase();
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    request.onupgradeneeded?.({});
    await expect(pending).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    expect(database.created).toEqual(["saves", "autosaves"]);
    expect(request.transaction?.abortCalls).toBe(1);
  });

  test("forwards the blocked event to the hook", async () => {
    const database = makeDatabase([
      "saves",
      "autosaves",
      "slotMeta",
      "settings",
      "reports",
      "blueprints",
    ]);
    const { requests } = installStub(() => makeRequest(database));
    let blockedCalls = 0;
    const pending = openOverclockDatabase({
      onBlocked: () => {
        blockedCalls += 1;
      },
    });
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    request.onblocked?.({});
    fireSuccess(request);
    await pending;
    expect(blockedCalls).toBe(1);
  });

  test("maps a version error to a blocked upgrade with the hook", async () => {
    const database = makeDatabase([]);
    const { requests } = installStub(() => makeRequest(database));
    let blockedCalls = 0;
    const pending = openOverclockDatabase({
      onBlocked: () => {
        blockedCalls += 1;
      },
    });
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    request.error = new DOMException("Upgrade needed", "VersionError");
    request.onerror?.({});
    await expect(pending).rejects.toMatchObject({ code: "UPGRADE_BLOCKED" });
    expect(blockedCalls).toBe(1);
  });

  test("refuses a current-version database with missing stores untouched", async () => {
    const database = makeDatabase(["saves"]);
    // No upgrade fires (version already current): the success path must
    // refuse the misshapen database instead of failing mid-transaction.
    const { requests } = installStub(() => makeRequest(database));
    const pending = openOverclockDatabase();
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    fireSuccess(request);
    await expect(pending).rejects.toMatchObject({ code: "UPGRADE_BLOCKED" });
    expect(database.created).toEqual([]);
    expect(database.closedCalls).toBe(1);
  });

  test("refuses a current-version autosave store with the obsolete string key", async () => {
    const database = makeDatabase([
      "saves",
      "autosaves",
      "slotMeta",
      "settings",
      "reports",
      "blueprints",
    ]);
    database.createdKeyPaths["autosaves"] = null;
    const { requests } = installStub(() => makeRequest(database));
    const pending = openOverclockDatabase();
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    fireSuccess(request);
    await expect(pending).rejects.toMatchObject({ code: "UPGRADE_BLOCKED" });
    expect(database.closedCalls).toBe(1);
  });

  test("closes on versionchange and refuses further mutations", async () => {
    const database = makeDatabase([
      "saves",
      "autosaves",
      "slotMeta",
      "settings",
      "reports",
      "blueprints",
    ]);
    const { requests } = installStub(() => makeRequest(database));
    let versionChangeCalls = 0;
    const pending = openOverclockDatabase({
      onVersionChange: () => {
        versionChangeCalls += 1;
      },
    });
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one open request.");
    fireSuccess(request);
    const storage = await pending;
    database.onversionchange?.({});
    expect(versionChangeCalls).toBe(1);
    await expect(
      storage.runTransaction(["slotMeta"], "readonly", (tx) => tx.count("slotMeta")),
    ).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
  });
});
