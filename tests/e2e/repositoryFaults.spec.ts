import { expect, test, type Page } from "@playwright/test";

// Phase 2 Task 17.4 real-browser fault matrix. Every scenario below drives
// tests/e2e/fixtures/repository-harness.html, which runs the REAL production
// stack in Chromium (real IndexedDB, real Web Locks, native crypto and
// compression). Durations are recorded as informational evidence, not
// target-host budgets; the smoke bound only guards against hangs.

const HARNESS_URL = "/tests/e2e/fixtures/repository-harness.html";
const SMOKE_BOUND_MS = 10_000;

interface HarnessOk {
  readonly ok: true;
  readonly data: Record<string, unknown> & { readonly durationMs: number };
}

interface HarnessFail {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

type HarnessResult = HarnessOk | HarnessFail;

async function call(
  page: Page,
  method: string,
  ...args: readonly unknown[]
): Promise<HarnessResult> {
  const result = await page.evaluate(
    async ([name, parameters]: readonly [string, readonly unknown[]]) => {
      const harness = window.__repoHarness;
      if (harness === undefined) throw new Error("Harness is not ready.");
      const table = harness as unknown as Record<
        string,
        (...callArgs: readonly unknown[]) => Promise<unknown>
      >;
      const fn = table[name];
      if (typeof fn !== "function") throw new Error(`Unknown harness method ${name}.`);
      return (await fn(...parameters)) as HarnessResult;
    },
    [method, args] as readonly [string, readonly unknown[]],
  );
  // Record real-Chromium durations for the permanent Task 17.4 diagnostic;
  // the afterEach hook below attaches them to the test report.
  if (result.ok) {
    const collector = test.info() as unknown as { durations?: Record<string, number> };
    const durations = collector.durations ?? {};
    const existing = Object.keys(durations).filter((key) => key.startsWith(method)).length;
    durations[`${method}#${existing + 1}`] = result.data.durationMs;
    collector.durations = durations;
  }
  return result;
}

function expectOk(result: HarnessResult): Record<string, unknown> {
  if (!result.ok) throw new Error(`Harness failed: ${result.code}: ${result.message}`);
  expect(result.data.durationMs).toBeLessThan(SMOKE_BOUND_MS);
  return result.data;
}

function expectFail(result: HarnessResult): HarnessFail {
  if (result.ok) throw new Error("Harness unexpectedly succeeded.");
  return result;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await expect(page.locator("#repository-harness")).toHaveAttribute("data-ready", "true");
  expectOk(await call(page, "open"));
}

test.afterEach(async () => {
  const collector = test.info() as unknown as { durations?: Record<string, number> };
  if (collector.durations !== undefined) {
    console.log(`chromium-durations ${JSON.stringify(collector.durations)}`);
    await test.info().attach("chromium-durations.json", {
      body: JSON.stringify(collector.durations),
      contentType: "application/json",
    });
  }
});

test("persists verified saves with rotation integrity on real IndexedDB", async ({ page }) => {
  await openHarness(page);

  const roundTrip = expectOk(await call(page, "coreRoundTrip", "slot-real"));
  expect(roundTrip["checksum"]).toBe(roundTrip["expectedChecksum"]);
  expect(roundTrip["revision"]).toBe(1);
  expect(roundTrip["captureSequence"]).toBe(0);
  expect(roundTrip["previewSlotId"]).toBe("slot-real");

  const rotated = expectOk(await call(page, "rotation", "slot-rot"));
  expect(rotated["retained"]).toEqual([4, 3, 2]);
  expect(rotated["pruned"]).toEqual([0, 1]);
  expect(rotated["nextCaptureSequence"]).toBe(5);
  expect(rotated["locator"]).toEqual({ kind: "autosave", captureSequence: 4 });

  const admitted = expectOk(await call(page, "admitAll", "slot-real"));
  expect(admitted["manualTick"]).toBe(0);
  expect(admitted["admitted"]).toBe(1);

  const admittedRot = expectOk(await call(page, "admitAll", "slot-rot"));
  expect(admittedRot["admitted"]).toBe(3);

  await test.info().attach("durations.json", {
    body: JSON.stringify({ roundTrip, rotated }),
    contentType: "application/json",
  });
  expectOk(await call(page, "close"));
});

test("keeps prior generations on quota failure and cancellation", async ({ page }) => {
  await openHarness(page);

  const quota = expectOk(await call(page, "quotaFault", "slot-quota"));
  expect(quota["faultCode"]).toBe("QUOTA_EXCEEDED");
  expect(quota["priorChecksum"]).toBe(quota["firstChecksum"]);
  expect(quota["retryRevision"]).toBe(2);

  const cancelled = await call(page, "cancelledOp", "slot-cancel");
  expect(expectFail(cancelled).code).toBe("CANCELLED");
  expectOk(await call(page, "close"));
});

test("production IndexedDB adapter rolls back after request success", async ({ page }) => {
  await openHarness(page);
  const result = expectOk(await call(page, "abortPlatform"));
  expect(result["errorCode"]).toBe("STORAGE_ABORTED");
  expect(result["committed"]).toBe(false);
  expectOk(await call(page, "close"));
});

test("reloads stored bytes with checksum and admission intact", async ({ page }) => {
  await openHarness(page);
  const before = expectOk(await call(page, "coreRoundTrip", "slot-reload"));
  const rotated = expectOk(await call(page, "rotation", "slot-reload-rot"));

  await page.reload();
  await expect(page.locator("#repository-harness")).toHaveAttribute("data-ready", "true");

  const after = expectOk(await call(page, "reloadVerify", "slot-reload"));
  expect(after["manualChecksum"]).toBe(before["checksum"]);
  expect(after["tick"]).toBe(0);
  expect(after["year"]).toBe(1946);

  const afterRot = expectOk(await call(page, "reloadVerify", "slot-reload-rot"));
  expect(afterRot["manualChecksum"]).toBeNull();
  expect(afterRot["autosaves"]).toEqual([4, 3, 2]);
  expect(afterRot["admitted"]).toBe(3);
  expect(rotated["retained"]).toEqual([4, 3, 2]);
});

test("closes on versionchange and reports blocked upgrades", async ({ page }) => {
  await page.goto(HARNESS_URL);
  await expect(page.locator("#repository-harness")).toHaveAttribute("data-ready", "true");

  // Blocked-race first: the database does not exist yet in this profile.
  const racy = expectOk(await call(page, "openRacy"));
  expect(racy["rawBlockedFired"]).toBe(true);
  expect(racy["shapeGuardCode"]).toBe("UPGRADE_BLOCKED");
  expect(racy["recoveredFresh"]).toBe(true);
  expect(racy["slotCount"]).toBe(0);

  expectOk(await call(page, "open"));
  const faults = expectOk(await call(page, "versionchangeBlocked"));
  expect(faults["versionchangeFired"]).toBe(true);
  expect(faults["mutationCode"]).toBe("STORAGE_ABORTED");
  expect(faults["reopenCode"]).toBe("UPGRADE_BLOCKED");
  expect(faults["reopenedFresh"]).toBe(true);

  // Re-establish the harness stack on the recreated version-1 database.
  expectOk(await call(page, "close"));
  expectOk(await call(page, "open"));
  const roundTrip = expectOk(await call(page, "coreRoundTrip", "slot-after-upgrade"));
  expect(roundTrip["revision"]).toBe(1);
  expectOk(await call(page, "close"));
});

test("excludes a second tab writer until the lock is released", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await openHarness(pageA);
    await openHarness(pageB);

    expectOk(await call(pageA, "createSlot", "slot-tabs"));
    const heldA = expectOk(await call(pageA, "openSession", "slot-tabs", false));
    expect(heldA["status"]).toBe("granted");
    expect(heldA["epoch"]).toBe(1);

    const busyB = expectOk(await call(pageB, "openSession", "slot-tabs", true));
    expect(busyB["status"]).toBe("busy");
    // Reads stay available to the busy tab.
    const metaB = expectOk(await call(pageB, "readMeta", "slot-tabs"));
    expect(metaB["writerEpoch"]).toBe(1);

    const written = expectOk(await call(pageA, "sessionWrite", heldA["sessionId"], "-a1"));
    expect(written["revision"]).toBe(2);
    expectOk(await call(pageA, "sessionClose", heldA["sessionId"]));

    const heldB = expectOk(await call(pageB, "openSession", "slot-tabs", true));
    expect(heldB["status"]).toBe("granted");
    expect(heldB["epoch"]).toBe(2);
    // Revisions: create 0, A rotate 1, A write 2, B rotate 3, B write 4.
    const writtenB = expectOk(await call(pageB, "sessionWrite", heldB["sessionId"], "-b1"));
    expect(writtenB["revision"]).toBe(4);
    expectOk(await call(pageB, "sessionClose", heldB["sessionId"]));

    expectOk(await call(pageA, "close"));
    expectOk(await call(pageB, "close"));
  } finally {
    await context.close();
  }
});

