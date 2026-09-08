import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { createProductionSimCore } from "../core/productionSimCore.ts";
import type { GameState } from "../core/types.ts";
import { assertCanonicalSerializable, hashCanonicalState } from "./canonicalState.ts";
import {
  DEFAULT_REPLAY_MAX_ENTRIES,
  DEFAULT_REPLAY_MAX_TICKS,
  hashSimulationContent,
  type ReplayLog,
  type ReplayResumeArtifact,
  type ReplayVerificationReport,
} from "./replayContracts.ts";
import { executeParsedReplay, runReplay } from "./replayRunner.ts";
import { parseReplayLog } from "./replaySchema.ts";

export interface ReplayResumeBuildOptions {
  readonly content: ContentBundle;
  readonly initialState: unknown;
  readonly log: unknown;
  readonly afterSequence: number;
  readonly limits?: {
    readonly maxEntries?: number;
    readonly maxTicks?: number;
  };
}

export interface ReplayResumeOptions {
  readonly content: ContentBundle;
  readonly log: unknown;
  readonly artifact: unknown;
  readonly limits?: {
    readonly maxEntries?: number;
    readonly maxTicks?: number;
  };
}

export class ReplayResumeValidationError extends Error {
  readonly report: ReplayVerificationReport;

  constructor(message: string, report: ReplayVerificationReport) {
    super(message);
    this.name = "ReplayResumeValidationError";
    this.report = report;
  }
}

function immutableReport(
  value: ReplayVerificationReport,
  replayHash: string | null,
): ReplayVerificationReport {
  return freezeDetached({ ...value, replayHash });
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

function assertSafeNonnegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new TypeError(`${path} must be a nonnegative safe integer.`);
  }
}

function assertHash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{16}$/.test(value)) {
    throw new TypeError(`${path} must be a lowercase 64-bit hexadecimal hash.`);
  }
}

