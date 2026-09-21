import { z } from "zod";

import type {
  LocalStats,
  PlayerSettings,
  SaveEnvelope,
  SaveExecution,
  SavePreview,
  UnadmittedSavePayloadV1,
  UnadmittedSyntheticSavePayloadV0,
} from "./contracts.ts";
import { assertSafeExternalData, type ExternalDataLimits } from "./inputSafety.ts";
import { PersistenceError } from "./persistenceErrors.ts";
import {
  HASH_16_PATTERN,
  PERSISTENCE_SAVE_VERSION,
  PERSISTENCE_SCHEMA_VERSION,
  PERSISTENCE_SIMULATOR_PROTOCOL_VERSION,
  SHA256_PATTERN,
  SLOT_ID_PATTERN,
  SYNTHETIC_V0_SCHEMA_VERSION,
  UTC_ISO_PATTERN,
  MAX_INPUT_FILE_BYTES,
} from "./persistenceLimits.ts";

const finiteNonNegative = z
  .number()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), "negative zero is not allowed");
const safeNonnegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0), "negative zero is not allowed");
const exactUtcIso = z
  .string()
  .refine(isValidUtcIso, "must be a valid millisecond UTC ISO timestamp");
const slotId = z.string().regex(SLOT_ID_PATTERN, "must be a valid slot id");
const stateHash = z.string().regex(HASH_16_PATTERN, "must be a lowercase 64-bit state hash");
const simulationContentHash = stateHash;

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = Object.freeze({
  language: "en",
  telemetryPreset: "standard",
  reducedEffects: false,
  reducedMotion: false,
  frameCap: 60,
  volumes: Object.freeze({ master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 }),
});

export const playerSettingsSchema = z
  .object({
    language: z.enum(["ro", "en"]),
    telemetryPreset: z.enum(["compact", "standard", "diagnostics"]),
    reducedEffects: z.boolean(),
    reducedMotion: z.boolean(),
    frameCap: z.union([z.literal(30), z.literal(45), z.literal(60)]),
    volumes: z
      .object({
        master: finiteNonNegative.max(1),
        music: finiteNonNegative.max(1),
        ui: finiteNonNegative.max(1),
        machinery: finiteNonNegative.max(1),
        alerts: finiteNonNegative.max(1),
      })
      .strict(),
  })
  .strict();

export const localStatsSchema = z
  .object({
    realPlayTimeSeconds: finiteNonNegative.max(Number.MAX_SAFE_INTEGER),
    taskCompletions: safeNonnegativeInteger,
    taskAbandons: safeNonnegativeInteger,
    emergencyShutdowns: safeNonnegativeInteger,
    benchmarkAttempts: safeNonnegativeInteger,
    designApplications: safeNonnegativeInteger,
  })
  .strict();

export const saveExecutionSchema = z
  .object({
    simulatorProtocolVersion: z.literal(PERSISTENCE_SIMULATOR_PROTOCOL_VERSION),
    nextQueueSequence: safeNonnegativeInteger,
    pendingCommandCount: z.literal(0),
    stateHash,
  })
  .strict();

const savePayloadCommon = {
  saveVersion: z.literal(PERSISTENCE_SAVE_VERSION),
  contentVersion: z.string().min(1),
  simulationContentHash,
  createdAtIso: exactUtcIso,
  savedAtIso: exactUtcIso,
  slotId,
  gameState: z.unknown(),
  execution: saveExecutionSchema,
  settings: playerSettingsSchema,
};

export const savePayloadV1Schema = z
  .object({
    schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
    ...savePayloadCommon,
    localStats: localStatsSchema,
  })
  .strict();

export const syntheticSavePayloadV0Schema = z
  .object({ schemaVersion: z.literal(SYNTHETIC_V0_SCHEMA_VERSION), ...savePayloadCommon })
  .strict();

export const saveEnvelopeSchema = z
  .object({
    format: z.literal("overclock-save"),
    compression: z.enum(["none", "gzip"]),
    checksumAlgorithm: z.literal("sha-256"),
    checksum: z.string().regex(SHA256_PATTERN, "must be lowercase SHA-256 hex"),
    payload: z.string(),
  })
  .strict();

const compatibility = z.union([
  z.literal("compatible"),
  z.literal("INCOMPATIBLE_CONTENT"),
  z.literal("UNSUPPORTED_VERSION"),
  z.literal("INVALID_STATE"),
  z.literal("CHECKSUM_MISMATCH"),
  z.literal("LIMIT_EXCEEDED"),
]);

const destinationSuggestion = z.union([
  z.object({ kind: z.literal("new-slot") }).strict(),
  z.object({ kind: z.literal("overwrite"), slotId }).strict(),
]);

