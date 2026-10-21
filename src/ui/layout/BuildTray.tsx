import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import {
  createApplyDesignCommand,
  createCancelDesignCommand,
  createEnterDesignModeCommand,
} from "../../app/game-client/buildCommands.ts";
import type { GameClient } from "../../app/game-client/contracts.ts";
import type {
  BuildCatalogEntry,
  BuildContextRead,
  BuildPlacementTool,
  BuildQueryResult,
  BuildReadReason,
} from "../../app/game-client/contracts.ts";
import {
  filterBuildCatalog,
  getBuildTrayEntryState,
  type BuildTrayTab,
} from "./buildTraySelectors.ts";

interface BuildTrayProps {
  readonly client: GameClient;
  readonly mode: "live" | "draft";
  readonly refreshKey: string;
  readonly interactive: boolean;
  readonly onPlacementTool: (tool: BuildPlacementTool | null) => void;
}

interface BuildContextState {
  readonly context: BuildContextRead | null;
  readonly unavailable: boolean;
}

function buildContextKey(client: GameClient): string | null {
  try {
    const snapshot = client.getSnapshot();
    const grid = client.getGridViewModel();
    return [
      grid.mode,
      grid.layoutRevision,
      snapshot.build.designMode,
      snapshot.build.draftRevision,
      snapshot.build.inventoryUnitCount,
      snapshot.header.cashUsd,
      snapshot.research.completedNodeIds.join(","),
    ].join("|");
  } catch {
    return null;
  }
}

function useBuildContext(
  client: GameClient,
  mode: "live" | "draft",
  refreshKey: string,
): BuildContextState {
  const [state, setState] = useState<BuildContextState>({
    context: null,
    unavailable: false,
  });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pending = false;
    let lastQueryAt = Number.NEGATIVE_INFINITY;
    let intentSequence = 0;
    let observedKey = refreshKey;

    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const schedule = (): void => {
      if (disposed || timer !== null) return;
      timer = setTimeout(run, 0);
    };

    const run = (): void => {
      timer = null;
      if (disposed) return;
      if (client.getConnectionStatus() !== "live") {
        setState({ context: null, unavailable: true });
        return;
      }
      if (inFlight) {
        pending = true;
        return;
      }
      const elapsed = performance.now() - lastQueryAt;
      if (elapsed < 500) {
        timer = setTimeout(run, 500 - elapsed);
        return;
      }
      inFlight = true;
      lastQueryAt = performance.now();
      intentSequence += 1;
      void client
        .queryBuild({ kind: "context", mode, clientIntentSequence: intentSequence })
        .then((response) => {
          if (disposed) return;
          if (response.result.kind === "context" && response.result.status === "ready") {
            setState({ context: response.result.context, unavailable: false });
          } else {
            setState({ context: null, unavailable: true });
          }
        })
        .catch(() => {
          if (!disposed) setState({ context: null, unavailable: true });
        })
        .finally(() => {
          if (disposed) return;
          inFlight = false;
          if (pending) {
            pending = false;
            schedule();
          }
        });
    };

    const onPublication = (): void => {
      const nextKey = buildContextKey(client);
      if (nextKey === null || nextKey === observedKey) return;
      observedKey = nextKey;
      schedule();
    };

    const onConnection = (): void => {
      if (client.getConnectionStatus() !== "live") {
        clearTimer();
        setState({ context: null, unavailable: true });
        return;
      }
      observedKey = buildContextKey(client) ?? observedKey;
      schedule();
    };

    schedule();
    const unsubscribe = client.subscribe(onPublication);
    const unsubscribeConnection = client.subscribeConnection(onConnection);
    return () => {
      disposed = true;
      clearTimer();
      unsubscribe();
      unsubscribeConnection();
    };
  }, [client, mode, refreshKey]);

  return state;
}

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
}

function categoryKey(category: string): string {
  return `ui.category-${category}`;
}

function reasonKey(reason: BuildReadReason): string {
  switch (reason) {
    case "RESEARCH_REQUIRED":
      return "ui.build-research-required";
    case "INSUFFICIENT_CREDIT":
      return "ui.build-insufficient-credit";
    case "INSUFFICIENT_INVENTORY":
      return "ui.build-insufficient-inventory";
    case "INVALID_SYSTEM":
      return "ui.build-invalid-system";
    default:
      return "ui.build-unavailable";
  }
}

