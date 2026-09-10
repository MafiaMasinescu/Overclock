import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { SimulatorInvariantError } from "../commands/commandProcessor.ts";
import { createProductionSimCore } from "../core/productionSimCore.ts";
import { TickSystemInvariantError } from "../core/simCore.ts";
import type { SimCore } from "../core/simCore.ts";
import type { GameState } from "../core/types.ts";
import { hashCanonicalState } from "./canonicalState.ts";
import {
  DEFAULT_REPLAY_MAX_ENTRIES,
  DEFAULT_REPLAY_MAX_TICKS,
  hashSimulationContent,
  type ReplayCheckpoint,
  type ReplayEntry,
  type ReplayFatalOutcome,
  type ReplayLog,
  type ReplayOperation,
  type ReplayOutcome,
  type ReplayVerificationReport,
  type ReplayMismatch,
} from "./replayContracts.ts";
import { parseReplayLog } from "./replaySchema.ts";

export interface ReplayRunnerOptions {
  readonly content: ContentBundle;
  readonly initialState: unknown;
  readonly log: unknown;
  readonly limits?: {
    readonly maxEntries?: number;
    readonly maxTicks?: number;
  };
}

export interface ParsedReplayExecutionOptions {
  readonly content: ContentBundle;
  readonly log: ReplayLog;
  readonly core: SimCore;
  readonly startSequence?: number;
  readonly initialLastMatchingCheckpoint?: number | null;
}

