import type { ContentBundle } from "../../../src/content/schemas/contentSchemas.ts";
import { createWorkerGameClient } from "../../../src/app/game-client/workerGameClient.ts";
import type {
  ClientTimingAdapter,
  WorkerPort,
} from "../../../src/app/game-client/workerGameClient.ts";
import type {
  GameClient,
  GameClientControlNotice,
} from "../../../src/app/game-client/contracts.ts";
import { type WorkerReply, type WorkerRequest } from "../../../src/app/worker/protocol.ts";
import { loadWorkerManualFixtureContent } from "./workerManualFixtureContent.ts";
import { createInitialGameState } from "../../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../../src/sim/core/productionSimCore.ts";
import type { SimCore } from "../../../src/sim/core/simCore.ts";
import { parseSimCommand } from "../../../src/sim/commands/commandSchema.ts";
import { calculateDesignApplyPreview } from "../../../src/sim/design/designApplyPreview.ts";
import { hashCanonicalState } from "../../../src/sim/replay/canonicalState.ts";
import { createWorkerNFixture } from "../../performance/workerNFixture.ts";

interface TestControlResult {
  readonly __workerTestResult: true;
  readonly id: string;
  readonly kind: string;
  readonly [key: string]: unknown;
}

interface TestMetrics {
  readonly wakeDurationsMs: number[];
  readonly dueWakeSamples: {
    readonly wakeId: number;
    readonly durationMs: number;
    readonly coreStepCount: number;
  }[];
  readonly publicationPostSamples: {
    readonly publicationSequence: number;
    readonly wakeId: number | null;
    readonly coreStepCount: number;
    readonly durationMs: number;
  }[];
}

interface PublicationProcessingSample {
  readonly publicationSequence: number;
  readonly durationMs: number;
}

interface WorkerCapture {
  readonly tick: number;
  readonly year: number;
  readonly rngState: number;
  readonly stateHash: string;
  readonly nextQueueSequence: number;
}

type ControlKind =
  | "ADVANCE_WAKES"
  | "ADVANCE_BURSTS"
  | "ADVANCE_ALL"
  | "CAPTURE"
  | "READ_DIAGNOSTICS"
  | "ENABLE_AUTOMATIC_TIMING"
  | "RESET_DIAGNOSTICS"
  | "WAIT_DUE_SAMPLES"
  | "WAIT_PUBLICATION_SAMPLES"
  | "INJECT_HOST_FATAL"
  | "CRASH";

interface ControlOptions {
  readonly count?: number;
  readonly milliseconds?: number;
}

type MessageListener = (event: MessageEvent<unknown>) => void;
type EventListener = (event: Event) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicationSequenceOf(value: unknown): number | null {
  if (!isRecord(value) || !isRecord(value["body"])) return null;
  const publication = value["body"]["publication"];
  if (!isRecord(publication)) return null;
  const sequence = publication["publicationSequence"];
  return typeof sequence === "number" && Number.isSafeInteger(sequence) ? sequence : null;
}

function isPublicationReplyKind(kind: unknown): boolean {
  return kind === "READY" || kind === "SNAPSHOT_PUBLICATION";
}

class ManualWorkerPort implements WorkerPort {
  private readonly worker: Worker;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<EventListener>();
  private readonly messageErrorListeners = new Set<EventListener>();
  private readonly controls = new Map<string, (result: TestControlResult) => void>();
  private readonly requests = new Map<number, WorkerRequest["kind"]>();
  private readonly pendingAcks = new Set<number>();
  private readonly ackWaiters = new Set<() => void>();
  private readonly heldAckWaiters = new Set<() => void>();
  private controlSequence = 0;
  private holdNextAckValue = false;
  private heldAcks: WorkerRequest[] = [];
  private heldRequests: WorkerRequest[] = [];
  private holdingRequestOrder = false;
  private nextAckSequenceOffset: number | null = null;
  private holdNextCommandValue = false;
  private readonly heldCommands: WorkerRequest[] = [];
  readonly receipts: Extract<WorkerReply, { kind: "COMMAND_RECEIPT" }>[] = [];
  readonly publications: Extract<WorkerReply, { kind: "READY" | "SNAPSHOT_PUBLICATION" }>[] = [];
  readonly publicationProcessingMs: PublicationProcessingSample[] = [];
  readonly roundTripMs: number[] = [];
  terminateCount = 0;
  controlError: string | null = null;
  fixtureProgress: string | null = null;

