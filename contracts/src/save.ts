import type { GameState } from "./types";

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
  saveVersion: 1;
  contentVersion: string;
  createdAtIso: string;
  savedAtIso: string;
  slotId: string;
  gameState: GameState;
  settings: PlayerSettings;
  localStats: LocalStats;
}

export interface SaveEnvelope {
  format: "overclock-save";
  compression: "none" | "gzip";
  checksumAlgorithm: "sha-256";
  checksum: string;
  payload: string;
}

export interface SavePreview {
  slotId: string;
  contentVersion: string;
  saveVersion: number;
  savedAtIso: string;
  simulatedYear: number;
  tick: number;
  cashUsd: number;
  verticalSliceCompleted: boolean;
  migrationRequired: boolean;
}

export interface SaveRepository {
  list(): Promise<SavePreview[]>;
  read(slotId: string): Promise<SavePayloadV1>;
  write(payload: SavePayloadV1): Promise<void>;
  delete(slotId: string): Promise<void>;
  rotateAutosave(payload: SavePayloadV1, retain: number): Promise<void>;
}

export type Migration = (input: unknown) => unknown;

