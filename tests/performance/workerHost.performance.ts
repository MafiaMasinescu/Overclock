// Phase 2 Task 19.2 diagnostic. Separates non-tick scheduler wake cost,
// scheduler wakes that complete a tick, and direct production tick cost.
// Results are informative outside the contract's verified target host.
// Run with: corepack pnpm performance:worker-host

import { arch, cpus, platform, release } from "node:os";

import { classifyReplayDiagnosticHost } from "./replayHostClassification.ts";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { createSimWorkerHost, type HostTimingAdapter } from "../../src/app/worker/simWorkerHost.ts";

const content = loadContentBundle();
const SEED = "task-19-host-performance";
const EPOCH = "task-19-host-perf";
const WARMUP_WAKE_COUNT = 1_000;
const MEASURED_WAKE_COUNT = 2_000;
const WORKER_DUE_TICK_P95_LIMIT_MS = 6;
const DIRECT_TICK_P95_LIMIT_MS = 4;
const directTickSamples: number[] = [];
const idleWakeSamples: number[] = [];
const dueTickWakeSamples: number[] = [];

function elapsedMilliseconds(start: bigint, end: bigint): number {
  return Number(end - start) / 1_000_000;
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function p95(samples: readonly number[]): number {
  return percentile(
    [...samples].sort((left, right) => left - right),
    0.95,
  );
}

function summarize(samples: readonly number[]): string {
  const sorted = [...samples].sort((left, right) => left - right);
  return `samples=${samples.length}, median=${percentile(sorted, 0.5).toFixed(4)} ms, p95=${percentile(sorted, 0.95).toFixed(4)} ms, max=${(sorted.at(-1) ?? 0).toFixed(4)} ms`;
}

class DiagnosticTiming implements HostTimingAdapter {
  private nowMs = 0;
  private nextId = 0;
  private wakeCount = 0;
  private afterCallback: () => void | Promise<void> = () => Promise.resolve();
  private readonly jobs = new Map<number, { due: number; delayMs: number; callback: () => void }>();

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.nextId;
    this.jobs.set(id, { due: this.nowMs + delayMs, delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.jobs.delete(handle);
  }

  setAfterCallback(callback: () => Promise<void>): void {
    this.afterCallback = callback;
  }

  async advanceBy(milliseconds: number): Promise<void> {
    const target = this.nowMs + milliseconds;
    for (let count = 0; count < 10_000; count += 1) {
      const next = [...this.jobs.entries()]
        .filter(([, job]) => job.due <= target)
        .toSorted((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (next === undefined) break;
      this.nowMs = next[1].due;
      this.jobs.delete(next[0]);
      const isWake = next[1].delayMs === 25;
      const wakeIndex = isWake ? this.wakeCount++ : -1;
      const startedAt = isWake ? process.hrtime.bigint() : 0n;
      next[1].callback();
      if (isWake && wakeIndex >= WARMUP_WAKE_COUNT) {
        const sample = elapsedMilliseconds(startedAt, process.hrtime.bigint());
        (wakeIndex % 4 === 3 ? dueTickWakeSamples : idleWakeSamples).push(sample);
      }
      await this.afterCallback();
    }
    this.nowMs = target;
  }
}

const timing = new DiagnosticTiming();
const pendingPublicationAcks: number[] = [];
const host = createSimWorkerHost({
  content,
  timing,
  postMessage: (reply) => {
    if (reply.kind === "READY") {
      pendingPublicationAcks.push(reply.body.publication.publicationSequence);
    } else if (reply.kind === "SNAPSHOT_PUBLICATION" && reply.body.publication !== null) {
      pendingPublicationAcks.push(reply.body.publication.publicationSequence);
    }
  },
});
const initialState = createInitialGameState({ content, seed: SEED });
const directCore = createProductionSimCore({ content, initialState });
let requestSequence = 0;

async function request(kind: string, body: unknown): Promise<void> {
  await host.receive({
    protocolVersion: 1,
    epoch: EPOCH,
    requestSequence,
    kind,
    body,
  });
  requestSequence += 1;
}

async function acknowledgePublications(): Promise<void> {
  while (pendingPublicationAcks.length > 0) {
    const publicationSequence = pendingPublicationAcks.shift();
    if (publicationSequence !== undefined) {
      await request("ACK_PUBLICATION", { publicationSequence });
    }
  }
}

timing.setAfterCallback(acknowledgePublications);

await request("INITIALIZE_NEW", {
  seed: SEED,
  contentVersion: content.contentVersion,
  fingerprint: hashSimulationContent(content),
});
await acknowledgePublications();
await timing.advanceBy(100);
await request("COMMAND", {
  command: {
    commandId: "76000000-0000-4000-8000-000000000001",
    source: "player",
    kind: "SET_PAUSED",
    paused: false,
  },
});

await timing.advanceBy(WARMUP_WAKE_COUNT * 25);
directCore.step(WARMUP_WAKE_COUNT / 4);

for (let wake = 0; wake < MEASURED_WAKE_COUNT; wake += 1) {
  await timing.advanceBy(25);
}

for (let tick = 0; tick < MEASURED_WAKE_COUNT / 4; tick += 1) {
  const startedAt = process.hrtime.bigint();
  directCore.step(1);
  directTickSamples.push(elapsedMilliseconds(startedAt, process.hrtime.bigint()));
}

console.log("Task 19.2 Worker host scheduling diagnostic (development machine)");
console.log(`CPU=${cpus()[0]?.model ?? "unknown"}`);
console.log(`platform=${platform()} ${release()} ${arch()}`);
const targetClassification = classifyReplayDiagnosticHost({
  cpuModels: cpus().map((cpu) => cpu.model),
  platform: platform(),
  architecture: arch(),
  osRelease: release(),
  nodeVersion: process.version,
});
console.log(`target classification=${targetClassification}`);
console.log(`25 ms scheduler wake without a due tick: ${summarize(idleWakeSamples)}`);
console.log(`25 ms scheduler wake with a due tick: ${summarize(dueTickWakeSamples)}`);
console.log(`direct production SimCore.step(1): ${summarize(directTickSamples)}`);

if (targetClassification === "verified-target") {
  if (p95(dueTickWakeSamples) >= WORKER_DUE_TICK_P95_LIMIT_MS) {
    console.error(`Worker due-tick p95 must be <${WORKER_DUE_TICK_P95_LIMIT_MS} ms.`);
    process.exitCode = 1;
  }
  if (p95(directTickSamples) >= DIRECT_TICK_P95_LIMIT_MS) {
    console.error(`Direct SimCore.step(1) p95 must be <${DIRECT_TICK_P95_LIMIT_MS} ms.`);
    process.exitCode = 1;
  }
}

host.destroy();
