import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { createInitialGameState } from "../../sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../sim/core/productionSimCore.ts";
import type { SimCommand } from "../../sim/commands/contracts.ts";
import type { CommandResult } from "../../sim/commands/contracts.ts";
import type { CommittedFactProjection, SimEvent } from "../../sim/events/contracts.ts";
import { TickSystemInvariantError } from "../../sim/core/simCore.ts";
import type { SimCore } from "../../sim/core/simCore.ts";
import { hashSimulationContent } from "../../sim/replay/replayContracts.ts";
import {
  createDefaultPresentationContext,
  parsePresentationContext,
} from "../../sim/selectors/presentationTypes.ts";
import { createGridPublisher, type GridPublisher } from "../../sim/selectors/gridPublication.ts";
import type {
  PresentationContext,
  ProjectedPresentation,
  UiSnapshot,
} from "../../sim/selectors/presentationTypes.ts";
import type { GameState } from "../../sim/core/types.ts";
import {
  createInboundSequenceGuard,
  createRequestLedger,
  parseWorkerEnvelope,
  parseWorkerRequest,
  workerRequestByteLength,
  workerRequestCategory,
  MAX_RESULT_QUEUE_ENTRIES,
  type InboundSequenceGuard,
  type RequestLedger,
  type WorkerReply,
  type WorkerReplyKind,
  type WorkerRequest,
  type WorkerRequestEnvelope,
} from "./protocol.ts";

const WAKE_INTERVAL_MS = 25;
const FIXED_TICK_MS = 100;
const MAX_ELAPSED_MS = 2_000;
const MAX_TICKS_PER_BURST = 20;
const HEARTBEAT_INTERVAL_MS = 1_000;
const SNAPSHOT_INTERVAL_MS = 100;
const PUBLICATION_ACK_TIMEOUT_MS = 1_000;

export type HostLifecycle =
  | "NEW"
  | "INITIALIZING"
  | "READY_HELD"
  | "RUNNING"
  | "MAINTENANCE"
  | "FATAL"
  | "RECOVERING"
  | "STOPPED";

export interface HostTimingAdapter {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SimWorkerHostOptions {
  readonly content: ContentBundle;
  readonly postMessage: (reply: WorkerReply) => void;
  readonly timing?: HostTimingAdapter;
  /** Trusted internal diagnostic fixture; never populated from a Worker request. */
  readonly initialStateForTest?: GameState;
}

export interface SimWorkerHost {
  receive(input: unknown): Promise<void>;
  captureAtBarrier(): Promise<HostCapture>;
  runMaintenance<T>(operation: () => Promise<T>): Promise<T>;
  destroy(): void;
  getLifecycle(): HostLifecycle;
}

export interface HostCapture {
  readonly state: GameState;
  readonly nextQueueSequence: number;
}

interface PresentationCandidate {
  readonly projected: ProjectedPresentation;
  readonly snapshot: UiSnapshot;
}

function browserTiming(): HostTimingAdapter {
  return {
    now: () => globalThis.performance.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as number);
    },
  };
}

function makeSnapshotRevision(snapshot: UiSnapshot, revision: number): UiSnapshot {
  return Object.freeze({ ...snapshot, revision });
}

function isClockCommand(
  command: SimCommand,
): command is Extract<SimCommand, { kind: "SET_PAUSED" | "SET_SPEED" }> {
  return command.kind === "SET_PAUSED" || command.kind === "SET_SPEED";
}

function isWorkLifecycle(lifecycle: HostLifecycle): boolean {
  return lifecycle !== "FATAL" && lifecycle !== "STOPPED";
}

