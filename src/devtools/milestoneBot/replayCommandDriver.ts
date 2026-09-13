import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  CommandMeta,
  CommandRejectionCode,
  CommandResult,
  SimCommand,
} from "../../sim/commands/contracts.ts";
import { createInitialGameState } from "../../sim/core/createInitialGameState.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";
import { createReplayRecorder } from "../../sim/replay/replayRecorder.ts";
import type {
  ReplayEntry,
  ReplayRecordingArtifact,
  ReplayOperation,
} from "../../sim/replay/replayContracts.ts";
import {
  createBotCommand,
  createBotCommandIdAllocator,
  type BotCommandIdAllocator,
} from "./botCommandIds.ts";
import {
  assertValidBotRunConfiguration,
  createDefaultBotRunConfiguration,
  type BotCommandSummary,
  type BotRunConfiguration,
} from "./botContracts.ts";

export type BotCommandExpectation =
  { readonly accepted: true } | { readonly accepted: false; readonly code: CommandRejectionCode };

export type BotCommandPayload<K extends SimCommand["kind"]> = {
  readonly kind: K;
} & Omit<Extract<SimCommand, { kind: K }>, keyof CommandMeta | "kind">;

export interface BotExecutionFailureDetails {
  readonly kind: string;
  readonly commandId: string;
  readonly code: CommandRejectionCode | null;
  readonly tick: number;
}

export class BotExecutionError extends Error {
  readonly status = "command-rejected" as const;
  readonly details: BotExecutionFailureDetails;

  constructor(details: BotExecutionFailureDetails) {
    super(`Milestone bot command ${details.kind} did not meet its expected outcome.`);
    this.name = "BotExecutionError";
    this.details = details;
  }
}

export interface ReplayCommandDriver {
  readonly submitGameplayCommand: <K extends SimCommand["kind"]>(
    payload: BotCommandPayload<K>,
    expectation?: BotCommandExpectation,
  ) => CommandResult;
  readonly applyClockCommand: (
    payload: BotCommandPayload<"SET_PAUSED"> | BotCommandPayload<"SET_SPEED">,
    expectation?: BotCommandExpectation,
  ) => CommandResult;
  readonly advanceTicks: (ticks: number) => void;
  readonly checkpointIfDue: () => void;
  readonly getDetachedState: () => ReturnType<typeof createInitialGameState>;
  readonly getCommandSummary: () => BotCommandSummary;
  readonly getJournal: () => readonly ReplayEntry[];
  readonly finishReplay: () => ReplayRecordingArtifact;
  readonly commandIdAllocator: BotCommandIdAllocator;
}

function commandResultFromEntry(entry: ReplayEntry, commandId: string): CommandResult {
  if (entry.outcome.kind !== "command-results") {
    throw new Error("Replay command driver expected a command-results outcome.");
  }
  const result = entry.outcome.results.find((candidate) => candidate.commandId === commandId);
  if (result === undefined || entry.outcome.results.length !== 1) {
    throw new Error("Replay command driver expected exactly one result for one queued command.");
  }
  return result;
}

function assertExpected(
  command: SimCommand,
  result: CommandResult,
  expectation: BotCommandExpectation,
): void {
  if (expectation.accepted) {
    if (!result.accepted) {
      throw new BotExecutionError({
        kind: command.kind,
        commandId: command.commandId,
        code: result.code,
        tick: result.rejectedAtTick,
      });
    }
    return;
  }
  if (result.accepted || result.code !== expectation.code) {
    throw new BotExecutionError({
      kind: command.kind,
      commandId: command.commandId,
      code: result.accepted ? null : result.code,
      tick: result.accepted ? result.appliedAtTick : result.rejectedAtTick,
    });
  }
}

function assertReceipt(entry: ReplayEntry, commandId: string): void {
  if (
    entry.outcome.kind !== "receipt" ||
    entry.outcome.receipt.commandId !== commandId ||
    !entry.outcome.receipt.queued ||
    entry.outcome.receipt.queueSequence === null
  ) {
    throw new Error("Replay command driver did not receive a valid enqueue receipt.");
  }
}

function validateTicks(ticks: number): void {
  if (!Number.isSafeInteger(ticks) || ticks <= 0 || Object.is(ticks, -0)) {
    throw new RangeError("Bot advance ticks must be a positive safe integer.");
  }
}

