import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { CommandHandlerRegistry } from "../../src/sim/commands/commandHandlers.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore, type SimCoreCommandHandlerRegistry } from "../../src/sim/core/simCore.ts";
import {
  TICK_STAGE_ORDER,
  TICK_SYSTEM_STAGE_ORDER,
  type TickSystem,
  type TickSystemRegistry,
} from "../../src/sim/core/tickSystems.ts";
import type { GameState } from "../../src/sim/core/types.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";

const IDS = {
  first: "00000000-0000-4000-8000-000000000001",
  second: "00000000-0000-4000-8000-000000000002",
  third: "00000000-0000-4000-8000-000000000003",
} as const;

function createState(seed = "tick-pipeline"): GameState {
  return createInitialGameState({ content: loadContentBundle(), seed });
}

function guidanceCommand(
  commandId: string,
  expectedTick?: number,
): Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> {
  const command: Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> = {
    commandId,
    source: "player",
    kind: "SET_GUIDANCE_MODE",
    mode: "engineering",
  };
  if (expectedTick !== undefined) {
    command.expectedTick = expectedTick;
  }
  return command;
}

function pausedCommand(
  commandId: string,
  paused: boolean,
  expectedTick?: number,
): Extract<SimCommand, { kind: "SET_PAUSED" }> {
  const command: Extract<SimCommand, { kind: "SET_PAUSED" }> = {
    commandId,
    source: "player",
    kind: "SET_PAUSED",
    paused,
  };
  if (expectedTick !== undefined) {
    command.expectedTick = expectedTick;
  }
  return command;
}

function speedCommand(
  commandId: string,
  speed: 1 | 2 | 4,
  expectedTick?: number,
): Extract<SimCommand, { kind: "SET_SPEED" }> {
  const command: Extract<SimCommand, { kind: "SET_SPEED" }> = {
    commandId,
    source: "player",
    kind: "SET_SPEED",
    speed,
  };
  if (expectedTick !== undefined) {
    command.expectedTick = expectedTick;
  }
  return command;
}

function recordingCommandHandlers(): SimCoreCommandHandlerRegistry {
  return {
    SET_GUIDANCE_MODE({ state, rng }, command) {
      state.achievements.unlockedIds.push(command.commandId);
      rng.nextUint32();
    },
  };
}

function stateWithoutCompletedTime(state: GameState): GameState {
  return {
    ...state,
    tick: 0,
    clock: { ...state.clock, simulatedSeconds: 0 },
  };
}