function searchText(entry: BuildCatalogEntry, translate: (key: string) => string): string {
  return [
    translate(entry.nameKey),
    translate(entry.descriptionKey),
    translate(categoryKey(entry.category)),
    ...entry.tags.map((tag) => translate(`ui.tag-${tag}`)),
  ].join(" ");
}

function cardMeta(entry: BuildCatalogEntry, tab: BuildTrayTab, language: string): string {
  const footprint = `${entry.footprint.width}×${entry.footprint.height}`;
  if (tab === "catalog" && entry.availableAdditionalPlacements === 0) {
    if (entry.purchase.kind === "purchase" || entry.purchase.kind === "insufficient-credit") {
      return `${footprint} · $${formatNumber(entry.purchase.costUsd, language)}`;
    }
  }
  return `${footprint} · ${entry.availableAdditionalPlacements}`;
}

function createPlacementTool(
  entry: BuildCatalogEntry,
  tab: BuildTrayTab,
  generation: number,
): BuildPlacementTool {
  return {
    definitionId: entry.definitionId,
    source: tab,
    generation,
    rotation: 0,
    footprint: {
      width: entry.footprint.width,
      height: entry.footprint.height,
    },
  };
}

type ApplyQueryResult = Extract<BuildQueryResult, { kind: "apply"; data: unknown }>;

function applyResult(result: BuildQueryResult): ApplyQueryResult | null {
  return result.kind === "apply" && "data" in result ? result : null;
}

