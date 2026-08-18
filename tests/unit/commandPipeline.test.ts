import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { CommandResult, SimCommand } from "../../src/sim/commands/contracts.ts";
import type { CommandHandlerRegistry } from "../../src/sim/commands/commandHandlers.ts";
import {
  CommandProcessor,
  SimulatorInvariantError,
} from "../../src/sim/commands/commandProcessor.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const IDS = {
  first: "00000000-0000-4000-8000-000000000001",
  second: "00000000-0000-4000-8000-000000000002",
  third: "00000000-0000-4000-8000-000000000003",
} as const;

function createState(seed = "command-pipeline") {
  return createInitialGameState({ content: loadContentBundle(), seed });
}

function setGuidanceCommand(
  commandId: string,
  options: { expectedTick?: number; mode?: "simple" | "engineering" | "skip" } = {},
): Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> {
  const command: Extract<SimCommand, { kind: "SET_GUIDANCE_MODE" }> = {
    commandId,
    source: "player",
    kind: "SET_GUIDANCE_MODE",
    mode: options.mode ?? "engineering",
  };
  if (options.expectedTick !== undefined) {
    command.expectedTick = options.expectedTick;
  }
  return command;
}

function createRecordingHandlers(appliedIds: string[]): CommandHandlerRegistry {
  return {
    SET_GUIDANCE_MODE({ state, rng }, command) {
      appliedIds.push(command.commandId);
      state.achievements.unlockedIds.push(command.commandId);
      rng.nextUint32();
    },
  };
}

