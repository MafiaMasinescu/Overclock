import { decodeSaveEnvelope, encodeEnvelopeBytes } from "../../../src/save/codec.ts";
import { createSaveRepositoryCore } from "../../../src/save/repository/repository.ts";
import { openOverclockDatabase } from "../../../src/save/repository/indexedDb.ts";
import { createWorkerGameClient } from "../../../src/app/game-client/workerGameClient.ts";
import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import { parseSimCommand } from "../../../src/sim/commands/commandSchema.ts";

declare global {
  interface Window {
    __workerPersistence?: {
      readonly ok: boolean;
      readonly slotId?: string;
      readonly tick?: number;
      readonly nextQueueSequence?: number;
      readonly localStatsPresent?: boolean;
      readonly recoveryHeld?: boolean;
      readonly continuedAfterRecovery?: boolean;
      readonly error?: string;
    };
  }
}

async function run(): Promise<void> {
  const content = loadContentBundle();
  const client = await createWorkerGameClient({
    content,
    seed: "chromium-worker-persistence-smoke",
    epoch: "chromium-worker-persistence",
  });
  try {
    const result = await client.dispatch(
      parseSimCommand({
        commandId: "76000000-0000-4000-8000-000000000201",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    if (!result.accepted)
      throw new Error(`Command-only capture setup was rejected: ${JSON.stringify(result)}`);
    const metadata = await client.requestSave("manual");
    const repository = createSaveRepositoryCore(await openOverclockDatabase());
    const stored = await repository.readManualSave(metadata.slotId);
    const decoded = await decodeSaveEnvelope(encodeEnvelopeBytes(stored.envelope), { content });
    client.destroy();
    const recoveredClient = await createWorkerGameClient({
      content,
      seed: "chromium-worker-recovery-smoke",
      epoch: "chromium-worker-recovery",
      recoverSlotId: metadata.slotId,
    });
    try {
      const recovery = recoveredClient.getRecoverySummary();
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 300));
      const heldSave = await recoveredClient.requestSave("manual");
      const recoveryHeld =
        recovery?.tick === decoded.payload.gameState.tick &&
        heldSave.tick === decoded.payload.gameState.tick;
      await recoveredClient.continueHost();
      await recoveredClient.setPaused(false);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 600));
      const continuedSave = await recoveredClient.requestSave("manual");
      window.__workerPersistence = {
        ok: true,
        slotId: metadata.slotId,
        tick: decoded.payload.gameState.tick,
        nextQueueSequence: decoded.payload.execution.nextQueueSequence,
        localStatsPresent: true,
        recoveryHeld,
        continuedAfterRecovery: continuedSave.tick > heldSave.tick,
      };
    } finally {
      recoveredClient.destroy();
    }
  } finally {
    client.destroy();
  }
}

void run().catch((error: unknown) => {
  window.__workerPersistence = {
    ok: false,
    error: error instanceof Error ? error.message : "Worker persistence smoke failed.",
  };
});
