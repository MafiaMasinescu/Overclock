import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameClient } from "../../app/game-client/contracts.ts";
import type { PlayerSettings } from "../../save/contracts.ts";

// Settings are detached host/session metadata, never fields in a simulation model.
// Refresh only on session connection transitions or an explicitly applied import.
export function useRendererSettings(
  client: GameClient,
  importRevision: number,
): PlayerSettings | null {
  const connection = useSyncExternalStore(
    (listener) => client.subscribeConnection(listener),
    () => client.getConnectionStatus(),
  );
  const [admitted, setAdmitted] = useState<{
    client: GameClient;
    settings: PlayerSettings | null;
  } | null>(null);
  useEffect(() => {
    let obsolete = false;
    if (connection !== "live") return;
    void client
      .queryBuild({ kind: "context", mode: "live", clientIntentSequence: 1 })
      .then((reply) => {
        if (!obsolete) setAdmitted({ client, settings: reply.settings });
      })
      .catch(() => {
        // Recovery owns transport errors; do not overwrite accepted metadata.
      });
    return () => {
      obsolete = true;
    };
  }, [client, connection, importRevision]);
  return admitted?.client === client ? admitted.settings : null;
}
