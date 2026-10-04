import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import type { GameClient } from "../../app/game-client/contracts.ts";
import type { GridViewModel, UiSnapshot } from "../../app/game-client/snapshots.ts";
import { createSelectionController } from "../workspaces/selectionController.ts";
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

// External-store reader, owned by one client. Retain only admitted immutable
// projections across an empty epoch so persistence dialogs stay mounted.
function createAdmittedReader<T>(read: () => T, initial: T): () => T {
  let admitted = initial;
  return () => {
    try {
      admitted = read();
    } catch {
      // Connection state disables input while the last readout stays frozen.
    }
    return admitted;
  };
}

export function AppShell({ client, onNewRun, onRecover }: AppShellProps): ReactElement {
  const selectionController = useMemo(() => createSelectionController(client), [client]);
  useEffect(() => selectionController.connect(), [selectionController]);
  const selection = useSyncExternalStore(
    selectionController.subscribe,
    selectionController.getSelection,
    selectionController.getSelection,
  );
  const getSnapshot = useMemo(
    () => createAdmittedReader<UiSnapshot | null>(() => client.getSnapshot(), null),
    [client],
  );
  const snapshot = useSyncExternalStore(
    (listener) => client.subscribe(listener),
    getSnapshot,
    getSnapshot,
  );
  const emptyGrid = useMemo<GridViewModel>(
    () => ({
      revision: 0,
      mode: "live",
      layoutRevision: 0,
      thermalRevision: 0,
      gridSize: { width: 24, height: 16 },
      modules: [],
      routes: [],
      heatmap: null,
      placementPreview: null,
      diagnosticHighlights: [],
    }),
    [],
  );
  const getGrid = useMemo(
    () => createAdmittedReader(() => client.getGridViewModel(), emptyGrid),
    [client, emptyGrid],
  );
  const grid = useSyncExternalStore((listener) => client.subscribe(listener), getGrid, getGrid);
  const connectionStatus = useSyncExternalStore(
    (listener) => client.subscribeConnection(listener),
    () => client.getConnectionStatus(),
    () => client.getConnectionStatus(),
  );
  const { i18n, t } = useTranslation();
  const [settingsImportRevision, setSettingsImportRevision] = useState(0);

  const applyImportedSettings = (settings: PlayerSettings): void => {
    setSettingsImportRevision((revision) => revision + 1);
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
      <Header client={client} header={snapshot.header} />
      <LeftRail />
      <CenterWorkspace
        client={client}
        grid={grid}
        selection={selection}
        selectionController={selectionController}
        inspectedEntityId={snapshot.inspector.selectedEntityId}
        settingsImportRevision={settingsImportRevision}
        interactive={connectionStatus === "live"}
      />
      <BuildTray />
      <OperationsStack
        selection={selection}
        selectionController={selectionController}
        grid={grid}
        snapshot={snapshot}
        interactive={connectionStatus === "live"}
      />
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
