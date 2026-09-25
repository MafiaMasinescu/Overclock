import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import {
  createDefaultSaveCodecAdapters,
  decodeSaveEnvelope,
  encodeEnvelopeBytes,
  encodeSaveEnvelope,
  sha256Hex,
} from "../../src/save/codec.ts";
import { createSyntheticV0Payload } from "../../src/save/migrations.ts";
import { DEFAULT_PLAYER_SETTINGS } from "../../src/save/schema.ts";
import { createImportService } from "../../src/save/import/importService.ts";
import type { ImportService } from "../../src/save/import/importService.ts";
import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import type { SaveRepositoryCore } from "../../src/save/repository/repository.ts";
import { createInMemoryRepositoryStorage } from "../../src/save/repository/storage.ts";
import type { InMemoryStorageControls } from "../../src/save/repository/storage.ts";
import {
  createInMemoryLockManager,
  createWebLockAdapter,
} from "../../src/save/repository/webLocks.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import { createPayload } from "./saveTestFixtures.ts";

const codecContent = loadContentBundle();

interface ImportHarness {
  readonly controls: InMemoryStorageControls;
  readonly repository: SaveRepositoryCore;
  readonly service: ImportService;
  advanceMs(ms: number): void;
  setContentVersion(version: string): void;
}

function setupImport(overrides?: { isSlotActive?: (slotId: string) => boolean }): ImportHarness {
  const controls = createInMemoryRepositoryStorage();
  const repository = createSaveRepositoryCore(controls.storage);
  const lockClient = createInMemoryLockManager().createClient();
  let now = 1_000_000;
  let slotSequence = 0;
  let contentVersionOverride: string | null = null;
  const service = createImportService({
    repository,
    locks: createWebLockAdapter({ locks: lockClient }),
    loadContent: () => {
      const bundle = loadContentBundle();
      return contentVersionOverride === null
        ? bundle
        : { ...bundle, contentVersion: contentVersionOverride };
    },
    nowMs: () => now,
    generateSlotId: () => `slot-imported-${slotSequence++}`,
    ...(overrides?.isSlotActive !== undefined ? { isSlotActive: overrides.isSlotActive } : {}),
  });
  return {
    controls,
    repository,
    service,
    advanceMs: (ms: number) => {
      now += ms;
    },
    setContentVersion: (version: string) => {
      contentVersionOverride = version;
    },
  };
}

async function validInputBytes(slotId = "slot-source"): Promise<Uint8Array> {
  const encoded = await encodeSaveEnvelope(createPayload(slotId), {
    content: codecContent,
    compression: "none",
  });
  return encoded.bytes;
}

async function envelopeBytes(payload: unknown): Promise<Uint8Array> {
  const canonical = canonicalSerialize(payload);
  const checksum = await sha256Hex(new TextEncoder().encode(canonical));
  const envelope = {
    format: "overclock-save",
    compression: "none",
    checksumAlgorithm: "sha-256",
    checksum,
    payload: canonical,
  };
  return new TextEncoder().encode(canonicalSerialize(envelope));
}

