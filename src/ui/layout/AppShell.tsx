import type { ReactElement } from "react";

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

  return (
    <div className="app-shell">
      <Header header={snapshot.header} />
      <LeftRail />
      <CenterWorkspace client={client} />
      <BuildTray />
      <OperationsStack snapshot={snapshot} />
    </div>
  );
}
