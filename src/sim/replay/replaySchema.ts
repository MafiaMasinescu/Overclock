import {
  REPLAY_VERSION,
  SIMULATOR_PROTOCOL_VERSION,
  type ReplayCheckpoint,
  type ReplayEntry,
  type ReplayFatalOutcome,
  type ReplayLog,
  type ReplayOperation,
  type ReplayOutcome,
  type ReplayTerminal,
} from "./replayContracts.ts";
import type { CommandReceipt, CommandRejectionCode, CommandResult } from "../commands/contracts.ts";
import { parseSimCommand } from "../commands/commandSchema.ts";
import type { StepResult } from "../core/simCore.ts";
import type { TickSystemStage } from "../core/tickSystems.ts";
import { assertCanonicalReplayParserInput, detachAndFreezeReplayData } from "./replayOwnership.ts";

interface ReplayObject {
  readonly [key: string]: unknown;
  readonly kind?: unknown;
  readonly commandId?: unknown;
  readonly queued?: unknown;
  readonly queueSequence?: unknown;
  readonly accepted?: unknown;
  readonly appliedAtTick?: unknown;
  readonly rejectedAtTick?: unknown;
  readonly code?: unknown;
  readonly messageKey?: unknown;
  readonly parameters?: unknown;
  readonly startTick?: unknown;
  readonly endTick?: unknown;
  readonly ticksExecuted?: unknown;
  readonly simulatedSecondsAdvanced?: unknown;
  readonly commandResults?: unknown;
  readonly origin?: unknown;
  readonly tick?: unknown;
  readonly stage?: unknown;
  readonly receipt?: unknown;
  readonly result?: unknown;
  readonly results?: unknown;
  readonly command?: unknown;
  readonly ticks?: unknown;
  readonly afterSequence?: unknown;
  readonly stateHash?: unknown;
  readonly nextQueueSequence?: unknown;
  readonly pendingCommandCount?: unknown;
  readonly replayVersion?: unknown;
  readonly simulatorProtocolVersion?: unknown;
  readonly seed?: unknown;
  readonly contentVersion?: unknown;
  readonly simulationContentHash?: unknown;
  readonly initialStateHash?: unknown;
  readonly initialTick?: unknown;
  readonly initialCommandQueueSequence?: unknown;
  readonly entries?: unknown;
  readonly checkpoints?: unknown;
  readonly terminal?: unknown;
  readonly sequence?: unknown;
  readonly tickBefore?: unknown;
  readonly tickAfter?: unknown;
  readonly operation?: unknown;
  readonly outcome?: unknown;
}

const HASH_PATTERN = /^[0-9a-f]{16}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICK_SYSTEM_STAGES: readonly TickSystemStage[] = [
  "rebuild-dirty-connectivity",
  "calculate-power-demand-and-delivery",
  "calculate-workload-allocation",
  "calculate-heat-generation",
  "update-thermal-state",
  "apply-throttling-stability-and-shutdown",
  "calculate-theoretical-and-useful-compute",
  "advance-tasks-and-benchmarks",
  "advance-research",
  "apply-economy-and-energy-costs",
  "update-tutorial-achievements-and-campaign",
  "emit-events",
  "produce-dirty-snapshot-data",
];
const COMMAND_REJECTION_CODES: readonly CommandRejectionCode[] = [
  "INVALID_PAYLOAD",
  "STALE_TICK",
  "NOT_IN_DESIGN_MODE",
  "ALREADY_IN_DESIGN_MODE",
  "STALE_DRAFT_REVISION",
  "STALE_DESIGN_PREVIEW",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_INVENTORY",
  "INSUFFICIENT_RESEARCH_DATA",
  "RESEARCH_REQUIRED",
  "OUT_OF_BOUNDS",
  "TILE_OCCUPIED",
  "INVALID_PORT",
  "INCOMPATIBLE_PORTS",
  "INVALID_ROUTE",
  "NO_ROUTE_FOUND",
  "INVALID_SYSTEM",
  "TASK_SLOT_LIMIT",
  "TASK_REQUIREMENT_MISSING",
  "TASK_NOT_ACTIVE",
  "RESEARCH_NOT_AVAILABLE",
  "RESEARCH_ALREADY_ACTIVE",
  "OVERCLOCK_OUT_OF_RANGE",
  "OVERCLOCK_TARGET_INVALID",
  "OVERCLOCK_UNSUPPORTED",
  "OVERCLOCK_UNAVAILABLE_IN_DESIGN_MODE",
  "BLUEPRINT_INVALID",
  "BENCHMARK_ALREADY_ACTIVE",
  "BENCHMARK_REQUIREMENT_MISSING",
  "BENCHMARK_NOT_ACTIVE",
  "BENCHMARK_CONFIGURATION_LOCKED",
  "COMMAND_NOT_AVAILABLE",
];

