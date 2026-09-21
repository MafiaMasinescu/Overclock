import { describe, expect, test } from "vitest";

import {
  DEFAULT_PLAYER_SETTINGS,
  parseLocalReport,
  parsePlayerSettings,
  parseSaveEnvelope,
  parseSaveExecution,
  parseSavePayloadV1,
  parseSavePreview,
} from "../../src/save/schema.ts";
import { PersistenceError } from "../../src/save/persistenceErrors.ts";
import { PERSISTENCE_SCHEMA_VERSION } from "../../src/save/persistenceLimits.ts";
import { assertSafeExternalData } from "../../src/save/inputSafety.ts";

const validExecution = {
  simulatorProtocolVersion: 1,
  nextQueueSequence: 8,
  pendingCommandCount: 0,
  stateHash: "9c3e82dd6fcae8b1",
};

const validPreview = {
  sourceSchemaVersion: 1,
  sourceSaveVersion: 1,
  contentVersion: "0.1.0",
  simulatedYear: 1946,
  tick: 12,
  cashUsd: 32000,
  verticalSliceCompleted: false,
  savedAtIso: "2026-09-16T12:00:00.000Z",
  migrationRequired: false,
  compatibility: "compatible",
  destinationSuggestion: { kind: "new-slot" },
  compressedBytes: 10,
  uncompressedBytes: 10,
  slotId: "slot-alpha",
};

describe("Phase 2 persistence schema foundations", () => {
  test("counts primitive values and primitive depth at the in-memory trust boundary", () => {
    expect(() => {
      assertSafeExternalData([1, 2], { maxVisitedValues: 2 });
    }).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() => {
      assertSafeExternalData([1], { maxDepth: 0 });
    }).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });

  test("bounds object maps and rejects non-enumerable array entries before cloning", () => {
    expect(() => {
      assertSafeExternalData({ a: 1, b: 2, c: 3 }, { maxObjectEntries: 2 });
    }).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));

    const array = [1];
    Object.defineProperty(array, "0", { value: 1, enumerable: false });
    expect(() => {
      assertSafeExternalData(array);
    }).toThrow(expect.objectContaining({ code: "INVALID_FORMAT" }));
  });

  test("provides the approved default settings", () => {
    expect(DEFAULT_PLAYER_SETTINGS).toEqual({
      language: "en",
      telemetryPreset: "standard",
      reducedEffects: false,
      reducedMotion: false,
      frameCap: 60,
      volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
    });
  });

  test("rejects unknown settings and out-of-range values without coercion", () => {
    expect(() => parsePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, extra: true })).toThrow(
      PersistenceError,
    );
    expect(() =>
      parsePlayerSettings({
        ...DEFAULT_PLAYER_SETTINGS,
        volumes: { ...DEFAULT_PLAYER_SETTINGS.volumes, master: 1.1 },
      }),
    ).toThrow(PersistenceError);
    expect(() => parsePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, frameCap: "60" })).toThrow(
      PersistenceError,
    );
  });

  test("rejects negative zero from integer execution metadata", () => {
    expect(() => parseSaveExecution({ ...validExecution, nextQueueSequence: -0 })).toThrow(
      PersistenceError,
    );
  });

  test("requires the exact execution boundary", () => {
    expect(parseSaveExecution(validExecution)).toEqual(validExecution);
    expect(() => parseSaveExecution({ ...validExecution, pendingCommandCount: 1 })).toThrow(
      PersistenceError,
    );
    expect(() => parseSaveExecution({ ...validExecution, extra: true })).toThrow(PersistenceError);
  });

  test("validates exact UTC ISO metadata and preview fields", () => {
    expect(parseSavePreview(validPreview)).toEqual(validPreview);
    expect(parseSavePreview({ ...validPreview, cashUsd: -1 })).toEqual({
      ...validPreview,
      cashUsd: -1,
    });
    expect(() =>
      parseSavePreview({ ...validPreview, savedAtIso: "2026-02-29T12:00:00.000Z" }),
    ).toThrow(PersistenceError);
    expect(() => parseSavePreview({ ...validPreview, tick: -0 })).toThrow(PersistenceError);
  });

  test("rejects mismatched outer and inner persistence versions", () => {
    const payload = {
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      saveVersion: 1,
      contentVersion: "0.1.0",
      simulationContentHash: "9c3e82dd6fcae8b1",
      createdAtIso: "2026-09-16T12:00:00.000Z",
      savedAtIso: "2026-09-16T12:00:00.000Z",
      slotId: "slot-alpha",
      gameState: { saveVersion: 1, contentVersion: "0.1.0" },
      execution: validExecution,
      settings: DEFAULT_PLAYER_SETTINGS,
      localStats: {
        realPlayTimeSeconds: 0,
        taskCompletions: 0,
        taskAbandons: 0,
        emergencyShutdowns: 0,
        benchmarkAttempts: 0,
        designApplications: 0,
      },
    };
    expect(parseSavePayloadV1(payload)).toEqual(payload);
    expect(() => parseSavePayloadV1({ ...payload, saveVersion: 2 })).toThrow(PersistenceError);
    expect(() =>
      parseSavePayloadV1({ ...payload, gameState: { ...payload.gameState, saveVersion: 2 } }),
    ).toThrow(PersistenceError);
  });

  test("rejects accessor-backed external metadata without invoking it", () => {
    let invoked = false;
    const hostile = { ...DEFAULT_PLAYER_SETTINGS } as Record<string, unknown>;
    Object.defineProperty(hostile, "language", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "en";
      },
    });

    expect(() => parsePlayerSettings(hostile)).toThrow(PersistenceError);
    expect(invoked).toBe(false);
  });

  test("rejects report data outside the allowlist", () => {
    const report = {
      reportVersion: 1,
      reportId: "report-0001",
      appVersion: "0.1.0",
      contentVersion: "0.1.0",
      category: "manual",
      errorCode: null,
      tick: null,
      year: null,
      createdAtIso: "2026-09-16T12:00:00.000Z",
      counters: {
        taskCompletions: 0,
        taskAbandons: 0,
        emergencyShutdowns: 0,
        benchmarkAttempts: 0,
        designApplications: 0,
      },
      durationMs: { total: 0, max: 0 },
      capabilities: {
        worker: true,
        indexedDb: true,
        crypto: true,
        gzip: true,
        webLocks: true,
      },
    };
    expect(parseLocalReport(report)).toEqual(report);
    expect(parseLocalReport({ ...report, errorCode: "INVALID_STATE" })).toEqual({
      ...report,
      errorCode: "INVALID_STATE",
    });
    expect(() => parseLocalReport({ ...report, errorCode: "unsafe free text" })).toThrow(
      PersistenceError,
    );
    expect(() => parseLocalReport({ ...report, seed: "must-not-be-stored" })).toThrow(
      PersistenceError,
    );
  });

  test("requires a strict save envelope discriminant", () => {
    const envelope = {
      format: "overclock-save",
      compression: "none",
      checksumAlgorithm: "sha-256",
      checksum: "a".repeat(64),
      payload: "{}",
    };
    expect(parseSaveEnvelope(envelope)).toEqual(envelope);
    expect(() => parseSaveEnvelope({ ...envelope, compression: "br" })).toThrow(PersistenceError);
    expect(() => parseSaveEnvelope({ ...envelope, checksum: "A".repeat(64) })).toThrow(
      PersistenceError,
    );
  });
});
