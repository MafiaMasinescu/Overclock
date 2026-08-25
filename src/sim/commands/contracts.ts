import type {
  BenchmarkDefinitionId,
  BlueprintId,
  GridPoint,
  GuidanceMode,
  ModuleDefinitionId,
  ModuleInstanceId,
  OverclockProfile,
  ResearchNodeId,
  Rotation,
  RouteId,
  SimulationSpeed,
  TaskDefinitionId,
  TaskInstanceId,
} from "../core/types.ts";

export type CommandSource = "player" | "tutorial" | "debug" | "replay";

export interface CommandMeta {
  commandId: string;
  source: CommandSource;
  expectedTick?: number;
}

export type SimCommand =
  | (CommandMeta & { kind: "SET_PAUSED"; paused: boolean })
  | (CommandMeta & { kind: "SET_SPEED"; speed: SimulationSpeed })
  | (CommandMeta & { kind: "ENTER_DESIGN_MODE" })
  | (CommandMeta & {
      kind: "BUY_MODULE";
      definitionId: ModuleDefinitionId;
      quantity: number;
    })
  | (CommandMeta & {
      kind: "SELL_INVENTORY_ITEM";
      definitionId: ModuleDefinitionId;
      quantity: number;
    })
  | (CommandMeta & {
      kind: "PLACE_MODULE";
      definitionId: ModuleDefinitionId;
      position: GridPoint;
      rotation: Rotation;
    })
  | (CommandMeta & {
      kind: "MOVE_MODULE";
      moduleInstanceId: ModuleInstanceId;
      position: GridPoint;
    })
  | (CommandMeta & {
      kind: "ROTATE_MODULE";
      moduleInstanceId: ModuleInstanceId;
      rotation: Rotation;
    })
  | (CommandMeta & {
      kind: "REMOVE_MODULE";
      moduleInstanceId: ModuleInstanceId;
    })
  | (CommandMeta & {
      kind: "CONNECT_PORTS";
      from: { moduleInstanceId: ModuleInstanceId; portId: string };
      to: { moduleInstanceId: ModuleInstanceId; portId: string };
      path: GridPoint[];
    })
  | (CommandMeta & { kind: "DISCONNECT_ROUTE"; routeId: RouteId })
  | (CommandMeta & { kind: "UNDO_DESIGN" })
  | (CommandMeta & { kind: "REDO_DESIGN" })
  | (CommandMeta & {
      kind: "APPLY_DESIGN";
      expectedDraftRevision: number;
      acceptedCostUsd: number;
      acceptedDowntimeTicks: number;
    })
  | (CommandMeta & { kind: "CANCEL_DESIGN" })
  | (CommandMeta & {
      kind: "ACCEPT_TASK";
      definitionId: TaskDefinitionId;
    })
  | (CommandMeta & {
      kind: "ALLOCATE_TASK";
      taskInstanceId: TaskInstanceId;
      clusterModuleIds: ModuleInstanceId[];
      requestedShare: number;
    })
  | (CommandMeta & {
      kind: "SET_TASK_HOLD";
      taskInstanceId: TaskInstanceId;
      hold: boolean;
    })
  | (CommandMeta & {
      kind: "ABANDON_TASK";
      taskInstanceId: TaskInstanceId;
    })
  | (CommandMeta & {
      kind: "SET_OVERCLOCK_PROFILE";
      moduleInstanceIds: ModuleInstanceId[];
      profile: Exclude<OverclockProfile, "manual">;
    })
  | (CommandMeta & {
      kind: "SET_MANUAL_OVERCLOCK";
      moduleInstanceIds: ModuleInstanceId[];
      frequencyRatio: number;
      voltageRatio: number;
    })
  | (CommandMeta & {
      kind: "START_RESEARCH";
      nodeId: ResearchNodeId;
      reservedComputeShare: number;
    })
  | (CommandMeta & { kind: "CANCEL_RESEARCH"; nodeId: ResearchNodeId })
  | (CommandMeta & {
      kind: "SAVE_BLUEPRINT";
      name: string;
      selectedModuleIds: ModuleInstanceId[];
    })
  | (CommandMeta & {
      kind: "INSTANTIATE_BLUEPRINT";
      blueprintId: BlueprintId;
      position: GridPoint;
      rotation: Rotation;
    })
  | (CommandMeta & {
      kind: "RENAME_BLUEPRINT";
      blueprintId: BlueprintId;
      name: string;
    })
  | (CommandMeta & {
      kind: "START_BENCHMARK";
      benchmarkId: BenchmarkDefinitionId;
      clusterModuleIds: ModuleInstanceId[];
    })
  | (CommandMeta & { kind: "CANCEL_BENCHMARK" })
  | (CommandMeta & {
      kind: "ACKNOWLEDGE_TUTORIAL_STEP";
      stepId: string;
    })
  | (CommandMeta & { kind: "SET_GUIDANCE_MODE"; mode: GuidanceMode })
  | (CommandMeta & {
      kind: "TRIGGER_DIAGNOSTIC_PULSE";
      moduleInstanceId: ModuleInstanceId | null;
    })
  | (CommandMeta & {
      kind: "DEBUG_ADD_CASH";
      amountUsd: number;
    })
  | (CommandMeta & {
      kind: "DEBUG_ADD_RESEARCH_DATA";
      amount: number;
    });

export type CommandRejectionCode =
  | "INVALID_PAYLOAD"
  | "STALE_TICK"
  | "NOT_IN_DESIGN_MODE"
  | "ALREADY_IN_DESIGN_MODE"
  | "STALE_DRAFT_REVISION"
  | "STALE_DESIGN_PREVIEW"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_INVENTORY"
  | "RESEARCH_REQUIRED"
  | "OUT_OF_BOUNDS"
  | "TILE_OCCUPIED"
  | "INVALID_PORT"
  | "INCOMPATIBLE_PORTS"
  | "INVALID_ROUTE"
  | "NO_ROUTE_FOUND"
  | "INVALID_SYSTEM"
  | "TASK_SLOT_LIMIT"
  | "TASK_REQUIREMENT_MISSING"
  | "TASK_NOT_ACTIVE"
  | "RESEARCH_NOT_AVAILABLE"
  | "RESEARCH_ALREADY_ACTIVE"
  | "OVERCLOCK_OUT_OF_RANGE"
  | "BLUEPRINT_INVALID"
  | "BENCHMARK_ALREADY_ACTIVE"
  | "BENCHMARK_REQUIREMENT_MISSING"
  | "COMMAND_NOT_AVAILABLE";

export interface CommandReceipt {
  commandId: string;
  queued: boolean;
  queueSequence: number | null;
}

export type CommandResult =
  | {
      commandId: string;
      accepted: true;
      appliedAtTick: number;
    }
  | {
      commandId: string;
      accepted: false;
      rejectedAtTick: number;
      code: CommandRejectionCode;
      messageKey: string;
      parameters?: Record<string, string | number | boolean>;
    };
