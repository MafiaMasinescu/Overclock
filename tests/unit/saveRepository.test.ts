import { describe, expect, test } from "vitest";

import { PersistenceError } from "../../src/save/persistenceErrors.ts";
import { DEFAULT_PLAYER_SETTINGS } from "../../src/save/schema.ts";
import type { LocalReport } from "../../src/save/schema.ts";
import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import {
  autosaveKey,
  createInMemoryRepositoryStorage,
  parseAutosaveKey,
} from "../../src/save/repository/storage.ts";
import { createOperationToken } from "../../src/save/repository/types.ts";
import { createPayload, preparedPair, previewFor, saveTestContent } from "./saveTestFixtures.ts";
import { encodeSaveEnvelope } from "../../src/save/codec.ts";

function localReport(reportId: string): LocalReport {
  return {
    reportVersion: 1,
    reportId,
    appVersion: "0.1.0",
    contentVersion: "0.1.0",
    category: "manual",
    errorCode: null,
    tick: 0,
    year: 1940,
    createdAtIso: "2026-09-24T12:00:00.000Z",
    counters: {
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    },
    durationMs: { total: 0, max: 0 },
    capabilities: { worker: true, indexedDb: true, crypto: true, gzip: true, webLocks: true },
  };
}

describe("atomic save repository core", () => {
  test("creates a slot with zeroed fencing metadata", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const meta = await repository.createSlot("slot-alpha", 7);
    expect(meta).toEqual({
      slotId: "slot-alpha",
      revision: 0,
      nextCaptureSequence: 0,
      writerEpoch: 7,
      latestRecovery: null,
    });
  });

  test.each([["INVALID"], ["slot_alpha"], ["-leading"], ["x".repeat(65)]])(
    "rejects invalid slot id %s without touching storage",
    async (slotId) => {
      const controls = createInMemoryRepositoryStorage();
      const repository = createSaveRepositoryCore(controls.storage);
      await expect(repository.createSlot(slotId, 0)).rejects.toThrow(PersistenceError);
      await expect(repository.listSlots()).resolves.toEqual([]);
      expect(controls.committedWriteCount()).toBe(0);
    },
  );

  test("rejects duplicate slot creation and preserves the original", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    await expect(repository.createSlot("slot-alpha", 0)).rejects.toThrow(PersistenceError);
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(0);
  });

  test("caps committed manual and autosave slots at twenty while allowing an unsaved slot", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    for (let index = 0; index < 20; index += 1) {
      const slotId = `slot-${index.toString().padStart(2, "0")}`;
      await repository.createSlot(slotId, 0);
      await repository.writeManualSave(slotId, await preparedPair(slotId), {
        expectedRevision: 0,
        expectedWriterEpoch: 0,
      });
    }
    await repository.createSlot("slot-overflow", 0);
    const overflow = await preparedPair("slot-overflow");
    await expect(
      repository.writeManualSave("slot-overflow", overflow, {
        expectedRevision: 0,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
    await expect(
      repository.writeAutosave("slot-overflow", overflow, {
        expectedRevision: 0,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
    const listings = await repository.listSlots();
    expect(listings.filter((slot) => slot.meta.latestRecovery !== null)).toHaveLength(20);
    expect((await repository.readSlotMeta("slot-overflow")).latestRecovery).toBeNull();
  });

  test("writes and reads a manual save with atomic metadata", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 3);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    const meta = await repository.writeManualSave(
      "slot-alpha",
      { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
      { expectedRevision: 0, expectedWriterEpoch: 3 },
    );
    expect(meta).toEqual({
      slotId: "slot-alpha",
      revision: 1,
      nextCaptureSequence: 1,
      writerEpoch: 3,
      latestRecovery: { kind: "manual", captureSequence: 0 },
    });
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.captureSequence).toBe(0);
    expect(stored.revision).toBe(1);
    expect(stored.envelope.checksum).toBe(encoded.envelope.checksum);
    expect(stored.preview.slotId).toBe("slot-alpha");
  });

  test("consumes one capture sequence per manual write", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    for (let write = 0; write < 2; write += 1) {
      const payload = createPayload("slot-alpha");
      const encoded = await encodeSaveEnvelope(payload, {
        content: saveTestContent,
        compression: "none",
      });
      const meta = await repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
        { expectedRevision: write, expectedWriterEpoch: 0 },
      );
      expect(meta.nextCaptureSequence).toBe(write + 1);
    }
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.captureSequence).toBe(1);
    expect(stored.revision).toBe(2);
  });

  test("keeps a committed manual save readable after later autosave revisions", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manual = await preparedPair("slot-alpha", { seedSuffix: "-manual" });
    await repository.writeManualSave("slot-alpha", manual, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const autosave = await preparedPair("slot-alpha", { seedSuffix: "-auto" });
    const updatedMeta = await repository.writeAutosave("slot-alpha", autosave, {
      expectedRevision: 1,
      expectedWriterEpoch: 0,
    });

    const stored = await repository.readManualSaveAtRevision(
      "slot-alpha",
      updatedMeta.meta.revision,
    );
    expect(stored.meta.revision).toBe(2);
    expect(stored.save.revision).toBe(1);
  });

  test("rejects a stale revision without mutating the slot", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    await repository.writeManualSave(
      "slot-alpha",
      { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
      { expectedRevision: 0, expectedWriterEpoch: 0 },
    );
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
        { expectedRevision: 0, expectedWriterEpoch: 0 },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.revision).toBe(1);
  });

  test("rejects a stale writer epoch without mutating the slot", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    await repository.rotateWriterEpoch("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
        { expectedRevision: 1, expectedWriterEpoch: 0 },
      ),
    ).rejects.toMatchObject({ code: "STALE_WRITER" });
    const stored = await repository.readManualSave("slot-alpha").catch(() => null);
    expect(stored).toBeNull();
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.writerEpoch).toBe(1);
    expect(meta.revision).toBe(1);
  });

  test("request success followed by abort commits nothing", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    controls.abortAfterRequestSuccessOnce();
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
        { expectedRevision: 0, expectedWriterEpoch: 0 },
      ),
    ).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    await expect(repository.readManualSave("slot-alpha")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(0);
    expect(meta.nextCaptureSequence).toBe(0);
  });

  test("quota failure preserves prior generations", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const first = createPayload("slot-alpha");
    const firstEncoded = await encodeSaveEnvelope(first, {
      content: saveTestContent,
      compression: "none",
    });
    await repository.writeManualSave(
      "slot-alpha",
      { envelope: firstEncoded.envelope, preview: previewFor(first, "slot-alpha") },
      { expectedRevision: 0, expectedWriterEpoch: 0 },
    );
    controls.failNextCommitWithQuotaExceeded();
    const second = createPayload("slot-alpha");
    const secondEncoded = await encodeSaveEnvelope(second, {
      content: saveTestContent,
      compression: "none",
    });
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: secondEncoded.envelope, preview: previewFor(second, "slot-alpha") },
        { expectedRevision: 1, expectedWriterEpoch: 0 },
      ),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.revision).toBe(1);
    expect(stored.envelope.checksum).toBe(firstEncoded.envelope.checksum);
  });

  test("cancelled operation token never reaches storage", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    const { token, cancel } = createOperationToken();
    cancel();
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
        { expectedRevision: 0, expectedWriterEpoch: 0, token },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(0);
  });

  test("aborted signal never reaches storage", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
        { expectedRevision: 0, expectedWriterEpoch: 0, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  test("rejects a preview bound to a different slot", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { envelope: encoded.envelope, preview: previewFor(payload, "slot-beta") },
        { expectedRevision: 0, expectedWriterEpoch: 0 },
      ),
    ).rejects.toThrow(PersistenceError);
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(0);
  });

  test("deletes a slot with its rotations and metadata in one transaction", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    await repository.createSlot("slot-beta", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    await repository.writeManualSave(
      "slot-alpha",
      { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
      { expectedRevision: 0, expectedWriterEpoch: 0 },
    );
    // Seed one autosave generation directly; rotation logic itself is 17.2.
    await controls.storage.runTransaction(["autosaves"], "readwrite", (tx) =>
      tx.put("autosaves", autosaveKey("slot-alpha", 1), {
        slotId: "slot-alpha",
        captureSequence: 1,
        envelope: encoded.envelope,
        preview: previewFor(payload, "slot-alpha"),
      }),
    );
    await repository.deleteSlot("slot-alpha", { expectedRevision: 1, expectedWriterEpoch: 0 });
    await expect(repository.readManualSave("slot-alpha")).rejects.toThrow(PersistenceError);
    await expect(repository.readSlotMeta("slot-alpha")).rejects.toThrow(PersistenceError);
    const remaining = await controls.storage.runTransaction(["autosaves"], "readonly", (tx) =>
      tx.getAll("autosaves"),
    );
    expect(remaining).toEqual([]);
    // The unrelated slot is untouched.
    const beta = await repository.readSlotMeta("slot-beta");
    expect(beta.revision).toBe(0);
  });

  test("delete with a stale revision preserves the slot", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    await expect(
      repository.deleteSlot("slot-alpha", { expectedRevision: 4, expectedWriterEpoch: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(0);
  });

  test("lists slots with manuals in lexical order", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-beta", 0);
    await repository.createSlot("slot-alpha", 0);
    const payload = createPayload("slot-alpha");
    const encoded = await encodeSaveEnvelope(payload, {
      content: saveTestContent,
      compression: "none",
    });
    await repository.writeManualSave(
      "slot-alpha",
      { envelope: encoded.envelope, preview: previewFor(payload, "slot-alpha") },
      { expectedRevision: 0, expectedWriterEpoch: 0 },
    );
    const listings = await repository.listSlots();
    expect(listings.map((entry) => entry.slotId)).toEqual(["slot-alpha", "slot-beta"]);
    expect(listings[0]?.manual?.captureSequence).toBe(0);
    expect(listings[1]?.manual).toBeNull();
  });

  test("versions global settings with their own revision", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await expect(repository.readSettings()).resolves.toBeNull();
    const first = await repository.writeSettings(DEFAULT_PLAYER_SETTINGS, {
      expectedRevision: null,
    });
    expect(first.revision).toBe(0);
    const second = await repository.writeSettings(
      { ...DEFAULT_PLAYER_SETTINGS, language: "ro" },
      { expectedRevision: 0 },
    );
    expect(second.revision).toBe(1);
    expect(second.settings.language).toBe("ro");
    await expect(
      repository.writeSettings(DEFAULT_PLAYER_SETTINGS, { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  test("rejects prepared accessors without invoking them", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    let getterCalls = 0;
    const hostileEnvelope = { ...prepared.envelope };
    Object.defineProperty(hostileEnvelope, "checksum", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return prepared.envelope.checksum;
      },
    });
    await expect(
      repository.writeManualSave(
        "slot-alpha",
        { ...prepared, envelope: hostileEnvelope },
        { expectedRevision: 0, expectedWriterEpoch: 0 },
      ),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
    expect(getterCalls).toBe(0);
  });

  test("rejects poisoned stored metadata and exhausted counters", async () => {
    const poisonedControls = createInMemoryRepositoryStorage();
    await poisonedControls.storage.runTransaction(["slotMeta"], "readwrite", (tx) =>
      tx.put("slotMeta", "slot-poisoned", {
        slotId: "slot-poisoned",
        revision: Number.NaN,
        nextCaptureSequence: -1,
        writerEpoch: 0,
        latestRecovery: { kind: "manual", captureSequence: 99 },
      }),
    );
    const poisoned = createSaveRepositoryCore(poisonedControls.storage);
    await expect(poisoned.readSlotMeta("slot-poisoned")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    const exhaustedControls = createInMemoryRepositoryStorage();
    await exhaustedControls.storage.runTransaction(["slotMeta"], "readwrite", (tx) =>
      tx.put("slotMeta", "slot-exhausted", {
        slotId: "slot-exhausted",
        revision: Number.MAX_SAFE_INTEGER,
        nextCaptureSequence: Number.MAX_SAFE_INTEGER,
        writerEpoch: 0,
        latestRecovery: null,
      }),
    );
    const exhausted = createSaveRepositoryCore(exhaustedControls.storage);
    const prepared = await preparedPair("slot-exhausted");
    await expect(
      exhausted.writeManualSave("slot-exhausted", prepared, {
        expectedRevision: Number.MAX_SAFE_INTEGER,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(exhausted.readSlotMeta("slot-exhausted")).resolves.toMatchObject({
      revision: Number.MAX_SAFE_INTEGER,
      nextCaptureSequence: Number.MAX_SAFE_INTEGER,
    });
  });

  test("rejects settings accessors without invoking them", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    let getterCalls = 0;
    const hostile = { ...DEFAULT_PLAYER_SETTINGS };
    Object.defineProperty(hostile, "language", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "en";
      },
    });
    await expect(
      repository.writeSettings(hostile, { expectedRevision: null }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
    expect(getterCalls).toBe(0);
  });

  test("keeps only the newest twenty reports and preserves sequence after clearing", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    for (let index = 0; index < 21; index += 1) {
      await repository.writeReport(localReport(`report-${index.toString().padStart(2, "0")}`));
    }

    const retained = await repository.listReports();
    expect(retained).toHaveLength(20);
    expect(retained[0]?.reportId).toBe("report-20");
    expect(retained.at(-1)?.reportId).toBe("report-01");
    for (const report of retained) await repository.deleteReport(report.reportId);
    await repository.writeReport(localReport("report-after-clear"));

    const raw = await controls.storage.runTransaction(["reports"], "readonly", (tx) =>
      tx.get("reports", "__overclock_report_sequence__"),
    );
    expect(raw).toEqual({ sequence: 21 });
    expect((await repository.listReports()).map((report) => report.reportId)).toEqual([
      "report-after-clear",
    ]);
  });

  test("rejects sensitive report fields and preserves prior reports on quota failure", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const first = localReport("report-safe");
    await repository.writeReport(first);
    await expect(
      repository.writeReport({
        ...localReport("report-with-stack"),
        stack: "private path",
      } as LocalReport),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });

    controls.failNextCommitWithQuotaExceeded();
    await expect(repository.writeReport(localReport("report-quota"))).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    await expect(repository.listReports()).resolves.toEqual([first]);
  });

  test("autosave keys use the native compound identity", () => {
    const first = autosaveKey("slot-alpha", 2);
    const second = autosaveKey("slot-alpha", 10);
    expect(first).toEqual(["slot-alpha", 2]);
    expect(second).toEqual(["slot-alpha", 10]);
    expect(parseAutosaveKey(second)).toEqual({ slotId: "slot-alpha", captureSequence: 10 });
    expect(parseAutosaveKey("not-compound")).toBeNull();
  });
});
