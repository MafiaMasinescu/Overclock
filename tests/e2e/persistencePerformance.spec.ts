import { expect, test } from "@playwright/test";

interface Cohort {
  readonly samples: number;
  readonly warmup: number;
  readonly bytes: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
}

interface PersistencePerformanceResult {
  readonly userAgent: string;
  readonly hardwareConcurrency: number;
  readonly saveN: Cohort;
  readonly autosaveN: Cohort;
  readonly loadN: Cohort;
  readonly previewN: Cohort;
  readonly confirmN: Cohort;
  readonly recoveryN: Cohort;
}

test("normal persistence paths meet their real Worker Chromium budgets", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/tests/e2e/fixtures/workerPersistencePerformanceHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerPersistencePerformance?: unknown })
        .__workerPersistencePerformance !== undefined,
    undefined,
    { timeout: 15_000 },
  );
  const result = await page.evaluate(async () => {
    const harness = (
      window as Window & {
        __workerPersistencePerformance?: {
          run(): Promise<PersistencePerformanceResult>;
          stage?: string;
        };
      }
    ).__workerPersistencePerformance;
    if (harness === undefined) throw new Error("Persistence performance harness is unavailable.");
    try {
      return await harness.run();
    } catch (error) {
      throw new Error(`Failure during ${harness.stage ?? "unknown stage"}: ${String(error)}`, {
        cause: error,
      });
    }
  });

  expect(result.saveN.samples).toBe(200);
  expect(result.saveN.warmup).toBe(20);
  expect(result.autosaveN.samples).toBe(200);
  expect(result.autosaveN.warmup).toBe(20);
  expect(result.loadN.samples).toBe(200);
  expect(result.loadN.warmup).toBe(20);
  expect(result.previewN.samples).toBe(200);
  expect(result.confirmN.samples).toBe(200);
  expect(result.recoveryN.samples).toBe(50);
  expect(result.recoveryN.warmup).toBe(5);
  expect(result.saveN.p95Ms).toBeLessThan(250);
  expect(result.autosaveN.p95Ms).toBeLessThan(250);
  expect(result.loadN.p95Ms).toBeLessThan(500);
  expect(result.previewN.p95Ms).toBeLessThan(1_000);
  expect(result.confirmN.p95Ms).toBeLessThan(250);
  expect(result.recoveryN.p95Ms).toBeLessThan(1_500);
  console.info(`Task 20 persistence N diagnostic: ${JSON.stringify(result)}`);
});
