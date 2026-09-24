import { expect, test, type Page } from "@playwright/test";

interface ResyncResult {
  heldAcknowledgement: number;
  degradedNotices: number;
  fullResyncPublications: number;
  finalStatus: string;
}

interface DestroyCyclesResult {
  cycles: number;
  counts: { listenersAfterDestroy: number; terminatedWorkers: number }[];
}

interface WorkerManualApi {
  runResyncScenario(): Promise<ResyncResult>;
  runFailureScenario(kind: "host-fatal" | "crash" | "messageerror"): Promise<{
    kind: string;
    errorCode: string;
    terminatedWorkers: number;
  }>;
  runDestroyCycles(): Promise<DestroyCyclesResult>;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/tests/e2e/fixtures/workerManualHarness.html");
  await page.waitForFunction(
    () =>
      (window as Window & { __workerManualHarness?: WorkerManualApi }).__workerManualHarness !==
      undefined,
  );
}

test("real Worker recovers from a delayed publication ACK with a full resync", async ({ page }) => {
  test.setTimeout(30_000);
  await openHarness(page);
  const result = (await page.evaluate(async () => {
    const api = (window as Window & { __workerManualHarness?: WorkerManualApi })
      .__workerManualHarness;
    if (api === undefined) throw new Error("Worker lifecycle harness did not initialize.");
    return await api.runResyncScenario();
  })) as ResyncResult;
  expect(result).toMatchObject({
    heldAcknowledgement: 1,
    degradedNotices: 1,
    finalStatus: "live",
  });
  expect(result.fullResyncPublications).toBeGreaterThanOrEqual(1);
});

for (const [kind, errorCode] of [
  ["host-fatal", "OUTCOME_UNKNOWN"],
  ["crash", "WORKER_ERROR"],
  ["messageerror", "WORKER_ERROR"],
] as const) {
  test(`${kind} settles the pending result and terminates its Worker`, async ({ page }) => {
    test.setTimeout(30_000);
    await openHarness(page);
    const result = await page.evaluate(async (failureKind) => {
      const api = (window as Window & { __workerManualHarness?: WorkerManualApi })
        .__workerManualHarness;
      if (api === undefined) throw new Error("Worker lifecycle harness did not initialize.");
      return await api.runFailureScenario(failureKind);
    }, kind);
    expect(result).toEqual({ kind, errorCode, terminatedWorkers: 1 });
  });
}

test("twenty real Worker client destroy cycles release listeners and terminate each Worker", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await openHarness(page);
  const result = (await page.evaluate(async () => {
    const api = (window as Window & { __workerManualHarness?: WorkerManualApi })
      .__workerManualHarness;
    if (api === undefined) throw new Error("Worker lifecycle harness did not initialize.");
    return await api.runDestroyCycles();
  })) as DestroyCyclesResult;
  expect(result.cycles).toBe(20);
  expect(result.counts).toHaveLength(20);
  expect(
    result.counts.every(
      (entry) => entry.listenersAfterDestroy === 0 && entry.terminatedWorkers === 1,
    ),
  ).toBe(true);
});
