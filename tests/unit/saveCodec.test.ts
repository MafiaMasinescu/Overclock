import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SavePayloadV1 } from "../../src/save/contracts.ts";
import {
  createDefaultSaveCodecAdapters,
  decodeSaveEnvelope,
  encodeSaveEnvelope,
  parseStrictJsonText,
  sha256Hex,
} from "../../src/save/codec.ts";
import { PersistenceError } from "../../src/save/persistenceErrors.ts";
import { MAX_CANONICAL_PAYLOAD_BYTES } from "../../src/save/persistenceLimits.ts";
import { migrateSavePayload } from "../../src/save/migrations.ts";
import { createSyntheticV0Payload } from "../../src/save/migrations.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";

const codecContent = loadContentBundle();

function createPayload(): SavePayloadV1 {
  const content = loadContentBundle();
  const gameState = createInitialGameState({ content, seed: "codec-seed-ș" });
  return {
    schemaVersion: 1,
    saveVersion: 1,
    contentVersion: content.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    createdAtIso: "2026-09-16T12:00:00.000Z",
    savedAtIso: "2026-09-16T12:00:01.000Z",
    slotId: "slot-codec",
    gameState,
    execution: {
      simulatorProtocolVersion: 1,
      nextQueueSequence: 0,
      pendingCommandCount: 0,
      stateHash: hashCanonicalState(gameState),
    },
    settings: {
      language: "ro",
      telemetryPreset: "standard",
      reducedEffects: false,
      reducedMotion: true,
      frameCap: 60,
      volumes: { master: 1, music: 0.75, ui: 1, machinery: 0.5, alerts: 1 },
    },
    localStats: {
      realPlayTimeSeconds: 2.5,
      taskCompletions: 1,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    },
  };
}