  constructor(fixture: "default" | "n" = "default") {
    const workerUrl =
      fixture === "n"
        ? new URL("./workerManualEntry.ts?fixture=n", import.meta.url)
        : new URL("./workerManualEntry.ts", import.meta.url);
    this.worker = new Worker(workerUrl, {
      type: "module",
      name: "overclock-manual-test-worker",
    });
    this.worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (
        event.data !== null &&
        typeof event.data === "object" &&
        (event.data as Record<string, unknown>)["__workerTestProgress"] === true &&
        typeof (event.data as Record<string, unknown>)["message"] === "string"
      ) {
        this.fixtureProgress = (event.data as Record<string, unknown>)["message"] as string;
        return;
      }
      if (this.isControlResult(event.data)) {
        this.controls.get(event.data.id)?.(event.data);
        this.controls.delete(event.data.id);
        return;
      }
      if (this.isControlError(event.data)) {
        this.controlError = event.data.message;
        for (const resolve of this.controls.values()) {
          resolve({
            __workerTestResult: true,
            id: "fixture-error",
            kind: "ERROR",
            message: event.data.message,
          });
        }
        this.controls.clear();
        return;
      }
      const rawReply = event.data;
      const replyKind = isRecord(rawReply) ? rawReply["kind"] : undefined;
      const publicationSequence = isPublicationReplyKind(replyKind)
        ? publicationSequenceOf(rawReply)
        : null;
      const replySequence =
        isRecord(rawReply) &&
        typeof rawReply["requestSequence"] === "number" &&
        Number.isSafeInteger(rawReply["requestSequence"])
          ? rawReply["requestSequence"]
          : null;
      const isPublication = replyKind === "READY" || replyKind === "SNAPSHOT_PUBLICATION";
      if (replyKind === "COMMAND_RECEIPT" && isRecord(rawReply)) {
        this.receipts.push(
          rawReply as unknown as Extract<WorkerReply, { kind: "COMMAND_RECEIPT" }>,
        );
      }
      if (isPublication && isRecord(rawReply)) {
        this.publications.push(
          rawReply as unknown as Extract<WorkerReply, { kind: "READY" | "SNAPSHOT_PUBLICATION" }>,
        );
      }
      if (replySequence !== null) {
        const requestKind = this.requests.get(replySequence);
        if (requestKind !== undefined && requestKind !== "ACK_PUBLICATION") {
          const startedAt = this.requestStartedAt.get(replySequence);
          if (startedAt !== undefined) {
            this.roundTripMs.push(performance.now() - startedAt);
            this.requestStartedAt.delete(replySequence);
          }
        }
        if (
          requestKind === "ACK_PUBLICATION" &&
          (replyKind === "REQUEST_RESULT" || replyKind === "REQUEST_ERROR")
        ) {
          this.pendingAcks.delete(replySequence);
          this.resolveAckWaitersIfIdle();
        }
      }
      const startedAt = performance.now();
      for (const listener of [...this.messageListeners]) listener(event);
      if (isPublication && publicationSequence !== null) {
        this.publicationProcessingMs.push({
          publicationSequence,
          durationMs: performance.now() - startedAt,
        });
      }
    });
    this.worker.addEventListener("error", (event) => {
      for (const listener of [...this.errorListeners]) listener(event);
    });
    this.worker.addEventListener("messageerror", (event) => {
      for (const listener of [...this.messageErrorListeners]) listener(event);
    });
  }

  private readonly requestStartedAt = new Map<number, number>();

  private isControlResult(value: unknown): value is TestControlResult {
    return (
      value !== null &&
      typeof value === "object" &&
      (value as Record<string, unknown>)["__workerTestResult"] === true &&
      typeof (value as Record<string, unknown>)["id"] === "string" &&
      typeof (value as Record<string, unknown>)["kind"] === "string"
    );
  }

  private isControlError(
    value: unknown,
  ): value is { readonly __workerTestError: true; readonly message: string } {
    return (
      value !== null &&
      typeof value === "object" &&
      (value as Record<string, unknown>)["__workerTestError"] === true &&
      typeof (value as Record<string, unknown>)["message"] === "string"
    );
  }

  postMessage(message: WorkerRequest): void {
    if (message.kind === "ACK_RESULT") {
      this.worker.postMessage(message);
      return;
    }
    if (message.kind === "COMMAND" && this.holdNextCommandValue) {
      this.holdNextCommandValue = false;
      this.heldCommands.push(message);
      return;
    }
    let outbound = message;
    if (message.kind === "ACK_PUBLICATION" && this.nextAckSequenceOffset !== null) {
      const offset = this.nextAckSequenceOffset;
      this.nextAckSequenceOffset = null;
      outbound = {
        ...message,
        body: { publicationSequence: message.body.publicationSequence + offset },
      };
    }
    this.requests.set(message.requestSequence, message.kind);
    this.requestStartedAt.set(message.requestSequence, performance.now());
    if (message.kind === "ACK_PUBLICATION") {
      this.pendingAcks.add(message.requestSequence);
      if (this.holdNextAckValue) {
        this.holdNextAckValue = false;
        this.holdingRequestOrder = true;
        this.heldAcks.push(outbound);
        for (const resolve of this.heldAckWaiters) resolve();
        this.heldAckWaiters.clear();
      }
    }
    if (this.holdingRequestOrder) {
      this.heldRequests.push(outbound);
      return;
    }
    this.worker.postMessage(outbound);
  }

  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(type: "error" | "messageerror", listener: EventListener): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | EventListener,
  ): void {
    if (type === "message") this.messageListeners.add(listener);
    else if (type === "error") this.errorListeners.add(listener as EventListener);
    else this.messageErrorListeners.add(listener as EventListener);
  }

  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "error" | "messageerror", listener: EventListener): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | EventListener,
  ): void {
    if (type === "message") this.messageListeners.delete(listener);
    else if (type === "error") this.errorListeners.delete(listener as EventListener);
    else this.messageErrorListeners.delete(listener as EventListener);
  }

  terminate(): void {
    this.terminateCount += 1;
    this.worker.terminate();
    this.heldAcks = [];
    this.heldRequests = [];
    this.holdingRequestOrder = false;
    this.heldCommands.length = 0;
  }

  get activeListenerCount(): number {
    return this.messageListeners.size + this.errorListeners.size + this.messageErrorListeners.size;
  }

  get heldAckCount(): number {
    return this.heldAcks.length;
  }

  get pendingAckCount(): number {
    return this.pendingAcks.size;
  }

  async waitForHeldAck(): Promise<void> {
    if (this.heldAcks.length > 0) return;
    await new Promise<void>((resolve) => this.heldAckWaiters.add(resolve));
  }

  holdNextAck(): void {
    this.holdNextAckValue = true;
  }

  corruptNextAck(offset = 100): void {
    this.nextAckSequenceOffset = offset;
  }

  holdNextCommand(): void {
    this.holdNextCommandValue = true;
  }

  dispatchMessageError(): void {
    this.worker.dispatchEvent(new MessageEvent("messageerror"));
  }

  releaseHeldAcks(): void {
    const held = this.heldRequests;
    this.heldAcks = [];
    this.heldRequests = [];
    this.holdingRequestOrder = false;
    for (const message of held) this.worker.postMessage(message);
  }

  async waitForAckIdle(): Promise<void> {
    if (this.pendingAcks.size === 0) return;
    await new Promise<void>((resolve, reject) => {
      const waiter = (): void => {
        globalThis.clearTimeout(timeout);
        resolve();
      };
      const timeout = globalThis.setTimeout(() => {
        this.ackWaiters.delete(waiter);
        reject(
          new Error(
            `Timed out draining Worker acknowledgements (${this.pendingAcks.size} pending).`,
          ),
        );
      }, 20_000);
      this.ackWaiters.add(waiter);
    });
  }

  private resolveAckWaitersIfIdle(): void {
    if (this.pendingAcks.size > 0) return;
    for (const resolve of this.ackWaiters) resolve();
    this.ackWaiters.clear();
  }

  async control(kind: ControlKind, options: ControlOptions = {}): Promise<TestControlResult> {
    const id = `manual-control-${++this.controlSequence}`;
    const control = {
      __workerTestControl: true,
      id,
      kind,
      ...(kind === "ADVANCE_WAKES" ||
      kind === "ADVANCE_BURSTS" ||
      kind === "WAIT_DUE_SAMPLES" ||
      kind === "WAIT_PUBLICATION_SAMPLES"
        ? { count: options.count ?? 0 }
        : {}),
      ...(kind === "ADVANCE_ALL" ? { milliseconds: options.milliseconds ?? 0 } : {}),
    };
    const response = new Promise<TestControlResult>((resolve) => this.controls.set(id, resolve));
    this.worker.postMessage(control);
    const result = await response;
    if (result.kind === "ERROR") {
      const message = result["message"];
      throw new Error(typeof message === "string" ? message : "Worker test fixture error.");
    }
    return result;
  }
}

