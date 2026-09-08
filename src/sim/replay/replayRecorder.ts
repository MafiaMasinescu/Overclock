import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { SimulatorInvariantError } from "../commands/commandProcessor.ts";
import { createProductionSimCore } from "../core/productionSimCore.ts";
import { createInitialGameState } from "../core/createInitialGameState.ts";
import { TickSystemInvariantError } from "../core/simCore.ts";
import type { SimCore } from "../core/simCore.ts";
import type { GameState } from "../core/types.ts";
import {
  hashSimulationContent,
  REPLAY_VERSION,
  SIMULATOR_PROTOCOL_VERSION,
  type ReplayCheckpoint,
  type ReplayEntry,
  type ReplayFatalOutcome,
  type ReplayLog,
  type ReplayOperation,
  type ReplayOutcome,
  type ReplayRecordingArtifact,
} from "./replayContracts.ts";
import { parseReplayOperation } from "./replaySchema.ts";
import { hashCanonicalState } from "./canonicalState.ts";

export interface ReplayRecorderOptions {
  readonly content: ContentBundle;
  readonly initialState?: GameState;
  readonly seed?: string;
  readonly initialCommandQueueSequence?: number;
}

export interface ReplayRecorder {
  readonly perform: (operation: unknown) => ReplayEntry;
  readonly checkpoint: () => ReplayCheckpoint;
  readonly finish: () => ReplayRecordingArtifact;
  readonly getStateForSave: () => GameState;
  readonly getCommandQueuePosition: () => {
    readonly nextSequence: number;
    readonly pendingCount: number;
  };
}

export interface ReplayRecorderTestOptions {
  readonly content: ContentBundle;
  readonly initialState: GameState;
  readonly core: SimCore;
}

class ReplayRecorderInternalError extends Error {
  constructor(cause: unknown) {
    super("Replay recording failed because the simulator raised an unexpected internal error.", {
      cause,
    });
    this.name = "ReplayRecorderInternalError";
  }
}

function freezeDetached<T>(value: T): T {
  const detached = structuredClone(value);
  return freezeOwned(detached);
}

function freezeOwned<T>(value: T): T {
  const detached = value;
  const work: unknown[] = [detached];
  const visited = new WeakSet<object>();
  while (work.length > 0) {
    const current = work.pop();
    if (current === null || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      for (const child of current) {
        if (child !== null && typeof child === "object") work.push(child);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === "object") work.push(child);
      }
    }
    Object.freeze(current);
  }
  return value;
}

function createCheckpoint(core: SimCore, afterSequence: number): ReplayCheckpoint {
  const state = core.getStateForSave();
  const queue = core.getCommandQueuePosition();
  return {
    afterSequence,
    tick: state.tick,
    stateHash: hashCanonicalState(state),
    nextQueueSequence: queue.nextSequence,
    pendingCommandCount: queue.pendingCount,
  };
}

function normalizeFatal(error: SimulatorInvariantError, core: SimCore): ReplayFatalOutcome {
  if (error instanceof TickSystemInvariantError) {
    return {
      kind: "fatal",
      code: "SIMULATOR_INVARIANT_VIOLATION",
      origin: "tick-system",
      commandId: null,
      tick: error.tick,
      stage: error.stage,
    };
  }
  return {
    kind: "fatal",
    code: "SIMULATOR_INVARIANT_VIOLATION",
    origin: "command",
    commandId: error.commandId,
    tick: core.tick,
  };
}

