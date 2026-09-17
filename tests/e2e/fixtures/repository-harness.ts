// Phase 2 Task 17.4 real-browser harness. Served by the Vite dev server for
// Playwright only; never referenced by production entries and never shipped
// in dist (vite build uses index.html alone). Every scenario below runs the
// REAL production stack in Chromium: openOverclockDatabase over real
// IndexedDB, the repository core, real Web Locks, the real codec with native
// crypto/compression, and the import/export/load services. Fault injection
// lives only in this harness file, never in production code.

import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../../src/content/schemas/contentSchemas.ts";
import { encodeSaveEnvelope } from "../../../src/save/codec.ts";
import { exportSlot } from "../../../src/save/export/exportService.ts";
import { createImportService } from "../../../src/save/import/importService.ts";
import type { ImportService } from "../../../src/save/import/importService.ts";
import { admitLoadedSave } from "../../../src/save/load/loadAdmission.ts";
import { createSaveRepositoryCore } from "../../../src/save/repository/repository.ts";
import type { SaveRepositoryCore } from "../../../src/save/repository/repository.ts";
import { openWriterSession } from "../../../src/save/repository/slots.ts";
import type { WriterSession } from "../../../src/save/repository/slots.ts";
import { isSlotBusy } from "../../../src/save/repository/slots.ts";
import type { RepositoryStorage } from "../../../src/save/repository/storage.ts";
import { createWebLockAdapter } from "../../../src/save/repository/webLocks.ts";
import type { WebLockAdapter } from "../../../src/save/repository/webLocks.ts";
import { openOverclockDatabase } from "../../../src/save/repository/indexedDb.ts";
import { createInitialGameState } from "../../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../../src/sim/replay/replayContracts.ts";

type Json = unknown;

