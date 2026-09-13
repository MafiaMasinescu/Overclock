import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createReplayCommandDriver } from "../../src/devtools/milestoneBot/replayCommandDriver.ts";
import { createTemplateExecutor } from "../../src/devtools/milestoneBot/templateExecutor.ts";
import { BUILD_TEMPLATES } from "../../src/devtools/milestoneBot/buildTemplates.ts";
import {
  assertValidBuildTemplates,
  validateBuildTemplate,
  validateAllBuildTemplates,
} from "../../src/devtools/milestoneBot/buildTemplateValidation.ts";

describe("milestone bot build templates", () => {
  test("contains the fixed immutable three-template chain", () => {
    const content = loadContentBundle();
    expect(BUILD_TEMPLATES.map((template) => template.id)).toEqual([
      "starter-serial",
      "expanded-balanced",
      "cooled-benchmark",
    ]);
    expect(validateAllBuildTemplates(content)).toEqual([]);
    expect(() => {
      assertValidBuildTemplates(content);
    }).not.toThrow();
    expect(Object.isFrozen(BUILD_TEMPLATES[0])).toBe(true);
  });

  test("keeps the expanded task cluster memory-complete and powers its arithmetic unit", () => {
    const expanded = BUILD_TEMPLATES.find((template) => template.id === "expanded-balanced");
    if (expanded === undefined) throw new Error("Expected the expanded template.");

    expect(expanded.clusterRoles["task-primary"]).toEqual([
      "memory",
      "memory-2",
      "arithmetic",
      "arithmetic-2",
      "arithmetic-3",
      "arithmetic-4",
    ]);
    expect(expanded.clusterRoles["research-primary"]).toEqual([
      "memory",
      "arithmetic",
      "arithmetic-2",
    ]);
    expect(expanded.routes).toContainEqual(
      expect.objectContaining({
        kind: "power",
        from: { moduleKey: "power", portId: "power-out-south" },
        to: { moduleKey: "memory-2", portId: "power-in-south" },
      }),
    );
    expect(expanded.routes).toContainEqual(
      expect.objectContaining({
        kind: "power",
        from: { moduleKey: "power", portId: "power-out-south" },
        to: { moduleKey: "arithmetic", portId: "power-in-west" },
      }),
    );
    expect(expanded.routes).toContainEqual(
      expect.objectContaining({
        kind: "data",
        from: { moduleKey: "arithmetic", portId: "data-out-east" },
        to: { moduleKey: "memory", portId: "data-west" },
      }),
    );
    expect(expanded.routes).toContainEqual(
      expect.objectContaining({
        kind: "power",
        from: { moduleKey: "power", portId: "power-out-south" },
        to: { moduleKey: "arithmetic-2", portId: "power-in-west" },
      }),
    );
  });

  test("keeps the cooled task cluster memory-complete and powers its cooling module", () => {
    const cooled = BUILD_TEMPLATES.find((template) => template.id === "cooled-benchmark");
    if (cooled === undefined) throw new Error("Expected the cooled template.");

    expect(cooled.clusterRoles["task-primary"]).toEqual([
      "memory",
      "memory-2",
      "delay-memory",
      "arithmetic",
      "arithmetic-2",
      "arithmetic-3",
      "arithmetic-4",
      "arithmetic-5",
    ]);
    expect(cooled.clusterRoles["research-primary"]).toEqual([
      "memory",
      "arithmetic",
      "arithmetic-2",
    ]);
    expect(cooled.clusterRoles["benchmark-peak"]).toEqual([
      "logic",
      "arithmetic",
      "arithmetic-2",
      "arithmetic-3",
      "arithmetic-4",
      "arithmetic-5",
    ]);
    expect(cooled.modules).toContainEqual(
      expect.objectContaining({
        key: "arithmetic-5",
        definitionId: "module-arithmetic-unit",
      }),
    );
    expect(cooled.routes).toContainEqual(
      expect.objectContaining({
        kind: "power",
        from: { moduleKey: "power-benchmark", portId: "power-out-south" },
        to: { moduleKey: "delay-memory", portId: "power-in-west" },
      }),
    );
    expect(cooled.routes).toContainEqual(
      expect.objectContaining({
        kind: "data",
        from: { moduleKey: "memory-2", portId: "data-east" },
        to: { moduleKey: "delay-memory", portId: "data-west" },
      }),
    );
    expect(cooled.routes).toContainEqual(
      expect.objectContaining({
        kind: "power",
        from: { moduleKey: "power-benchmark", portId: "power-out-south" },
        to: { moduleKey: "room-cooling", portId: "power-in-west" },
      }),
    );
    expect(cooled.routes).toContainEqual(
      expect.objectContaining({
        kind: "power",
        from: { moduleKey: "power-benchmark", portId: "power-out-south" },
        to: { moduleKey: "arithmetic-5", portId: "power-in-west" },
      }),
    );
  });

  test("executes the complete template chain with a fully powered benchmark cluster", () => {
    const content = loadContentBundle();
    const initialState = createInitialGameState({ content, seed: "template-chain-power" });
    initialState.economy.cashUsd = 100_000;
    initialState.research.statuses["research-stable-power-distribution"] = "completed";
    initialState.research.statuses["research-vacuum-tube-reliability"] = "completed";
    initialState.research.statuses["research-delay-line-memory"] = "completed";
    const driver = createReplayCommandDriver({
      content,
      seed: "template-chain-power",
      initialState,
    });
    const executor = createTemplateExecutor({ content, driver });

    executor.applyTemplate("starter-serial");
    executor.applyTemplate("expanded-balanced");
    executor.applyTemplate("cooled-benchmark");
    driver.applyClockCommand({ kind: "SET_PAUSED", paused: false });
    driver.advanceTicks(100);

    const state = driver.getDetachedState();
    const mapping = executor.getModuleMapping();
    const cluster = executor.resolveClusterRole("cooled-benchmark", "benchmark-sustained");
    expect(cluster).toHaveLength(5);
    for (const key of [
      "power-benchmark",
      "delay-memory",
      "arithmetic-2",
      "arithmetic-3",
      "arithmetic-4",
      "room-cooling",
    ]) {
      expect(typeof mapping[key]).toBe("string");
    }
    for (const key of [
      "arithmetic",
      "arithmetic-2",
      "arithmetic-3",
      "arithmetic-4",
      "arithmetic-5",
      "delay-memory",
      "room-cooling",
    ]) {
      const id = mapping[key];
      if (id === undefined) throw new Error(`Missing template mapping for ${key}.`);
      expect(state.facility.modules[id]?.operationalState).toBe("online");
      expect(state.facility.power.byModule[id]?.powerFactor).toBe(1);
    }
  });

  test("rejects malformed nested route values without throwing", () => {
    const content = loadContentBundle();
    const route = BUILD_TEMPLATES[0].routes[0];
    if (route === undefined) throw new Error("Expected the starter template to contain a route.");
    const malformed = {
      ...BUILD_TEMPLATES[0],
      routes: [{ ...route, from: { moduleKey: 1, portId: route.from.portId } }],
    };
    expect(() => validateBuildTemplate(malformed, content)).not.toThrow();
    expect(validateBuildTemplate(malformed, content)).toEqual([
      { path: "routes[0]", message: "must contain valid route values" },
    ]);
  });
});