function isObject(value: unknown): value is ReplayObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertStandardReplayData(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${path} must use the standard Array prototype.`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) {
      throw new TypeError(`${path} must be a dense plain array without custom properties.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      assertStandardReplayData(value[index], `${path}[${index}]`);
    }
    return;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${path} must use the standard Object prototype.`);
  }
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) {
    throw new TypeError(`${path} must not contain symbols or hidden properties.`);
  }
  for (const key of keys) {
    assertStandardReplayData((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

function assertObject(value: unknown, path: string): asserts value is ReplayObject {
  if (!isObject(value)) throw new TypeError(`${path} must be a plain object.`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = [...expected].toSorted();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${path} has an unexpected key set.`);
  }
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) {
    throw new TypeError(`${path} must be a finite non-negative-zero number.`);
  }
}

function assertSafeInteger(value: unknown, path: string, minimum: number): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum
  ) {
    throw new TypeError(`${path} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string.`);
}

function assertUuid(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${path} must be an RFC-compatible UUID.`);
}

function assertHash(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (!HASH_PATTERN.test(value))
    throw new TypeError(`${path} must be a lowercase 16-character hash.`);
}

function parseCommandReceipt(value: unknown): CommandReceipt {
  assertObject(value, "receipt");
  assertExactKeys(value, ["commandId", "queued", "queueSequence"], "receipt");
  assertUuid(value.commandId, "receipt.commandId");
  if (value.queued !== true) throw new TypeError("Replay enqueue outcomes require queued=true.");
  assertSafeInteger(value.queueSequence, "receipt.queueSequence", 0);
  return {
    commandId: value.commandId,
    queued: true,
    queueSequence: value.queueSequence,
  };
}

function parseResultParameters(value: unknown): Record<string, string | number | boolean> {
  assertObject(value, "result.parameters");
  const parameters: Record<string, string | number | boolean> = {};
  for (const [key, parameter] of Object.entries(value)) {
    if (
      typeof parameter !== "string" &&
      typeof parameter !== "boolean" &&
      (typeof parameter !== "number" || !Number.isFinite(parameter) || Object.is(parameter, -0))
    ) {
      throw new TypeError(`result.parameters.${key} must be a finite JSON scalar.`);
    }
    parameters[key] = parameter;
  }
  return parameters;
}

function parseCommandResult(value: unknown): CommandResult {
  assertObject(value, "command result");
  if (value.accepted === true) {
    assertExactKeys(value, ["commandId", "accepted", "appliedAtTick"], "accepted command result");
    assertUuid(value.commandId, "command result.commandId");
    assertSafeInteger(value.appliedAtTick, "command result.appliedAtTick", 0);
    return { commandId: value.commandId, accepted: true, appliedAtTick: value.appliedAtTick };
  }
  if (value.accepted !== false)
    throw new TypeError("command result.accepted must discriminate the result.");
  const keys = Object.keys(value);
  const allowed = ["commandId", "accepted", "rejectedAtTick", "code", "messageKey", "parameters"];
  if (keys.some((key) => !allowed.includes(key)) || keys.length < 5) {
    throw new TypeError("rejected command result has an unexpected key set.");
  }
  assertUuid(value.commandId, "command result.commandId");
  assertSafeInteger(value.rejectedAtTick, "command result.rejectedAtTick", 0);
  assertString(value.code, "command result.code");
  assertString(value.messageKey, "command result.messageKey");
  const code = COMMAND_REJECTION_CODES.find((candidate) => candidate === value.code);
  if (code === undefined) throw new TypeError("command result.code is not supported.");
  return {
    commandId: value.commandId,
    accepted: false,
    rejectedAtTick: value.rejectedAtTick,
    code,
    messageKey: value.messageKey,
    ...(Object.hasOwn(value, "parameters")
      ? { parameters: parseResultParameters(value.parameters) }
      : {}),
  };
}

function parseStepResult(value: unknown): StepResult {
  assertObject(value, "step result");
  assertExactKeys(
    value,
    ["startTick", "endTick", "ticksExecuted", "simulatedSecondsAdvanced", "commandResults"],
    "step result",
  );
  assertSafeInteger(value.startTick, "step result.startTick", 0);
  assertSafeInteger(value.endTick, "step result.endTick", value.startTick);
  assertSafeInteger(value.ticksExecuted, "step result.ticksExecuted", 0);
  assertFinite(value.simulatedSecondsAdvanced, "step result.simulatedSecondsAdvanced");
  if (!Array.isArray(value.commandResults))
    throw new TypeError("step result.commandResults must be an array.");
  const commandResults = value.commandResults.map(parseCommandResult);
  return {
    startTick: value.startTick,
    endTick: value.endTick,
    ticksExecuted: value.ticksExecuted,
    simulatedSecondsAdvanced: value.simulatedSecondsAdvanced,
    commandResults,
  };
}

function parseFatalOutcome(value: ReplayObject): ReplayFatalOutcome {
  if (value.code !== "SIMULATOR_INVARIANT_VIOLATION") {
    throw new TypeError("fatal replay outcome has an unsupported code.");
  }
  assertString(value.origin, "fatal.origin");
  assertSafeInteger(value.tick, "fatal.tick", 0);
  if (value.origin === "command") {
    assertExactKeys(value, ["kind", "code", "origin", "commandId", "tick"], "command fatal");
    assertUuid(value.commandId, "fatal.commandId");
    return {
      kind: "fatal",
      code: "SIMULATOR_INVARIANT_VIOLATION",
      origin: "command",
      commandId: value.commandId,
      tick: value.tick,
    };
  }
  if (value.origin === "tick-system") {
    assertExactKeys(value, ["kind", "code", "origin", "commandId", "tick", "stage"], "tick fatal");
    if (value.commandId !== null) throw new TypeError("tick-system fatal commandId must be null.");
    assertString(value.stage, "fatal.stage");
    if (!TICK_SYSTEM_STAGES.includes(value.stage as TickSystemStage)) {
      throw new TypeError("fatal.stage is not a registered tick-system stage.");
    }
    return {
      kind: "fatal",
      code: "SIMULATOR_INVARIANT_VIOLATION",
      origin: "tick-system",
      commandId: null,
      tick: value.tick,
      stage: value.stage as TickSystemStage,
    };
  }
  throw new TypeError("fatal.origin is not supported.");
}

function parseReplayOutcome(value: unknown, operation: ReplayOperation): ReplayOutcome {
  assertObject(value, "entry.outcome");
  assertString(value.kind, "entry.outcome.kind");
  if (value.kind === "fatal") return parseFatalOutcome(value);

  if (operation.kind === "enqueue") {
    if (value.kind !== "receipt") throw new TypeError("enqueue must pair with a receipt outcome.");
    assertExactKeys(value, ["kind", "receipt"], "receipt outcome");
    const receipt = parseCommandReceipt(value.receipt);
    if (receipt.commandId !== operation.command.commandId) {
      throw new TypeError("receipt commandId must match the enqueued command.");
    }
    return { kind: "receipt", receipt };
  }
  if (operation.kind === "clock") {
    if (value.kind !== "clock-result")
      throw new TypeError("clock must pair with a clock-result outcome.");
    assertExactKeys(value, ["kind", "result"], "clock outcome");
    const result = parseCommandResult(value.result);
    if (result.commandId !== operation.command.commandId) {
      throw new TypeError("clock result commandId must match the clock command.");
    }
    return { kind: "clock-result", result };
  }
  if (operation.kind === "process-pending") {
    if (value.kind !== "command-results") {
      throw new TypeError("process-pending must pair with command-results.");
    }
    assertExactKeys(value, ["kind", "results"], "command-results outcome");
    if (!Array.isArray(value.results))
      throw new TypeError("command-results.results must be an array.");
    return { kind: "command-results", results: value.results.map(parseCommandResult) };
  }
  if (value.kind !== "step-result")
    throw new TypeError("step must pair with a step-result outcome.");
  assertExactKeys(value, ["kind", "result"], "step outcome");
  return { kind: "step-result", result: parseStepResult(value.result) };
}

export function parseReplayOperation(value: unknown): ReplayOperation {
  assertCanonicalReplayParserInput(value, "Replay operation");
  assertStandardReplayData(value, "operation");
  assertObject(value, "operation");
  assertString(value.kind, "operation.kind");

  if (value.kind === "enqueue") {
    assertExactKeys(value, ["kind", "command"], "enqueue operation");
    return detachAndFreezeReplayData({ kind: "enqueue", command: parseSimCommand(value.command) });
  }
  if (value.kind === "clock") {
    assertExactKeys(value, ["kind", "command"], "clock operation");
    const command = parseSimCommand(value.command);
    if (command.kind !== "SET_PAUSED" && command.kind !== "SET_SPEED") {
      throw new TypeError("clock operation requires SET_PAUSED or SET_SPEED.");
    }
    return detachAndFreezeReplayData({ kind: "clock", command });
  }
  if (value.kind === "process-pending") {
    assertExactKeys(value, ["kind"], "process-pending operation");
    return detachAndFreezeReplayData({ kind: "process-pending" });
  }
  if (value.kind === "step") {
    assertExactKeys(value, ["kind", "ticks"], "step operation");
    assertSafeInteger(value.ticks, "operation.ticks", 0);
    return detachAndFreezeReplayData({ kind: "step", ticks: value.ticks });
  }
  throw new TypeError("operation.kind is not a supported Replay operation.");
}

function parseCheckpoint(value: unknown, path: string): ReplayCheckpoint {
  assertObject(value, path);
  assertExactKeys(
    value,
    ["afterSequence", "tick", "stateHash", "nextQueueSequence", "pendingCommandCount"],
    path,
  );
  assertSafeInteger(value.afterSequence, `${path}.afterSequence`, 0);
  assertSafeInteger(value.tick, `${path}.tick`, 0);
  assertHash(value.stateHash, `${path}.stateHash`);
  assertSafeInteger(value.nextQueueSequence, `${path}.nextQueueSequence`, 0);
  assertSafeInteger(value.pendingCommandCount, `${path}.pendingCommandCount`, 0);
  return {
    afterSequence: value.afterSequence,
    tick: value.tick,
    stateHash: value.stateHash,
    nextQueueSequence: value.nextQueueSequence,
    pendingCommandCount: value.pendingCommandCount,
  };
}

function parseTerminal(value: unknown): ReplayTerminal {
  assertObject(value, "terminal");
  assertString(value.kind, "terminal.kind");
  if (value.kind !== "completed" && value.kind !== "fatal") {
    throw new TypeError("terminal.kind is not supported.");
  }
  assertExactKeys(value, ["kind", "afterSequence"], "terminal");
  assertSafeInteger(value.afterSequence, "terminal.afterSequence", 0);
  return { kind: value.kind, afterSequence: value.afterSequence };
}

function parseReplayEntry(
  value: unknown,
  expectedSequence: number,
  previousTick: number,
): ReplayEntry {
  assertObject(value, `entries[${expectedSequence - 1}]`);
  assertExactKeys(
    value,
    ["sequence", "tickBefore", "tickAfter", "operation", "outcome"],
    "replay entry",
  );
  assertSafeInteger(value.sequence, "entry.sequence", 1);
  if (value.sequence !== expectedSequence)
    throw new TypeError("Replay entry sequences must be contiguous from 1.");
  assertSafeInteger(value.tickBefore, "entry.tickBefore", previousTick);
  assertSafeInteger(value.tickAfter, "entry.tickAfter", value.tickBefore);
  const operation = parseReplayOperation(value.operation);
  const outcome = parseReplayOutcome(value.outcome, operation);
  return {
    sequence: value.sequence,
    tickBefore: value.tickBefore,
    tickAfter: value.tickAfter,
    operation,
    outcome,
  };
}

function parseReplayLogInternal(value: unknown): ReplayLog {
  assertCanonicalReplayParserInput(value, "Replay log");
  assertStandardReplayData(value, "replay log");
  assertObject(value, "replay log");
  assertExactKeys(
    value,
    [
      "replayVersion",
      "simulatorProtocolVersion",
      "seed",
      "contentVersion",
      "simulationContentHash",
      "initialStateHash",
      "initialTick",
      "initialCommandQueueSequence",
      "entries",
      "checkpoints",
      "terminal",
    ],
    "replay log",
  );
  if (value.replayVersion !== REPLAY_VERSION) throw new TypeError("Unsupported replayVersion.");
  if (value.simulatorProtocolVersion !== SIMULATOR_PROTOCOL_VERSION) {
    throw new TypeError("Unsupported simulatorProtocolVersion.");
  }
  assertString(value.seed, "replay log.seed");
  if (value.seed.trim().length === 0) throw new TypeError("replay log.seed must not be blank.");
  assertString(value.contentVersion, "replay log.contentVersion");
  if (value.contentVersion.length === 0)
    throw new TypeError("replay log.contentVersion must not be empty.");
  assertHash(value.simulationContentHash, "replay log.simulationContentHash");
  assertHash(value.initialStateHash, "replay log.initialStateHash");
  assertSafeInteger(value.initialTick, "replay log.initialTick", 0);
  assertSafeInteger(value.initialCommandQueueSequence, "replay log.initialCommandQueueSequence", 0);
  if (!Array.isArray(value.entries)) throw new TypeError("replay log.entries must be an array.");
  if (!Array.isArray(value.checkpoints))
    throw new TypeError("replay log.checkpoints must be an array.");

  const entries: ReplayEntry[] = [];
  let fatalCount = 0;
  let fatalIndex = -1;
  let previousTick = value.initialTick;
  for (let index = 0; index < value.entries.length; index += 1) {
    const entry = parseReplayEntry(value.entries[index], index + 1, previousTick);
    entries.push(entry);
    if (entry.outcome.kind === "fatal") {
      fatalCount += 1;
      fatalIndex = index;
    }
    previousTick = entry.tickAfter;
  }
  const terminal = parseTerminal(value.terminal);
  if (terminal.afterSequence !== entries.length) {
    throw new TypeError("terminal.afterSequence must equal the final entry sequence.");
  }

  const checkpoints: ReplayCheckpoint[] = [];
  let previousBoundary = -1;
  let previousCheckpointTick = value.initialTick;
  for (let index = 0; index < value.checkpoints.length; index += 1) {
    const checkpoint = parseCheckpoint(value.checkpoints[index], `checkpoints[${index}]`);
    if (checkpoint.afterSequence <= previousBoundary) {
      throw new TypeError("Replay checkpoints must have strictly increasing boundaries.");
    }
    if (checkpoint.afterSequence > entries.length) {
      throw new TypeError("Replay checkpoint is beyond the terminal operation boundary.");
    }
    if (checkpoint.tick < previousCheckpointTick) {
      throw new TypeError("Replay checkpoint ticks must not decrease.");
    }
    checkpoints.push(checkpoint);
    previousBoundary = checkpoint.afterSequence;
    previousCheckpointTick = checkpoint.tick;
  }
  const initialCheckpoint = checkpoints[0];
  if (initialCheckpoint?.afterSequence !== 0) {
    throw new TypeError("Replay logs require an initial checkpoint at sequence 0.");
  }
  if (
    initialCheckpoint.tick !== value.initialTick ||
    initialCheckpoint.stateHash !== value.initialStateHash ||
    initialCheckpoint.nextQueueSequence !== value.initialCommandQueueSequence ||
    initialCheckpoint.pendingCommandCount !== 0
  ) {
    throw new TypeError("The initial checkpoint does not match the replay header.");
  }
  const finalCheckpoint = checkpoints[checkpoints.length - 1];
  if (finalCheckpoint?.afterSequence !== terminal.afterSequence) {
    throw new TypeError("Replay logs require a checkpoint at the terminal boundary.");
  }
  if (terminal.kind === "completed" && finalCheckpoint.pendingCommandCount !== 0) {
    throw new TypeError("Completed Replay logs require an empty terminal command queue.");
  }
  if (terminal.kind === "fatal") {
    if (fatalCount !== 1) {
      throw new TypeError("Fatal Replay logs require exactly one fatal outcome.");
    }
    if (fatalIndex !== entries.length - 1) {
      throw new TypeError("Fatal Replay logs require the fatal outcome at the final entry.");
    }
  } else if (fatalCount !== 0) {
    throw new TypeError("Completed Replay logs cannot contain fatal outcomes.");
  }

  return {
    replayVersion: REPLAY_VERSION,
    simulatorProtocolVersion: SIMULATOR_PROTOCOL_VERSION,
    seed: value.seed,
    contentVersion: value.contentVersion,
    simulationContentHash: value.simulationContentHash,
    initialStateHash: value.initialStateHash,
    initialTick: value.initialTick,
    initialCommandQueueSequence: value.initialCommandQueueSequence,
    entries,
    checkpoints,
    terminal,
  };
}

export function parseReplayLog(value: unknown): ReplayLog {
  return detachAndFreezeReplayData(parseReplayLogInternal(value));
}

export function validateReplayLog(value: unknown): string[] {
  try {
    parseReplayLogInternal(value);
    return [];
  } catch (error: unknown) {
    return [error instanceof Error ? error.message : "Replay log validation failed."];
  }
}
