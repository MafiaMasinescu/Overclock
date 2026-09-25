import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";

import type {
  GameClient,
  ImportPreviewResult,
  RecoverySummary,
  SlotSummary,
} from "../../app/game-client/contracts.ts";
import { WorkerGameClientError } from "../../app/game-client/workerGameClient.ts";
import type { PlayerSettings } from "../../save/contracts.ts";
import type { LocalReport } from "../../save/schema.ts";

interface PersistenceControlsProps {
  readonly client: GameClient;
  readonly speed: 1 | 2 | 4;
  readonly onNewRun?: () => void;
  readonly onRecover?: (slotId: string, lastKnownLiveTick: number | undefined) => void;
  readonly onImportedSettings?: (settings: PlayerSettings) => void;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof WorkerGameClientError) return error.code;
  if (error !== null && typeof error === "object" && "code" in error) {
    const code: unknown = error.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return code;
  }
  return "UNAVAILABLE";
}

function formatDate(value: string, language: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return value;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function PersistenceControls({
  client,
  speed,
  onNewRun,
  onRecover,
  onImportedSettings,
}: PersistenceControlsProps): ReactElement {
  const { i18n, t } = useTranslation();
  const [slots, setSlots] = useState<readonly SlotSummary[]>([]);
  const [reports, setReports] = useState<readonly LocalReport[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastSave, setLastSave] = useState("");
  const [recovery, setRecovery] = useState<RecoverySummary | null>(client.getRecoverySummary());
  const [importTarget, setImportTarget] = useState("new");
  const [importBytes, setImportBytes] = useState<ArrayBuffer | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [applyImportedSettings, setApplyImportedSettings] = useState(false);
  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.slotId === selectedSlotId) ?? null,
    [selectedSlotId, slots],
  );

  const refreshSlots = useCallback(async (): Promise<void> => {
    const listed = await client.listSlots();
    setSlots(listed);
    setSelectedSlotId((current) =>
      current !== "" && !listed.some((slot) => slot.slotId === current) ? "" : current,
    );
  }, [client]);

  const refreshReports = useCallback(async (): Promise<void> => {
    setReports(await client.listReports());
  }, [client]);

  useEffect(() => {
    let active = true;
    void client
      .listSlots()
      .then((listed) => {
        if (active) setSlots(listed);
      })
      .catch(() => {
        if (active) setNotice(t("ui.persistence-unavailable"));
      });
    void client
      .listReports()
      .then((listed) => {
        if (active) setReports(listed);
      })
      .catch(() => {
        if (active) setReports([]);
      });
    return () => {
      active = false;
    };
  }, [client, t]);

  const perform = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setNotice("");
      try {
        await action();
      } catch (error) {
        setNotice(`${t("ui.persistence-error")}: ${safeErrorCode(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, t],
  );

  const saveNow = (): void => {
    void perform(async () => {
      const metadata = await client.requestSave("manual");
      setLastSave(t("ui.persistence-save-complete", { tick: metadata.tick }));
      await refreshSlots();
    });
  };

  const continueSelected = (): void => {
    if (selectedSlot === null) return;
    if (client.getConnectionStatus() !== "live") {
      onRecover?.(selectedSlot.slotId, recovery?.lastKnownLiveTick);
      return;
    }
    void perform(async () => {
      const summary = await client.loadSlot(selectedSlot.slotId);
      setRecovery(summary);
      setNotice(
        summary.skippedCorruptRecords > 0
          ? t("ui.persistence-recovered-with-skips", { count: summary.skippedCorruptRecords })
          : t("ui.persistence-loaded"),
      );
    });
  };

  const recoverSelected = (): void => {
    if (selectedSlot === null) return;
    if (client.getConnectionStatus() !== "live") {
      onRecover?.(selectedSlot.slotId, recovery?.lastKnownLiveTick);
      return;
    }
    void perform(async () => {
      const summary = await client.recover(selectedSlot.slotId);
      setRecovery(summary);
      setNotice(
        summary.skippedCorruptRecords > 0
          ? t("ui.persistence-recovered-with-skips", { count: summary.skippedCorruptRecords })
          : t("ui.persistence-recovered"),
      );
    });
  };

  const continueHost = (): void => {
    void perform(async () => {
      if (recovery !== null) await client.continueHost();
      else await client.setPaused(false);
      setRecovery(null);
    });
  };

  const setPaused = (): void => {
    void perform(async () => {
      await client.setPaused(true);
    });
  };

  const changeSpeed = (): void => {
    const nextSpeed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    void perform(async () => {
      await client.setSpeed(nextSpeed);
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    setPreview(null);
    if (file === undefined) {
      setImportBytes(null);
      return;
    }
    void file
      .arrayBuffer()
      .then(setImportBytes)
      .catch(() => {
        setImportBytes(null);
        setNotice(t("ui.persistence-import-read-failed"));
      });
  };

  const previewImport = (): void => {
    if (importBytes === null) return;
    void perform(async () => {
      const destination =
        importTarget === "new"
          ? { kind: "new" as const }
          : { kind: "overwrite" as const, slotId: importTarget };
      setPreview(await client.previewImport(importBytes.slice(0), destination));
    });
  };

  const confirmImport = (): void => {
    const importToken = preview?.token;
    if (importToken === null || importToken === undefined) return;
    const destination =
      importTarget === "new"
        ? { kind: "new" as const }
        : { kind: "overwrite" as const, slotId: importTarget };
    const expectedRevision =
      destination.kind === "new"
        ? null
        : (slots.find((slot) => slot.slotId === destination.slotId)?.revision ?? null);
    if (destination.kind === "overwrite" && expectedRevision === null) {
      setNotice(t("ui.persistence-stale-overwrite"));
      return;
    }
    if (
      destination.kind === "overwrite" &&
      !window.confirm(
        t("ui.persistence-overwrite-confirm", {
          slotId: destination.slotId,
          revision: expectedRevision,
        }),
      )
    ) {
      return;
    }
    void perform(async () => {
      const imported = await client.confirmImport(
        importToken,
        destination,
        expectedRevision,
        applyImportedSettings,
      );
      if (imported.settings !== null) onImportedSettings?.(imported.settings);
      setPreview(null);
      setImportBytes(null);
      setNotice(t("ui.persistence-import-complete", { tick: imported.tick }));
      await refreshSlots();
    });
  };

  const exportSelected = (): void => {
    if (selectedSlot === null) return;
    void perform(async () => {
      const bytes = await client.exportSlot(selectedSlot.slotId, selectedSlot.revision);
      downloadBytes(bytes, "overclock-save.ocsave", "application/json");
      setNotice(t("ui.persistence-exported"));
    });
  };

  const deleteSelected = (): void => {
    if (selectedSlot === null || !window.confirm(t("ui.persistence-delete-confirm"))) return;
    void perform(async () => {
      await client.deleteSlot(selectedSlot.slotId, selectedSlot.revision);
      setSelectedSlotId("");
      setNotice(t("ui.persistence-deleted"));
      await refreshSlots();
    });
  };

  const createReport = (): void => {
    void perform(async () => {
      await client.createReport();
      await refreshReports();
      setNotice(t("ui.persistence-report-saved"));
    });
  };

  const exportReport = (report: LocalReport): void => {
    const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
    downloadBytes(bytes, "overclock-playtest-report.json", "application/json");
  };

  const deleteReport = (reportId: string): void => {
    void perform(async () => {
      await client.deleteReport(reportId);
      await refreshReports();
    });
  };

  const language = i18n.resolvedLanguage ?? "en";
  const connectionStatus = client.getConnectionStatus();
  const summary = recovery ?? client.getRecoverySummary();

  return (
    <details className="persistence-controls" data-testid="persistence-controls">
      <summary>
        <span className={`persistence-indicator persistence-indicator--${connectionStatus}`} />
        <span>{t("ui.persistence-title")}</span>
        <span className="persistence-summary">
          {busy ? t("ui.persistence-working") : lastSave || t("ui.persistence-local-only")}
        </span>
      </summary>
      <div className="persistence-body">
        <div className="persistence-toolbar">
          <button disabled={busy} onClick={saveNow} type="button">
            {t("ui.persistence-save")}
          </button>
          <button disabled={busy} onClick={setPaused} type="button">
            {t("ui.persistence-pause")}
          </button>
          <button disabled={busy} onClick={changeSpeed} type="button">
            {t("ui.persistence-speed", { speed })}
          </button>
          <button disabled={busy} onClick={continueHost} type="button">
            {summary !== null ? t("ui.persistence-continue") : t("ui.persistence-resume")}
          </button>
          <button disabled={busy} onClick={onNewRun} type="button">
            {t("ui.persistence-new-run")}
          </button>
        </div>

        <section className="persistence-section" aria-labelledby="persistence-slots-heading">
          <h2 id="persistence-slots-heading">{t("ui.persistence-slots")}</h2>
          <div className="persistence-slot-row">
            <label className="visually-hidden" htmlFor="persistence-slot-select">
              {t("ui.persistence-select-slot")}
            </label>
            <select
              id="persistence-slot-select"
              value={selectedSlotId}
              onChange={(event) => {
                setSelectedSlotId(event.currentTarget.value);
              }}
            >
              <option value="">{t("ui.persistence-select-slot")}</option>
              {slots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>
                  {t("ui.persistence-slot-option", {
                    tick: slot.tick,
                    date: formatDate(slot.savedAtIso, language),
                  })}
                </option>
              ))}
            </select>
            <button
              disabled={busy || selectedSlot === null}
              onClick={continueSelected}
              type="button"
            >
              {t("ui.persistence-load")}
            </button>
            <button
              disabled={busy || selectedSlot === null}
              onClick={recoverSelected}
              type="button"
            >
              {t("ui.persistence-recover")}
            </button>
            <button disabled={busy || selectedSlot === null} onClick={exportSelected} type="button">
              {t("ui.persistence-export")}
            </button>
            <button disabled={busy || selectedSlot === null} onClick={deleteSelected} type="button">
              {t("ui.persistence-delete")}
            </button>
          </div>
          {summary !== null && (
            <p className="persistence-recovery-note" role="status">
              {t("ui.persistence-recovery-summary", {
                tick: summary.tick,
                year: summary.year,
                savedAt: formatDate(summary.savedAtIso, language),
              })}
              {summary.lastKnownLiveTick !== undefined && summary.lastKnownLiveTick > summary.tick
                ? t("ui.persistence-possible-loss", {
                    from: summary.tick,
                    to: summary.lastKnownLiveTick,
                  })
                : ""}
            </p>
          )}
        </section>

        <section className="persistence-section" aria-labelledby="persistence-import-heading">
          <h2 id="persistence-import-heading">{t("ui.persistence-import")}</h2>
          <div className="persistence-import-row">
            <label>
              <span>{t("ui.persistence-file")}</span>
              <input
                accept=".ocsave,.json,application/json"
                onChange={handleFileChange}
                type="file"
              />
            </label>
            <label>
              <span>{t("ui.persistence-destination")}</span>
              <select
                value={importTarget}
                onChange={(event) => {
                  setImportTarget(event.currentTarget.value);
                  setPreview(null);
                }}
              >
                <option value="new">{t("ui.persistence-new-slot")}</option>
                {slots.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {t("ui.persistence-slot-option", {
                      tick: slot.tick,
                      date: formatDate(slot.savedAtIso, language),
                    })}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy || importBytes === null} onClick={previewImport} type="button">
              {t("ui.persistence-preview")}
            </button>
          </div>
          {preview !== null && (
            <div className="persistence-preview" data-testid="import-preview">
              <p>
                {t("ui.persistence-preview-summary", {
                  tick: preview.preview.tick,
                  year: preview.preview.simulatedYear,
                  status: t(`ui.persistence-compatibility-${preview.preview.compatibility}`),
                })}
              </p>
              <label className="persistence-checkbox">
                <input
                  checked={applyImportedSettings}
                  onChange={(event) => {
                    setApplyImportedSettings(event.currentTarget.checked);
                  }}
                  type="checkbox"
                />
                <span>{t("ui.persistence-apply-settings")}</span>
              </label>
              <div className="persistence-toolbar">
                <button
                  disabled={
                    busy || preview.token === null || preview.preview.compatibility !== "compatible"
                  }
                  onClick={confirmImport}
                  type="button"
                >
                  {t("ui.persistence-confirm-import")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setPreview(null);
                    setImportBytes(null);
                  }}
                  type="button"
                >
                  {t("ui.persistence-cancel")}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="persistence-section" aria-labelledby="persistence-reports-heading">
          <div className="persistence-section-heading">
            <h2 id="persistence-reports-heading">{t("ui.persistence-reports")}</h2>
            <button disabled={busy} onClick={createReport} type="button">
              {t("ui.persistence-create-report")}
            </button>
          </div>
          {reports.length === 0 ? (
            <p className="persistence-empty">{t("ui.persistence-no-reports")}</p>
          ) : (
            <ul className="persistence-report-list">
              {reports.map((report) => (
                <li key={report.reportId}>
                  <span>
                    {t(`ui.persistence-report-${report.category}`)}
                    {report.tick === null
                      ? ""
                      : ` · ${t("ui.persistence-tick", { tick: report.tick })}`}
                    {report.errorCode === null ? "" : ` · ${report.errorCode}`}
                  </span>
                  <span className="persistence-report-actions">
                    <button
                      onClick={() => {
                        exportReport(report);
                      }}
                      type="button"
                    >
                      {t("ui.persistence-export")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        deleteReport(report.reportId);
                      }}
                      type="button"
                    >
                      {t("ui.persistence-delete")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="persistence-local-note">{t("ui.persistence-local-note")}</p>
        {notice !== "" && (
          <p className="persistence-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
