import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { App } from "../App.tsx";
import { createWorkerGameClient } from "../game-client/workerGameClient.ts";
import type { GameClient } from "../game-client/contracts.ts";
import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";

interface RunningSessionProps {
  readonly initialClient: GameClient;
  readonly content: ContentBundle;
}

export function RunningSession({ initialClient, content }: RunningSessionProps): ReactElement {
  const { t } = useTranslation();
  const [client, setClient] = useState(initialClient);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [restartError, setRestartError] = useState(false);

  async function restart(recoverSlotId?: string, lastKnownLiveTick?: number): Promise<void> {
    client.destroy();
    setRestartError(false);
    try {
      const nextClient = await createWorkerGameClient({
        content,
        seed: globalThis.crypto.randomUUID(),
        ...(recoverSlotId !== undefined ? { recoverSlotId } : {}),
        ...(lastKnownLiveTick !== undefined ? { lastKnownLiveTick } : {}),
      });
      setClient(nextClient);
      setSessionRevision((revision) => revision + 1);
    } catch {
      setRestartError(true);
    }
  }

  return (
    <>
      <App
        key={sessionRevision}
        client={client}
        onNewRun={() => void restart()}
        onRecover={(slotId, tick) => void restart(slotId, tick)}
      />
      {restartError && (
        <div className="connection-banner connection-banner--degraded" role="alert">
          {t("ui.persistence-recovery-failed")}
        </div>
      )}
    </>
  );
}
