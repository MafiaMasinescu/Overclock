import { expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { createInventoryEconomyCommandHandlers } from "../../src/sim/economy/inventoryTransactions.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createDirtyPowerState } from "../../src/sim/power/powerState.ts";
import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();

function module(id: string, definitionId: string): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function run() {
  const state = createInitialGameState({ content, seed: "task-6-exact-100" });
  state.facility.thermalTiles = [];
  const source = module("source", "module-power-distribution");
  const sinkA = module("sink-a", "module-vacuum-tube-logic");
  const sinkZ = module("sink-z", "module-vacuum-tube-logic");
  state.facility.modules = { "sink-z": sinkZ, source, "sink-a": sinkA };
  state.facility.routes = {
    "route-z": {
      id: "route-z",
      kind: "power",
      from: { moduleInstanceId: source.id, portId: "power-out-east" },
      to: { moduleInstanceId: sinkZ.id, portId: "power-in-west" },
      path: [],
      capacityPerSecond: 1_800,
      congestionRatio: 0,
    },
    "route-a": {
      id: "route-a",
      kind: "power",
      from: { moduleInstanceId: source.id, portId: "power-out-east" },
      to: { moduleInstanceId: sinkA.id, portId: "power-in-west" },
      path: [],
      capacityPerSecond: 1_800,
      congestionRatio: 0,
    },
  };
  state.facility.contractedPowerWatts = 2_340;
  state.facility.power = createDirtyPowerState(2_340);
  const core = new SimCore({
    initialState: state,
    commandHandlers: createInventoryEconomyCommandHandlers(content),
    tickSystems: createPowerTickSystems(content),
  });
  const command: SimCommand = {
    commandId: "60000000-0000-4000-8000-000000000001",
    source: "debug",
    kind: "BUY_MODULE",
    definitionId: "module-control-unit",
    quantity: 1,
  };
  const receipt = core.enqueue(command);
  const step = core.step();
  const finalState = core.getStateForSave();
  return {
    receipt,
    commandResults: step.commandResults,
    power: finalState.facility.power,
    operationalStates: Object.fromEntries(
      Object.entries(finalState.facility.modules).map(([id, item]) => [
        id,
        {
          operationalState: item.operationalState,
          startupTicksRemaining: item.startupTicksRemaining,
        },
      ]),
    ),
    state: canonicalSerialize(finalState),
    hash: hashCanonicalState(finalState),
    rngState: finalState.rngState,
  };
}

function runStartupBoundary() {
  const state = createInitialGameState({ content, seed: "task-6-startup-boundary-exact-100" });
  state.facility.thermalTiles = [];
  const source = {
    ...module("source", "module-power-distribution"),
    operationalState: "starting" as const,
    startupTicksRemaining: 1,
  };
  const sink = module("sink", "module-vacuum-tube-logic");
  state.facility.modules = { source, sink };
  state.facility.routes = {
    route: {
      id: "route",
      kind: "power",
      from: { moduleInstanceId: source.id, portId: "power-out-east" },
      to: { moduleInstanceId: sink.id, portId: "power-in-west" },
      path: [],
      capacityPerSecond: 700,
      congestionRatio: 0,
    },
  };
  state.facility.power = createDirtyPowerState(state.facility.contractedPowerWatts);
  const initialRngState = state.rngState;
  const core = new SimCore({ initialState: state, tickSystems: createPowerTickSystems(content) });
  const firstStep = core.step();
  const afterFirst = core.getStateForSave();
  const secondStep = core.step();
  const afterSecond = core.getStateForSave();
  const thirdStep = core.step();
  const afterThird = core.getStateForSave();
  return {
    firstStep,
    firstTick: {
      tick: afterFirst.tick,
      source: afterFirst.facility.modules["source"],
      sinkPower: afterFirst.facility.power.byModule["sink"],
      hash: hashCanonicalState(afterFirst),
      rngState: afterFirst.rngState,
    },
    secondStep,
    secondTick: {
      tick: afterSecond.tick,
      sinkPower: afterSecond.facility.power.byModule["sink"],
      routePower: afterSecond.facility.power.byRoute["route"],
      state: canonicalSerialize(afterSecond),
      hash: hashCanonicalState(afterSecond),
      rngState: afterSecond.rngState,
    },
    thirdStep,
    thirdTick: {
      tick: afterThird.tick,
      sinkPower: afterThird.facility.power.byModule["sink"],
      state: canonicalSerialize(afterThird),
      hash: hashCanonicalState(afterThird),
      rngState: afterThird.rngState,
    },
    initialRngState,
  };
}

test("repeats Task 6 state, power, transitions, receipts, hash, and RNG exactly 100 times", () => {
  const expected = run();
  for (let runIndex = 1; runIndex < 100; runIndex += 1) {
    expect(run()).toEqual(expected);
  }
});

test("repeats the production startup boundary and following-tick delivery exactly 100 times", () => {
  const expected = runStartupBoundary();
  expect(expected.firstStep).toMatchObject({ startTick: 0, endTick: 1, ticksExecuted: 1 });
  expect(expected.firstTick.source).toMatchObject({
    operationalState: "online",
    startupTicksRemaining: 0,
  });
  expect(expected.firstTick.sinkPower).toMatchObject({
    deliveredPowerWatts: 0,
    limitingReason: "source-unavailable",
  });
  expect(expected.secondStep).toMatchObject({ startTick: 1, endTick: 2, ticksExecuted: 1 });
  expect(expected.secondTick.sinkPower).toMatchObject({
    deliveredPowerWatts: 700,
    limitingReason: "route-capacity",
  });
  expect(expected.secondTick.routePower).toMatchObject({
    deliveredPowerWatts: 700,
    utilizationRatio: 1,
  });
  expect(expected.thirdStep).toMatchObject({ startTick: 2, endTick: 3, ticksExecuted: 1 });
  expect(expected.thirdTick.sinkPower).toEqual(expected.secondTick.sinkPower);
  expect(expected.firstTick.rngState).toBe(expected.initialRngState);
  expect(expected.secondTick.rngState).toBe(expected.initialRngState);
  expect(expected.thirdTick.rngState).toBe(expected.initialRngState);
  for (let runIndex = 1; runIndex < 100; runIndex += 1) {
    expect(runStartupBoundary()).toEqual(expected);
  }
});

function runTask61CacheLifecycle() {
  const state = createInitialGameState({ content, seed: "task-6-1-exact-100" });
  state.facility.thermalTiles = [];
  state.inventory.stacks["module-data-relay"] = {
    definitionId: "module-data-relay",
    quantity: 1,
    averageAcquisitionCostUsd: 700,
  };
  const cacheEvents: string[] = [];
  const core = new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(content),
    tickSystems: createPowerTickSystems(content, {
      onTopologyCacheEvent(event) {
        cacheEvents.push(event);
      },
    }),
  });
  core.step();
  const commands: readonly SimCommand[] = [
    {
      commandId: "61010000-0000-4000-8000-000000000001",
      source: "player",
      kind: "ENTER_DESIGN_MODE",
    },
    {
      commandId: "61010000-0000-4000-8000-000000000002",
      source: "player",
      kind: "PLACE_MODULE",
      definitionId: "module-data-relay",
      position: { x: 0, y: 0 },
      rotation: 0,
    },
    {
      commandId: "61010000-0000-4000-8000-000000000003",
      source: "player",
      kind: "UNDO_DESIGN",
    },
    {
      commandId: "61010000-0000-4000-8000-000000000004",
      source: "player",
      kind: "REDO_DESIGN",
    },
  ];
  const receipts = commands.map((command) => core.enqueue(command));
  const commandResults = core.processPendingCommands();
  const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
  if (preview.status !== "ready") throw new Error("Expected ready deterministic Apply preview.");
  const applyCommand: SimCommand = {
    commandId: "61010000-0000-4000-8000-000000000005",
    source: "player",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: preview.draftRevision,
    acceptedCostUsd: preview.netCostUsd,
    acceptedDowntimeTicks: preview.downtimeTicks,
  };
  const applyReceipt = core.enqueue(applyCommand);
  const applyResults = core.processPendingCommands();
  core.step(2);
  const finalState = core.getStateForSave();
  return {
    receipts,
    commandResults,
    applyReceipt,
    applyResults,
    cacheEvents,
    state: canonicalSerialize(finalState),
    hash: hashCanonicalState(finalState),
    rngState: finalState.rngState,
  };
}

test("repeats Task 6.1 cold, warm, draft, Apply invalidation, state, hash, and RNG exactly 100 times", () => {
  const expected = runTask61CacheLifecycle();
  expect(expected.cacheEvents).toEqual(["clear", "rebuild", "rebuild", "hit"]);
  for (let runIndex = 1; runIndex < 100; runIndex += 1) {
    expect(runTask61CacheLifecycle()).toEqual(expected);
  }
});
