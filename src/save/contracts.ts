import type { GameState } from "../sim/core/types.ts";

import type { PersistenceErrorCode } from "./persistenceErrors.ts";

export interface SaveExecution {
  simulatorProtocolVersion: 1;
  nextQueueSequence: number;
  pendingCommandCount: 0;
  stateHash: string;
}

export interface PlayerSettings {
  language: "ro" | "en";
  telemetryPreset: "compact" | "standard" | "diagnostics";
  reducedEffects: boolean;
  reducedMotion: boolean;
  frameCap: 30 | 45 | 60;
  volumes: {
    master: number;
    music: number;
    ui: number;
    machinery: number;
    alerts: number;
  };
}

export interface LocalStats {
  realPlayTimeSeconds: number;
  taskCompletions: number;
  taskAbandons: number;
  emergencyShutdowns: number;
  benchmarkAttempts: number;
  designApplications: number;
}

export interface SavePayloadV1 {
  schemaVersion: 1;
  saveVersion: 1;
  contentVersion: string;
  simulationContentHash: string;
  createdAtIso: string;
  savedAtIso: string;
  slotId: string;
  gameState: GameState;
  execution: SaveExecution;
  settings: PlayerSettings;
  localStats: LocalStats;
}

export interface SyntheticSavePayloadV0 {
  schemaVersion: 0;
  saveVersion: 1;
  contentVersion: string;
  simulationContentHash: string;
  createdAtIso: string;
  savedAtIso: string;
  slotId: string;
  gameState: GameState;
  execution: SaveExecution;
  settings: PlayerSettings;
}

export interface SaveEnvelope {
  format: "overclock-save";
  compression: "none" | "gzip";
  checksumAlgorithm: "sha-256";
  checksum: string;
  payload: string;
}

export interface SavePreview {
  sourceSchemaVersion: number;
  sourceSaveVersion: number;
  contentVersion: string;
  simulatedYear: number;
  tick: number;
  cashUsd: number;
  verticalSliceCompleted: boolean;
  savedAtIso: string;
  migrationRequired: boolean;
  compatibility: "compatible" | PersistenceErrorCode;
  destinationSuggestion: SaveDestinationSuggestion;
  compressedBytes: number;
  uncompressedBytes: number;
  slotId: string;
}

export type SaveDestinationSuggestion =
  { kind: "new-slot" } | { kind: "overwrite"; slotId: string };

export interface SaveRepository {
  list(): Promise<SavePreview[]>;
  read(slotId: string): Promise<SavePayloadV1>;
  write(payload: SavePayloadV1): Promise<void>;
  delete(slotId: string): Promise<void>;
  rotateAutosave(payload: SavePayloadV1, retain: number): Promise<void>;
}

export type Migration = (input: unknown) => unknown;