interface ErrorJson {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

function toErrorJson(error: unknown): ErrorJson {
  if (error !== null && typeof error === "object" && "code" in error) {
    const record = error as { code?: unknown; message?: unknown };
    return {
      ok: false,
      code: typeof record.code === "string" ? record.code : "UNKNOWN",
      message: typeof record.message === "string" ? record.message : "Unknown failure.",
    };
  }
  return { ok: false, code: "UNKNOWN", message: "Unknown failure." };
}

async function run<T extends Record<string, Json>>(
  work: () => Promise<T>,
): Promise<{ ok: true; data: T & { durationMs: number } } | ErrorJson> {
  const started = performance.now();
  try {
    const data = await work();
    return { ok: true, data: Object.assign(data, { durationMs: performance.now() - started }) };
  } catch (error: unknown) {
    return toErrorJson(error);
  }
}

let storage: RepositoryStorage | null = null;
let repository: SaveRepositoryCore | null = null;
let locks: WebLockAdapter | null = null;
let content: ContentBundle | null = null;
let importerSequence = 0;
const importers = new Map<string, ImportService>();
let sessionSequence = 0;
const sessions = new Map<string, WriterSession>();

function requireStack(): {
  storage: RepositoryStorage;
  repository: SaveRepositoryCore;
  locks: WebLockAdapter;
  content: ContentBundle;
} {
  if (storage === null || repository === null || locks === null || content === null) {
    throw new Error("Harness stack is not open.");
  }
  return { storage, repository, locks, content };
}

async function preparedPair(slotId: string, seedSuffix: string) {
  const { content: bundle } = requireStack();
  const gameState = createInitialGameState({
    content: bundle,
    seed: `harness-${slotId}${seedSuffix}`,
  });
  const payload = {
    schemaVersion: 1 as const,
    saveVersion: 1 as const,
    contentVersion: bundle.contentVersion,
    simulationContentHash: hashSimulationContent(bundle),
    createdAtIso: "2026-09-17T10:00:00.000Z",
    savedAtIso: "2026-09-17T10:00:01.000Z",
    slotId,
    gameState,
    execution: {
      simulatorProtocolVersion: 1 as const,
      nextQueueSequence: 0,
      pendingCommandCount: 0 as const,
      stateHash: hashCanonicalState(gameState),
    },
    settings: {
      language: "en" as const,
      telemetryPreset: "standard" as const,
      reducedEffects: false,
      reducedMotion: false,
      frameCap: 60 as const,
      volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
    },
    localStats: {
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    },
  };
  const encoded = await encodeSaveEnvelope(payload, { content: bundle, compression: "none" });
  return {
    envelope: encoded.envelope,
    preview: {
      sourceSchemaVersion: 1,
      sourceSaveVersion: 1,
      contentVersion: payload.contentVersion,
      simulatedYear: gameState.campaign.currentYear,
      tick: gameState.tick,
      cashUsd: gameState.economy.cashUsd,
      verticalSliceCompleted: gameState.campaign.verticalSliceCompleted,
      savedAtIso: payload.savedAtIso,
      migrationRequired: false,
      compatibility: "compatible" as const,
      destinationSuggestion: { kind: "new-slot" as const },
      compressedBytes: encoded.bytes.length,
      uncompressedBytes: encoded.canonicalPayloadBytes.length,
      slotId,
    },
  };
}

async function buildExternalPayload(slotId: string, seed: string) {
  const { content: bundle } = requireStack();
  const gameState = createInitialGameState({ content: bundle, seed });
  const payload = {
    schemaVersion: 1 as const,
    saveVersion: 1 as const,
    contentVersion: bundle.contentVersion,
    simulationContentHash: hashSimulationContent(bundle),
    createdAtIso: "2026-09-17T10:00:00.000Z",
    savedAtIso: "2026-09-17T10:00:01.000Z",
    slotId,
    gameState,
    execution: {
      simulatorProtocolVersion: 1 as const,
      nextQueueSequence: 0,
      pendingCommandCount: 0 as const,
      stateHash: hashCanonicalState(gameState),
    },
    settings: {
      language: "en" as const,
      telemetryPreset: "standard" as const,
      reducedEffects: false,
      reducedMotion: false,
      frameCap: 60 as const,
      volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
    },
    localStats: {
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    },
  };
  return encodeSaveEnvelope(payload, { content: bundle, compression: "none" });
}

export interface RepositoryHarness {
  open(): Promise<Json>;
  close(): Promise<Json>;
  coreRoundTrip(slotId: string): Promise<Json>;
  rotation(slotId: string): Promise<Json>;
  abortPlatform(): Promise<Json>;
  quotaFault(slotId: string): Promise<Json>;
  cancelledOp(slotId: string): Promise<Json>;
  versionchangeBlocked(): Promise<Json>;
  createImporter(): Promise<Json>;
  previewBytes(importerId: string, seedSuffix: string, slotId: string): Promise<Json>;
  previewOverwrite(importerId: string, seedSuffix: string, slotId: string): Promise<Json>;
  confirmToken(importerId: string, token: string, expectedRevision?: number): Promise<Json>;
  confirmWithSettings(importerId: string, token: string): Promise<Json>;
  readSettings(): Promise<Json>;
  directWrite(slotId: string, seedSuffix: string): Promise<Json>;
  directFencedWrite(
    slotId: string,
    seedSuffix: string,
    expectedRevision: number,
    expectedWriterEpoch: number,
  ): Promise<Json>;
  openRacy(): Promise<Json>;
  exportBytes(slotId: string): Promise<Json>;
  createSlot(slotId: string): Promise<Json>;
  openSession(slotId: string, ifAvailable: boolean): Promise<Json>;
  sessionWrite(sessionId: string, seedSuffix: string): Promise<Json>;
  sessionClose(sessionId: string): Promise<Json>;
  readMeta(slotId: string): Promise<Json>;
  reloadVerify(slotId: string): Promise<Json>;
  admitAll(slotId: string): Promise<Json>;
}

const harness: RepositoryHarness = {
  open() {
    return run(async () => {
      const opened = await openOverclockDatabase();
      storage = opened;
      repository = createSaveRepositoryCore(opened);
      locks = createWebLockAdapter();
      content = loadContentBundle();
      return { locksAvailable: locks.available };
    });
  },

  close() {
    return run((): Promise<Record<string, Json>> => {
      storage?.close();
      storage = null;
      repository = null;
      locks = null;
      content = null;
      sessions.clear();
      importers.clear();
      return Promise.resolve({});
    });
  },

  coreRoundTrip(slotId: string) {
    return run(async () => {
      const { repository: core } = requireStack();
      await core.createSlot(slotId, 0);
      const prepared = await preparedPair(slotId, "-roundtrip");
      const meta = await core.writeManualSave(slotId, prepared, {
        expectedRevision: 0,
        expectedWriterEpoch: 0,
      });
      const stored = await core.readManualSave(slotId);
      return {
        checksum: stored.envelope.checksum,
        expectedChecksum: prepared.envelope.checksum,
        revision: meta.revision,
        captureSequence: stored.captureSequence,
        previewSlotId: stored.preview.slotId,
      };
    });
  },

  rotation(slotId: string) {
    return run(async () => {
      const { repository: core } = requireStack();
      await core.createSlot(slotId, 0);
      const prunedAll: number[] = [];
      for (let revision = 0; revision < 5; revision += 1) {
        const prepared = await preparedPair(slotId, `-auto-${revision}`);
        const result = await core.writeAutosave(slotId, prepared, {
          expectedRevision: revision,
          expectedWriterEpoch: 0,
        });
        prunedAll.push(...result.prunedCaptureSequences);
      }
      const generations = await core.listAutosaves(slotId);
      const meta = await core.readSlotMeta(slotId);
      return {
        retained: generations.map((generation) => generation.captureSequence),
        pruned: prunedAll,
        nextCaptureSequence: meta.nextCaptureSequence,
        locator: meta.latestRecovery,
      };
    });
  },

  abortPlatform() {
    return run(async () => {
      // Exercise the production adapter: a successful request followed by
      // work failure must abort the real transaction and commit nothing.
      const { storage: real } = requireStack();
      let errorCode = "none";
      try {
        await real.runTransaction(["reports"], "readwrite", async (tx) => {
          await tx.put("reports", "abort-probe", { value: 1 });
          throw new DOMException("Injected post-request failure", "AbortError");
        });
      } catch (error: unknown) {
        errorCode =
          error !== null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN";
      }
      const committed = await real.runTransaction(
        ["reports"],
        "readonly",
        async (tx) => (await tx.get("reports", "abort-probe")) !== undefined,
      );
      return { committed, errorCode };
    });
  },

  quotaFault(slotId: string) {
    return run(async () => {
      const { storage: real, repository: core } = requireStack();
      await core.createSlot(slotId, 0);
      const first = await preparedPair(slotId, "-first");
      await core.writeManualSave(slotId, first, { expectedRevision: 0, expectedWriterEpoch: 0 });
      // Harness-only fault injection at the storage seam: the next commit
      // fails like a platform quota error while prior data stays durable.
      let injectOnce = true;
      const faulty: RepositoryStorage = {
        close: () => {
          real.close();
        },
        runTransaction: (stores, mode, work) => {
          if (injectOnce && mode === "readwrite") {
            injectOnce = false;
            return Promise.reject(new DOMException("QuotaExceededError", "QuotaExceededError"));
          }
          return real.runTransaction(stores, mode, work);
        },
      };
      const faultyCore = createSaveRepositoryCore(faulty);
      const second = await preparedPair(slotId, "-second");
      let faultCode = "none";
      try {
        await faultyCore.writeManualSave(slotId, second, {
          expectedRevision: 1,
          expectedWriterEpoch: 0,
        });
      } catch (error: unknown) {
        faultCode =
          error !== null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN";
      }
      const stored = await core.readManualSave(slotId);
      const retry = await core.writeManualSave(slotId, second, {
        expectedRevision: 1,
        expectedWriterEpoch: 0,
      });
      return {
        faultCode,
        priorChecksum: stored.envelope.checksum,
        firstChecksum: first.envelope.checksum,
        retryRevision: retry.revision,
      };
    });
  },

  cancelledOp(slotId: string) {
    return run(async () => {
      const { repository: core } = requireStack();
      await core.createSlot(slotId, 0);
      const prepared = await preparedPair(slotId, "-cancelled");
      const controller = new AbortController();
      controller.abort();
      // Throws CANCELLED through the real adapter path; run() serializes it.
      await core.writeManualSave(slotId, prepared, {
        expectedRevision: 0,
        expectedWriterEpoch: 0,
        signal: controller.signal,
      });
      return { code: "none" };
    });
  },

  versionchangeBlocked() {
    return run(async () => {
      let versionchangeFired = false;
      let blockedFired = false;
      const first = await openOverclockDatabase({
        onBlocked: () => {
          blockedFired = true;
        },
        onVersionChange: () => {
          versionchangeFired = true;
        },
      });
      // A second connection requesting a higher version triggers
      // versionchange on the first and bumps the stored version.
      await new Promise<void>((resolve, reject) => {
        const upgrade = indexedDB.open("overclock", 2);
        upgrade.onsuccess = () => {
          upgrade.result.close();
          resolve();
        };
        upgrade.onerror = () => {
          reject(upgrade.error ?? new Error("upgrade failed"));
        };
      });
      let mutationCode = "none";
      try {
        await first.runTransaction(["slotMeta"], "readonly", (tx) => tx.count("slotMeta"));
      } catch (error: unknown) {
        mutationCode =
          error !== null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN";
      }
      first.close();
      let reopenCode = "none";
      try {
        const reopened = await openOverclockDatabase();
        reopened.close();
      } catch (error: unknown) {
        reopenCode =
          error !== null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN";
      }
      // Restore the version-1 schema for later scenarios in this profile.
      await new Promise<void>((resolve, reject) => {
        const removal = indexedDB.deleteDatabase("overclock");
        removal.onsuccess = () => {
          resolve();
        };
        removal.onerror = () => {
          reject(removal.error ?? new Error("delete failed"));
        };
      });
      const fresh = await openOverclockDatabase();
      fresh.close();
      return { versionchangeFired, blockedFired, mutationCode, reopenCode, reopenedFresh: true };
    });
  },

  createImporter() {
    return run((): Promise<Record<string, Json>> => {
      const { repository: core, content: bundle } = requireStack();
      importerSequence += 1;
      const id = `importer-${importerSequence}`;
      importers.set(
        id,
        createImportService({
          repository: core,
          locks: requireStack().locks,
          loadContent: () => bundle,
        }),
      );
      return Promise.resolve({ importerId: id });
    });
  },

  previewBytes(importerId: string, seedSuffix: string, slotId: string) {
    return run(async () => {
      const importer = importers.get(importerId);
      if (importer === undefined) throw new Error("Unknown importer.");
      const encoded = await buildExternalPayload(slotId, `harness-xfer${seedSuffix}`);
      const previewed = await importer.previewImport({ bytes: encoded.bytes });
      return {
        token: previewed.token,
        allocatedSlotId: previewed.allocatedSlotId,
        compatibility: previewed.preview.compatibility,
        migrationRequired: previewed.preview.migrationRequired,
        inputBytes: encoded.bytes.length,
      };
    });
  },

  previewOverwrite(importerId: string, seedSuffix: string, slotId: string) {
    return run(async () => {
      const importer = importers.get(importerId);
      if (importer === undefined) throw new Error("Unknown importer.");
      const encoded = await buildExternalPayload("slot-external", `harness-ovw${seedSuffix}`);
      const previewed = await importer.previewImport({
        bytes: encoded.bytes,
        destination: { kind: "overwrite", slotId },
      });
      return {
        token: previewed.token,
        compatibility: previewed.preview.compatibility,
        suggestion: previewed.preview.destinationSuggestion,
      };
    });
  },

  confirmToken(importerId: string, token: string, expectedRevision?: number) {
    return run(async () => {
      const importer = importers.get(importerId);
      if (importer === undefined) throw new Error("Unknown importer.");
      const confirmed = await importer.confirmImport(
        token,
        expectedRevision === undefined ? {} : { expectedRevision },
      );
      return {
        slotId: confirmed.slotId,
        revision: confirmed.meta.revision,
        captureSequence: confirmed.meta.nextCaptureSequence - 1,
      };
    });
  },

  confirmWithSettings(importerId: string, token: string) {
    return run(async () => {
      const importer = importers.get(importerId);
      if (importer === undefined) throw new Error("Unknown importer.");
      const confirmed = await importer.confirmImport(token, { applySettings: true });
      return {
        slotId: confirmed.slotId,
        revision: confirmed.meta.revision,
        settingsRevision: confirmed.settingsRevision,
      };
    });
  },

  readSettings() {
    return run(async () => {
      const { repository: core } = requireStack();
      const record = await core.readSettings();
      return { revision: record?.revision ?? null, language: record?.settings.language ?? null };
    });
  },

  directWrite(slotId: string, seedSuffix: string) {
    return run(async () => {
      const { repository: core } = requireStack();
      const meta = await core.readSlotMeta(slotId);
      const prepared = await preparedPair(slotId, seedSuffix);
      const updated = await core.writeManualSave(slotId, prepared, {
        expectedRevision: meta.revision,
        expectedWriterEpoch: meta.writerEpoch,
      });
      return { revision: updated.revision, checksum: prepared.envelope.checksum };
    });
  },

  directFencedWrite(
    slotId: string,
    seedSuffix: string,
    expectedRevision: number,
    expectedWriterEpoch: number,
  ) {
    return run(async () => {
      const { repository: core } = requireStack();
      const prepared = await preparedPair(slotId, seedSuffix);
      const updated = await core.writeManualSave(slotId, prepared, {
        expectedRevision,
        expectedWriterEpoch,
      });
      return { revision: updated.revision, checksum: prepared.envelope.checksum };
    });
  },

  openRacy() {
    return run(async () => {
      // Part 1 (platform): an open v1 connection blocks a raw upgrade to
      // v2, proving blocked events occur with these primitives. The upgrade
      // request's onblocked fires; closing the holder lets it proceed.
      const holder = indexedDB.open("overclock", 1);
      await new Promise<void>((resolve, reject) => {
        holder.onupgradeneeded = () => {
          holder.result.createObjectStore("blocker");
        };
        holder.onsuccess = () => {
          resolve();
        };
        holder.onerror = () => {
          reject(holder.error ?? new Error("holder open failed"));
        };
      });
      const rawBlockedBox = { blocked: false };
      const upgrade = indexedDB.open("overclock", 2);
      const upgradeDone = new Promise<void>((resolve, reject) => {
        upgrade.onblocked = () => {
          rawBlockedBox.blocked = true;
        };
        upgrade.onsuccess = () => {
          resolve();
        };
        upgrade.onerror = () => {
          reject(upgrade.error ?? new Error("upgrade failed"));
        };
      });
      const blockedDeadline = performance.now() + 5000;
      while (!rawBlockedBox.blocked && performance.now() < blockedDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      holder.result.close();
      await upgradeDone;
      upgrade.result.close();
      await new Promise<void>((resolve, reject) => {
        const removal = indexedDB.deleteDatabase("overclock");
        removal.onsuccess = () => {
          resolve();
        };
        removal.onerror = () => {
          reject(removal.error ?? new Error("delete failed"));
        };
      });
      // Part 2 (adapter guard plus recovery): a racing raw upgrade commits
      // version 1 without our stores, so the adapter's post-race open must
      // refuse the misshapen database with UPGRADE_BLOCKED instead of
      // failing mid-transaction; deleting the poisoned test database and
      // reopening then recovers a healthy version-1 schema. (The adapter's
      // own onblocked hook fires only for real version upgrades, covered by
      // a deterministic unit test; queuing behind a versionchange
      // transaction alone does not raise blocked in Chromium.)
      // Boxed so the polling loop below is not narrowed away: the flag is
      // set from the adapter's onblocked hook, outside linear flow.
      const blockState = { blocked: false };
      let releaseBlocker = false;
      const raw = indexedDB.open("overclock");
      // Boxed: set from the connection callback, outside linear flow.
      const rawBox: { database: IDBDatabase | null } = { database: null };
      const rawCommitted = new Promise<void>((resolve, reject) => {
        raw.onupgradeneeded = () => {
          const store = raw.result.createObjectStore("blocker");
          let counter = 0;
          const pump = (): void => {
            // Stopping the pump lets the versionchange transaction commit;
            // rawCommitted below resolves in onsuccess, which also captures
            // the connection so it can be closed before deleteDatabase.
            // (Closing matters: a delete waits for open connections, so an
            // unclosed raw handle would deadlock the recovery below.)
            if (releaseBlocker) {
              return;
            }
            counter += 1;
            const put = store.put(counter, counter);
            put.onsuccess = () => {
              pump();
            };
            put.onerror = () => {
              reject(put.error ?? new Error("blocker put failed"));
            };
          };
          pump();
        };
        raw.onsuccess = () => {
          rawBox.database = raw.result;
          resolve();
        };
        raw.onerror = () => {
          reject(raw.error ?? new Error("raw open failed"));
        };
      });
      // Start the adapter open while the raw upgrade transaction is held.
      // The open settles (success or typed refusal) only after the raw
      // transaction commits below.
      const adapterOpen = openOverclockDatabase({
        onBlocked: () => {
          blockState.blocked = true;
        },
      });
      // Give the adapter open a moment to queue behind the held raw
      // transaction (no fixed hook to wait for: queuing alone raises no
      // blocked event), then release the raw transaction.
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseBlocker = true;
      await rawCommitted;
      rawBox.database?.close();
      let shapeGuardCode = "none";
      try {
        const poisoned = await adapterOpen;
        poisoned.close();
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
        ) {
          shapeGuardCode = error.code;
        } else {
          shapeGuardCode = "UNKNOWN";
        }
      }
      await new Promise<void>((resolve, reject) => {
        const removal = indexedDB.deleteDatabase("overclock");
        removal.onsuccess = () => {
          resolve();
        };
        removal.onerror = () => {
          reject(removal.error ?? new Error("delete failed"));
        };
      });
      const fresh = await openOverclockDatabase();
      const slotCount = await fresh.runTransaction(["slotMeta"], "readonly", (tx) =>
        tx.count("slotMeta"),
      );
      fresh.close();
      return {
        rawBlockedFired: rawBlockedBox.blocked,
        shapeGuardCode,
        slotCount,
        recoveredFresh: true,
      };
    });
  },

  exportBytes(slotId: string) {
    return run(async () => {
      const { repository: core, content: bundle } = requireStack();
      const exported = await exportSlot(core, slotId, { content: bundle });
      return {
        bytes: exported.bytes.length,
        checksum: exported.envelope.checksum,
        captureSequence: exported.captureSequence,
        revision: exported.revision,
        isBytes: exported.bytes instanceof Uint8Array,
      };
    });
  },

  createSlot(slotId: string) {
    return run(async () => {
      const { repository: core } = requireStack();
      const meta = await core.createSlot(slotId, 0);
      return { revision: meta.revision, writerEpoch: meta.writerEpoch };
    });
  },

  openSession(slotId: string, ifAvailable: boolean) {
    return run(async () => {
      const { repository: core, locks: lockAdapter } = requireStack();
      const opened = await openWriterSession(core, lockAdapter, slotId, { ifAvailable });
      if (isSlotBusy(opened)) return { status: "busy" as const };
      sessionSequence += 1;
      const id = `session-${sessionSequence}`;
      sessions.set(id, opened);
      return { status: "granted" as const, sessionId: id, epoch: opened.writerEpoch };
    });
  },

  sessionWrite(sessionId: string, seedSuffix: string) {
    return run(async () => {
      const session: WriterSession | undefined = sessions.get(sessionId);
      if (session === undefined) throw new Error("Unknown session.");
      const prepared = await preparedPair(session.slotId, seedSuffix);
      const meta = await session.writeManual(prepared);
      return { revision: meta.revision, checksum: prepared.envelope.checksum };
    });
  },

  sessionClose(sessionId: string) {
    return run(async () => {
      const session: WriterSession | undefined = sessions.get(sessionId);
      if (session === undefined) throw new Error("Unknown session.");
      sessions.delete(sessionId);
      await session.close();
      return {};
    });
  },

  readMeta(slotId: string) {
    return run(async () => {
      const { repository: core } = requireStack();
      const meta = await core.readSlotMeta(slotId);
      return {
        revision: meta.revision,
        writerEpoch: meta.writerEpoch,
        next: meta.nextCaptureSequence,
      };
    });
  },

  reloadVerify(slotId: string) {
    return run(async () => {
      // Fresh stack handle (same page, reopened database): proves durable
      // bytes survive with checksum and full-state admission intact. Slots
      // without a manual save verify through their autosave generations.
      const reopened = await openOverclockDatabase();
      try {
        const core = createSaveRepositoryCore(reopened);
        const bundle = loadContentBundle();
        let manualChecksum: string | null = null;
        let tick: number | null = null;
        let year: number | null = null;
        try {
          const stored = await core.readManualSave(slotId);
          manualChecksum = stored.envelope.checksum;
          const candidate = await admitLoadedSave(core, slotId, { content: bundle });
          tick = candidate.gameState.tick;
          year = candidate.gameState.campaign.currentYear;
        } catch (error: unknown) {
          if (
            error === null ||
            typeof error !== "object" ||
            (error as { code?: unknown }).code !== "INVALID_STATE"
          ) {
            throw error;
          }
        }
        const autosaves = await core.listAutosaves(slotId);
        let admitted = tick === null ? 0 : 1;
        for (const generation of autosaves) {
          await admitLoadedSave(core, slotId, {
            content: bundle,
            captureSequence: generation.captureSequence,
          });
          admitted += 1;
        }
        return {
          manualChecksum,
          tick,
          year,
          autosaveCount: autosaves.length,
          autosaves: autosaves.map((generation) => generation.captureSequence),
          admitted,
        };
      } finally {
        reopened.close();
      }
    });
  },

  admitAll(slotId: string) {
    return run(async () => {
      const { repository: core, content: bundle } = requireStack();
      let admitted = 0;
      let manualTick: number | null = null;
      try {
        const manual = await admitLoadedSave(core, slotId, { content: bundle });
        manualTick = manual.gameState.tick;
        admitted += 1;
      } catch (error: unknown) {
        // Rotation-only slots have no manual save; autosaves still verify.
        if (
          error === null ||
          typeof error !== "object" ||
          (error as { code?: unknown }).code !== "INVALID_STATE"
        ) {
          throw error;
        }
      }
      const autosaves = await core.listAutosaves(slotId);
      for (const generation of autosaves) {
        await admitLoadedSave(core, slotId, {
          content: bundle,
          captureSequence: generation.captureSequence,
        });
        admitted += 1;
      }
      return { manualTick, admitted };
    });
  },
};

declare global {
  interface Window {
    __repoHarness?: RepositoryHarness;
  }
}

window.__repoHarness = harness;
document.getElementById("repository-harness")?.setAttribute("data-ready", "true");