function assertStandardTree(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${path} must use the standard Array prototype.`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) {
      throw new TypeError(`${path} must be a dense plain array.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      assertStandardTree(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${path} must use the standard Object prototype.`);
  }
  for (const key of Object.keys(value)) {
    assertStandardTree((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).toSorted();
  const wanted = expected.toSorted();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError("Replay resume artifact has unexpected or missing keys.");
  }
}

export function parseReplayResumeArtifact(value: unknown): ReplayResumeArtifact {
  assertCanonicalSerializable(value);
  assertStandardTree(value, "resume artifact");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Replay resume artifact must be a plain object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.getPrototypeOf(record) !== Object.prototype) {
    throw new TypeError("Replay resume artifact must use the standard object prototype.");
  }
  assertExactKeys(record, [
    "resumeVersion",
    "replayHash",
    "afterSequence",
    "state",
    "nextQueueSequence",
  ]);
  if (record["resumeVersion"] !== 1) throw new TypeError("Unsupported replay resume version.");
  assertHash(record["replayHash"], "resume artifact.replayHash");
  assertSafeNonnegativeInteger(record["afterSequence"], "resume artifact.afterSequence");
  assertSafeNonnegativeInteger(record["nextQueueSequence"], "resume artifact.nextQueueSequence");
  if (
    record["state"] === null ||
    typeof record["state"] !== "object" ||
    Array.isArray(record["state"])
  ) {
    throw new TypeError("resume artifact.state must be a GameState object.");
  }
  return structuredClone(record) as unknown as ReplayResumeArtifact;
}

function reportFailure(
  status: ReplayVerificationReport["status"],
  message: string,
): ReplayResumeValidationError {
  return new ReplayResumeValidationError(
    message,
    freezeDetached({
      status,
      replayHash: null,
      finalTick: null,
      finalStateHash: null,
      finalQueuePosition: null,
      executedEntries: 0,
      executedTicks: 0,
      lastMatchingCheckpointAfterSequence: null,
    }),
  );
}

function createPrefixLog(log: ReplayLog, afterSequence: number): ReplayLog {
  return {
    ...log,
    entries: log.entries.slice(0, afterSequence),
    checkpoints: log.checkpoints.filter((checkpoint) => checkpoint.afterSequence <= afterSequence),
    terminal: { kind: "completed", afterSequence },
  };
}

function findCheckpoint(log: ReplayLog, afterSequence: number) {
  return log.checkpoints.find((checkpoint) => checkpoint.afterSequence === afterSequence);
}

function assertLimits(
  log: ReplayLog,
  afterSequence: number,
  maxEntries: number | undefined,
  maxTicks: number | undefined,
): void {
  const entryLimit = maxEntries ?? DEFAULT_REPLAY_MAX_ENTRIES;
  const tickLimit = maxTicks ?? DEFAULT_REPLAY_MAX_TICKS;
  if (
    !Number.isSafeInteger(entryLimit) ||
    entryLimit < 1 ||
    Object.is(entryLimit, -0) ||
    !Number.isSafeInteger(tickLimit) ||
    tickLimit < 1 ||
    Object.is(tickLimit, -0)
  ) {
    throw new RangeError("Replay limits must be nonnegative safe integers.");
  }
  const remaining = log.entries.slice(afterSequence);
  if (remaining.length > entryLimit) throw new RangeError("Replay entry limit exceeded.");
  let ticks = 0;
  for (const entry of remaining) {
    if (entry.operation.kind !== "step") continue;
    if (entry.operation.ticks > tickLimit - ticks)
      throw new RangeError("Replay tick limit exceeded.");
    ticks += entry.operation.ticks;
  }
}

export function verifyReplayAndCreateResumeArtifact(
  options: ReplayResumeBuildOptions,
): ReplayResumeArtifact {
  let log: ReplayLog;
  try {
    log = parseReplayLog(options.log);
  } catch (error: unknown) {
    throw reportFailure(
      "invalid-log",
      error instanceof Error ? error.message : "Invalid Replay log.",
    );
  }
  if (
    !Number.isSafeInteger(options.afterSequence) ||
    options.afterSequence < 0 ||
    Object.is(options.afterSequence, -0)
  ) {
    throw reportFailure(
      "invalid-log",
      "Replay resume boundary must be a nonnegative safe integer.",
    );
  }
  const checkpoint = findCheckpoint(log, options.afterSequence);
  if (checkpoint === undefined) {
    throw reportFailure("invalid-log", "Replay resume checkpoint boundary is not present.");
  }
  if (checkpoint.pendingCommandCount !== 0) {
    throw reportFailure("invalid-log", "Replay resume checkpoint has a pending command.");
  }
  if (checkpoint.afterSequence === log.terminal.afterSequence && checkpoint.afterSequence !== 0) {
    throw reportFailure("invalid-log", "Replay resume cannot use the terminal boundary.");
  }

  const fullReport = runReplay({
    content: options.content,
    initialState: options.initialState,
    log,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  if (fullReport.status !== "matched") {
    throw new ReplayResumeValidationError(
      "The complete Replay must match before a resume artifact can be certified.",
      fullReport,
    );
  }

  let coreState: GameState;
  try {
    coreState = structuredClone(options.initialState) as GameState;
    const core = createProductionSimCore({
      content: options.content,
      initialState: coreState,
      initialCommandQueueSequence: log.initialCommandQueueSequence,
    });
    const prefixExecution =
      options.afterSequence === 0
        ? { report: fullReport, core }
        : executeParsedReplay({
            content: options.content,
            log: createPrefixLog(log, options.afterSequence),
            core,
          });
    if (prefixExecution.report.status !== "matched") {
      throw new Error("Replay prefix did not match its requested checkpoint.");
    }
    coreState = prefixExecution.core.getStateForSave();
  } catch (error: unknown) {
    throw new ReplayResumeValidationError(
      "The requested Replay checkpoint could not be reconstructed.",
      {
        status: "invalid-initial-state",
        replayHash: null,
        finalTick: null,
        finalStateHash: null,
        finalQueuePosition: null,
        executedEntries: options.afterSequence,
        executedTicks: checkpoint.tick,
        lastMatchingCheckpointAfterSequence: null,
        mismatch: {
          kind: "checkpoint",
          sequence: options.afterSequence,
          category: "reconstruction",
          path: null,
          expected: error instanceof Error ? error.message : "unknown",
          actual: null,
          lastMatchingCheckpointAfterSequence: null,
        },
      },
    );
  }

  const queue = (() => {
    const core = createProductionSimCore({
      content: options.content,
      initialState: coreState,
      initialCommandQueueSequence: checkpoint.nextQueueSequence,
    });
    return core.getCommandQueuePosition();
  })();
  if (
    coreState.tick !== checkpoint.tick ||
    hashCanonicalState(coreState) !== checkpoint.stateHash ||
    queue.nextSequence !== checkpoint.nextQueueSequence ||
    queue.pendingCount !== 0
  ) {
    throw reportFailure(
      "invalid-initial-state",
      "Reconstructed checkpoint does not match its hash.",
    );
  }

  return freezeDetached({
    resumeVersion: 1,
    replayHash: hashCanonicalState(log),
    afterSequence: options.afterSequence,
    state: coreState,
    nextQueueSequence: checkpoint.nextQueueSequence,
  });
}

export function resumeReplay(options: ReplayResumeOptions): ReplayVerificationReport {
  let log: ReplayLog;
  let artifact: ReplayResumeArtifact;
  try {
    log = parseReplayLog(options.log);
    artifact = parseReplayResumeArtifact(options.artifact);
  } catch {
    return immutableReport(
      {
        status: "invalid-log",
        replayHash: null,
        finalTick: null,
        finalStateHash: null,
        finalQueuePosition: null,
        executedEntries: 0,
        executedTicks: 0,
        lastMatchingCheckpointAfterSequence: null,
      },
      null,
    );
  }

  const replayHash = hashCanonicalState(log);
  if (options.content.contentVersion !== log.contentVersion) {
    return immutableReport(
      reportFailure("incompatible", "Content version mismatch").report,
      replayHash,
    );
  }
  if (hashSimulationContent(options.content) !== log.simulationContentHash) {
    return immutableReport(
      reportFailure("incompatible", "Simulation content fingerprint mismatch").report,
      replayHash,
    );
  }
  if (artifact.replayHash !== replayHash) {
    return immutableReport(
      reportFailure("invalid-log", "Resume artifact is bound to another Replay log.").report,
      replayHash,
    );
  }
  const checkpoint = findCheckpoint(log, artifact.afterSequence);
  if (checkpoint === undefined) {
    return immutableReport(
      reportFailure("invalid-log", "Resume boundary is not present.").report,
      replayHash,
    );
  }
  if (
    checkpoint.pendingCommandCount !== 0 ||
    (checkpoint.afterSequence === log.terminal.afterSequence && checkpoint.afterSequence !== 0) ||
    artifact.nextQueueSequence !== checkpoint.nextQueueSequence
  ) {
    return immutableReport(
      reportFailure("invalid-log", "Resume boundary is not resumable.").report,
      replayHash,
    );
  }
  try {
    assertCanonicalSerializable(artifact.state);
    const core = createProductionSimCore({
      content: options.content,
      initialState: structuredClone(artifact.state),
      initialCommandQueueSequence: artifact.nextQueueSequence,
    });
    const state = core.getStateForSave();
    if (
      state.seed !== log.seed ||
      state.contentVersion !== log.contentVersion ||
      state.tick !== checkpoint.tick ||
      hashCanonicalState(state) !== checkpoint.stateHash ||
      core.getCommandQueuePosition().pendingCount !== 0
    ) {
      return immutableReport(
        reportFailure("invalid-initial-state", "Resume state does not match the checkpoint.")
          .report,
        replayHash,
      );
    }
    try {
      assertLimits(
        log,
        artifact.afterSequence,
        options.limits?.maxEntries,
        options.limits?.maxTicks,
      );
    } catch {
      return immutableReport(
        reportFailure("limit-exceeded", "Replay resume limit exceeded.").report,
        replayHash,
      );
    }
    return executeParsedReplay({
      content: options.content,
      log,
      core,
      startSequence: artifact.afterSequence + 1,
      initialLastMatchingCheckpoint: artifact.afterSequence,
    }).report;
  } catch {
    return immutableReport(
      reportFailure("invalid-initial-state", "Resume state validation failed.").report,
      replayHash,
    );
  }
}
