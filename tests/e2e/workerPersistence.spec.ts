import { expect, test } from "@playwright/test";

interface WorkerPersistenceResult {
  readonly ok: boolean;
  readonly slotId?: string;
  readonly tick?: number;
  readonly nextQueueSequence?: number;
  readonly localStatsPresent?: boolean;
  readonly recoveryHeld?: boolean;
  readonly continuedAfterRecovery?: boolean;
  readonly error?: string;
}

test("real Worker persists a same-tick command boundary with queue continuity", async ({
  page,
}) => {
  await page.goto("/tests/e2e/fixtures/workerPersistenceHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerPersistence?: WorkerPersistenceResult }).__workerPersistence !==
      undefined,
    undefined,
    { timeout: 15_000 },
  );
  const result = await page.evaluate(
    () =>
      (window as Window & { __workerPersistence?: WorkerPersistenceResult }).__workerPersistence ??
      null,
  );
  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    tick: 0,
    nextQueueSequence: 1,
    localStatsPresent: true,
    recoveryHeld: true,
    continuedAfterRecovery: true,
  });
  expect(result?.slotId).toMatch(/^slot-[a-f0-9-]{36}$/);
});
