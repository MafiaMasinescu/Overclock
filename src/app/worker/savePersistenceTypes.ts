import type { LocalStats, PlayerSettings, SavePreview } from "../../save/contracts.ts";
import type { LocalReport } from "../../save/schema.ts";
import type { GameState } from "../../sim/core/types.ts";
import type { WorkerRequest } from "./protocol.ts";

export type WorkerSaveReason = Extract<WorkerRequest, { kind: "REQUEST_SAVE" }>["body"]["reason"];

export interface WorkerSaveMetadata {
  readonly slotId: string;
  readonly savedAtIso: string;
  readonly tick: number;
  readonly sizeBytes: number;
}

export interface WorkerSaveSessionInfo {
  readonly slotId: string;
  readonly createdAtIso: string;
  readonly settings: PlayerSettings;
  readonly localStats: LocalStats;
}

export interface WorkerSaveCapture {
  readonly state: GameState;
  readonly nextQueueSequence: number;
  readonly dirtyGeneration: number;
  readonly createdAtIso: string;
  readonly settings: PlayerSettings;
  readonly localStats: LocalStats;
}

export interface WorkerSavePersistence {
  startNewRun(): Promise<WorkerSaveSessionInfo>;
  save(capture: WorkerSaveCapture, reason: WorkerSaveReason): Promise<WorkerSaveMetadata>;
  updateSettings(settings: PlayerSettings): Promise<PlayerSettings>;
  prepareLoad?(slotId: string): Promise<WorkerLoadCandidate>;
  listSlots?(): Promise<readonly WorkerSlotSummary[]>;
  previewImport?(
    bytes: Uint8Array,
    destination?:
      { readonly kind: "new-slot" } | { readonly kind: "overwrite"; readonly slotId: string },
  ): Promise<WorkerImportPreview>;
  discardImport(): void;
  confirmImport?(
    token: string,
    options: { readonly expectedRevision: number | undefined; readonly applySettings: boolean },
  ): Promise<WorkerImportConfirmation>;
  exportSlot?(slotId: string, expectedRevision: number): Promise<Uint8Array>;
  deleteSlot?(slotId: string, expectedRevision: number): Promise<void>;
  createReport?(report: LocalReport): Promise<void>;
  listReports?(): Promise<readonly LocalReport[]>;
  readReport?(reportId: string): Promise<LocalReport>;
  deleteReport?(reportId: string): Promise<void>;
  close(): Promise<void>;
}

export interface WorkerLoadCheckpoint {
  readonly slotId: string;
  readonly savedAtIso: string;
  readonly tick: number;
  readonly year: number;
  readonly captureSequence: number;
  readonly sourceKind: "manual" | "autosave";
  readonly skippedCorruptRecords: number;
}

export interface WorkerLoadCandidate {
  readonly state: GameState;
  readonly nextQueueSequence: number;
  readonly createdAtIso: string;
  readonly localStats: LocalStats;
  readonly checkpoint: WorkerLoadCheckpoint;
  promote(): Promise<WorkerSaveSessionInfo>;
  rollback(): Promise<void>;
}

export interface WorkerSlotSummary {
  readonly slotId: string;
  readonly revision: number;
  readonly tick: number;
  readonly savedAtIso: string;
  readonly sizeBytes: number;
  readonly verification: "unchecked";
}

export interface WorkerImportPreview {
  readonly token: string | null;
  readonly preview: SavePreview;
  readonly allocatedSlotId: string | null;
}

export interface WorkerImportConfirmation {
  readonly slotId: string;
  readonly revision: number;
  readonly tick: number;
  readonly savedAtIso: string;
  readonly sizeBytes: number;
  readonly appliedSettings: boolean;
  readonly settings: PlayerSettings | null;
}
