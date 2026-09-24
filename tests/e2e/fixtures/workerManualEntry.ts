import { loadWorkerManualFixtureContent } from "./workerManualFixtureContent.ts";
import { hashCanonicalState } from "../../../src/sim/replay/canonicalState.ts";
import {
  createSimWorkerHost,
  type HostTimingAdapter,
} from "../../../src/app/worker/simWorkerHost.ts";
import type { WorkerReply } from "../../../src/app/worker/protocol.ts";
import { createWorkerNFixture } from "../../performance/workerNFixture.ts";
import { SimCore, type StepResult } from "../../../src/sim/core/simCore.ts";

let observedCoreTickCount = 0;
let activeScheduledWakeId: number | null = null;
let activeScheduledWakeCoreStepCount = 0;
function isCoreStep(value: unknown): value is (this: SimCore, ticks?: number) => StepResult {
  return typeof value === "function";
}
const originalCoreStepValue: unknown = Object.getOwnPropertyDescriptor(
  SimCore.prototype,
  "step",
)?.value;
if (!isCoreStep(originalCoreStepValue))
  throw new Error("SimCore.step is unavailable for diagnostics.");
SimCore.prototype.step = function (ticks?: number): StepResult {
  const ticksToRun = ticks ?? 1;
  observedCoreTickCount += ticksToRun;
  if (activeScheduledWakeId !== null) activeScheduledWakeCoreStepCount += ticksToRun;
  return Reflect.apply(originalCoreStepValue, this, [ticks]);
};

interface ManualTimer {
  readonly id: number;
  due: number;
  readonly delayMs: number;
  readonly callback: () => void;
  nativeHandle?: ReturnType<typeof globalThis.setTimeout>;
}

interface DueWakeSample {
  readonly wakeId: number;
  readonly durationMs: number;
  readonly coreStepCount: number;
}

interface PublicationPostSample {
  readonly publicationSequence: number;
  readonly wakeId: number | null;
  readonly coreStepCount: number;
  readonly durationMs: number;
}

type TestControl =
  | {
      readonly __workerTestControl: true;
      readonly id: string;
      readonly kind: "ADVANCE_WAKES";
      readonly count: number;
    }
  | {
      readonly __workerTestControl: true;
      readonly id: string;
      readonly kind: "ADVANCE_BURSTS";
      readonly count: number;
    }
  | {
      readonly __workerTestControl: true;
      readonly id: string;
      readonly kind: "ADVANCE_ALL";
      readonly milliseconds: number;
    }
  | { readonly __workerTestControl: true; readonly id: string; readonly kind: "CAPTURE" }
  | { readonly __workerTestControl: true; readonly id: string; readonly kind: "READ_DIAGNOSTICS" }
  | {
      readonly __workerTestControl: true;
      readonly id: string;
      readonly kind: "ENABLE_AUTOMATIC_TIMING";
    }
  | { readonly __workerTestControl: true; readonly id: string; readonly kind: "RESET_DIAGNOSTICS" }
  | {
      readonly __workerTestControl: true;
      readonly id: string;
      readonly kind: "WAIT_DUE_SAMPLES";
      readonly count: number;
    }
  | {
      readonly __workerTestControl: true;
      readonly id: string;
      readonly kind: "WAIT_PUBLICATION_SAMPLES";
      readonly count: number;
    }
  | { readonly __workerTestControl: true; readonly id: string; readonly kind: "INJECT_HOST_FATAL" }
  | { readonly __workerTestControl: true; readonly id: string; readonly kind: "CRASH" };

interface TestScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  postMessage(message: unknown): void;
}

class ManualTiming {
  private nowMs = 0;
  private nextId = 0;
  private readonly jobs = new Map<number, ManualTimer>();
  readonly wakeDurationsMs: number[] = [];
  readonly dueWakeSamples: DueWakeSample[] = [];
  readonly publicationPostSamples: PublicationPostSample[] = [];
  private automatic = false;
  private lastAutomaticWakeMs: number | null = null;
  private automaticWakeRemainderMs = 0;
  private singleCoreStepDueSampleCount = 0;
  private nextScheduledWakeId = 0;

  get pendingTimerCount(): number {
    return this.jobs.size;
  }

  readonly adapter: HostTimingAdapter = {
    now: () => (this.automatic ? performance.now() : this.nowMs),
    setTimeout: (callback, delayMs) => {
      const id = ++this.nextId;
      const timer: ManualTimer = {
        id,
        due: (this.automatic ? performance.now() : this.nowMs) + delayMs,
        delayMs,
        callback,
      };
      this.jobs.set(id, timer);
      if (this.automatic) this.scheduleAutomatic(timer);
      return id;
    },
    clearTimeout: (handle) => {
      if (typeof handle !== "number") return;
      const timer = this.jobs.get(handle);
      if (timer?.nativeHandle !== undefined) globalThis.clearTimeout(timer.nativeHandle);
      this.jobs.delete(handle);
    },
  };