export interface ReplayCommandDriverOptions {
  readonly content: ContentBundle;
  readonly seed: string;
  readonly initialState?: ReturnType<typeof createInitialGameState>;
  readonly configuration?: BotRunConfiguration;
}

export function createReplayCommandDriver({
  content,
  seed,
  initialState,
  configuration = createDefaultBotRunConfiguration(),
}: ReplayCommandDriverOptions): ReplayCommandDriver {
  assertValidBotRunConfiguration(configuration);
  const state = initialState ?? createInitialGameState({ content, seed });
  const recorder = createReplayRecorder({ content, initialState: state });
  const allocator = createBotCommandIdAllocator();
  const byKind: Record<string, number> = {};
  const rejectionCounts: Record<string, number> = {};
  let totalCommands = 0;
  let acceptedCommands = 0;
  let rejectedCommands = 0;
  let nextCheckpointTick = configuration.replayCheckpointIntervalTicks;
  let finished: ReplayRecordingArtifact | undefined;

  const note = (command: SimCommand, result: CommandResult): void => {
    totalCommands += 1;
    byKind[command.kind] = (byKind[command.kind] ?? 0) + 1;
    if (result.accepted) acceptedCommands += 1;
    else {
      rejectedCommands += 1;
      rejectionCounts[result.code] = (rejectionCounts[result.code] ?? 0) + 1;
    }
  };

  const submitGameplayCommand = <K extends SimCommand["kind"]>(
    payload: BotCommandPayload<K>,
    expectation: BotCommandExpectation = { accepted: true },
  ): CommandResult => {
    if (finished !== undefined) throw new Error("Bot command driver is already finished.");
    const current = recorder.getStateForSave();
    const command = createBotCommand(allocator, payload, current.tick);
    const enqueueOperation: ReplayOperation = { kind: "enqueue", command };
    const enqueueEntry = recorder.perform(enqueueOperation);
    assertReceipt(enqueueEntry, command.commandId);
    const processEntry = recorder.perform({ kind: "process-pending" });
    const result = commandResultFromEntry(processEntry, command.commandId);
    note(command, result);
    assertExpected(command, result, expectation);
    return detachAndFreezeReplayData(result);
  };

  const applyClockCommand = (
    payload: BotCommandPayload<"SET_PAUSED"> | BotCommandPayload<"SET_SPEED">,
    expectation: BotCommandExpectation = { accepted: true },
  ): CommandResult => {
    if (finished !== undefined) throw new Error("Bot command driver is already finished.");
    const command = createBotCommand(allocator, payload, recorder.getStateForSave().tick);
    const entry = recorder.perform({ kind: "clock", command });
    if (entry.outcome.kind !== "clock-result") {
      throw new Error("Replay clock driver expected a clock-result outcome.");
    }
    const result = entry.outcome.result;
    note(command, result);
    assertExpected(command, result, expectation);
    return detachAndFreezeReplayData(result);
  };

  const advanceTicks = (ticks: number): void => {
    if (finished !== undefined) throw new Error("Bot command driver is already finished.");
    validateTicks(ticks);
    const current = recorder.getStateForSave().tick;
    if (ticks > Number.MAX_SAFE_INTEGER - current)
      throw new RangeError("Bot tick budget overflow.");
    recorder.perform({ kind: "step", ticks });
    checkpointIfDue();
  };

  const checkpointIfDue = (): void => {
    if (finished !== undefined) throw new Error("Bot command driver is already finished.");
    const tick = recorder.getStateForSave().tick;
    if (tick >= nextCheckpointTick) {
      recorder.checkpoint();
      while (nextCheckpointTick <= tick)
        nextCheckpointTick += configuration.replayCheckpointIntervalTicks;
    }
  };

  const finishReplay = (): ReplayRecordingArtifact => {
    finished ??= recorder.finish();
    return detachAndFreezeReplayData(finished);
  };

  return Object.freeze({
    submitGameplayCommand,
    applyClockCommand,
    advanceTicks,
    checkpointIfDue,
    getDetachedState: () => detachAndFreezeReplayData(recorder.getStateForSave()),
    getCommandSummary: () =>
      detachAndFreezeReplayData({
        totalCommands,
        acceptedCommands,
        rejectedCommands,
        byKind,
        rejectionCounts,
      }),
    getJournal: () => {
      if (finished === undefined) {
        throw new Error("Finish the replay before reading its journal.");
      }
      return detachAndFreezeReplayData(finished.log.entries);
    },
    finishReplay,
    commandIdAllocator: allocator,
  });
}
