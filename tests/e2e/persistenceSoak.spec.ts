import { execFileSync } from "node:child_process";
import { platform } from "node:process";

import { expect, test, type Browser, type Page } from "@playwright/test";

interface PersistenceSoakApi {
  startPersistenceSoak(): Promise<{
    readonly activeWorkers: number;
    readonly maximumWorkers: number;
    readonly listeners: number;
  }>;
  samplePersistenceSoak(): Promise<PersistenceSoakSample>;
  finishPersistenceSoak(): {
    readonly cycles: number;
    readonly maximumTimerCount: number;
    readonly listenersAfterDestroy: number;
    readonly terminatedWorkers: number;
    readonly activeWorkersAfterDestroy: number;
    readonly maximumWorkers: number;
    readonly pendingAcksAfterDestroy: number;
  };
}

interface PersistenceSoakSample {
  readonly cycle: number;
  readonly tick: number;
  readonly queueSequence: number;
  readonly timerCount: number;
  readonly maximumTimerCount: number;
  readonly pendingAcks: number;
  readonly heldAcks: number;
  readonly heldRequests: number;
  readonly heldCommands: number;
  readonly activeWorkers: number;
}

interface PerformanceMemorySnapshot {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

const HARNESS_URL = "/tests/e2e/fixtures/workerManualHarness.html";
const SOAK_MINUTES = 60;
const SOAK_SAMPLE_INTERVAL_MS = 60_000;
const MEMORY_BUDGET_BYTES = 500 * 1024 * 1024;

async function openSoakHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(
    () =>
      (window as Window & { __workerManualHarness?: unknown }).__workerManualHarness !== undefined,
  );
  await page.evaluate(() => {
    if (
      (window as Window & { __workerManualHarness?: PersistenceSoakApi }).__workerManualHarness ===
      undefined
    ) {
      throw new Error("Worker soak harness did not initialize.");
    }
  });
}

async function readRendererHeap(page: Page): Promise<PerformanceMemorySnapshot | null> {
  return await page.evaluate(() => {
    const memory: unknown = Reflect.get(performance, "memory") as unknown;
    if (
      memory === null ||
      typeof memory !== "object" ||
      !Number.isSafeInteger(Reflect.get(memory, "usedJSHeapSize")) ||
      !Number.isSafeInteger(Reflect.get(memory, "totalJSHeapSize")) ||
      !Number.isSafeInteger(Reflect.get(memory, "jsHeapSizeLimit"))
    ) {
      return null;
    }
    return {
      usedJSHeapSize: Reflect.get(memory, "usedJSHeapSize") as number,
      totalJSHeapSize: Reflect.get(memory, "totalJSHeapSize") as number,
      jsHeapSizeLimit: Reflect.get(memory, "jsHeapSizeLimit") as number,
    };
  });
}

