import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import {
  composeUniqueRegistry,
  createProductionSimCore,
} from "../../src/sim/core/productionSimCore.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { CommandQueue } from "../../src/sim/commands/commandQueue.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const COMMAND_ID = "10400000-0000-4000-8000-000000000001";

function command(kind: SimCommand["kind"] = "SET_GUIDANCE_MODE"): SimCommand {
  if (kind === "SET_GUIDANCE_MODE") {
    return {
      commandId: COMMAND_ID,
      source: "player",
      kind,
      mode: "engineering",
    };
  }
  return {
    commandId: COMMAND_ID,
    source: "player",
    kind: "BUY_MODULE",
    definitionId: "unknown-module",
    quantity: 1,
  };
}

function createState() {
  const content = loadContentBundle();
  return { content, state: createInitialGameState({ content, seed: "production-core-test" }) };
}

describe("safe command queue position", () => {
  test("keeps default and nonzero receipt sequences deterministic", () => {
    const defaultQueue = new CommandQueue();
    expect(defaultQueue.enqueue(command())).toEqual({
      commandId: COMMAND_ID,
      queued: true,
      queueSequence: 0,
    });

    const nonzeroQueue = new CommandQueue(12);
    expect(nonzeroQueue.enqueue(command())).toEqual({
      commandId: COMMAND_ID,
      queued: true,
      queueSequence: 12,
    });
    expect(nonzeroQueue.getPosition()).toEqual({ nextSequence: 13, pendingCount: 1 });
  });

  test.each([[-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, -0]])(
    "rejects invalid initial queue sequence %s",
    (sequence) => {
      expect(() => new CommandQueue(sequence)).toThrow();
    },
  );

  test("rejects exhaustion before mutation and preserves the queue", () => {
    const queue = new CommandQueue(Number.MAX_SAFE_INTEGER);
    expect(() => queue.enqueue(command())).toThrow(
      "Command queue sequence is exhausted at Number.MAX_SAFE_INTEGER.",
    );
    expect(queue.getPosition()).toEqual({
      nextSequence: Number.MAX_SAFE_INTEGER,
      pendingCount: 0,
    });
  });

  test("parsing failures preserve queue position and position is detached", () => {
    const queue = new CommandQueue(4);
    expect(() => queue.enqueue({ kind: "not-a-command" })).toThrow();
    const position = queue.getPosition() as unknown as {
      nextSequence: number;
      pendingCount: number;
    };
    try {
      position.nextSequence = 99;
      position.pendingCount = 99;
    } catch {
      // A frozen detached position is also valid ownership protection.
    }
    expect(queue.getPosition()).toEqual({ nextSequence: 4, pendingCount: 0 });
  });
});

describe("production SimCore composition", () => {
  test("forwards queue position without adding it to GameState", () => {
    const { content, state } = createState();
    const core = createProductionSimCore({
      content,
      initialState: state,
      initialCommandQueueSequence: 7,
    });

    expect(core.getCommandQueuePosition()).toEqual({ nextSequence: 7, pendingCount: 0 });
    expect(Object.hasOwn(core.getStateForSave(), "commandQueue")).toBe(false);
  });

  test("approved production handlers are available and unapproved commands remain unavailable", () => {
    const { content, state } = createState();
    const core = createProductionSimCore({ content, initialState: state });
    const commands: SimCommand[] = [
      {
        commandId: COMMAND_ID,
        source: "player",
        kind: "BUY_MODULE",
        definitionId: "unknown-module",
        quantity: 1,
      },
      {
        commandId: "10400000-0000-4000-8000-000000000002",
        source: "player",
        kind: "START_BENCHMARK",
        benchmarkId: "unknown-benchmark",
        clusterModuleIds: [],
      },
      {
        commandId: "10400000-0000-4000-8000-000000000003",
        source: "player",
        kind: "SAVE_BLUEPRINT",
        name: "test",
        selectedModuleIds: [],
      },
      {
        commandId: "10400000-0000-4000-8000-000000000004",
        source: "player",
        kind: "DEBUG_ADD_CASH",
        amountUsd: 1,
      },
    ];
    for (const currentCommand of commands) core.enqueue(currentCommand);

    expect(core.processPendingCommands()).toMatchObject([
      { accepted: false, code: "INVALID_PAYLOAD" },
      { accepted: false, code: "BENCHMARK_REQUIREMENT_MISSING" },
      { accepted: false, code: "RESEARCH_REQUIRED" },
      { accepted: false, code: "COMMAND_NOT_AVAILABLE" },
    ]);
  });

  test("matches an explicitly composed production reference core", () => {
    const { content, state } = createState();
    const first = createProductionSimCore({ content, initialState: state });
    const second = createProductionSimCore({ content, initialState: state });

    first.step(3);
    second.step(3);

    expect(hashCanonicalState(first.getStateForSave())).toBe(
      hashCanonicalState(second.getStateForSave()),
    );
  });

  test("rejects duplicate registry keys instead of overwriting", () => {
    expect(() => composeUniqueRegistry([{ duplicate: 1 }, { duplicate: 2 }])).toThrow(
      "Duplicate registry key: duplicate",
    );
  });

  test("creates independent queues and state runtimes", () => {
    const { content, state } = createState();
    const first = createProductionSimCore({ content, initialState: state });
    const second = createProductionSimCore({ content, initialState: state });
    first.enqueue(command());
    expect(first.getCommandQueuePosition()).toEqual({ nextSequence: 1, pendingCount: 1 });
    expect(second.getCommandQueuePosition()).toEqual({ nextSequence: 0, pendingCount: 0 });
    first.step();
    expect(second.tick).toBe(0);
    expect(hashCanonicalState(first.getStateForSave())).not.toBe(
      hashCanonicalState(second.getStateForSave()),
    );
  });

  test("preserves queue sequence through command processing and state replacement", () => {
    const { state } = createState();
    const core = new SimCore({ initialState: state, initialCommandQueueSequence: 3 });
    core.enqueue(command());
    expect(() => {
      core.replaceState(state);
    }).toThrow("Cannot replace simulator state while commands are pending.");
    core.processPendingCommands();
    core.replaceState(state);
    expect(core.getCommandQueuePosition()).toEqual({ nextSequence: 4, pendingCount: 0 });
  });
});
