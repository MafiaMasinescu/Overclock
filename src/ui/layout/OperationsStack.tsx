import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { UiSnapshot } from "../../app/game-client/snapshots.ts";

interface OperationsStackProps {
  snapshot: UiSnapshot;
}

export function OperationsStack({ snapshot }: OperationsStackProps): ReactElement {
  const { t } = useTranslation();
  const task = snapshot.tasks[0];

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
            <strong>{task === undefined ? t("ui.task-placeholder") : t(task.nameKey)}</strong>
            <span>{t("ui.task-status")}</span>
          </div>
          <span className="task-progress">18%</span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: "18%" }} />
        </div>
        <div className="tag-row">
          <span>SERIAL</span>
          <span>HISTORICAL</span>
        </div>
      </section>

      <section className="ops-section telemetry-section">
        <div className="panel-heading">
          <span className="panel-index">02</span>
          <div>
            <span className="eyebrow">STANDARD / STATIC</span>
            <h2>{t("ui.telemetry")}</h2>
          </div>
        </div>
        <dl className="telemetry-grid">
          <div>
            <dt>MEMORY</dt>
            <dd>0 B</dd>
          </div>
          <div>
            <dt>RESEARCH DATA</dt>
            <dd>{snapshot.telemetry.researchData}</dd>
          </div>
          <div>
            <dt>POWER HEADROOM</dt>
            <dd>24.0 kW</dd>
          </div>
          <div>
            <dt>RETRY RATE</dt>
            <dd>0.00%</dd>
          </div>
        </dl>
        <div className="signal-chart" aria-label="Static placeholder telemetry chart">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="ops-section inspector-section">
        <div className="panel-heading">
          <span className="panel-index">03</span>
          <div>
            <span className="eyebrow">SELECTION</span>
            <h2>{t("ui.inspector")}</h2>
          </div>
        </div>
        <p className="empty-copy">{t("ui.no-selection")}</p>
      </section>
      <footer className="ops-footer">{t("ui.shell-status")}</footer>
    </aside>
  );
}
