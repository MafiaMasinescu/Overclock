import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityPowerState, GameState, ModuleInstanceState } from "../core/types.ts";
import type { TickSystemRegistry } from "../core/tickSystems.ts";
import { calculateEnergyCostUsd } from "../economy/money.ts";
import { allocatePowerDelivery } from "./powerAllocation.ts";
import { calculatePowerDemand } from "./powerDemand.ts";
import { assertValidPowerState } from "./powerState.ts";
import { createPowerTopology } from "./powerTopology.ts";
import { applyPowerOperationalTransitions } from "./powerTransitions.ts";

export interface FacilityPowerCalculation {
  readonly power: FacilityPowerState;
  readonly modules: Record<string, ModuleInstanceState>;
}

export function calculateFacilityPower(
  state: Readonly<GameState>,
  content: ContentBundle,
): FacilityPowerCalculation {
  const demands = calculatePowerDemand(state.facility.modules, content);
  const topology = createPowerTopology(state.facility, content);
  const allocation = allocatePowerDelivery(state.facility, demands, topology, content);
  const modules = applyPowerOperationalTransitions(state.facility.modules, allocation.byModule);
  const power: FacilityPowerState = {
    layoutRevision: state.facility.liveLayoutRevision,
    totalRequestedPowerWatts: allocation.totalRequestedPowerWatts,
    totalDeliveredPowerWatts: allocation.totalDeliveredPowerWatts,
    headroomWatts: allocation.headroomWatts,
    energyCostUsdThisTick: calculateEnergyCostUsd(
      allocation.totalDeliveredPowerWatts,
      0.1,
      state.economy.energyPriceUsdPerKwh,
    ),
    byModule: allocation.byModule,
    byRoute: allocation.byRoute,
  };
  return { power, modules };
}

export function createPowerTickSystems(content: ContentBundle): TickSystemRegistry {
  return Object.freeze({
    "calculate-power-demand-and-delivery"({ state }) {
      assertValidPowerState(state, content);
      const calculationInputModules = state.facility.modules;
      const result = calculateFacilityPower(state, content);
      state.facility.modules = result.modules;
      state.facility.power = result.power;
      assertValidPowerState(state, content, calculationInputModules);
    },
  });
}
