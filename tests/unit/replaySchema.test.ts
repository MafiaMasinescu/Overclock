import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { hashSimulationContent, type ReplayLog } from "../../src/sim/replay/replayContracts.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import {
  parseReplayLog,
  parseReplayOperation,
  validateReplayLog,
} from "../../src/sim/replay/replaySchema.ts";

const COMMAND_ID = "10400000-0000-4000-8000-000000000001";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing fixture value at ${index}.`);
  return value;
}

function createEmptyLog(): ReplayLog {
  const content = loadContentBundle();
  const state = createInitialGameState({ content, seed: "replay-test" });
  const stateHash = hashCanonicalState(state);
  return {
    replayVersion: 1,
    simulatorProtocolVersion: 1,
    seed: state.seed,
    contentVersion: content.contentVersion,
    simulationContentHash: hashSimulationContent(content),
    initialStateHash: stateHash,
    initialTick: state.tick,
    initialCommandQueueSequence: 0,
    entries: [],
    checkpoints: [
      {
        afterSequence: 0,
        tick: state.tick,
        stateHash,
        nextQueueSequence: 0,
        pendingCommandCount: 0,
      },
    ],
    terminal: { kind: "completed", afterSequence: 0 },
  };
}

function createPopulatedLog(): ReplayLog {
  const log = createEmptyLog();
  const command = {
    commandId: COMMAND_ID,
    source: "player" as const,
    kind: "SET_GUIDANCE_MODE" as const,
    mode: "engineering" as const,
  };
  return {
    ...log,
    entries: [
      {
        sequence: 1,
        tickBefore: 0,
        tickAfter: 0,
        operation: { kind: "enqueue", command },
        outcome: {
          kind: "receipt",
          receipt: { commandId: COMMAND_ID, queued: true, queueSequence: 0 },
        },
      },
      {
        sequence: 2,
        tickBefore: 0,
        tickAfter: 0,
        operation: { kind: "process-pending" },
        outcome: {
          kind: "command-results",
          results: [
            {
              commandId: COMMAND_ID,
              accepted: false,
              rejectedAtTick: 0,
              code: "COMMAND_NOT_AVAILABLE",
              messageKey: "errors.command-not-available",
            },
          ],
        },
      },
      {
        sequence: 3,
        tickBefore: 0,
        tickAfter: 1,
        operation: { kind: "step", ticks: 1 },
        outcome: {
          kind: "step-result",
          result: {
            startTick: 0,
            endTick: 1,
            ticksExecuted: 1,
            simulatedSecondsAdvanced: 0.1,
            commandResults: [],
          },
        },
      },
    ],
    checkpoints: [
      at(log.checkpoints, 0),
      {
        afterSequence: 3,
        tick: 1,
        stateHash: log.initialStateHash,
        nextQueueSequence: 1,
        pendingCommandCount: 0,
      },
    ],
    terminal: { kind: "completed", afterSequence: 3 },
  };
}

describe("Replay log validation", () => {
  test("accepts the mandatory empty log boundary", () => {
    const log = createEmptyLog();

    expect(parseReplayLog(log)).toEqual(log);
    expect(validateReplayLog(log)).toEqual([]);
  });

  test("accepts operation/outcome pairs and preserves duplicate command IDs", () => {
    const log = createPopulatedLog();
    const duplicate = structuredClone(log);
    duplicate.entries[1] = {
      ...at(duplicate.entries, 1),
      sequence: 2,
      operation: {
        kind: "enqueue",
        command: {
          commandId: COMMAND_ID,
          source: "replay",
          kind: "SET_SPEED",
          speed: 4,
        },
      },
      outcome: {
        kind: "receipt",
        receipt: { commandId: COMMAND_ID, queued: true, queueSequence: 1 },
      },
    };
    duplicate.entries[2] = {
      ...at(duplicate.entries, 2),
      sequence: 3,
      tickBefore: 0,
      tickAfter: 0,
      operation: { kind: "process-pending" },
      outcome: { kind: "command-results", results: [] },
    };
    duplicate.checkpoints = [
      at(duplicate.checkpoints, 0),
      { ...at(duplicate.checkpoints, 1), afterSequence: 3, tick: 0, nextQueueSequence: 2 },
    ];
    duplicate.terminal = { kind: "completed", afterSequence: 3 };

    expect(parseReplayLog(duplicate).entries.map((entry) => entry.operation.kind)).toEqual([
      "enqueue",
      "enqueue",
      "process-pending",
    ]);
  });

  test.each(["replayVersion", "simulatorProtocolVersion", "initialStateHash"])(
    "rejects an invalid %s",
    (field) => {
      const log = createEmptyLog() as unknown as Record<string, unknown>;
      if (field === "replayVersion" || field === "simulatorProtocolVersion") {
        log[field] = 2;
      } else {
        log[field] = "not-a-hash";
      }

      expect(() => parseReplayLog(log)).toThrow();
    },
  );

  test("rejects unknown properties, sparse arrays, accessors and nonstandard prototypes", () => {
    const base = createEmptyLog();
    expect(() => parseReplayLog({ ...base, extra: true })).toThrow();

    const sparse = structuredClone(base);
    sparse.checkpoints = [];
    sparse.checkpoints.length = 1;
    expect(() => parseReplayLog(sparse)).toThrow();

    const withAccessor = structuredClone(base);
    Object.defineProperty(withAccessor, "seed", { get: () => "replay-test", enumerable: true });
    expect(() => parseReplayLog(withAccessor)).toThrow();

    const withCustomPrototype = structuredClone(base);
    Object.setPrototypeOf(withCustomPrototype, { custom: true });
    expect(() => parseReplayLog(withCustomPrototype)).toThrow();

    const withSymbol = structuredClone(base);
    Object.defineProperty(withSymbol, Symbol("hidden"), { value: true, enumerable: true });
    expect(() => parseReplayLog(withSymbol)).toThrow();

    const withHiddenProperty = structuredClone(base);
    Object.defineProperty(withHiddenProperty, "hidden", { value: true, enumerable: false });
    expect(() => parseReplayLog(withHiddenProperty)).toThrow();

    const cyclic = structuredClone(base) as ReplayLog & { self?: unknown };
    cyclic.self = cyclic;
    expect(() => parseReplayLog(cyclic)).toThrow();
  });

  test.each([
    ["negative-zero initial tick", (log: ReplayLog) => (log.initialTick = -0)],
    ["NaN checkpoint tick", (log: ReplayLog) => (at(log.checkpoints, 0).tick = Number.NaN)],
    [
      "infinite queue sequence",
      (log: ReplayLog) => (at(log.checkpoints, 0).nextQueueSequence = Number.POSITIVE_INFINITY),
    ],
  ])("rejects %s", (_label, mutate) => {
    const log = createEmptyLog();
    mutate(log);
    expect(() => parseReplayLog(log)).toThrow();
  });

  test.each([
    "missing checkpoint zero",
    "duplicate checkpoint boundary",
    "noncontiguous entry sequence",
    "decreasing tick",
    "operation outcome mismatch",
    "terminal mismatch",
  ])("rejects %s", (caseName) => {
    const base = createPopulatedLog();
    if (caseName === "missing checkpoint zero") {
      base.checkpoints = [at(base.checkpoints, 1)];
    } else if (caseName === "duplicate checkpoint boundary") {
      base.checkpoints = [
        at(base.checkpoints, 0),
        at(base.checkpoints, 0),
        at(base.checkpoints, 1),
      ];
    } else if (caseName === "noncontiguous entry sequence") {
      base.entries[1] = { ...at(base.entries, 1), sequence: 4 };
    } else if (caseName === "decreasing tick") {
      base.entries[2] = { ...at(base.entries, 2), tickBefore: 2, tickAfter: 1 };
    } else if (caseName === "operation outcome mismatch") {
      base.entries[0] = {
        ...at(base.entries, 0),
        outcome: { kind: "step-result", result: {} } as never,
      };
    } else {
      base.terminal = { kind: "fatal", afterSequence: 2 };
    }

    expect(() => parseReplayLog(base)).toThrow();
  });

  test("a clock operation accepts only clock commands while enqueue accepts any command", () => {
    const clock = parseReplayOperation({
      kind: "clock",
      command: {
        commandId: COMMAND_ID,
        source: "player",
        kind: "SET_PAUSED",
        paused: false,
      },
    });
    expect(clock.kind).toBe("clock");

    expect(() =>
      parseReplayOperation({
        kind: "clock",
        command: {
          commandId: COMMAND_ID,
          source: "player",
          kind: "SET_GUIDANCE_MODE",
          mode: "engineering",
        },
      }),
    ).toThrow();
  });
});
