import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";
import type { CommandResult, SimCommand } from "../../sim/commands/contracts.ts";
import type { SimEvent } from "../../sim/events/contracts.ts";
import type { GridViewModel, UiSnapshot } from "./snapshots.ts";
import type { GameClient, GameClientControlNotice, SaveMetadata, SaveReason } from "./contracts.ts";
import { createGameClientStore, type StoreConnectionStatus } from "./store.ts";
import {
  MAX_OUTSTANDING_REQUESTS,
  createReplySequenceGuard,
  createRequestCorrelator,
  createRequestLedger,
  parseWorkerRequest,
  parseWorkerReply,
  workerRequestByteLength,
  workerRequestCategory,
  type WorkerReply,
  type WorkerRequest,
  type WorkerRequestKind,
} from "../worker/protocol.ts";

const REQUEST_TIMEOUT_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const MAX_EVENT_BATCH_BUFFER = 512;

export interface ClientTimingAdapter {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ClientVisibilityAdapter {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface WorkerPort {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  terminate(): void;
}

export interface WorkerGameClientOptions {
  readonly content: ContentBundle;
  readonly seed: string;
  readonly epoch?: string;
  readonly requestTimeoutMs?: number;
  readonly workerFactory?: () => WorkerPort;
  readonly timing?: ClientTimingAdapter;
  readonly visibility?: ClientVisibilityAdapter;
}

export class WorkerGameClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkerGameClientError";
    this.code = code;
  }
}

interface PendingCall {
  readonly kind: WorkerRequestKind;
  readonly commandId: string | null;
  readonly resolve: (reply: WorkerReply) => void;
  readonly reject: (error: WorkerGameClientError) => void;
  timeout: unknown;
}

function browserTiming(): ClientTimingAdapter {
  return {
    now: () => globalThis.performance.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as number);
    },
  };
}

function browserVisibility(): ClientVisibilityAdapter {
  if (typeof document === "undefined") {
    return { isVisible: () => true, subscribe: () => () => undefined };
  }
  return {
    isVisible: () => document.visibilityState !== "hidden",
    subscribe(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => {
        document.removeEventListener("visibilitychange", listener);
      };
    },
  };
}

function createBrowserWorker(): WorkerPort {
  if (typeof Worker === "undefined") {
    throw new WorkerGameClientError("WORKER_UNAVAILABLE", "Dedicated Workers are unavailable.");
  }
  return new Worker(new URL("../worker/entry.ts", import.meta.url), {
    type: "module",
    name: "overclock-simulator",
  });
}

function createEpoch(): string {
  if (typeof globalThis.crypto.randomUUID !== "function") {
    throw new WorkerGameClientError(
      "CRYPTO_UNAVAILABLE",
      "Secure session identifiers are unavailable.",
    );
  }
  return globalThis.crypto.randomUUID();
}

function makeError(code: string, message: string): WorkerGameClientError {
  return new WorkerGameClientError(code, message);
}

