import { expect, test } from "@playwright/test";

// Phase 2 Task 17.2 platform evidence: the repository's writer exclusion
// rests on two Chromium primitives (exclusive Web Locks, IndexedDB commit
// durability). This spec proves the primitives behave across two real
// browser contexts and across a reload. The adapter logic itself is covered
// in tests/unit/saveWriterSessions.test.ts against a faithful fake; the
// full adapter-on-real-IDB matrix belongs to the Task 17.4 fault matrix.

test("exclusive slot locks exclude a second tab until release", async ({ browser }) => {
  // Two tabs share one storage partition (one context); two separate
  // contexts are isolated partitions, like two browser profiles, where
  // exclusion is neither expected nor required.
  const context = await browser.newContext();
  try {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await pageA.goto("/");
    await pageB.goto("/");

    const locksAvailable = await pageA.evaluate(
      () => "locks" in navigator && typeof navigator.locks.request === "function",
    );
    expect(locksAvailable).toBe(true);

    const lockName = "overclock-slot:e2e-probe";
    // Tab A holds the lock with a pending callback promise.
    await pageA.evaluate((name: string) => {
      const holder = globalThis as unknown as { releaseProbe?: (() => void) | undefined };
      holder.releaseProbe = undefined;
      void navigator.locks.request(name, { mode: "exclusive" }, () => {
        return new Promise<void>((resolve) => {
          holder.releaseProbe = resolve;
        });
      });
    }, lockName);
    await pageA.waitForFunction(
      (name: string) =>
        navigator.locks
          .query()
          .then((snapshot) => snapshot.held?.some((info) => info.name === name) ?? false),
      lockName,
    );

    // Tab B sees busy with a nonblocking request, mirroring the repository
    // adapter's ifAvailable path; reads (like locks.query here) stay available.
    const busyResult = await pageB.evaluate(
      (name: string) =>
        navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, (lock) =>
          lock === null ? "busy" : "granted",
        ),
      lockName,
    );
    expect(busyResult).toBe("busy");
    const queryWorks = await pageB.evaluate(() =>
      navigator.locks.query().then((snapshot) => Array.isArray(snapshot.held)),
    );
    expect(queryWorks).toBe(true);

    await pageA.evaluate(() => {
      const holder = globalThis as unknown as { releaseProbe?: (() => void) | undefined };
      holder.releaseProbe?.();
    });
    await pageA.waitForFunction(
      (name: string) =>
        navigator.locks
          .query()
          .then((snapshot) => !(snapshot.held?.some((info) => info.name === name) ?? false)),
      lockName,
    );
    const grantedResult = await pageB.evaluate(
      (name: string) =>
        navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, (lock) =>
          lock === null ? "busy" : "granted",
        ),
      lockName,
    );
    expect(grantedResult).toBe("granted");
  } finally {
    await context.close();
  }
});

test("indexeddb commits survive a page reload", async ({ page }) => {
  await page.goto("/");
  const databaseName = "overclock-e2e-probe";

  const written = await page.evaluate(async (name: string) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("probe")) {
          request.result.createObjectStore("probe");
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("indexeddb request failed"));
      };
    });
    try {
      // Durability waits for transaction completion, mirroring the
      // repository adapter rule that request success is not enough.
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(["probe"], "readwrite");
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = () => {
          reject(transaction.error ?? new Error("abort"));
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error("error"));
        };
        transaction.objectStore("probe").put({ value: 42 }, "answer");
      });
    } finally {
      database.close();
    }
    return true;
  }, databaseName);
  expect(written).toBe(true);

  await page.reload();
  const readBack = await page.evaluate(async (name: string) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("indexeddb request failed"));
      };
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(["probe"], "readonly");
        const request = transaction.objectStore("probe").get("answer");
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("indexeddb request failed"));
        };
      });
    } finally {
      database.close();
    }
  }, databaseName);
  expect(readBack).toEqual({ value: 42 });

  // The probe database is test-only scaffolding, not application data.
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("indexeddb request failed"));
      };
    });
  }, databaseName);
});
