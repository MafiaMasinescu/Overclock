import type { CommandReceipt } from "./contracts.ts";

export function createQueuedCommandReceipt(
  commandId: string,
  queueSequence: number,
): CommandReceipt {
  return {
    commandId,
    queued: true,
    queueSequence,
  };
}
