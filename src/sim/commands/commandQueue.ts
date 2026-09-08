import type { CommandReceipt, SimCommand } from "./contracts.ts";
import { createQueuedCommandReceipt } from "./commandReceipts.ts";
import { parseSimCommand } from "./commandSchema.ts";

const MAX_SAFE_SEQUENCE = Number.MAX_SAFE_INTEGER;

export interface CommandQueuePosition {
  readonly nextSequence: number;
  readonly pendingCount: number;
}

function assertValidInitialSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || Object.is(sequence, -0)) {
    throw new RangeError("Command queue sequence must be a nonnegative safe integer.");
  }
}

export class CommandQueue {
  private readonly commands: SimCommand[] = [];
  private nextSequence: number;

  constructor(initialNextSequence = 0) {
    assertValidInitialSequence(initialNextSequence);
    this.nextSequence = initialNextSequence;
  }

  get pendingCount(): number {
    return this.commands.length;
  }

  getPosition(): CommandQueuePosition {
    return Object.freeze({ nextSequence: this.nextSequence, pendingCount: this.commands.length });
  }

  enqueue(input: unknown): CommandReceipt {
    const command = parseSimCommand(input);
    if (this.nextSequence === MAX_SAFE_SEQUENCE) {
      throw new RangeError("Command queue sequence is exhausted at Number.MAX_SAFE_INTEGER.");
    }
    const queueSequence = this.nextSequence;

    this.commands.push(command);
    this.nextSequence += 1;

    return createQueuedCommandReceipt(command.commandId, queueSequence);
  }

  dequeue(): SimCommand | undefined {
    return this.commands.shift();
  }
}