export function BuildTray({
  client,
  mode,
  refreshKey,
  interactive,
  onPlacementTool,
}: BuildTrayProps): ReactElement {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage ?? "ro";
  const { context, unavailable } = useBuildContext(client, mode, refreshKey);
  const [tab, setTab] = useState<BuildTrayTab>("inventory");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [pendingDefinitionId, setPendingDefinitionId] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [activationError, setActivationError] = useState(false);
  const [applyPreview, setApplyPreview] = useState<ApplyQueryResult | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [applyError, setApplyError] = useState(false);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const intentSequence = useRef(1000);
  const categories = useMemo(
    () => [...new Set(context?.catalog.map((entry) => entry.category) ?? [])],
    [context?.catalog],
  );
  const visibleEntries = useMemo(
    () =>
      filterBuildCatalog(context?.catalog ?? [], { tab, category, search }, (entry) =>
        searchText(entry, t),
      ),
    [category, context?.catalog, search, t, tab],
  );

  useEffect(() => {
    if (context?.mode !== "draft" || pendingDefinitionId === null) return;
    const entry = context.catalog.find((item) => item.definitionId === pendingDefinitionId);
    if (entry === undefined) return;
    onPlacementTool(createPlacementTool(entry, tab, context.source.generation));
  }, [context, onPlacementTool, pendingDefinitionId, tab]);

  const activateDefinition = (entry: BuildCatalogEntry): void => {
    if (context === null || !interactive || isActivating) return;
    setActivationError(false);
    setSelectedDefinitionId(entry.definitionId);
    setPendingDefinitionId(entry.definitionId);
    if (context.mode === "draft") {
      onPlacementTool(createPlacementTool(entry, tab, context.source.generation));
      return;
    }
    setIsActivating(true);
    const command = createEnterDesignModeCommand();
    void client
      .dispatchBuild(command, context.source.generation)
      .then((outcome) => {
        if (outcome.kind !== "domain" || !outcome.result.accepted) {
          setPendingDefinitionId(null);
          setActivationError(true);
        }
      })
      .catch(() => {
        setPendingDefinitionId(null);
        setActivationError(true);
      })
      .finally(() => {
        setIsActivating(false);
      });
  };

  const requestApplyPreview = (): void => {
    if (context?.mode !== "draft" || applyPending) return;
    setApplyError(false);
    setApplyPending(true);
    void client
      .queryBuild({
        kind: "apply",
        mode: "draft",
        clientIntentSequence: ++intentSequence.current,
      })
      .then((response) => {
        const result = applyResult(response.result);
        if (result === null) setApplyError(true);
        else setApplyPreview(result);
      })
      .catch(() => {
        setApplyError(true);
      })
      .finally(() => {
        setApplyPending(false);
      });
  };

  const confirmApply = (): void => {
    if (context === null || applyPreview?.data.status !== "ready") return;
    setApplyPending(true);
    void client
      .dispatchBuild(
        createApplyDesignCommand(
          applyPreview.data.draftRevision,
          applyPreview.data.netCostUsd,
          applyPreview.data.downtimeTicks,
        ),
        applyPreview.source.generation,
      )
      .then((outcome) => {
        if (outcome.kind === "domain" && outcome.result.accepted) {
          setApplyPreview(null);
          setApplyError(false);
          onPlacementTool(null);
        } else {
          setApplyPreview(null);
          setApplyError(true);
        }
      })
      .catch(() => {
        setApplyError(true);
      })
      .finally(() => {
        setApplyPending(false);
      });
  };

  const cancelDesign = (): void => {
    if (context?.mode !== "draft" || cancelPending) return;
    if (context.canUndo || context.canRedo) {
      setCancelPrompt(true);
      return;
    }
    setCancelPending(true);
    void client
      .dispatchBuild(createCancelDesignCommand(), context.source.generation)
      .finally(() => {
        setCancelPending(false);
      });
  };

  const confirmCancel = (): void => {
    if (context === null) return;
    setCancelPending(true);
    void client
      .dispatchBuild(createCancelDesignCommand(), context.source.generation)
      .then((outcome) => {
        if (outcome.kind === "domain" && outcome.result.accepted) {
          setCancelPrompt(false);
          onPlacementTool(null);
        }
      })
      .finally(() => {
        setCancelPending(false);
      });
  };

  return (
    <section className="build-tray" data-testid="build-tray" aria-labelledby="build-tray-title">
      <div className="tray-heading">
        <div>
          <span className="eyebrow">{t("ui.build-mode")}</span>
          <h2 id="build-tray-title">{t("ui.build-tray")}</h2>
        </div>
        <div className="tray-tabs" role="tablist" aria-label={t("ui.build-tray")}>
          {(["inventory", "catalog"] as const).map((nextTab) => (
            <button
              className={tab === nextTab ? "tray-tab tray-tab-active" : "tray-tab"}
              type="button"
              role="tab"
              aria-selected={tab === nextTab}
              key={nextTab}
              onClick={() => {
                setTab(nextTab);
                setSelectedDefinitionId(null);
                setPendingDefinitionId(null);
                onPlacementTool(null);
              }}
            >
              {t(`ui.${nextTab}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="tray-controls">
        <label>
          <span className="visually-hidden">{t("ui.build-search")}</span>
          <input
            type="search"
            value={search}
            placeholder={t("ui.build-search")}
            aria-label={t("ui.build-search")}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <label>
          <span className="visually-hidden">{t("ui.build-category")}</span>
          <select
            value={category}
            aria-label={t("ui.build-category")}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            <option value="all">{t("ui.build-all-categories")}</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {t(categoryKey(item))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tray-note" role="status" aria-live="polite">
        {tab === "catalog" ? t("ui.build-catalog-note") : t("ui.build-inventory-note")}
      </div>
      {activationError && (
        <div className="tray-note tray-note-error">{t("ui.build-enter-failed")}</div>
      )}
      {unavailable || context === null ? (
        <p className="empty-copy" data-testid="build-tray-unavailable">
          {t("ui.build-data-unavailable")}
        </p>
      ) : (
        <div className="part-list" data-testid="build-card-list">
          {visibleEntries.map((entry) => {
            const state = getBuildTrayEntryState(entry, tab);
            const selected =
              selectedDefinitionId === entry.definitionId ||
              (context.mode === "draft" && pendingDefinitionId === entry.definitionId);
            const disabled = !interactive || !state.selectable || isActivating;
            return (
              <button
                className={selected ? "part-card part-card-selected" : "part-card"}
                type="button"
                key={entry.definitionId}
                disabled={disabled}
                draggable={!disabled}
                data-testid={`build-card-${entry.definitionId}`}
                onClick={() => {
                  activateDefinition(entry);
                }}
                onDragStart={(event) => {
                  if (disabled) return;
                  event.dataTransfer.setData("text/plain", entry.definitionId);
                  event.dataTransfer.effectAllowed = "copy";
                  activateDefinition(entry);
                }}
              >
                <span className="part-code">{entry.definitionId.slice(7, 10).toUpperCase()}</span>
                <span className="part-name">
                  <strong>{t(entry.nameKey)}</strong>
                  <small>{t(entry.descriptionKey)}</small>
                </span>
                <span className="part-footprint">{cardMeta(entry, tab, language)}</span>
                <span className="part-availability">
                  {t("ui.build-available", { count: entry.availableAdditionalPlacements })}
                </span>
                {state.reason !== null && (
                  <span className="part-reason">
                    {t(reasonKey(state.reason))}
                    {entry.purchase.kind === "locked" && entry.purchase.researchIds.length > 0
                      ? ` · ${entry.purchase.researchIds.map((id) => t(`research.${id}.name`)).join(", ")}`
                      : ""}
                  </span>
                )}
              </button>
            );
          })}
          {visibleEntries.length === 0 && <p className="empty-copy">{t("ui.build-no-results")}</p>}
        </div>
      )}
      {context !== null && context.mode === "draft" && (
        <>
          <span className="tray-draft-status">{t("ui.build-draft-active")}</span>
          <div className="build-edit-actions build-tray-actions">
            <button type="button" disabled={applyPending} onClick={requestApplyPreview}>
              {t("ui.build-apply")}
            </button>
            <button type="button" disabled={cancelPending} onClick={cancelDesign}>
              {t("ui.build-cancel")}
            </button>
          </div>
        </>
      )}
      {applyError && <div className="tray-note tray-note-error">{t("ui.build-apply-error")}</div>}
      {applyPreview !== null && (
        <div className="build-dialog-backdrop" role="presentation">
          <section
            className="build-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("ui.build-apply-title")}
          >
            <h3>{t("ui.build-apply-title")}</h3>
            {applyPreview.data.status === "ready" ? (
              <dl>
                <div>
                  <dt>{t("ui.build-apply-modules")}</dt>
                  <dd>{applyPreview.data.changedModuleIds.length}</dd>
                </div>
                <div>
                  <dt>{t("ui.build-apply-inventory")}</dt>
                  <dd>
                    {applyPreview.data.inventoryConsumption.length === 0
                      ? "—"
                      : applyPreview.data.inventoryConsumption
                          .map((entry) => `${entry.definitionId} × ${entry.quantity}`)
                          .join(", ")}
                  </dd>
                </div>
                <div>
                  <dt>{t("ui.build-apply-book-value")}</dt>
                  <dd>
                    ${formatNumber(applyPreview.data.consumedInventoryBookValueUsd, language)}
                  </dd>
                </div>
                <div>
                  <dt>{t("ui.build-apply-labor")}</dt>
                  <dd>${formatNumber(applyPreview.data.laborCostUsd, language)}</dd>
                </div>
                <div>
                  <dt>{t("ui.build-apply-salvage")}</dt>
                  <dd>${formatNumber(applyPreview.data.salvageCreditUsd, language)}</dd>
                </div>
                <div>
                  <dt>{t("ui.build-apply-net")}</dt>
                  <dd>${formatNumber(applyPreview.data.netCostUsd, language)}</dd>
                </div>
                <div>
                  <dt>{t("ui.build-apply-downtime")}</dt>
                  <dd>{applyPreview.data.downtimeTicks}</dd>
                </div>
              </dl>
            ) : (
              <p className="empty-copy">{t("ui.build-apply-blocked")}</p>
            )}
            <div className="build-edit-actions">
              <button
                type="button"
                disabled={applyPending || applyPreview.data.status !== "ready"}
                onClick={confirmApply}
              >
                {t("ui.build-confirm")}
              </button>
              <button
                type="button"
                disabled={applyPending}
                onClick={() => {
                  setApplyPreview(null);
                }}
              >
                {t("ui.build-close")}
              </button>
            </div>
          </section>
        </div>
      )}
      {cancelPrompt && (
        <div className="build-dialog-backdrop" role="presentation">
          <section
            className="build-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("ui.build-cancel-title")}
          >
            <h3>{t("ui.build-cancel-title")}</h3>
            <p>{t("ui.build-cancel-message")}</p>
            <div className="build-edit-actions">
              <button type="button" disabled={cancelPending} onClick={confirmCancel}>
                {t("ui.build-confirm")}
              </button>
              <button
                type="button"
                disabled={cancelPending}
                onClick={() => {
                  setCancelPrompt(false);
                }}
              >
                {t("ui.build-close")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
