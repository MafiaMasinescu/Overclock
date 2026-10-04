import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type {
  GameClient,
  GridIntent,
  PixiGridAdapter,
  PixiGridAdapterStatus,
} from "../../app/game-client/contracts.ts";
import type { GridViewModel } from "../../app/game-client/snapshots.ts";
import { createPixiGridAdapter } from "../../rendering/pixi/pixiGridAdapter.ts";
import type { SelectionController } from "./selectionController.ts";
import { useRendererSettings } from "./useRendererSettings.ts";

interface CenterWorkspaceProps {
  client: GameClient;
  grid: GridViewModel;
  selection: readonly string[];
  selectionController: SelectionController;
  inspectedEntityId: string | null;
  settingsImportRevision: number;
  interactive: boolean;
}

function statusLabel(status: PixiGridAdapterStatus): string {
  return `ui.canvas-${status}`;
}

export function CenterWorkspace({
  client,
  grid,
  selection,
  selectionController,
  inspectedEntityId,
  settingsImportRevision,
  interactive,
}: CenterWorkspaceProps): ReactElement {
  const { t } = useTranslation();
  const adapterRef = useRef<PixiGridAdapter | null>(null);
  const latestGrid = useRef(grid);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PixiGridAdapterStatus>("initializing");
  const [interactionMode, setInteractionMode] = useState<"select" | "pan">("select");
  const [zoom, setZoom] = useState(1);
  const settings = useRendererSettings(client, settingsImportRevision);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (host === null) return;

    const adapter = createPixiGridAdapter();
    adapterRef.current = adapter;
    const unsubscribeStatus = adapter.subscribeStatus(setStatus);
    const unsubscribeIntents = adapter.subscribeIntents((intent: GridIntent) => {
      if (intent.kind === "CAMERA_CHANGED") {
        setZoom(intent.zoom);
      } else if (intent.kind === "SELECT_ENTITY") {
        selectionController.selectEntity(intent.entityId, intent.additive);
      } else if (intent.kind === "SELECT_RECT") {
        selectionController.selectRectangle(intent.from, intent.to, intent.additive);
      }
    });

    adapter.mount(host);
    adapter.update(latestGrid.current);
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        adapter.resize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio);
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      unsubscribeIntents();
      unsubscribeStatus();
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [client, selectionController]);

  useEffect(() => {
    adapterRef.current?.setInteractionMode({ kind: interactionMode });
  }, [client, selectionController, interactionMode]);

  useEffect(() => {
    latestGrid.current = grid;
    adapterRef.current?.update(grid);
  }, [grid]);

  useEffect(() => {
    adapterRef.current?.setInspectedEntity(inspectedEntityId);
  }, [inspectedEntityId]);

  useEffect(() => {
    adapterRef.current?.setSelectedEntities(selection);
  }, [selection]);

  useEffect(() => {
    adapterRef.current?.setFrameCap(settings?.frameCap ?? 60);
    adapterRef.current?.setReducedEffects(settings?.reducedEffects ?? false);
  }, [client, selectionController, settings]);

  useEffect(() => {
    adapterRef.current?.setInputEnabled(interactive);
  }, [client, selectionController, interactive]);

  useEffect(() => {
    adapterRef.current?.setModuleLabels(
      Object.fromEntries(
        grid.modules.map((module) => [
          module.definitionId,
          t(`modules.${module.definitionId}.shortName`),
        ]),
      ),
    );
  }, [client, selectionController, grid.modules, t]);

  const modeLabel = grid.mode === "draft" ? t("ui.draft") : t("ui.live");
  const rendererStatus = t(statusLabel(status));

  return (
    <main className="center-workspace" data-testid="center-workspace">
      <div className="workspace-titlebar">
        <div>
          <span className="eyebrow">
            FACILITY ALPHA / {grid.gridSize.width}×{grid.gridSize.height}
          </span>
          <h1>{t("ui.workspace")}</h1>
        </div>
        <span className={`status-chip status-chip--${status}`} role="status" aria-live="polite">
          {modeLabel} · {rendererStatus}
        </span>
      </div>
      <div className="canvas-toolbar" aria-label={t("ui.canvas-tools")} inert={!interactive}>
        <button
          type="button"
          className={interactionMode === "select" ? "toolbar-button is-active" : "toolbar-button"}
          aria-pressed={interactionMode === "select"}
          onClick={() => {
            setInteractionMode("select");
          }}
        >
          {t("ui.select-tool")}
        </button>
        <button
          type="button"
          className={interactionMode === "pan" ? "toolbar-button is-active" : "toolbar-button"}
          aria-pressed={interactionMode === "pan"}
          onClick={() => {
            setInteractionMode("pan");
          }}
        >
          {t("ui.pan-tool")}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => adapterRef.current?.zoomOut()}
        >
          −<span className="sr-only">{t("ui.zoom-out")}</span>
        </button>
        <button type="button" className="toolbar-button" onClick={() => adapterRef.current?.fit()}>
          {t("ui.fit-camera")}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => adapterRef.current?.zoomIn()}
        >
          +<span className="sr-only">{t("ui.zoom-in")}</span>
        </button>
        <output className="canvas-zoom" aria-label={t("ui.zoom-level")}>
          {Math.round(zoom * 100)}%
        </output>
        {(status === "error" || status === "context-lost") && (
          <button
            type="button"
            className="toolbar-button toolbar-button--warning"
            onClick={() => {
              adapterRef.current?.retry();
            }}
          >
            {t("ui.retry-canvas")}
          </button>
        )}
      </div>
      <div className="canvas-frame" inert={!interactive}>
        <div
          ref={canvasHostRef}
          className="pixi-canvas-host"
          data-testid="pixi-canvas-host"
          data-testid-canvas="facility-grid"
        />
        <div className="canvas-help" aria-live="polite">
          {status === "error" || status === "context-lost"
            ? t(`ui.${status === "error" ? "canvas-renderer-error" : "canvas-context-lost"}`)
            : t("ui.canvas-instructions")}
        </div>
      </div>
    </main>
  );
}
