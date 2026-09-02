import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, MuseumSnapshot, ResearchStatus } from "../../src/sim/core/types.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import {
  validateContentAwareResearchState,
  validateStoredResearchState,
} from "../../src/sim/research/researchState.ts";

const content = loadContentBundle();
const FIRST_NODE = "research-stable-power-distribution";
const SECOND_NODE = "research-vacuum-tube-reliability";
const FINAL_NODE = "research-transistor-theory";

function createState(): GameState {
  return createInitialGameState({ content, seed: "research-state" });
}

function museumSnapshot(overrides: Partial<MuseumSnapshot> = {}): MuseumSnapshot {
  return {
    id: "museum-snapshot-a",
    createdAtTick: 0,
    systemName: "facility-alpha",
    architectureId: "vacuum-tube",
    year: 1946,
    moduleCount: 0,
    theoreticalComputeFlops: 0,
    usefulComputeFlops: 0,
    averagePowerWatts: 0,
    peakPowerWatts: 0,
    averageTemperatureC: 22,
    maxTemperatureC: 22,
    totalCostUsd: 0,
    benchmarkRunIds: [],
    completedResearchIds: [],
    ...overrides,
  };
}

function activate(state: GameState, nodeId = FIRST_NODE): void {
  state.tick = 3;
  state.research.statuses[nodeId] = "active";
  state.research.active = {
    nodeId,
    startedAtTick: 2,
    completedOperations: 0,
    reservedComputeShare: 0.1,
  };
}

function activeRecord(state: GameState): NonNullable<GameState["research"]["active"]> {
  const active = state.research.active;
  if (active === null) throw new Error("Missing active Research fixture.");
  return active;
}

function paths(state: GameState, contentAware = false): string[] {
  return (
    contentAware
      ? validateContentAwareResearchState(state, content)
      : validateStoredResearchState(state)
  ).map((issue) => issue.path);
}

describe("Research structural state", () => {
  test("accepts the exact initial Research shape", () => {
    const state = createState();

    expect(validateStoredResearchState(state)).toEqual([]);
    expect(validateContentAwareResearchState(state, content)).toEqual([]);
    expect(state.research).toEqual({
      researchData: 10,
      statuses: Object.fromEntries(
        Object.values(content.research)
          .toSorted((left, right) => left.sortOrder - right.sortOrder)
          .map((node) => [node.id, node.prerequisites.length === 0 ? "available" : "locked"]),
      ),
      active: null,
      evidenceTags: [],
    });
  });

  test("preserves the Research-compatible state through canonical JSON serialization", () => {
    const state = createState();

    expect(JSON.parse(canonicalSerialize(state))).toEqual(state);
  });

  test.each([
    ["negative research data", (state: GameState) => (state.research.researchData = -1)],
    ["non-finite research data", (state: GameState) => (state.research.researchData = Number.NaN)],
  ])("rejects %s", (_name, mutate) => {
    const state = createState();
    mutate(state);

    expect(paths(state)).toContain("research.researchData");
  });

  test.each([
    ["duplicate evidence", ["evidence-a", "evidence-a"]],
    ["non-lexical evidence", ["evidence-b", "evidence-a"]],
  ])("requires evidence tags to be unique and lexical: %s", (_name, evidenceTags) => {
    const state = createState();
    state.research.evidenceTags = evidenceTags;

    expect(paths(state)).toContain("research.evidenceTags");
  });

  test("rejects an invalid Research status", () => {
    const state = createState();
    state.research.statuses[FIRST_NODE] = "invalid" as ResearchStatus;

    expect(paths(state)).toContain(`research.statuses.${FIRST_NODE}`);
  });

  test("allows at most one active status", () => {
    const state = createState();
    state.research.statuses[FIRST_NODE] = "active";
    state.research.statuses[SECOND_NODE] = "active";
    state.research.active = {
      nodeId: FIRST_NODE,
      startedAtTick: 0,
      completedOperations: 0,
      reservedComputeShare: 0.1,
    };

    expect(paths(state)).toContain("research.statuses");
  });

  test("requires a non-null active record exactly when one status is active", () => {
    const state = createState();
    state.research.statuses[FIRST_NODE] = "active";

    expect(paths(state)).toContain("research.active");
  });

  test("requires the active record node to match the active status", () => {
    const state = createState();
    activate(state);
    state.research.active = { ...activeRecord(state), nodeId: SECOND_NODE };

    expect(paths(state)).toContain("research.active.nodeId");
  });

  test.each([
    ["negative start tick", (state: GameState) => (activeRecord(state).startedAtTick = -1)],
    ["fractional start tick", (state: GameState) => (activeRecord(state).startedAtTick = 1.5)],
    ["future start tick", (state: GameState) => (activeRecord(state).startedAtTick = 4)],
  ])("requires a valid active start tick: %s", (_name, mutate) => {
    const state = createState();
    activate(state);
    mutate(state);

    expect(paths(state)).toContain("research.active.startedAtTick");
  });

  test.each([
    ["negative operations", -1],
    ["negative zero operations", -0],
    ["non-finite operations", Number.POSITIVE_INFINITY],
  ])("requires valid completed operations: %s", (_name, completedOperations) => {
    const state = createState();
    activate(state);
    activeRecord(state).completedOperations = completedOperations;

    expect(paths(state)).toContain("research.active.completedOperations");
  });

  test.each([
    ["zero share", 0],
    ["negative zero share", -0],
    ["share above one", 1.1],
    ["non-finite share", Number.NaN],
  ])("requires a valid reserved Compute share: %s", (_name, reservedComputeShare) => {
    const state = createState();
    activate(state);
    activeRecord(state).reservedComputeShare = reservedComputeShare;

    expect(paths(state)).toContain("research.active.reservedComputeShare");
  });

  test("requires unique Museum snapshot IDs", () => {
    const state = createState();
    state.museum.snapshots = [museumSnapshot(), museumSnapshot()];

    expect(paths(state)).toContain("museum.snapshots[1].id");
  });

  test("requires finite nonnegative Museum numeric fields", () => {
    const state = createState();
    state.museum.snapshots = [museumSnapshot({ maxTemperatureC: Number.NaN })];

    expect(paths(state)).toContain("museum.snapshots[0].maxTemperatureC");
  });

  test("allows finite sub-zero Museum temperatures", () => {
    const state = createState();
    state.museum.snapshots = [museumSnapshot({ averageTemperatureC: -5, maxTemperatureC: -1 })];

    expect(paths(state)).not.toContain("museum.snapshots[0].averageTemperatureC");
    expect(paths(state)).not.toContain("museum.snapshots[0].maxTemperatureC");
  });

  test("requires unique benchmark and completed-research IDs in Museum snapshots", () => {
    const state = createState();
    state.museum.snapshots = [
      museumSnapshot({
        benchmarkRunIds: ["run-a", "run-a"],
        completedResearchIds: [FIRST_NODE, FIRST_NODE],
      }),
    ];

    expect(paths(state)).toContain("museum.snapshots[0].benchmarkRunIds");
    expect(paths(state)).toContain("museum.snapshots[0].completedResearchIds");
  });
});

