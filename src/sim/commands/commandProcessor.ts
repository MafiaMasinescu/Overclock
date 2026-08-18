import type { GameState } from "../core/types.ts";
import { canonicalSerialize } from "../replay/canonicalState.ts";
import { createSeededRngFromState } from "../rng/seededRng.ts";
import type { CommandReceipt, CommandResult, SimCommand } from "./contracts.ts";
import { dispatchRegisteredCommand, type CommandHandlerRegistry } from "./commandHandlers.ts";
import { CommandQueue } from "./commandQueue.ts";

export const SIMULATOR_INVARIANT_VIOLATION = "SIMULATOR_INVARIANT_VIOLATION" as const;

export class SimulatorInvariantError extends Error {
  readonly code = SIMULATOR_INVARIANT_VIOLATION;
  readonly commandId: string;
  override readonly cause: unknown;

  constructor(commandId: string, cause: unknown) {
    super(`Simulator invariant violation while processing command ${commandId}.`, { cause });
    this.name = "SimulatorInvariantError";
    this.commandId = commandId;
    this.cause = cause;
  }
}

export interface CommandProcessorOptions {
  initialState: GameState;
  handlers?: CommandHandlerRegistry;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function validateCandidateState(candidate: GameState, expectedTick: number): void {
  canonicalSerialize(candidate);
  if (candidate.tick !== expectedTick) {
    throw new Error("Command handlers must not advance or replace the current simulation tick.");
  }
}

function createRejectedResult(
  command: SimCommand,
  tick: number,
  reason: "STALE_TICK" | "COMMAND_NOT_AVAILABLE",
): CommandResult {
  return {
    commandId: command.commandId,
    accepted: false,
    rejectedAtTick: tick,
    code: reason,
    messageKey: reason === "STALE_TICK" ? "errors.stale-tick" : "errors.command-not-available",
  };
}

export class CommandProcessor {
  private state: GameState;
  private readonly handlers: CommandHandlerRegistry;
  private readonly queue = new CommandQueue();

  constructor({ initialState, handlers = {} }: CommandProcessorOptions) {
    canonicalSerialize(initialState);
    this.state = cloneState(initialState);
    this.handlers = handlers;
  }

  get pendingCommandCount(): number {
    return this.queue.pendingCount;
  }

  enqueue(input: unknown): CommandReceipt {
    return this.queue.enqueue(input);
  }

  getState(): GameState {
    return cloneState(this.state);
  }

  processQueuedCommands(): CommandResult[] {
    const results: CommandResult[] = [];
    let command = this.queue.dequeue();

    while (command !== undefined) {
      results.push(this.processCommand(command));
      command = this.queue.dequeue();
    }

    return results;
  }

  private processCommand(command: SimCommand): CommandResult {
    const currentTick = this.state.tick;
    if (command.expectedTick !== undefined && command.expectedTick !== currentTick) {
      return createRejectedResult(command, currentTick, "STALE_TICK");
    }

    try {
      const candidate = cloneState(this.state);
      const candidateRng = createSeededRngFromState(candidate.rngState);
      const handled = dispatchRegisteredCommand(
        this.handlers,
        { state: candidate, rng: candidateRng },
        command,
      );

      if (!handled) {
        return createRejectedResult(command, currentTick, "COMMAND_NOT_AVAILABLE");
      }

      candidate.rngState = candidateRng.getState();
      validateCandidateState(candidate, currentTick);
      this.state = candidate;

      return {
        commandId: command.commandId,
        accepted: true,
        appliedAtTick: currentTick,
      };
    } catch (cause: unknown) {
      throw new SimulatorInvariantError(command.commandId, cause);
    }
  }
}