interface Session {
  readonly client: GameClient;
  readonly core: SimCore;
  readonly port: ManualWorkerPort;
  readonly content: ContentBundle;
  readonly receiptsAndResults: {
    readonly commandId: string;
    readonly clock: boolean;
    readonly receipt: unknown;
    readonly result: unknown;
  }[];
  readonly events: string[];
  readonly controls: string[];
}

const controlledClientTiming: ClientTimingAdapter = {
  now: () => 0,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

let nextSessionId = 0;
let workerDiagnosticsProgress = "idle";

async function createSession(
  seedLabel = "worker-browser-session",
  fixture: "default" | "n" = "default",
): Promise<Session> {
  const content = loadWorkerManualFixtureContent();
  const seed = `${seedLabel}-${++nextSessionId}`;
  const port = new ManualWorkerPort(fixture);
  const client = await createWorkerGameClient({
    content,
    seed,
    epoch: `browser-worker-${nextSessionId}`,
    requestTimeoutMs: 120_000,
    workerFactory: () => port,
    timing: controlledClientTiming,
  });
  const core = createProductionSimCore({
    content,
    initialState:
      fixture === "n"
        ? createWorkerNFixture("task-19-worker-n", content)
        : createInitialGameState({ content, seed }),
  });
  const session: Session = {
    client,
    core,
    port,
    content,
    receiptsAndResults: [],
    events: [],
    controls: [],
  };
  client.subscribeEvents((event) => session.events.push(event.kind));
  client.subscribeControl((notice: GameClientControlNotice) => session.controls.push(notice.kind));
  await port.waitForAckIdle();
  return session;
}

function commandId(sequence: number): string {
  return `76000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

let nextCommandId = 0;
let activeWorkerDiagnosticsPort: ManualWorkerPort | null = null;

async function dispatchMirrored(
  session: Session,
  input: Record<string, unknown>,
  waitForAcknowledgements = true,
): Promise<unknown> {
  const command = parseSimCommand({
    ...input,
    commandId: commandId(++nextCommandId),
    source: "player",
  });
  const receiptCount = session.port.receipts.length;
  let expectedReceipt: unknown = null;
  let expectedResult: unknown;
  const isClock = command.kind === "SET_PAUSED" || command.kind === "SET_SPEED";
  if (isClock) {
    expectedResult = session.core.applyClockCommand(command);
  } else {
    expectedReceipt = session.core.enqueue(command);
    const results = session.core.processPendingCommands();
    expectedResult = results.find((result) => result.commandId === command.commandId);
  }
  const actualResult = await session.client.dispatch(command);
  if (waitForAcknowledgements) await session.port.waitForAckIdle();
  const actualReceipt =
    session.port.receipts
      .slice(receiptCount)
      .find((reply) => reply.body.receipt.commandId === command.commandId)?.body.receipt ?? null;
  const row = {
    commandId: command.commandId,
    clock: isClock,
    receipt: actualReceipt,
    result: actualResult,
  };
  session.receiptsAndResults.push(row);
  if (JSON.stringify(actualReceipt) !== JSON.stringify(expectedReceipt)) {
    throw new Error(`Worker receipt diverged for ${command.kind}: ${JSON.stringify(row)}`);
  }
  if (JSON.stringify(actualResult) !== JSON.stringify(expectedResult)) {
    throw new Error(`Worker command result diverged for ${command.kind}.`);
  }
  return actualResult;
}

async function captureAndCompare(session: Session, targetTick: number): Promise<WorkerCapture> {
  await session.port.waitForAckIdle();
  const capture = (await session.port.control("CAPTURE")) as TestControlResult & WorkerCapture;
  const directState = session.core.getStateForSave();
  const expected = {
    tick: directState.tick,
    year: directState.campaign.currentYear,
    rngState: directState.rngState,
    stateHash: hashCanonicalState(directState),
    nextQueueSequence: session.core.getCommandQueuePosition().nextSequence,
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (capture[key] !== expected[key]) {
      throw new Error(`Worker/direct ${key} mismatch at tick ${targetTick}.`);
    }
  }
  if (capture.tick !== targetTick) {
    throw new Error(`Worker barrier captured tick ${capture.tick}, expected ${targetTick}.`);
  }
  return capture;
}

async function advanceAndCompare(session: Session, targetTick: number): Promise<WorkerCapture> {
  const currentTick = session.core.getStateForSave().tick;
  const count = targetTick - currentTick;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid parity target tick.");
  const speed = session.core.getStateForSave().clock.speed;
  if (speed !== 1) throw new Error("Campaign boundary fixture expects speed 1.");
  const batchSize = 1_000;
  for (let advanced = 0; advanced < count; advanced += batchSize) {
    const batchTicks = Math.min(batchSize, count - advanced);
    const burstCount = Math.floor(batchTicks / 20);
    const remainder = batchTicks % 20;
    if (burstCount > 0) {
      const burstAdvance = session.port.control("ADVANCE_BURSTS", { count: burstCount });
      session.core.step(burstCount * 20);
      await burstAdvance;
    }
    if (remainder > 0) {
      const wakeAdvance = session.port.control("ADVANCE_WAKES", { count: remainder * 4 });
      session.core.step(remainder);
      await wakeAdvance;
    }
    await session.port.waitForAckIdle();
  }
  return await captureAndCompare(session, targetTick);
}

function expectAccepted(value: unknown, kind: string): void {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { accepted?: unknown }).accepted !== true
  ) {
    throw new Error(`${kind} was not accepted: ${JSON.stringify(value)}`);
  }
}

function expectRejectedCode(value: unknown, code: string): void {
  if (value === null || typeof value !== "object") throw new Error(`Expected rejection ${code}.`);
  const result = value as { accepted?: unknown; code?: unknown };
  if (result.accepted !== false || result.code !== code) {
    throw new Error(`Expected ${code}, received ${JSON.stringify(value)}.`);
  }
}

async function runParityScenario() {
  const session = await createSession("worker-parity");
  try {
    expectAccepted(await dispatchMirrored(session, { kind: "SET_SPEED", speed: 4 }), "speed 4");
    expectAccepted(
      await dispatchMirrored(session, { kind: "SET_PAUSED", paused: false }),
      "unpause",
    );
    const firstAdvance = session.port.control("ADVANCE_WAKES", { count: 12 });
    session.core.step(12);
    await firstAdvance;
    await captureAndCompare(session, 12);

    expectAccepted(await dispatchMirrored(session, { kind: "SET_SPEED", speed: 2 }), "speed 2");
    const secondAdvance = session.port.control("ADVANCE_WAKES", { count: 10 });
    session.core.step(5);
    await secondAdvance;
    await captureAndCompare(session, 17);
    expectAccepted(await dispatchMirrored(session, { kind: "SET_PAUSED", paused: true }), "pause");

    expectAccepted(await dispatchMirrored(session, { kind: "ENTER_DESIGN_MODE" }), "design mode");
    expectAccepted(
      await dispatchMirrored(session, {
        kind: "PLACE_MODULE",
        definitionId: "module-vacuum-tube-logic",
        position: { x: 1, y: 1 },
        rotation: 0,
      }),
      "module placement",
    );
    const preview = calculateDesignApplyPreview(session.core.getStateForSave(), session.content);
    if (preview.status !== "ready") throw new Error(`Design preview blocked: ${preview.status}`);
    expectAccepted(
      await dispatchMirrored(session, {
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.draftRevision,
        acceptedCostUsd: preview.netCostUsd,
        acceptedDowntimeTicks: preview.downtimeTicks,
      }),
      "design apply",
    );
    const moduleId = "module-instance-00000001";
    expectAccepted(
      await dispatchMirrored(session, {
        kind: "START_BENCHMARK",
        benchmarkId: "benchmark-sustained-stability",
        clusterModuleIds: [moduleId],
      }),
      "benchmark start",
    );
    expectRejectedCode(
      await dispatchMirrored(session, {
        kind: "START_RESEARCH",
        nodeId: "research-stable-power-distribution",
        reservedComputeShare: 0.1,
      }),
      "BENCHMARK_CONFIGURATION_LOCKED",
    );
    expectAccepted(
      await dispatchMirrored(session, {
        kind: "ACCEPT_TASK",
        definitionId: "task-ballistic-table-verification",
      }),
      "Task acceptance during Benchmark",
    );

    expectAccepted(await dispatchMirrored(session, { kind: "SET_SPEED", speed: 1 }), "speed 1");
    expectAccepted(
      await dispatchMirrored(session, { kind: "SET_PAUSED", paused: false }),
      "unpause",
    );
    const benchmarkAdvance = session.port.control("ADVANCE_BURSTS", { count: 60 });
    session.core.step(1_200);
    await benchmarkAdvance;
    await captureAndCompare(session, 1_217);
    expectAccepted(await dispatchMirrored(session, { kind: "SET_PAUSED", paused: true }), "pause");
    if (session.core.getStateForSave().benchmarks.active !== null) {
      throw new Error("The sustained Benchmark did not reach its terminal result.");
    }

    expectAccepted(
      await dispatchMirrored(session, {
        kind: "ABANDON_TASK",
        taskInstanceId: "task-instance-00000001",
      }),
      "Task abandon",
    );
    expectAccepted(
      await dispatchMirrored(session, {
        kind: "START_RESEARCH",
        nodeId: "research-stable-power-distribution",
        reservedComputeShare: 0.1,
      }),
      "research start",
    );
    expectRejectedCode(
      await dispatchMirrored(session, {
        kind: "SAVE_BLUEPRINT",
        name: "Worker parity fixture",
        selectedModuleIds: [moduleId],
      }),
      "RESEARCH_REQUIRED",
    );
    expectRejectedCode(
      await dispatchMirrored(session, {
        kind: "INSTANTIATE_BLUEPRINT",
        blueprintId: "blueprint-00000001",
        position: { x: 8, y: 1 },
        rotation: 0,
      }),
      "BLUEPRINT_INVALID",
    );
    expectAccepted(
      await dispatchMirrored(session, {
        kind: "CANCEL_RESEARCH",
        nodeId: "research-stable-power-distribution",
      }),
      "research cancel",
    );

    expectAccepted(
      await dispatchMirrored(session, { kind: "SET_PAUSED", paused: false }),
      "unpause",
    );
    const year1947 = await advanceAndCompare(session, 12_000);
    if (year1947.year !== 1947) throw new Error("Tick 12,000 did not produce Campaign year 1947.");
    expectAccepted(await dispatchMirrored(session, { kind: "SET_PAUSED", paused: true }), "pause");
    expectAccepted(
      await dispatchMirrored(session, { kind: "SET_PAUSED", paused: false }),
      "unpause",
    );
    const year1948 = await advanceAndCompare(session, 24_000);
    if (year1948.year !== 1948) throw new Error("Tick 24,000 did not produce Campaign year 1948.");
    const kinds = new Set(session.events);
    for (const kind of [
      "BENCHMARK_STARTED",
      "BENCHMARK_FAILED",
      "TASK_ACCEPTED",
      "RESEARCH_STARTED",
    ]) {
      if (!kinds.has(kind)) throw new Error(`Committed fact batch omitted ${kind}.`);
    }
    return {
      traceCommands: session.receiptsAndResults.length,
      queuedReceipts: session.port.receipts.length,
      workerQueueSequence: year1948.nextQueueSequence,
      tick12000: year1947,
      tick24000: year1948,
      eventKinds: [...kinds].toSorted(),
      finalHash: year1948.stateHash,
    };
  } finally {
    session.client.destroy();
  }
}

async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const deadline = performance.now() + 8_000;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(() => {
        resolve();
      }, 5);
    });
  }
}

async function runResyncScenario() {
  const session = await createSession("worker-resync");
  const fullBefore = session.port.publications.filter(
    (reply) => reply.kind === "SNAPSHOT_PUBLICATION" && reply.body.publication?.heatmap.full,
  ).length;
  session.port.holdNextAck();
  try {
    await dispatchMirrored(session, { kind: "ENTER_DESIGN_MODE" }, false);
    await dispatchMirrored(
      session,
      {
        kind: "PLACE_MODULE",
        definitionId: "module-vacuum-tube-logic",
        position: { x: 1, y: 1 },
        rotation: 0,
      },
      false,
    );
    const preview = calculateDesignApplyPreview(session.core.getStateForSave(), session.content);
    if (preview.status !== "ready") throw new Error("Resync fixture design preview is blocked.");
    await dispatchMirrored(
      session,
      {
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.draftRevision,
        acceptedCostUsd: preview.netCostUsd,
        acceptedDowntimeTicks: preview.downtimeTicks,
      },
      false,
    );
    await session.port.control("ADVANCE_ALL", { milliseconds: 100 });
    await waitUntil(() => session.port.heldAckCount > 0, "the intentionally held publication ACK");
    const heldAcknowledgement = session.port.heldAckCount;
    const fullBeforeTimeout = session.port.publications.filter(
      (reply) => reply.kind === "SNAPSHOT_PUBLICATION" && reply.body.publication?.heatmap.full,
    ).length;
    await session.port.control("ADVANCE_ALL", { milliseconds: 1_001 });
    session.port.releaseHeldAcks();
    await waitUntil(
      () =>
        session.port.publications.filter(
          (reply) => reply.kind === "SNAPSHOT_PUBLICATION" && reply.body.publication?.heatmap.full,
        ).length > fullBeforeTimeout && session.client.getConnectionStatus() === "live",
      "a full resync after the delayed ACK timeout",
    );
    const fullAfter = session.port.publications.filter(
      (reply) => reply.kind === "SNAPSHOT_PUBLICATION" && reply.body.publication?.heatmap.full,
    ).length;
    if (fullAfter <= fullBefore)
      throw new Error("Delayed ACK did not produce a full resync publication.");
    return {
      heldAcknowledgement,
      degradedNotices: session.controls.filter((kind) => kind === "TRANSPORT_DEGRADED").length,
      fullResyncPublications: fullAfter - fullBefore,
      finalStatus: session.client.getConnectionStatus(),
    };
  } finally {
    session.client.destroy();
  }
}

async function runFailureScenario(kind: "host-fatal" | "crash" | "messageerror") {
  const session = await createSession(`worker-${kind}`);
  session.port.holdNextCommand();
  const pending = session.client
    .dispatch(
      parseSimCommand({
        commandId: commandId(++nextCommandId),
        source: "player",
        kind: "SET_GUIDANCE_MODE",
        mode: "engineering",
      }),
    )
    .then(
      () => ({ resolved: true, code: null }),
      (error: unknown) => ({
        resolved: false,
        code:
          error !== null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN",
      }),
    );
  try {
    if (kind === "host-fatal") await session.port.control("INJECT_HOST_FATAL");
    else if (kind === "crash") await session.port.control("CRASH");
    else session.port.dispatchMessageError();
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
    const outcome = await Promise.race([
      pending,
      new Promise<{ resolved: false; code: string }>((resolve) => {
        timeoutHandle = globalThis.setTimeout(() => {
          resolve({ resolved: false, code: "WAIT_TIMEOUT" });
        }, 5_000);
      }),
    ]);
    if (timeoutHandle !== undefined) globalThis.clearTimeout(timeoutHandle);
    if (outcome.resolved || outcome.code === "WAIT_TIMEOUT") {
      throw new Error(`${kind} did not settle the pending command as outcome unknown.`);
    }
    if (session.client.getConnectionStatus() !== "degraded") {
      throw new Error(`${kind} did not degrade the GameClient connection.`);
    }
    if (session.port.terminateCount !== 1)
      throw new Error(`${kind} did not terminate the Worker once.`);
    return { kind, errorCode: outcome.code, terminatedWorkers: session.port.terminateCount };
  } finally {
    session.client.destroy();
  }
}

function percentile(samples: readonly number[], percentage: number): number {
  if (samples.length === 0) throw new Error("Performance sample set is empty.");
  const ordered = [...samples].toSorted((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(percentage * ordered.length) - 1)] ?? 0;
}

function waitForSnapshotSpeed(client: GameClient, speed: 1 | 2 | 4): Promise<void> {
  if (client.getSnapshot().header.speed === speed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let unsubscribe = (): void => undefined;
    const check = (): void => {
      if (client.getSnapshot().header.speed !== speed) return;
      unsubscribe();
      resolve();
    };
    unsubscribe = client.subscribe(check);
    check();
  });
}

async function runDiagnostics() {
  workerDiagnosticsProgress = "create dense N Worker";
  const session = await createSession("worker-diagnostics", "n");
  activeWorkerDiagnosticsPort = session.port;
  try {
    workerDiagnosticsProgress = "measure idle commands";
    const messageSamples: number[] = [];
    for (let index = 0; index < 220; index += 1) {
      const startedAt = performance.now();
      await dispatchMirrored(session, {
        kind: "SET_GUIDANCE_MODE",
        mode: index % 2 === 0 ? "engineering" : "simple",
      });
      if (index >= 20) messageSamples.push(performance.now() - startedAt);
    }
    workerDiagnosticsProgress = "measure dense direct ticks";
    const directSamples: number[] = [];
    const directState = createProductionSimCore({
      content: session.content,
      initialState: createWorkerNFixture("task-19-worker-n", session.content),
    });
    for (let index = 0; index < 100; index += 1) directState.step(1);
    for (let index = 0; index < 600; index += 1) {
      const startedAt = performance.now();
      directState.step(1);
      const elapsed = performance.now() - startedAt;
      if (index >= 100) directSamples.push(elapsed);
    }

    workerDiagnosticsProgress = "enable real Worker timers";
    await session.port.control("READ_DIAGNOSTICS");
    await session.port.control("ENABLE_AUTOMATIC_TIMING");
    await dispatchMirrored(session, { kind: "SET_SPEED", speed: 1 });
    await dispatchMirrored(session, { kind: "SET_PAUSED", paused: false });
    await session.port.control("RESET_DIAGNOSTICS");
    const combinedWarmSamples = 100;
    const combinedMeasuredSamples = 500;
    const publicationWarmSamples = 100;
    const publicationMeasuredSamples = 500;
    workerDiagnosticsProgress = "wait for real Worker due ticks";
    await session.port.control("WAIT_DUE_SAMPLES", {
      count: combinedWarmSamples + combinedMeasuredSamples,
    });
    workerDiagnosticsProgress =
      "wait for 100 warm-up and 500 measured single-step Worker publications";
    const publicationWait = session.port
      .control("WAIT_PUBLICATION_SAMPLES", {
        count: publicationWarmSamples + publicationMeasuredSamples,
      })
      .then(
        () => ({ kind: "complete" as const, error: null }),
        (error: unknown) => {
          return {
            kind: "complete" as const,
            error:
              error instanceof Error
                ? error
                : new Error("Worker publication wait failed.", { cause: error }),
          };
        },
      );
    const waitForPublicationCohort = async (): Promise<void> => {
      const outcome = await Promise.race([
        publicationWait,
        new Promise<{ kind: "progress" }>((resolve) => {
          globalThis.setTimeout(() => {
            resolve({ kind: "progress" });
          }, 10_000);
        }),
      ]);
      if (outcome.kind === "complete") {
        if (outcome.error !== null) throw outcome.error;
        return;
      }
      const publication = session.port.publications.at(-1)?.body.publication ?? null;
      workerDiagnosticsProgress = `wait for single-step Worker publications; client ${session.client.getConnectionStatus()}, visible year ${session.client.getSnapshot().header.year}, controls ${JSON.stringify(session.controls.slice(-3))}, pending ACKs ${session.port.pendingAckCount}, last publication sequence ${publication?.publicationSequence ?? "snapshot-only"} full ${publication?.heatmap.full ?? "n/a"}, listeners ${session.port.activeListenerCount}, terminated ${session.port.terminateCount}`;
      await waitForPublicationCohort();
    };
    await waitForPublicationCohort();
    workerDiagnosticsProgress = "drain Worker publication acknowledgements";
    await waitForAckIdle(session.port);
    const diagnostics = (await session.port.control("READ_DIAGNOSTICS")) as TestControlResult &
      TestMetrics;
    const singleStepDueWakes = diagnostics.dueWakeSamples.filter(
      (sample) => sample.coreStepCount === 1,
    );
    const publicationWarmupDueWakes = singleStepDueWakes.slice(0, combinedWarmSamples);
    const measuredDueWakes = singleStepDueWakes.slice(
      combinedWarmSamples,
      combinedWarmSamples + combinedMeasuredSamples,
    );
    const dueWakeSamples = measuredDueWakes.map((sample) => sample.durationMs);
    const dueWakeCoreStepCounts = measuredDueWakes.map((sample) => sample.coreStepCount);
    const singleStepPublicationPosts = diagnostics.publicationPostSamples.filter(
      (sample) => sample.wakeId !== null && sample.coreStepCount === 1,
    );
    const workerWarmupPublicationSamples = singleStepPublicationPosts.slice(
      0,
      publicationWarmSamples,
    );
    const workerPublicationSamplesForMeasuredWakes = singleStepPublicationPosts.slice(
      publicationWarmSamples,
      publicationWarmSamples + publicationMeasuredSamples,
    );
    const warmupPublicationSequences = new Set(
      workerWarmupPublicationSamples.map((sample) => sample.publicationSequence),
    );
    const measuredPublicationSequences = new Set(
      workerPublicationSamplesForMeasuredWakes.map((sample) => sample.publicationSequence),
    );
    const mainWarmupPublicationSamples = session.port.publicationProcessingMs.filter((sample) =>
      warmupPublicationSequences.has(sample.publicationSequence),
    );
    const mainPublicationSamplesForMeasuredWakes = session.port.publicationProcessingMs.filter(
      (sample) => measuredPublicationSequences.has(sample.publicationSequence),
    );
    const mainPublicationSamples = mainPublicationSamplesForMeasuredWakes.map(
      (sample) => sample.durationMs,
    );
    const workerPublicationSamples = workerPublicationSamplesForMeasuredWakes.map(
      (sample) => sample.durationMs,
    );

    const visibleLatencySamples: number[] = [];
    workerDiagnosticsProgress = "measure foreground visible latency 0/200";
    for (let index = 0; index < 220; index += 1) {
      workerDiagnosticsProgress = `measure foreground visible latency ${index}/220`;
      const speed = index % 2 === 0 ? 2 : 4;
      const command = parseSimCommand({
        commandId: commandId(++nextCommandId),
        source: "player",
        kind: "SET_SPEED",
        speed,
      });
      if (command.kind !== "SET_SPEED") throw new Error("Expected a speed command fixture.");
      const startedAt = performance.now();
      const visible = waitForSnapshotSpeed(session.client, speed);
      const actual = await session.client.dispatch(command);
      await visible;
      const visibleLatencyMs = performance.now() - startedAt;
      const directTick = session.core.getStateForSave().tick;
      const appliedAtTick = "appliedAtTick" in actual ? actual.appliedAtTick : undefined;
      if (
        typeof appliedAtTick !== "number" ||
        !Number.isSafeInteger(appliedAtTick) ||
        appliedAtTick < directTick ||
        appliedAtTick - directTick > 1_000
      ) {
        throw new Error(
          `Worker speed result has an invalid foreground tick: ${JSON.stringify(actual)}.`,
        );
      }
      session.core.step(appliedAtTick - directTick);
      const expected = session.core.applyClockCommand(command);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Worker and direct speed command results diverged after advancing the mirror to tick ${appliedAtTick}.`,
        );
      }
      await waitForAckIdle(session.port);
      if (index >= 20) visibleLatencySamples.push(visibleLatencyMs);
    }
    const summary = {
      host: navigator.userAgent,
      fixture:
        "dense N: 24x16, >=75% occupied, two Tasks, active Research, Boost, 8 Blueprints, Benchmark history",
      idleCommandResultP95Ms: percentile(messageSamples, 0.95),
      idleCommandSamples: messageSamples.length,
      directTickP95Ms: percentile(directSamples, 0.95),
      directTickSamples: directSamples.length,
      combinedWorkerTickProjectionP95Ms: percentile(dueWakeSamples, 0.95),
      combinedWorkerSamples: dueWakeSamples.length,
      publicationWarmupSingleStepSamples: workerWarmupPublicationSamples.length,
      publicationWarmupMainClientSamples: mainWarmupPublicationSamples.length,
      publicationWarmupWorkerPostMessageSamples: workerWarmupPublicationSamples.length,
      publicationMeasuredSingleStepSamples: workerPublicationSamplesForMeasuredWakes.length,
      mainClientPublicationSingleStepSamples: mainPublicationSamples.length,
      workerPostMessagePublicationSingleStepSamples: workerPublicationSamples.length,
      workerTicksPerDueWake: {
        one: dueWakeCoreStepCounts.filter((count) => count === 1).length,
        multiple: dueWakeCoreStepCounts.filter((count) => count > 1).length,
        zero: dueWakeCoreStepCounts.filter((count) => count === 0).length,
        max: Math.max(...dueWakeCoreStepCounts),
      },
      mainClientPublicationP95Ms: percentile(mainPublicationSamples, 0.95),
      mainClientPublicationSamples: mainPublicationSamples.length,
      workerPostMessagePublicationP95Ms: percentile(workerPublicationSamples, 0.95),
      workerPostMessagePublicationSamples: workerPublicationSamples.length,
      foregroundCommandVisibleLatencyP95Ms: percentile(visibleLatencySamples, 0.95),
      foregroundCommandVisibleLatencySamples: visibleLatencySamples.length,
      publicationsProcessed: mainPublicationSamples.length,
    };
    if (
      messageSamples.length !== 200 ||
      directSamples.length !== 500 ||
      dueWakeSamples.length !== 500 ||
      publicationWarmupDueWakes.length !== 100 ||
      mainWarmupPublicationSamples.length !== 100 ||
      workerWarmupPublicationSamples.length !== 100 ||
      measuredDueWakes.length !== 500 ||
      mainPublicationSamples.length !== 500 ||
      workerPublicationSamples.length !== 500 ||
      visibleLatencySamples.length !== 200
    ) {
      throw new Error(`Performance diagnostic sample count mismatch: ${JSON.stringify(summary)}`);
    }
    if (summary.idleCommandResultP95Ms >= 10)
      throw new Error(`Idle command Worker round-trip budget missed: ${JSON.stringify(summary)}`);
    if (summary.directTickP95Ms >= 4)
      throw new Error(`Direct production tick budget missed: ${JSON.stringify(summary)}`);
    if (summary.combinedWorkerTickProjectionP95Ms >= 6)
      throw new Error(`Combined Worker tick/projection budget missed: ${JSON.stringify(summary)}`);
    if (summary.mainClientPublicationP95Ms >= 5)
      throw new Error(
        `Main-thread publication processing budget missed: ${JSON.stringify(summary)}`,
      );
    if (summary.foregroundCommandVisibleLatencyP95Ms >= 200)
      throw new Error(`Foreground visible-command budget missed: ${JSON.stringify(summary)}`);
    workerDiagnosticsProgress = "complete";
    return summary;
  } finally {
    session.client.destroy();
    activeWorkerDiagnosticsPort = null;
  }
}

