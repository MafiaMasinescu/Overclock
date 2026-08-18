import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { App } from "../App.tsx";
import { createFakeGameClient } from "../game-client/fakeGameClient.ts";
import { createAppI18n } from "../../localization/i18n.ts";
import "../../styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root application host.");
}

const i18n = await createAppI18n("ro");
document.documentElement.lang = i18n.resolvedLanguage ?? "ro";

createRoot(rootElement).render(
  <I18nextProvider i18n={i18n}>
    <App client={createFakeGameClient()} />
  </I18nextProvider>,
);
