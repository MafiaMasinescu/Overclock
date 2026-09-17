import { cpus } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { assertValidBlueprintState } from "../../src/sim/blueprints/blueprintState.ts";
import {
  createDefaultSaveCodecAdapters,
  decodeSaveEnvelope,
  encodeSaveEnvelope,
} from "../../src/save/codec.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";

const content = loadContentBundle();

function createPayload(blueprintCount: number): SavePayloadV1 {
  const state = createInitialGameState({ content, seed: `save-performance-${blueprintCount}` });
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
    await encodeSaveEnvelope(payload, { compression });
  const values: number[] = [];
  let bytes = 0;
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    const result = await encodeSaveEnvelope(payload, { compression });
    values.push(performance.now() - start);
    bytes = result.bytes.byteLength;
  }
  console.log(
    JSON.stringify({
      fixture,
      operation: `encode-${compression}`,
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
  const encoded = await encodeSaveEnvelope(payload, { compression });
  for (let index = 0; index < warmup; index += 1) await decodeSaveEnvelope(encoded.bytes);
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await decodeSaveEnvelope(encoded.bytes);
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
  const encoded = await encodeSaveEnvelope(payload, { compression: "none" });
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
await measureEncode(normal, "N", "none", 200, 20);
await measureEncode(normal, "N", "gzip", 200, 20);
await measureDecode(normal, "N", "none", 200, 20);
await measureDecode(normal, "N", "gzip", 200, 20);
await measurePrimitive(normal, "N", 200, 20);
await measureEncode(large, "L", "none", 50, 5);
await measureEncode(large, "L", "gzip", 50, 5);
await measureDecode(large, "L", "none", 50, 5);
await measureDecode(large, "L", "gzip", 50, 5);
await measurePrimitive(large, "L", 50, 5);
