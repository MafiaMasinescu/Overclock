import { describe, expect, test } from "vitest";

import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import { createInMemoryRepositoryStorage } from "../../src/save/repository/storage.ts";
import { createPayload, preparedPair, previewFor, saveTestContent } from "./saveTestFixtures.ts";
import { encodeSaveEnvelope } from "../../src/save/codec.ts";

describe("autosave three-rotation", () => {
  test("a fresh slot has no generations and no recovery locator", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    await expect(repository.listAutosaves("slot-alpha")).resolves.toEqual([]);
    await expect(repository.getLatestRecovery("slot-alpha")).resolves.toBeNull();
  });

  test.each([1, 2, 3])("retains all generations when %i captures succeed", async (captures) => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    for (let revision = 0; revision < captures; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      const result = await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
      expect(result.prunedCaptureSequences).toEqual([]);
      expect(result.meta.nextCaptureSequence).toBe(revision + 1);
    }
    const generations = await repository.listAutosaves("slot-alpha");
    expect(generations.map((generation) => generation.captureSequence)).toEqual(
      [...Array(captures).keys()].reverse(),
    );
  });

  test("the fourth capture prunes the oldest generation", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    let pruned: readonly number[] = [];
    for (let revision = 0; revision < 4; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      const result = await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
      pruned = result.prunedCaptureSequences;
    }
    expect(pruned).toEqual([0]);
    const generations = await repository.listAutosaves("slot-alpha");
    expect(generations.map((generation) => generation.captureSequence)).toEqual([3, 2, 1]);
    const locator = await repository.getLatestRecovery("slot-alpha");
    expect(locator).toEqual({ kind: "autosave", captureSequence: 3 });
  });

  test("the fifth capture keeps exactly the newest three", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    for (let revision = 0; revision < 5; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
    }
    const generations = await repository.listAutosaves("slot-alpha");
    expect(generations.map((generation) => generation.captureSequence)).toEqual([4, 3, 2]);
    await expect(repository.readAutosave("slot-alpha", 0)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(repository.readAutosave("slot-alpha", 4)).resolves.toMatchObject({
      captureSequence: 4,
    });
  });

  test("a failed insert preserves prior rotations and metadata", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    for (let revision = 0; revision < 3; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
    }
    controls.failNextCommitWithAbort();
    const attempt = await preparedPair("slot-alpha", { seedSuffix: "-auto-3" });
    await expect(
      repository.writeAutosave("slot-alpha", attempt, {
        expectedRevision: 3,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    const generations = await repository.listAutosaves("slot-alpha");
    expect(generations.map((generation) => generation.captureSequence)).toEqual([2, 1, 0]);
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(3);
    expect(meta.nextCaptureSequence).toBe(3);
    expect(meta.latestRecovery).toEqual({ kind: "autosave", captureSequence: 2 });
  });

  test("manual saves stay independent of the rotation", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manual = await preparedPair("slot-alpha", { seedSuffix: "-manual" });
    const manualMeta = await repository.writeManualSave("slot-alpha", manual, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    expect(manualMeta.latestRecovery).toEqual({ kind: "manual", captureSequence: 0 });
    for (let revision = 1; revision <= 4; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
    }
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.captureSequence).toBe(0);
    expect(stored.envelope.checksum).toBe(manual.envelope.checksum);
    const generations = await repository.listAutosaves("slot-alpha");
    expect(generations.map((generation) => generation.captureSequence)).toEqual([4, 3, 2]);
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.nextCaptureSequence).toBe(5);
    expect(meta.latestRecovery).toEqual({ kind: "autosave", captureSequence: 4 });
  });

  test("recovery follows capture sequence, not wall-clock timestamps", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    // The manual save carries the newest timestamp but the oldest sequence.
    const manualPayload = createPayload("slot-alpha", { savedAtIso: "2026-09-17T12:00:00.000Z" });
    const manualEncoded = await encodeSaveEnvelope(manualPayload, {
      content: saveTestContent,
      compression: "none",
    });
    await repository.writeManualSave(
      "slot-alpha",
      { envelope: manualEncoded.envelope, preview: previewFor(manualPayload, "slot-alpha") },
      { expectedRevision: 0, expectedWriterEpoch: 0 },
    );
    // The autosave is older by the wall clock but newer by sequence.
    const autoPayload = createPayload("slot-alpha", { savedAtIso: "2026-09-17T09:00:00.000Z" });
    const autoEncoded = await encodeSaveEnvelope(autoPayload, {
      content: saveTestContent,
      compression: "none",
    });
    const result = await repository.writeAutosave(
      "slot-alpha",
      { envelope: autoEncoded.envelope, preview: previewFor(autoPayload, "slot-alpha") },
      { expectedRevision: 1, expectedWriterEpoch: 0 },
    );
    expect(result.meta.latestRecovery).toEqual({ kind: "autosave", captureSequence: 1 });
    const locator = await repository.getLatestRecovery("slot-alpha");
    expect(locator?.captureSequence).toBe(1);
  });

  test("autosave writes fence on revision and epoch", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await expect(
      repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: 9,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    await repository.rotateWriterEpoch("slot-alpha", 0);
    await expect(
      repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: 1,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({ code: "STALE_WRITER" });
    await expect(repository.listAutosaves("slot-alpha")).resolves.toEqual([]);
  });

  test("per-slot isolation keeps other slots untouched", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    await repository.createSlot("slot-beta", 0);
    for (let revision = 0; revision < 4; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
    }
    await expect(repository.listAutosaves("slot-beta")).resolves.toEqual([]);
    await expect(repository.getLatestRecovery("slot-beta")).resolves.toBeNull();
  });
});
