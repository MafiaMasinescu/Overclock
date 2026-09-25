import { expect, test } from "@playwright/test";

interface PersistenceReplayResult {
  readonly ok: boolean;
  readonly savedTick?: number;
  readonly savedQueueSequence?: number;
  readonly suffixEntries?: number;
  readonly directFinalTick?: number;
  readonly recoveredFinalTick?: number;
  readonly directFinalHash?: string;
  readonly recoveredFinalHash?: string;
  readonly error?: string;
}

interface WorkerManualHarness {
  runPersistenceReplayScenario(): Promise<PersistenceReplayResult>;
  getPersistenceReplayProgress(): string;
}

test("real Worker saves mid-Replay and continues the exact suffix after durable recovery", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/tests/e2e/fixtures/workerManualHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerManualHarness?: WorkerManualHarness }).__workerManualHarness !==
      undefined,
  );
  const scenario = page.evaluate(async () => {
    const harness = (window as Window & { __workerManualHarness?: WorkerManualHarness })
      .__workerManualHarness;
    if (harness?.runPersistenceReplayScenario === undefined) {
      throw new Error("Mid-Replay persistence scenario is unavailable.");
    }
    return await harness.runPersistenceReplayScenario();
  });
  let lastProgress = "";
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const progress = await page.evaluate(
      () =>
        (
          window as Window & { __workerManualHarness?: WorkerManualHarness }
        ).__workerManualHarness?.getPersistenceReplayProgress() ?? "unavailable",
    );
    if (progress !== lastProgress) {
      lastProgress = progress;
      console.info(`Mid-Replay persistence progress: ${progress}`);
    }
    const settled = await Promise.race([
      scenario.then(
        () => true,
        () => true,
      ),
      page.waitForTimeout(1_000).then(() => false),
    ]);
    if (settled) break;
  }
  const result = await scenario;

  expect(result).toMatchObject({ ok: true });
  expect(result.savedTick).toBeGreaterThan(0);
  expect(result.savedQueueSequence).toBeGreaterThan(0);
  expect(result.suffixEntries).toBeGreaterThan(0);
  expect(result.recoveredFinalTick).toBe(result.directFinalTick);
  expect(result.recoveredFinalHash).toMatch(/^[0-9a-f]{16}$/);
  expect(result.recoveredFinalHash).toBe(result.directFinalHash);
});