export interface ParsedReplayExecution {
  readonly report: ReplayVerificationReport;
  readonly core: SimCore;
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function firstDifference(
  expected: unknown,
  actual: unknown,
  path = "$",
): Pick<ReplayMismatch, "category" | "path" | "expected" | "actual"> | null {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return {
        category: "array-length",
        path,
        expected: expected.length,
        actual: actual.length,
      };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const expectedKeys = Object.keys(expected).toSorted();
    const actualKeys = Object.keys(actual).toSorted();
    for (const key of expectedKeys) {
      if (!Object.hasOwn(actual, key)) continue;
      const difference = firstDifference(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (difference !== null) return difference;
    }
    if (
      expectedKeys.length !== actualKeys.length ||
      expectedKeys.some((key, i) => key !== actualKeys[i])
    ) {
      return { category: "key-set", path, expected: null, actual: null };
    }
    return null;
  }
  return { category: "value", path, expected: scalar(expected), actual: scalar(actual) };
}

function createMismatch(
  kind: ReplayMismatch["kind"],
  sequence: number | null,
  difference: Pick<ReplayMismatch, "category" | "path" | "expected" | "actual">,
  lastMatchingCheckpointAfterSequence: number | null,
): ReplayMismatch {
  return {
    kind,
    sequence,
    ...difference,
    lastMatchingCheckpointAfterSequence,
  };
}

function freezeDetached<T>(value: T): T {
  const detached = structuredClone(value);
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
  return detached;
}

function prefixDifference(
  difference: Pick<ReplayMismatch, "category" | "path" | "expected" | "actual">,
  prefix: string,
): Pick<ReplayMismatch, "category" | "path" | "expected" | "actual"> {
  return {
    ...difference,
    path:
      difference.path === null || difference.path === "$"
        ? prefix
        : `${prefix}${difference.path.slice(1)}`,
  };
}

function report(
  status: ReplayVerificationReport["status"],
  replayHash: string | null,
  overrides: Partial<ReplayVerificationReport> = {},
): ReplayVerificationReport {
  return freezeDetached({
    status,
    replayHash,
    finalTick: null,
    finalStateHash: null,
    finalQueuePosition: null,
    executedEntries: 0,
    executedTicks: 0,
    lastMatchingCheckpointAfterSequence: null,
    ...overrides,
  });
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

export function executeReplayEntry(core: SimCore, entry: ReplayEntry): ReplayOutcome {
  if (core.tick !== entry.tickBefore) {
    throw new Error(`Replay entry ${entry.sequence} has an unexpected tickBefore.`);
  }
  let actualOutcome: ReplayOutcome;
  try {
    actualOutcome = runOperation(core, entry.operation);
  } catch (error: unknown) {
    if (error instanceof SimulatorInvariantError) {
      actualOutcome = normalizeFatal(error, core);
    } else {
      throw error;
    }
  }
  const difference = firstDifference(entry.outcome, actualOutcome);
  if (difference !== null) {
    throw new Error(
      `Replay entry ${entry.sequence} outcome mismatch at ${difference.path ?? "$"}.`,
    );
  }
  if (core.tick !== entry.tickAfter) {
    throw new Error(`Replay entry ${entry.sequence} has an unexpected tickAfter.`);
  }
  return actualOutcome;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Replay operation: ${String(value)}`);
}

function checkpointDifference(
  expected: ReplayCheckpoint,
  core: SimCore,
): Pick<ReplayMismatch, "category" | "path" | "expected" | "actual"> | null {
  const state = core.getStateForSave();
  const queue = core.getCommandQueuePosition();
  const actual = {
    afterSequence: expected.afterSequence,
    tick: state.tick,
    stateHash: hashCanonicalState(state),
    nextQueueSequence: queue.nextSequence,
    pendingCommandCount: queue.pendingCount,
  };
  return firstDifference(expected, actual);
}

function checkpointsBySequence(log: ReplayLog): Map<number, ReplayCheckpoint> {
  return new Map(log.checkpoints.map((checkpoint) => [checkpoint.afterSequence, checkpoint]));
}

function expectedInitialDifference(log: ReplayLog, core: SimCore): ReplayMismatch | null {
  const initialCheckpoint = log.checkpoints[0];
  if (initialCheckpoint === undefined) {
    return createMismatch(
      "initial",
      0,
      { category: "missing-checkpoint", path: "$.checkpoints[0]", expected: 0, actual: null },
      null,
    );
  }
  const difference = checkpointDifference(initialCheckpoint, core);
  return difference === null ? null : createMismatch("initial", 0, difference, null);
}

function invalidInitialStateReport(logHash: string, reason: string): ReplayVerificationReport {
  return report("invalid-initial-state", logHash, {
    mismatch: {
      kind: "initial",
      sequence: 0,
      category: "invalid-state",
      path: null,
      expected: reason,
      actual: null,
      lastMatchingCheckpointAfterSequence: null,
    },
  });
}

export function executeParsedReplay(options: ParsedReplayExecutionOptions): ParsedReplayExecution {
  const { log, core } = options;
  const startSequence = options.startSequence ?? 1;
  const replayHash = hashCanonicalState(log);
  const entries = [...log.entries];
  const terminalKind = log.terminal.kind;
  const terminalAfterSequence = log.terminal.afterSequence;
  let lastMatchingCheckpointAfterSequence = options.initialLastMatchingCheckpoint ?? null;
  let executedEntries = 0;
  let executedTicks = 0;
  const checkpointMap = checkpointsBySequence(log);

  if (startSequence === 1) {
    const initialMismatch = expectedInitialDifference(log, core);
    if (initialMismatch !== null) {
      return {
        core,
        report: report("diverged", replayHash, {
          executedEntries,
          executedTicks,
          lastMatchingCheckpointAfterSequence,
          mismatch: initialMismatch,
        }),
      };
    }
    lastMatchingCheckpointAfterSequence = 0;
  }

  for (let index = startSequence - 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) break;
    const tickBefore = core.tick;
    executedEntries += 1;
    if (tickBefore !== entry.tickBefore) {
      return {
        core,
        report: report("diverged", replayHash, {
          executedEntries,
          executedTicks,
          lastMatchingCheckpointAfterSequence,
          mismatch: createMismatch(
            "entry",
            entry.sequence,
            {
              category: "tick-before",
              path: "$.tickBefore",
              expected: entry.tickBefore,
              actual: tickBefore,
            },
            lastMatchingCheckpointAfterSequence,
          ),
        }),
      };
    }

    let actualOutcome: ReplayOutcome;
    try {
      actualOutcome = runOperation(core, entry.operation);
    } catch (error: unknown) {
      if (!(error instanceof SimulatorInvariantError)) {
        return {
          core,
          report: report("internal-error", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "entry",
              entry.sequence,
              {
                category: "unexpected-error",
                path: null,
                expected: null,
                actual: error instanceof Error ? error.name : "unknown",
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      actualOutcome = normalizeFatal(error, core);
    }

    const tickAfter = core.tick;
    executedTicks += Math.max(0, tickAfter - tickBefore);
    const outcomeDifference = firstDifference(entry.outcome, actualOutcome);
    if (outcomeDifference !== null) {
      return {
        core,
        report: report("diverged", replayHash, {
          executedEntries,
          executedTicks,
          lastMatchingCheckpointAfterSequence,
          mismatch: createMismatch(
            "entry",
            entry.sequence,
            prefixDifference(outcomeDifference, "$.outcome"),
            lastMatchingCheckpointAfterSequence,
          ),
        }),
      };
    }

    if (tickAfter !== entry.tickAfter) {
      return {
        core,
        report: report("diverged", replayHash, {
          executedEntries,
          executedTicks,
          lastMatchingCheckpointAfterSequence,
          mismatch: createMismatch(
            "entry",
            entry.sequence,
            {
              category: "tick-after",
              path: "$.tickAfter",
              expected: entry.tickAfter,
              actual: tickAfter,
            },
            lastMatchingCheckpointAfterSequence,
          ),
        }),
      };
    }

    const expectedCheckpoint = checkpointMap.get(entry.sequence);
    if (expectedCheckpoint !== undefined) {
      let difference: Pick<ReplayMismatch, "category" | "path" | "expected" | "actual"> | null;
      try {
        difference = checkpointDifference(expectedCheckpoint, core);
      } catch (error: unknown) {
        return {
          core,
          report: report("internal-error", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "checkpoint",
              entry.sequence,
              {
                category: "checkpoint-error",
                path: null,
                expected: null,
                actual: error instanceof Error ? error.name : "unknown",
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      if (difference !== null) {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "checkpoint",
              entry.sequence,
              difference,
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      lastMatchingCheckpointAfterSequence = entry.sequence;
    }

    if (actualOutcome.kind === "fatal") {
      if (terminalKind !== "fatal") {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "terminal",
              entry.sequence,
              {
                category: "fatal-terminal-kind",
                path: "$.terminal.kind",
                expected: "fatal",
                actual: terminalKind,
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      if (entry.sequence !== terminalAfterSequence) {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "terminal",
              entry.sequence,
              {
                category: "fatal-boundary",
                path: "$.terminal.afterSequence",
                expected: terminalAfterSequence,
                actual: entry.sequence,
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      if (entry.sequence !== entries.length || executedEntries !== entries.length) {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "entry",
              entry.sequence,
              {
                category: "fatal-not-final-entry",
                path: "$.entries",
                expected: entries.length,
                actual: executedEntries,
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      const terminalCheckpoint = checkpointMap.get(terminalAfterSequence);
      if (terminalCheckpoint === undefined) {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "terminal",
              entry.sequence,
              {
                category: "missing-checkpoint",
                path: "$.checkpoints",
                expected: terminalAfterSequence,
                actual: null,
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      const terminalDifference = checkpointDifference(terminalCheckpoint, core);
      if (terminalDifference !== null) {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "checkpoint",
              entry.sequence,
              terminalDifference,
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      if (entry.outcome.kind !== "fatal") {
        return {
          core,
          report: report("diverged", replayHash, {
            executedEntries,
            executedTicks,
            lastMatchingCheckpointAfterSequence,
            mismatch: createMismatch(
              "entry",
              entry.sequence,
              {
                category: "fatal-outcome-not-final",
                path: "$.outcome.kind",
                expected: "fatal",
                actual: entry.outcome.kind,
              },
              lastMatchingCheckpointAfterSequence,
            ),
          }),
        };
      }
      const finalState = core.getStateForSave();
      const queue = core.getCommandQueuePosition();
      return {
        core,
        report: report("matched-fatal", replayHash, {
          finalTick: finalState.tick,
          finalStateHash: hashCanonicalState(finalState),
          finalQueuePosition: queue,
          executedEntries,
          executedTicks,
          lastMatchingCheckpointAfterSequence,
        }),
      };
    }
  }

  if (terminalKind === "fatal") {
    return {
      core,
      report: report("diverged", replayHash, {
        executedEntries,
        executedTicks,
        lastMatchingCheckpointAfterSequence,
        mismatch: createMismatch(
          "terminal",
          terminalAfterSequence,
          {
            category: "fatal-outcome-missing",
            path: "$.entries",
            expected: "fatal",
            actual: "none",
          },
          lastMatchingCheckpointAfterSequence,
        ),
      }),
    };
  }

  const finalState = core.getStateForSave();
  const queue = core.getCommandQueuePosition();
  const finalCheckpoint = log.checkpoints.at(-1);
  if (finalCheckpoint === undefined) {
    return {
      core,
      report: report("diverged", replayHash, {
        finalTick: finalState.tick,
        finalStateHash: hashCanonicalState(finalState),
        finalQueuePosition: queue,
        executedEntries,
        executedTicks,
        lastMatchingCheckpointAfterSequence,
        mismatch: createMismatch(
          "terminal",
          terminalAfterSequence,
          { category: "missing-checkpoint", path: "$.checkpoints", expected: 1, actual: 0 },
          lastMatchingCheckpointAfterSequence,
        ),
      }),
    };
  }
  const finalDifference = checkpointDifference(finalCheckpoint, core);
  if (finalDifference !== null) {
    return {
      core,
      report: report("diverged", replayHash, {
        finalTick: finalState.tick,
        finalStateHash: hashCanonicalState(finalState),
        finalQueuePosition: queue,
        executedEntries,
        executedTicks,
        lastMatchingCheckpointAfterSequence,
        mismatch: createMismatch(
          "terminal",
          terminalAfterSequence,
          finalDifference,
          lastMatchingCheckpointAfterSequence,
        ),
      }),
    };
  }
  lastMatchingCheckpointAfterSequence = finalCheckpoint.afterSequence;

  return {
    core,
    report: report("matched", replayHash, {
      finalTick: finalState.tick,
      finalStateHash: hashCanonicalState(finalState),
      finalQueuePosition: queue,
      executedEntries,
      executedTicks,
      lastMatchingCheckpointAfterSequence,
    }),
  };
}

function assertValidLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || Object.is(limit, -0)) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return limit;
}

function hasIncompatibleHeader(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const replayVersion = Object.getOwnPropertyDescriptor(value, "replayVersion");
  const protocolVersion = Object.getOwnPropertyDescriptor(value, "simulatorProtocolVersion");
  return (
    (replayVersion !== undefined &&
      Object.hasOwn(replayVersion, "value") &&
      replayVersion.value !== 1) ||
    (protocolVersion !== undefined &&
      Object.hasOwn(protocolVersion, "value") &&
      protocolVersion.value !== 1)
  );
}

export function runReplay(options: ReplayRunnerOptions): ReplayVerificationReport {
  let maxEntries: number;
  let maxTicks: number;
  try {
    maxEntries = assertValidLimit(
      options.limits?.maxEntries,
      DEFAULT_REPLAY_MAX_ENTRIES,
      "maxEntries",
    );
    maxTicks = assertValidLimit(options.limits?.maxTicks, DEFAULT_REPLAY_MAX_TICKS, "maxTicks");
  } catch {
    return report("limit-exceeded", null);
  }

  let log: ReplayLog;
  try {
    log = parseReplayLog(options.log);
  } catch {
    if (hasIncompatibleHeader(options.log)) return report("incompatible", null);
    return report("invalid-log", null);
  }
  const replayHash = hashCanonicalState(log);

  let requestedTicks = 0;
  for (const entry of log.entries) {
    if (entry.operation.kind === "step") {
      if (entry.operation.ticks > maxTicks - requestedTicks) {
        return report("limit-exceeded", replayHash);
      }
      requestedTicks += entry.operation.ticks;
    }
  }
  if (log.entries.length > maxEntries) return report("limit-exceeded", replayHash);

  if (options.content.contentVersion !== log.contentVersion) {
    return report("incompatible", replayHash);
  }
  if (hashSimulationContent(options.content) !== log.simulationContentHash) {
    return report("incompatible", replayHash);
  }

  let initialState: GameState;
  let core: SimCore;
  try {
    initialState = structuredClone(options.initialState) as GameState;
    core = createProductionSimCore({
      content: options.content,
      initialState,
      initialCommandQueueSequence: log.initialCommandQueueSequence,
    });
    const saved = core.getStateForSave();
    if (
      saved.seed !== log.seed ||
      saved.tick !== log.initialTick ||
      hashCanonicalState(saved) !== log.initialStateHash
    ) {
      return invalidInitialStateReport(replayHash, "initial state does not match replay header");
    }
  } catch (error: unknown) {
    return invalidInitialStateReport(
      replayHash,
      error instanceof Error ? error.message : "initial state validation failed",
    );
  }

  const initialMismatch = expectedInitialDifference(log, core);
  if (initialMismatch !== null) {
    return report("invalid-initial-state", replayHash, { mismatch: initialMismatch });
  }
  return executeParsedReplay({ content: options.content, log, core }).report;
}