export async function createWorkerGameClient(
  options: WorkerGameClientOptions,
): Promise<GameClient> {
  const worker = (options.workerFactory ?? createBrowserWorker)();
  const timing = options.timing ?? browserTiming();
  const visibility = options.visibility ?? browserVisibility();
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const epoch = options.epoch ?? createEpoch();
  const fingerprint = hashSimulationContent(options.content);
  const store = createGameClientStore();
  const correlator = createRequestCorrelator();
  correlator.reset(epoch);
  const replySequence = createReplySequenceGuard(epoch);
  const ledger = createRequestLedger();
  const pending = new Map<number, PendingCall>();
  const eventListeners = new Set<(event: SimEvent) => void>();
  const controlListeners = new Set<(notice: GameClientControlNotice) => void>();
  const connectionListeners = new Set<() => void>();

  let requestSequence: number | null = 0;
  let eventSequence = 0;
  let connectionStatus: StoreConnectionStatus = "disconnected";
  let readyReceived = false;
  let disposed = false;
  let fatalError: WorkerGameClientError | null = null;
  let visible = visibility.isVisible();
  let lastHeartbeatAtMs: number | null = null;
  let lastHeartbeatLifecycle: string | null = null;
  let maintenanceStartedAtMs: number | null = null;
  let heartbeatTimer: unknown = null;
  let fullResyncPending = false;
  let workerListenersAttached = true;
  let workerTerminated = false;
  let unsubscribeVisibility = (): void => undefined;
  let resolveReadyAcknowledgement!: () => void;
  let rejectReadyAcknowledgement!: (error: WorkerGameClientError) => void;
  const readyAcknowledgement = new Promise<void>((resolve, reject) => {
    resolveReadyAcknowledgement = resolve;
    rejectReadyAcknowledgement = reject;
  });
  // The handshake awaits this promise after INITIALIZE_NEW settles. Keep an
  // early Worker failure from becoming an unhandled rejection in that gap.
  void readyAcknowledgement.catch(() => undefined);

  function updateConnectionStatus(next: StoreConnectionStatus): void {
    if (connectionStatus === next) return;
    connectionStatus = next;
    store.setConnectionStatus(next);
    for (const listener of [...connectionListeners]) {
      try {
        listener();
      } catch {
        // A status observer cannot break protocol handling.
      }
    }
  }

  function publishControl(notice: GameClientControlNotice): void {
    for (const listener of [...controlListeners]) {
      try {
        listener(notice);
      } catch {
        // Control observers are isolated from the transport.
      }
    }
  }

  function publishEvent(event: SimEvent): void {
    for (const listener of [...eventListeners]) {
      try {
        listener(event);
      } catch {
        // A throwing event observer cannot suppress later committed facts.
      }
    }
  }

  function clearHeartbeatWatchdog(): void {
    if (heartbeatTimer !== null) timing.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  function detachWorker(): void {
    clearHeartbeatWatchdog();
    unsubscribeVisibility();
    if (workerListenersAttached) {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      workerListenersAttached = false;
    }
    if (!workerTerminated) {
      workerTerminated = true;
      worker.terminate();
    }
  }

  function removePending(sequence: number): PendingCall | undefined {
    const call = pending.get(sequence);
    if (call === undefined) return undefined;
    pending.delete(sequence);
    if (call.timeout !== null) timing.clearTimeout(call.timeout);
    call.timeout = null;
    ledger.release(sequence);
    return call;
  }

  function failPending(error: WorkerGameClientError): void {
    for (const [sequence, call] of [...pending]) {
      correlator.cancel(epoch, sequence);
      removePending(sequence);
      call.reject(error);
    }
  }

  function failClient(error: WorkerGameClientError, terminate = true): void {
    if (fatalError !== null || disposed) return;
    fatalError = error;
    updateConnectionStatus("degraded");
    failPending(error);
    rejectReadyAcknowledgement(error);
    if (terminate) detachWorker();
  }

  function timeoutAt(): number {
    const heartbeatAt = lastHeartbeatAtMs ?? timing.now();
    if (lastHeartbeatLifecycle === "MAINTENANCE" && maintenanceStartedAtMs !== null) {
      return maintenanceStartedAtMs + HEARTBEAT_TIMEOUT_MS;
    }
    return heartbeatAt + HEARTBEAT_TIMEOUT_MS;
  }

  function checkHeartbeat(): void {
    heartbeatTimer = null;
    if (disposed || fatalError !== null || !visible || lastHeartbeatAtMs === null) return;
    const remainingMs = timeoutAt() - timing.now();
    if (remainingMs <= 0) {
      const error = makeError(
        "OUTCOME_UNKNOWN",
        "The Worker heartbeat timed out; pending request outcomes are unknown.",
      );
      failClient(error);
      return;
    }
    heartbeatTimer = timing.setTimeout(checkHeartbeat, remainingMs + 1);
  }

  function scheduleHeartbeatWatchdog(): void {
    clearHeartbeatWatchdog();
    if (!readyReceived || disposed || fatalError !== null || !visible) return;
    heartbeatTimer = timing.setTimeout(checkHeartbeat, Math.max(0, timeoutAt() - timing.now()) + 1);
  }

  function requestFullResync(): void {
    if (!readyReceived || disposed || fatalError !== null || fullResyncPending) return;
    fullResyncPending = true;
    updateConnectionStatus("resync-required");
    void sendRequest("REQUEST_FULL_SNAPSHOT", {}, false).catch(() => {
      fullResyncPending = false;
      updateConnectionStatus("degraded");
    });
  }

  function settleCall(reply: WorkerReply): void {
    let settled: ReturnType<typeof correlator.settle>;
    try {
      settled = correlator.settle(reply);
    } catch (error) {
      failClient(
        makeError(
          "INVALID_REPLY",
          error instanceof Error ? error.message : "Worker reply did not match its request.",
        ),
      );
      return;
    }
    if (!settled.matched || reply.requestSequence === null) return;
    const call = removePending(reply.requestSequence);
    if (call === undefined) return;
    if (reply.kind === "REQUEST_ERROR") {
      const error = makeError(reply.body.code, `Worker request failed: ${reply.body.code}.`);
      call.reject(error);
      if (reply.body.code === "OUTCOME_UNKNOWN" || reply.body.code === "FATAL") {
        failClient(error);
      }
      return;
    }
    call.resolve(reply);
  }

  function acknowledgeTerminalReply(reply: WorkerReply): void {
    if (reply.requestSequence === null || !isTerminalResultKind(reply.kind)) return;
    if (disposed || fatalError !== null) return;
    if (requestSequence === null) {
      failClient(makeError("SEQUENCE_EXHAUSTED", "Start a new Worker epoch."));
      return;
    }
    const sequence = requestSequence;
    let request: WorkerRequest;
    try {
      request = parseWorkerRequest({
        protocolVersion: 1,
        epoch,
        requestSequence: sequence,
        kind: "ACK_RESULT",
        body: { outboundSequence: reply.outboundSequence },
      });
    } catch (error) {
      failClient(
        makeError(
          "INVALID_REQUEST",
          error instanceof Error ? error.message : "Unable to acknowledge the Worker result.",
        ),
      );
      return;
    }
    const reserved = ledger.reserve(sequence, workerRequestByteLength(request));
    if (!reserved.accepted) {
      failClient(
        makeError(reserved.reason, `Worker result acknowledgement failed: ${reserved.reason}.`),
      );
      return;
    }
    try {
      worker.postMessage(request);
      requestSequence = sequence === Number.MAX_SAFE_INTEGER ? null : sequence + 1;
    } catch (error) {
      failClient(
        makeError(
          "WORKER_ERROR",
          error instanceof Error ? error.message : "Unable to acknowledge the Worker result.",
        ),
      );
    } finally {
      ledger.release(sequence);
    }
  }

  function isTerminalResultKind(kind: WorkerReply["kind"]): boolean {
    return (
      kind === "READY" ||
      kind === "COMMAND_RESULT" ||
      kind === "REQUEST_RESULT" ||
      kind === "REQUEST_ERROR" ||
      kind === "SAVE_COMMITTED" ||
      kind === "SESSION_REPLACED" ||
      kind === "SHUTDOWN_COMPLETE"
    );
  }

  function sendRequest(
    kind: WorkerRequestKind,
    body: unknown,
    resyncOnTimeout = true,
  ): Promise<WorkerReply> {
    if (disposed) return Promise.reject(makeError("STOPPED", "The GameClient has been destroyed."));
    if (fatalError !== null) return Promise.reject(fatalError);
    if (!readyReceived && kind !== "INITIALIZE_NEW") {
      return Promise.reject(makeError("NOT_READY", "The Worker handshake is not complete."));
    }
    if (requestSequence === null) {
      return Promise.reject(makeError("SEQUENCE_EXHAUSTED", "Start a new Worker epoch."));
    }
    if (pending.size >= MAX_OUTSTANDING_REQUESTS) {
      return Promise.reject(makeError("BUSY", "Too many requests are already in flight."));
    }

    const sequence = requestSequence;
    let request: WorkerRequest;
    try {
      request = parseWorkerRequest({
        protocolVersion: 1,
        epoch,
        requestSequence: sequence,
        kind,
        body,
      });
    } catch (error) {
      return Promise.reject(
        makeError(
          "INVALID_REQUEST",
          error instanceof Error ? error.message : "Invalid Worker request.",
        ),
      );
    }
    const commandId = request.kind === "COMMAND" ? request.body.command.commandId : null;
    const reserved = ledger.reserve(
      sequence,
      workerRequestByteLength(request),
      workerRequestCategory(request),
    );
    if (!reserved.accepted) {
      return Promise.reject(
        makeError(reserved.reason, `Worker request limit reached: ${reserved.reason}.`),
      );
    }

    let resolveCall!: (reply: WorkerReply) => void;
    let rejectCall!: (error: WorkerGameClientError) => void;
    const result = new Promise<WorkerReply>((resolve, reject) => {
      resolveCall = resolve;
      rejectCall = reject;
    });
    try {
      correlator.add(epoch, sequence, commandId ?? undefined);
      const call: PendingCall = {
        kind,
        commandId,
        resolve: resolveCall,
        reject: rejectCall,
        timeout: null,
      };
      pending.set(sequence, call);
      call.timeout = timing.setTimeout(() => {
        const expired = removePending(sequence);
        if (expired === undefined) return;
        correlator.cancel(epoch, sequence);
        const timeoutError = makeError(
          "OUTCOME_UNKNOWN",
          `Worker request ${kind} timed out; its outcome is unknown and it was not repeated.`,
        );
        expired.reject(timeoutError);
        updateConnectionStatus("degraded");
        if (resyncOnTimeout && kind !== "REQUEST_FULL_SNAPSHOT" && kind !== "SHUTDOWN") {
          requestFullResync();
        }
      }, requestTimeoutMs);
      worker.postMessage(request);
      requestSequence = sequence === Number.MAX_SAFE_INTEGER ? null : sequence + 1;
    } catch (error) {
      correlator.cancel(epoch, sequence);
      const call = removePending(sequence);
      const transportError = makeError(
        "WORKER_ERROR",
        error instanceof Error ? error.message : "Unable to send the Worker request.",
      );
      call?.reject(transportError);
      ledger.release(sequence);
      failClient(transportError);
    }
    return result;
  }

  function acknowledgePublication(publicationSequence: number, initial: boolean): void {
    void sendRequest("ACK_PUBLICATION", { publicationSequence }, false)
      .then((reply) => {
        if (reply.kind !== "REQUEST_RESULT" || reply.body.result.kind !== "snapshot") {
          throw makeError(
            "INVALID_REPLY",
            "Worker did not confirm the publication acknowledgement.",
          );
        }
        if (fullResyncPending) fullResyncPending = false;
        updateConnectionStatus("live");
        if (initial) resolveReadyAcknowledgement();
      })
      .catch((error: unknown) => {
        const acknowledgementError =
          error instanceof WorkerGameClientError
            ? error
            : makeError("OUTCOME_UNKNOWN", "Publication acknowledgement outcome is unknown.");
        updateConnectionStatus("degraded");
        if (initial) failClient(acknowledgementError);
        else requestFullResync();
      });
  }

  function applyPublication(
    reply: Extract<WorkerReply, { kind: "READY" | "SNAPSHOT_PUBLICATION" }>,
  ): void {
    try {
      const publication = reply.body.publication;
      const applied = store.applyPublication({
        epoch: reply.epoch,
        snapshot: reply.body.snapshot,
        grid: publication,
      });
      if (!applied.applied) {
        if (applied.reason === "resync-required") requestFullResync();
        return;
      }
      if (publication !== null) {
        acknowledgePublication(publication.publicationSequence, reply.kind === "READY");
      }
    } catch (error) {
      failClient(
        makeError(
          "INVALID_PUBLICATION",
          error instanceof Error ? error.message : "Invalid Worker publication.",
        ),
      );
    }
  }

  function handleEventBatch(reply: Extract<WorkerReply, { kind: "EVENT_BATCH" }>): void {
    const events = reply.body.events;
    if (reply.body.firstEventSequence !== eventSequence) {
      const next = events.at(-1)?.eventSequence;
      eventSequence = next === undefined ? reply.body.firstEventSequence : next + 1;
      publishControl({ kind: "EVENTS_GAP", nextEventSequence: eventSequence });
      requestFullResync();
      return;
    }
    if (events.length > MAX_EVENT_BATCH_BUFFER) {
      publishControl({ kind: "EVENTS_GAP", nextEventSequence: eventSequence });
      requestFullResync();
      return;
    }
    for (const envelope of events) {
      if (envelope.eventSequence !== eventSequence) {
        eventSequence = envelope.eventSequence;
        publishControl({ kind: "EVENTS_GAP", nextEventSequence: eventSequence });
        requestFullResync();
        return;
      }
      eventSequence += 1;
      publishEvent(envelope.event);
    }
  }

  function onMessage(event: MessageEvent<unknown>): void {
    if (disposed || fatalError !== null) return;
    let reply: WorkerReply;
    try {
      reply = parseWorkerReply(event.data);
    } catch (error) {
      failClient(
        makeError(
          "INVALID_REPLY",
          error instanceof Error ? error.message : "Malformed Worker reply.",
        ),
      );
      return;
    }
    if (reply.epoch !== epoch) return;
    const accepted = replySequence.accept(reply);
    if (!accepted.accepted) {
      failClient(makeError("INVALID_REPLY_SEQUENCE", "Worker reply sequence is not monotonic."));
      return;
    }
    if (reply.kind === "HEARTBEAT") {
      lastHeartbeatAtMs = timing.now();
      if (reply.body.lifecycle === "MAINTENANCE") {
        maintenanceStartedAtMs ??= lastHeartbeatAtMs;
      } else {
        maintenanceStartedAtMs = null;
      }
      lastHeartbeatLifecycle = reply.body.lifecycle;
      scheduleHeartbeatWatchdog();
      return;
    }
    if (reply.kind === "READY") {
      readyReceived = true;
      lastHeartbeatAtMs = timing.now();
      lastHeartbeatLifecycle = reply.body.lifecycle;
      updateConnectionStatus("resync-required");
      applyPublication(reply);
      settleCall(reply);
      acknowledgeTerminalReply(reply);
      scheduleHeartbeatWatchdog();
      if (!visible) {
        void sendRequest("SET_HOST_VISIBILITY", { visible: false }, false).catch(() => {
          updateConnectionStatus("degraded");
        });
      }
      return;
    }
    if (reply.kind === "SNAPSHOT_PUBLICATION") {
      applyPublication(reply);
      if (reply.requestSequence !== null) settleCall(reply);
      return;
    }
    if (reply.kind === "EVENT_BATCH") {
      handleEventBatch(reply);
      return;
    }
    if (reply.kind === "EVENTS_GAP") {
      eventSequence = reply.body.nextEventSequence;
      publishControl({ kind: "EVENTS_GAP", nextEventSequence: eventSequence });
      requestFullResync();
      return;
    }
    if (reply.kind === "TRANSPORT_DEGRADED") {
      publishControl({
        kind: "TRANSPORT_DEGRADED",
        publicationSequence: reply.body.publicationSequence,
      });
      updateConnectionStatus("degraded");
      requestFullResync();
      return;
    }
    if (reply.kind === "FATAL_ERROR") {
      const error = makeError(
        "OUTCOME_UNKNOWN",
        `Worker stopped at tick ${reply.body.tick}; pending request outcomes are unknown.`,
      );
      failClient(error);
      return;
    }
    settleCall(reply);
    acknowledgeTerminalReply(reply);
  }

  function onWorkerError(): void {
    failClient(makeError("WORKER_ERROR", "The simulator Worker stopped unexpectedly."));
  }

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerError);
  worker.addEventListener("messageerror", onWorkerError);

  unsubscribeVisibility = visibility.subscribe(() => {
    const nextVisible = visibility.isVisible();
    if (visible === nextVisible) return;
    visible = nextVisible;
    if (visible) {
      // Hidden time is not evidence of a dead Worker. Give it one visible
      // heartbeat interval to resume after the host receives the visibility
      // message and restarts its heartbeat timer.
      lastHeartbeatAtMs = timing.now();
      lastHeartbeatLifecycle = null;
      maintenanceStartedAtMs = null;
      scheduleHeartbeatWatchdog();
    } else {
      clearHeartbeatWatchdog();
    }
    if (readyReceived && !disposed && fatalError === null) {
      void sendRequest("SET_HOST_VISIBILITY", { visible }, false).catch(() => {
        updateConnectionStatus("degraded");
      });
    }
  });

  const client: GameClient = {
    dispatch: async (command: SimCommand): Promise<CommandResult> => {
      const reply = await sendRequest("COMMAND", { command });
      if (reply.kind !== "COMMAND_RESULT") {
        throw makeError("INVALID_REPLY", "Worker did not return a command result.");
      }
      return reply.body.result;
    },
    getSnapshot(): UiSnapshot {
      const snapshot = store.getSnapshot();
      if (snapshot === null) throw makeError("NOT_READY", "The Worker has not published READY.");
      return snapshot;
    },
    subscribe(listener) {
      return store.subscribe(listener);
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeControl(listener) {
      controlListeners.add(listener);
      return () => controlListeners.delete(listener);
    },
    getGridViewModel(): GridViewModel {
      const grid = store.getGridViewModel();
      if (grid === null) throw makeError("NOT_READY", "The Worker has not published its grid.");
      return grid;
    },
    async requestSave(reason: SaveReason): Promise<SaveMetadata> {
      const reply = await sendRequest("REQUEST_SAVE", { reason });
      if (reply.kind === "REQUEST_RESULT" && reply.body.result.kind === "save") {
        return reply.body.result.metadata;
      }
      throw makeError("INVALID_REPLY", "Worker did not return save metadata.");
    },
    getConnectionStatus: () => connectionStatus,
    subscribeConnection(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      detachWorker();
      failPending(makeError("OUTCOME_UNKNOWN", "The GameClient was destroyed."));
      updateConnectionStatus("disconnected");
      store.dispose();
      eventListeners.clear();
      controlListeners.clear();
      connectionListeners.clear();
    },
  };

  const initialization = sendRequest("INITIALIZE_NEW", {
    seed: options.seed,
    contentVersion: options.content.contentVersion,
    fingerprint,
  }).then((reply) => {
    if (reply.kind !== "READY") {
      throw makeError("INCOMPATIBLE_CONTENT", "Worker did not complete the content handshake.");
    }
  });

  try {
    await initialization;
    await readyAcknowledgement;
  } catch (error) {
    const initializationError =
      error instanceof WorkerGameClientError
        ? error
        : makeError(
            "WORKER_ERROR",
            error instanceof Error ? error.message : "Worker initialization failed.",
          );
    failClient(initializationError);
    unsubscribeVisibility();
    throw initializationError;
  }

  return client;
}
