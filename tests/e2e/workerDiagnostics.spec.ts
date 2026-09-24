import { expect, test } from "@playwright/test";

interface DiagnosticResult {
  host: string;
  fixture: string;
  idleCommandResultP95Ms: number;
  idleCommandSamples: number;
  directTickP95Ms: number;
  directTickSamples: number;
  combinedWorkerTickProjectionP95Ms: number;
  combinedWorkerSamples: number;
  publicationWarmupSingleStepSamples: number;
  publicationWarmupMainClientSamples: number;
  publicationWarmupWorkerPostMessageSamples: number;
  publicationMeasuredSingleStepSamples: number;
  mainClientPublicationSingleStepSamples: number;
  workerPostMessagePublicationSingleStepSamples: number;
  mainClientPublicationP95Ms: number;
  mainClientPublicationSamples: number;
  workerPostMessagePublicationP95Ms: number;
  workerPostMessagePublicationSamples: number;
  foregroundCommandVisibleLatencyP95Ms: number;
  foregroundCommandVisibleLatencySamples: number;
  publicationsProcessed: number;
}

interface WorkerDiagnosticApi {
  runDiagnostics(): Promise<DiagnosticResult>;
  getDiagnosticsProgress(): string;
}

test("Worker and main-thread diagnostics meet the target-host p95 budgets", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/tests/e2e/fixtures/workerManualHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerManualHarness?: WorkerDiagnosticApi }).__workerManualHarness !==
      undefined,
  );
  const diagnosticRun = page.evaluate(async () => {
    const api = (window as Window & { __workerManualHarness?: WorkerDiagnosticApi })
      .__workerManualHarness;
    if (api === undefined) throw new Error("Worker diagnostic harness did not initialize.");
    return await api.runDiagnostics();
  });
  let completed: DiagnosticResult | null = null;
  while (completed === null) {
    const outcome = await Promise.race([
      diagnosticRun.then((value) => ({ kind: "complete" as const, value })),
      page.waitForTimeout(10_000).then(() => ({ kind: "progress" as const })),
    ]);
    if (outcome.kind === "complete") completed = outcome.value as DiagnosticResult;
    else {
      const progress = await page.evaluate(() => {
        const api = (window as Window & { __workerManualHarness?: WorkerDiagnosticApi })
          .__workerManualHarness;
        return api?.getDiagnosticsProgress() ?? "harness unavailable";
      });
      console.info(`Worker diagnostic progress: ${progress}`);
    }
  }
  const result = completed;
  expect(result.idleCommandSamples).toBe(200);
  expect(result.directTickSamples).toBe(500);
  expect(result.combinedWorkerSamples).toBe(500);
  expect(result.publicationWarmupSingleStepSamples).toBe(100);
  expect(result.publicationWarmupMainClientSamples).toBe(100);
  expect(result.publicationWarmupWorkerPostMessageSamples).toBe(100);
  expect(result.publicationMeasuredSingleStepSamples).toBe(500);
  expect(result.mainClientPublicationSingleStepSamples).toBe(500);
  expect(result.workerPostMessagePublicationSingleStepSamples).toBe(500);
  expect(result.mainClientPublicationSamples).toBe(500);
  expect(result.workerPostMessagePublicationSamples).toBe(500);
  expect(result.foregroundCommandVisibleLatencySamples).toBe(200);
  expect(result.idleCommandResultP95Ms).toBeLessThan(10);
  expect(result.directTickP95Ms).toBeLessThan(4);
  expect(result.combinedWorkerTickProjectionP95Ms).toBeLessThan(6);
  expect(result.mainClientPublicationP95Ms).toBeLessThan(5);
  expect(result.foregroundCommandVisibleLatencyP95Ms).toBeLessThan(200);
  console.info(`Worker diagnostics: ${JSON.stringify(result)}`);
});
