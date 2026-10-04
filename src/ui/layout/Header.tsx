import { useSyncExternalStore, type ChangeEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { HeaderViewModel } from "../../app/game-client/snapshots.ts";
import type { GameClient } from "../../app/game-client/contracts.ts";
import type { SupportedLanguage } from "../../localization/i18n.ts";

interface HeaderProps {
  header: HeaderViewModel;
  client: GameClient;
}

function formatInteger(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value);
}

export function Header({ header, client }: HeaderProps): ReactElement {
  const connection = useSyncExternalStore(
    (listener) => client.subscribeConnection(listener),
    () => client.getConnectionStatus(),
  );
  const live = connection === "live";
  const { i18n, t } = useTranslation();
  const language = (i18n.resolvedLanguage ?? "ro") as SupportedLanguage;

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value as SupportedLanguage;
    document.documentElement.lang = nextLanguage;
    void i18n.changeLanguage(nextLanguage);
  };

  return (
    <header className="app-header" data-testid="header">
      <div className="brand-block" aria-label="OVERCLOCK">
        <span className="brand-mark">OC</span>
        <span className="brand-name">OVERCLOCK</span>
        <span className="version-tag">VS 0.1</span>
      </div>
      <div className="era-block">
        <span className="eyebrow">{t(header.eraNameKey)}</span>
        <strong>
          {t("ui.year")} {header.year}
        </strong>
        <span className="objective-copy">{t(header.objectiveKey)}</span>
      </div>
      <div className="resource-strip">
        <div className="resource-cell resource-cash">
          <span>{t("ui.cash")}</span>
          <strong>${formatInteger(header.cashUsd, language)}</strong>
        </div>
        <div className="resource-cell resource-compute">
          <span>{t("ui.useful-compute")}</span>
          <strong>{formatInteger(header.usefulComputeFlops, language)} FLOPS</strong>
        </div>
        <div className="resource-cell resource-power">
          <span>{t("ui.power")}</span>
          <strong>
            {formatInteger(header.powerDrawWatts, language)} /{" "}
            {formatInteger(header.powerCapacityWatts, language)} W
          </strong>
        </div>
        <div className="resource-cell resource-temperature">
          <span>{t("ui.temperature")}</span>
          <strong>{header.maxTemperatureC}°C</strong>
        </div>
      </div>
      <div className="clock-block">
        <button
          type="button"
          className="pause-indicator"
          aria-pressed={header.paused}
          disabled={!live}
          onClick={() => {
            if (client.getConnectionStatus() !== "live") return;
            void client.setPaused(!header.paused).catch(() => {
              // The connection/recovery owner presents transport failure. Never
              // optimistically change the clock or retry an unknown outcome.
            });
          }}
        >
          {header.paused ? t("ui.paused") : t("ui.running")}
        </button>
        <div className="speed-controls" role="group" aria-label={t("ui.speed")}>
          {[1, 2, 4].map((speed) => (
            <button
              type="button"
              key={speed}
              className={header.speed === speed ? "speed-button is-active" : "speed-button"}
              aria-pressed={header.speed === speed}
              disabled={!live}
              onClick={() => {
                if (client.getConnectionStatus() !== "live") return;
                void client.setSpeed(speed as 1 | 2 | 4).catch(() => {
                  // Keep the last authoritative clock until publication/recovery.
                });
              }}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
      <label className="language-control">
        <span>{t("ui.language")}</span>
        <select aria-label={t("ui.language")} value={language} onChange={handleLanguageChange}>
          <option value="ro">RO</option>
          <option value="en">EN</option>
        </select>
      </label>
    </header>
  );
}