async function waitForAckIdle(port: ManualWorkerPort): Promise<void> {
  await port.waitForAckIdle();
}

async function runDestroyCycles() {
  const counts: { listenersAfterDestroy: number; terminatedWorkers: number }[] = [];
  for (let index = 0; index < 20; index += 1) {
    const session = await createSession(`worker-destroy-cycle-${index}`);
    const port = session.port;
    session.client.destroy();
    counts.push({
      listenersAfterDestroy: port.activeListenerCount,
      terminatedWorkers: port.terminateCount,
    });
  }
  if (counts.some((entry) => entry.listenersAfterDestroy !== 0 || entry.terminatedWorkers !== 1)) {
    throw new Error(`Worker destroy cycles leaked listeners or Workers: ${JSON.stringify(counts)}`);
  }
  return { cycles: counts.length, counts };
}

declare global {
  interface Window {
    __workerManualHarness?: {
      runParityScenario(): Promise<unknown>;
      runResyncScenario(): Promise<unknown>;
      runFailureScenario(kind: "host-fatal" | "crash" | "messageerror"): Promise<unknown>;
      runDiagnostics(): Promise<unknown>;
      getDiagnosticsProgress(): string;
      runDestroyCycles(): Promise<unknown>;
    };
  }
}

window.__workerManualHarness = {
  runParityScenario,
  runResyncScenario,
  runFailureScenario,
  runDiagnostics,
  getDiagnosticsProgress: () =>
    activeWorkerDiagnosticsPort === null
      ? workerDiagnosticsProgress
      : `${workerDiagnosticsProgress}; ${activeWorkerDiagnosticsPort.fixtureProgress ?? "waiting for Worker progress"}`,
  runDestroyCycles,
};
