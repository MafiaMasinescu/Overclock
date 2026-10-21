import { parseSimCommand } from "../../sim/commands/commandSchema.ts";
import type { SimCommand } from "../../sim/commands/contracts.ts";
import type {
  GridPoint,
  ModuleDefinitionId,
  ModuleInstanceId,
  Rotation,
} from "../../sim/core/types.ts";

export function createEnterDesignModeCommand(): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "ENTER_DESIGN_MODE",
  });
}

export function createBuyModuleCommand(definitionId: ModuleDefinitionId): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "BUY_MODULE",
    definitionId,
    quantity: 1,
  });
}

export function createPlaceModuleCommand(
  definitionId: ModuleDefinitionId,
  position: GridPoint,
  rotation: Rotation,
): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "PLACE_MODULE",
    definitionId,
    position,
    rotation,
  });
}

export function createMoveModuleCommand(
  moduleInstanceId: ModuleInstanceId,
  position: GridPoint,
): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "MOVE_MODULE",
    moduleInstanceId,
    position,
  });
}

export function createRotateModuleCommand(
  moduleInstanceId: ModuleInstanceId,
  rotation: Rotation,
): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "ROTATE_MODULE",
    moduleInstanceId,
    rotation,
  });
}

export function createRemoveModuleCommand(moduleInstanceId: ModuleInstanceId): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "REMOVE_MODULE",
    moduleInstanceId,
  });
}

export function createDisconnectRouteCommand(routeId: string): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "DISCONNECT_ROUTE",
    routeId,
  });
}

export function createUndoDesignCommand(): SimCommand {
  return parseSimCommand({ commandId: crypto.randomUUID(), source: "player", kind: "UNDO_DESIGN" });
}

export function createRedoDesignCommand(): SimCommand {
  return parseSimCommand({ commandId: crypto.randomUUID(), source: "player", kind: "REDO_DESIGN" });
}

export function createApplyDesignCommand(
  expectedDraftRevision: number,
  acceptedCostUsd: number,
  acceptedDowntimeTicks: number,
): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision,
    acceptedCostUsd,
    acceptedDowntimeTicks,
  });
}

export function createCancelDesignCommand(): SimCommand {
  return parseSimCommand({
    commandId: crypto.randomUUID(),
    source: "player",
    kind: "CANCEL_DESIGN",
  });
}
