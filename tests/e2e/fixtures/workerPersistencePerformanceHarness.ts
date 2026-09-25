import { createWorkerGameClient } from "../../../src/app/game-client/workerGameClient.ts";
import { loadContentBundle } from "../../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../../src/sim/core/createInitialGameState.ts";
import { createWorkerSavePersistence } from "../../../src/app/worker/savePersistence.ts";
import { openOverclockDatabase } from "../../../src/save/repository/indexedDb.ts";
import { createSaveRepositoryCore } from "../../../src/save/repository/repository.ts";
import { createWebLockAdapter } from "../../../src/save/repository/webLocks.ts";
import { createWorkerNFixture } from "../../performance/workerNFixture.ts";

interface Cohort {
  readonly samples: number;
  readonly warmup: number;
  readonly bytes: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
}

interface PersistencePerformanceResult {
  readonly userAgent: string;
  readonly hardwareConcurrency: number;
  readonly saveN: Cohort;
  readonly autosaveN: Cohort;
  readonly loadN: Cohort;
  readonly previewN: Cohort;
  readonly confirmN: Cohort;
  readonly recoveryN: Cohort;
}

declare global {
  interface Window {
    __workerPersistencePerformance?: {
      run(): Promise<PersistencePerformanceResult>;
      stage?: string;
      result?: PersistencePerformanceResult;
      error?: string;
    };
  }
}

const SAMPLES = 200;
const WARMUP = 20;
const RECOVERY_SAMPLES = 50;
const RECOVERY_WARMUP = 5;
let currentStage = "content and database setup";

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function cohort(values: readonly number[], warmup: number, bytes: number): Cohort {
  return {
    samples: values.length,
    warmup,
    bytes,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maximumMs: Math.max(...values),
  };
}

async function run(): Promise<PersistencePerformanceResult> {
  const content = loadContentBundle();
  const storage = await openOverclockDatabase();
  const repository = createSaveRepositoryCore(storage);
  const locks = createWebLockAdapter();
  const seedPersistence = createWorkerSavePersistence({ content, repository, locks });
  const normalSession = await seedPersistence.startNewRun();
  currentStage = "seed normal N fixture";
  const normalState = createWorkerNFixture("task20-persistence-normal", content);
  const normalSlot = normalSession.slotId;
  await seedPersistence.save(
    {
      state: normalState,
      nextQueueSequence: 0,
      dirtyGeneration: 1,
      createdAtIso: normalSession.createdAtIso,
      settings: normalSession.settings,
      localStats: normalSession.localStats,
    },
    "manual",
  );
  await seedPersistence.close();

  const targetPersistence = createWorkerSavePersistence({ content, repository, locks });
  currentStage = "seed import destination";
  const targetSession = await targetPersistence.startNewRun();
  const targetState = createInitialGameState({ content, seed: "task20-import-destination" });
  await targetPersistence.save(
    {
      state: targetState,
      nextQueueSequence: 0,
      dirtyGeneration: 1,
      createdAtIso: targetSession.createdAtIso,
      settings: targetSession.settings,
      localStats: targetSession.localStats,
    },
    "manual",
  );
  const targetSlot = targetSession.slotId;
  await targetPersistence.close();
  storage.close();

  let client = await createWorkerGameClient({
    content,
    seed: "task20-persistence-client",
    epoch: "task20-persistence-client",
  });
  currentStage = "initial load N fixture";
  await client.loadSlot(normalSlot);

  const saveValues: number[] = [];
  let saveBytes = 0;
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    currentStage = `manual save N ${index + 1}/${WARMUP + SAMPLES}`;
    const startedAt = performance.now();
    const metadata = await client.requestSave("manual");
    if (index >= WARMUP) saveValues.push(performance.now() - startedAt);
    saveBytes = metadata.sizeBytes;
  }

  const autosaveValues: number[] = [];
  let autosavePaused = client.getSnapshot().header.paused;
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    currentStage = `autosave pause command ${index + 1}/${WARMUP + SAMPLES}`;
    autosavePaused = !autosavePaused;
    await client.setPaused(autosavePaused);
    currentStage = `autosave N ${index + 1}/${WARMUP + SAMPLES}`;
    const startedAt = performance.now();
    const metadata = await client.requestSave("autosave");
    if (index >= WARMUP) autosaveValues.push(performance.now() - startedAt);
    saveBytes = metadata.sizeBytes;
  }

  const loadValues: number[] = [];
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    currentStage = `load N ${index + 1}/${WARMUP + SAMPLES}`;
    const startedAt = performance.now();
    await client.loadSlot(normalSlot);
    if (index >= WARMUP) loadValues.push(performance.now() - startedAt);
  }

  const slotsBeforeImport = await client.listSlots();
  const normalSummary = slotsBeforeImport.find((slot) => slot.slotId === normalSlot);
  const targetSummary = slotsBeforeImport.find((slot) => slot.slotId === targetSlot);
  if (normalSummary === undefined || targetSummary === undefined) {
    throw new Error("Normal save or inactive import destination is missing from the slot list.");
  }
  const sourceBytes = await client.exportSlot(normalSlot, normalSummary.revision);
  const importBytes = new Uint8Array(sourceBytes).slice().buffer;
  const previewValues: number[] = [];
  const confirmValues: number[] = [];
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    currentStage = `preview import N ${index + 1}/${WARMUP + SAMPLES}`;
    const destination = { kind: "overwrite" as const, slotId: targetSlot };
    const previewStartedAt = performance.now();
    const preview = await client.previewImport(importBytes, destination);
    if (preview.token === null) throw new Error("Normal fixture import did not produce a token.");
    if (index >= WARMUP) previewValues.push(performance.now() - previewStartedAt);
    const currentDestination = (await client.listSlots()).find(
      (slot) => slot.slotId === targetSlot,
    );
    if (currentDestination === undefined) throw new Error("Import destination disappeared.");
    currentStage = `confirm import N ${index + 1}/${WARMUP + SAMPLES}`;
    const confirmStartedAt = performance.now();
    await client.confirmImport(preview.token, destination, currentDestination.revision, false);
    if (index >= WARMUP) confirmValues.push(performance.now() - confirmStartedAt);
  }

  const recoveryValues: number[] = [];
  client.destroy();
  for (let index = 0; index < RECOVERY_WARMUP + RECOVERY_SAMPLES; index += 1) {
    currentStage = `cold recovery N ${index + 1}/${RECOVERY_WARMUP + RECOVERY_SAMPLES}`;
    const startedAt = performance.now();
    client = await createWorkerGameClient({
      content,
      seed: `task20-persistence-recovery-${index}`,
      epoch: `task20-recovery-${index}`,
      recoverSlotId: normalSlot,
    });
    if (client.getRecoverySummary()?.slotId !== normalSlot) {
      throw new Error("Recovery did not publish the normal saved slot summary.");
    }
    if (index >= RECOVERY_WARMUP) recoveryValues.push(performance.now() - startedAt);
    client.destroy();
  }

  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    saveN: cohort(saveValues, WARMUP, saveBytes),
    autosaveN: cohort(autosaveValues, WARMUP, saveBytes),
    loadN: cohort(loadValues, WARMUP, saveBytes),
    previewN: cohort(previewValues, WARMUP, sourceBytes.byteLength),
    confirmN: cohort(confirmValues, WARMUP, sourceBytes.byteLength),
    recoveryN: cohort(recoveryValues, RECOVERY_WARMUP, saveBytes),
  };
}

window.__workerPersistencePerformance = {
  run,
  get stage() {
    return currentStage;
  },
};
