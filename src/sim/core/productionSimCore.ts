import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { createInventoryEconomyCommandHandlers } from "../economy/inventoryTransactions.ts";
import { createDesignModeCommandHandlers } from "../design/designModeCommands.ts";
import { createOverclockCommandHandlers } from "../overclock/overclockCommands.ts";
import { createResearchCommandHandlers } from "../research/researchCommands.ts";
import { createTaskCommandHandlers } from "../tasks/taskCommands.ts";
import { createBenchmarkCommandHandlers } from "../benchmarks/benchmarkCommands.ts";
import { createBlueprintCommandHandlers } from "../blueprints/blueprintCommands.ts";
import { createPowerTickSystems } from "../power/facilityPower.ts";
import { createThermalTickSystems } from "../thermal/facilityThermal.ts";
import { createOverclockTickSystems } from "../overclock/facilityOverclock.ts";
import { createComputeTickSystems } from "../compute/facilityCompute.ts";
import { createTaskBenchmarkTickSystems } from "../tasks/facilityTasks.ts";
import { createResearchTickSystems } from "../research/facilityResearch.ts";
import { SimCore, type SimCoreCommandHandlerRegistry, type SimCoreOptions } from "./simCore.ts";
import type { TickSystemRegistry } from "./tickSystems.ts";
import type { GameState } from "./types.ts";

export interface ProductionSimCoreOptions {
  readonly content: ContentBundle;
  readonly initialState: GameState;
  readonly initialCommandQueueSequence?: number;
}

export function composeUniqueRegistry<T extends object>(registries: readonly T[]): T {
  const composed: Record<string, unknown> = {};
  for (const registry of registries) {
    for (const key of Object.keys(registry)) {
      if (Object.hasOwn(composed, key)) throw new Error(`Duplicate registry key: ${key}`);
      composed[key] = (registry as Record<string, unknown>)[key];
    }
  }
  return Object.freeze(composed) as T;
}

export function createProductionSimCore({
  content,
  initialState,
  initialCommandQueueSequence,
}: ProductionSimCoreOptions): SimCore {
  const commandHandlers = composeUniqueRegistry<SimCoreCommandHandlerRegistry>([
    createInventoryEconomyCommandHandlers(content),
    createDesignModeCommandHandlers(content),
    createOverclockCommandHandlers(content),
    createTaskCommandHandlers(content),
    createResearchCommandHandlers(content),
    createBenchmarkCommandHandlers(content),
    createBlueprintCommandHandlers(content),
  ]);
  const tickSystems = composeUniqueRegistry<TickSystemRegistry>([
    createPowerTickSystems(content),
    createThermalTickSystems(content),
    createOverclockTickSystems(content),
    createComputeTickSystems(content),
    createTaskBenchmarkTickSystems(content),
    createResearchTickSystems(content),
  ]);
  const options: SimCoreOptions = {
    initialState,
    commandHandlers,
    tickSystems,
  };
  if (initialCommandQueueSequence !== undefined) {
    options.initialCommandQueueSequence = initialCommandQueueSequence;
  }
  return new SimCore(options);
}