export const savePreviewSchema = z
  .object({
    sourceSchemaVersion: safeNonnegativeInteger,
    sourceSaveVersion: safeNonnegativeInteger,
    contentVersion: z.string().min(1),
    simulatedYear: safeNonnegativeInteger,
    tick: safeNonnegativeInteger,
    cashUsd: z.number(),
    verticalSliceCompleted: z.boolean(),
    savedAtIso: exactUtcIso,
    migrationRequired: z.boolean(),
    compatibility,
    destinationSuggestion,
    compressedBytes: safeNonnegativeInteger,
    uncompressedBytes: safeNonnegativeInteger,
    slotId,
  })
  .strict();

const reportCounters = z
  .object({
    taskCompletions: safeNonnegativeInteger,
    taskAbandons: safeNonnegativeInteger,
    emergencyShutdowns: safeNonnegativeInteger,
    benchmarkAttempts: safeNonnegativeInteger,
    designApplications: safeNonnegativeInteger,
  })
  .strict();

export const localReportSchema = z
  .object({
    reportVersion: z.literal(1),
    reportId: z.string().min(1),
    appVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    category: z.enum(["manual", "fatal", "recovery", "storage"]),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable(),
    tick: safeNonnegativeInteger.nullable(),
    year: safeNonnegativeInteger.nullable(),
    createdAtIso: exactUtcIso,
    counters: reportCounters,
    durationMs: z.object({ total: finiteNonNegative, max: finiteNonNegative }).strict(),
    capabilities: z
      .object({
        worker: z.boolean(),
        indexedDb: z.boolean(),
        crypto: z.boolean(),
        gzip: z.boolean(),
        webLocks: z.boolean(),
      })
      .strict(),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  description: string,
  safetyOptions?: ExternalDataLimits,
): T {
  try {
    assertSafeExternalData(value, safetyOptions);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError("INVALID_FORMAT", `${description} is not safe external data.`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PersistenceError(
      "INVALID_FORMAT",
      `${description} has an invalid schema: ${result.error.issues[0]?.message ?? "unknown error"}.`,
    );
  }
  return structuredClone(result.data);
}

export function isValidUtcIso(value: string): boolean {
  const match = UTC_ISO_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day >= 1 && day <= daysInMonth && millisecond >= 0 && millisecond <= 999;
}

function validateGameStateHeader(payload: Record<string, unknown>): void {
  const state = payload["gameState"];
  if (
    !isRecord(state) ||
    state["saveVersion"] !== payload["saveVersion"] ||
    state["contentVersion"] !== payload["contentVersion"]
  ) {
    throw new PersistenceError(
      "INVALID_STATE",
      "gameState saveVersion/contentVersion disagrees with the payload.",
    );
  }
}

export function parsePlayerSettings(value: unknown): PlayerSettings {
  return parse(playerSettingsSchema, value, "PlayerSettings");
}

export function parseLocalStats(value: unknown): LocalStats {
  return parse(localStatsSchema, value, "LocalStats");
}

export function parseSaveExecution(value: unknown): SaveExecution {
  return parse(saveExecutionSchema, value, "Save execution");
}

export function parseSaveEnvelope(value: unknown): SaveEnvelope {
  return parse(saveEnvelopeSchema, value, "Save envelope", {
    maxDepth: 4,
    maxStringUnits: MAX_INPUT_FILE_BYTES,
  });
}

export function parseSavePreview(value: unknown): SavePreview {
  return parse(savePreviewSchema, value, "Save preview");
}

export function parseLocalReport(value: unknown): LocalReport {
  return parse(localReportSchema, value, "Local report");
}

export interface LocalReport {
  reportVersion: 1;
  reportId: string;
  appVersion: string;
  contentVersion: string;
  category: "manual" | "fatal" | "recovery" | "storage";
  errorCode: string | null;
  tick: number | null;
  year: number | null;
  createdAtIso: string;
  counters: {
    taskCompletions: number;
    taskAbandons: number;
    emergencyShutdowns: number;
    benchmarkAttempts: number;
    designApplications: number;
  };
  durationMs: { total: number; max: number };
  capabilities: {
    worker: boolean;
    indexedDb: boolean;
    crypto: boolean;
    gzip: boolean;
    webLocks: boolean;
  };
}

export function parseSavePayloadV1(value: unknown): UnadmittedSavePayloadV1 {
  const parsed = parse(savePayloadV1Schema, value, "SavePayloadV1");
  validateGameStateHeader(parsed);
  return parsed;
}

export function parseSyntheticSavePayloadV0(value: unknown): UnadmittedSyntheticSavePayloadV0 {
  const parsed = parse(syntheticSavePayloadV0Schema, value, "Synthetic SavePayloadV0");
  validateGameStateHeader(parsed);
  return parsed;
}
