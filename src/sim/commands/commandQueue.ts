import type { CommandReceipt, SimCommand } from "./contracts.ts";
import { createQueuedCommandReceipt } from "./commandReceipts.ts";
import { parseSimCommand } from "./commandSchema.ts";

export class CommandQueue {
  private readonly commands: SimCommand[] = [];
  private nextSequence = 0;

  get pendingCount(): number {
    return this.commands.length;
  }

  enqueue(input: unknown): CommandReceipt {
    const command = parseSimCommand(input);
    const queueSequence = this.nextSequence;

    this.commands.push(command);
    this.nextSequence += 1;

    return createQueuedCommandReceipt(command.commandId, queueSequence);
  }

  dequeue(): SimCommand | undefined {
    return this.commands.shift();
  }
}
