import { loadContentBundle } from "../../content/loader/contentLoader.ts";
import { createBrowserWorkerSavePersistence } from "./savePersistence.ts";
import { createSimWorkerHost } from "./simWorkerHost.ts";
import type { WorkerReply } from "./protocol.ts";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  postMessage(message: WorkerReply): void;
}

const scope = globalThis as unknown as WorkerScope;
const content = loadContentBundle();
const persistence = createBrowserWorkerSavePersistence(content);
const host = createSimWorkerHost({
  content,
  persistence,
  postMessage: (reply) => {
    scope.postMessage(reply);
  },
});

scope.addEventListener("message", (event) => {
  void host.receive(event.data).catch(() => {
    host.destroy();
  });
});
scope.addEventListener("error", () => {
  host.destroy();
});
scope.addEventListener("messageerror", () => {
  host.destroy();
});
