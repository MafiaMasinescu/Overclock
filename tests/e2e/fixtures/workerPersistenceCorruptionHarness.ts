import { createWorkerGameClient } from "../../../src/app/game-client/workerGameClient.ts";
import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import { openOverclockDatabase } from "../../../src/save/repository/indexedDb.ts";
import { createSaveRepositoryCore } from "../../../src/save/repository/repository.ts";

declare global {
  interface Window {
    __workerPersistenceCorruption?: {
      readonly ok: boolean;
      readonly captureSequence?: number;
      readonly skippedCorruptRecords?: number;
      readonly remainingSequences?: readonly number[];
      readonly error?: string;
    };
  }
}

async function run(): Promise<void> {
  const content = loadContentBundle();
  let client: Awaited<ReturnType<typeof createWorkerGameClient>> | null = null;
  let recoveredClient: Awaited<ReturnType<typeof createWorkerGameClient>> | null = null;
  let storage: Awaited<ReturnType<typeof openOverclockDatabase>> | null = null;
  try {
    client = await createWorkerGameClient({
      content,
      seed: "chromium-worker-corruption-smoke",
      epoch: "chromium-worker-corruption",
    });
    const manual = await client.requestSave("manual");
    await client.requestSave("autosave");
    await client.requestSave("autosave");
    client.destroy();
    client = null;

    storage = await openOverclockDatabase();
    await storage.runTransaction(["autosaves"], "readwrite", async (tx) => {
      const stored = await tx.get("autosaves", [manual.slotId, 2]);
      if (stored === undefined || typeof stored !== "object" || stored === null) {
        throw new Error("Missing autosave generation to corrupt.");
      }
      const record = stored as { readonly envelope?: Record<string, unknown> };
      await tx.put("autosaves", [manual.slotId, 2], {
        ...record,
        envelope: { ...record.envelope, checksum: "0".repeat(64) },
      });
    });

    recoveredClient = await createWorkerGameClient({
      content,
      seed: "chromium-worker-corruption-recovery",
      epoch: "chromium-worker-corruption-recovery",
      recoverSlotId: manual.slotId,
    });
    const recovery = recoveredClient.getRecoverySummary();
    if (recovery === null) throw new Error("Recovery summary was not published.");
    await recoveredClient.continueHost();
    await recoveredClient.requestSave("autosave");
    await recoveredClient.requestSave("autosave");
    await recoveredClient.requestSave("autosave");
    const repository = createSaveRepositoryCore(storage);
    window.__workerPersistenceCorruption = {
      ok: true,
      captureSequence: recovery.captureSequence,
      skippedCorruptRecords: recovery.skippedCorruptRecords,
      remainingSequences: await repository.listAutosaveSequences(manual.slotId),
    };
  } finally {
    recoveredClient?.destroy();
    client?.destroy();
    storage?.close();
  }
}

void run().catch((error: unknown) => {
  window.__workerPersistenceCorruption = {
    ok: false,
    error: error instanceof Error ? error.message : "Worker persistence corruption smoke failed.",
  };
});