describe("fixed-step SimCore", () => {
  test("defaults step() to one completed 100 ms tick", () => {
    const core = new SimCore({ initialState: createState() });

    expect(core.step()).toEqual({
      startTick: 0,
      endTick: 1,
      ticksExecuted: 1,
      simulatedSecondsAdvanced: 0.1,
      commandResults: [],
    });
    expect(core.tick).toBe(1);
    expect(core.getStateForSave().clock.simulatedSeconds).toBe(0.1);
  });

  test.each([
    [10, 1],
    [1_000, 100],
  ])("derives simulated seconds from %i completed ticks", (ticks, simulatedSeconds) => {
    const core = new SimCore({ initialState: createState() });

    core.step(ticks);

    expect(core.tick).toBe(ticks);
    expect(core.getStateForSave().clock.simulatedSeconds).toBe(simulatedSeconds);
  });

  test("treats step(0) as a complete no-op, including queued commands", () => {
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: recordingCommandHandlers(),
    });
    core.enqueue(guidanceCommand(IDS.first, 0));
    const before = core.getStateForSave();

    expect(core.step(0)).toEqual({
      startTick: 0,
      endTick: 0,
      ticksExecuted: 0,
      simulatedSecondsAdvanced: 0,
      commandResults: [],
    });
    expect(core.getStateForSave()).toEqual(before);
    expect(core.processPendingCommands()).toEqual([
      { commandId: IDS.first, accepted: true, appliedAtTick: 0 },
    ]);
  });

  test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid tick count %s before state or queue mutation",
    (ticks) => {
      const core = new SimCore({
        initialState: createState(),
        commandHandlers: recordingCommandHandlers(),
      });
      core.enqueue(guidanceCommand(IDS.first));
      const before = core.getStateForSave();

      expect(() => core.step(ticks)).toThrow();
      expect(core.getStateForSave()).toEqual(before);
      expect(core.processPendingCommands()).toHaveLength(1);
    },
  );

  test("rejects a non-number tick count before state or queue mutation", () => {
    const core = new SimCore({ initialState: createState() });
    const invalidStep = core.step.bind(core) as (ticks: unknown) => unknown;

    expect(() => invalidStep("1")).toThrow();
    expect(core.tick).toBe(0);
  });

  test("rejects tick overflow before state or queue mutation", () => {
    const state = createState();
    state.tick = Number.MAX_SAFE_INTEGER;
    state.clock.simulatedSeconds = Number.MAX_SAFE_INTEGER / 10;
    const core = new SimCore({ initialState: state, commandHandlers: recordingCommandHandlers() });
    core.enqueue(guidanceCommand(IDS.first, Number.MAX_SAFE_INTEGER));

    expect(() => core.step(1)).toThrow();
    expect(core.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(core.processPendingCommands()).toHaveLength(1);
  });

  test("produces the same state for step(4) and four step(1) calls", () => {
    const grouped = new SimCore({ initialState: createState("group-four") });
    const separate = new SimCore({ initialState: createState("group-four") });

    grouped.step(4);
    for (let count = 0; count < 4; count += 1) {
      separate.step(1);
    }

    expect(grouped.getStateForSave()).toEqual(separate.getStateForSave());
  });

  test("produces the same state for one large step and mixed smaller groups", () => {
    const large = new SimCore({ initialState: createState("mixed-groups") });
    const mixed = new SimCore({ initialState: createState("mixed-groups") });

    large.step(1_000);
    for (const ticks of [1, 7, 32, 160, 300, 500]) {
      mixed.step(ticks);
    }

    expect(hashCanonicalState(large.getStateForSave())).toBe(
      hashCanonicalState(mixed.getStateForSave()),
    );
  });

  test("processes commands before tick systems at the current tick", () => {
    const observations: { tick: number; appliedIds: string[] }[] = [];
    const tickSystems: TickSystemRegistry = {
      "rebuild-dirty-connectivity"({ state }) {
        observations.push({ tick: state.tick, appliedIds: [...state.achievements.unlockedIds] });
      },
    };
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: recordingCommandHandlers(),
      tickSystems,
    });
    core.enqueue(guidanceCommand(IDS.first, 0));

    const result = core.step(1);

    expect(result.commandResults).toEqual([
      { commandId: IDS.first, accepted: true, appliedAtTick: 0 },
    ]);
    expect(observations).toEqual([{ tick: 0, appliedIds: [IDS.first] }]);
  });

  test("drains every queued command during the first requested tick in FIFO order", () => {
    const observedCounts: number[] = [];
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: recordingCommandHandlers(),
      tickSystems: {
        "rebuild-dirty-connectivity"({ state }) {
          observedCounts.push(state.achievements.unlockedIds.length);
        },
      },
    });
    core.enqueue(guidanceCommand(IDS.first));
    core.enqueue(guidanceCommand(IDS.second));
    core.enqueue(guidanceCommand(IDS.third));

    const result = core.step(3);

    expect(result.commandResults.map(({ commandId }) => commandId)).toEqual([
      IDS.first,
      IDS.second,
      IDS.third,
    ]);
    expect(observedCounts).toEqual([3, 3, 3]);
  });

  test("continues a tick after a recoverable command rejection", () => {
    const core = new SimCore({ initialState: createState() });
    core.enqueue(guidanceCommand(IDS.first));

    const result = core.step();

    expect(result.commandResults).toEqual([
      {
        commandId: IDS.first,
        accepted: false,
        rejectedAtTick: 0,
        code: "COMMAND_NOT_AVAILABLE",
        messageKey: "errors.command-not-available",
      },
    ]);
    expect(core.tick).toBe(1);
  });

  test("stops before tick systems when command processing fails fatally", () => {
    let systemRuns = 0;
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: {
        SET_GUIDANCE_MODE() {
          throw new Error("fatal command fixture");
        },
      },
      tickSystems: {
        "rebuild-dirty-connectivity"() {
          systemRuns += 1;
        },
      },
    });
    core.enqueue(guidanceCommand(IDS.first));

    expect(() => core.step()).toThrow(SimulatorInvariantError);
    expect(systemRuns).toBe(0);
    expect(core.tick).toBe(0);
  });

  test("processes pending commands while paused without advancing time", () => {
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: recordingCommandHandlers(),
    });
    core.enqueue(guidanceCommand(IDS.first, 0));

    expect(core.processPendingCommands()).toEqual([
      { commandId: IDS.first, accepted: true, appliedAtTick: 0 },
    ]);
    expect(core.tick).toBe(0);
    expect(core.getStateForSave().clock).toEqual({ paused: true, speed: 1, simulatedSeconds: 0 });
  });

  test("manual step advances while paused", () => {
    const core = new SimCore({ initialState: createState() });

    core.step();

    expect(core.tick).toBe(1);
    expect(core.getStateForSave().clock.paused).toBe(true);
  });

  test.each([1, 2, 4] as const)("speed %i does not alter fixed tick duration", (speed) => {
    const state = createState();
    state.clock.speed = speed;
    const core = new SimCore({ initialState: state });

    core.step(10);

    expect(core.getStateForSave().clock).toEqual({ paused: true, speed, simulatedSeconds: 1 });
  });

  test("applies SET_PAUSED synchronously and idempotently at the current tick", () => {
    const core = new SimCore({ initialState: createState() });

    expect(core.applyClockCommand(pausedCommand(IDS.first, false, 0))).toEqual({
      commandId: IDS.first,
      accepted: true,
      appliedAtTick: 0,
    });
    expect(core.applyClockCommand(pausedCommand(IDS.second, false, 0))).toEqual({
      commandId: IDS.second,
      accepted: true,
      appliedAtTick: 0,
    });
    expect(core.getStateForSave().clock.paused).toBe(false);
  });

  test.each([1, 2, 4] as const)("applies SET_SPEED %i synchronously", (speed) => {
    const core = new SimCore({ initialState: createState() });

    expect(core.applyClockCommand(speedCommand(IDS.first, speed))).toEqual({
      commandId: IDS.first,
      accepted: true,
      appliedAtTick: 0,
    });
    expect(core.getStateForSave().clock.speed).toBe(speed);
  });

  test("rejects stale clock commands without changing state or RNG", () => {
    const core = new SimCore({ initialState: createState() });
    const before = core.getStateForSave();

    expect(core.applyClockCommand(speedCommand(IDS.first, 4, 1))).toEqual({
      commandId: IDS.first,
      accepted: false,
      rejectedAtTick: 0,
      code: "STALE_TICK",
      messageKey: "errors.stale-tick",
    });
    expect(core.getStateForSave()).toEqual(before);
  });

  test("clock commands do not consume regular queue sequence numbers", () => {
    const core = new SimCore({ initialState: createState() });

    core.applyClockCommand(pausedCommand(IDS.first, false));

    expect(core.enqueue(guidanceCommand(IDS.second))).toEqual({
      commandId: IDS.second,
      queued: true,
      queueSequence: 0,
    });
  });

  test("keeps clock commands sent through the regular queue unavailable", () => {
    const core = new SimCore({ initialState: createState() });
    core.enqueue(pausedCommand(IDS.first, false));

    expect(core.step().commandResults).toEqual([
      {
        commandId: IDS.first,
        accepted: false,
        rejectedAtTick: 0,
        code: "COMMAND_NOT_AVAILABLE",
        messageKey: "errors.command-not-available",
      },
    ]);
    expect(core.getStateForSave().clock.paused).toBe(true);
  });

  test("does not allow injected handlers to make queued clock commands available", () => {
    const unsafeHandlers: CommandHandlerRegistry = {
      SET_PAUSED({ state }, command) {
        state.clock.paused = command.paused;
      },
    };
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: unsafeHandlers as never,
    });
    core.enqueue(pausedCommand(IDS.first, false));

    expect(core.step().commandResults).toEqual([
      {
        commandId: IDS.first,
        accepted: false,
        rejectedAtTick: 0,
        code: "COMMAND_NOT_AVAILABLE",
        messageKey: "errors.command-not-available",
      },
    ]);
    expect(core.getStateForSave().clock.paused).toBe(true);
  });

  test("executes registered systems only in the fixed TDD stage order", () => {
    const actualOrder: string[] = [];
    const tickSystems = Object.fromEntries(
      TICK_SYSTEM_STAGE_ORDER.toReversed().map((stage) => [
        stage,
        () => {
          actualOrder.push(stage);
        },
      ]),
    ) as TickSystemRegistry;
    const core = new SimCore({ initialState: createState(), tickSystems });

    core.step();

    expect(TICK_STAGE_ORDER).toEqual([
      "dequeue-and-order-commands",
      "validate-and-apply-commands",
      ...TICK_SYSTEM_STAGE_ORDER,
    ]);
    expect(actualOrder).toEqual(TICK_SYSTEM_STAGE_ORDER);
  });

  test("owns an immutable stage order and injected registry snapshot", () => {
    let lateSystemRuns = 0;
    const tickSystems: { "emit-events"?: TickSystem } = {};
    const core = new SimCore({ initialState: createState(), tickSystems });

    tickSystems["emit-events"] = () => {
      lateSystemRuns += 1;
    };
    core.step();

    expect(Object.isFrozen(TICK_STAGE_ORDER)).toBe(true);
    expect(Object.isFrozen(TICK_SYSTEM_STAGE_ORDER)).toBe(true);
    expect(lateSystemRuns).toBe(0);
  });

  test("the production pipeline has no gameplay tick-system effects", () => {
    const core = new SimCore({ initialState: createState() });
    const before = core.getStateForSave();

    core.step();

    expect(stateWithoutCompletedTime(core.getStateForSave())).toEqual(before);
  });

  test("commits a successful test system and its RNG use exactly once", () => {
    const state = createState();
    const expectedRng = createSeededRngFromState(state.rngState);
    expectedRng.nextUint32();
    let runs = 0;
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        "calculate-workload-allocation"({ state: candidate, rng }) {
          runs += 1;
          candidate.achievements.unlockedIds.push("system-commit");
          rng.nextUint32();
        },
      },
    });

    core.step();

    expect(runs).toBe(1);
    expect(core.getStateForSave().achievements.unlockedIds).toEqual(["system-commit"]);
    expect(core.getStateForSave().rngState).toBe(expectedRng.getState());
  });

  test("rolls back state and RNG when a system fails and stops later stages", () => {
    const state = createState();
    let laterRuns = 0;
    const core = new SimCore({
      initialState: state,
      tickSystems: {
        "calculate-heat-generation"({ state: candidate, rng }) {
          candidate.achievements.unlockedIds.push("partial-system-change");
          rng.nextUint32();
          throw new Error("system fixture failed");
        },
        "update-thermal-state"() {
          laterRuns += 1;
        },
      },
    });

    let thrown: unknown;
    try {
      core.step();
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SimulatorInvariantError);
    expect(thrown).toMatchObject({
      code: "SIMULATOR_INVARIANT_VIOLATION",
      tick: 0,
      stage: "calculate-heat-generation",
    });
    expect(core.getStateForSave()).toEqual(state);
    expect(laterRuns).toBe(0);
  });

  test("attributes an invalid candidate to the system that produced it", () => {
    let laterStageRan = false;
    const core = new SimCore({
      initialState: createState(),
      tickSystems: {
        "calculate-heat-generation"({ state }) {
          state.economy.cashUsd = Number.NaN;
        },
        "emit-events"() {
          laterStageRan = true;
        },
      },
    });

    expect(() => core.step()).toThrow(
      expect.objectContaining({
        tick: 0,
        stage: "calculate-heat-generation",
      }),
    );
    expect(core.tick).toBe(0);
    expect(core.getStateForSave().economy.cashUsd).toBe(32_000);
    expect(laterStageRan).toBe(false);
  });

  test("prevents retained system candidates from mutating committed state", () => {
    let retainedCandidate: GameState | undefined;
    const core = new SimCore({
      initialState: createState(),
      tickSystems: {
        "advance-research"({ state }) {
          retainedCandidate = state;
        },
      },
    });
    core.step();
    if (retainedCandidate === undefined) {
      throw new Error("Expected the test system to retain its candidate.");
    }

    try {
      retainedCandidate.achievements.unlockedIds.push("late-mutation");
    } catch {
      // A frozen candidate is an acceptable way to reject the external mutation.
    }

    expect(core.getStateForSave().achievements.unlockedIds).toEqual([]);
  });

  test("rejects a system candidate that changes host-controlled clock fields", () => {
    const core = new SimCore({
      initialState: createState(),
      tickSystems: {
        "emit-events"({ state }) {
          state.clock.speed = 4;
        },
      },
    });

    expect(() => core.step()).toThrow(SimulatorInvariantError);
    expect(core.getStateForSave().clock.speed).toBe(1);
    expect(core.tick).toBe(0);
  });

  test("preserves command commits when a later tick system fails", () => {
    const core = new SimCore({
      initialState: createState(),
      commandHandlers: recordingCommandHandlers(),
      tickSystems: {
        "advance-research"({ state, rng }) {
          state.achievements.unlockedIds.push("partial-system-change");
          rng.nextUint32();
          throw new Error("post-command failure");
        },
      },
    });
    core.enqueue(guidanceCommand(IDS.first, 0));

    expect(() => core.step()).toThrow(SimulatorInvariantError);

    expect(core.tick).toBe(0);
    expect(core.getStateForSave().achievements.unlockedIds).toEqual([IDS.first]);
    expect(core.getStateForSave().rngState).not.toBe(createState().rngState);
  });

  test("preserves earlier completed ticks when a later tick fails", () => {
    const core = new SimCore({
      initialState: createState(),
      tickSystems: {
        "apply-economy-and-energy-costs"({ state }) {
          if (state.tick === 2) {
            state.economy.cashUsd = -1;
            throw new Error("third tick fails");
          }
        },
      },
    });

    expect(() => core.step(4)).toThrow(SimulatorInvariantError);

    expect(core.tick).toBe(2);
    expect(core.getStateForSave().clock.simulatedSeconds).toBe(0.2);
    expect(core.getStateForSave().economy.cashUsd).toBe(32_000);
  });

  test("returns a detached save snapshot that cannot mutate authoritative state", () => {
    const core = new SimCore({ initialState: createState() });
    const snapshot = core.getStateForSave();
    const firstTile = snapshot.facility.thermalTiles[0];
    if (firstTile === undefined) {
      throw new Error("Expected the initial state to contain thermal tiles.");
    }

    snapshot.tick = 99;
    snapshot.clock.speed = 4;
    firstTile.temperatureC = 200;

    expect(core.tick).toBe(0);
    expect(core.getStateForSave().clock.speed).toBe(1);
    expect(core.getStateForSave().facility.thermalTiles[0]?.temperatureC).toBe(22);
  });

  test("does not accumulate floating-point time across repeated calls", () => {
    const core = new SimCore({ initialState: createState() });

    for (let count = 0; count < 10_000; count += 1) {
      core.step();
    }

    expect(core.getStateForSave().clock.simulatedSeconds).toBe(core.tick / 10);
    expect(core.getStateForSave().clock.simulatedSeconds).toBe(1_000);
  });

  test("keeps StepResult, clock results, and state snapshots JSON serializable", () => {
    const core = new SimCore({ initialState: createState() });
    const clockResult = core.applyClockCommand(speedCommand(IDS.first, 2));
    const stepResult = core.step();
    const snapshot = core.getStateForSave();

    expect(JSON.parse(JSON.stringify(clockResult))).toEqual(clockResult);
    expect(JSON.parse(JSON.stringify(stepResult))).toEqual(stepResult);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
