import type { ReactElement } from "react";

import type { GameClient } from "./game-client/contracts.ts";
import { AppShell } from "../ui/layout/AppShell.tsx";

interface AppProps {
  client: GameClient;
}

export function App({ client }: AppProps): ReactElement {
  return <AppShell client={client} />;
}
