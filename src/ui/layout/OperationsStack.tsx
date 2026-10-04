import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { SelectionController } from "../workspaces/selectionController.ts";
import type {
  GridViewModel,
  InspectorViewModel,
  UiSnapshot,
} from "../../app/game-client/snapshots.ts";

interface OperationsStackProps {
  selection: readonly string[];
  selectionController: SelectionController;
  grid: GridViewModel;
  snapshot: UiSnapshot;
  interactive: boolean;
}

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value: number | null, language: string, unavailable: string): string {
  if (value === null) return unavailable;
  if (value < 1024) return `${formatNumber(value, language)} B`;
  if (value < 1024 * 1024) return `${formatNumber(value / 1024, language)} KiB`;
  return `${formatNumber(value / (1024 * 1024), language)} MiB`;
}

function inspectorKindLabel(
  inspector: InspectorViewModel,
  translate: (key: string) => string,
): string {
  if (inspector.entityKind === null) return translate("ui.no-selection");
  return translate(`ui.inspector-${inspector.entityKind}`);
}

export function OperationsStack({
  selection,
  selectionController,
  grid,
  snapshot,
  interactive,
}: OperationsStackProps): ReactElement {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage ?? "ro";
  const task = snapshot.tasks[0];
  const progress = task === undefined ? 0 : Math.min(1, Math.max(0, task.progressRatio));
  const inspector = snapshot.inspector;
  const tileCoordinates =
    inspector.entityKind === "tile" && inspector.selectedEntityId !== null
      ? /^tile:(\d+):(\d+)$/.exec(inspector.selectedEntityId)
      : null;
  const inspectorTitle =
    tileCoordinates === null
      ? inspector.selectedEntityId
      : `tile:${Number(tileCoordinates[1]) + 1}:${Number(tileCoordinates[2]) + 1}`;
  const unavailable = t("ui.unavailable");
  const selectedRoute =
    inspector.entityKind === "route"
      ? grid.routes.find((route) => route.id === inspector.selectedEntityId)
      : undefined;
  const physicalStats = [...inspector.stats];
  const expectedPhysicalKeys =
    inspector.entityKind === "module"
      ? ["ui.power", "ui.temperature", "ui.useful-compute"]
      : inspector.entityKind === "route" && selectedRoute?.kind === "power"
        ? ["ui.power"]
        : [];
  for (const labelKey of expectedPhysicalKeys) {
    if (!physicalStats.some((stat) => stat.labelKey === labelKey))
      physicalStats.push({ labelKey, value: unavailable });
  }

  return (
    <aside className="operations-stack" data-testid="operations-stack">
      <section className="ops-section task-section" data-testid="active-task">
        <div className="panel-heading">
          <span className="panel-index">01</span>
          <div>
            <span className="eyebrow">{t("ui.operations")}</span>
            <h2>{t("ui.active-task")}</h2>
          </div>
        </div>
        <div className="task-card">
          <span className="task-status-light" aria-hidden="true" />
          <div>
            <strong>{task === undefined ? t("ui.no-active-task") : t(task.nameKey)}</strong>
            <span>{task === undefined ? unavailable : task.status}</span>
          </div>
          <span className="task-progress">
            {task === undefined ? unavailable : `${formatNumber(progress * 100, language)}%`}
          </span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        {task === undefined ? (
          <p className="empty-copy">{t("ui.task-data-unavailable")}</p>
        ) : (
          <div className="tag-row">
            {task.tags.map((tag) => (
              <span key={tag}>{tag.toUpperCase()}</span>
            ))}
          </div>
        )}
      </section>

      <section className="ops-section telemetry-section">
        <div className="panel-heading">
          <span className="panel-index">02</span>
          <div>
            <span className="eyebrow">{t("ui.authoritative-readouts")}</span>
            <h2>{t("ui.telemetry")}</h2>
          </div>
        </div>
        <dl className="telemetry-grid">
          <div>
            <dt>{t("ui.memory")}</dt>
            <dd>{formatBytes(snapshot.telemetry.memoryUsedBytes, language, unavailable)}</dd>
          </div>
          <div>
            <dt>{t("ui.research-data")}</dt>
            <dd>{formatNumber(snapshot.telemetry.researchData, language)}</dd>
          </div>
          <div>
            <dt>{t("ui.power-headroom")}</dt>
            <dd>{formatNumber(snapshot.telemetry.powerHeadroomWatts, language)} W</dd>
          </div>
          <div>
            <dt>{t("ui.retry-rate")}</dt>
            <dd>
              {snapshot.telemetry.retryRate === null
                ? unavailable
                : `${formatNumber(snapshot.telemetry.retryRate * 100, language)}%`}
            </dd>
          </div>
        </dl>
        <p className="empty-copy telemetry-note">{t("ui.telemetry-chart-unavailable")}</p>
      </section>

      <section className="ops-section inspector-section">
        <div className="panel-heading">
          <span className="panel-index">03</span>
          <div>
            <span className="eyebrow">{inspectorKindLabel(inspector, t)}</span>
            <h2>{t("ui.inspector")}</h2>
          </div>
        </div>
        <div className="entity-list" role="listbox" aria-label={t("ui.entity-list")}>
          {grid.modules.map((module) => (
            <button
              type="button"
              role="option"
              disabled={!interactive}
              aria-selected={selection.includes(module.id)}
              key={module.id}
              onClick={(event) => {
                selectionController.selectEntity(module.id, event.shiftKey);
              }}
            >
              {module.id}
            </button>
          ))}
          {grid.routes.map((route) => (
            <button
              type="button"
              role="option"
              disabled={!interactive}
              aria-selected={selection.includes(route.id)}
              key={route.id}
              onClick={(event) => {
                selectionController.selectEntity(route.id, event.shiftKey);
              }}
            >
              {route.id}
            </button>
          ))}
          {grid.modules.length === 0 && grid.routes.length === 0 && (
            <span className="entity-list-empty">{t("ui.no-entities")}</span>
          )}
        </div>
        {inspector.selectedEntityId === null ? (
          <p className="empty-copy">{t("ui.no-selection")}</p>
        ) : (
          <div className="inspector-card">
            <div className="inspector-title-row">
              <strong>
                {inspector.titleKey === null ? inspectorTitle : t(inspector.titleKey)}
              </strong>
              <span className="source-badge">
                {grid.mode === "draft" ? t("ui.draft-source") : t("ui.live-source")}
              </span>
            </div>
            {selectedRoute !== undefined && (
              <dl className="inspector-route-details">
                <div>
                  <dt>{t("ui.route-from")}</dt>
                  <dd>{selectedRoute.from.moduleInstanceId}</dd>
                </div>
                <div>
                  <dt>{t("ui.route-to")}</dt>
                  <dd>{selectedRoute.to.moduleInstanceId}</dd>
                </div>
                <div>
                  <dt>{t("ui.capacity")}</dt>
                  <dd>{unavailable}</dd>
                </div>
              </dl>
            )}
            <dl className="inspector-stats">
              <div>
                <dt>{t("ui.authoritative-readouts")}</dt>
                <dd>
                  <span className="source-badge">
                    {t("ui.live-source")} · {t("ui.source-tick")} {snapshot.tick}
                  </span>
                </dd>
              </div>
              {physicalStats.length === 0 && (
                <div>
                  <dt>{t("ui.no-inspector-data")}</dt>
                  <dd>{unavailable}</dd>
                </div>
              )}
              {physicalStats.map((stat) => (
                <div key={`${stat.labelKey}-${stat.unitKey ?? "value"}`}>
                  <dt>{t(stat.labelKey)}</dt>
                  <dd className={stat.state === "critical" ? "value-critical" : undefined}>
                    {typeof stat.value === "number"
                      ? formatNumber(stat.value, language)
                      : stat.value}
                    {stat.unitKey === undefined ? "" : ` ${t(stat.unitKey)}`}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>
      <footer className="ops-footer">{t("ui.shell-status")}</footer>
    </aside>
  );
}