describe("canonical save codec", () => {
  test.each([
    [
      "ASCII",
      { language: "en", message: "Hello" },
      '{"language":"en","message":"Hello"}',
      "390d9d62553ba7ba0b81240c8bad7e7c5b1789a793a92aa2b172185b14f03584",
    ],
    [
      "Romanian",
      { language: "ro", message: "Bună ziua" },
      '{"language":"ro","message":"Bună ziua"}',
      "915fc2fab5059a256920251e4b6b46e45e95decd59630238b85201e4c748f6bd",
    ],
    [
      "Unicode",
      { emoji: "🧠", text: "μ-архитектура" },
      '{"emoji":"🧠","text":"μ-архитектура"}',
      "2ca698e5029d6eb144a077e0fcee67be52942e1f36d1903bf62838d3ede1cf23",
    ],
  ])(
    "freezes the %s canonical UTF-8 vector",
    async (_, value, expectedCanonical, expectedDigest) => {
      const canonical = canonicalSerialize(value);
      expect(canonical).toBe(expectedCanonical);
      expect(await sha256Hex(new TextEncoder().encode(canonical))).toBe(expectedDigest);
    },
  );

  test("encodes and decodes canonical uncompressed payloads", async () => {
    const payload = createPayload();
    const content = loadContentBundle();
    const encoded = await encodeSaveEnvelope(payload, { content, compression: "none" });
    const decoded = await decodeSaveEnvelope(encoded.bytes, { content });

    expect(decoded.payload).toEqual(payload);
    expect(decoded.sourceSchemaVersion).toBe(1);
    expect(decoded.migrated).toBe(false);
    expect(new TextDecoder().decode(decoded.canonicalPayloadBytes)).toBe(encoded.canonicalPayload);
  });

  test("rejects encode input whose execution hash does not certify its GameState", async () => {
    const content = loadContentBundle();
    const payload = createPayload();
    const corrupted: SavePayloadV1 = {
      ...payload,
      execution: { ...payload.execution, stateHash: "0000000000000000" },
    };

    await expect(encodeSaveEnvelope(corrupted, { content })).rejects.toMatchObject({
      code: "CHECKSUM_MISMATCH",
    });
  });

  test("rejects encode input whose simulation fingerprint does not match injected content", async () => {
    const payload = { ...createPayload(), simulationContentHash: "0000000000000000" };

    await expect(encodeSaveEnvelope(payload, { content: codecContent })).rejects.toMatchObject({
      code: "INCOMPATIBLE_CONTENT",
    });
  });

  test("rejects encode input with structurally invalid authoritative state", async () => {
    const content = loadContentBundle();
    const corrupted = structuredClone(createPayload());
    corrupted.gameState.tick = -1;

    await expect(encodeSaveEnvelope(corrupted, { content })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("maps semantic GameState admission failures to stable persistence errors", async () => {
    const corrupted = structuredClone(createPayload());
    corrupted.gameState.economy.cashUsd = 0.0000001;
    corrupted.execution.stateHash = hashCanonicalState(corrupted.gameState);

    await expect(encodeSaveEnvelope(corrupted, { content: codecContent })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("rejects imported bytes whose simulation content fingerprint is incompatible", async () => {
    const content = loadContentBundle();
    const payload = { ...createPayload(), simulationContentHash: "0000000000000000" };
    const canonicalPayload = canonicalSerialize(payload);
    const checksum = await sha256Hex(new TextEncoder().encode(canonicalPayload));
    const bytes = new TextEncoder().encode(
      canonicalSerialize({
        format: "overclock-save",
        compression: "none",
        checksumAlgorithm: "sha-256",
        checksum,
        payload: canonicalPayload,
      }),
    );

    await expect(decodeSaveEnvelope(bytes, { content })).rejects.toMatchObject({
      code: "INCOMPATIBLE_CONTENT",
    });
  });

  test("rejects imported bytes whose GameState is structurally invalid", async () => {
    const content = loadContentBundle();
    const payload = createPayload();
    payload.gameState.tick = -1;
    payload.execution.stateHash = hashCanonicalState(payload.gameState);
    const canonicalPayload = canonicalSerialize(payload);
    const checksum = await sha256Hex(new TextEncoder().encode(canonicalPayload));
    const bytes = new TextEncoder().encode(
      canonicalSerialize({
        format: "overclock-save",
        compression: "none",
        checksumAlgorithm: "sha-256",
        checksum,
        payload: canonicalPayload,
      }),
    );

    await expect(decodeSaveEnvelope(bytes, { content })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("produces the independently known SHA-256 digest for UTF-8 bytes", async () => {
    expect(await sha256Hex(new TextEncoder().encode("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  test("supports gzip round-trip without changing canonical payload bytes", async () => {
    const encoded = await encodeSaveEnvelope(createPayload(), {
      content: codecContent,
      compression: "gzip",
    });
    const decoded = await decodeSaveEnvelope(encoded.bytes, { content: codecContent });

    expect(decoded.payload).toEqual(createPayload());
    expect(decoded.canonicalPayload).toBe(encoded.canonicalPayload);
    expect(encoded.envelope.compression).toBe("gzip");
  });

  test("rejects trailing gzip bytes instead of accepting an ambiguous stream", async () => {
    const encoded = await encodeSaveEnvelope(createPayload(), {
      content: codecContent,
      compression: "gzip",
    });
    const compressed = Buffer.from(encoded.envelope.payload, "base64");
    const envelope = {
      ...encoded.envelope,
      payload: Buffer.concat([compressed, Buffer.from([0])]).toString("base64"),
    };

    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(envelope)), {
        content: codecContent,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  test("rejects concatenated gzip members even when they decode to certified canonical bytes", async () => {
    const encoded = await encodeSaveEnvelope(createPayload(), {
      content: codecContent,
      compression: "none",
    });
    const adapters = createDefaultSaveCodecAdapters();
    const split = Math.floor(encoded.canonicalPayloadBytes.length / 2);
    const first = await adapters.gzipEncode(encoded.canonicalPayloadBytes.slice(0, split));
    const second = await adapters.gzipEncode(encoded.canonicalPayloadBytes.slice(split));
    const envelope = {
      ...encoded.envelope,
      compression: "gzip" as const,
      payload: Buffer.concat([first, second]).toString("base64"),
    };

    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(envelope)), {
        content: codecContent,
      }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  test("rejects duplicate keys before semantic payload parsing", async () => {
    const duplicateEnvelope = `{"format":"overclock-save","format":"overclock-save","compression":"none","checksumAlgorithm":"sha-256","checksum":"${"a".repeat(64)}","payload":"{}"}`;
    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(duplicateEnvelope), { content: codecContent }),
    ).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  test("verifies the checksum before accepting the payload", async () => {
    const encoded = await encodeSaveEnvelope(createPayload(), {
      content: codecContent,
      compression: "none",
    });
    const tampered = JSON.parse(new TextDecoder().decode(encoded.bytes)) as Record<string, unknown>;
    tampered["payload"] = `${String(tampered["payload"])} `;

    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(tampered)), {
        content: codecContent,
      }),
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });

  test("rejects noncanonical JSON and malformed UTF-8", async () => {
    expect(() => parseStrictJsonText('{"b":1,"a":2}')).not.toThrow();
    expect(() => parseStrictJsonText('{"a":1,"a":2}')).toThrow(PersistenceError);
    await expect(
      decodeSaveEnvelope(new Uint8Array([0xc3, 0x28]), { content: codecContent }),
    ).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  test("rejects malformed base64, unsupported schema, and bounded parser overflow", async () => {
    const malformedBase64 = {
      format: "overclock-save",
      compression: "gzip",
      checksumAlgorithm: "sha-256",
      checksum: "a".repeat(64),
      payload: "not-base64",
    };
    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(malformedBase64)), {
        content: codecContent,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });

    const futurePayload = canonicalSerialize({ schemaVersion: 99 });
    const futureChecksum = await sha256Hex(new TextEncoder().encode(futurePayload));
    const futureEnvelope = {
      format: "overclock-save",
      compression: "none",
      checksumAlgorithm: "sha-256",
      checksum: futureChecksum,
      payload: futurePayload,
    };
    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(futureEnvelope)), {
        content: codecContent,
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });

    expect(() => parseStrictJsonText("[[[]]]", { maxDepth: 1 })).toThrow(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );
    expect(() => parseStrictJsonText('{"a":1,"b":2,"c":3}', { maxObjectEntries: 2 })).toThrow(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );
  });

  test("enforces the decompressed output cap even for an injected codec adapter", async () => {
    const envelope = {
      format: "overclock-save",
      compression: "gzip",
      checksumAlgorithm: "sha-256",
      checksum: "a".repeat(64),
      payload: "AA==",
    };
    const oversized = new Uint8Array(MAX_CANONICAL_PAYLOAD_BYTES + 1);
    const adapters = {
      sha256: () => Promise.resolve("a".repeat(64)),
      gzipEncode: (bytes: Uint8Array) => Promise.resolve(bytes),
      gzipDecode: () => Promise.resolve(oversized),
    };

    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(envelope)), {
        content: codecContent,
        adapters,
      }),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  test("honors cancellation before asynchronous work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeSaveEnvelope(createPayload(), { content: codecContent, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await expect(
      decodeSaveEnvelope(new Uint8Array(), { content: codecContent, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  test("honors cancellation raised during injected decompression", async () => {
    const controller = new AbortController();
    const envelope = {
      format: "overclock-save",
      compression: "gzip",
      checksumAlgorithm: "sha-256",
      checksum: "a".repeat(64),
      payload: "AA==",
    };
    const adapters = {
      sha256: () => Promise.resolve("a".repeat(64)),
      gzipEncode: (bytes: Uint8Array) => Promise.resolve(bytes),
      gzipDecode: () => {
        controller.abort();
        return Promise.resolve(new TextEncoder().encode("{}"));
      },
    };

    await expect(
      decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(envelope)), {
        content: codecContent,
        adapters,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  test("migrates the synthetic v0 payload on an owned copy", () => {
    const payload = createPayload();
    const v0 = { ...payload, schemaVersion: 0 };
    delete (v0 as Partial<SavePayloadV1>).localStats;
    const before = structuredClone(v0);
    const migrated = migrateSavePayload(v0);

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.localStats).toEqual({
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    });
    expect(v0).toEqual(before);
    expect(migrated.gameState).toEqual(payload.gameState);
  });

  test("creates an owned synthetic v0 fixture without aliasing the source payload", () => {
    const payload = createPayload();
    const v0 = createSyntheticV0Payload(payload);
    v0.gameState.tick = 17;
    v0.settings.language = "en";

    expect(payload.gameState.tick).toBe(0);
    expect(payload.settings.language).toBe("ro");
  });

  test("imports the synthetic v0 fixture through the real codec and migration registry", async () => {
    const payload = createPayload();
    const v0 = createSyntheticV0Payload(payload);
    const canonical = canonicalSerialize(v0);
    const checksum = await sha256Hex(new TextEncoder().encode(canonical));
    const envelope = {
      format: "overclock-save",
      compression: "none",
      checksumAlgorithm: "sha-256",
      checksum,
      payload: canonical,
    };
    const decoded = await decodeSaveEnvelope(new TextEncoder().encode(JSON.stringify(envelope)), {
      content: codecContent,
    });

    expect(decoded.sourceSchemaVersion).toBe(0);
    expect(decoded.migrated).toBe(true);
    expect(decoded.payload.schemaVersion).toBe(1);
    expect(decoded.payload.localStats.realPlayTimeSeconds).toBe(0);
  });

  test("does not migrate unknown or future schema versions", () => {
    expect(() => migrateSavePayload({ schemaVersion: 2 })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
    expect(() => migrateSavePayload({ schemaVersion: -1 })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
  });
});
