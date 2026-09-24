import { createWorkerGameClient } from "../../../src/app/game-client/workerGameClient.ts";
import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import { parseSimCommand } from "../../../src/sim/commands/commandSchema.ts";

declare global {
  interface Window {
    __workerSmoke?: {
      readonly ok: boolean;
      readonly tick?: number;
      readonly publicationApplied?: boolean;
      readonly commandAccepted?: boolean;
      readonly paused?: boolean;
      readonly error?: string;
    };
  }
}

async function waitForRunningSnapshot(
  client: Awaited<ReturnType<typeof createWorkerGameClient>>,
): Promise<void> {
  if (!client.getSnapshot().header.paused) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `Worker did not publish the command snapshot; paused is ${client.getSnapshot().header.paused}.`,
        ),
      );
    }, 5_000);
    const unsubscribe = client.subscribe(() => {
      if (client.getSnapshot().header.paused) return;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

try {
  const content = loadContentBundle();
  const client = await createWorkerGameClient({
    content,
    seed: "chromium-worker-client-smoke",
    epoch: "chromium-worker-smoke",
  });
  try {
    const published = waitForRunningSnapshot(client);
    const result = await client.dispatch(
      parseSimCommand({
        commandId: "76000000-0000-4000-8000-000000000031",
        source: "player",
        kind: "SET_PAUSED",
        paused: false,
        expectedTick: 0,
      }),
    );
    await published;
    const snapshot = client.getSnapshot();
    window.__workerSmoke = {
      ok: true,
      tick: snapshot.tick,
      publicationApplied: client.getGridViewModel().revision >= 0,
      commandAccepted: result.accepted,
      paused: snapshot.header.paused,
    };
  } finally {
    client.destroy();
  }
} catch (error) {
  window.__workerSmoke = {
    ok: false,
    error: error instanceof Error ? error.message : "Unknown Worker client smoke failure.",
  };
}
