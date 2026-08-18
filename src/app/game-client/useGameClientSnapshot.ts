import { useSyncExternalStore } from "react";

import type { GameClient } from "./contracts.ts";

export function useGameClientSnapshot(client: GameClient) {
  return useSyncExternalStore(
    (listener) => client.subscribe(listener),
    () => client.getSnapshot(),
    () => client.getSnapshot(),
  );
}