test("page death releases the slot lock and the new epoch fences stale writes", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await openHarness(pageA);
    await openHarness(pageB);
    expectOk(await call(pageA, "createSlot", "slot-tab-death"));
    const heldA = expectOk(await call(pageA, "openSession", "slot-tab-death", false));
    expect(heldA["epoch"]).toBe(1);
    // Navigating away destroys the lock-owning document; closing the page
    // then proves release through browser lifecycle rather than sessionClose.
    await pageA.goto("about:blank");
    await pageA.close();

    const heldBBox: { value: Record<string, unknown> | null } = { value: null };
    await expect
      .poll(
        async () => {
          const attempt = await call(pageB, "openSession", "slot-tab-death", true);
          if (!attempt.ok || attempt.data["status"] !== "granted") return "busy";
          heldBBox.value = attempt.data;
          return "granted";
        },
        { timeout: 10_000 },
      )
      .toBe("granted");
    const heldB = heldBBox.value;
    if (heldB === null) throw new Error("Expected a replacement writer session.");
    expect(heldB["epoch"]).toBe(2);
    const stale = await call(pageB, "directFencedWrite", "slot-tab-death", "-stale", 2, 1);
    expect(expectFail(stale).code).toBe("STALE_WRITER");
    const winner = expectOk(await call(pageB, "sessionWrite", heldB["sessionId"], "-replacement"));
    expect(winner["revision"]).toBe(3);
    expectOk(await call(pageB, "sessionClose", heldB["sessionId"]));
    expectOk(await call(pageB, "close"));
  } finally {
    await context.close();
  }
});

