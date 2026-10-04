import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import "../../../src/styles.css";
import { AppShell } from "../../../src/ui/layout/AppShell.tsx";
import { createAppI18n } from "../../../src/localization/i18n.ts";
import { createWorkerGameClient } from "../../../src/app/game-client/workerGameClient.ts";
import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import { parseSimCommand } from "../../../src/sim/commands/commandSchema.ts";
import { decodeSaveEnvelope } from "../../../src/save/codec.ts";
import { hashCanonicalState } from "../../../src/sim/replay/canonicalState.ts";
import { parseWorkerReply } from "../../../src/app/worker/protocol.ts";

export async function mount() {
  const content = loadContentBundle();
  let observedWorker: Worker | null = null;
  let gapNextPublication = false;
  const workerFactory = () => {
    const worker = new Worker(new URL("../../../src/app/worker/entry.ts", import.meta.url), {
      type: "module",
    });
    observedWorker = worker;
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!gapNextPublication) return;
      const reply = parseWorkerReply(event.data);
      if (reply.kind !== "SNAPSHOT_PUBLICATION" || reply.body.publication === null) return;
      gapNextPublication = false;
      event.stopImmediatePropagation();
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            ...reply,
            body: {
              ...reply.body,
              publication: {
                ...reply.body.publication,
                publicationSequence: 0,
              },
            },
          },
        }),
      );
    });
    return worker;
  };
  let client = await createWorkerGameClient({ content, seed: "task23-shell", workerFactory });
  const contexts: string[][] = [];
  function observe() {
    const publish = client.setPresentationContext.bind(client);
    client.setPresentationContext = (context) => {
      contexts.push([...context.selectedIds]);
      return publish(context);
    };
  }
  observe();
  async function command(input: Record<string, unknown>) {
    const result = await client.dispatch(
      parseSimCommand({ commandId: crypto.randomUUID(), source: "player", ...input }),
    );
    if (!result.accepted) throw new Error(`Rejected fixture command: ${JSON.stringify(result)}`);
  }
  await command({ kind: "ENTER_DESIGN_MODE" });
  for (const [definitionId, x] of [
    ["module-power-distribution", 0],
    ["module-vacuum-tube-logic", 4],
    ["module-control-unit", 8],
  ] as const) {
    await command({ kind: "PLACE_MODULE", definitionId, position: { x, y: 0 }, rotation: 0 });
  }
  await command({
    kind: "CONNECT_PORTS",
    from: { moduleInstanceId: "module-instance-00000001", portId: "power-out-east" },
    to: { moduleInstanceId: "module-instance-00000002", portId: "power-in-west" },
    path: [1, 2, 3, 4].map((x) => ({ x, y: 0 })),
  });
  const { result } = await client.queryBuild({
    kind: "apply",
    mode: "draft",
    clientIntentSequence: 1,
  });
  if (result.kind !== "apply" || result.status !== "ready" || result.data.status !== "ready")
    throw new Error("Fixture apply unavailable");
  await command({
    kind: "APPLY_DESIGN",
    expectedDraftRevision: result.data.draftRevision,
    acceptedCostUsd: result.data.netCostUsd,
    acceptedDowntimeTicks: result.data.downtimeTicks,
  });
  await client.setPaused(false);
  await new Promise<void>((resolve) => {
    const unsubscribe = client.subscribe(() => {
      if (client.getSnapshot().tick < 30) return;
      unsubscribe();
      resolve();
    });
  });
  await client.setPaused(true);
  const slot = await client.requestSave("manual");
  const i18n = await createAppI18n("en");
  const host = document.getElementById("root");
  if (host === null) throw new Error("Missing shell host");
  const root = createRoot(host);
  const render = () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AppShell, { client })));
  };
  render();
  return {
    command,
    contexts,
    getClient: () => client,
    failWorker: () => observedWorker?.dispatchEvent(new Event("messageerror")),
    async resyncSelection() {
      const transitions: string[] = [];
      const unsubscribe = client.subscribeConnection(() =>
        transitions.push(client.getConnectionStatus()),
      );
      try {
        gapNextPublication = true;
        await client.setPresentationContext({
          selectedIds: ["route-00000001"],
          inspectedEntityId: "route-00000001",
          heatmapEnabled: false,
        });
        return transitions;
      } finally {
        unsubscribe();
      }
    },
    setLanguage: (language: "ro" | "en") => i18n.changeLanguage(language),
    snapshot: () => client.getSnapshot(),
    grid: () => client.getGridViewModel(),
    async savedEvidence() {
      const saved = await client.requestSave("manual");
      const summary = (await client.listSlots()).find(
        (candidate) => candidate.slotId === saved.slotId,
      );
      if (summary === undefined) throw new Error("Missing saved fixture");
      const bytes = await client.exportSlot(saved.slotId, summary.revision);
      const decoded = await decodeSaveEnvelope(bytes, { content });
      return {
        hash: hashCanonicalState(decoded.payload.gameState),
        rngState: decoded.payload.gameState.rngState,
      };
    },
    async replace(kind: "load" | "recover" | "client") {
      if (kind === "client") {
        client.destroy();
        client = await createWorkerGameClient({
          content,
          seed: "task23-replacement",
          recoverSlotId: slot.slotId,
          workerFactory,
        });
        observe();
        render();
      } else if (kind === "load") await client.loadSlot(slot.slotId);
      else await client.recover(slot.slotId);
    },
  };
}
