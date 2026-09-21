import { cpus } from "node:os";

import { assertValidBlueprintState } from "../../src/sim/blueprints/blueprintState.ts";
import {
  createDefaultSaveCodecAdapters,
  decodeSaveEnvelope,
  encodeSaveEnvelope,
} from "../../src/save/codec.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import { admitSavePayloadForContent } from "../../src/save/stateAdmission.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { createTask9PerformanceFixture, thermalPerformanceContent } from "./thermalFixture.ts";

const content = thermalPerformanceContent;

function createDenseActiveState(seed: string) {
  const state = createTask9PerformanceFixture(seed);
  const service = state.tasks.instances["task-9-bandwidth"];
  if (service === undefined) throw new Error("Save fixture lacks its active service Task.");
  state.tasks.instances[service.id] = { ...service, serviceWindowCompliant: true };
  state.research.researchData = 1_000_000;
  state.economy.cashUsd = 1_000_000;
  const core = createProductionSimCore({ content, initialState: state });
  core.enqueue({
    commandId: "70000000-0000-4000-8000-000000000001",
    source: "player",
    kind: "START_RESEARCH",
    nodeId: "research-stable-power-distribution",
    reservedComputeShare: 0.1,
  });
  const result = core.processPendingCommands()[0];
  if (result?.accepted !== true) throw new Error("Save fixture could not start Research.");
  core.step(1);
  return core.getStateForSave();
}

function createPayload(blueprintCount: number): SavePayloadV1 {
  const state = createDenseActiveState(`save-performance-${blueprintCount}`);
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
    createdAtIso: "2026-09-16T12:00:00.000Z",
    savedAtIso: "2026-09-16T12:00:00.000Z",
    slotId: "save-performance",
    gameState: state,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence: 1,
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

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function measureEncode(
  payload: SavePayloadV1,
  fixture: string,
  compression: "none" | "gzip",
  samples: number,
  warmup: number,
): Promise<void> {
  for (let index = 0; index < warmup; index += 1)
    await encodeSaveEnvelope(payload, { content, compression });
  const values: number[] = [];
  let bytes = 0;
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    const result = await encodeSaveEnvelope(payload, { content, compression });
    values.push(performance.now() - start);
    bytes = result.bytes.byteLength;
  }
  console.log(
    JSON.stringify({
      fixture,
      operation: `admit-encode-${compression}`,
      samples,
      warmup,
      bytes,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maximumMs: Math.max(...values),
    }),
  );
}

function measureAdmission(
  payload: SavePayloadV1,
  fixture: string,
  samples: number,
  warmup: number,
): void {
  for (let index = 0; index < warmup; index += 1) admitSavePayloadForContent({ payload, content });
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    admitSavePayloadForContent({ payload, content });
    values.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      fixture,
      operation: "full-payload-admission",
      samples,
      warmup,
      bytes: new TextEncoder().encode(canonicalSerialize(payload)).byteLength,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maximumMs: Math.max(...values),
    }),
  );
}

function measureCanonicalPayloadEncode(
  payload: SavePayloadV1,
  fixture: string,
  samples: number,
  warmup: number,
): void {
  const admitted = admitSavePayloadForContent({ payload, content });
  const encode = () => new TextEncoder().encode(canonicalSerialize(admitted));
  for (let index = 0; index < warmup; index += 1) encode();
  const values: number[] = [];
  let bytes = 0;
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    bytes = encode().byteLength;
    values.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      fixture,
      operation: "canonical-payload-encode",
      samples,
      warmup,
      bytes,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maximumMs: Math.max(...values),
    }),
  );
}

async function measureDecode(
  payload: SavePayloadV1,
  fixture: string,
  compression: "none" | "gzip",
  samples: number,
  warmup: number,
): Promise<void> {
  const encoded = await encodeSaveEnvelope(payload, { content, compression });
  for (let index = 0; index < warmup; index += 1)
    await decodeSaveEnvelope(encoded.bytes, { content });
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await decodeSaveEnvelope(encoded.bytes, { content });
    values.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      fixture,
      operation: `decode-${compression}`,
      samples,
      warmup,
      bytes: encoded.bytes.byteLength,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maximumMs: Math.max(...values),
    }),
  );
}

async function measurePrimitive(
  payload: SavePayloadV1,
  fixture: string,
  samples: number,
  warmup: number,
): Promise<void> {
  const encoded = await encodeSaveEnvelope(payload, { content, compression: "none" });
  const adapters = createDefaultSaveCodecAdapters();
  const compressed = await adapters.gzipEncode(encoded.canonicalPayloadBytes);
  for (let index = 0; index < warmup; index += 1) {
    await adapters.sha256(encoded.canonicalPayloadBytes);
    await adapters.gzipEncode(encoded.canonicalPayloadBytes);
    await adapters.gzipDecode(compressed, 16 * 1024 * 1024);
  }
  const values: Record<string, number[]> = { sha256: [], gzipEncode: [], gzipDecode: [] };
  for (let index = 0; index < samples; index += 1) {
    let start = performance.now();
    await adapters.sha256(encoded.canonicalPayloadBytes);
    values["sha256"]?.push(performance.now() - start);
    start = performance.now();
    await adapters.gzipEncode(encoded.canonicalPayloadBytes);
    values["gzipEncode"]?.push(performance.now() - start);
    start = performance.now();
    await adapters.gzipDecode(compressed, 16 * 1024 * 1024);
    values["gzipDecode"]?.push(performance.now() - start);
  }
  for (const [operation, timings] of Object.entries(values)) {
    console.log(
      JSON.stringify({
        fixture,
        operation,
        samples,
        warmup,
        bytes: encoded.canonicalPayloadBytes.byteLength,
        compressedBytes: compressed.byteLength,
        medianMs: percentile(timings, 0.5),
        p95Ms: percentile(timings, 0.95),
        maximumMs: Math.max(...timings),
      }),
    );
  }
}

const normal = createPayload(8);
const large = createPayload(128);
const host = {
  cpu: cpus()[0]?.model ?? "unknown",
  os: `${process.platform}-${process.arch}`,
  node: process.version,
  buildMode: "source",
};
console.log(JSON.stringify({ host }));
measureAdmission(normal, "N", 200, 20);
measureCanonicalPayloadEncode(normal, "N", 200, 20);
await measureEncode(normal, "N", "none", 200, 20);
await measureEncode(normal, "N", "gzip", 200, 20);
await measureDecode(normal, "N", "none", 200, 20);
await measureDecode(normal, "N", "gzip", 200, 20);
await measurePrimitive(normal, "N", 200, 20);
measureAdmission(large, "L", 50, 5);
measureCanonicalPayloadEncode(large, "L", 50, 5);
await measureEncode(large, "L", "none", 50, 5);
await measureEncode(large, "L", "gzip", 50, 5);
await measureDecode(large, "L", "none", 50, 5);
await measureDecode(large, "L", "gzip", 50, 5);
await measurePrimitive(large, "L", 50, 5);
