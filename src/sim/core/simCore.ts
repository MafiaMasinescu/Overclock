import type { CommandHandlerRegistry } from "../commands/commandHandlers.ts";
import { CommandProcessor, SimulatorInvariantError } from "../commands/commandProcessor.ts";
import { CommandQueue } from "../commands/commandQueue.ts";
import { parseSimCommand } from "../commands/commandSchema.ts";
import type { CommandReceipt, CommandResult, SimCommand } from "../commands/contracts.ts";
import { canonicalSerialize } from "../replay/canonicalState.ts";
import { createSeededRngFromState } from "../rng/seededRng.ts";
import { assertValidInventoryEconomyState } from "../economy/inventoryEconomyState.ts";
import { assertValidDesignModeState } from "../design/designModeState.ts";
import { AuthoritativeState } from "./authoritativeState.ts";
import {
  TICK_SYSTEM_STAGE_ORDER,
  type TickSystemRegistry,
  type TickSystemStage,
} from "./tickSystems.ts";
import type { GameState } from "./types.ts";

const UINT32_MAX = 0xffff_ffff;

export type ClockCommand = Extract<SimCommand, { kind: "SET_PAUSED" | "SET_SPEED" }>;

export interface StepResult {
  readonly startTick: number;
  readonly endTick: number;
  readonly ticksExecuted: number;
  readonly simulatedSecondsAdvanced: number;
  readonly commandResults: readonly CommandResult[];
}

export type SimCoreCommandHandlerRegistry = Omit<
  CommandHandlerRegistry,
  "SET_PAUSED" | "SET_SPEED"
> & {
  readonly SET_PAUSED?: never;
  readonly SET_SPEED?: never;
};

export interface SimCoreOptions {
  initialState: GameState;
  commandHandlers?: SimCoreCommandHandlerRegistry;
  tickSystems?: TickSystemRegistry;
}

class TickSystemInvariantError extends SimulatorInvariantError {
  readonly tick: number;
  readonly stage: TickSystemStage;

  constructor(tick: number, stage: TickSystemStage, cause: unknown) {
    super(`tick-${tick}-${stage}`, cause);
    this.message = `Simulator invariant violation at tick ${tick} during stage ${stage}.`;
    this.tick = tick;
    this.stage = stage;
  }
}

function assertValidRngState(rngState: number): void {
  if (!Number.isInteger(rngState) || rngState < 0 || rngState > UINT32_MAX) {
    throw new Error("RNG state must remain an unsigned 32-bit integer.");
  }
}

function assertValidClockAndTick(state: GameState): void {
  if (!Number.isSafeInteger(state.tick) || state.tick < 0) {
    throw new Error("Simulation tick must be a nonnegative safe integer.");
  }
  if (!Number.isFinite(state.clock.simulatedSeconds) || state.clock.simulatedSeconds < 0) {
    throw new Error("Simulated seconds must be finite and nonnegative.");
  }
  if (state.clock.simulatedSeconds !== state.tick / 10) {
    throw new Error("Simulated seconds must be derived from completed simulation ticks.");
  }
  assertValidRngState(state.rngState);
}

function assertValidTickCount(ticks: number, currentTick: number): void {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError("Tick count must be a nonnegative safe integer.");
  }
  if (ticks > Number.MAX_SAFE_INTEGER - currentTick) {
    throw new RangeError("Requested ticks would exceed Number.MAX_SAFE_INTEGER.");
  }
}

function staleClockResult(command: ClockCommand, tick: number): CommandResult {
  return {
    commandId: command.commandId,
    accepted: false,
    rejectedAtTick: tick,
    code: "STALE_TICK",
    messageKey: "errors.stale-tick",
  };
}

function parseClockCommand(command: ClockCommand): ClockCommand {
  const parsed = parseSimCommand(command);
  if (parsed.kind !== "SET_PAUSED" && parsed.kind !== "SET_SPEED") {
    throw new TypeError("applyClockCommand accepts only SET_PAUSED or SET_SPEED.");
  }
  return parsed;
}

function hasRegisteredSystem(tickSystems: TickSystemRegistry): boolean {
  return TICK_SYSTEM_STAGE_ORDER.some((stage) => tickSystems[stage] !== undefined);
}

function createQueuedCommandHandlers(
  handlers: SimCoreCommandHandlerRegistry,
): CommandHandlerRegistry {
  const queuedHandlers: CommandHandlerRegistry = { ...handlers };
  delete queuedHandlers.SET_PAUSED;
  delete queuedHandlers.SET_SPEED;
  return Object.freeze(queuedHandlers);
}

function freezeSystemCandidate(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }

  for (const child of Object.values(value)) {
    freezeSystemCandidate(child);
  }
  Object.freeze(value);
}

export class SimCore {
  private readonly authoritativeState: AuthoritativeState;
  private readonly commandQueue: CommandQueue;
  private readonly commandProcessor: CommandProcessor;
  private readonly tickSystems: TickSystemRegistry;
  private readonly runsTickSystems: boolean;

