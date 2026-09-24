import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createSimWorkerHost } from "../../src/app/worker/simWorkerHost.ts";
import { parseSimCommand } from "../../src/sim/commands/commandSchema.ts";
import {
  parseWorkerReply,
  type WorkerReply,
  type WorkerRequest,
} from "../../src/app/worker/protocol.ts";
import {
  createWorkerGameClient,
  type ClientTimingAdapter,
  type ClientVisibilityAdapter,
  type WorkerPort,
} from "../../src/app/game-client/workerGameClient.ts";

const content = loadContentBundle();
const EPOCH = "client-test-epoch";

class ManualClock {
  private nowMs = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { due: number; callback: () => void }>();

  readonly adapter: ClientTimingAdapter = {
    now: () => this.nowMs,
    setTimeout: (callback, delayMs) => {
      const id = ++this.nextId;
      this.timers.set(id, { due: this.nowMs + delayMs, callback });
      return id;
    },
    clearTimeout: (handle) => {
      if (typeof handle === "number") this.timers.delete(handle);
    },
  };

  advanceBy(milliseconds: number): void {
    const target = this.nowMs + milliseconds;
    for (let count = 0; count < 10_000; count += 1) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .toSorted((left, right) => left[1].due - right[1].due)[0];
      if (next === undefined) break;
      this.nowMs = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.nowMs = target;
  }

  pendingCount(): number {
    return this.timers.size;
  }
}

class ManualVisibility {
  private visible = true;
  private readonly listeners = new Set<() => void>();

  readonly adapter: ClientVisibilityAdapter = {
    isVisible: () => this.visible,
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

type MessageListener = (event: MessageEvent<unknown>) => void;
type WorkerErrorListener = (event: Event) => void;

class LoopbackWorker implements WorkerPort {
  readonly requests: WorkerRequest[] = [];
  readonly replies: WorkerReply[] = [];
  readonly messageListeners = new Set<MessageListener>();
  readonly errorListeners = new Set<WorkerErrorListener>();
  readonly messageErrorListeners = new Set<WorkerErrorListener>();
  private outboundSequence = 0;
  private suppressReplies = false;
  private nextPublicationTransform: ((reply: WorkerReply) => WorkerReply) | null = null;
  private nextEventBatchTransform: ((reply: WorkerReply) => WorkerReply) | null = null;
  private nextCommandResultTransform: ((reply: WorkerReply) => WorkerReply) | null = null;
  private fatalOnNextCommand = false;
  terminated = false;
  terminationCount = 0;
  readonly host: ReturnType<typeof createSimWorkerHost>;

  constructor(readonly clock: ManualClock) {
    this.host = createSimWorkerHost({
      content,
      timing: clock.adapter,
      postMessage: (reply) => {
        this.deliver(reply);
      },
    });
  }

  postMessage(message: WorkerRequest): void {
    this.requests.push(message);
    void this.host.receive(structuredClone(message));
    if (this.fatalOnNextCommand && message.kind === "COMMAND") {
      this.fatalOnNextCommand = false;
      this.injectFatal();
    }
  }

  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(type: "error" | "messageerror", listener: WorkerErrorListener): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | WorkerErrorListener,
  ): void {
    if (type === "message") this.messageListeners.add(listener);
    else if (type === "error") this.errorListeners.add(listener as WorkerErrorListener);
    else this.messageErrorListeners.add(listener as WorkerErrorListener);
  }

  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "error" | "messageerror", listener: WorkerErrorListener): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | WorkerErrorListener,
  ): void {
    if (type === "message") this.messageListeners.delete(listener);
    else if (type === "error") this.errorListeners.delete(listener as WorkerErrorListener);
    else this.messageErrorListeners.delete(listener as WorkerErrorListener);
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.terminationCount += 1;
    this.host.destroy();
  }

  suppressIncomingReplies(suppress: boolean): void {
    this.suppressReplies = suppress;
  }

  corruptNextPublication(transform: (reply: WorkerReply) => WorkerReply): void {
    this.nextPublicationTransform = transform;
  }

  transformNextEventBatch(transform: (reply: WorkerReply) => WorkerReply): void {
    this.nextEventBatchTransform = transform;
  }

  transformNextCommandResult(transform: (reply: WorkerReply) => WorkerReply): void {
    this.nextCommandResultTransform = transform;
  }

  injectLateForeignEpochReply(): void {
    const reply = parseWorkerReply({
      protocolVersion: 1,
      epoch: "old-client-epoch",
      outboundSequence: Number.MAX_SAFE_INTEGER,
      requestSequence: 3,
      kind: "REQUEST_RESULT",
      body: { result: { kind: "snapshot", tick: 0 } },
    });
    for (const listener of [...this.messageListeners])
      listener({ data: reply } as MessageEvent<unknown>);
  }

  injectFatalOnNextCommand(): void {
    this.fatalOnNextCommand = true;
  }

  private injectFatal(): void {
    const reply = parseWorkerReply({
      protocolVersion: 1,
      epoch: EPOCH,
      outboundSequence: this.outboundSequence,
      requestSequence: null,
      kind: "FATAL_ERROR",
      body: {
        code: "WORKER_ERROR",
        tick: 0,
        stage: null,
        reportId: `${EPOCH}-fatal-0`,
      },
    });
    this.outboundSequence += 1;
    this.deliver(reply);
  }

  private deliver(input: WorkerReply): void {
    this.replies.push(input);
    this.outboundSequence = input.outboundSequence + 1;
    if (this.suppressReplies || this.terminated) return;
    let reply = input;
    if (
      this.nextPublicationTransform !== null &&
      input.kind === "SNAPSHOT_PUBLICATION" &&
      input.body.publication !== null
    ) {
      reply = this.nextPublicationTransform(input);
      this.nextPublicationTransform = null;
    }
    if (this.nextEventBatchTransform !== null && input.kind === "EVENT_BATCH") {
      reply = this.nextEventBatchTransform(reply);
      this.nextEventBatchTransform = null;
    }
    if (this.nextCommandResultTransform !== null && input.kind === "COMMAND_RESULT") {
      reply = this.nextCommandResultTransform(reply);
      this.nextCommandResultTransform = null;
    }
    for (const listener of [...this.messageListeners]) {
      listener({ data: structuredClone(reply) } as MessageEvent<unknown>);
    }
  }
}

