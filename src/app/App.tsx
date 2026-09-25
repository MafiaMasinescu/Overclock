import type { ReactElement } from "react";

import type { GameClient } from "./game-client/contracts.ts";
import { AppShell } from "../ui/layout/AppShell.tsx";

interface AppProps {
  client: GameClient;
  onNewRun?: () => void;
  onRecover?: (slotId: string, lastKnownLiveTick: number | undefined) => void;
}

export function App({ client, onNewRun, onRecover }: AppProps): ReactElement {
  return (
    <AppShell
      client={client}
      {...(onNewRun === undefined ? {} : { onNewRun })}
      {...(onRecover === undefined ? {} : { onRecover })}
    />
  );
}
