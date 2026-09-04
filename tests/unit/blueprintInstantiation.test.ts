import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type {
  BlueprintModule,
  BlueprintRecord,
  BlueprintRoute,
  GameState,
  ModuleInstanceState,
} from "../../src/sim/core/types.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createBlueprintCommandHandlers } from "../../src/sim/blueprints/blueprintCommands.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import { calculateDesignInventoryReservations } from "../../src/sim/design/designModeCommands.ts";
import { createBenchmarkCommandHandlers } from "../../src/sim/benchmarks/benchmarkCommands.ts";
import { calculateDesignApplyPreviewForTransaction } from "../../src/sim/design/designApplyPreview.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { SimulatorInvariantError } from "../../src/sim/commands/commandProcessor.ts";

const content = loadContentBundle();
const BLUEPRINT_ID = "blueprint-00000001";
const LOGIC = "module-vacuum-tube-logic";
const RELAY = "module-data-relay";
const FEATURE_RESEARCH = "research-blueprint-documentation";

function commandId(sequence: number): string {
  return `73000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function enableAllResearch(state: GameState): void {
  for (const researchId of Object.keys(state.research.statuses)) {
    state.research.statuses[researchId] = "completed";
  }
}

function module(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
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

function blueprintModule(
  localId: string,
  definitionId: string,
  relativePosition: { x: number; y: number },
  rotation: BlueprintModule["rotation"] = 0,
): BlueprintModule {
  return {
    localId,
    definitionId,
    relativePosition: { ...relativePosition },
    rotation,
    defaultOverclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  };
}

function requiredResearchIds(modules: readonly BlueprintModule[]): string[] {
  const ids = new Set<string>([FEATURE_RESEARCH]);
  for (const blueprintModule of modules) {
    for (const researchId of content.modules[blueprintModule.definitionId]?.unlockResearchIds ??
      []) {
      ids.add(researchId);
    }
  }
  return [...ids].toSorted();
}

function blueprintRecord(
  modules: readonly BlueprintModule[],
  bounds: { width: number; height: number },
  routes: readonly BlueprintRoute[] = [],
): BlueprintRecord {
  return {
    id: BLUEPRINT_ID,
    name: "Instantiation fixture",
    version: 1,
    kind: "subassembly",
    contentVersion: content.contentVersion,
    modules: modules.map((entry) => ({
      ...entry,
      relativePosition: { ...entry.relativePosition },
      defaultOverclock: { ...entry.defaultOverclock },
    })),
    routes: routes.map((entry) => ({
      ...entry,
      relativePath: entry.relativePath.map((point) => ({ ...point })),
    })),
    requiredResearchIds: requiredResearchIds(modules),
    bounds: { ...bounds },
    summary: {
      theoreticalComputeFlops: 900,
      peakPowerWatts: 1450,
      estimatedMaxTemperatureC: 30,
      estimatedCostUsd: 1850,
    },
  };
}

function routeFixture(): BlueprintRoute {
  return {
    localId: "route-0001",
    kind: "data",
    fromLocalModuleId: "module-0001",
    fromPortId: "data-east",
    toLocalModuleId: "module-0002",
    toPortId: "data-west",
    relativePath: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  };
}

function emptyDraft(): NonNullable<GameState["facility"]["designDraft"]> {
  return { revision: 0, modules: {}, routes: {}, undoStack: [], redoStack: [] };
}

function stateFor(
  record = blueprintRecord([blueprintModule("module-0001", LOGIC, { x: 0, y: 0 })], {
    width: 2,
    height: 1,
  }),
  edit?: (state: GameState) => void,
): GameState {
  const state = createInitialGameState({ content, seed: "blueprint-instantiation" });
  enableAllResearch(state);
  state.blueprints.records = { [record.id]: record };
  state.blueprints.nextBlueprintSequence = 2;
  state.facility.designDraft = emptyDraft();
  state.inventory.stacks[LOGIC] = {
    definitionId: LOGIC,
    quantity: 20,
    averageAcquisitionCostUsd: 1850,
  };
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 20,
    averageAcquisitionCostUsd: 700,
  };
  edit?.(state);
  return state;
}

function createCore(state: GameState): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers: {
      ...createBlueprintCommandHandlers(content),
      ...createDesignModeCommandHandlers(content),
    },
  });
}

function instantiate(
  sequence: number,
  position = { x: 5, y: 5 },
  rotation: 0 | 90 | 180 | 270 = 0,
): Extract<SimCommand, { kind: "INSTANTIATE_BLUEPRINT" }> {
  return {
    commandId: commandId(sequence),
    source: "player",
    kind: "INSTANTIATE_BLUEPRINT",
    blueprintId: BLUEPRINT_ID,
    position,
    rotation,
  };
}

function process(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result === undefined) throw new Error("Expected one processed command result.");
  return result;
}

describe("INSTANTIATE_BLUEPRINT command", () => {
  test("adds one atomic draft operation without changing live layout, cash, inventory, or RNG", () => {
    const core = createCore(stateFor());
    const before = core.getStateForSave();

    expect(process(core, instantiate(1))).toMatchObject({ accepted: true });

    const after = core.getStateForSave();
    const draft = after.facility.designDraft;
    if (draft === null) throw new Error("Expected Design Mode draft.");
    expect(after.facility.modules).toEqual(before.facility.modules);
    expect(after.facility.routes).toEqual(before.facility.routes);
    expect(after.facility.liveLayoutRevision).toBe(before.facility.liveLayoutRevision);
    expect(after.economy).toEqual(before.economy);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.rngState).toBe(before.rngState);
    expect(after.facility.nextModuleInstanceSequence).toBe(2);
    expect(after.facility.nextRouteSequence).toBe(1);
    expect(draft.revision).toBe(1);
    expect(Object.keys(draft.modules)).toEqual(["module-instance-00000001"]);
    expect(draft.modules["module-instance-00000001"]).toMatchObject({
      definitionId: LOGIC,
      position: { x: 5, y: 5 },
      operationalState: "offline",
      startupTicksRemaining: 30,
      cooldownTicksRemaining: 0,
      binComputeRatio: 1,
      binEfficiencyRatio: 1,
      binThermalRatio: 1,
      binStabilityRatio: 1,
    });
    expect(draft.undoStack).toHaveLength(1);
    expect(draft.undoStack[0]).toMatchObject({
      kind: "instantiate-blueprint",
      payload: {
        blueprintId: BLUEPRINT_ID,
        blueprintVersion: 1,
        nextModuleInstanceSequence: 2,
        nextRouteSequence: 1,
        inventoryReservationDelta: [{ definitionId: LOGIC, quantity: 1 }],
      },
    });
    expect(draft.redoStack).toEqual([]);
    expect(JSON.parse(JSON.stringify(draft.undoStack[0]))).toEqual(draft.undoStack[0]);
    expect(
      calculateDesignInventoryReservations(after.facility, draft, after.inventory.stacks),
    ).toContainEqual(expect.objectContaining({ definitionId: LOGIC, requiredFromInventory: 1 }));
  });

  test("applies command precedence and maps current-content failures distinctly", () => {
    const unknownState = stateFor();
    unknownState.facility.designDraft = null;
    const unknown = createCore(unknownState);
    expect(
      process(unknown, { ...instantiate(1), blueprintId: "blueprint-00000099" }),
    ).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      parameters: { reason: "unknown-blueprint" },
    });

    const noDraftState = stateFor();
    noDraftState.facility.designDraft = null;
    expect(process(createCore(noDraftState), instantiate(2))).toMatchObject({
      accepted: false,
      code: "NOT_IN_DESIGN_MODE",
    });

    const featureLocked = stateFor();
    featureLocked.research.statuses[FEATURE_RESEARCH] = "locked";
    expect(process(createCore(featureLocked), instantiate(3))).toMatchObject({
      accepted: false,
      code: "RESEARCH_REQUIRED",
    });

    const unsupported = stateFor({
      ...blueprintRecord([blueprintModule("module-0001", LOGIC, { x: 0, y: 0 })], {
        width: 2,
        height: 1,
      }),
      kind: "rack",
    });
    expect(process(createCore(unsupported), instantiate(4))).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      parameters: { reason: "unsupported-kind" },
    });

    const mismatched = stateFor({
      ...blueprintRecord([blueprintModule("module-0001", LOGIC, { x: 0, y: 0 })], {
        width: 2,
        height: 1,
      }),
      contentVersion: "historical-content",
    });
    expect(process(createCore(mismatched), instantiate(5))).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      parameters: { reason: "incompatible-content-version" },
    });

    const missingDefinition = stateFor(
      blueprintRecord([blueprintModule("module-0001", "module-missing", { x: 0, y: 0 })], {
        width: 1,
        height: 1,
      }),
    );
    expect(process(createCore(missingDefinition), instantiate(6))).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      parameters: { reason: "invalid-record" },
    });
  });

  test("rejects target bounds, collisions, shortages, and sequence exhaustion atomically", () => {
    const outOfBounds = createCore(stateFor());
    const beforeBounds = hashCanonicalState(outOfBounds.getStateForSave());
    expect(process(outOfBounds, instantiate(10, { x: 31, y: 17 }))).toMatchObject({
      accepted: false,
      code: "OUT_OF_BOUNDS",
    });
    expect(hashCanonicalState(outOfBounds.getStateForSave())).toBe(beforeBounds);

    const collision = createCore(
      stateFor(undefined, (state) => {
        state.facility.designDraft = {
          ...emptyDraft(),
          modules: { existing: module("existing", LOGIC, { x: 5, y: 5 }) },
        };
      }),
    );
    expect(process(collision, instantiate(11))).toMatchObject({
      accepted: false,
      code: "TILE_OCCUPIED",
    });

    const shortage = stateFor();
    Reflect.deleteProperty(shortage.inventory.stacks, LOGIC);
    expect(process(createCore(shortage), instantiate(12))).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_INVENTORY",
    });

    const reservedShortage = stateFor(undefined, (state) => {
      state.inventory.stacks[LOGIC] = {
        definitionId: LOGIC,
        quantity: 1,
        averageAcquisitionCostUsd: 1850,
      };
      state.facility.designDraft = {
        ...emptyDraft(),
        modules: { reserved: module("reserved", LOGIC, { x: 0, y: 0 }) },
      };
    });
    expect(process(createCore(reservedShortage), instantiate(13))).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_INVENTORY",
    });

    const overflow = stateFor(undefined, (state) => {
      state.facility.nextModuleInstanceSequence = Number.MAX_SAFE_INTEGER;
    });
    expect(process(createCore(overflow), instantiate(14))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
    });
  });

  test("leaves cost, inventory consumption, downtime, and live revision to the existing Apply transaction", () => {
    const core = createCore(stateFor());
    expect(process(core, instantiate(14))).toMatchObject({ accepted: true });
    const beforeApply = core.getStateForSave();
    const preview = calculateDesignApplyPreviewForTransaction(beforeApply, content);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") throw new Error("Expected a ready Design Apply preview.");

    expect(
      process(core, {
        commandId: commandId(15),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.draftRevision,
        acceptedCostUsd: preview.netCostUsd,
        acceptedDowntimeTicks: preview.downtimeTicks,
      }),
    ).toMatchObject({ accepted: true });
    const afterApply = core.getStateForSave();
    expect(afterApply.facility.designDraft).toBeNull();
    expect(afterApply.facility.modules["module-instance-00000001"]).toEqual(
      beforeApply.facility.designDraft?.modules["module-instance-00000001"],
    );
    expect(afterApply.facility.liveLayoutRevision).toBe(
      beforeApply.facility.liveLayoutRevision + 1,
    );
    expect(afterApply.inventory.stacks[LOGIC]?.quantity).toBe(19);
  });

  test("is allowed during an active Benchmark while APPLY remains exclusive", () => {
    const state = stateFor(undefined, (current) => {
      const live = module("module-instance-00000001", LOGIC, { x: 0, y: 0 });
      current.facility.modules = { [live.id]: live };
      current.facility.nextModuleInstanceSequence = 2;
      current.facility.designDraft = null;
    });
    const core = new SimCore({
      initialState: state,
      commandHandlers: {
        ...createBlueprintCommandHandlers(content),
        ...createDesignModeCommandHandlers(content),
        ...createBenchmarkCommandHandlers(content),
      },
    });
    expect(
      process(core, {
        commandId: commandId(20),
        source: "player",
        kind: "START_BENCHMARK",
        benchmarkId: "benchmark-sustained-stability",
        clusterModuleIds: ["module-instance-00000001"],
      }),
    ).toMatchObject({ accepted: true });
    expect(
      process(core, { commandId: commandId(21), source: "player", kind: "ENTER_DESIGN_MODE" }),
    ).toMatchObject({ accepted: true });
    expect(process(core, instantiate(22))).toMatchObject({ accepted: true });
    expect(
      process(core, {
        commandId: commandId(23),
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: 1,
        acceptedCostUsd: 700,
        acceptedDowntimeTicks: 0,
      }),
    ).toMatchObject({
      accepted: false,
      code: "BENCHMARK_CONFIGURATION_LOCKED",
    });
  });
});

describe("Blueprint instantiate Design Mode history", () => {
  function routedCore(): SimCore {
    const modules = [
      blueprintModule("module-0001", RELAY, { x: 0, y: 0 }),
      blueprintModule("module-0002", RELAY, { x: 3, y: 0 }),
    ];
    return createCore(
      stateFor(blueprintRecord(modules, { width: 4, height: 1 }, [routeFixture()])),
    );
  }

  test("Undo and Redo remove and restore exact modules/routes and reservations without rewinding IDs", () => {
    const core = routedCore();
    expect(process(core, instantiate(30, { x: 5, y: 5 }))).toMatchObject({ accepted: true });
    const instantiated = core.getStateForSave();
    const instantiatedDraft = instantiated.facility.designDraft;
    if (instantiatedDraft === null) throw new Error("Expected instantiated draft.");
    const exactModules = structuredClone(instantiatedDraft.modules);
    const exactRoutes = structuredClone(instantiatedDraft.routes);
    const exactOperation = structuredClone(instantiatedDraft.undoStack[0]);
    const rngState = instantiated.rngState;

    expect(
      process(core, { commandId: commandId(31), source: "player", kind: "UNDO_DESIGN" }),
    ).toEqual(expect.objectContaining({ accepted: true }));
    const undone = core.getStateForSave();
    const undoneDraft = undone.facility.designDraft;
    if (undoneDraft === null) throw new Error("Expected draft after undo.");
    expect(undoneDraft.modules).toEqual({});
    expect(undoneDraft.routes).toEqual({});
    expect(undoneDraft.redoStack[0]).toEqual(exactOperation);
    expect(undone.facility.nextModuleInstanceSequence).toBe(3);
    expect(undone.facility.nextRouteSequence).toBe(2);
    expect(undone.rngState).toBe(rngState);
    expect(
      calculateDesignInventoryReservations(undone.facility, undoneDraft, undone.inventory.stacks),
    ).toEqual([]);

    expect(
      process(core, { commandId: commandId(32), source: "player", kind: "REDO_DESIGN" }),
    ).toEqual(expect.objectContaining({ accepted: true }));
    const redone = core.getStateForSave();
    const redoneDraft = redone.facility.designDraft;
    if (redoneDraft === null) throw new Error("Expected draft after redo.");
    expect(redoneDraft.modules).toEqual(exactModules);
    expect(redoneDraft.routes).toEqual(exactRoutes);
    expect(redoneDraft.undoStack[0]).toEqual(exactOperation);
    expect(redone.facility.nextModuleInstanceSequence).toBe(3);
    expect(redone.facility.nextRouteSequence).toBe(2);
    expect(redone.rngState).toBe(rngState);
  });

  test("a later edit clears Redo and Cancel does not permit ID reuse", () => {
    const core = createCore(stateFor());
    expect(process(core, instantiate(40))).toMatchObject({ accepted: true });
    expect(
      process(core, { commandId: commandId(41), source: "player", kind: "UNDO_DESIGN" }),
    ).toMatchObject({
      accepted: true,
    });
    expect(
      process(core, {
        commandId: commandId(42),
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: RELAY,
        position: { x: 0, y: 5 },
        rotation: 0,
      }),
    ).toMatchObject({ accepted: true });
    expect(core.getStateForSave().facility.designDraft?.redoStack).toEqual([]);

    expect(
      process(core, { commandId: commandId(43), source: "player", kind: "CANCEL_DESIGN" }),
    ).toMatchObject({
      accepted: true,
    });
    expect(
      process(core, { commandId: commandId(44), source: "player", kind: "ENTER_DESIGN_MODE" }),
    ).toMatchObject({
      accepted: true,
    });
    expect(process(core, instantiate(45, { x: 10, y: 5 }))).toMatchObject({ accepted: true });
    expect(core.getStateForSave().facility.designDraft?.modules).toHaveProperty(
      "module-instance-00000003",
    );
  });

  test("a Redo inventory precondition failure is fatal and atomic", () => {
    const core = routedCore();
    expect(process(core, instantiate(46, { x: 5, y: 5 }))).toMatchObject({ accepted: true });
    expect(
      process(core, { commandId: commandId(47), source: "player", kind: "UNDO_DESIGN" }),
    ).toMatchObject({ accepted: true });
    const unavailable = core.getStateForSave();
    const relayInventory = unavailable.inventory.stacks[RELAY];
    if (relayInventory === undefined) throw new Error("Expected relay inventory.");
    relayInventory.quantity = 1;
    core.replaceState(unavailable);
    const before = core.getStateForSave();

    expect(() =>
      process(core, { commandId: commandId(48), source: "player", kind: "REDO_DESIGN" }),
    ).toThrow(SimulatorInvariantError);
    expect(core.getStateForSave()).toEqual(before);
  });

  test("tampered retained Blueprint operation state fails fatally and rolls back atomically", () => {
    const core = createCore(stateFor());
    expect(process(core, instantiate(50))).toMatchObject({ accepted: true });
    const tampered = core.getStateForSave();
    const draft = tampered.facility.designDraft;
    if (draft === null) throw new Error("Expected draft.");
    const operation = draft.undoStack[0];
    if (operation === undefined) throw new Error("Expected operation.");
    const payload = operation.payload as unknown as {
      addedModules: ModuleInstanceState[];
    };
    const firstModule = payload.addedModules[0];
    if (firstModule === undefined) throw new Error("Expected stored module.");
    firstModule.position.x += 1;
    core.replaceState(tampered);
    const before = hashCanonicalState(core.getStateForSave());

    expect(() =>
      process(core, { commandId: commandId(51), source: "player", kind: "UNDO_DESIGN" }),
    ).toThrow(SimulatorInvariantError);
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });
});