  constructor({ initialState, commandHandlers, tickSystems = {} }: SimCoreOptions) {
    assertValidClockAndTick(initialState);
    assertValidDesignModeState(initialState);
    canonicalSerialize(initialState);

    this.authoritativeState = new AuthoritativeState(initialState);
    this.commandQueue = new CommandQueue();
    this.commandProcessor = new CommandProcessor(
      { initialState, handlers: createQueuedCommandHandlers(commandHandlers ?? {}) },
      { state: this.authoritativeState, queue: this.commandQueue },
    );
    this.tickSystems = Object.freeze({ ...tickSystems });
    this.runsTickSystems = hasRegisteredSystem(this.tickSystems);
  }

  get tick(): number {
    return this.authoritativeState.readInternal().tick;
  }

  enqueue(command: SimCommand): CommandReceipt {
    return this.commandProcessor.enqueue(command);
  }

  processPendingCommands(): readonly CommandResult[] {
    return this.commandProcessor.processQueuedCommands();
  }

  step(ticks = 1): StepResult {
    const startTick = this.tick;
    assertValidTickCount(ticks, startTick);

    if (ticks === 0) {
      return {
        startTick,
        endTick: startTick,
        ticksExecuted: 0,
        simulatedSecondsAdvanced: 0,
        commandResults: [],
      };
    }

    const commandResults: CommandResult[] = [];
    let ticksExecuted = 0;

    while (ticksExecuted < ticks) {
      commandResults.push(...this.commandProcessor.processQueuedCommands());
      this.executeTickSystemsAndCommit();
      ticksExecuted += 1;
    }

    return {
      startTick,
      endTick: this.tick,
      ticksExecuted,
      simulatedSecondsAdvanced: ticksExecuted / 10,
      commandResults,
    };
  }

  applyClockCommand(input: ClockCommand): CommandResult {
    const command = parseClockCommand(input);
    const current = this.authoritativeState.readInternal();
    const currentTick = current.tick;

    if (command.expectedTick !== undefined && command.expectedTick !== currentTick) {
      return staleClockResult(command, currentTick);
    }

    const clock =
      command.kind === "SET_PAUSED"
        ? { ...current.clock, paused: command.paused }
        : { ...current.clock, speed: command.speed };
    this.authoritativeState.commitOwned({ ...current, clock });

    return {
      commandId: command.commandId,
      accepted: true,
      appliedAtTick: currentTick,
    };
  }

  getStateForSave(): GameState {
    const snapshot = this.authoritativeState.snapshot();
    assertValidClockAndTick(snapshot);
    canonicalSerialize(snapshot);
    return snapshot;
  }

  private executeTickSystemsAndCommit(): void {
    const current = this.authoritativeState.readInternal();

    if (!this.runsTickSystems) {
      this.authoritativeState.commitOwned(this.completeTick(current));
      return;
    }

    const candidate = structuredClone(current);
    const candidateRng = createSeededRngFromState(candidate.rngState);
    let lastExecutedStage: TickSystemStage | undefined;

    for (const stage of TICK_SYSTEM_STAGE_ORDER) {
      const system = this.tickSystems[stage];
      if (system === undefined) {
        continue;
      }

      try {
        lastExecutedStage = stage;
        system({ state: candidate, rng: candidateRng });
        candidate.rngState = candidateRng.getState();
        this.assertSystemControlledFields(candidate, current);
        assertValidRngState(candidate.rngState);
        assertValidInventoryEconomyState(candidate);
        assertValidDesignModeState(candidate, current.facility.nextModuleInstanceSequence);
        canonicalSerialize(candidate);
      } catch (cause: unknown) {
        throw new TickSystemInvariantError(current.tick, stage, cause);
      }
    }

    if (lastExecutedStage === undefined) {
      throw new Error("Tick system registry unexpectedly contained no systems.");
    }

    try {
      freezeSystemCandidate(candidate);
      this.authoritativeState.commitOwned(this.completeTick(candidate));
    } catch (cause: unknown) {
      throw new TickSystemInvariantError(current.tick, lastExecutedStage, cause);
    }
  }

  private completeTick(candidate: GameState): GameState {
    const tick = candidate.tick + 1;
    const completed = {
      ...candidate,
      tick,
      clock: {
        ...candidate.clock,
        simulatedSeconds: tick / 10,
      },
    };
    assertValidClockAndTick(completed);
    return completed;
  }

  private assertSystemControlledFields(candidate: GameState, current: GameState): void {
    if (candidate.tick !== current.tick) {
      throw new Error("Tick systems must not alter the authoritative tick.");
    }
    if (
      candidate.clock.simulatedSeconds !== current.clock.simulatedSeconds ||
      candidate.clock.paused !== current.clock.paused ||
      candidate.clock.speed !== current.clock.speed
    ) {
      throw new Error("Tick systems must not alter host-controlled clock fields.");
    }
  }
}