describe("deterministic command queue and processing", () => {
  test("uses zero-based receipts and does not consume a sequence for parse failures", () => {
    const processor = new CommandProcessor({ initialState: createState() });

    expect(processor.enqueue(setGuidanceCommand(IDS.first))).toEqual({
      commandId: IDS.first,
      queued: true,
      queueSequence: 0,
    });
    expect(() =>
      processor.enqueue({ ...setGuidanceCommand(IDS.second), commandId: "invalid" }),
    ).toThrow();
    expect(processor.enqueue(setGuidanceCommand(IDS.third))).toEqual({
      commandId: IDS.third,
      queued: true,
      queueSequence: 1,
    });
  });

  test("keeps enqueue receipts separate from FIFO processed results", () => {
    const appliedIds: string[] = [];
    const processor = new CommandProcessor({
      initialState: createState(),
      handlers: createRecordingHandlers(appliedIds),
    });

    const receipts = [
      processor.enqueue(setGuidanceCommand(IDS.first)),
      processor.enqueue(setGuidanceCommand(IDS.second)),
      processor.enqueue(setGuidanceCommand(IDS.third)),
    ];
    const results = processor.processQueuedCommands();

    expect(receipts.map(({ commandId, queueSequence }) => ({ commandId, queueSequence }))).toEqual([
      { commandId: IDS.first, queueSequence: 0 },
      { commandId: IDS.second, queueSequence: 1 },
      { commandId: IDS.third, queueSequence: 2 },
    ]);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.commandId)).toEqual([IDS.first, IDS.second, IDS.third]);
    expect(appliedIds).toEqual([IDS.first, IDS.second, IDS.third]);
  });

  test("owns nested command data after enqueue", () => {
    const command = {
      commandId: IDS.first,
      source: "player",
      kind: "ALLOCATE_TASK",
      taskInstanceId: "task-instance-a",
      clusterModuleIds: ["module-instance-a", "module-instance-b"],
      requestedShare: 0.5,
    } satisfies Extract<SimCommand, { kind: "ALLOCATE_TASK" }>;
    const handlers: CommandHandlerRegistry = {
      ALLOCATE_TASK({ state }, queuedCommand) {
        state.achievements.unlockedIds.push(...queuedCommand.clusterModuleIds);
      },
    };
    const processor = new CommandProcessor({ initialState: createState(), handlers });

    processor.enqueue(command);
    command.clusterModuleIds.reverse();
    command.clusterModuleIds.push("module-instance-c");
    processor.processQueuedCommands();

    expect(processor.getState().achievements.unlockedIds).toEqual([
      "module-instance-a",
      "module-instance-b",
    ]);
  });

  test("rejects a structurally valid production command when no handler is registered", () => {
    const initialState = createState();
    const processor = new CommandProcessor({ initialState });
    processor.enqueue(setGuidanceCommand(IDS.first));

    expect(processor.processQueuedCommands()).toEqual([
      {
        commandId: IDS.first,
        accepted: false,
        rejectedAtTick: 0,
        code: "COMMAND_NOT_AVAILABLE",
        messageKey: "errors.command-not-available",
      },
    ]);
    expect(hashCanonicalState(processor.getState())).toBe(hashCanonicalState(initialState));
    expect(processor.getState().rngState).toBe(initialState.rngState);
  });

  test("returns a recoverable handler rejection without committing candidate state or RNG", () => {
    const initialState = createState();
    const handlers: CommandHandlerRegistry = {
      SET_GUIDANCE_MODE({ state, rng }) {
        state.economy.cashUsd -= 1;
        rng.nextUint32();
        return {
          code: "INVALID_PAYLOAD",
          messageKey: "errors.invalid-payload",
        };
      },
    };
    const processor = new CommandProcessor({ initialState, handlers });
    processor.enqueue(setGuidanceCommand(IDS.first));

    expect(processor.processQueuedCommands()).toEqual([
      {
        commandId: IDS.first,
        accepted: false,
        rejectedAtTick: 0,
        code: "INVALID_PAYLOAD",
        messageKey: "errors.invalid-payload",
      },
    ]);
    expect(hashCanonicalState(processor.getState())).toBe(hashCanonicalState(initialState));
    expect(processor.getState().rngState).toBe(initialState.rngState);
  });

  test("accepts exact expectedTick and commits a test handler exactly once without advancing tick", () => {
    const appliedIds: string[] = [];
    const initialState = createState();
    const processor = new CommandProcessor({
      initialState,
      handlers: createRecordingHandlers(appliedIds),
    });
    processor.enqueue(setGuidanceCommand(IDS.first, { expectedTick: 0 }));

    expect(processor.processQueuedCommands()).toEqual([
      {
        commandId: IDS.first,
        accepted: true,
        appliedAtTick: 0,
      },
    ]);
    expect(appliedIds).toEqual([IDS.first]);
    expect(processor.getState().achievements.unlockedIds).toEqual([IDS.first]);
    expect(processor.getState().tick).toBe(0);
    expect(processor.getState().rngState).not.toBe(initialState.rngState);
  });

  test.each([
    ["past", 3],
    ["future", 5],
  ])("rejects a %s expected tick without changing state or RNG", (_label, expectedTick) => {
    const initialState = createState();
    initialState.tick = 4;
    const appliedIds: string[] = [];
    const processor = new CommandProcessor({
      initialState,
      handlers: createRecordingHandlers(appliedIds),
    });
    processor.enqueue(setGuidanceCommand(IDS.first, { expectedTick }));

    expect(processor.processQueuedCommands()).toEqual([
      {
        commandId: IDS.first,
        accepted: false,
        rejectedAtTick: 4,
        code: "STALE_TICK",
        messageKey: "errors.stale-tick",
      },
    ]);
    expect(appliedIds).toEqual([]);
    expect(hashCanonicalState(processor.getState())).toBe(hashCanonicalState(initialState));
    expect(processor.getState().rngState).toBe(initialState.rngState);
  });

  test("rolls back a throwing handler, preserves RNG, and stops before later commands", () => {
    const initialState = createState();
    const cause = new Error("test handler failed");
    const handlers: CommandHandlerRegistry = {
      SET_GUIDANCE_MODE({ state, rng }) {
        state.economy.cashUsd = -99;
        state.achievements.unlockedIds.push("partial-change");
        rng.nextUint32();
        throw cause;
      },
    };
    const processor = new CommandProcessor({ initialState, handlers });
    processor.enqueue(setGuidanceCommand(IDS.first));
    processor.enqueue(setGuidanceCommand(IDS.second));

    let thrown: unknown;
    try {
      processor.processQueuedCommands();
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SimulatorInvariantError);
    if (!(thrown instanceof SimulatorInvariantError)) {
      throw new Error("Expected SimulatorInvariantError");
    }
    expect(thrown.code).toBe("SIMULATOR_INVARIANT_VIOLATION");
    expect(thrown.commandId).toBe(IDS.first);
    expect(thrown.cause).toBe(cause);
    expect(hashCanonicalState(processor.getState())).toBe(hashCanonicalState(initialState));
    expect(processor.getState().rngState).toBe(initialState.rngState);
    expect(processor.pendingCommandCount).toBe(1);
  });

  test("keeps earlier commits when a later command fails fatally", () => {
    const initialState = createState();
    const handlers: CommandHandlerRegistry = {
      SET_GUIDANCE_MODE({ state, rng }, command) {
        state.achievements.unlockedIds.push(command.commandId);
        rng.nextUint32();
        if (command.mode === "skip") {
          state.achievements.unlockedIds.push("partial-failure");
          rng.nextUint32();
          throw new Error("fatal test path");
        }
      },
    };
    const processor = new CommandProcessor({ initialState, handlers });
    processor.enqueue(setGuidanceCommand(IDS.first, { mode: "simple" }));
    processor.enqueue(setGuidanceCommand(IDS.second, { mode: "skip" }));
    processor.enqueue(setGuidanceCommand(IDS.third, { mode: "engineering" }));

    expect(() => processor.processQueuedCommands()).toThrow(SimulatorInvariantError);

    expect(processor.getState().achievements.unlockedIds).toEqual([IDS.first]);
    expect(processor.getState().rngState).not.toBe(initialState.rngState);
    expect(processor.pendingCommandCount).toBe(1);
  });

  test("serializes commands, receipts, and normal results as JSON", () => {
    const processor = new CommandProcessor({ initialState: createState() });
    const command = setGuidanceCommand(IDS.first);
    const receipt = processor.enqueue(command);
    const results = processor.processQueuedCommands();

    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
  });

  test("repeats identical receipts, mixed results, and final state hash across 100 runs", () => {
    let expected:
      { receipts: unknown[]; results: CommandResult[]; finalStateHash: string } | undefined;

    for (let run = 0; run < 100; run += 1) {
      const appliedIds: string[] = [];
      const processor = new CommandProcessor({
        initialState: createState("repeat-command-stream"),
        handlers: createRecordingHandlers(appliedIds),
      });
      const receipts = [
        processor.enqueue(setGuidanceCommand(IDS.first, { expectedTick: 0 })),
        processor.enqueue(setGuidanceCommand(IDS.second, { expectedTick: 1 })),
        processor.enqueue({
          commandId: IDS.third,
          source: "player",
          kind: "SET_PAUSED",
          paused: true,
        }),
      ];
      const actual = {
        receipts,
        results: processor.processQueuedCommands(),
        finalStateHash: hashCanonicalState(processor.getState()),
      };

      expected ??= actual;
      expect(actual).toEqual(expected);
    }
  });
});
