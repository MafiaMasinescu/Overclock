import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityPowerState, GameState, ModuleInstanceState } from "../core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../core/tickSystems.ts";
import { calculateEnergyCostUsd } from "../economy/money.ts";
import {
  allocatePowerDelivery,
  createPowerAllocationScratch,
  type PowerAllocationScratch,
} from "./powerAllocation.ts";
import { calculatePowerDemand } from "./powerDemand.ts";
import { assertValidStoredPowerState } from "./powerState.ts";
import {
  assertValidPowerTickResult,
  createPowerTickValidationScratch,
  type PowerTickValidationScratch,
} from "./powerTickValidation.ts";
import { createPowerTopology } from "./powerTopology.ts";
import { applyPowerOperationalTransitions } from "./powerTransitions.ts";

export interface FacilityPowerCalculation {
  readonly power: FacilityPowerState;
  readonly modules: Record<string, ModuleInstanceState>;
}

export type PowerTopologyCacheEvent = "hit" | "rebuild" | "clear";
export type PowerResultCacheEvent = "calculated" | "reused";

export interface PowerTickSystemOptions {
  readonly onTopologyCacheEvent?: (event: PowerTopologyCacheEvent) => void;
  readonly onPowerResultCacheEvent?: (event: PowerResultCacheEvent) => void;
}

function sameModuleDelivery(
  left: FacilityPowerState["byModule"][string],
  right: FacilityPowerState["byModule"][string],
): boolean {
  return (
    left.moduleInstanceId === right.moduleInstanceId &&
    left.requestedPowerWatts === right.requestedPowerWatts &&
    left.minimumPowerWatts === right.minimumPowerWatts &&
    left.deliveredPowerWatts === right.deliveredPowerWatts &&
    left.powerFactor === right.powerFactor &&
    left.limitingReason === right.limitingReason
  );
}

function sameRouteDelivery(
  left: FacilityPowerState["byRoute"][string],
  right: FacilityPowerState["byRoute"][string],
): boolean {
  return (
    left.routeId === right.routeId &&
    left.deliveredPowerWatts === right.deliveredPowerWatts &&
    left.utilizationRatio === right.utilizationRatio
  );
}

function reuseStablePowerRecords(
  previous: Readonly<FacilityPowerState>,
  next: FacilityPowerState,
  topology: ReturnType<typeof createPowerTopology>,
): FacilityPowerState {
  if (
    previous.layoutRevision === next.layoutRevision &&
    previous.totalRequestedPowerWatts === next.totalRequestedPowerWatts &&
    previous.totalDeliveredPowerWatts === next.totalDeliveredPowerWatts &&
    previous.headroomWatts === next.headroomWatts &&
    previous.energyCostUsdThisTick === next.energyCostUsdThisTick &&
    previous.byModule === next.byModule &&
    previous.byRoute === next.byRoute
  ) {
    return previous;
  }
  let moduleRecordsChanged = Object.keys(previous.byModule).length !== topology.moduleIds.length;
  const byModule: FacilityPowerState["byModule"] = {};
  for (const moduleId of topology.moduleIds) {
    const previousRecord = previous.byModule[moduleId];
    const nextRecord = next.byModule[moduleId];
    if (nextRecord === undefined) throw new Error("Power module result coverage is incomplete.");
    if (previousRecord !== undefined && sameModuleDelivery(previousRecord, nextRecord)) {
      byModule[moduleId] = previousRecord;
    } else {
      moduleRecordsChanged = true;
      byModule[moduleId] = nextRecord;
    }
  }

  let routeRecordsChanged = Object.keys(previous.byRoute).length !== topology.powerRouteIds.length;
  const byRoute: FacilityPowerState["byRoute"] = {};
  for (const routeId of topology.powerRouteIds) {
    const previousRecord = previous.byRoute[routeId];
    const nextRecord = next.byRoute[routeId];
    if (nextRecord === undefined) throw new Error("Power route result coverage is incomplete.");
    if (previousRecord !== undefined && sameRouteDelivery(previousRecord, nextRecord)) {
      byRoute[routeId] = previousRecord;
    } else {
      routeRecordsChanged = true;
      byRoute[routeId] = nextRecord;
    }
  }

  const reusedByModule = moduleRecordsChanged ? byModule : previous.byModule;
  const reusedByRoute = routeRecordsChanged ? byRoute : previous.byRoute;
  if (
    previous.layoutRevision === next.layoutRevision &&
    previous.totalRequestedPowerWatts === next.totalRequestedPowerWatts &&
    previous.totalDeliveredPowerWatts === next.totalDeliveredPowerWatts &&
    previous.headroomWatts === next.headroomWatts &&
    previous.energyCostUsdThisTick === next.energyCostUsdThisTick &&
    reusedByModule === previous.byModule &&
    reusedByRoute === previous.byRoute
  ) {
    return previous;
  }
  return { ...next, byModule: reusedByModule, byRoute: reusedByRoute };
}

