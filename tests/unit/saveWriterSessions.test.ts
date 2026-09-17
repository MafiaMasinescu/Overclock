import { describe, expect, test } from "vitest";

import { PersistenceError } from "../../src/save/persistenceErrors.ts";
import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import {
  deleteInactiveSlot,
  isSlotBusy,
  openWriterSession,
} from "../../src/save/repository/slots.ts";
import { createInMemoryRepositoryStorage } from "../../src/save/repository/storage.ts";
import {
  createInMemoryLockManager,
  createWebLockAdapter,
  slotLockName,
} from "../../src/save/repository/webLocks.ts";
import { preparedPair } from "./saveTestFixtures.ts";

describe("writer exclusion with web locks", () => {
  test("lock names are namespaced per slot and validated", () => {
    expect(slotLockName("slot-alpha")).toBe("overclock-slot:slot-alpha");
    expect(() => slotLockName("SLOT_ALPHA")).toThrow(PersistenceError);
  });

  test("a missing capability fails instead of falling back", async () => {
    const adapter = createWebLockAdapter({ locks: null });
    expect(adapter.available).toBe(false);
    await expect(adapter.acquire("slot-alpha")).rejects.toMatchObject({
      code: "STORAGE_ABORTED",
    });
  });

  test("acquire and release grant the same name again", async () => {
    const manager = createInMemoryLockManager();
    const adapter = createWebLockAdapter({ locks: manager.createClient() });
    expect(adapter.available).toBe(true);
    const first = await adapter.acquire("slot-alpha");
    if (isSlotBusy(first)) throw new Error("expected a granted lock");
    expect(first.name).toBe("overclock-slot:slot-alpha");
    await first.release();
    const second = await adapter.acquire("slot-alpha");
    if (isSlotBusy(second)) throw new Error("expected a granted lock after release");
    await second.release();
  });

  test("a second tab gets busy while reads stay available", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manager = createInMemoryLockManager();
    const tabA = createWebLockAdapter({ locks: manager.createClient() });
    const tabB = createWebLockAdapter({ locks: manager.createClient() });

    const sessionA = await openWriterSession(repository, tabA, "slot-alpha");
    if (isSlotBusy(sessionA)) throw new Error("expected tab A to hold the lock");
    expect(sessionA.writerEpoch).toBe(1);

    const busy = await openWriterSession(repository, tabB, "slot-alpha", { ifAvailable: true });
    expect(isSlotBusy(busy)).toBe(true);

    // Reads never take the lock: the busy tab still lists and reads.
    await expect(repository.listSlots()).resolves.toHaveLength(1);
    await expect(repository.readSlotMeta("slot-alpha")).resolves.toMatchObject({
      writerEpoch: 1,
    });

    const prepared = await preparedPair("slot-alpha");
    const meta = await sessionA.writeManual(prepared);
    expect(meta.revision).toBe(2);
    expect(sessionA.currentRevision()).toBe(2);
    await sessionA.close();

    const sessionB = await openWriterSession(repository, tabB, "slot-alpha", {
      ifAvailable: true,
    });
    if (isSlotBusy(sessionB)) throw new Error("expected tab B to acquire after release");
    expect(sessionB.writerEpoch).toBe(2);
    await sessionB.close();
  });

  test("a lock lost to tab death can be taken over; old writes go stale", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manager = createInMemoryLockManager();
    const clientA = manager.createClient();
    const clientB = manager.createClient();
    const tabA = createWebLockAdapter({ locks: clientA });
    const tabB = createWebLockAdapter({ locks: clientB });

    const sessionA = await openWriterSession(repository, tabA, "slot-alpha");
    if (isSlotBusy(sessionA)) throw new Error("expected tab A to hold the lock");
    // Tab A dies without closing its session: the platform frees the lock.
    clientA.close();

    const sessionB = await openWriterSession(repository, tabB, "slot-alpha", {
      ifAvailable: true,
    });
    if (isSlotBusy(sessionB)) throw new Error("expected takeover after tab death");
    expect(sessionB.writerEpoch).toBe(2);

    // The dead session still thinks it is open, but its epoch is stale.
    const prepared = await preparedPair("slot-alpha");
    await expect(sessionA.writeManual(prepared)).rejects.toMatchObject({ code: "STALE_WRITER" });
    const latest = await sessionB.writeManual(prepared);
    expect(latest.revision).toBe(3);
    await sessionB.close();
  });

  test("a queued waiter is granted after release", async () => {
    const manager = createInMemoryLockManager();
    const adapter = createWebLockAdapter({ locks: manager.createClient() });
    const first = await adapter.acquire("slot-alpha");
    if (isSlotBusy(first)) throw new Error("expected a granted lock");
    let granted = false;
    const waiting = adapter.acquire("slot-alpha").then((handle) => {
      granted = true;
      return handle;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    await first.release();
    const second = await waiting;
    if (isSlotBusy(second)) throw new Error("expected the waiter to be granted");
    expect(granted).toBe(true);
    await second.release();
  });

  test("an aborted queued request reports cancellation", async () => {
    const manager = createInMemoryLockManager();
    const adapter = createWebLockAdapter({ locks: manager.createClient() });
    const first = await adapter.acquire("slot-alpha");
    if (isSlotBusy(first)) throw new Error("expected a granted lock");
    const controller = new AbortController();
    const waiting = adapter.acquire("slot-alpha", { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
    await first.release();
  });

  test("opening on a missing slot releases the lock and reports", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    const manager = createInMemoryLockManager();
    const adapter = createWebLockAdapter({ locks: manager.createClient() });
    await expect(openWriterSession(repository, adapter, "slot-ghost")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    // The orphaned lock was released: a later slot can bind it.
    await repository.createSlot("slot-ghost", 0);
    const session = await openWriterSession(repository, adapter, "slot-ghost");
    if (isSlotBusy(session)) throw new Error("expected the lock to be free again");
    await session.close();
  });

  test("refresh recovers a session after a concurrent preview-time write", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manager = createInMemoryLockManager();
    const adapter = createWebLockAdapter({ locks: manager.createClient() });
    const session = await openWriterSession(repository, adapter, "slot-alpha");
    if (isSlotBusy(session)) throw new Error("expected a session");
    // A concurrent writer (preview-time revision R) commits first.
    const winner = await preparedPair("slot-alpha", { seedSuffix: "-winner" });
    await repository.writeManualSave("slot-alpha", winner, {
      expectedRevision: session.currentRevision(),
      expectedWriterEpoch: session.writerEpoch,
    });
    await session.refresh();
    const prepared = await preparedPair("slot-alpha", { seedSuffix: "-loser" });
    const meta = await session.writeManual(prepared);
    expect(meta.revision).toBe(3);
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.preview.savedAtIso).toBe(prepared.preview.savedAtIso);
    await session.close();
  });

  test("a direct stale write keeps the winner intact", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const winner = await preparedPair("slot-alpha", { seedSuffix: "-winner" });
    await repository.writeManualSave("slot-alpha", winner, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const loser = await preparedPair("slot-alpha", { seedSuffix: "-loser" });
    await expect(
      repository.writeManualSave("slot-alpha", loser, {
        expectedRevision: 0,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const stored = await repository.readManualSave("slot-alpha");
    expect(stored.envelope.checksum).toBe(winner.envelope.checksum);
  });

  test("delete rollback preserves the slot and its rotations", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manual = await preparedPair("slot-alpha", { seedSuffix: "-manual" });
    await repository.writeManualSave("slot-alpha", manual, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    const auto = await preparedPair("slot-alpha", { seedSuffix: "-auto" });
    await repository.writeAutosave("slot-alpha", auto, {
      expectedRevision: 1,
      expectedWriterEpoch: 0,
    });
    controls.failNextCommitWithAbort();
    await expect(
      repository.deleteSlot("slot-alpha", { expectedRevision: 2, expectedWriterEpoch: 0 }),
    ).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    await expect(repository.readManualSave("slot-alpha")).resolves.toMatchObject({
      captureSequence: 0,
    });
    await expect(repository.listAutosaves("slot-alpha")).resolves.toHaveLength(1);
    await expect(repository.readSlotMeta("slot-alpha")).resolves.toMatchObject({ revision: 2 });
  });

  test("inactive-slot deletion refuses a lock held by another tab", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manager = createInMemoryLockManager();
    const owner = createWebLockAdapter({ locks: manager.createClient() });
    const deleter = createWebLockAdapter({ locks: manager.createClient() });
    const handle = await owner.acquire("slot-alpha");
    if (isSlotBusy(handle)) throw new Error("Expected the owner lock.");
    await expect(
      deleteInactiveSlot(repository, deleter, "slot-alpha", { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "SLOT_BUSY" });
    await expect(repository.readSlotMeta("slot-alpha")).resolves.toMatchObject({ revision: 0 });
    await handle.release();
    await expect(
      deleteInactiveSlot(repository, deleter, "slot-alpha", { expectedRevision: 0 }),
    ).resolves.toBeUndefined();
    await expect(repository.readSlotMeta("slot-alpha")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("a closed connection refuses mutations without losing data", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const prepared = await preparedPair("slot-alpha");
    await repository.writeManualSave("slot-alpha", prepared, {
      expectedRevision: 0,
      expectedWriterEpoch: 0,
    });
    // versionchange analogue: the connection closes and blocks mutations
    // until the owner reopens.
    controls.storage.close();
    await expect(
      repository.writeManualSave("slot-alpha", prepared, {
        expectedRevision: 1,
        expectedWriterEpoch: 0,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
  });

  test("a closed session refuses further writes", async () => {
    const controls = createInMemoryRepositoryStorage();
    const repository = createSaveRepositoryCore(controls.storage);
    await repository.createSlot("slot-alpha", 0);
    const manager = createInMemoryLockManager();
    const adapter = createWebLockAdapter({ locks: manager.createClient() });
    const session = await openWriterSession(repository, adapter, "slot-alpha");
    if (isSlotBusy(session)) throw new Error("expected a session");
    await session.close();
    const prepared = await preparedPair("slot-alpha");
    await expect(session.writeManual(prepared)).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
  });
});
