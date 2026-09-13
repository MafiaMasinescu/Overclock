import { parseSimCommand } from "../../sim/commands/commandSchema.ts";
import type { CommandMeta, CommandSource, SimCommand } from "../../sim/commands/contracts.ts";

const BOT_COMMAND_PREFIX = "7f5b5f84-6f15-4a4a-9000-";
const MAX_BOT_COMMAND_SEQUENCE = 999_999_999_999;

export interface BotCommandIdAllocator {
  readonly next: () => string;
  readonly peek: () => number;
}

export function createBotCommandIdAllocator(initialSequence = 1): BotCommandIdAllocator {
  if (
    !Number.isSafeInteger(initialSequence) ||
    initialSequence < 1 ||
    initialSequence > MAX_BOT_COMMAND_SEQUENCE
  ) {
    throw new RangeError("Bot command sequence must be in the supported positive range.");
  }
  let sequence = initialSequence;
  return Object.freeze({
    next(): string {
      if (sequence > MAX_BOT_COMMAND_SEQUENCE) {
        throw new RangeError("Bot command ID sequence is exhausted.");
      }
      const id = `${BOT_COMMAND_PREFIX}${sequence.toString().padStart(12, "0")}`;
      sequence += 1;
      return id;
    },
    peek(): number {
      return sequence;
    },
  });
}

export function createBotCommand<K extends SimCommand["kind"]>(
  allocator: BotCommandIdAllocator,
  payload: Omit<Extract<SimCommand, { kind: K }>, keyof CommandMeta>,
  expectedTick: number,
): Extract<SimCommand, { kind: K }> {
  const command = {
    ...payload,
    commandId: allocator.next(),
    source: "debug" as CommandSource,
    expectedTick,
  } as Extract<SimCommand, { kind: K }>;
  return parseSimCommand(command) as Extract<SimCommand, { kind: K }>;
}
