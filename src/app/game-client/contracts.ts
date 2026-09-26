import type { CommandResult, SimCommand } from "../../sim/commands/contracts.ts";
import type { PlayerSettings, SavePreview } from "../../save/contracts.ts";
import type { LocalReport } from "../../save/schema.ts";
import type { SimEvent } from "../../sim/events/contracts.ts";
import type {
  GridPoint,
  ModuleDefinitionId,
  ModuleInstanceId,
  Rotation,
} from "../../sim/core/types.ts";
import type { GridViewModel, UiSnapshot } from "./snapshots.ts";
import type { StoreConnectionStatus } from "./store.ts";
import type { WorkerReply, WorkerRequest } from "../worker/protocol.ts";

export type SaveReason = "manual" | "autosave" | "checkpoint" | "exit";

export interface SaveMetadata {
  slotId: string;
  savedAtIso: string;
  tick: number;
  sizeBytes: number;
}

export interface RecoverySummary {
  readonly slotId: string;
  readonly savedAtIso: string;
  readonly tick: number;
  readonly year: number;
  readonly captureSequence: number;
  readonly sourceKind: "manual" | "autosave";
  readonly skippedCorruptRecords: number;
  readonly lastKnownLiveTick?: number;
}

export interface SlotSummary {
  readonly slotId: string;
  readonly revision: number;
  readonly tick: number;
  readonly savedAtIso: string;
  readonly sizeBytes: number;
  readonly verification: "verified" | "unchecked";
}

export interface ImportPreviewResult {
  readonly token: string | null;
  readonly preview: SavePreview;
  readonly allocatedSlotId: string | null;
}

export interface ImportConfirmationResult extends SlotSummary {
  readonly appliedSettings: boolean;
  readonly settings: PlayerSettings | null;
}

export type GameClientControlNotice =
  | { readonly kind: "EVENTS_GAP"; readonly nextEventSequence: number }
  | { readonly kind: "TRANSPORT_DEGRADED"; readonly publicationSequence: number };

export interface GameClient {
  dispatch(command: SimCommand): Promise<CommandResult>;
  getSnapshot(): UiSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: SimEvent) => void): () => void;
  subscribeControl(listener: (notice: GameClientControlNotice) => void): () => void;
  getGridViewModel(): GridViewModel;
  requestSave(reason: SaveReason): Promise<SaveMetadata>;
  updateSettings(settings: PlayerSettings): Promise<void>;
  loadSlot(slotId: string): Promise<RecoverySummary>;
  recover(slotId: string): Promise<RecoverySummary>;
  continueHost(): Promise<void>;
  setPaused(paused: boolean): Promise<CommandResult>;
  setSpeed(speed: 1 | 2 | 4): Promise<CommandResult>;
  listSlots(): Promise<readonly SlotSummary[]>;
  getRecoverySummary(): RecoverySummary | null;
  previewImport(
    fileBytes: ArrayBuffer,
    destination?:
      { readonly kind: "new" } | { readonly kind: "overwrite"; readonly slotId: string },
  ): Promise<ImportPreviewResult>;
  confirmImport(
    token: string,
    destination: { readonly kind: "new" } | { readonly kind: "overwrite"; readonly slotId: string },
    expectedRevision: number | null,
    applySettings: boolean,
  ): Promise<ImportConfirmationResult>;
  exportSlot(slotId: string, expectedRevision: number): Promise<Uint8Array>;
  deleteSlot(slotId: string, expectedRevision: number): Promise<void>;
  createReport(): Promise<LocalReport>;
  listReports(): Promise<readonly LocalReport[]>;
  deleteReport(reportId: string): Promise<void>;
  getConnectionStatus(): StoreConnectionStatus;
  subscribeConnection(listener: () => void): () => void;
  destroy(): void;
}

export type GridInteractionMode =
  | { kind: "select" }
  | { kind: "place"; definitionId: ModuleDefinitionId; rotation: Rotation }
  | { kind: "route"; routeKind: "power" | "data" }
  | { kind: "blueprint"; blueprintId: string; rotation: Rotation };

export type GridIntent =
  | { kind: "HOVER_TILE"; position: GridPoint | null }
  | { kind: "SELECT_ENTITY"; entityId: string | null; additive: boolean }
  | { kind: "SELECT_RECT"; from: GridPoint; to: GridPoint; additive: boolean }
  | {
      kind: "REQUEST_PLACE_MODULE";
      definitionId: ModuleDefinitionId;
      position: GridPoint;
      rotation: Rotation;
    }
  | { kind: "REQUEST_MOVE_MODULE"; moduleInstanceId: ModuleInstanceId; position: GridPoint }
  | { kind: "REQUEST_ROTATE_MODULE"; moduleInstanceId: ModuleInstanceId; rotation: Rotation }
  | { kind: "REQUEST_REMOVE_SELECTION" }
  | {
      kind: "REQUEST_CONNECT_PORTS";
      from: { moduleInstanceId: ModuleInstanceId; portId: string };
      to: { moduleInstanceId: ModuleInstanceId; portId: string };
      preferredPath: GridPoint[];
    }
  | { kind: "CAMERA_CHANGED"; centerWorld: { x: number; y: number }; zoom: number };

export interface PixiGridAdapter {
  mount(container: HTMLElement): void;
  update(viewModel: GridViewModel): void;
  setInteractionMode(mode: GridInteractionMode): void;
  setReducedEffects(enabled: boolean): void;
  subscribeIntents(listener: (intent: GridIntent) => void): () => void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  destroy(): void;
}

// Compatibility names retain the public export surface while using the strict
// protocol that the production Worker actually validates and transports.
export type WorkerInboundMessage = WorkerRequest;
export type WorkerOutboundMessage = WorkerReply;
