import type { CommandHandlerRegistry } from "../commands/commandHandlers.ts";
import { CommandProcessor, SimulatorInvariantError } from "../commands/commandProcessor.ts";
import { CommandQueue } from "../commands/commandQueue.ts";
import { parseSimCommand } from "../commands/commandSchema.ts";
import type { CommandReceipt, CommandResult, SimCommand } from "../commands/contracts.ts";
import { assertCanonicalSerializable } from "../replay/canonicalState.ts";
import { createSeededRngFromState } from "../rng/seededRng.ts";
import { assertValidInventoryEconomyState } from "../economy/inventoryEconomyState.ts";
import { assertValidStoredComputeState } from "../compute/computeState.ts";
import { assertValidDesignModeState } from "../design/designModeState.ts";
import { AuthoritativeState } from "./authoritativeState.ts";
import {
  TICK_SYSTEM_STAGE_ORDER,
  type TickSystemRegistration,
  type TickSystemRegistry,
  type TickSystemRuntime,
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

type TickSystemRuntimeRegistry = Readonly<Partial<Record<TickSystemStage, TickSystemRuntime>>>;

interface ComputeOwnedDeliveryProjection {
  readonly byTask: Readonly<Record<string, number>>;
  readonly allocationCount: number;
}

function captureComputeOwnedDeliveries(
  instances: Readonly<GameState["tasks"]["instances"]>,
): ComputeOwnedDeliveryProjection {
  const byTask: Record<string, number> = {};
  let allocationCount = 0;
  for (const taskId in instances) {
    if (!Object.hasOwn(instances, taskId)) continue;
    const allocation = instances[taskId]?.allocation;
    if (allocation === null || allocation === undefined) continue;
    byTask[taskId] = allocation.deliveredUsefulComputeFlops;
    allocationCount += 1;
  }
  return Object.freeze({ byTask: Object.freeze(byTask), allocationCount });
}

function preservesComputeOwnedDeliveries(
  instances: Readonly<GameState["tasks"]["instances"]>,
  expected: ComputeOwnedDeliveryProjection,
): boolean {
  let allocationCount = 0;
  for (const taskId in instances) {
    if (!Object.hasOwn(instances, taskId)) continue;
    const allocation = instances[taskId]?.allocation;
    if (allocation === null || allocation === undefined) continue;
    allocationCount += 1;
    if (
      !Object.hasOwn(expected.byTask, taskId) ||
      !Object.is(expected.byTask[taskId], allocation.deliveredUsefulComputeFlops)
    ) {
      return false;
    }
  }
  return allocationCount === expected.allocationCount;
}

function hasRegisteredSystem(tickSystems: TickSystemRuntimeRegistry): boolean {
  return TICK_SYSTEM_STAGE_ORDER.some((stage) => tickSystems[stage] !== undefined);
}

function createTickSystemRuntime(registration: TickSystemRegistration): TickSystemRuntime {
  return typeof registration === "function"
    ? { executionMode: "mutable-clone", run: registration }
    : registration.createRuntime();
}

function createTickSystemRuntimes(tickSystems: TickSystemRegistry): TickSystemRuntimeRegistry {
  const runtimes: Partial<Record<TickSystemStage, TickSystemRuntime>> = {};
  for (const stage of TICK_SYSTEM_STAGE_ORDER) {
    const registration = tickSystems[stage];
    if (registration !== undefined) runtimes[stage] = createTickSystemRuntime(registration);
  }
  return Object.freeze(runtimes);
}

function createQueuedCommandHandlers(
  handlers: SimCoreCommandHandlerRegistry,
): CommandHandlerRegistry {
  const queuedHandlers: CommandHandlerRegistry = { ...handlers };
  delete queuedHandlers.SET_PAUSED;
  delete queuedHandlers.SET_SPEED;
  return Object.freeze(queuedHandlers);
}

export class SimCore {
  private readonly authoritativeState: AuthoritativeState;
  private readonly commandQueue: CommandQueue;
  private readonly commandProcessor: CommandProcessor;
  private readonly tickSystems: TickSystemRuntimeRegistry;
  private readonly runsTickSystems: boolean;
  private readonly runsMutableTickSystems: boolean;

  constructor({ initialState, commandHandlers, tickSystems = {} }: SimCoreOptions) {
    assertValidClockAndTick(initialState);
    assertValidStoredComputeState(initialState);
    assertValidDesignModeState(initialState);
    assertCanonicalSerializable(initialState);

    this.authoritativeState = new AuthoritativeState(initialState);
    this.commandQueue = new CommandQueue();
    this.commandProcessor = new CommandProcessor(
      { initialState, handlers: createQueuedCommandHandlers(commandHandlers ?? {}) },
      { state: this.authoritativeState, queue: this.commandQueue },
    );
    this.tickSystems = createTickSystemRuntimes(Object.freeze({ ...tickSystems }));
    this.runsTickSystems = hasRegisteredSystem(this.tickSystems);
    this.runsMutableTickSystems = TICK_SYSTEM_STAGE_ORDER.some(
      (stage) => this.tickSystems[stage]?.executionMode === "mutable-clone",
    );
    const ownedInitialState = this.authoritativeState.readInternal();
    for (const stage of TICK_SYSTEM_STAGE_ORDER) {
      const runtime = this.tickSystems[stage];
      runtime?.clearDerivedState?.();
      runtime?.validateLifecycleState?.(ownedInitialState);
    }
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
    assertValidStoredComputeState(snapshot);
    assertCanonicalSerializable(snapshot);
    return snapshot;
  }

  replaceState(state: GameState): void {
    if (this.commandProcessor.pendingCommandCount !== 0) {
      throw new Error("Cannot replace simulator state while commands are pending.");
    }
    assertValidClockAndTick(state);
    assertValidStoredComputeState(state);
    assertValidInventoryEconomyState(state);
    assertValidDesignModeState(state);
    assertCanonicalSerializable(state);
    for (const stage of TICK_SYSTEM_STAGE_ORDER) {
      this.tickSystems[stage]?.validateLifecycleState?.(state);
    }
    this.authoritativeState.replaceSnapshot(state);
    for (const stage of TICK_SYSTEM_STAGE_ORDER) {
      this.tickSystems[stage]?.clearDerivedState?.();
    }
  }

  private executeTickSystemsAndCommit(): void {
    const current = this.authoritativeState.readInternal();

    if (!this.runsTickSystems) {
      this.authoritativeState.commitOwned(this.completeTick(current));
      return;
    }

    let candidate = this.runsMutableTickSystems ? structuredClone(current) : current;
    const candidateRng = createSeededRngFromState(candidate.rngState);
    let lastExecutedStage: TickSystemStage | undefined;
    let validatedCompute = current.facility.compute;
    let validatedTaskInstances = current.tasks.instances;
    let computeOwnedDeliveries: ComputeOwnedDeliveryProjection | undefined;

    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in every production tick.
    for (let stageIndex = 0; stageIndex < TICK_SYSTEM_STAGE_ORDER.length; stageIndex += 1) {
      const stage = TICK_SYSTEM_STAGE_ORDER[stageIndex];
      if (stage === undefined) throw new Error("Tick stage coverage is incomplete.");
      const system = this.tickSystems[stage];
      if (system === undefined) {
        continue;
      }

      try {
        lastExecutedStage = stage;
        if (system.executionMode === "structural-sharing") {
          candidate = system.run({ state: candidate, rng: candidateRng });
        } else {
          system.run({ state: candidate, rng: candidateRng });
        }
        const nextRngState = candidateRng.getState();
        if (candidate.rngState !== nextRngState) {
          candidate = { ...candidate, rngState: nextRngState };
        }
        if (stage === "calculate-theoretical-and-useful-compute") {
          computeOwnedDeliveries = captureComputeOwnedDeliveries(candidate.tasks.instances);
        } else if (
          computeOwnedDeliveries !== undefined &&
          !preservesComputeOwnedDeliveries(candidate.tasks.instances, computeOwnedDeliveries)
        ) {
          throw new Error("Later tick stages must preserve Compute-owned task delivery outputs.");
        }
        this.assertSystemControlledFields(candidate, current);
        assertValidRngState(candidate.rngState);
        // Stored Compute is historical state. Structural-sharing stages cannot mutate its frozen
        // branch in place, so revalidating it after an unrelated Power/Thermal stage adds no
        // coverage. Revalidate immediately when either relevant branch changes; mutable-clone
        // pipelines remain conservatively checked after every stage.
        if (
          this.runsMutableTickSystems ||
          candidate.facility.compute !== validatedCompute ||
          candidate.tasks.instances !== validatedTaskInstances
        ) {
          assertValidStoredComputeState(candidate);
          validatedCompute = candidate.facility.compute;
          validatedTaskInstances = candidate.tasks.instances;
        }
        if (this.runsMutableTickSystems) {
          assertValidInventoryEconomyState(candidate);
          assertValidDesignModeState(
            candidate,
            current.facility.nextModuleInstanceSequence,
            current.facility.nextRouteSequence,
          );
          assertCanonicalSerializable(candidate);
        }
      } catch (cause: unknown) {
        throw new TickSystemInvariantError(current.tick, stage, cause);
      }
    }

    if (lastExecutedStage === undefined) {
      throw new Error("Tick system registry unexpectedly contained no systems.");
    }

    try {
      // The loop validated the final Compute and task branches after the last stage that changed
      // either identity. Completing a tick changes only host-owned tick/clock fields, so repeating
      // the allocation-heavy structural Compute validation here adds no corruption coverage.
      this.authoritativeState.commitOwned(this.completeTick(candidate, true));
    } catch (cause: unknown) {
      throw new TickSystemInvariantError(current.tick, lastExecutedStage, cause);
    }
  }

  private completeTick(candidate: GameState, computeAlreadyValidated = false): GameState {
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
    if (!computeAlreadyValidated) assertValidStoredComputeState(completed);
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
