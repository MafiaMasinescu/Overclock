import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createBlueprintCommandHandlers } from "../../src/sim/blueprints/blueprintCommands.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GameState, ModuleInstanceState } from "../../src/sim/core/types.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";

const content = loadContentBundle();
const RELAY = "module-data-relay";
const PRINTER = "module-line-printer";
const BLUEPRINT_RESEARCH = "research-blueprint-documentation";
const BUFFERED_IO = "research-buffered-io";

function enableAllResearch(state: GameState): void {
  for (const researchId of Object.keys(state.research.statuses)) {
    state.research.statuses[researchId] = "completed";
  }
}

function moduleState(
  id: string,
  definitionId: string,
  position: { x: number; y: number },
  overrides: Partial<ModuleInstanceState> = {},
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
    ...overrides,
  };
}

function stateWithModules(
  modules: readonly ModuleInstanceState[] = [
    moduleState("facility-z", RELAY, { x: 5, y: 2 }),
    moduleState("facility-a", RELAY, { x: 1, y: 2 }),
  ],
): GameState {
  const state = createInitialGameState({ content, seed: "blueprint-commands" });
  enableAllResearch(state);
  state.facility.modules = Object.fromEntries(modules.map((module) => [module.id, module]));
  return state;
}

function saveCommand(
  name: string,
  selectedModuleIds: string[],
  commandId = "00000000-0000-4000-8000-000000000001",
): Extract<SimCommand, { kind: "SAVE_BLUEPRINT" }> {
  return {
    commandId,
    source: "player",
    kind: "SAVE_BLUEPRINT",
    name,
    selectedModuleIds,
  };
}

function renameCommand(
  blueprintId: string,
  name: string,
  commandId = "00000000-0000-4000-8000-000000000002",
): Extract<SimCommand, { kind: "RENAME_BLUEPRINT" }> {
  return { commandId, source: "player", kind: "RENAME_BLUEPRINT", blueprintId, name };
}

function coreFor(state: GameState): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers: createBlueprintCommandHandlers(content),
  });
}

function processOne(core: SimCore, command: SimCommand) {
  core.enqueue(command);
  const result = core.processPendingCommands();
  const first = result[0];
  if (first === undefined) throw new Error("Expected one command result.");
  return first;
}

describe("SAVE_BLUEPRINT command", () => {
  test("captures through FIFO with normalized names, canonical local IDs, and no RNG use", () => {
    const core = coreFor(stateWithModules());
    const beforeRng = core.getStateForSave().rngState;

    core.enqueue(saveCommand("  Assembly  ", ["facility-z", "facility-a"]));
    const results = core.processPendingCommands();

    expect(results).toEqual([
      {
        commandId: "00000000-0000-4000-8000-000000000001",
        accepted: true,
        appliedAtTick: 0,
      },
    ]);
    const state = core.getStateForSave();
    expect(state.rngState).toBe(beforeRng);
    expect(state.blueprints.nextBlueprintSequence).toBe(2);
    const record = state.blueprints.records["blueprint-00000001"];
    expect(record).toBeDefined();
    expect(record?.name).toBe("Assembly");
    expect(record?.kind).toBe("subassembly");
    expect(record?.version).toBe(1);
    expect(record?.modules.map(({ localId }) => localId)).toEqual(["module-0001", "module-0002"]);
    expect(JSON.stringify(record)).not.toContain("facility-");
    expect(JSON.stringify(record)).not.toContain("module-instance-");
  });

  test("allows duplicate names and allocates non-reused Blueprint IDs in FIFO order", () => {
    const core = coreFor(stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]));
    core.enqueue(saveCommand("Same", ["facility-a"]));
    core.enqueue(saveCommand(" Same ", ["facility-a"], "00000000-0000-4000-8000-000000000002"));

    expect(core.processPendingCommands()).toEqual([
      expect.objectContaining({ accepted: true }),
      expect.objectContaining({ accepted: true }),
    ]);
    const state = core.getStateForSave();
    expect(Object.keys(state.blueprints.records)).toEqual([
      "blueprint-00000001",
      "blueprint-00000002",
    ]);
    expect(Object.values(state.blueprints.records).map(({ name }) => name)).toEqual([
      "Same",
      "Same",
    ]);
    expect(state.blueprints.nextBlueprintSequence).toBe(3);
  });

  test.each([
    { name: "empty selection", command: saveCommand("valid", []), reason: "empty-selection" },
    {
      name: "duplicate selection",
      command: saveCommand("valid", ["facility-a", "facility-a"]),
      reason: "duplicate-module",
    },
    {
      name: "missing module",
      command: saveCommand("valid", ["missing"]),
      reason: "missing-module",
    },
  ])("rejects $name without changing state", ({ command, reason }) => {
    const core = coreFor(stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]));
    const before = hashCanonicalState(core.getStateForSave());

    expect(processOne(core, command)).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      messageKey: `errors.blueprint-${reason}`,
      parameters: { reason },
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("uses invalid-name before feature and Design Mode precedence", () => {
    const state = stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]);
    state.research.statuses[BLUEPRINT_RESEARCH] = "locked";
    state.facility.designDraft = {
      revision: 0,
      modules: {},
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    const core = coreFor(state);

    expect(processOne(core, saveCommand("\u0000invalid", ["facility-a"]))).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      messageKey: "errors.blueprint-invalid-name",
      parameters: { reason: "invalid-name" },
    });
    expect(
      processOne(
        core,
        saveCommand("valid", ["facility-a"], "00000000-0000-4000-8000-000000000003"),
      ),
    ).toMatchObject({
      accepted: false,
      code: "RESEARCH_REQUIRED",
    });
  });

  test("rejects an active Design Mode draft before selection validation", () => {
    const state = stateWithModules();
    state.facility.designDraft = {
      revision: 0,
      modules: {},
      routes: {},
      undoStack: [],
      redoStack: [],
    };
    const core = coreFor(state);

    expect(processOne(core, saveCommand("valid", []))).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      messageKey: "errors.blueprint-design-mode-active",
      parameters: { reason: "design-mode-active" },
    });
  });

  test("rejects locked modules and incomplete Research with the distinct contracts", () => {
    const lockedModuleState = stateWithModules([
      moduleState("facility-a", PRINTER, { x: 1, y: 1 }),
    ]);
    lockedModuleState.research.statuses[BUFFERED_IO] = "locked";
    const lockedCore = coreFor(lockedModuleState);
    expect(processOne(lockedCore, saveCommand("valid", ["facility-a"]))).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      messageKey: "errors.blueprint-locked-module",
      parameters: { reason: "locked-module" },
    });

    const researchState = stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]);
    researchState.research.statuses[BLUEPRINT_RESEARCH] = "available";
    const researchCore = coreFor(researchState);
    expect(processOne(researchCore, saveCommand("valid", ["facility-a"]))).toMatchObject({
      accepted: false,
      code: "RESEARCH_REQUIRED",
    });
  });

  test("rejects the terminal sequence without mutating records or sequence", () => {
    const state = stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]);
    state.blueprints.nextBlueprintSequence = Number.MAX_SAFE_INTEGER;
    const core = coreFor(state);
    const before = hashCanonicalState(core.getStateForSave());

    expect(processOne(core, saveCommand("valid", ["facility-a"]))).toMatchObject({
      accepted: false,
      code: "INVALID_SYSTEM",
      messageKey: "errors.invalid-system",
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });
});