interface ClientHarness {
  readonly client: Awaited<ReturnType<typeof createWorkerGameClient>>;
  readonly worker: LoopbackWorker;
  readonly clock: ManualClock;
  readonly visibility: ManualVisibility;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function createHarness(requestTimeoutMs = 5_000): Promise<ClientHarness> {
  const clock = new ManualClock();
  const visibility = new ManualVisibility();
  const worker = new LoopbackWorker(clock);
  const client = await createWorkerGameClient({
    content,
    seed: "worker-client-test",
    epoch: EPOCH,
    requestTimeoutMs,
    workerFactory: () => worker,
    timing: clock.adapter,
    visibility: visibility.adapter,
  });
  return { client, worker, clock, visibility };
}

function guidanceCommand(commandId: string) {
  return { commandId, source: "player", kind: "SET_GUIDANCE_MODE", mode: "skip" } as const;
}

function enterDesignModeCommand(commandId: string) {
  return { commandId, source: "player", kind: "ENTER_DESIGN_MODE" } as const;
}

function rejectedBuyCommand(commandId: string) {
  return {
    commandId,
    source: "player",
    kind: "BUY_MODULE",
    definitionId: "missing-module",
    quantity: 1,
  } as const;
}

describe("real Worker GameClient transport adapter", () => {
  test("initializes from READY, applies before ACK, and settles each command exactly once", async () => {
    const harness = await createHarness();
    const { client, worker } = harness;
    expect(client.getSnapshot().tick).toBe(0);
    expect(client.getConnectionStatus()).toBe("live");
    expect(worker.requests.map((request) => request.kind)).toEqual([
      "INITIALIZE_NEW",
      "ACK_PUBLICATION",
      "ACK_RESULT",
      "ACK_RESULT",
    ]);

    const facts: unknown[] = [];
    client.subscribeEvents((event) => facts.push(event));
    const result = await client.dispatch(
      rejectedBuyCommand("76000000-0000-4000-8000-000000000021"),
    );
    await flushMicrotasks();
    expect(result.accepted).toBe(false);
    expect(worker.replies.filter((reply) => reply.kind === "COMMAND_RESULT")).toHaveLength(1);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "COMMAND_REJECTED", eventId: `${EPOCH}-event-0` });
    expect(worker.requests.filter((request) => request.kind === "COMMAND")).toHaveLength(1);
    client.destroy();
  });

