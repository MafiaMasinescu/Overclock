import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { exportSlot } from "../../src/save/export/exportService.ts";
import { createImportService } from "../../src/save/import/importService.ts";
import { admitLoadedSave } from "../../src/save/load/loadAdmission.ts";
import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import { createInMemoryRepositoryStorage } from "../../src/save/repository/storage.ts";
import {
  createInMemoryLockManager,
  createWebLockAdapter,
} from "../../src/save/repository/webLocks.ts";
import { preparedPair } from "./saveTestFixtures.ts";

const content = loadContentBundle();

function setupSlot() {
  const controls = createInMemoryRepositoryStorage();
  const repository = createSaveRepositoryCore(controls.storage);
  return { controls, repository };
}

describe("slot export", () => {
  test("exports verified bytes without touching stored state", async () => {
    const { controls, repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const writesBefore = controls.committedWriteCount();
    const first = await exportSlot(repository, "slot-alpha", { content, expectedRevision: 1 });
    const second = await exportSlot(repository, "slot-alpha", { content });
    expect(first.bytes).toEqual(second.bytes);
    expect(first.captureSequence).toBe(0);
    expect(first.revision).toBe(1);
    expect(first.envelope.checksum).toBe(prepared.envelope.checksum);
    // Pure read path: no write committed, stored generation identical.
    expect(controls.committedWriteCount()).toBe(writesBefore);
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.envelope.checksum).toBe(prepared.envelope.checksum);
    expect(stored.preview.savedAtIso).toBe(prepared.preview.savedAtIso);
  });

  test("refuses a stale expected revision", async () => {
    const { repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    await expect(
      exportSlot(repository, "slot-alpha", { content, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  test("reports a missing slot", async () => {
    const { repository } = setupSlot();
    await expect(exportSlot(repository, "slot-ghost", { content })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("exported bytes re-import as compatible", async () => {
    const { repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const exported = await exportSlot(repository, "slot-alpha", { content });
    const importer = createImportService({
      repository,
      locks: createWebLockAdapter({ locks: createInMemoryLockManager().createClient() }),
      loadContent: () => loadContentBundle(),
      generateSlotId: () => "slot-reimported",
    });
    const previewed = await importer.previewImport({ bytes: exported.bytes });
    expect(previewed.preview.compatibility).toBe("compatible");
    const confirmed = await importer.confirmImport(previewed.token ?? "");
    expect(confirmed.slotId).toBe("slot-reimported");
  });
});

describe("load admission", () => {
  test("admits a manual save as an isolated candidate", async () => {
    const { controls, repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const writesBefore = controls.committedWriteCount();
    const candidate = await admitLoadedSave(repository, "slot-alpha", {
      content: loadContentBundle(),
    });
    expect(candidate.slotId).toBe("slot-alpha");
    expect(candidate.sourceKind).toBe("manual");
    expect(candidate.captureSequence).toBe(0);
    expect(candidate.nextQueueSequence).toBe(0);
    expect(candidate.gameState.tick).toBe(0);
    expect(candidate.payload.slotId).toBe("slot-alpha");
    // No live mutation and no store write.
    expect(controls.committedWriteCount()).toBe(writesBefore);
    const meta = await repository.readSlotMeta("slot-alpha");
    expect(meta.revision).toBe(1);
  });

  test("admits an autosave generation by sequence", async () => {
    const { repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    for (let revision = 0; revision < 2; revision += 1) {
      const prepared = await preparedPair("slot-alpha", { seedSuffix: `-auto-${revision}` });
      await repository.writeAutosave("slot-alpha", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
    }
    const candidate = await admitLoadedSave(repository, "slot-alpha", {
      content: loadContentBundle(),
      captureSequence: 0,
    });
    expect(candidate.sourceKind).toBe("autosave");
    expect(candidate.captureSequence).toBe(0);
    await expect(
      admitLoadedSave(repository, "slot-alpha", {
        content: loadContentBundle(),
        captureSequence: 7,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  test("rejects incompatible content", async () => {
    const { repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const bundle = loadContentBundle();
    await expect(
      admitLoadedSave(repository, "slot-alpha", {
        content: { ...bundle, contentVersion: "9.9.9-future" },
      }),
    ).rejects.toMatchObject({ code: "INCOMPATIBLE_CONTENT" });
  });

  test("detects a corrupted stored checksum", async () => {
    const { controls, repository } = setupSlot();
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    // Corrupt the committed envelope behind the repository's back.
    await controls.storage.runTransaction(["saves"], "readwrite", (tx) =>
      tx.get("saves", "slot-alpha").then((value) => {
        const record = value as {
          envelope: { checksum: string };
          preview: unknown;
          slotId: string;
          captureSequence: number;
          revision: number;
        };
        return tx.put("saves", "slot-alpha", {
          ...record,
          envelope: {
            ...record.envelope,
            checksum: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        });
      }),
    );
    await expect(
      admitLoadedSave(repository, "slot-alpha", { content: loadContentBundle() }),
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });
});
