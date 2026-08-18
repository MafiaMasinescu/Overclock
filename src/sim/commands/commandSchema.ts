import { z } from "zod";

import { canonicalSerialize } from "../replay/canonicalState.ts";
import type { SimCommand } from "./contracts.ts";

const finiteNumberSchema = z.number();
const integerSchema = finiteNumberSchema.int();
const expectedTickSchema = integerSchema.nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifierSchema = z.string();
const identifierArraySchema = z.array(identifierSchema);
const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const gridPointSchema = z.strictObject({ x: integerSchema, y: integerSchema });
const portRefSchema = z.strictObject({
  moduleInstanceId: identifierSchema,
  portId: identifierSchema,
});
const commandMetaShape = {
  commandId: z.uuid(),
  source: z.enum(["player", "tutorial", "debug", "replay"]),
  expectedTick: expectedTickSchema.optional(),
};

const setPausedSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SET_PAUSED"),
  paused: z.boolean(),
});
const setSpeedSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SET_SPEED"),
  speed: z.union([z.literal(1), z.literal(2), z.literal(4)]),
});
const enterDesignModeSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("ENTER_DESIGN_MODE"),
});
const buyModuleSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("BUY_MODULE"),
  definitionId: identifierSchema,
  quantity: integerSchema,
});
const sellInventoryItemSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SELL_INVENTORY_ITEM"),
  definitionId: identifierSchema,
  quantity: integerSchema,
});
const placeModuleSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("PLACE_MODULE"),
  definitionId: identifierSchema,
  position: gridPointSchema,
  rotation: rotationSchema,
});
const moveModuleSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("MOVE_MODULE"),
  moduleInstanceId: identifierSchema,
  position: gridPointSchema,
});
const rotateModuleSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("ROTATE_MODULE"),
  moduleInstanceId: identifierSchema,
  rotation: rotationSchema,
});
const removeModuleSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("REMOVE_MODULE"),
  moduleInstanceId: identifierSchema,
});
const connectPortsSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("CONNECT_PORTS"),
  from: portRefSchema,
  to: portRefSchema,
  path: z.array(gridPointSchema),
});
const disconnectRouteSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("DISCONNECT_ROUTE"),
  routeId: identifierSchema,
});
const undoDesignSchema = z.strictObject({ ...commandMetaShape, kind: z.literal("UNDO_DESIGN") });
const redoDesignSchema = z.strictObject({ ...commandMetaShape, kind: z.literal("REDO_DESIGN") });
const applyDesignSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("APPLY_DESIGN"),
  expectedDraftRevision: integerSchema,
  acceptedCostUsd: finiteNumberSchema,
  acceptedDowntimeTicks: integerSchema,
});
const cancelDesignSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("CANCEL_DESIGN"),
});
const acceptTaskSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("ACCEPT_TASK"),
  definitionId: identifierSchema,
});
const allocateTaskSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("ALLOCATE_TASK"),
  taskInstanceId: identifierSchema,
  clusterModuleIds: identifierArraySchema,
  requestedShare: finiteNumberSchema,
});
const setTaskHoldSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SET_TASK_HOLD"),
  taskInstanceId: identifierSchema,
  hold: z.boolean(),
});
const abandonTaskSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("ABANDON_TASK"),
  taskInstanceId: identifierSchema,
});
const setOverclockProfileSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SET_OVERCLOCK_PROFILE"),
  moduleInstanceIds: identifierArraySchema,
  profile: z.enum(["eco", "balanced", "boost"]),
});
const setManualOverclockSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SET_MANUAL_OVERCLOCK"),
  moduleInstanceIds: identifierArraySchema,
  frequencyRatio: finiteNumberSchema,
  voltageRatio: finiteNumberSchema,
});
const startResearchSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("START_RESEARCH"),
  nodeId: identifierSchema,
  reservedComputeShare: finiteNumberSchema,
});
const cancelResearchSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("CANCEL_RESEARCH"),
  nodeId: identifierSchema,
});
const saveBlueprintSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SAVE_BLUEPRINT"),
  name: z.string(),
  selectedModuleIds: identifierArraySchema,
});
const instantiateBlueprintSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("INSTANTIATE_BLUEPRINT"),
  blueprintId: identifierSchema,
  position: gridPointSchema,
  rotation: rotationSchema,
});
const renameBlueprintSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("RENAME_BLUEPRINT"),
  blueprintId: identifierSchema,
  name: z.string(),
});
const startBenchmarkSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("START_BENCHMARK"),
  benchmarkId: identifierSchema,
  clusterModuleIds: identifierArraySchema,
});
const cancelBenchmarkSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("CANCEL_BENCHMARK"),
});
const acknowledgeTutorialStepSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("ACKNOWLEDGE_TUTORIAL_STEP"),
  stepId: identifierSchema,
});
const setGuidanceModeSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("SET_GUIDANCE_MODE"),
  mode: z.enum(["simple", "engineering", "skip"]),
});
const triggerDiagnosticPulseSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("TRIGGER_DIAGNOSTIC_PULSE"),
  moduleInstanceId: identifierSchema.nullable(),
});
const debugAddCashSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("DEBUG_ADD_CASH"),
  amountUsd: finiteNumberSchema,
});
const debugAddResearchDataSchema = z.strictObject({
  ...commandMetaShape,
  kind: z.literal("DEBUG_ADD_RESEARCH_DATA"),
  amount: finiteNumberSchema,
});

export const simCommandSchema = z.discriminatedUnion("kind", [
  setPausedSchema,
  setSpeedSchema,
  enterDesignModeSchema,
  buyModuleSchema,
  sellInventoryItemSchema,
  placeModuleSchema,
  moveModuleSchema,
  rotateModuleSchema,
  removeModuleSchema,
  connectPortsSchema,
  disconnectRouteSchema,
  undoDesignSchema,
  redoDesignSchema,
  applyDesignSchema,
  cancelDesignSchema,
  acceptTaskSchema,
  allocateTaskSchema,
  setTaskHoldSchema,
  abandonTaskSchema,
  setOverclockProfileSchema,
  setManualOverclockSchema,
  startResearchSchema,
  cancelResearchSchema,
  saveBlueprintSchema,
  instantiateBlueprintSchema,
  renameBlueprintSchema,
  startBenchmarkSchema,
  cancelBenchmarkSchema,
  acknowledgeTutorialStepSchema,
  setGuidanceModeSchema,
  triggerDiagnosticPulseSchema,
  debugAddCashSchema,
  debugAddResearchDataSchema,
]);

type ParsedSimCommand = z.infer<typeof simCommandSchema>;

function hasExactOptionalExpectedTick(command: ParsedSimCommand): command is SimCommand {
  return !("expectedTick" in command) || command.expectedTick !== undefined;
}

export function parseSimCommand(input: unknown): SimCommand {
  canonicalSerialize(input);
  const command = simCommandSchema.parse(input);
  if (!hasExactOptionalExpectedTick(command)) {
    throw new Error("Command expectedTick must be omitted instead of undefined.");
  }
  return command;
}
