import type { ReactElement } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { GameClient } from "../../app/game-client/contracts.ts";
import { useGameClientSnapshot } from "../../app/game-client/useGameClientSnapshot.ts";
import { CenterWorkspace } from "../workspaces/CenterWorkspace.tsx";
import { BuildTray } from "./BuildTray.tsx";
import { Header } from "./Header.tsx";
import { LeftRail } from "./LeftRail.tsx";
import { OperationsStack } from "./OperationsStack.tsx";
import { PersistenceControls } from "./PersistenceControls.tsx";
import type { PlayerSettings } from "../../save/contracts.ts";

interface AppShellProps {
  client: GameClient;
  onNewRun?: () => void;
  onRecover?: (slotId: string, lastKnownLiveTick: number | undefined) => void;
}

export function AppShell({ client, onNewRun, onRecover }: AppShellProps): ReactElement {
  const snapshot = useGameClientSnapshot(client);
  const connectionStatus = useSyncExternalStore(
    (listener) => client.subscribeConnection(listener),
    () => client.getConnectionStatus(),
    () => client.getConnectionStatus(),
  );
  const { i18n, t } = useTranslation();

  const applyImportedSettings = (settings: PlayerSettings): void => {
    document.documentElement.lang = settings.language;
    void i18n.changeLanguage(settings.language);
  };

  if (snapshot === null) {
    const status = connectionStatus === "live" ? "resync-required" : connectionStatus;
    return (
      <div className="app-shell" aria-busy="true">
        <div className="connection-banner" role="status" aria-live="polite">
          {t(`ui.connection-${status}`)}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {connectionStatus !== "live" && (
        <div
          className={`connection-banner connection-banner--${connectionStatus}`}
          role={connectionStatus === "resync-required" ? "status" : "alert"}
          aria-live="polite"
        >
          {t(`ui.connection-${connectionStatus}`)}
        </div>
      )}
      <Header header={snapshot.header} />
      <LeftRail />
      <CenterWorkspace client={client} />
      <BuildTray />
      <OperationsStack snapshot={snapshot} />
      <PersistenceControls
        client={client}
        onImportedSettings={applyImportedSettings}
        speed={snapshot.header.speed}
        {...(onNewRun === undefined ? {} : { onNewRun })}
        {...(onRecover === undefined ? {} : { onRecover })}
      />
    </div>
  );
}
