import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import {
  hashSimulationContent,
  SIMULATOR_PROTOCOL_VERSION,
} from "../../src/sim/replay/replayContracts.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

describe("Replay compatibility contracts", () => {
  test("fingerprint is stable for equivalent content object insertion order", () => {
    const content = loadContentBundle();
    const reordered = {
      balancing: content.balancing,
      era: content.era,
      research: content.research,
      tasks: content.tasks,
      modules: content.modules,
      contentVersion: content.contentVersion,
      locales: content.locales,
    };

    expect(hashSimulationContent(content)).toBe(hashSimulationContent(reordered));
    expect(SIMULATOR_PROTOCOL_VERSION).toBe(1);
  });

  test("locale-only changes do not invalidate the simulation fingerprint", () => {
    const content = loadContentBundle();
    const changedLocales = structuredClone(content) as unknown as {
      locales: { en: { ui: Record<string, string> } };
    };
    changedLocales.locales.en.ui["objective"] = "changed only for replay compatibility";

    expect(hashSimulationContent(changedLocales as never)).toBe(hashSimulationContent(content));
  });

  test.each(["modules", "tasks", "research", "era", "balancing"] as const)(
    "simulation %s changes the fingerprint",
    (section) => {
      const content = loadContentBundle();
      const changed = structuredClone(content) as unknown as {
        modules: Record<string, { baseComputeFlops: number }>;
        tasks: Record<string, { payoutUsd: number }>;
        research: Record<string, { researchDataCost: number }>;
        era: { startingCashUsd: number };
        balancing: { thermal: { dirtyEpsilonC: number } };
      };
      if (section === "modules") {
        const module = changed.modules["module-vacuum-tube-logic"];
        if (module === undefined) throw new Error("module fixture missing");
        module.baseComputeFlops += 1;
      } else if (section === "tasks") {
        const task = changed.tasks["task-ballistic-table-verification"];
        if (task === undefined) throw new Error("task fixture missing");
        task.payoutUsd += 1;
      } else if (section === "research") {
        const research = changed.research["research-stable-power-distribution"];
        if (research === undefined) throw new Error("research fixture missing");
        research.researchDataCost += 1;
      } else if (section === "era") {
        changed.era.startingCashUsd += 1;
      } else {
        changed.balancing.thermal.dirtyEpsilonC += 0.001;
      }

      expect(hashSimulationContent(changed as never)).not.toBe(hashSimulationContent(content));
    },
  );

  test("does not change existing canonical GameState hashing", () => {
    expect(hashCanonicalState({ a: 1 })).toBe("9c3e82dd6fcae8b1");
  });
});
