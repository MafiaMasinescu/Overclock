import { expect, test, type Page } from "@playwright/test";

// Phase 2 Task 18.3 real-browser projection evidence. Every scenario below
// drives tests/e2e/fixtures/projection-harness.html, which runs the REAL
// Task 18 stack in Chromium (content loading, production SimCore commands,
// pure projector, revision-aware publisher, fake transport, immutable
// store). Durations are recorded as informational evidence, not target-host
// budgets; the smoke bound only guards against hangs.

const HARNESS_URL = "/tests/e2e/fixtures/projection-harness.html";
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

async function call(page: Page, method: string): Promise<HarnessResult> {
  const result = await page.evaluate(async (name: string) => {
    const harness = window.__projectionHarness;
    if (harness === undefined) throw new Error("Harness is not ready.");
    const table = harness as unknown as Record<string, () => unknown>;
    const fn = table[name];
    if (typeof fn !== "function") throw new Error(`Unknown harness method ${name}.`);
    return (await fn()) as HarnessResult;
  }, method);
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

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  await page.waitForSelector("#projection-harness[data-ready='true']");
});

test("full round trip adopts owned grid and snapshot in Chromium", async ({ page }) => {
  const data = expectOk(await call(page, "roundTrip"));
  expect(data["gridRevision"]).toBe(1);
  expect(data["heatTiles"]).toBe(384);
  expect(data["tick"]).toBe(0);
  expect(data["mode"]).toBe("draft");
  expect(data["modules"]).toBe(1);
  expect(data["buildDesignMode"]).toBe(true);
  expect(data["headerYear"]).toBe(1946);
  expect(data["status"]).toBe("live");
});

test("snapshot-only changes preserve equal sections in Chromium", async ({ page }) => {
  const data = expectOk(await call(page, "snapshotOnly"));
  expect(data["tasks"]).toBe(1);
  expect(data["headerPreserved"]).toBe(true);
  expect(data["rootChanged"]).toBe(true);
  expect(data["gridRevision"]).toBe(1);
});

test("forged base applies nothing in Chromium", async ({ page }) => {
  const data = expectOk(await call(page, "wrongBase"));
  expect(data["gridRevision"]).toBe(1);
});

test("foreign epoch is rejected in Chromium", async ({ page }) => {
  const data = expectOk(await call(page, "staleEpoch"));
  expect(data["status"]).toBe("live");
});

test("sub-epsilon drift accumulates across acknowledgements in Chromium", async ({ page }) => {
  const data = expectOk(await call(page, "drift"));
  expect(data["first"]).toBe(384);
  expect(data["drifted"]).toBe(0);
  expect(data["due"]).toBe(1);
});

test("twenty subscribe cycles leak nothing in Chromium", async ({ page }) => {
  const data = expectOk(await call(page, "twentyCycles"));
  expect(data["subscriptions"]).toBe(0);
});