describe("verified import preview", () => {
  test("previews a valid save without writing anything", async () => {
    const harness = setupImport();
    const input = await validInputBytes();
    const result = await harness.service.previewImport({ bytes: input });
    expect(result.preview.compatibility).toBe("compatible");
    expect(result.preview.migrationRequired).toBe(false);
    expect(result.preview.slotId).toBe("slot-source");
    expect(result.preview.destinationSuggestion).toEqual({ kind: "new-slot" });
    expect(result.preview.compressedBytes).toBe(input.length);
    expect(result.preview.uncompressedBytes).toBeGreaterThan(0);
    expect(result.token).not.toBeNull();
    expect(result.allocatedSlotId).toBe("slot-imported-0");
    // Read-only: no slot, no write committed.
    await expect(harness.repository.listSlots()).resolves.toEqual([]);
    expect(harness.controls.committedWriteCount()).toBe(0);
  });

  test("a newer preview invalidates the previous token", async () => {
    const harness = setupImport();
    const first = await harness.service.previewImport({ bytes: await validInputBytes("slot-a") });
    const second = await harness.service.previewImport({ bytes: await validInputBytes("slot-b") });
    await expect(harness.service.confirmImport(first.token ?? "")).rejects.toMatchObject({
      code: "TOKEN_CONSUMED",
    });
    const confirmed = await harness.service.confirmImport(second.token ?? "");
    expect(confirmed.slotId).toBe("slot-imported-1");
  });

  test("a lock release failure after commit cannot report the import as failed", async () => {
    const repository = createSaveRepositoryCore(createInMemoryRepositoryStorage().storage);
    const service = createImportService({
      repository,
      locks: {
        available: true,
        acquire: (slotId) =>
          Promise.resolve({
            slotId,
            name: `overclock-slot:${slotId}`,
            release: () => Promise.reject(new Error("release failed after commit")),
          }),
      },
      loadContent: () => codecContent,
      generateSlotId: () => "slot-imported-release",
    });
    const preview = await service.previewImport({ bytes: await validInputBytes() });
    await expect(service.confirmImport(preview.token ?? "")).resolves.toMatchObject({
      slotId: "slot-imported-release",
    });
    await expect(repository.readManualSave("slot-imported-release")).resolves.toBeDefined();
    await expect(service.confirmImport(preview.token ?? "")).rejects.toMatchObject({
      code: "TOKEN_CONSUMED",
    });
  });

  test("a failed later preview invalidates the previous token", async () => {
    const harness = setupImport();
    const first = await harness.service.previewImport({ bytes: await validInputBytes("slot-a") });
    await expect(
      harness.service.previewImport({ bytes: new TextEncoder().encode("not-json") }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
    await expect(harness.service.confirmImport(first.token ?? "")).rejects.toMatchObject({
      code: "TOKEN_CONSUMED",
    });
  });

  test("a slow older preview cannot replace a newer completed preview", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const lockClient = createInMemoryLockManager().createClient();
    const baseAdapters = createDefaultSaveCodecAdapters();
    let releaseFirstHash: () => void = () => {
      throw new Error("Hash gate was not initialized.");
    };
    let markFirstHashEntered: () => void = () => {
      throw new Error("Hash entry signal was not initialized.");
    };
    const firstHashEntered = new Promise<void>((resolve) => {
      markFirstHashEntered = resolve;
    });
    const firstHashGate = new Promise<void>((resolve) => {
      releaseFirstHash = resolve;
    });
    let hashCalls = 0;
    const service = createImportService({
      repository,
      locks: createWebLockAdapter({ locks: lockClient }),
      loadContent: () => codecContent,
      generateSlotId: () => "slot-imported-race",
      adapters: {
        ...baseAdapters,
        sha256: async (bytes, signal) => {
          hashCalls += 1;
          if (hashCalls === 1) {
            markFirstHashEntered();
            await firstHashGate;
          }
          return baseAdapters.sha256(bytes, signal);
        },
      },
    });
    const older = service.previewImport({ bytes: await validInputBytes("slot-old") });
    await firstHashEntered;
    const newer = await service.previewImport({ bytes: await validInputBytes("slot-new") });
    releaseFirstHash();
    await expect(older).rejects.toMatchObject({ code: "CANCELLED" });
    const confirmed = await service.confirmImport(newer.token ?? "");
    expect(confirmed.slotId).toBe("slot-imported-race");
  });

  test.each([
    ["truncated", new Uint8Array([123, 34, 102])],
    ["empty", new Uint8Array(0)],
    ["not-json", new TextEncoder().encode("hello world")],
  ])("rejects %s input without retaining a candidate", async (_label, bytes) => {
    const harness = setupImport();
    await expect(harness.service.previewImport({ bytes })).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
    await expect(harness.service.confirmImport("import-0-deadbeef")).rejects.toMatchObject({
      code: "TOKEN_CONSUMED",
    });
  });

  test("rejects duplicate envelope keys", async () => {
    const harness = setupImport();
    const input = await validInputBytes();
    const text = new TextDecoder().decode(input);
    // Canonical key order is alphabetical; inject a second "checksum" key
    // before "checksumAlgorithm", which appears exactly once.
    const adversarial = text.replace('"checksumAlgorithm"', '"checksum":"00","checksumAlgorithm"');
    expect(adversarial).not.toBe(text);
    await expect(
      harness.service.previewImport({ bytes: new TextEncoder().encode(adversarial) }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  test("rejects oversize input at the byte bound", async () => {
    const harness = setupImport();
    await expect(
      harness.service.previewImport({ bytes: new Uint8Array(8 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  test("rejects a checksum mismatch before payload parsing", async () => {
    const harness = setupImport();
    const input = await validInputBytes();
    const outer = JSON.parse(new TextDecoder().decode(input)) as {
      payload: string;
      checksum: string;
    };
    const tamperedPayload = outer.payload.replace("1946", "1947");
    expect(tamperedPayload).not.toBe(outer.payload);
    const tampered = new TextEncoder().encode(
      canonicalSerialize({ ...outer, payload: tamperedPayload }),
    );
    await expect(harness.service.previewImport({ bytes: tampered })).rejects.toMatchObject({
      code: "CHECKSUM_MISMATCH",
    });
  });

  test("rejects a future schema version", async () => {
    const harness = setupImport();
    const payload = { ...createPayload("slot-source"), schemaVersion: 99 };
    await expect(
      harness.service.previewImport({ bytes: await envelopeBytes(payload) }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_VERSION" });
  });

  test("migrates a synthetic v0 copy and leaves source bytes untouched", async () => {
    const harness = setupImport();
    const v0 = createSyntheticV0Payload(createPayload("slot-source"));
    const source = await envelopeBytes(v0);
    const sourceCopy = new Uint8Array(source);
    const result = await harness.service.previewImport({ bytes: source });
    expect(result.preview.compatibility).toBe("compatible");
    expect(result.preview.migrationRequired).toBe(true);
    expect(new Uint8Array(source)).toEqual(sourceCopy);
    const confirmed = await harness.service.confirmImport(result.token ?? "");
    const stored = await harness.repository.readManualSave(confirmed.slotId);
    expect(stored.envelope.checksum).not.toBe(
      (JSON.parse(new TextDecoder().decode(sourceCopy)) as { checksum: string }).checksum,
    );
    // Migration supplies zero-valued local stats on the owned copy, stored
    // as a fresh v1 envelope (the stored source version is therefore 1).
    const migrated = await decodeSaveEnvelope(encodeEnvelopeBytes(stored.envelope), {
      content: codecContent,
    });
    expect(migrated.payload.schemaVersion).toBe(1);
    expect(migrated.migrated).toBe(false);
    expect(migrated.payload.localStats).toEqual({
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    });
  });

  test("reports incompatible content without a token", async () => {
    const harness = setupImport();
    harness.setContentVersion("9.9.9-future");
    const result = await harness.service.previewImport({ bytes: await validInputBytes() });
    expect(result.preview.compatibility).toBe("INCOMPATIBLE_CONTENT");
    expect(result.token).toBeNull();
    expect(result.allocatedSlotId).toBeNull();
  });

  test("reports a state-hash mismatch without a token", async () => {
    const harness = setupImport();
    const payload: SavePayloadV1 = {
      ...createPayload("slot-source"),
      execution: {
        simulatorProtocolVersion: 1,
        nextQueueSequence: 0,
        pendingCommandCount: 0,
        stateHash: "0000000000000000",
      },
    };
    const result = await harness.service.previewImport({ bytes: await envelopeBytes(payload) });
    expect(result.preview.compatibility).toBe("CHECKSUM_MISMATCH");
    expect(result.token).toBeNull();
  });

  test("accepts gzip-encoded input", async () => {
    const harness = setupImport();
    const encoded = await encodeSaveEnvelope(createPayload("slot-source"), {
      content: codecContent,
      compression: "gzip",
    });
    const result = await harness.service.previewImport({ bytes: encoded.bytes });
    expect(result.preview.compatibility).toBe("compatible");
    expect(result.token).not.toBeNull();
  });

  test("overwrite preview binds the live revision", async () => {
    const harness = setupImport();
    await harness.repository.createSlot("slot-target", 0);
    const result = await harness.service.previewImport({
      bytes: await validInputBytes(),
      destination: { kind: "overwrite", slotId: "slot-target" },
    });
    expect(result.preview.destinationSuggestion).toEqual({
      kind: "overwrite",
      slotId: "slot-target",
    });
    expect(result.allocatedSlotId).toBeNull();
  });

  test("overwrite preview of a missing slot fails", async () => {
    const harness = setupImport();
    await expect(
      harness.service.previewImport({
        bytes: await validInputBytes(),
        destination: { kind: "overwrite", slotId: "slot-ghost" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("atomic import confirmation", () => {
  test("refuses overwrite while another tab holds the destination Web Lock", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-target", 0);
    const manager = createInMemoryLockManager();
    const ownerLocks = createWebLockAdapter({ locks: manager.createClient() });
    const importerLocks = createWebLockAdapter({ locks: manager.createClient() });
    const owner = await ownerLocks.acquire("slot-target");
    if ("status" in owner) throw new Error("Expected the owner lock.");
    const service = createImportService({
      repository,
      locks: importerLocks,
      loadContent: () => codecContent,
      generateSlotId: () => "slot-unused",
    });
    const previewed = await service.previewImport({
      bytes: await validInputBytes(),
      destination: { kind: "overwrite", slotId: "slot-target" },
    });
    await expect(
      service.confirmImport(previewed.token ?? "", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "SLOT_BUSY" });
    await owner.release();
    await expect(
      service.confirmImport(previewed.token ?? "", { expectedRevision: 0 }),
    ).resolves.toMatchObject({ slotId: "slot-target" });
  });

  test("imports into a new slot with rebound identity and fresh checksum", async () => {
    const harness = setupImport();
    const input = await validInputBytes();
    const inputCopy = new Uint8Array(input);
    const previewed = await harness.service.previewImport({ bytes: input });
    const confirmed = await harness.service.confirmImport(previewed.token ?? "");
    expect(confirmed.slotId).toBe("slot-imported-0");
    expect(confirmed.meta.revision).toBe(1);
    expect(confirmed.meta.latestRecovery).toEqual({ kind: "manual", captureSequence: 0 });
    expect(confirmed.appliedSettings).toBe(false);
    expect(confirmed.settingsRevision).toBeNull();
    const stored = await harness.repository.readManualSave("slot-imported-0");
    expect(stored.preview.slotId).toBe("slot-imported-0");
    expect(new Uint8Array(input)).toEqual(inputCopy);
    await expect(harness.service.confirmImport(previewed.token ?? "")).rejects.toMatchObject({
      code: "TOKEN_CONSUMED",
    });
  });

  test("preserves current device settings unless applying imported ones", async () => {
    const harness = setupImport();
    await harness.repository.writeSettings(
      { ...DEFAULT_PLAYER_SETTINGS, language: "ro" },
      { expectedRevision: null },
    );
    const previewed = await harness.service.previewImport({ bytes: await validInputBytes() });
    await harness.service.confirmImport(previewed.token ?? "");
    const kept = await harness.repository.readSettings();
    expect(kept?.settings.language).toBe("ro");
    // The imported payload still carries its own settings inside the save.
    const stored = await harness.repository.readManualSave("slot-imported-0");
    expect(stored).toBeDefined();
  });

  test("applies imported settings atomically with the slot", async () => {
    const harness = setupImport();
    await harness.repository.writeSettings(DEFAULT_PLAYER_SETTINGS, { expectedRevision: null });
    const previewed = await harness.service.previewImport({ bytes: await validInputBytes() });
    const confirmed = await harness.service.confirmImport(previewed.token ?? "", {
      applySettings: true,
    });
    expect(confirmed.appliedSettings).toBe(true);
    expect(confirmed.settingsRevision).toBe(1);
    const current = await harness.repository.readSettings();
    expect(current?.revision).toBe(1);
    expect(current?.settings.language).toBe("en");
  });

  test("a quota failure changes neither slot nor settings and keeps the token", async () => {
    const harness = setupImport();
    await harness.repository.writeSettings(DEFAULT_PLAYER_SETTINGS, { expectedRevision: null });
    const previewed = await harness.service.previewImport({ bytes: await validInputBytes() });
    harness.controls.failNextCommitWithQuotaExceeded();
    await expect(
      harness.service.confirmImport(previewed.token ?? "", { applySettings: true }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await expect(harness.repository.readManualSave("slot-imported-0")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const settings = await harness.repository.readSettings();
    expect(settings?.revision).toBe(0);
    // Retry after the quota clears through the same token.
    const confirmed = await harness.service.confirmImport(previewed.token ?? "", {
      applySettings: true,
    });
    expect(confirmed.meta.revision).toBe(1);
    expect(confirmed.settingsRevision).toBe(1);
  });

  test("overwrites with the bound revision and refuses stale ones", async () => {
    const harness = setupImport();
    await harness.repository.createSlot("slot-target", 0);
    const previewed = await harness.service.previewImport({
      bytes: await validInputBytes(),
      destination: { kind: "overwrite", slotId: "slot-target" },
    });
    const confirmed = await harness.service.confirmImport(previewed.token ?? "", {
      expectedRevision: 0,
    });
    expect(confirmed.meta.revision).toBe(1);
    const second = await harness.service.previewImport({
      bytes: await validInputBytes("slot-other"),
      destination: { kind: "overwrite", slotId: "slot-target" },
    });
    await expect(
      harness.service.confirmImport(second.token ?? "", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    // The failed confirmation retains its token for an explicit re-preview.
    await expect(
      harness.service.confirmImport(second.token ?? "", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  test("a destination race between preview and confirm fails loudly", async () => {
    const harness = setupImport();
    await harness.repository.createSlot("slot-target", 0);
    const previewed = await harness.service.previewImport({
      bytes: await validInputBytes(),
      destination: { kind: "overwrite", slotId: "slot-target" },
    });
    // A concurrent writer commits first.
    await harness.repository.writeManualSave(
      "slot-target",
      {
        envelope: (
          await encodeSaveEnvelope(createPayload("slot-target"), {
            content: codecContent,
            compression: "none",
          })
        ).envelope,
        preview: {
          sourceSchemaVersion: 1,
          sourceSaveVersion: 1,
          contentVersion: "0.1.0",
          simulatedYear: 1946,
          tick: 0,
          cashUsd: 32000,
          verticalSliceCompleted: false,
          savedAtIso: "2026-09-17T10:00:01.000Z",
          migrationRequired: false,
          compatibility: "compatible",
          destinationSuggestion: { kind: "new-slot" },
          compressedBytes: 1,
          uncompressedBytes: 1,
          slotId: "slot-target",
        },
      },
      { expectedRevision: 0, expectedWriterEpoch: 0 },
    );
    await expect(
      harness.service.confirmImport(previewed.token ?? "", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const stored = await harness.repository.readManualSave("slot-target");
    expect(stored.preview.slotId).toBe("slot-target");
  });

  test("refuses to overwrite an actively simulated slot", async () => {
    const harness = setupImport({ isSlotActive: (slotId) => slotId === "slot-target" });
    await harness.repository.createSlot("slot-target", 0);
    const previewed = await harness.service.previewImport({
      bytes: await validInputBytes(),
      destination: { kind: "overwrite", slotId: "slot-target" },
    });
    await expect(
      harness.service.confirmImport(previewed.token ?? "", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "SLOT_ACTIVE" });
  });

  test("an expired token reports expiry and commits nothing", async () => {
    const harness = setupImport();
    const previewed = await harness.service.previewImport({ bytes: await validInputBytes() });
    harness.advanceMs(5 * 60 * 1000 + 1);
    await expect(harness.service.confirmImport(previewed.token ?? "")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    await expect(harness.repository.listSlots()).resolves.toEqual([]);
  });

  test("content drift between preview and confirm aborts the import", async () => {
    const harness = setupImport();
    const previewed = await harness.service.previewImport({ bytes: await validInputBytes() });
    harness.setContentVersion("9.9.9-future");
    await expect(harness.service.confirmImport(previewed.token ?? "")).rejects.toMatchObject({
      code: "INCOMPATIBLE_CONTENT",
    });
    await expect(harness.repository.listSlots()).resolves.toEqual([]);
  });

  test("a new-slot confirmation takes no expected revision", async () => {
    const harness = setupImport();
    const previewed = await harness.service.previewImport({ bytes: await validInputBytes() });
    await expect(
      harness.service.confirmImport(previewed.token ?? "", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });
});
