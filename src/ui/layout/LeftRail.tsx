import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

const navigation = [
  { key: "build", glyph: "B" },
  { key: "operations", glyph: "O" },
  { key: "research", glyph: "R" },
  { key: "company", glyph: "C" },
  { key: "museum", glyph: "M" },
  { key: "achievements", glyph: "A" },
] as const;

export function LeftRail(): ReactElement {
  const { t } = useTranslation();

  return (
    <nav className="left-rail" data-testid="left-rail" aria-label="Primary">
      <div className="rail-track" aria-hidden="true" />
      {navigation.map(({ key, glyph }, index) => (
        <button
          aria-label={t(`ui.${key}`)}
          className={index === 0 ? "rail-button rail-button-active" : "rail-button"}
          key={key}
          type="button"
        >
          <span className="rail-glyph" aria-hidden="true">
            {glyph}
          </span>
          <span className="rail-label">{t(`ui.${key}`)}</span>
        </button>
      ))}
      <button aria-label={t("ui.settings")} className="rail-button rail-settings" type="button">
        <span className="rail-glyph" aria-hidden="true">
          ⚙
        </span>
        <span className="rail-label">{t("ui.settings")}</span>
      </button>
    </nav>
  );
}
