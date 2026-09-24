import { expect, test } from "@playwright/test";

interface WorkerSmokeResult {
  readonly ok: boolean;
  readonly tick?: number;
  readonly publicationApplied?: boolean;
  readonly commandAccepted?: boolean;
  readonly paused?: boolean;
  readonly error?: string;
}

test("real GameClient Worker executes a command and publishes its snapshot in Chromium", async ({
  page,
}) => {
  await page.goto("/tests/e2e/fixtures/workerBootstrapHarness.html");
  await page.waitForFunction(
    () => (window as Window & { __workerSmoke?: WorkerSmokeResult }).__workerSmoke !== undefined,
    undefined,
    { timeout: 15_000 },
  );
  const result = await page.evaluate(
    () => (window as Window & { __workerSmoke?: WorkerSmokeResult }).__workerSmoke ?? null,
  );
  expect(result).toEqual({
    ok: true,
    tick: 0,
    publicationApplied: true,
    commandAccepted: true,
    paused: false,
  });
});
