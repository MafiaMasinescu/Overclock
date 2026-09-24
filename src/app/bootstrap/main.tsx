import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { App } from "../App.tsx";
import { loadContentBundle } from "../../content/loader/contentLoader.ts";
import { createWorkerGameClient } from "../game-client/workerGameClient.ts";
import { createAppI18n } from "../../localization/i18n.ts";
import "../../styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root application host.");
}

const i18n = await createAppI18n("ro");
document.documentElement.lang = i18n.resolvedLanguage ?? "ro";
const root = createRoot(rootElement);
const provider = (children: ReactNode) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;

root.render(
  provider(
    <main className="connection-bootstrap" role="status" aria-live="polite">
      {i18n.t("ui.connection-connecting")}
    </main>,
  ),
);

try {
  const content = loadContentBundle();
  const client = await createWorkerGameClient({
    content,
    seed: globalThis.crypto.randomUUID(),
  });
  root.render(provider(<App client={client} />));
} catch {
  root.render(
    provider(
      <main className="connection-bootstrap" role="alert">
        {i18n.t("ui.connection-failed")}
      </main>,
    ),
  );
}
