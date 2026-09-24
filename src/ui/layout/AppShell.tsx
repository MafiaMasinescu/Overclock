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

interface AppShellProps {
  client: GameClient;
}

export function AppShell({ client }: AppShellProps): ReactElement {
  const snapshot = useGameClientSnapshot(client);
  const connectionStatus = useSyncExternalStore(
    (listener) => client.subscribeConnection(listener),
    () => client.getConnectionStatus(),
    () => client.getConnectionStatus(),
  );
  const { t } = useTranslation();

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
    </div>
  );
}
