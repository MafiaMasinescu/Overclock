import { describe, expect, test } from "vitest";

import {
  BUILD_QUERY_LIMITS,
  freezeBuildRead,
  parseBuildQuery,
  type BuildQuery,
  type BuildQueryResult,
} from "../../src/sim/build/contracts.ts";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { previewBuildManualRoute, previewBuildPlacement } from "../../src/sim/build/preview.ts";
import { parseSimCommand } from "../../src/sim/commands/commandSchema.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content: ContentBundle = loadContentBundle();

function moduleFixture(id: string, definitionId: string): ModuleInstanceState {
  const definition = content.modules[definitionId];
  if (definition === undefined) throw new Error("Expected module definition fixture.");
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

describe("neutral Build contracts", () => {
  test("accepts bounded discriminated queries and freezes owned reads", () => {
    const query: BuildQuery = {
      kind: "context",
      mode: "draft",
      clientIntentSequence: 7,
    };
    expect(parseBuildQuery(query)).toEqual(query);

    const result: BuildQueryResult = {
      kind: "context",
      status: "unavailable",
      clientIntentSequence: 7,
      source: {
        mode: "draft",
        observedTick: 12,
        liveLayoutRevision: 4,
        draftRevision: 2,
        generation: 9,
      },
      reason: "NOT_AVAILABLE",
    };
    const owned = freezeBuildRead(result);
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.source)).toBe(true);
  });

  test("rejects unknown keys, unsafe sequences and oversized cursors", () => {
    expect(() =>
      parseBuildQuery({ kind: "context", mode: "live", clientIntentSequence: 0, extra: true }),
    ).toThrow();
    expect(() =>
      parseBuildQuery({
        kind: "context",
        mode: "live",
        clientIntentSequence: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(BUILD_QUERY_LIMITS.blueprintPageSize.max).toBe(50);
  });

  test("rejects nested query-array accessors without invoking them", () => {
    let getterCalled = false;
    const path: unknown[] = [];
    Object.defineProperty(path, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalled = true;
        return { x: 0, y: 0 };
      },
    });
    expect(() =>
      parseBuildQuery({
        kind: "manual-route",
        mode: "draft",
        clientIntentSequence: 1,
        input: {
          kind: "power",
          from: { moduleInstanceId: "a", portId: "power" },
          to: { moduleInstanceId: "b", portId: "power" },
          path,
        },
      }),
    ).toThrow();
    expect(getterCalled).toBe(false);
  });

  test("SimCore context reads are detached and generation-aware", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-context" }),
    });
    const first = core.queryBuild({ kind: "context", mode: "live", clientIntentSequence: 1 });
    expect(first.status).toBe("ready");
    if (first.kind !== "context" || first.status !== "ready") {
      throw new Error("context missing");
    }
    expect(first.context.catalog.length).toBeGreaterThan(0);
    expect(Object.isFrozen(first.context)).toBe(true);
    const generation = first.source.generation;
    const repeated = core.queryBuild({ kind: "context", mode: "live", clientIntentSequence: 2 });
    expect(repeated.source.generation).toBe(generation);
    expect(core.getCommandQueuePosition()).toEqual({ nextSequence: 0, pendingCount: 0 });
  });

  test("temperature-only production ticks do not invalidate Build generation", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-temperature-only" }),
    });
    const before = core.getBuildGeneration();
    core.step(1);
    expect(core.getBuildGeneration()).toBe(before);
  });

  test("invalidates Cancel and re-entry even when both drafts use revision zero", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-draft-lifecycle" }),
    });
    const initial = core.getBuildGeneration();
    const generations: number[] = [];
    for (const [commandId, kind] of [
      ["79000000-0000-4000-8000-000000000010", "ENTER_DESIGN_MODE"],
      ["79000000-0000-4000-8000-000000000011", "CANCEL_DESIGN"],
      ["79000000-0000-4000-8000-000000000012", "ENTER_DESIGN_MODE"],
    ] as const) {
      core.enqueue(parseSimCommand({ commandId, source: "player", kind }));
      expect(core.processPendingCommands()).toMatchObject([{ accepted: true }]);
      generations.push(core.getBuildGeneration());
    }
    const result = core.queryBuild({ kind: "context", mode: "draft", clientIntentSequence: 3 });
    expect(result.source.draftRevision).toBe(0);
    expect(result.source.generation).toBeGreaterThan(initial);
    expect(generations[1]).toBeGreaterThan(generations[0] ?? -1);
    expect(generations[2]).toBeGreaterThan(generations[1] ?? -1);
  });

  test("keeps retained generation after rejected replacement and resets a valid replacement", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-replacement-lifecycle" }),
    });
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000020",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    core.processPendingCommands();
    const before = core.getBuildGeneration();
    const invalid = core.getStateForSave();
    invalid.tick = -1;
    expect(() => {
      core.replaceState(invalid);
    }).toThrow();
    expect(core.getBuildGeneration()).toBe(before);

    const valid = core.getStateForSave();
    core.replaceState(valid);
    expect(core.getBuildGeneration()).toBe(0);
  });

  test("repeated Build reads are frozen and do not mutate state, queue or RNG", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-read-purity" }),
    });
    const before = core.getStateForSave();
    const beforeHash = hashCanonicalState(before);
    const first = core.queryBuild({ kind: "context", mode: "live", clientIntentSequence: 4 });
    const second = core.queryBuild({ kind: "context", mode: "live", clientIntentSequence: 5 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.source)).toBe(true);
    expect(second.source.generation).toBe(first.source.generation);
    expect(core.getCommandQueuePosition()).toEqual({ nextSequence: 0, pendingCount: 0 });
    expect(hashCanonicalState(core.getStateForSave())).toBe(beforeHash);
    expect(core.getStateForSave().rngState).toBe(before.rngState);
  });

  test("constructor validation does not invoke hostile state accessors", () => {
    const state = createInitialGameState({ content, seed: "build-accessor-order" });
    let getterCalled = false;
    Object.defineProperty(state, "facility", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalled = true;
        throw new Error("hostile facility getter invoked");
      },
    });
    expect(() => createProductionSimCore({ content, initialState: state })).toThrow();
    expect(getterCalled).toBe(false);
  });

  test("manual-route preview requires an active draft before route validation", () => {
    const state = createInitialGameState({ content, seed: "build-route-draft" });
    expect(
      previewBuildManualRoute(state, content, {
        kind: "power",
        from: { moduleInstanceId: "missing-a", portId: "power" },
        to: { moduleInstanceId: "missing-b", portId: "power" },
        path: [],
      }),
    ).toMatchObject({
      status: "rejected",
      valid: false,
      reason: "DRAFT_REQUIRED",
      domainReason: null,
    });
  });

  test("manual-route preview preserves the ordered domain reason", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-route-reason" }),
    });
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000005",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    core.processPendingCommands();
    expect(
      core.queryBuild({
        kind: "manual-route",
        mode: "draft",
        clientIntentSequence: 6,
        input: {
          kind: "power",
          from: { moduleInstanceId: "missing-a", portId: "power" },
          to: { moduleInstanceId: "missing-b", portId: "power" },
          path: [],
        },
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "INVALID_PORT",
      data: { domainReason: "MISSING_MODULE" },
    });
  });

  test("SimCore reports semantic preview failures as rejected query results", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-query-rejection" }),
    });
    expect(
      core.queryBuild({
        kind: "placement",
        mode: "draft",
        clientIntentSequence: 8,
        input: {
          definitionId: "module-vacuum-tube-logic",
          position: { x: 0, y: 0 },
          rotation: 0,
          source: "inventory",
        },
      }),
    ).toMatchObject({
      kind: "placement",
      status: "rejected",
      reason: "DRAFT_REQUIRED",
    });
  });

  test("rejects draft-only previews that claim a live source", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-mode-correlation" }),
    });
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000006",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    core.processPendingCommands();
    expect(
      core.queryBuild({
        kind: "placement",
        mode: "live",
        clientIntentSequence: 7,
        input: {
          definitionId: "module-vacuum-tube-logic",
          position: { x: 0, y: 0 },
          rotation: 0,
          source: "inventory",
        },
      }),
    ).toMatchObject({ status: "rejected", reason: "INVALID_INPUT", source: { mode: "draft" } });
  });

  test("rejects an unknown Blueprint list cursor instead of restarting pagination", () => {
    const core = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-blueprint-cursor" }),
    });
    expect(
      core.queryBuild({
        kind: "blueprint-list",
        mode: "live",
        clientIntentSequence: 9,
        afterBlueprintId: "blueprint-missing",
        limit: 10,
      }),
    ).toMatchObject({
      kind: "blueprint-list",
      status: "rejected",
      reason: "BLUEPRINT_INVALID",
    });
  });

  test("owned locked hardware remains placeable while Catalog purchase stays research-gated", () => {
    const definition = Object.values(content.modules).find(
      (candidate) => candidate.unlockResearchIds.length > 0,
    );
    if (definition === undefined) throw new Error("Expected a research-gated module fixture.");
    const state = createInitialGameState({ content, seed: "build-owned-locked" });
    state.inventory.stacks[definition.id] = {
      definitionId: definition.id,
      quantity: 1,
      averageAcquisitionCostUsd: definition.priceUsd,
    };
    const core = createProductionSimCore({ content, initialState: state });
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000001",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    expect(core.processPendingCommands()).toMatchObject([{ accepted: true }]);
    const draft = core.getStateForSave();
    const position = { x: 0, y: 0 };
    expect(
      previewBuildPlacement(draft, content, {
        definitionId: definition.id,
        position,
        rotation: 0,
        source: "inventory",
      }),
    ).toMatchObject({ status: "ready", valid: true, requiresPurchase: false });
    expect(
      previewBuildPlacement(draft, content, {
        definitionId: definition.id,
        position,
        rotation: 0,
        source: "catalog",
      }),
    ).toMatchObject({ status: "ready", valid: true, requiresPurchase: false });
  });

  test("reports a removed live module as an additional reusable placement", () => {
    const definitionId = "module-vacuum-tube-logic";
    const state = createInitialGameState({ content, seed: "build-removed-live-reuse" });
    expect(Reflect.deleteProperty(state.inventory.stacks, definitionId)).toBe(true);
    const installed = moduleFixture("installed-reusable", definitionId);
    state.facility.modules = { [installed.id]: installed };
    const core = createProductionSimCore({ content, initialState: state });
    for (const command of [
      {
        commandId: "79000000-0000-4000-8000-000000000030",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      },
      {
        commandId: "79000000-0000-4000-8000-000000000031",
        source: "player",
        kind: "REMOVE_MODULE",
        moduleInstanceId: installed.id,
      },
    ]) {
      core.enqueue(parseSimCommand(command));
      expect(core.processPendingCommands()).toMatchObject([{ accepted: true }]);
    }
    const result = core.queryBuild({ kind: "context", mode: "draft", clientIntentSequence: 12 });
    if (result.kind !== "context" || result.status !== "ready") {
      throw new Error("Expected ready Build context.");
    }
    expect(
      result.context.catalog.find((entry) => entry.definitionId === definitionId),
    ).toMatchObject({ availableAdditionalPlacements: 1, purchase: { kind: "available" } });
  });

  test("matches BUY_MODULE arithmetic-overflow rejection in context and placement preview", () => {
    const definitionId = "module-power-distribution";
    const state = createInitialGameState({ content, seed: "build-purchase-overflow" });
    expect(Reflect.deleteProperty(state.inventory.stacks, definitionId)).toBe(true);
    state.economy.totalExpenseUsd = 9_007_199_200;
    const core = createProductionSimCore({ content, initialState: state });
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000040",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    core.processPendingCommands();
    const context = core.queryBuild({ kind: "context", mode: "draft", clientIntentSequence: 13 });
    if (context.kind !== "context" || context.status !== "ready") {
      throw new Error("Expected ready Build context.");
    }
    expect(
      context.context.catalog.find((entry) => entry.definitionId === definitionId),
    ).toMatchObject({ purchase: { kind: "invalid", reason: "INVALID_SYSTEM" } });
    expect(
      core.queryBuild({
        kind: "placement",
        mode: "draft",
        clientIntentSequence: 14,
        input: {
          definitionId,
          position: { x: 3, y: 3 },
          rotation: 0,
          source: "catalog",
        },
      }),
    ).toMatchObject({ status: "rejected", reason: "INVALID_SYSTEM" });
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000041",
        source: "player",
        kind: "BUY_MODULE",
        definitionId,
        quantity: 1,
      }),
    );
    expect(core.processPendingCommands()).toMatchObject([
      { accepted: false, code: "INVALID_PAYLOAD" },
    ]);
  });

  test("matches PLACE_MODULE identity-capacity and global-reservation guards", () => {
    const capacityState = createInitialGameState({ content, seed: "build-place-capacity" });
    capacityState.facility.nextModuleInstanceSequence = Number.MAX_SAFE_INTEGER;
    const capacityCore = createProductionSimCore({ content, initialState: capacityState });
    capacityCore.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000045",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    );
    capacityCore.processPendingCommands();
    expect(
      capacityCore.queryBuild({
        kind: "placement",
        mode: "draft",
        clientIntentSequence: 17,
        input: {
          definitionId: "module-vacuum-tube-logic",
          position: { x: 0, y: 0 },
          rotation: 0,
          source: "inventory",
        },
      }),
    ).toMatchObject({ status: "rejected", reason: "INVALID_SYSTEM" });

    const reservationCore = createProductionSimCore({
      content,
      initialState: createInitialGameState({ content, seed: "build-global-reservation" }),
    });
    const commands = [
      {
        commandId: "79000000-0000-4000-8000-000000000046",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      },
      {
        commandId: "79000000-0000-4000-8000-000000000047",
        source: "player",
        kind: "PLACE_MODULE",
        definitionId: "module-vacuum-tube-logic",
        position: { x: 0, y: 0 },
        rotation: 0,
      },
      {
        commandId: "79000000-0000-4000-8000-000000000048",
        source: "player",
        kind: "SELL_INVENTORY_ITEM",
        definitionId: "module-vacuum-tube-logic",
        quantity: 2,
      },
    ];
    for (const command of commands) {
      reservationCore.enqueue(parseSimCommand(command));
      expect(reservationCore.processPendingCommands()).toMatchObject([{ accepted: true }]);
    }
    expect(
      reservationCore.queryBuild({
        kind: "placement",
        mode: "draft",
        clientIntentSequence: 18,
        input: {
          definitionId: "module-control-unit",
          position: { x: 5, y: 5 },
          rotation: 0,
          source: "inventory",
        },
      }),
    ).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_INVENTORY" });
  });

  test("matches APPLY_DESIGN settlement-overflow rejection in context and Apply preview", () => {
    const definitionId = "module-vacuum-tube-logic";
    const state = createInitialGameState({ content, seed: "build-apply-overflow" });
    const installed = moduleFixture("apply-overflow-module", definitionId);
    state.facility.modules = { [installed.id]: installed };
    state.economy.totalExpenseUsd = 9_007_199_200;
    const core = createProductionSimCore({ content, initialState: state });
    for (const command of [
      {
        commandId: "79000000-0000-4000-8000-000000000050",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      },
      {
        commandId: "79000000-0000-4000-8000-000000000051",
        source: "player",
        kind: "MOVE_MODULE",
        moduleInstanceId: installed.id,
        position: { x: 3, y: 3 },
      },
    ]) {
      core.enqueue(parseSimCommand(command));
      expect(core.processPendingCommands()).toMatchObject([{ accepted: true }]);
    }
    const context = core.queryBuild({ kind: "context", mode: "draft", clientIntentSequence: 15 });
    if (context.kind !== "context" || context.status !== "ready") {
      throw new Error("Expected ready Build context.");
    }
    expect(context.context.apply).toEqual({ eligible: false, reason: "INVALID_SYSTEM" });
    const preview = core.queryBuild({
      kind: "apply",
      mode: "draft",
      clientIntentSequence: 16,
    });
    expect(preview).toMatchObject({ status: "rejected", reason: "INVALID_SYSTEM" });
    if (preview.kind !== "apply" || !("data" in preview) || preview.data.status !== "ready") {
      throw new Error("Expected rejected Apply query with exact calculation data.");
    }
    core.enqueue(
      parseSimCommand({
        commandId: "79000000-0000-4000-8000-000000000052",
        source: "player",
        kind: "APPLY_DESIGN",
        expectedDraftRevision: preview.data.draftRevision,
        acceptedCostUsd: preview.data.netCostUsd,
        acceptedDowntimeTicks: preview.data.downtimeTicks,
      }),
    );
    expect(core.processPendingCommands()).toMatchObject([
      { accepted: false, code: "INVALID_SYSTEM" },
    ]);
  });
});