function runOperation(core: SimCore, operation: ReplayOperation): ReplayOutcome {
  switch (operation.kind) {
    case "enqueue":
      return { kind: "receipt", receipt: core.enqueue(operation.command) };
    case "clock":
      return { kind: "clock-result", result: core.applyClockCommand(operation.command) };
    case "process-pending":
      return { kind: "command-results", results: [...core.processPendingCommands()] };
    case "step":
      return { kind: "step-result", result: core.step(operation.ticks) };
    default:
      return assertNever(operation);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Replay operation: ${String(value)}`);
}

function createRecorder(
  content: ContentBundle,
  initialState: GameState,
  core: SimCore,
): ReplayRecorder {
  const ownedInitialState = freezeDetached(initialState);
  if (ownedInitialState.contentVersion !== content.contentVersion) {
    throw new TypeError("Replay recording initial state contentVersion must match content.");
  }
  const initialStateHash = hashCanonicalState(ownedInitialState);
  const initialQueue = core.getCommandQueuePosition();
  if (initialQueue.pendingCount !== 0) {
    throw new Error("Replay recording requires an initially empty command queue.");
  }

  const entries: ReplayEntry[] = [];
  const checkpoints: ReplayCheckpoint[] = [freezeDetached(createCheckpoint(core, 0))];
  let terminal: ReplayLog["terminal"] | null = null;
  let artifact: ReplayRecordingArtifact | null = null;
  let unusableError: ReplayRecorderInternalError | null = null;

  function assertMutable(): void {
    if (unusableError !== null) throw unusableError;
    if (terminal !== null) {
      throw new Error("Replay recording session is already terminal.");
    }
  }

  function appendEntry(operation: ReplayOperation, outcome: ReplayOutcome, tickBefore: number) {
    const entry = freezeOwned({
      sequence: entries.length + 1,
      tickBefore,
      tickAfter: core.tick,
      operation,
      outcome,
    });
    entries.push(entry);
    return entry;
  }

  function appendFatalEntry(
    operation: ReplayOperation,
    tickBefore: number,
    error: SimulatorInvariantError,
  ): ReplayEntry {
    const entry = appendEntry(operation, normalizeFatal(error, core), tickBefore);
    terminal = { kind: "fatal", afterSequence: entry.sequence };
    try {
      checkpoints.push(freezeOwned(createCheckpoint(core, entry.sequence)));
    } catch (cause: unknown) {
      unusableError = new ReplayRecorderInternalError(cause);
      throw unusableError;
    }
    return entry;
  }

  function perform(operationInput: unknown): ReplayEntry {
    assertMutable();
    const operation = freezeOwned(parseReplayOperation(operationInput));
    const tickBefore = core.tick;
    try {
      return appendEntry(operation, runOperation(core, operation), tickBefore);
    } catch (error: unknown) {
      if (error instanceof SimulatorInvariantError) {
        return appendFatalEntry(operation, tickBefore, error);
      }
      throw error instanceof RangeError ? error : new ReplayRecorderInternalError(error);
    }
  }

  function checkpoint(): ReplayCheckpoint {
    assertMutable();
    const queue = core.getCommandQueuePosition();
    if (queue.pendingCount !== 0) {
      throw new Error("Replay checkpoint requires an empty command queue.");
    }
    const afterSequence = entries.length;
    const previous = checkpoints[checkpoints.length - 1];
    if (previous?.afterSequence === afterSequence) return previous;
    const created = freezeOwned(createCheckpoint(core, afterSequence));
    checkpoints.push(created);
    return created;
  }

  function finish(): ReplayRecordingArtifact {
    if (artifact !== null) return artifact;
    if (unusableError !== null) throw unusableError;
    if (terminal === null) {
      const queue = core.getCommandQueuePosition();
      if (queue.pendingCount !== 0) {
        throw new Error("Replay recording can finish only with an empty command queue.");
      }
      const finalSequence = entries.length;
      const previous = checkpoints[checkpoints.length - 1];
      if (previous?.afterSequence !== finalSequence) {
        checkpoints.push(freezeDetached(createCheckpoint(core, finalSequence)));
      }
      terminal = { kind: "completed", afterSequence: finalSequence };
    }

    const log: ReplayLog = {
      replayVersion: REPLAY_VERSION,
      simulatorProtocolVersion: SIMULATOR_PROTOCOL_VERSION,
      seed: ownedInitialState.seed,
      contentVersion: content.contentVersion,
      simulationContentHash: hashSimulationContent(content),
      initialStateHash,
      initialTick: ownedInitialState.tick,
      initialCommandQueueSequence: initialQueue.nextSequence,
      entries,
      checkpoints,
      terminal,
    };
    artifact = freezeDetached({ log, initialState: ownedInitialState });
    return artifact;
  }

  return Object.freeze({
    perform,
    checkpoint,
    finish,
    getStateForSave: () => core.getStateForSave(),
    getCommandQueuePosition: () => core.getCommandQueuePosition(),
  });
}

export function createReplayRecorder(options: ReplayRecorderOptions): ReplayRecorder {
  const { content, initialState, seed, initialCommandQueueSequence } = options;
  if (initialState === undefined && seed === undefined) {
    throw new TypeError("Replay recording requires an initialState or seed.");
  }
  if (initialState !== undefined && seed !== undefined && initialState.seed !== seed) {
    throw new TypeError("Replay recording seed must match the supplied initial state.");
  }
  const state =
    initialState ??
    (seed === undefined
      ? (() => {
          throw new TypeError("A seed is required when initialState is omitted.");
        })()
      : createInitialGameState({ content, seed }));
  const core = createProductionSimCore({
    content,
    initialState: state,
    ...(initialCommandQueueSequence === undefined ? {} : { initialCommandQueueSequence }),
  });
  return createRecorder(content, state, core);
}

export function createReplayRecorderForTests(options: ReplayRecorderTestOptions): ReplayRecorder {
  return createRecorder(options.content, options.initialState, options.core);
}

export const startReplayRecording = createReplayRecorder;
