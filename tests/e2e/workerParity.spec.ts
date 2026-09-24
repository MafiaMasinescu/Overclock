import { expect, test } from "@playwright/test";

interface ParityResult {
  traceCommands: number;
  queuedReceipts: number;
  workerQueueSequence: number;
  tick12000: { tick: number; year: number; rngState: number; stateHash: string };
  tick24000: { tick: number; year: number; rngState: number; stateHash: string };
  eventKinds: string[];
  finalHash: string;
}

interface WorkerManualApi {
  runParityScenario(): Promise<ParityResult>;
}

test("manual Chromium Worker matches direct SimCore operations through both Campaign years", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/tests/e2e/fixtures/workerManualHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerManualHarness?: WorkerManualApi }).__workerManualHarness !==
      undefined,
  );
  const result = (await page.evaluate(async () => {
    const api = (window as Window & { __workerManualHarness?: WorkerManualApi })
      .__workerManualHarness;
    if (api === undefined) throw new Error("Worker parity harness did not initialize.");
    return await api.runParityScenario();
  })) as ParityResult;
  expect(result).toMatchObject({
    traceCommands: 21,
    tick12000: { tick: 12_000, year: 1947 },
    tick24000: { tick: 24_000, year: 1948 },
    eventKinds: expect.arrayContaining([
      "BENCHMARK_STARTED",
      "BENCHMARK_FAILED",
      "TASK_ACCEPTED",
      "RESEARCH_STARTED",
    ]),
  });
  expect(result.tick12000.stateHash).toMatch(/^[0-9a-f]{16}$/);
  expect(result.tick24000.stateHash).toBe(result.finalHash);
  expect(result.workerQueueSequence).toBe(result.queuedReceipts);
  console.info(`Worker parity: ${JSON.stringify(result)}`);
});
