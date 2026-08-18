import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

const placeholderParts = [
  { code: "PWR", name: "module-power-distribution", footprint: "2×2" },
  { code: "VT", name: "module-vacuum-tube-logic", footprint: "2×1" },
  { code: "CTL", name: "module-control-unit", footprint: "2×1" },
  { code: "ACC", name: "module-accumulator-register", footprint: "1×2" },
] as const;

export function BuildTray(): ReactElement {
  const { t } = useTranslation();

  return (
    <section className="build-tray" data-testid="build-tray" aria-labelledby="build-tray-title">
      <div className="tray-heading">
        <div>
          <span className="eyebrow">BUILD MODE / READ ONLY</span>
          <h2 id="build-tray-title">{t("ui.build-tray")}</h2>
        </div>
        <div className="tray-tabs" role="tablist" aria-label={t("ui.build-tray")}>
          <button
            className="tray-tab tray-tab-active"
            type="button"
            role="tab"
            aria-selected="true"
          >
            {t("ui.inventory")}
          </button>
          <button className="tray-tab" type="button" role="tab" aria-selected="false">
            {t("ui.catalog")}
          </button>
        </div>
      </div>
      <div className="part-list">
        {placeholderParts.map((part) => (
          <button className="part-card" type="button" key={part.name} disabled>
            <span className="part-code">{part.code}</span>
            <span className="part-name">{t(`modules.${part.name}.name`)}</span>
            <span className="part-footprint">{part.footprint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