test("imports and exports verified bytes on the real stack", async ({ page }) => {
  await openHarness(page);

  const importer = expectOk(await call(page, "createImporter"));
  const importerId = importer["importerId"] as string;
  const previewed = expectOk(await call(page, "previewBytes", importerId, "-e2e", "slot-external"));
  expect(previewed["compatibility"]).toBe("compatible");
  expect(previewed["migrationRequired"]).toBe(false);
  const confirmed = expectOk(await call(page, "confirmToken", importerId, previewed["token"]));
  const slotId = confirmed["slotId"] as string;
  expect(slotId).not.toBe("slot-external");

  const exported = expectOk(await call(page, "exportBytes", slotId));
  expect(exported["isBytes"]).toBe(true);

  // Exported bytes re-import as compatible on the same stack.
  const importer2 = expectOk(await call(page, "createImporter"));
  const importer2Id = importer2["importerId"] as string;
  const reimported = expectOk(await call(page, "previewBytes", importer2Id, "-e2e", slotId));
  expect(reimported["compatibility"]).toBe("compatible");

  // Settings application commits in the same durable transaction.
  const importer3 = expectOk(await call(page, "createImporter"));
  const importer3Id = importer3["importerId"] as string;
  const previewed3 = expectOk(
    await call(page, "previewBytes", importer3Id, "-settings", "slot-ext3"),
  );
  const applied = expectOk(
    await call(page, "confirmWithSettings", importer3Id, previewed3["token"]),
  );
  expect(applied["settingsRevision"]).toBe(0);
  const settings = expectOk(await call(page, "readSettings"));
  expect(settings["language"]).toBe("en");

  expectOk(await call(page, "close"));
});

test("fails a raced import confirmation loudly and keeps the winner", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await openHarness(pageA);
    await openHarness(pageB);

    expectOk(await call(pageA, "createSlot", "slot-race"));
    const importer = expectOk(await call(pageA, "createImporter"));
    const importerId = importer["importerId"] as string;
    const previewed = expectOk(
      await call(pageA, "previewOverwrite", importerId, "-race", "slot-race"),
    );

    // Tab B commits first through the plain fenced path (same epoch).
    const winner = expectOk(await call(pageB, "directWrite", "slot-race", "-winner"));
    expect(winner["revision"]).toBe(1);

    const raced = await call(pageA, "confirmToken", importerId, previewed["token"], 0);
    expect(expectFail(raced).code).toBe("STALE_REVISION");

    // The winner is intact and the token is retained for an explicit re-preview.
    const stored = expectOk(await call(pageA, "readMeta", "slot-race"));
    expect(stored["revision"]).toBe(1);
    const retry = await call(pageA, "confirmToken", importerId, previewed["token"], 0);
    expect(expectFail(retry).code).toBe("STALE_REVISION");

    expectOk(await call(pageA, "close"));
    expectOk(await call(pageB, "close"));
  } finally {
    await context.close();
  }
});

test("import overwrite cannot bypass another tab's active slot lock", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await openHarness(pageA);
    await openHarness(pageB);
    expectOk(await call(pageA, "createSlot", "slot-import-lock"));
    const session = expectOk(await call(pageA, "openSession", "slot-import-lock", false));
    expect(session["epoch"]).toBe(1);
    const importer = expectOk(await call(pageB, "createImporter"));
    const preview = expectOk(
      await call(pageB, "previewOverwrite", importer["importerId"], "-locked", "slot-import-lock"),
    );
    const blocked = await call(pageB, "confirmToken", importer["importerId"], preview["token"], 1);
    expect(expectFail(blocked).code).toBe("SLOT_BUSY");
    expectOk(await call(pageA, "sessionClose", session["sessionId"]));
    const confirmed = expectOk(
      await call(pageB, "confirmToken", importer["importerId"], preview["token"], 1),
    );
    expect(confirmed["revision"]).toBe(2);
    expectOk(await call(pageA, "close"));
    expectOk(await call(pageB, "close"));
  } finally {
    await context.close();
  }
});
