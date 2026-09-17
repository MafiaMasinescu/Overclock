import { cpus } from "node:os";

import { assertValidBlueprintState } from "../../src/sim/blueprints/blueprintState.ts";
import { encodeSaveEnvelope } from "../../src/save/codec.ts";
import type { SaveEnvelope, SavePayloadV1, SavePreview } from "../../src/save/contracts.ts";
import { createImportService } from "../../src/save/import/importService.ts";
import { createSaveRepositoryCore } from "../../src/save/repository/repository.ts";
import { createInMemoryRepositoryStorage } from "../../src/save/repository/storage.ts";
import {
  createInMemoryLockManager,
  createWebLockAdapter,
} from "../../src/save/repository/webLocks.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { createTask9PerformanceFixture, thermalPerformanceContent } from "./thermalFixture.ts";

// Phase 2 Task 17.4 persistent repository diagnostic. Preparation
// (canonical encode) and commit (transaction) are measured separately and
// end to end, on the in-memory storage boundary; Chromium evidence for the
// real IndexedDB path lives in tests/e2e/repositoryFaults.spec.ts, which
// attaches per-scenario durations to its report.

const content = thermalPerformanceContent;

function createDenseActiveState(seed: string) {
  const state = createTask9PerformanceFixture(seed);
  const service = state.tasks.instances["task-9-bandwidth"];
  if (service === undefined) throw new Error("Repository fixture lacks its active service Task.");
  state.tasks.instances[service.id] = { ...service, serviceWindowCompliant: true };
  state.research.researchData = 1_000_000;
  state.economy.cashUsd = 1_000_000;
  const core = createProductionSimCore({ content, initialState: state });
  core.enqueue({
    commandId: "71000000-0000-4000-8000-000000000001",
    source: "player",
    kind: "START_RESEARCH",
    nodeId: "research-stable-power-distribution",
    reservedComputeShare: 0.1,
  });
  const result = core.processPendingCommands()[0];
  if (result?.accepted !== true) throw new Error("Repository fixture could not start Research.");
  core.step(1);
  return core.getStateForSave();
}

