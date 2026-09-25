import { describe, expect, test } from "vitest";

import {
  createDefaultSaveCodecAdapters,
  decodeSaveEnvelope,
  encodeEnvelopeBytes,
  type SaveCodecAdapters,
} from "../../src/save/codec.ts";
import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import { createInMemoryRepositoryStorage } from "../../src/save/repository/storage.ts";
import {
  createInMemoryLockManager,
  createWebLockAdapter,
} from "../../src/save/repository/webLocks.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createWorkerSavePersistence } from "../../src/app/worker/savePersistence.ts";
import { persistenceError } from "../../src/save/persistenceErrors.ts";
import { MAX_ORDINARY_SLOT_COUNT } from "../../src/save/persistenceLimits.ts";
import { saveTestContent } from "./saveTestFixtures.ts";

describe("Worker save persistence", () => {
  test("encodes a same-tick state and queue position into a fenced manual save", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({
      locks: createInMemoryLockManager().createClient(),
    });
    const times = [new Date("2026-09-24T12:00:00.000Z"), new Date("2026-09-24T12:00:01.000Z")];
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      now: () => times.shift() ?? new Date("2026-09-24T12:00:02.000Z"),
      createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const session = await persistence.startNewRun();
    const state = createInitialGameState({ content: saveTestContent, seed: "same-tick-save" });

    const metadata = await persistence.save(
      {
        state,
        nextQueueSequence: 7,
        dirtyGeneration: 1,
        createdAtIso: session.createdAtIso,
        settings: session.settings,
        localStats: session.localStats,
      },
      "manual",
    );

    expect(metadata).toMatchObject({
      slotId: "slot-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      savedAtIso: "2026-09-24T12:00:01.000Z",
      tick: state.tick,
    });
    const stored = await repository.readManualSave(metadata.slotId);
    const decoded = await decodeSaveEnvelope(encodeEnvelopeBytes(stored.envelope), {
      content: saveTestContent,
    });
    expect(decoded.payload.execution).toMatchObject({
      nextQueueSequence: 7,
      pendingCommandCount: 0,
    });
    expect(decoded.payload.gameState).toEqual(state);
    expect(controls.storage).toBeDefined();
    await persistence.close();
  });

  test("cancelling during encode prevents a late transaction after session close", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({
      locks: createInMemoryLockManager().createClient(),
    });
    const adapters = createDefaultSaveCodecAdapters();
    let releaseHash!: () => void;
    let announceHash!: () => void;
    const hashPaused = new Promise<void>((resolve) => {
      announceHash = resolve;
    });
    const hashGate = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const codecAdapters: SaveCodecAdapters = {
      ...adapters,
      async sha256(bytes, signal) {
        announceHash();
        await hashGate;
        return adapters.sha256(bytes, signal);
      },
    };
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      codecAdapters,
    });
    const session = await persistence.startNewRun();
    const pendingSave = persistence.save(
      {
        state: createInitialGameState({ content: saveTestContent, seed: "cancel-before-commit" }),
        nextQueueSequence: 0,
        dirtyGeneration: 1,
        createdAtIso: session.createdAtIso,
        settings: session.settings,
        localStats: session.localStats,
      },
      "manual",
    );
    await hashPaused;
    await persistence.close();
    releaseHash();

    await expect(pendingSave).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(repository.readManualSave(session.slotId)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("updates global settings through repository revision fencing", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({
      locks: createInMemoryLockManager().createClient(),
    });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    await persistence.startNewRun();
    const updated = await persistence.updateSettings({
      language: "ro",
      telemetryPreset: "compact",
      reducedEffects: true,
      reducedMotion: false,
      frameCap: 45,
      volumes: { master: 0.8, music: 0.7, ui: 0.6, machinery: 0.5, alerts: 0.4 },
    });

    expect(updated).toMatchObject({ language: "ro", frameCap: 45 });
    await expect(repository.readSettings()).resolves.toMatchObject({
      revision: 0,
      settings: updated,
    });
    await persistence.close();
  });

  test("lists and exports the newest committed autosave generation with corruption fallback", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const times = [new Date("2026-09-24T12:00:01.000Z"), new Date("2026-09-24T12:00:02.000Z")];
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      now: () => times.shift() ?? new Date("2026-09-24T12:00:03.000Z"),
      createId: () => "c1234567-89ab-4cde-8fab-0123456789ab",
    });
    const session = await persistence.startNewRun();
    const state = createInitialGameState({ content: saveTestContent, seed: "export-autosave" });
    const capture = (nextQueueSequence: number) => ({
      state,
      nextQueueSequence,
      dirtyGeneration: nextQueueSequence + 1,
      createdAtIso: session.createdAtIso,
      settings: session.settings,
      localStats: session.localStats,
    });
    await persistence.save(capture(3), "manual");
    await persistence.save(capture(8), "autosave");

    const [listed] = (await persistence.listSlots?.()) ?? [];
    expect(listed?.savedAtIso).toBe("2026-09-24T12:00:03.000Z");
    expect(listed?.verification).toBe("unchecked");
    const latestBytes = await persistence.exportSlot?.(session.slotId, listed?.revision ?? -1);
    const latest = await decodeSaveEnvelope(latestBytes ?? new Uint8Array(), {
      content: saveTestContent,
    });
    expect(latest.payload.execution.nextQueueSequence).toBe(8);

    await controls.storage.runTransaction(["autosaves"], "readwrite", (tx) =>
      tx.put("autosaves", [session.slotId, 1], {
        slotId: session.slotId,
        captureSequence: 1,
        envelope: { format: "corrupt" },
        preview: {},
      }),
    );
    const fallbackBytes = await persistence.exportSlot?.(session.slotId, listed?.revision ?? -1);
    const fallback = await decodeSaveEnvelope(fallbackBytes ?? new Uint8Array(), {
      content: saveTestContent,
    });
    expect(fallback.payload.execution.nextQueueSequence).toBe(3);
    await persistence.close();
  });

  test("slot listing reports storage failure instead of treating it as one damaged autosave", async () => {
    const repository = createSaveRepositoryCore(createInMemoryRepositoryStorage().storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository: {
        ...repository,
        readAutosave: () => Promise.reject(persistenceError("STORAGE_ABORTED", "Read failed.")),
      },
      locks,
      createId: () => "d1234567-89ab-4cde-8fab-0123456789ab",
    });
    const session = await persistence.startNewRun();
    const state = createInitialGameState({
      content: saveTestContent,
      seed: "list-storage-failure",
    });
    await persistence.save(
      {
        state,
        nextQueueSequence: 0,
        dirtyGeneration: 1,
        createdAtIso: session.createdAtIso,
        settings: session.settings,
        localStats: session.localStats,
      },
      "autosave",
    );
    await expect(persistence.listSlots?.()).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    await persistence.close();
  });

  test("recovery skips a corrupt newest autosave and preserves its exact queue sequence", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    const session = await persistence.startNewRun();
    const firstState = createInitialGameState({ content: saveTestContent, seed: "recovery-first" });
    const latestState = createInitialGameState({
      content: saveTestContent,
      seed: "recovery-latest",
    });
    const capture = (state: typeof firstState, nextQueueSequence: number) => ({
      state,
      nextQueueSequence,
      dirtyGeneration: nextQueueSequence + 1,
      createdAtIso: session.createdAtIso,
      settings: session.settings,
      localStats: session.localStats,
    });
    await persistence.save(capture(firstState, 7), "autosave");
    await persistence.save(capture(latestState, 19), "autosave");

    await controls.storage.runTransaction(["autosaves"], "readwrite", (tx) =>
      tx.put("autosaves", [session.slotId, 1], { corrupt: true }),
    );

    const candidate = await persistence.prepareLoad?.(session.slotId);
    expect(candidate).toMatchObject({
      nextQueueSequence: 7,
      checkpoint: { captureSequence: 0, sourceKind: "autosave", skippedCorruptRecords: 1 },
    });
    expect(candidate?.state).toEqual(firstState);
    const promoted = await candidate?.promote();
    expect(promoted?.slotId).toBe(session.slotId);
    await persistence.close();
  });

  test("recovery falls back to the verified manual record after corrupt autosaves", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    const session = await persistence.startNewRun();
    const autoState = createInitialGameState({ content: saveTestContent, seed: "corrupt-auto" });
    const manualState = createInitialGameState({
      content: saveTestContent,
      seed: "manual-fallback",
    });
    const capture = (state: typeof autoState, nextQueueSequence: number) => ({
      state,
      nextQueueSequence,
      dirtyGeneration: nextQueueSequence + 1,
      createdAtIso: session.createdAtIso,
      settings: session.settings,
      localStats: session.localStats,
    });
    await persistence.save(capture(manualState, 31), "manual");
    await persistence.save(capture(autoState, 32), "autosave");
    await persistence.save(capture(autoState, 33), "autosave");
    await controls.storage.runTransaction(["autosaves"], "readwrite", (tx) =>
      Promise.all([
        tx.put("autosaves", [session.slotId, 1], { corrupt: true }),
        tx.put("autosaves", [session.slotId, 2], { corrupt: true }),
      ]).then(() => undefined),
    );

    const candidate = await persistence.prepareLoad?.(session.slotId);
    expect(candidate?.state).toEqual(manualState);
    expect(candidate).toMatchObject({
      nextQueueSequence: 31,
      checkpoint: { captureSequence: 0, sourceKind: "manual", skippedCorruptRecords: 2 },
    });
    await candidate?.rollback();
    await persistence.close();
  });

  test("recovery chooses a newer manual capture before older autosaves", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "abababab-abab-4aba-8aba-abababababab",
    });
    const session = await persistence.startNewRun();
    const autoState = createInitialGameState({ content: saveTestContent, seed: "older-auto" });
    const manualState = createInitialGameState({ content: saveTestContent, seed: "newer-manual" });
    const capture = (state: typeof autoState, nextQueueSequence: number) => ({
      state,
      nextQueueSequence,
      dirtyGeneration: nextQueueSequence + 1,
      createdAtIso: session.createdAtIso,
      settings: session.settings,
      localStats: session.localStats,
    });
    await persistence.save(capture(autoState, 4), "autosave");
    await persistence.save(capture(manualState, 9), "manual");

    const newest = await persistence.prepareLoad?.(session.slotId);
    expect(newest).toMatchObject({
      state: manualState,
      nextQueueSequence: 9,
      checkpoint: { captureSequence: 1, sourceKind: "manual", skippedCorruptRecords: 0 },
    });
    await newest?.rollback();

    await persistence.save(capture(autoState, 12), "autosave");
    await controls.storage.runTransaction(["autosaves"], "readwrite", (tx) =>
      tx.put("autosaves", [session.slotId, 2], { corrupt: true }),
    );
    const fallback = await persistence.prepareLoad?.(session.slotId);
    expect(fallback).toMatchObject({
      state: manualState,
      nextQueueSequence: 9,
      checkpoint: { captureSequence: 1, sourceKind: "manual", skippedCorruptRecords: 1 },
    });
    await fallback?.rollback();
    await persistence.close();
  });

  test("a damaged newest manual record remains stored while an older autosave stays listable", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
    });
    const session = await persistence.startNewRun();
    const state = createInitialGameState({ content: saveTestContent, seed: "damaged-manual" });
    const capture = (nextQueueSequence: number) => ({
      state,
      nextQueueSequence,
      dirtyGeneration: nextQueueSequence + 1,
      createdAtIso: session.createdAtIso,
      settings: session.settings,
      localStats: session.localStats,
    });
    await persistence.save(capture(5), "autosave");
    await persistence.save(capture(8), "manual");
    await controls.storage.runTransaction(["saves"], "readwrite", (tx) =>
      tx.put("saves", session.slotId, { corrupt: true }),
    );

    await expect(persistence.listSlots?.()).resolves.toMatchObject([
      { slotId: session.slotId, revision: 3 },
    ]);
    const recovered = await persistence.prepareLoad?.(session.slotId);
    expect(recovered).toMatchObject({
      nextQueueSequence: 5,
      checkpoint: { captureSequence: 0, sourceKind: "autosave", skippedCorruptRecords: 1 },
    });
    await recovered?.rollback();
    await expect(
      controls.storage.runTransaction(["saves"], "readonly", (tx) =>
        tx.get("saves", session.slotId),
      ),
    ).resolves.toEqual({ corrupt: true });
    await persistence.close();
  });

  test("a committed import reports success without a post-commit record read", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    let failManualReads = false;
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository: {
        ...repository,
        readManualSave(slotId, signal) {
          if (failManualReads) {
            throw persistenceError("STORAGE_ABORTED", "Read failed after import commit.");
          }
          return repository.readManualSave(slotId, signal);
        },
      },
      locks,
      createId: () => "dededede-dede-4ede-8ede-dededededede",
    });
    const session = await persistence.startNewRun();
    const state = createInitialGameState({ content: saveTestContent, seed: "import-post-commit" });
    await persistence.save(
      {
        state,
        nextQueueSequence: 6,
        dirtyGeneration: 1,
        createdAtIso: session.createdAtIso,
        settings: session.settings,
        localStats: session.localStats,
      },
      "manual",
    );
    const source = await repository.readManualSave(session.slotId);
    const preview = await persistence.previewImport?.(encodeEnvelopeBytes(source.envelope));
    expect(preview?.token).not.toBeNull();
    failManualReads = true;

    const confirmation = await persistence.confirmImport?.(preview?.token ?? "", {
      expectedRevision: undefined,
      applySettings: false,
    });
    expect(confirmation).toMatchObject({ tick: state.tick, appliedSettings: false });
    expect(confirmation?.slotId).not.toBe(session.slotId);
    expect(await repository.readManualSave(confirmation?.slotId ?? "")).toBeDefined();
    await persistence.close();
  });

  test("a full set of durable slots still permits startup and deletion before the next save", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const lockManager = createInMemoryLockManager();
    let nextId = 0;
    const createPersistence = () =>
      createWorkerSavePersistence({
        content: saveTestContent,
        repository,
        locks: createWebLockAdapter({ locks: lockManager.createClient() }),
        createId: () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`,
      });
    const state = createInitialGameState({ content: saveTestContent, seed: "full-slot-set" });
    const capture = (
      session: Awaited<ReturnType<ReturnType<typeof createPersistence>["startNewRun"]>>,
    ) => ({
      state,
      nextQueueSequence: 0,
      dirtyGeneration: 1,
      createdAtIso: session.createdAtIso,
      settings: session.settings,
      localStats: session.localStats,
    });
    for (let index = 0; index < MAX_ORDINARY_SLOT_COUNT; index += 1) {
      const persistence = createPersistence();
      const session = await persistence.startNewRun();
      await persistence.save(capture(session), "manual");
      await persistence.close();
    }

    const persistence = createPersistence();
    const session = await persistence.startNewRun();
    const slots = await persistence.listSlots?.();
    expect(slots).toHaveLength(MAX_ORDINARY_SLOT_COUNT);
    await expect(persistence.save(capture(session), "manual")).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
    const oldSlot = slots?.[0];
    if (oldSlot === undefined) throw new Error("Expected one deletable old slot.");
    await persistence.deleteSlot?.(oldSlot.slotId, oldSlot.revision);
    await expect(persistence.save(capture(session), "manual")).resolves.toMatchObject({
      slotId: session.slotId,
    });
    await persistence.close();
  });

  test("all-corrupt recovery leaves the current writer available", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const locks = createWebLockAdapter({ locks: createInMemoryLockManager().createClient() });
    const persistence = createWorkerSavePersistence({
      content: saveTestContent,
      repository,
      locks,
      createId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    const session = await persistence.startNewRun();
    const state = createInitialGameState({ content: saveTestContent, seed: "all-corrupt" });
    await persistence.save(
      {
        state,
        nextQueueSequence: 0,
        dirtyGeneration: 1,
        createdAtIso: session.createdAtIso,
        settings: session.settings,
        localStats: session.localStats,
      },
      "autosave",
    );
    await controls.storage.runTransaction(["autosaves"], "readwrite", (tx) =>
      tx.put("autosaves", [session.slotId, 0], { corrupt: true }),
    );

    await expect(persistence.prepareLoad?.(session.slotId)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(
      persistence.save(
        {
          state,
          nextQueueSequence: 5,
          dirtyGeneration: 2,
          createdAtIso: session.createdAtIso,
          settings: session.settings,
          localStats: session.localStats,
        },
        "manual",
      ),
    ).resolves.toMatchObject({ slotId: session.slotId });
    await persistence.close();
  });
});