async function readBrowserWorkingSet(
  browserCdp: Awaited<ReturnType<Browser["newBrowserCDPSession"]>>,
): Promise<{ readonly bytes: number; readonly processCount: number } | null> {
  if (platform !== "win32") return null;
  const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
  const processIds = processInfo.map(({ id }) => id).filter(Number.isSafeInteger);
  if (processIds.length === 0) return null;
  const ids = processIds.join(",");
  const command = `$ids = @(${ids}); $sum = (Get-Process -Id $ids | Measure-Object -Property WorkingSet64 -Sum).Sum; if ($null -eq $sum) { exit 3 }; [Console]::Out.Write([int64]$sum)`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 20_000 },
  ).trim();
  const bytes = Number(output);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Chromium process working-set sample was invalid: ${output}`);
  }
  return { bytes, processCount: processIds.length };
}

function memorySummary(samples: readonly number[]) {
  if (samples.length === 0) return null;
  const meanX = (samples.length - 1) / 2;
  const meanY = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  samples.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  const slopeBytesPerHour = denominator === 0 ? 0 : (numerator / denominator) * SOAK_MINUTES;
  return {
    firstBytes: samples[0],
    lastBytes: samples[samples.length - 1],
    minimumBytes: Math.min(...samples),
    maximumBytes: Math.max(...samples),
    netChangeBytes: (samples[samples.length - 1] ?? 0) - (samples[0] ?? 0),
    leastSquaresSlopeBytesPerHour: slopeBytesPerHour,
    below500MiB: Math.max(...samples) < MEMORY_BUDGET_BYTES,
  };
}

test("measures one real Worker persistence soak sample and confirms clean destruction", async ({
  browser,
  page,
}) => {
  await openSoakHarness(page);
  const started = await page.evaluate(async () => {
    const api = (window as Window & { __workerManualHarness?: PersistenceSoakApi })
      .__workerManualHarness;
    if (api === undefined) throw new Error("Worker soak harness is unavailable.");
    return await api.startPersistenceSoak();
  });
  expect(started).toMatchObject({ activeWorkers: 1, listeners: 3 });
  expect(page.workers()).toHaveLength(1);
  const workerCdp = await browser.newBrowserCDPSession();
  let sample: PersistenceSoakSample | null = null;
  let sampleError: Error | undefined;
  let finished: ReturnType<PersistenceSoakApi["finishPersistenceSoak"]>;
  let workingSetSample: { readonly bytes: number; readonly processCount: number } | null = null;
  try {
    sample = await page.evaluate(async () => {
      const api = (window as Window & { __workerManualHarness?: PersistenceSoakApi })
        .__workerManualHarness;
      if (api === undefined) throw new Error("Worker soak harness is unavailable.");
      return (await api.samplePersistenceSoak()) as PersistenceSoakSample;
    });
    workingSetSample = await readBrowserWorkingSet(workerCdp);
  } catch (error) {
    sampleError =
      error instanceof Error
        ? error
        : new Error("Persistence soak smoke failed.", { cause: error });
  } finally {
    finished = await page.evaluate(() => {
      const api = (window as Window & { __workerManualHarness?: PersistenceSoakApi })
        .__workerManualHarness;
      if (api === undefined) throw new Error("Worker soak harness is unavailable.");
      return api.finishPersistenceSoak() as ReturnType<PersistenceSoakApi["finishPersistenceSoak"]>;
    });
    await workerCdp.detach();
  }
  if (sampleError !== undefined) throw sampleError;
  if (sample === null) throw new Error("Persistence soak smoke did not produce a sample.");
  expect(workingSetSample).not.toBeNull();
  expect(sample).toMatchObject({
    cycle: 1,
    tick: 1,
    queueSequence: 1,
    pendingAcks: 0,
    heldAcks: 0,
    heldRequests: 0,
    heldCommands: 0,
    activeWorkers: 1,
  });
  expect(sample.timerCount).toBeLessThanOrEqual(8);
  const memory = await readRendererHeap(page);
  console.info(
    `Soak smoke sample ${JSON.stringify({ sample, memory, dedicatedWorkers: page.workers().length })}`,
  );
  expect(finished).toMatchObject({
    cycles: 1,
    listenersAfterDestroy: 0,
    terminatedWorkers: 1,
    activeWorkersAfterDestroy: 0,
    pendingAcksAfterDestroy: 0,
  });
});

test("runs the required 60-minute bounded-resource persistence soak", async ({ browser, page }) => {
  test.setTimeout(3_900_000);
  await openSoakHarness(page);
  const started = await page.evaluate(async () => {
    const api = (window as Window & { __workerManualHarness?: PersistenceSoakApi })
      .__workerManualHarness;
    if (api === undefined) throw new Error("Worker soak harness is unavailable.");
    return await api.startPersistenceSoak();
  });
  expect(started).toMatchObject({ activeWorkers: 1, listeners: 3 });
  expect(page.workers()).toHaveLength(1);
  const browserCdp = await browser.newBrowserCDPSession();
  const workingSetSamples: number[] = [];
  const rendererHeapSamples: number[] = [];
  const observed: PersistenceSoakSample[] = [];
  let finished: ReturnType<PersistenceSoakApi["finishPersistenceSoak"]>;
  try {
    for (let minute = 1; minute <= SOAK_MINUTES; minute += 1) {
      await page.waitForTimeout(SOAK_SAMPLE_INTERVAL_MS);
      const sample = await page.evaluate(async () => {
        const api = (window as Window & { __workerManualHarness?: PersistenceSoakApi })
          .__workerManualHarness;
        if (api === undefined) throw new Error("Worker soak harness is unavailable.");
        return (await api.samplePersistenceSoak()) as PersistenceSoakSample;
      });
      expect(sample.cycle).toBe(minute);
      expect(sample.activeWorkers).toBe(1);
      expect(sample.pendingAcks).toBe(0);
      expect(sample.heldAcks).toBe(0);
      expect(sample.heldRequests).toBe(0);
      expect(sample.heldCommands).toBe(0);
      expect(sample.timerCount).toBeLessThanOrEqual(8);
      expect(page.workers()).toHaveLength(1);
      observed.push(sample);

      const workingSet = await readBrowserWorkingSet(browserCdp);
      if (workingSet !== null) workingSetSamples.push(workingSet.bytes);
      const rendererHeap = await readRendererHeap(page);
      if (rendererHeap !== null) rendererHeapSamples.push(rendererHeap.usedJSHeapSize);
      const activeWorker = page.workers()[0];
      const workerHeap =
        activeWorker === undefined
          ? null
          : await activeWorker.evaluate(() => {
              const memory: unknown = Reflect.get(performance, "memory") as unknown;
              if (memory === null || typeof memory !== "object") return null;
              const used = Reflect.get(memory, "usedJSHeapSize") as unknown;
              return typeof used === "number" && Number.isSafeInteger(used) ? used : null;
            });
      console.info(
        `Persistence soak ${minute}/${SOAK_MINUTES} ${JSON.stringify({
          ...sample,
          browserProcessCount: workingSet?.processCount ?? null,
          browserWorkingSetBytes: workingSet?.bytes ?? null,
          rendererHeapBytes: rendererHeap?.usedJSHeapSize ?? null,
          workerHeapBytes: workerHeap ?? null,
        })}`,
      );
    }
  } finally {
    finished = await page.evaluate(() => {
      const api = (window as Window & { __workerManualHarness?: PersistenceSoakApi })
        .__workerManualHarness;
      if (api === undefined) throw new Error("Worker soak harness is unavailable.");
      return api.finishPersistenceSoak() as ReturnType<PersistenceSoakApi["finishPersistenceSoak"]>;
    });
    await browserCdp.detach();
  }

  expect(observed).toHaveLength(SOAK_MINUTES);
  expect(finished).toMatchObject({
    cycles: SOAK_MINUTES,
    listenersAfterDestroy: 0,
    terminatedWorkers: 1,
    activeWorkersAfterDestroy: 0,
    pendingAcksAfterDestroy: 0,
    maximumWorkers: 1,
  });
  await expect.poll(() => page.workers().length).toBe(0);
  const memory = memorySummary(workingSetSamples);
  const rendererMemory = memorySummary(rendererHeapSamples);
  console.info(
    `Persistence soak summary ${JSON.stringify({
      completedMinutes: observed.length,
      maximumTimerCount: finished.maximumTimerCount,
      maximumQueueWaiters: Math.max(
        ...observed.map(
          (sample) =>
            sample.pendingAcks + sample.heldAcks + sample.heldRequests + sample.heldCommands,
        ),
      ),
      chromiumWorkingSet: memory,
      rendererJavaScriptHeap: rendererMemory,
      targetBudgetBytes: MEMORY_BUDGET_BYTES,
      targetBudgetComparison: memory?.below500MiB ?? "not measured",
    })}`,
  );
});
