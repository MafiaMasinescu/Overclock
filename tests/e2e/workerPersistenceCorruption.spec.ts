import { expect, test } from "@playwright/test";

interface WorkerPersistenceCorruptionResult {
  readonly ok: boolean;
  readonly captureSequence?: number;
  readonly skippedCorruptRecords?: number;
  readonly remainingSequences?: readonly number[];
  readonly error?: string;
}

test("real Worker continues autosaving after checksum-corrupt recovery evidence", async ({
  page,
}) => {
  await page.goto("/tests/e2e/fixtures/workerPersistenceCorruptionHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerPersistenceCorruption?: WorkerPersistenceCorruptionResult })
        .__workerPersistenceCorruption !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(
    () =>
      (window as Window & { __workerPersistenceCorruption?: WorkerPersistenceCorruptionResult })
        .__workerPersistenceCorruption ?? null,
  );
  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    captureSequence: 1,
    skippedCorruptRecords: 1,
    remainingSequences: [5, 4, 3, 2],
  });
});