export function createSimWorkerHost(options: SimWorkerHostOptions): SimWorkerHost {
  const { content, postMessage } = options;
  const timing = options.timing ?? browserTiming();
  const expectedFingerprint = hashSimulationContent(content);
  // Native Node diagnostics import this module without Vite's `import.meta.env` shim.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const initialStateForTest = import.meta.env?.DEV ? options.initialStateForTest : undefined;
  const ledger: RequestLedger = createRequestLedger();
  const resultReservations = new Set<number>();
  const unacknowledgedResults = new Set<number>();

  let lifecycle: HostLifecycle = "NEW";
  let epoch: string | null = null;
  let inbound: InboundSequenceGuard | null = null;
  let nextOutboundSequence: number | null = 0;
  let core: SimCore | null = null;
  let publisher: GridPublisher | null = null;
  let context: PresentationContext = createDefaultPresentationContext();
  let visible = true;
  let paused = true;
  let speed: 1 | 2 | 4 = 1;
  let suspensionReason: "long-gap" | "hidden" | "debt" | null = null;
  let clockOriginMs: number | null = null;
  let accumulatedMs = 0;
  let snapshotRevision = 0;
  let lastSnapshotSentAtMs = Number.NEGATIVE_INFINITY;
  let latestSnapshot: UiSnapshot | null = null;
  let pendingSnapshot: UiSnapshot | null = null;
  let presentationPending = false;
  let wakeTimer: unknown = null;
  let heartbeatTimer: unknown = null;
  let presentationTimer: unknown = null;
  let publicationTimeoutTimer: unknown = null;
  let publicationTimeoutSequence: number | null = null;
  let fullResyncAfterTimeout = false;
  let heartbeatOriginMs: number | null = null;
  let serialTail: Promise<void> = Promise.resolve();
  let maintenanceReserved = false;
  let fatalReportSequence = 0;
  let committedFacts: CommittedFactProjection | null = null;
  let nextEventSequence = 0;

  function stopWakeTimer(): void {
    if (wakeTimer !== null) timing.clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) timing.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    heartbeatOriginMs = null;
  }

  function stopPresentationTimer(): void {
    if (presentationTimer !== null) timing.clearTimeout(presentationTimer);
    presentationTimer = null;
  }

  function stopPublicationTimeout(): void {
    if (publicationTimeoutTimer !== null) timing.clearTimeout(publicationTimeoutTimer);
    publicationTimeoutTimer = null;
    publicationTimeoutSequence = null;
  }

  function resetClock(): void {
    stopWakeTimer();
    clockOriginMs = null;
    accumulatedMs = 0;
  }

  function schedulePublicationTimeout(publicationSequence: number): void {
    stopPublicationTimeout();
    publicationTimeoutSequence = publicationSequence;
    publicationTimeoutTimer = timing.setTimeout(() => {
      publicationTimeoutTimer = null;
      const timedOutSequence = publicationTimeoutSequence;
      publicationTimeoutSequence = null;
      if (timedOutSequence === null) return;
      try {
        if (publisher?.checkTimeout(timing.now()).degraded !== true) return;
        emit("TRANSPORT_DEGRADED", null, { publicationSequence: timedOutSequence });
        if (fullResyncAfterTimeout && lifecycle !== "FATAL" && lifecycle !== "STOPPED") {
          if (lifecycle === "MAINTENANCE") return;
          fullResyncAfterTimeout = false;
          publishCurrent(true);
        }
      } catch (error) {
        fatal(error);
      }
    }, PUBLICATION_ACK_TIMEOUT_MS + 1);
  }

  function emit(kind: WorkerReplyKind, requestSequence: number | null, body: unknown): WorkerReply {
    if (epoch === null || nextOutboundSequence === null) {
      throw new Error("Worker reply sequence is exhausted or the host has no active epoch.");
    }
    const sequence = nextOutboundSequence;
    // This host constructs replies from owned internal values. The receiving
    // GameClient validates every wire reply; parsing the same large publication
    // again here duplicated the Worker boundary cost on the hot tick path.
    const reply = {
      protocolVersion: 1,
      epoch,
      outboundSequence: sequence,
      requestSequence,
      kind,
      body,
    } as WorkerReply;
    if (requestSequence !== null && isTerminalResultKind(kind)) {
      if (!resultReservations.delete(requestSequence)) {
        throw new Error("Worker terminal reply has no reserved result-queue entry.");
      }
      unacknowledgedResults.add(sequence);
    }
    nextOutboundSequence = sequence === Number.MAX_SAFE_INTEGER ? null : sequence + 1;
    postMessage(reply);
    return reply;
  }

  function isTerminalResultKind(kind: WorkerReplyKind): boolean {
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

  function reserveResult(requestSequence: number): boolean {
    if (resultReservations.has(requestSequence)) {
      fatal(new Error("Duplicate terminal result reservation."));
      return false;
    }
    if (resultReservations.size + unacknowledgedResults.size >= MAX_RESULT_QUEUE_ENTRIES) {
      fatal(
        new Error("Worker terminal result queue exceeded its bound."),
        null,
        "TRANSPORT_OVERFLOW",
      );
      return false;
    }
    resultReservations.add(requestSequence);
    return true;
  }

  function acknowledgeResult(outboundSequence: number): void {
    if (!unacknowledgedResults.delete(outboundSequence)) {
      fatal(new Error("Worker result acknowledgement did not match an unacknowledged result."));
    }
  }

  function currentTick(): number {
    return core?.tick ?? 0;
  }

  type NewFact = SimEvent extends infer Event
    ? Event extends { readonly eventId: string }
      ? Omit<Event, "eventId">
      : never
    : never;

  function observeCommittedFacts(commandResult?: CommandResult, command?: SimCommand): void {
    if (core === null) return;
    const next = core.getCommittedFactProjection();
    const previous = committedFacts;
    const facts: SimEvent[] = [];
    const append = (fact: NewFact): void => {
      if (epoch === null || nextEventSequence > Number.MAX_SAFE_INTEGER) {
        throw new Error("Committed fact sequence is exhausted or has no epoch.");
      }
      facts.push({ ...fact, eventId: `${epoch}-event-${nextEventSequence}` });
      nextEventSequence += 1;
    };

    if (commandResult !== undefined && !commandResult.accepted) {
      append({
        kind: "COMMAND_REJECTED",
        tick: commandResult.rejectedAtTick,
        severity: "warning",
        commandId: commandResult.commandId,
        code: commandResult.code,
        messageKey: commandResult.messageKey,
      });
    }
    if (previous !== null) {
      const previousTasks = new Map(
        previous.tasks.map((task) => [task.taskInstanceId, task.status]),
      );
      for (const task of next.tasks) {
        const priorStatus = previousTasks.get(task.taskInstanceId);
        if (
          (task.status === "accepted" || task.status === "active") &&
          (priorStatus === undefined || priorStatus === "offered")
        ) {
          append({
            kind: "TASK_ACCEPTED",
            tick: next.tick,
            severity: "success",
            taskInstanceId: task.taskInstanceId,
          });
        } else if (task.status === "completed" && priorStatus !== "completed") {
          append({
            kind: "TASK_COMPLETED",
            tick: next.tick,
            severity: "success",
            taskInstanceId: task.taskInstanceId,
          });
        } else if (task.status === "failed" && priorStatus !== "failed") {
          append({
            kind: "TASK_FAILED",
            tick: next.tick,
            severity: "warning",
            taskInstanceId: task.taskInstanceId,
          });
        }
      }

      const previousCompletedResearch = new Set(previous.completedResearchNodeIds);
      for (const nodeId of next.completedResearchNodeIds) {
        if (!previousCompletedResearch.has(nodeId)) {
          append({
            kind: "RESEARCH_COMPLETED",
            tick: next.tick,
            severity: "success",
            nodeId,
          });
        }
      }
      if (
        next.activeResearchNodeId !== null &&
        next.activeResearchNodeId !== previous.activeResearchNodeId
      ) {
        append({
          kind: "RESEARCH_STARTED",
          tick: next.tick,
          severity: "info",
          nodeId: next.activeResearchNodeId,
        });
      }

      const previousShutdowns = new Set(
        previous.shutdownModules.map((module) => module.moduleInstanceId),
      );
      for (const module of next.shutdownModules) {
        if (!previousShutdowns.has(module.moduleInstanceId) && module.temperatureC !== null) {
          append({
            kind: "MODULE_SHUTDOWN",
            tick: next.tick,
            severity: "critical",
            moduleInstanceId: module.moduleInstanceId,
            temperatureC: module.temperatureC,
          });
        }
      }

      const previousBlueprints = new Set(previous.blueprintIds);
      for (const blueprintId of next.blueprintIds) {
        if (!previousBlueprints.has(blueprintId)) {
          append({
            kind: "BLUEPRINT_SAVED",
            tick: next.tick,
            severity: "success",
            blueprintId,
          });
        }
      }

      if (previous.activeBenchmark === null && next.activeBenchmark !== null) {
        append({
          kind: "BENCHMARK_STARTED",
          tick: next.tick,
          severity: "info",
          runId: next.activeBenchmark.runId,
          benchmarkId: next.activeBenchmark.benchmarkId,
        });
      }
      if (
        next.benchmarkHistoryCount > previous.benchmarkHistoryCount &&
        next.latestBenchmarkResult !== null
      ) {
        append({
          kind: next.latestBenchmarkResult.passed ? "BENCHMARK_COMPLETED" : "BENCHMARK_FAILED",
          tick: next.tick,
          severity: next.latestBenchmarkResult.passed ? "success" : "warning",
          runId: next.latestBenchmarkResult.runId,
          benchmarkId: next.latestBenchmarkResult.benchmarkId,
          score: next.latestBenchmarkResult.averageUsefulComputeFlops,
        });
      }

      const previousMuseumSnapshots = new Set(previous.museumSnapshotIds);
      for (const snapshotId of next.museumSnapshotIds) {
        if (!previousMuseumSnapshots.has(snapshotId)) {
          append({
            kind: "MUSEUM_SNAPSHOT_CREATED",
            tick: next.tick,
            severity: "success",
            snapshotId,
          });
        }
      }
      if (!previous.transistorRevealed && next.transistorRevealed) {
        append({ kind: "TRANSISTOR_REVEALED", tick: next.tick, severity: "success" });
      }

      if (commandResult?.accepted === true && command !== undefined) {
        if (command.kind === "BUY_MODULE" && next.cashUsd < previous.cashUsd) {
          append({
            kind: "MODULE_PURCHASED",
            tick: next.tick,
            severity: "info",
            definitionId: command.definitionId,
            quantity: command.quantity,
            costUsd: previous.cashUsd - next.cashUsd,
          });
        } else if (
          command.kind === "APPLY_DESIGN" &&
          next.liveLayoutRevision > previous.liveLayoutRevision
        ) {
          append({
            kind: "DESIGN_APPLIED",
            tick: next.tick,
            severity: "success",
            revision: next.liveLayoutRevision,
            costUsd: command.acceptedCostUsd,
            downtimeTicks: command.acceptedDowntimeTicks,
          });
        } else if (command.kind === "INSTANTIATE_BLUEPRINT") {
          append({
            kind: "BLUEPRINT_INSTANTIATED",
            tick: next.tick,
            severity: "success",
            blueprintId: command.blueprintId,
          });
        }
      }
    }

    committedFacts = next;
    for (let offset = 0; offset < facts.length; offset += 128) {
      const batch = facts.slice(offset, offset + 128);
      const firstEventSequence = nextEventSequence - facts.length + offset;
      emit("EVENT_BATCH", null, {
        firstEventSequence,
        events: batch.map((event, index) => ({
          eventSequence: firstEventSequence + index,
          event,
        })),
      });
    }
  }

  function sendRequestResult(request: WorkerRequest, result: Record<string, unknown>): void {
    emit("REQUEST_RESULT", request.requestSequence, { result });
  }

  function sendRequestError(
    requestSequence: number,
    code:
      | "INVALID_REQUEST"
      | "BUSY"
      | "LIMIT_EXCEEDED"
      | "UNAVAILABLE"
      | "OUTCOME_UNKNOWN"
      | "SEQUENCE_EXHAUSTED"
      | "FATAL"
      | "INCOMPATIBLE_CONTENT",
    operation: string | null,
  ): void {
    emit("REQUEST_ERROR", requestSequence, { code, operation });
  }

  function fatal(
    cause: unknown,
    failedRequestSequence: number | null = null,
    codeOverride?: "TRANSPORT_OVERFLOW",
  ): void {
    if (lifecycle === "FATAL" || lifecycle === "STOPPED") return;
    lifecycle = "FATAL";
    resetClock();
    stopHeartbeat();
    stopPresentationTimer();
    stopPublicationTimeout();
    presentationPending = false;
    const stage = cause instanceof TickSystemInvariantError ? cause.stage : null;
    const code =
      codeOverride ??
      (cause instanceof TickSystemInvariantError
        ? "SIMULATOR_INVARIANT_VIOLATION"
        : "WORKER_ERROR");
    const reportId = `${epoch ?? "worker"}-${currentTick()}-${fatalReportSequence++}`;
    try {
      emit("FATAL_ERROR", null, { code, tick: currentTick(), stage, reportId });
    } catch {
      // Transport failure cannot be repaired by recursively reporting it.
    }
    if (failedRequestSequence !== null && nextOutboundSequence !== null) {
      try {
        sendRequestError(failedRequestSequence, "OUTCOME_UNKNOWN", null);
      } catch {
        // Preserve the fatal state when the reply channel is already broken.
      }
    }
  }

  function lifecycleForHeartbeat(): HostLifecycle {
    if (lifecycle === "RUNNING" && paused) {
      return "READY_HELD";
    }
    return lifecycle;
  }

  function scheduleHeartbeat(): void {
    if (heartbeatTimer !== null || lifecycle === "FATAL" || lifecycle === "STOPPED" || !visible)
      return;
    heartbeatOriginMs ??= timing.now();
    heartbeatTimer = timing.setTimeout(() => {
      heartbeatTimer = null;
      if (lifecycle === "FATAL" || lifecycle === "STOPPED" || !visible) return;
      const now = timing.now();
      heartbeatOriginMs = now;
      try {
        emit("HEARTBEAT", null, {
          tick: currentTick(),
          lifecycle: lifecycleForHeartbeat(),
          visible,
        });
      } catch (error) {
        fatal(error);
        return;
      }
      scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function capturePresentation(): PresentationCandidate {
    if (core === null) throw new Error("Worker host is not initialized.");
    const projected = core.getPresentation(context);
    const snapshot = makeSnapshotRevision(projected.snapshot, snapshotRevision++);
    latestSnapshot = snapshot;
    return { projected, snapshot };
  }

  function sendSnapshotOnly(snapshot: UiSnapshot, requestSequence: number | null = null): void {
    emit("SNAPSHOT_PUBLICATION", requestSequence, { snapshot, publication: null });
    lastSnapshotSentAtMs = timing.now();
  }

  function flushPresentation(
    candidate: PresentationCandidate,
    requestSequence: number | null = null,
  ): void {
    if (publisher === null) throw new Error("Worker publisher is not initialized.");
    const publication = publisher.publish({
      grid: candidate.projected.grid,
      thermalTiles: candidate.projected.thermalTiles,
      source: candidate.projected.source,
      heatmapEnabled: context.heatmapEnabled,
      nowMs: timing.now(),
    });
    if (publication !== null) {
      pendingSnapshot = null;
      emit("SNAPSHOT_PUBLICATION", requestSequence, {
        snapshot: candidate.snapshot,
        publication,
      });
      lastSnapshotSentAtMs = timing.now();
      schedulePublicationTimeout(publication.publicationSequence);
      return;
    }
    if (publisher.getStatus().inFlightSequence !== null) {
      pendingSnapshot = candidate.snapshot;
      return;
    }
    sendSnapshotOnly(candidate.snapshot, requestSequence);
  }

  function schedulePresentationFlush(): void {
    if (presentationTimer !== null || lifecycle === "FATAL" || lifecycle === "STOPPED") return;
    const waitMs = Math.max(0, lastSnapshotSentAtMs + SNAPSHOT_INTERVAL_MS - timing.now());
    presentationTimer = timing.setTimeout(() => {
      presentationTimer = null;
      if (!presentationPending || lifecycle === "FATAL" || lifecycle === "STOPPED") return;
      presentationPending = false;
      try {
        flushPresentation(capturePresentation());
      } catch (error) {
        fatal(error);
      }
    }, waitMs);
  }

  function publishCurrent(bypassRateLimit: boolean, requestSequence: number | null = null): void {
    const waitMs = lastSnapshotSentAtMs + SNAPSHOT_INTERVAL_MS - timing.now();
    if (!bypassRateLimit && waitMs > 0) {
      presentationPending = true;
      schedulePresentationFlush();
      return;
    }
    stopPresentationTimer();
    presentationPending = false;
    flushPresentation(capturePresentation(), requestSequence);
  }

  function startScheduler(reset = true): void {
    if (
      core === null ||
      lifecycle === "FATAL" ||
      lifecycle === "STOPPED" ||
      !visible ||
      suspensionReason !== null
    ) {
      return;
    }
    if (paused) {
      lifecycle = "READY_HELD";
      resetClock();
      return;
    }
    lifecycle = "RUNNING";
    if (reset || clockOriginMs === null) {
      clockOriginMs = timing.now();
      accumulatedMs = 0;
    }
    if (wakeTimer === null) wakeTimer = timing.setTimeout(onWake, WAKE_INTERVAL_MS);
  }

  function suspend(reason: "long-gap" | "hidden" | "debt", requiresContinue: boolean): void {
    if (lifecycle === "FATAL" || lifecycle === "STOPPED") return;
    suspensionReason = reason;
    lifecycle = "READY_HELD";
    resetClock();
    try {
      emit("SUSPENDED", null, { reason, requiresContinue });
    } catch (error) {
      fatal(error);
    }
  }

  function executeElapsed(elapsedMs: number, nowMs: number): boolean {
    if (core === null || lifecycle !== "RUNNING") return false;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      fatal(new Error("Injected host clock must be monotonic."));
      return false;
    }
    if (elapsedMs > MAX_ELAPSED_MS) {
      suspend("long-gap", true);
      return false;
    }
    accumulatedMs += elapsedMs * speed;
    const tickDebt = Math.floor(accumulatedMs / FIXED_TICK_MS);
    if (tickDebt > MAX_TICKS_PER_BURST) {
      suspend("debt", true);
      return false;
    }
    for (let index = 0; index < tickDebt; index += 1) {
      try {
        const stepResult = core.step(1);
        if (stepResult.commandResults.length === 0) {
          observeCommittedFacts();
        } else {
          for (const commandResult of stepResult.commandResults) {
            observeCommittedFacts(commandResult);
          }
        }
        accumulatedMs -= FIXED_TICK_MS;
      } catch (error) {
        fatal(error);
        return false;
      }
    }
    if (tickDebt > 0 && nowMs - lastSnapshotSentAtMs >= SNAPSHOT_INTERVAL_MS) {
      try {
        publishCurrent(false);
      } catch (error) {
        fatal(error);
        return false;
      }
    }
    return true;
  }

  function onWake(): void {
    wakeTimer = null;
    if (core === null || lifecycle !== "RUNNING" || !visible || suspensionReason !== null) return;
    const now = timing.now();
    const previous = clockOriginMs;
    clockOriginMs = now;
    if (previous === null) {
      startScheduler(false);
      return;
    }
    if (executeElapsed(now - previous, now)) startScheduler(false);
  }

  function settleElapsedAtBarrier(now: number): boolean {
    if (lifecycle !== "RUNNING" || clockOriginMs === null) return true;
    const previous = clockOriginMs;
    clockOriginMs = now;
    executeElapsed(now - previous, now);
    return isWorkLifecycle(lifecycle);
  }

  function initialize(request: Extract<WorkerRequest, { kind: "INITIALIZE_NEW" }>): void {
    lifecycle = "INITIALIZING";
    if (
      request.body.contentVersion !== content.contentVersion ||
      request.body.fingerprint !== expectedFingerprint
    ) {
      lifecycle = "FATAL";
      sendRequestError(request.requestSequence, "INCOMPATIBLE_CONTENT", request.kind);
      return;
    }
    try {
      const state =
        initialStateForTest === undefined
          ? createInitialGameState({ content, seed: request.body.seed })
          : structuredClone(initialStateForTest);
      core = createProductionSimCore({ content, initialState: state });
      committedFacts = core.getCommittedFactProjection();
      publisher = createGridPublisher({
        epoch: request.epoch,
        dirtyEpsilonC: content.balancing.thermal.dirtyEpsilonC,
      });
      context = createDefaultPresentationContext();
      visible = true;
      suspensionReason = null;
      lifecycle = "READY_HELD";
      const candidate = capturePresentation();
      paused = candidate.snapshot.header.paused;
      speed = candidate.snapshot.header.speed;
      const publication = publisher.publish({
        grid: candidate.projected.grid,
        thermalTiles: candidate.projected.thermalTiles,
        source: candidate.projected.source,
        heatmapEnabled: context.heatmapEnabled,
        nowMs: timing.now(),
      });
      if (publication === null)
        throw new Error("Initial Worker projection must be a full publication.");
      emit("READY", request.requestSequence, {
        contentVersion: content.contentVersion,
        fingerprint: expectedFingerprint,
        snapshot: candidate.snapshot,
        publication,
        lifecycle,
      });
      lastSnapshotSentAtMs = timing.now();
      schedulePublicationTimeout(publication.publicationSequence);
      scheduleHeartbeat();
    } catch (error) {
      fatal(error, request.requestSequence);
    }
  }

  function executeCommand(request: Extract<WorkerRequest, { kind: "COMMAND" }>): void {
    if (core === null || lifecycle === "FATAL" || lifecycle === "STOPPED") {
      sendRequestError(request.requestSequence, "FATAL", request.kind);
      return;
    }
    const command = request.body.command;
    try {
      if (isClockCommand(command)) {
        if (!settleElapsedAtBarrier(timing.now())) return;
        const result = core.applyClockCommand(command);
        if (result.accepted) {
          if (command.kind === "SET_PAUSED") paused = command.paused;
          else speed = command.speed;
        }
        if (result.accepted && paused) {
          lifecycle = "READY_HELD";
          resetClock();
        }
        if (lifecycle === "READY_HELD" && suspensionReason === null && visible)
          startScheduler(true);
        if (result.accepted && !paused) {
          startScheduler(command.kind === "SET_PAUSED");
        }
        emit("COMMAND_RESULT", request.requestSequence, { commandId: command.commandId, result });
        observeCommittedFacts(result, command);
        publishCurrent(false);
        return;
      }
      const receipt = core.enqueue(command);
      emit("COMMAND_RECEIPT", request.requestSequence, { commandId: command.commandId, receipt });
      const results = core.processPendingCommands();
      const result = results.find((entry) => entry.commandId === command.commandId);
      if (result === undefined) throw new Error("Processed command result is missing.");
      emit("COMMAND_RESULT", request.requestSequence, { commandId: command.commandId, result });
      observeCommittedFacts(result, command);
      publishCurrent(false);
    } catch (error) {
      fatal(error, request.requestSequence);
    }
  }

  function execute(request: WorkerRequest): void {
    if (lifecycle === "FATAL" || lifecycle === "STOPPED") {
      sendRequestError(
        request.requestSequence,
        lifecycle === "FATAL" ? "OUTCOME_UNKNOWN" : "UNAVAILABLE",
        request.kind,
      );
      return;
    }
    if (request.kind === "INITIALIZE_NEW") {
      if (lifecycle !== "NEW") {
        sendRequestError(request.requestSequence, "INVALID_REQUEST", request.kind);
        return;
      }
      initialize(request);
      return;
    }
    if (request.kind === "ACK_RESULT") {
      acknowledgeResult(request.body.outboundSequence);
      return;
    }
    if (lifecycle === "NEW" || lifecycle === "INITIALIZING") {
      sendRequestError(request.requestSequence, "INVALID_REQUEST", request.kind);
      return;
    }
    if (request.kind === "COMMAND") {
      executeCommand(request);
      return;
    }
    if (request.kind === "ACK_PUBLICATION") {
      const acknowledgement = publisher?.acknowledge(request.body.publicationSequence);
      if (acknowledgement === undefined) {
        sendRequestError(request.requestSequence, "INVALID_REQUEST", request.kind);
        return;
      }
      stopPublicationTimeout();
      if (acknowledgement.status === "unknown-sequence") {
        fullResyncAfterTimeout = false;
        publishCurrent(true);
        sendRequestError(request.requestSequence, "INVALID_REQUEST", request.kind);
        return;
      }
      fullResyncAfterTimeout = false;
      if (acknowledgement.toSend !== null) {
        const snapshot = pendingSnapshot ?? latestSnapshot;
        if (snapshot === null) throw new Error("Acknowledged publication has no paired snapshot.");
        pendingSnapshot = null;
        emit("SNAPSHOT_PUBLICATION", null, { snapshot, publication: acknowledgement.toSend });
        lastSnapshotSentAtMs = timing.now();
        schedulePublicationTimeout(acknowledgement.toSend.publicationSequence);
      } else if (pendingSnapshot !== null) {
        const snapshot = pendingSnapshot;
        pendingSnapshot = null;
        sendSnapshotOnly(snapshot);
      }
      sendRequestResult(request, { kind: "snapshot", tick: currentTick() });
      return;
    }
    if (request.kind === "REQUEST_FULL_SNAPSHOT") {
      fullResyncAfterTimeout = publisher?.getStatus().inFlightSequence !== null;
      publisher?.requestResync();
      publishCurrent(true, request.requestSequence);
      sendRequestResult(request, { kind: "snapshot", tick: currentTick() });
      return;
    }
    if (request.kind === "SET_PRESENTATION_CONTEXT") {
      context = parsePresentationContext(request.body);
      publishCurrent(false, request.requestSequence);
      sendRequestResult(request, { kind: "snapshot", tick: currentTick() });
      return;
    }
    if (request.kind === "SET_HOST_VISIBILITY") {
      const wasVisible = visible;
      visible = request.body.visible;
      if (!visible && wasVisible) {
        stopHeartbeat();
        const requiresContinue = suspensionReason === "long-gap" || suspensionReason === "debt";
        if (requiresContinue) {
          lifecycle = "READY_HELD";
          resetClock();
          emit("SUSPENDED", null, { reason: "hidden", requiresContinue: true });
        } else {
          suspend("hidden", false);
        }
      } else if (visible && !wasVisible) {
        if (suspensionReason === "hidden") suspensionReason = null;
        if (suspensionReason === null) startScheduler(true);
        scheduleHeartbeat();
      }
      sendRequestResult(request, { kind: "visibility", visible, tick: currentTick() });
      return;
    }
    if (request.kind === "CONTINUE_HOST") {
      if (!visible) {
        sendRequestError(request.requestSequence, "BUSY", request.kind);
        return;
      }
      if (suspensionReason === "long-gap" || suspensionReason === "debt") suspensionReason = null;
      if (suspensionReason === null) startScheduler(true);
      sendRequestResult(request, { kind: "continued", tick: currentTick() });
      return;
    }
    if (request.kind === "SHUTDOWN") {
      resetClock();
      stopHeartbeat();
      stopPresentationTimer();
      stopPublicationTimeout();
      presentationPending = false;
      lifecycle = "STOPPED";
      ledger.clear();
      emit("SHUTDOWN_COMPLETE", request.requestSequence, {});
      return;
    }
    sendRequestError(request.requestSequence, "UNAVAILABLE", request.kind);
  }

  function queue(request: WorkerRequest): Promise<void> {
    const operation = serialTail.then(() => {
      execute(request);
    });
    serialTail = operation.catch((error: unknown) => {
      fatal(error, request.requestSequence);
    });
    return operation;
  }

  function captureAtBarrier(): Promise<HostCapture> {
    const operation = serialTail.then(() => {
      if (core === null || lifecycle === "FATAL" || lifecycle === "STOPPED") {
        throw new Error("Worker host cannot capture state outside its active lifecycle.");
      }
      const before = core.getCommandQueuePosition();
      if (before.pendingCount !== 0) {
        throw new Error("Worker state capture requires an empty command queue.");
      }
      const state = core.getStateForSave();
      const after = core.getCommandQueuePosition();
      if (after.pendingCount !== 0 || after.nextSequence !== before.nextSequence) {
        throw new Error("Worker command queue changed during a state capture barrier.");
      }
      return { state, nextQueueSequence: after.nextSequence };
    });
    serialTail = operation.then(
      () => undefined,
      (error: unknown) => {
        fatal(error);
      },
    );
    return operation;
  }

  function runMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    if (maintenanceReserved) {
      return Promise.reject(new Error("A Worker maintenance operation is already active."));
    }
    if (core === null || lifecycle === "FATAL" || lifecycle === "STOPPED") {
      return Promise.reject(
        new Error("Worker host cannot enter maintenance in its current state."),
      );
    }
    maintenanceReserved = true;
    const maintenance = serialTail.then(async () => {
      try {
        if (core === null || lifecycle === "FATAL" || lifecycle === "STOPPED") {
          throw new Error("Worker host cannot enter maintenance in its current state.");
        }
        stopWakeTimer();
        clockOriginMs = null;
        accumulatedMs = 0;
        lifecycle = "MAINTENANCE";
        return await operation();
      } finally {
        resetClock();
        maintenanceReserved = false;
        if (lifecycle === "MAINTENANCE") {
          lifecycle = "READY_HELD";
          if (fullResyncAfterTimeout) {
            fullResyncAfterTimeout = false;
            try {
              publishCurrent(true);
            } catch (error) {
              fatal(error);
            }
          }
          if (!paused && visible && suspensionReason === null) startScheduler(true);
        }
      }
    });
    // A storage or import failure is a failed maintenance result, not a simulator fatal.
    serialTail = maintenance.then(
      () => undefined,
      () => undefined,
    );
    return maintenance;
  }

  function acceptEnvelope(envelope: WorkerRequestEnvelope): boolean {
    if (epoch === null) {
      epoch = envelope.epoch;
      inbound = createInboundSequenceGuard(epoch);
    }
    const result = inbound?.accept(envelope);
    if (!result?.accepted) {
      if (result?.reason === "stale-epoch") return false;
      fatal(new Error("Worker request sequence is not the expected next value."));
      return false;
    }
    return true;
  }

  return {
    async receive(input) {
      if (lifecycle === "STOPPED") throw new Error("Worker host has been shut down.");
      const envelope = parseWorkerEnvelope(input);
      if (epoch === null && envelope.kind !== "INITIALIZE_NEW") {
        epoch = envelope.epoch;
        inbound = createInboundSequenceGuard(epoch);
        if (!acceptEnvelope(envelope)) return;
        if (!reserveResult(envelope.requestSequence)) return;
        sendRequestError(envelope.requestSequence, "INVALID_REQUEST", envelope.kind);
        lifecycle = "FATAL";
        return;
      }
      if (!acceptEnvelope(envelope)) return;
      if (envelope.kind === "ACK_RESULT") {
        let acknowledgement: WorkerRequest;
        try {
          acknowledgement = parseWorkerRequest(envelope);
        } catch {
          fatal(new Error("Malformed Worker result acknowledgement."));
          return;
        }
        if (acknowledgement.kind !== "ACK_RESULT") {
          fatal(new Error("Malformed Worker result acknowledgement."));
          return;
        }
        acknowledgeResult(acknowledgement.body.outboundSequence);
        return;
      }
      if (lifecycle === "FATAL") {
        if (!reserveResult(envelope.requestSequence)) return;
        sendRequestError(envelope.requestSequence, "OUTCOME_UNKNOWN", envelope.kind);
        return;
      }
      if (!reserveResult(envelope.requestSequence)) return;
      let request: WorkerRequest;
      try {
        request = parseWorkerRequest(envelope);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed Worker request.";
        const code = /limit|exceed/i.test(message) ? "LIMIT_EXCEEDED" : "INVALID_REQUEST";
        sendRequestError(envelope.requestSequence, code, envelope.kind.slice(0, 32));
        return;
      }
      const category = workerRequestCategory(request);
      const reserved = ledger.reserve(
        request.requestSequence,
        workerRequestByteLength(request),
        category,
      );
      if (!reserved.accepted) {
        sendRequestError(request.requestSequence, reserved.reason, request.kind);
        return;
      }
      try {
        await queue(request);
      } finally {
        ledger.release(request.requestSequence);
      }
    },
    captureAtBarrier,
    runMaintenance,
    destroy() {
      resetClock();
      stopHeartbeat();
      stopPresentationTimer();
      stopPublicationTimeout();
      presentationPending = false;
      ledger.clear();
      if (lifecycle !== "FATAL") lifecycle = "STOPPED";
    },
    getLifecycle: () => lifecycle,
  };
}
