import { useEffect, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { GameClient } from "../../app/game-client/contracts.ts";
import { createEmptyPixiGridAdapter } from "../../rendering/pixi/emptyPixiGridAdapter.ts";

interface CenterWorkspaceProps {
  client: GameClient;
}

export function CenterWorkspace({ client }: CenterWorkspaceProps): ReactElement {
  const { t } = useTranslation();
  const canvasHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (host === null) {
      return;
    }

    const adapter = createEmptyPixiGridAdapter();
    adapter.mount(host);
    adapter.update(client.getGridViewModel());
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        adapter.resize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio);
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      adapter.destroy();
    };
  }, [client]);

  return (
    <main className="center-workspace" data-testid="center-workspace">
      <div className="workspace-titlebar">
        <div>
          <span className="eyebrow">FACILITY ALPHA / 24×16</span>
          <h1>{t("ui.workspace")}</h1>
        </div>
        <span className="status-chip">PHASE 0 · CANVAS READY</span>
      </div>
      <div className="canvas-frame">
        <div ref={canvasHostRef} className="pixi-canvas-host" data-testid="pixi-canvas-host" />
        <div className="canvas-index canvas-index-top" aria-hidden="true">
          00&nbsp;&nbsp;&nbsp;04&nbsp;&nbsp;&nbsp;08&nbsp;&nbsp;&nbsp;12&nbsp;&nbsp;&nbsp;16&nbsp;&nbsp;&nbsp;20&nbsp;&nbsp;&nbsp;24
        </div>
        <div className="canvas-empty-state">
          <span className="vacuum-glyph" aria-hidden="true">
            Φ
          </span>
          <strong>{t("ui.workspace-empty")}</strong>
          <small>{t("ui.workspace-hint")}</small>
        </div>
      </div>
    </main>
  );
}