describe("Research content-aware state", () => {
  test("requires exact status coverage for content Research IDs", () => {
    const missing = createState();
    Reflect.deleteProperty(missing.research.statuses, FIRST_NODE);
    expect(paths(missing, true)).toContain("research.statuses");

    const extra = createState();
    extra.research.statuses["research-unknown"] = "locked";
    expect(paths(extra, true)).toContain("research.statuses");
  });

  test("requires the active node to exist in content", () => {
    const state = createState();
    state.research.statuses[FIRST_NODE] = "locked";
    state.research.statuses["research-unknown"] = "active";
    state.research.active = {
      nodeId: "research-unknown",
      startedAtTick: 0,
      completedOperations: 0,
      reservedComputeShare: 0.1,
    };

    expect(paths(state, true)).toContain("research.active.nodeId");
  });

  test("requires active progress below required operations and share at least the content minimum", () => {
    const state = createState();
    activate(state);
    const node = content.research[FIRST_NODE];
    if (node === undefined) throw new Error("Missing Research content fixture.");
    activeRecord(state).completedOperations = node.requiredOperations;
    activeRecord(state).reservedComputeShare = 0.01;

    expect(paths(state, true)).toContain("research.active.completedOperations");
    expect(paths(state, true)).toContain("research.active.reservedComputeShare");
  });

  test("does not allow a historically completed node to return to a non-completed status", () => {
    const state = createState();
    state.museum.snapshots = [museumSnapshot({ completedResearchIds: [FIRST_NODE] })];
    state.research.statuses[FIRST_NODE] = "locked";

    expect(paths(state, true)).toContain(`research.statuses.${FIRST_NODE}`);
  });

  test("accepts the final Research state only with its campaign flags and fixed Museum snapshot", () => {
    const state = createState();
    state.research.statuses[FINAL_NODE] = "completed";
    state.campaign.transistorRevealed = true;
    state.campaign.verticalSliceCompleted = true;
    state.museum.snapshots = [
      museumSnapshot({ id: "museum-vacuum-tube-final", completedResearchIds: [FINAL_NODE] }),
    ];

    expect(validateContentAwareResearchState(state, content)).toEqual([]);
  });

  test.each([
    [
      "revealed flag before final completion",
      (state: GameState) => {
        state.campaign.transistorRevealed = true;
      },
      "campaign.transistorRevealed",
    ],
    [
      "completed flag before final completion",
      (state: GameState) => {
        state.campaign.verticalSliceCompleted = true;
      },
      "campaign.verticalSliceCompleted",
    ],
    [
      "final snapshot before final completion",
      (state: GameState) => {
        state.museum.snapshots = [
          museumSnapshot({ id: "museum-vacuum-tube-final", completedResearchIds: [FINAL_NODE] }),
        ];
      },
      "museum.snapshots",
    ],
    [
      "final completion without campaign flags",
      (state: GameState) => {
        state.research.statuses[FINAL_NODE] = "completed";
      },
      "campaign.transistorRevealed",
    ],
    [
      "final completion without final snapshot",
      (state: GameState) => {
        state.research.statuses[FINAL_NODE] = "completed";
        state.campaign.transistorRevealed = true;
        state.campaign.verticalSliceCompleted = true;
      },
      "museum.snapshots",
    ],
  ])("rejects %s", (_name, mutate, path) => {
    const state = createState();
    mutate(state);

    expect(paths(state, true)).toContain(path);
  });
});