  test("discards a late foreign-epoch result before sequence correlation", async () => {
    const harness = await createHarness();
    harness.worker.injectLateForeignEpochReply();
    expect(harness.client.getConnectionStatus()).toBe("live");
    expect(harness.client.getSnapshot().tick).toBe(0);
    harness.client.destroy();
  });

  test("rejects a schema-valid command result with the wrong echoed command ID immediately", async () => {
    const harness = await createHarness();
    harness.worker.transformNextCommandResult((reply) => {
      if (reply.kind !== "COMMAND_RESULT") return reply;
      return parseWorkerReply({
        ...reply,
        body: { ...reply.body, commandId: "76000000-0000-4000-8000-000000000099" },
      });
    });

    await expect(
      harness.client.dispatch(guidanceCommand("76000000-0000-4000-8000-000000000031")),
    ).rejects.toMatchObject({ code: "INVALID_REPLY" });
    expect(harness.client.getConnectionStatus()).toBe("degraded");
    expect(harness.worker.terminated).toBe(true);
    harness.client.destroy();
  });

  test("validates command descriptors before reading an accessor", async () => {
    const harness = await createHarness();
    let getterCalled = false;
    const commandWithAccessor = Object.defineProperty(
      { source: "player", kind: "SET_GUIDANCE_MODE", mode: "skip" },
      "commandId",
      {
        enumerable: true,
        get() {
          getterCalled = true;
          throw new Error("commandId getter ran");
        },
      },
    );

    await expect(harness.client.dispatch(commandWithAccessor as never)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(getterCalled).toBe(false);
    expect(harness.worker.requests.filter((request) => request.kind === "COMMAND")).toHaveLength(0);
    harness.client.destroy();
  });

  test("marks a timed-out command outcome unknown and never resubmits the command", async () => {
    const harness = await createHarness(50);
    harness.worker.suppressIncomingReplies(true);
    const outcome = harness.client
      .dispatch(guidanceCommand("76000000-0000-4000-8000-000000000022"))
      .then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
    await flushMicrotasks();
    harness.clock.advanceBy(51);
    const settled = await outcome;
    expect(settled.error).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(harness.worker.requests.filter((request) => request.kind === "COMMAND")).toHaveLength(1);
    harness.client.destroy();
  });

  test("requests a full snapshot after a dropped-base delta and recovers atomically", async () => {
    const harness = await createHarness();
    await harness.client.dispatch(enterDesignModeCommand("76000000-0000-4000-8000-000000000023"));
    harness.clock.advanceBy(100);
    await flushMicrotasks();
    harness.worker.corruptNextPublication((reply) => {
      if (reply.kind !== "SNAPSHOT_PUBLICATION" || reply.body.publication === null) return reply;
      return parseWorkerReply({
        ...reply,
        body: {
          ...reply.body,
          publication: { ...reply.body.publication, baseGridRevision: 0 },
        },
      });
    });
    await harness.client.dispatch(
      parseSimCommand({
        commandId: "76000000-0000-4000-8000-000000000028",
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: "module-vacuum-tube-logic",
        position: { x: 1, y: 1 },
        rotation: 0,
      }),
    );
    harness.clock.advanceBy(100);
    await flushMicrotasks();
    expect(
      harness.worker.requests.some((request) => request.kind === "REQUEST_FULL_SNAPSHOT"),
    ).toBe(true);
    harness.clock.advanceBy(1_001);
    await flushMicrotasks();
    expect(harness.client.getConnectionStatus()).toBe("live");
    expect(harness.client.getSnapshot().tick).toBe(0);
    harness.client.destroy();
  });

  test("surfaces a fact sequence gap and uses a full snapshot for display recovery", async () => {
    const harness = await createHarness();
    const notices: unknown[] = [];
    const facts: unknown[] = [];
    harness.client.subscribeControl((notice) => notices.push(notice));
    harness.client.subscribeEvents((event) => facts.push(event));
    harness.worker.transformNextEventBatch((reply) => {
      if (reply.kind !== "EVENT_BATCH") return reply;
      return parseWorkerReply({
        ...reply,
        body: {
          firstEventSequence: 1,
          events: reply.body.events.map((item) => ({
            ...item,
            eventSequence: item.eventSequence + 1,
          })),
        },
      });
    });
    await harness.client.dispatch(rejectedBuyCommand("76000000-0000-4000-8000-000000000027"));
    await flushMicrotasks();
    expect(notices).toEqual([{ kind: "EVENTS_GAP", nextEventSequence: 2 }]);
    expect(facts).toHaveLength(0);
    expect(
      harness.worker.requests.some((request) => request.kind === "REQUEST_FULL_SNAPSHOT"),
    ).toBe(true);
    harness.client.destroy();
  });

  test("fatal control bypasses a pending command and closes further admission", async () => {
    const harness = await createHarness();
    harness.worker.injectFatalOnNextCommand();
    const outcome = harness.client
      .dispatch(guidanceCommand("76000000-0000-4000-8000-000000000024"))
      .then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
    expect((await outcome).error).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await expect(
      harness.client.dispatch(guidanceCommand("76000000-0000-4000-8000-000000000025")),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(harness.worker.terminated).toBe(true);
    expect(harness.visibility.listenerCount()).toBe(0);
    expect(harness.worker.messageListeners.size).toBe(0);
    expect(harness.worker.errorListeners.size).toBe(0);
    expect(harness.worker.messageErrorListeners.size).toBe(0);
    harness.client.destroy();
    expect(harness.worker.terminationCount).toBe(1);
  });

  test("isolates throwing snapshot, fact and status observers", async () => {
    const harness = await createHarness();
    harness.client.subscribe(() => {
      throw new Error("snapshot observer");
    });
    harness.client.subscribeEvents(() => {
      throw new Error("fact observer");
    });
    harness.client.subscribeConnection(() => {
      throw new Error("status observer");
    });
    await expect(
      harness.client.dispatch(rejectedBuyCommand("76000000-0000-4000-8000-000000000026")),
    ).resolves.toMatchObject({ accepted: false });
    expect(harness.client.getConnectionStatus()).toBe("live");
    expect(harness.client.getSnapshot().tick).toBe(0);
    harness.client.destroy();
  });

  test("suspends heartbeat timeout while hidden and enforces the declared maintenance bound", async () => {
    const hidden = await createHarness(1_000);
    hidden.visibility.setVisible(false);
    await flushMicrotasks();
    hidden.clock.advanceBy(6_000);
    expect(hidden.client.getConnectionStatus()).toBe("live");
    hidden.visibility.setVisible(true);
    await flushMicrotasks();
    hidden.clock.advanceBy(1_000);
    await flushMicrotasks();
    expect(hidden.client.getConnectionStatus()).toBe("live");
    hidden.client.destroy();

    const maintenance = await createHarness(10_000);
    const held = maintenance.worker.host.runMaintenance(() => new Promise<void>(() => undefined));
    await flushMicrotasks();
    maintenance.clock.advanceBy(6_001);
    expect(maintenance.client.getConnectionStatus()).toBe("degraded");
    expect(maintenance.worker.terminated).toBe(true);
    void held.catch(() => undefined);
  });

  test("destroy removes listeners, timers and the Worker", async () => {
    const harness = await createHarness();
    harness.client.subscribe(() => undefined);
    harness.client.subscribeEvents(() => undefined);
    harness.client.destroy();
    expect(harness.visibility.listenerCount()).toBe(0);
    expect(harness.worker.terminated).toBe(true);
    expect(harness.worker.messageListeners.size).toBe(0);
    expect(harness.worker.errorListeners.size).toBe(0);
    expect(harness.worker.messageErrorListeners.size).toBe(0);
    expect(harness.clock.pendingCount()).toBe(0);
  });
});
