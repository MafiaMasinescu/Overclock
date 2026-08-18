import type { CommandResult, SimCommand } from "../../sim/commands/contracts.ts";
import type { SimEvent } from "../../sim/events/contracts.ts";
import type {
  GridPoint,
  ModuleDefinitionId,
  ModuleInstanceId,
  Rotation,
} from "../../sim/core/types.ts";
import type { GridViewModel, UiSnapshot } from "./snapshots.ts";

export type SaveReason = "manual" | "autosave" | "checkpoint" | "exit";

export interface SaveMetadata {
  slotId: string;
  savedAtIso: string;
  tick: number;
  sizeBytes: number;
}

export interface GameClient {
  dispatch(command: SimCommand): Promise<CommandResult>;
  getSnapshot(): UiSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: SimEvent) => void): () => void;
  getGridViewModel(): GridViewModel;
  requestSave(reason: SaveReason): Promise<SaveMetadata>;
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

export type WorkerInboundMessage =
  | { kind: "INITIALIZE"; seed: string; contentVersion: string }
  | { kind: "LOAD_STATE"; payload: unknown }
  | { kind: "COMMAND"; command: SimCommand }
  | { kind: "STEP_DEBUG"; ticks: number }
  | { kind: "REQUEST_FULL_SNAPSHOT" }
  | { kind: "SHUTDOWN" };

export type WorkerOutboundMessage =
  | { kind: "READY"; snapshot: UiSnapshot; grid: GridViewModel }
  | { kind: "COMMAND_RESULT"; result: CommandResult }
  | { kind: "SNAPSHOT"; snapshot: UiSnapshot; grid: GridViewModel | null }
  | { kind: "EVENTS"; events: SimEvent[] }
  | { kind: "CHECKPOINT"; tick: number; stateHash: string }
  | { kind: "FATAL_ERROR"; errorCode: string; reportId: string };