export function calculateFacilityPower(
  state: Readonly<GameState>,
  content: ContentBundle,
  cachedTopology?: ReturnType<typeof createPowerTopology>,
  allocationScratch?: PowerAllocationScratch,
  demandScratch?: Record<string, ReturnType<typeof calculatePowerDemand>[string]>,
): FacilityPowerCalculation {
  const topology = cachedTopology ?? createPowerTopology(state.facility, content);
  const demands = calculatePowerDemand(
    state.facility.modules,
    content,
    topology.moduleIds,
    demandScratch,
  );
  const allocation = allocatePowerDelivery(
    state.facility,
    demands,
    topology,
    content,
    allocationScratch,
    state.facility.power,
  );
  const modules = applyPowerOperationalTransitions(
    state.facility.modules,
    allocation.byModule,
    topology.moduleIds,
    topology.moduleRecordUsesStableOrder ||
      state.facility.power.layoutRevision === state.facility.liveLayoutRevision,
  );
  const calculatedPower: FacilityPowerState = {
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
  const power = reuseStablePowerRecords(state.facility.power, calculatedPower, topology);
  return { power, modules };
}

export function createPowerTickSystems(
  content: ContentBundle,
  options: PowerTickSystemOptions = {},
): TickSystemRegistry {
  return Object.freeze({
    "calculate-power-demand-and-delivery": {
      createRuntime() {
        let topologyCache:
          | {
              readonly layoutRevision: number;
              readonly topology: ReturnType<typeof createPowerTopology>;
              readonly allocationScratch: PowerAllocationScratch;
              readonly demandScratch: ReturnType<typeof calculatePowerDemand>;
              readonly validationScratch: PowerTickValidationScratch;
            }
          | undefined;
        let lastCalculation:
          | {
              readonly modules: GameState["facility"]["modules"];
              readonly power: GameState["facility"]["power"];
              readonly routes: GameState["facility"]["routes"];
              readonly contractedPowerWatts: number;
              readonly energyPriceUsdPerKwh: number;
              readonly liveLayoutRevision: number;
            }
          | undefined;
        return {
          executionMode: "structural-sharing" as const,
          validateLifecycleState(state) {
            assertValidStoredPowerState(state, content);
            createPowerTopology(state.facility, content);
          },
          clearDerivedState() {
            topologyCache = undefined;
            lastCalculation = undefined;
            options.onTopologyCacheEvent?.("clear");
          },
          run({ state }: StructuralSharingTickSystemContext) {
            let topology = topologyCache?.topology;
            if (
              topology === undefined ||
              topologyCache?.layoutRevision !== state.facility.liveLayoutRevision
            ) {
              assertValidStoredPowerState(state, content);
              topology = createPowerTopology(state.facility, content);
              topologyCache = {
                layoutRevision: state.facility.liveLayoutRevision,
                topology,
                allocationScratch: createPowerAllocationScratch(topology),
                demandScratch: {},
                validationScratch: createPowerTickValidationScratch(topology),
              };
              options.onTopologyCacheEvent?.("rebuild");
            } else {
              options.onTopologyCacheEvent?.("hit");
            }
            if (
              lastCalculation?.modules === state.facility.modules &&
              lastCalculation.power === state.facility.power &&
              lastCalculation.routes === state.facility.routes &&
              lastCalculation.contractedPowerWatts === state.facility.contractedPowerWatts &&
              lastCalculation.energyPriceUsdPerKwh === state.economy.energyPriceUsdPerKwh &&
              lastCalculation.liveLayoutRevision === state.facility.liveLayoutRevision
            ) {
              options.onPowerResultCacheEvent?.("reused");
              return state;
            }
            const result = calculateFacilityPower(
              state,
              content,
              topology,
              topologyCache.allocationScratch,
              topologyCache.demandScratch,
            );
            assertValidPowerTickResult(
              state,
              result,
              topology,
              content,
              topologyCache.validationScratch,
            );
            lastCalculation =
              result.modules === state.facility.modules
                ? {
                    modules: result.modules,
                    power: result.power,
                    routes: state.facility.routes,
                    contractedPowerWatts: state.facility.contractedPowerWatts,
                    energyPriceUsdPerKwh: state.economy.energyPriceUsdPerKwh,
                    liveLayoutRevision: state.facility.liveLayoutRevision,
                  }
                : undefined;
            options.onPowerResultCacheEvent?.("calculated");
            const candidate: GameState = {
              ...state,
              facility: {
                ...state.facility,
                modules: result.modules,
                power: result.power,
              },
            };
            return candidate;
          },
        };
      },
    },
  });
}