describe("RENAME_BLUEPRINT command", () => {
  test("changes only the normalized name and preserves a historical record", () => {
    const core = coreFor(stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]));
    expect(processOne(core, saveCommand("Original", ["facility-a"]))).toMatchObject({
      accepted: true,
    });
    const historical = core.getStateForSave();
    const original = historical.blueprints.records["blueprint-00000001"];
    if (original === undefined) throw new Error("Expected saved Blueprint.");
    historical.blueprints.records[original.id] = {
      ...original,
      contentVersion: "historical-content-version",
    };
    core.replaceState(historical);
    const before = core.getStateForSave().blueprints.records[original.id];

    expect(processOne(core, renameCommand(original.id, "  Renamed  "))).toMatchObject({
      accepted: true,
    });
    const after = core.getStateForSave().blueprints.records[original.id];
    expect(after).toEqual({ ...before, name: "Renamed" });
    expect(core.getStateForSave().blueprints.nextBlueprintSequence).toBe(2);
  });

  test.each([
    {
      name: "unknown Blueprint",
      command: renameCommand("blueprint-00000099", "valid"),
      reason: "unknown-blueprint",
    },
    {
      name: "invalid name",
      command: renameCommand("blueprint-00000001", "\u0001bad"),
      reason: "invalid-name",
    },
  ])("rejects $name atomically", ({ command, reason }) => {
    const core = coreFor(stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]));
    expect(processOne(core, saveCommand("Original", ["facility-a"]))).toMatchObject({
      accepted: true,
    });
    const before = hashCanonicalState(core.getStateForSave());

    expect(processOne(core, command)).toMatchObject({
      accepted: false,
      code: "BLUEPRINT_INVALID",
      messageKey: `errors.blueprint-${reason}`,
      parameters: { reason },
    });
    expect(hashCanonicalState(core.getStateForSave())).toBe(before);
  });

  test("registers INSTANTIATE_BLUEPRINT and localizes every Blueprint rejection reason", () => {
    const handlers = createBlueprintCommandHandlers(content);
    expect(handlers.INSTANTIATE_BLUEPRINT).toEqual(expect.any(Function));
    for (const key of [
      "blueprint-invalid-name",
      "blueprint-design-mode-active",
      "blueprint-empty-selection",
      "blueprint-duplicate-module",
      "blueprint-missing-module",
      "blueprint-locked-module",
      "blueprint-invalid-record",
      "blueprint-unknown-blueprint",
      "blueprint-unsupported-kind",
      "blueprint-incompatible-content-version",
    ]) {
      expect(content.locales.en.errors[key]).toEqual(expect.any(String));
      expect(content.locales.ro.errors[key]).toEqual(expect.any(String));
    }
  });
});

describe("Blueprint command authoritative-state failures", () => {
  test("does not convert invalid Blueprint or facility state into a user rejection", () => {
    const handler = createBlueprintCommandHandlers(content).SAVE_BLUEPRINT;
    if (handler === undefined) throw new Error("Expected SAVE_BLUEPRINT handler.");

    const invalidBlueprint = stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]);
    invalidBlueprint.blueprints.nextBlueprintSequence = 0;
    expect(() =>
      handler(
        { state: invalidBlueprint, rng: { nextUint32: () => 0 } as never },
        saveCommand("valid", ["facility-a"]),
      ),
    ).toThrow();

    const invalidFacility = stateWithModules([moduleState("facility-a", RELAY, { x: 1, y: 1 })]);
    invalidFacility.facility.nextRouteSequence = 0;
    expect(() =>
      handler(
        { state: invalidFacility, rng: { nextUint32: () => 0 } as never },
        saveCommand("valid", ["facility-a"]),
      ),
    ).toThrow();
  });
});
