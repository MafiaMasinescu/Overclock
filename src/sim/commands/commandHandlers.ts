import type { GameState } from "../core/types.ts";
import type { SeededRng } from "../rng/seededRng.ts";
import type { SimCommand } from "./contracts.ts";

type CommandKind = SimCommand["kind"];
type CommandOfKind<Kind extends CommandKind> = Extract<SimCommand, { kind: Kind }>;
type DeepReadonly<Value> = Value extends null | boolean | number | string
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : never;

export interface CommandHandlerContext {
  state: GameState;
  rng: SeededRng;
}

export type CommandHandler<Kind extends CommandKind> = (
  context: CommandHandlerContext,
  command: DeepReadonly<CommandOfKind<Kind>>,
) => void;

export type CommandHandlerRegistry = {
  [Kind in CommandKind]?: CommandHandler<Kind>;
};

function invokeHandler<Kind extends CommandKind>(
  handler: CommandHandler<Kind> | undefined,
  context: CommandHandlerContext,
  command: DeepReadonly<CommandOfKind<Kind>>,
): boolean {
  if (handler === undefined) {
    return false;
  }
  handler(context, command);
  return true;
}

function assertNever(command: never): never {
  throw new Error(`Unhandled command kind: ${JSON.stringify(command)}`);
}

export function dispatchRegisteredCommand(
  handlers: CommandHandlerRegistry,
  context: CommandHandlerContext,
  command: SimCommand,
): boolean {
  switch (command.kind) {
    case "SET_PAUSED":
      return invokeHandler(handlers.SET_PAUSED, context, command);
    case "SET_SPEED":
      return invokeHandler(handlers.SET_SPEED, context, command);
    case "ENTER_DESIGN_MODE":
      return invokeHandler(handlers.ENTER_DESIGN_MODE, context, command);
    case "BUY_MODULE":
      return invokeHandler(handlers.BUY_MODULE, context, command);
    case "SELL_INVENTORY_ITEM":
      return invokeHandler(handlers.SELL_INVENTORY_ITEM, context, command);
    case "PLACE_MODULE":
      return invokeHandler(handlers.PLACE_MODULE, context, command);
    case "MOVE_MODULE":
      return invokeHandler(handlers.MOVE_MODULE, context, command);
    case "ROTATE_MODULE":
      return invokeHandler(handlers.ROTATE_MODULE, context, command);
    case "REMOVE_MODULE":
      return invokeHandler(handlers.REMOVE_MODULE, context, command);
    case "CONNECT_PORTS":
      return invokeHandler(handlers.CONNECT_PORTS, context, command);
    case "DISCONNECT_ROUTE":
      return invokeHandler(handlers.DISCONNECT_ROUTE, context, command);
    case "UNDO_DESIGN":
      return invokeHandler(handlers.UNDO_DESIGN, context, command);
    case "REDO_DESIGN":
      return invokeHandler(handlers.REDO_DESIGN, context, command);
    case "APPLY_DESIGN":
      return invokeHandler(handlers.APPLY_DESIGN, context, command);
    case "CANCEL_DESIGN":
      return invokeHandler(handlers.CANCEL_DESIGN, context, command);
    case "ACCEPT_TASK":
      return invokeHandler(handlers.ACCEPT_TASK, context, command);
    case "ALLOCATE_TASK":
      return invokeHandler(handlers.ALLOCATE_TASK, context, command);
    case "SET_TASK_HOLD":
      return invokeHandler(handlers.SET_TASK_HOLD, context, command);
    case "ABANDON_TASK":
      return invokeHandler(handlers.ABANDON_TASK, context, command);
    case "SET_OVERCLOCK_PROFILE":
      return invokeHandler(handlers.SET_OVERCLOCK_PROFILE, context, command);
    case "SET_MANUAL_OVERCLOCK":
      return invokeHandler(handlers.SET_MANUAL_OVERCLOCK, context, command);
    case "START_RESEARCH":
      return invokeHandler(handlers.START_RESEARCH, context, command);
    case "CANCEL_RESEARCH":
      return invokeHandler(handlers.CANCEL_RESEARCH, context, command);
    case "SAVE_BLUEPRINT":
      return invokeHandler(handlers.SAVE_BLUEPRINT, context, command);
    case "INSTANTIATE_BLUEPRINT":
      return invokeHandler(handlers.INSTANTIATE_BLUEPRINT, context, command);
    case "RENAME_BLUEPRINT":
      return invokeHandler(handlers.RENAME_BLUEPRINT, context, command);
    case "START_BENCHMARK":
      return invokeHandler(handlers.START_BENCHMARK, context, command);
    case "CANCEL_BENCHMARK":
      return invokeHandler(handlers.CANCEL_BENCHMARK, context, command);
    case "ACKNOWLEDGE_TUTORIAL_STEP":
      return invokeHandler(handlers.ACKNOWLEDGE_TUTORIAL_STEP, context, command);
    case "SET_GUIDANCE_MODE":
      return invokeHandler(handlers.SET_GUIDANCE_MODE, context, command);
    case "TRIGGER_DIAGNOSTIC_PULSE":
      return invokeHandler(handlers.TRIGGER_DIAGNOSTIC_PULSE, context, command);
    case "DEBUG_ADD_CASH":
      return invokeHandler(handlers.DEBUG_ADD_CASH, context, command);
    case "DEBUG_ADD_RESEARCH_DATA":
      return invokeHandler(handlers.DEBUG_ADD_RESEARCH_DATA, context, command);
    default:
      return assertNever(command);
  }
}
