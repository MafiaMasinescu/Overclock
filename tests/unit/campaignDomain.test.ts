import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { createCampaignTickSystems } from "../../src/sim/campaign/facilityCampaign.ts";

describe("campaign calendar", () => {
  test("production currently exposes the missing 1947 offer transition", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "task-15-calendar" });
    const core = createProductionSimCore({ content, initialState: state });

    core.step(12_001);

    expect(core.getStateForSave().campaign.currentYear).toBe(1947);
  });

  test("uses structural sharing on ordinary ticks and changes only the campaign branch", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-sharing" });
    const registration =
      createCampaignTickSystems(content)["update-tutorial-achievements-and-campaign"];
    if (registration === undefined || typeof registration === "function") {
      throw new Error("Expected a campaign tick factory.");
    }
    const runtime = registration.createRuntime();
    if (runtime.executionMode !== "structural-sharing") {
      throw new Error("Expected a structural-sharing campaign runtime.");
    }
    const unchanged = runtime.run({ state, rng: { getState: () => state.rngState } as never });
    expect(unchanged).toBe(state);

    const boundaryState = structuredClone(state);
    boundaryState.tick = 11_999;
    const transitioned = runtime.run({
      state: boundaryState,
      rng: { getState: () => boundaryState.rngState } as never,
    });
    expect(transitioned).not.toBe(boundaryState);
    expect(transitioned.campaign.currentYear).toBe(1947);
    expect(transitioned.facility).toBe(boundaryState.facility);
    expect(transitioned.tasks).toBe(boundaryState.tasks);
  });

  test("reconciles a newly eligible year-gated offer on the following tick", () => {
    const content = loadContentBundle();
    const state = createInitialGameState({ content, seed: "campaign-offers" });
    const prepared = structuredClone(state);
    prepared.research.statuses["research-stable-power-distribution"] = "completed";
    prepared.research.statuses["research-forced-airflow"] = "completed";
    const core = createProductionSimCore({ content, initialState: prepared });

    core.step(12_000);
    expect(core.getStateForSave().campaign.currentYear).toBe(1947);
    expect(core.getStateForSave().tasks.offers).not.toContain("task-reactor-diffusion-study");

    core.step(1);
    expect(core.getStateForSave().tasks.offers).toContain("task-reactor-diffusion-study");
  });
});
