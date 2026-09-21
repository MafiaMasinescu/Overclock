import type {
  SavePayloadV1,
  SyntheticSavePayloadV0,
  UnadmittedSavePayloadV1,
} from "./contracts.ts";
import { assertSafeExternalData, cloneOwnedExternalData } from "./inputSafety.ts";
import { PersistenceError } from "./persistenceErrors.ts";
import { parseSavePayloadV1, parseSyntheticSavePayloadV0 } from "./schema.ts";

function zeroLocalStats(): SavePayloadV1["localStats"] {
  return {
    realPlayTimeSeconds: 0,
    taskCompletions: 0,
    taskAbandons: 0,
    emergencyShutdowns: 0,
    benchmarkAttempts: 0,
    designApplications: 0,
  };
}

function migrateSyntheticV0ToV1(input: unknown): UnadmittedSavePayloadV1 {
  const source = parseSyntheticSavePayloadV0(input);
  const owned = cloneOwnedExternalData(source);
  const migrated: UnadmittedSavePayloadV1 = {
    ...owned,
    schemaVersion: 1,
    localStats: zeroLocalStats(),
  };
  return parseSavePayloadV1(migrated);
}

export const SAVE_MIGRATIONS: Readonly<Record<number, (input: unknown) => unknown>> = Object.freeze(
  {
    0: migrateSyntheticV0ToV1,
  },
);

export function migrateSavePayload(input: unknown): UnadmittedSavePayloadV1 {
  assertSafeExternalData(input);
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new PersistenceError("UNSUPPORTED_VERSION", "Save payload version is unavailable.");
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(input, "schemaVersion");
  const schemaVersion: unknown = versionDescriptor?.value;
  if (schemaVersion === 1) return parseSavePayloadV1(input);
  if (schemaVersion !== 0) {
    throw new PersistenceError(
      "UNSUPPORTED_VERSION",
      "Save payload schema version is unsupported.",
    );
  }
  const migration = SAVE_MIGRATIONS[0];
  if (migration === undefined)
    throw new PersistenceError("MIGRATION_FAILED", "Schema-0 migration is unavailable.");
  try {
    return migration(input) as UnadmittedSavePayloadV1;
  } catch (error: unknown) {
    if (error instanceof PersistenceError && error.code === "UNSUPPORTED_VERSION") throw error;
    if (error instanceof PersistenceError && error.code === "INVALID_FORMAT") {
      throw new PersistenceError("MIGRATION_FAILED", error.message, error.path);
    }
    throw new PersistenceError(
      "MIGRATION_FAILED",
      error instanceof Error ? error.message : "Schema migration failed.",
    );
  }
}

export function createSyntheticV0Payload(payload: SavePayloadV1): SyntheticSavePayloadV0 {
  const owned = cloneOwnedExternalData(payload);
  const withoutStats: Omit<SavePayloadV1, "localStats"> = {
    schemaVersion: owned.schemaVersion,
    saveVersion: owned.saveVersion,
    contentVersion: owned.contentVersion,
    simulationContentHash: owned.simulationContentHash,
    createdAtIso: owned.createdAtIso,
    savedAtIso: owned.savedAtIso,
    slotId: owned.slotId,
    gameState: owned.gameState,
    execution: owned.execution,
    settings: owned.settings,
  };
  return {
    ...withoutStats,
    schemaVersion: 0,
  };
}