function createPayload(blueprintCount: number, seed: string): SavePayloadV1 {
  const state = createDenseActiveState(seed);
  if (blueprintCount > 0) {
    const records: Record<string, SavePayloadV1["gameState"]["blueprints"]["records"][string]> = {};
    for (let index = 1; index <= blueprintCount; index += 1) {
      const id = `blueprint-${index.toString().padStart(8, "0")}`;
      records[id] = {
        id,
        name: `Stress Blueprint ${index}`,
        version: 1,
        kind: "subassembly",
        contentVersion: content.contentVersion,
        modules: [
          {
            localId: "module-0001",
            definitionId: "module-vacuum-tube-logic",
            relativePosition: { x: 0, y: 0 },
            rotation: 0,
            defaultOverclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
          },
        ],
        routes: [],
        requiredResearchIds: [],
        bounds: { width: 1, height: 1 },
        summary: {
          theoreticalComputeFlops: 10,
          peakPowerWatts: 20,
          estimatedMaxTemperatureC: 22,
          estimatedCostUsd: 100,
        },
      };
    }
    state.blueprints = { nextBlueprintSequence: blueprintCount + 1, records };
    assertValidBlueprintState(state.blueprints);
  }
  return {
    schemaVersion: 1,
    saveVersion: 1,
    contentVersion: content.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    createdAtIso: "2026-09-17T10:00:00.000Z",
    savedAtIso: "2026-09-17T10:00:01.000Z",
    slotId: "save-performance",
    gameState: state,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence: 0,
      pendingCommandCount: 0,
      stateHash: hashCanonicalState(state),
    },
    settings: {
      language: "en",
      telemetryPreset: "standard",
      reducedEffects: false,
      reducedMotion: false,
      frameCap: 60,
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
}

function previewFor(payload: SavePayloadV1, slotId: string): SavePreview {
  return {
    sourceSchemaVersion: 1,
    sourceSaveVersion: 1,
    contentVersion: payload.contentVersion,
    simulatedYear: payload.gameState.campaign.currentYear,
    tick: payload.gameState.tick,
    cashUsd: payload.gameState.economy.cashUsd,
    verticalSliceCompleted: payload.gameState.campaign.verticalSliceCompleted,
    savedAtIso: payload.savedAtIso,
    migrationRequired: false,
    compatibility: "compatible",
    destinationSuggestion: { kind: "new-slot" },
    compressedBytes: 100,
    uncompressedBytes: 200,
    slotId,
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function report(
  fixture: string,
  operation: string,
  samples: number,
  warmup: number,
  bytes: number,
  values: readonly number[],
): void {
  console.log(
    JSON.stringify({
      fixture,
      operation,
      samples,
      warmup,
      bytes,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maximumMs: Math.max(...values),
    }),
  );
}

async function preparedInput(
  payload: SavePayloadV1,
): Promise<{ envelope: SaveEnvelope; preview: SavePreview; bytes: Uint8Array }> {
  const encoded = await encodeSaveEnvelope(payload, { content, compression: "none" });
  return {
    envelope: encoded.envelope,
    preview: previewFor(payload, "save-performance"),
    bytes: encoded.bytes,
  };
}

async function measureFixture(
  fixture: string,
  blueprintCount: number,
  samples: number,
  warmup: number,
): Promise<void> {
  const controls = createInMemoryRepositoryStorage();
  const repository = createSaveRepositoryCore(controls.storage);
  await repository.createSlot("save-performance", 0);
  const payload = createPayload(blueprintCount, `repository-${fixture}`);

  // Warm-up outside timed samples; fixture construction stays outside too.
  for (let index = 0; index < warmup; index += 1) {
    const prepared = await preparedInput(payload);
    await encodeSaveEnvelope(payload, {
      content,
      compression: "none",
    });
    void prepared;
  }

  // Preparation: canonical encode plus SHA-256, before any transaction.
  {
    const values: number[] = [];
    let bytes = 0;
    for (let index = 0; index < samples; index += 1) {
      const start = performance.now();
      const encoded = await encodeSaveEnvelope(payload, {
        content,
        compression: "none",
      });
      values.push(performance.now() - start);
      bytes = encoded.bytes.byteLength;
    }
    report(fixture, "preparation-encode", samples, warmup, bytes, values);
  }

  // Commit: manual write of a prepared pair (insert plus metadata).
  {
    const values: number[] = [];
    let revision = 0;
    for (let index = 0; index < samples; index += 1) {
      const prepared = await preparedInput(payload);
      const start = performance.now();
      await repository.writeManualSave("save-performance", prepared, {
        expectedRevision: revision,
        expectedWriterEpoch: 0,
      });
      values.push(performance.now() - start);
      revision += 1;
    }
    report(fixture, "commit-manual", samples, warmup, 0, values);
  }

  // Commit: autosave write with newest-three rotation.
  {
    const values: number[] = [];
    let meta = await repository.readSlotMeta("save-performance");
    for (let index = 0; index < samples; index += 1) {
      const prepared = await preparedInput(payload);
      const start = performance.now();
      const result = await repository.writeAutosave("save-performance", prepared, {
        expectedRevision: meta.revision,
        expectedWriterEpoch: 0,
      });
      values.push(performance.now() - start);
      meta = result.meta;
    }
    report(fixture, "commit-rotation", samples, warmup, 0, values);
  }

  // Import preview (decode plus migrate plus full admission) and confirm
  // (rebind plus atomic commit), timed separately with end-to-end input.
  // Confirms run as overwrites of one steady-state slot: new-slot creation
  // differs only by the slot-creation check, and sixty fresh slots would hit
  // the twenty-slot cap mid-diagnostic.
  {
    const input = await preparedInput(payload);
    await repository.createSlot("perf-import", 0);
    const previewValues: number[] = [];
    const confirmValues: number[] = [];
    const endToEndValues: number[] = [];
    const lockClient = createInMemoryLockManager().createClient();
    for (let index = 0; index < samples; index += 1) {
      const service = createImportService({
        repository,
        locks: createWebLockAdapter({ locks: lockClient }),
        loadContent: () => content,
      });
      const endToEndStart = performance.now();
      let start = performance.now();
      const previewed = await service.previewImport({
        bytes: input.bytes,
        destination: { kind: "overwrite", slotId: "perf-import" },
      });
      previewValues.push(performance.now() - start);
      if (previewed.token === null) throw new Error("Diagnostic preview produced no token.");
      const bound = await repository.readSlotMeta("perf-import");
      start = performance.now();
      await service.confirmImport(previewed.token, { expectedRevision: bound.revision });
      confirmValues.push(performance.now() - start);
      endToEndValues.push(performance.now() - endToEndStart);
    }
    report(fixture, "preview", samples, warmup, input.bytes.byteLength, previewValues);
    report(fixture, "confirm", samples, warmup, input.bytes.byteLength, confirmValues);
    report(fixture, "end-to-end-import", samples, warmup, input.bytes.byteLength, endToEndValues);
  }
}

const host = {
  cpu: cpus()[0]?.model ?? "unknown",
  os: `${process.platform}-${process.arch}`,
  node: process.version,
  buildMode: "source",
};
console.log(JSON.stringify({ host }));
await measureFixture("N", 8, 200, 20);
await measureFixture("L", 128, 50, 5);