  enableAutomaticTiming(): void {
    if (this.automatic) return;
    const now = performance.now();
    const shift = now - this.nowMs;
    this.nowMs = now;
    this.automatic = true;
    this.lastAutomaticWakeMs = now;
    this.automaticWakeRemainderMs = 0;
    for (const timer of this.jobs.values()) {
      timer.due += shift;
      this.scheduleAutomatic(timer);
    }
  }

  resetDiagnostics(): void {
    this.wakeDurationsMs.length = 0;
    this.dueWakeSamples.length = 0;
    this.publicationPostSamples.length = 0;
    this.singleCoreStepDueSampleCount = 0;
    this.nextScheduledWakeId = 0;
    this.lastAutomaticWakeMs = this.automatic ? performance.now() : null;
    this.automaticWakeRemainderMs = 0;
  }

  async waitForDueSamples(count: number): Promise<void> {
    const startedAt = performance.now();
    while (this.singleCoreStepDueSampleCount < count) {
      if (performance.now() - startedAt > 120_000) {
        throw new Error("Timed out waiting for Worker due-tick diagnostic samples.");
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10));
    }
  }

  async waitForPublicationSamples(count: number): Promise<void> {
    const startedAt = performance.now();
    let lastProgressAt = startedAt;
    while (this.singleStepPublicationSampleCount < count) {
      const now = performance.now();
      if (now - startedAt > 90_000) {
        throw new Error(
          `Timed out waiting for single-step Worker publication samples (${this.singleStepPublicationSampleCount}/${count}).`,
        );
      }
      if (now - lastProgressAt >= 5_000) {
        scope.postMessage({
          __workerTestProgress: true,
          message: `single-step publications ${this.singleStepPublicationSampleCount}/${count}, due ticks ${this.dueWakeSamples.length}, host ${host.getLifecycle()}, publication ACKs ${receivedPublicationAcknowledgements}, result ACKs ${receivedResultAcknowledgements}, timers ${timing.pendingTimerCount}`,
        });
        lastProgressAt = now;
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10));
    }
  }

  private scheduleAutomatic(timer: ManualTimer): void {
    const delayMs = Math.max(0, timer.due - performance.now());
    timer.nativeHandle = globalThis.setTimeout(() => {
      if (!this.jobs.delete(timer.id)) return;
      let dueTicks = 0;
      if (timer.delayMs === 25) {
        const now = performance.now();
        const previous = this.lastAutomaticWakeMs ?? now;
        this.lastAutomaticWakeMs = now;
        this.automaticWakeRemainderMs += now - previous;
        dueTicks = Math.floor(this.automaticWakeRemainderMs / 100);
        this.automaticWakeRemainderMs -= dueTicks * 100;
      }
      const startedAt = performance.now();
      const coreTickCountBefore = observedCoreTickCount;
      const wakeId = ++this.nextScheduledWakeId;
      activeScheduledWakeId = wakeId;
      activeScheduledWakeCoreStepCount = 0;
      try {
        timer.callback();
      } finally {
        activeScheduledWakeId = null;
        activeScheduledWakeCoreStepCount = 0;
      }
      const elapsed = performance.now() - startedAt;
      if (timer.delayMs === 25) {
        this.wakeDurationsMs.push(elapsed);
        if (dueTicks > 0) {
          const coreStepCount = observedCoreTickCount - coreTickCountBefore;
          this.dueWakeSamples.push({ wakeId, durationMs: elapsed, coreStepCount });
          if (coreStepCount === 1) this.singleCoreStepDueSampleCount += 1;
        }
      }
    }, delayMs);
  }

  recordPublicationPost(publicationSequence: number, durationMs: number): void {
    this.publicationPostSamples.push({
      publicationSequence,
      wakeId: activeScheduledWakeId,
      coreStepCount: activeScheduledWakeCoreStepCount,
      durationMs,
    });
  }

  private get singleStepPublicationSampleCount(): number {
    return this.publicationPostSamples.filter(
      (sample) => sample.wakeId !== null && sample.coreStepCount === 1,
    ).length;
  }

  advanceWakes(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const next = [...this.jobs.values()]
        .filter((job) => job.delayMs === 25)
        .toSorted((left, right) => left.due - right.due || left.id - right.id)[0];
      if (next === undefined) throw new Error("No Worker scheduler wake is pending.");
      this.nowMs = next.due;
      this.jobs.delete(next.id);
      const startedAt = performance.now();
      next.callback();
      this.wakeDurationsMs.push(performance.now() - startedAt);
    }
  }

  advanceBursts(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const next = [...this.jobs.values()]
        .filter((job) => job.delayMs === 25)
        .toSorted((left, right) => left.due - right.due || left.id - right.id)[0];
      if (next === undefined) throw new Error("No Worker scheduler wake is pending.");
      this.nowMs += 2_000;
      this.jobs.delete(next.id);
      const startedAt = performance.now();
      next.callback();
      this.wakeDurationsMs.push(performance.now() - startedAt);
    }
  }

  advanceAll(milliseconds: number): void {
    const target = this.nowMs + milliseconds;
    for (let count = 0; count < 20_000; count += 1) {
      const next = [...this.jobs.values()]
        .filter((job) => job.due <= target)
        .toSorted((left, right) => left.due - right.due || left.id - right.id)[0];
      if (next === undefined) break;
      this.nowMs = next.due;
      this.jobs.delete(next.id);
      next.callback();
      if (count === 19_999) throw new Error("Manual timer delivery exceeded its safety bound.");
    }
    this.nowMs = target;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseControl(value: unknown): TestControl | null {
  if (!isRecord(value) || value["__workerTestControl"] !== true) return null;
  const id = value["id"];
  const kind = value["kind"];
  if (typeof id !== "string" || id.length === 0) throw new TypeError("Invalid test control id.");
  switch (kind) {
    case "ADVANCE_WAKES":
      if (Object.keys(value).toSorted().join(",") !== "__workerTestControl,count,id,kind") {
        throw new TypeError("Invalid ADVANCE_WAKES test control fields.");
      }
      if (!Number.isSafeInteger(value["count"]) || (value["count"] as number) < 0) {
        throw new TypeError("ADVANCE_WAKES count must be a nonnegative safe integer.");
      }
      return value as TestControl;
    case "ADVANCE_BURSTS":
      if (Object.keys(value).toSorted().join(",") !== "__workerTestControl,count,id,kind") {
        throw new TypeError("Invalid ADVANCE_BURSTS test control fields.");
      }
      if (!Number.isSafeInteger(value["count"]) || (value["count"] as number) < 0) {
        throw new TypeError("ADVANCE_BURSTS count must be a nonnegative safe integer.");
      }
      return value as TestControl;
    case "ADVANCE_ALL":
      if (Object.keys(value).toSorted().join(",") !== "__workerTestControl,id,kind,milliseconds") {
        throw new TypeError("Invalid ADVANCE_ALL test control fields.");
      }
      if (
        typeof value["milliseconds"] !== "number" ||
        !Number.isFinite(value["milliseconds"]) ||
        value["milliseconds"] < 0
      ) {
        throw new TypeError("ADVANCE_ALL milliseconds must be finite and nonnegative.");
      }
      return value as TestControl;
    case "CAPTURE":
    case "READ_DIAGNOSTICS":
    case "ENABLE_AUTOMATIC_TIMING":
    case "RESET_DIAGNOSTICS":
    case "INJECT_HOST_FATAL":
    case "CRASH":
      if (Object.keys(value).toSorted().join(",") !== "__workerTestControl,id,kind") {
        throw new TypeError(`${kind} test control has unexpected fields.`);
      }
      return value as TestControl;
    case "WAIT_DUE_SAMPLES":
      if (Object.keys(value).toSorted().join(",") !== "__workerTestControl,count,id,kind") {
        throw new TypeError("WAIT_DUE_SAMPLES test control has unexpected fields.");
      }
      if (!Number.isSafeInteger(value["count"]) || (value["count"] as number) < 0) {
        throw new TypeError("WAIT_DUE_SAMPLES count must be a nonnegative safe integer.");
      }
      return value as TestControl;
    case "WAIT_PUBLICATION_SAMPLES":
      if (Object.keys(value).toSorted().join(",") !== "__workerTestControl,count,id,kind") {
        throw new TypeError("WAIT_PUBLICATION_SAMPLES test control has unexpected fields.");
      }
      if (!Number.isSafeInteger(value["count"]) || (value["count"] as number) < 0) {
        throw new TypeError("WAIT_PUBLICATION_SAMPLES count must be a nonnegative safe integer.");
      }
      return value as TestControl;
    default:
      throw new TypeError("Unknown Worker test control.");
  }
}

const scope = globalThis as unknown as TestScope;
const timing = new ManualTiming();
const content = loadWorkerManualFixtureContent();
const useDenseNFixture = new URL(import.meta.url).searchParams.get("fixture") === "n";
let activeEpoch: string | null = null;
let nextRequestSequence = 0;
let inboundTail: Promise<void> = Promise.resolve();
let receivedPublicationAcknowledgements = 0;
let receivedResultAcknowledgements = 0;

function postReply(reply: WorkerReply): void {
  const startedAt = performance.now();
  scope.postMessage(reply);
  if (reply.kind === "READY" || reply.kind === "SNAPSHOT_PUBLICATION") {
    const publicationSequence = reply.body.publication?.publicationSequence;
    if (publicationSequence !== undefined) {
      timing.recordPublicationPost(publicationSequence, performance.now() - startedAt);
    }
  }
}

function reportFixtureError(error: unknown): void {
  scope.postMessage({
    __workerTestError: true,
    message: error instanceof Error ? error.message : "Worker test fixture failed.",
  });
}

const host = createSimWorkerHost({
  content,
  timing: timing.adapter,
  postMessage: postReply,
  ...(useDenseNFixture
    ? { initialStateForTest: createWorkerNFixture("task-19-worker-n", content) }
    : {}),
});

async function handleControl(control: TestControl): Promise<void> {
  switch (control.kind) {
    case "ADVANCE_WAKES": {
      timing.advanceWakes(control.count);
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "ADVANCE_BURSTS": {
      timing.advanceBursts(control.count);
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "ADVANCE_ALL": {
      timing.advanceAll(control.milliseconds);
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "CAPTURE": {
      const capture = await host.captureAtBarrier();
      scope.postMessage({
        __workerTestResult: true,
        id: control.id,
        kind: control.kind,
        tick: capture.state.tick,
        year: capture.state.campaign.currentYear,
        rngState: capture.state.rngState,
        stateHash: hashCanonicalState(capture.state),
        nextQueueSequence: capture.nextQueueSequence,
        pendingTimers: timing.pendingTimerCount,
      });
      return;
    }
    case "READ_DIAGNOSTICS": {
      scope.postMessage({
        __workerTestResult: true,
        id: control.id,
        kind: control.kind,
        wakeDurationsMs: timing.wakeDurationsMs.splice(0),
        dueWakeSamples: timing.dueWakeSamples.splice(0),
        publicationPostSamples: timing.publicationPostSamples.splice(0),
      });
      return;
    }
    case "ENABLE_AUTOMATIC_TIMING": {
      timing.enableAutomaticTiming();
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "RESET_DIAGNOSTICS": {
      timing.resetDiagnostics();
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "WAIT_DUE_SAMPLES": {
      await timing.waitForDueSamples(control.count);
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "WAIT_PUBLICATION_SAMPLES": {
      await timing.waitForPublicationSamples(control.count);
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      return;
    }
    case "INJECT_HOST_FATAL": {
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      if (activeEpoch === null)
        throw new Error("Cannot inject a fatal before Worker initialization.");
      await host.receive({
        protocolVersion: 1,
        epoch: activeEpoch,
        requestSequence: nextRequestSequence + 1,
        kind: "REQUEST_FULL_SNAPSHOT",
        body: {},
      });
      return;
    }
    case "CRASH": {
      scope.postMessage({ __workerTestResult: true, id: control.id, kind: control.kind });
      globalThis.setTimeout(() => {
        throw new Error("Injected real Worker crash for lifecycle coverage.");
      }, 0);
      return;
    }
  }
}

scope.addEventListener("message", (event) => {
  let control: TestControl | null;
  try {
    control = parseControl(event.data);
  } catch (error) {
    reportFixtureError(error);
    return;
  }

  // Keep the long real-time sample wait outside the request chain so the host
  // can continue processing publication and terminal-result acknowledgements.
  if (control?.kind === "WAIT_DUE_SAMPLES" || control?.kind === "WAIT_PUBLICATION_SAMPLES") {
    void handleControl(control).catch(reportFixtureError);
    return;
  }

  inboundTail = inboundTail
    .then(async () => {
      if (control !== null) {
        await handleControl(control);
        return;
      }
      if (isRecord(event.data)) {
        const epoch = event.data["epoch"];
        const requestSequence = event.data["requestSequence"];
        if (event.data["kind"] === "ACK_PUBLICATION") receivedPublicationAcknowledgements += 1;
        if (event.data["kind"] === "ACK_RESULT") receivedResultAcknowledgements += 1;
        if (typeof epoch === "string") activeEpoch = epoch;
        if (typeof requestSequence === "number" && Number.isSafeInteger(requestSequence)) {
          nextRequestSequence = requestSequence + 1;
        }
      }
      await host.receive(event.data);
    })
    .catch(reportFixtureError);
});

scope.addEventListener("error", () => {
  host.destroy();
});
scope.addEventListener("messageerror", () => {
  host.destroy();
});
