import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityState, GameState } from "../core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../core/tickSystems.ts";
import { buildThermalTopology } from "../thermal/thermalDomain.ts";
import { assertValidThermalState } from "../thermal/thermalState.ts";
import type { ThermalTopology } from "../thermal/contracts.ts";
import {
  calculateFacilityOverclockResult,
  createFacilityOverclockCalculationScratch,
  type FacilityOverclockCalculationScratch,
  validateGeneratedOverclockTickResult,
} from "./overclockStabilityDomain.ts";
import { assertValidStoredOverclockState } from "./overclockState.ts";

export type OverclockTopologyCacheEvent = "hit" | "rebuild" | "clear";

export interface OverclockTickSystemOptions {
  readonly onTopologyCacheEvent?: (event: OverclockTopologyCacheEvent) => void;
}

interface OverclockTopologyCache {
  readonly layoutRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly topology: ThermalTopology;
  readonly calculationScratch: FacilityOverclockCalculationScratch;
}

function resolveTopology(
  cached: OverclockTopologyCache | undefined,
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  options: OverclockTickSystemOptions,
): OverclockTopologyCache {
  if (
    cached?.layoutRevision === facility.liveLayoutRevision &&
    cached.facilityWidth === facility.size.width &&
    cached.facilityHeight === facility.size.height
  ) {
    options.onTopologyCacheEvent?.("hit");
    return cached;
  }
  const topology = buildThermalTopology(facility, content);
  const next: OverclockTopologyCache = {
    layoutRevision: facility.liveLayoutRevision,
    facilityWidth: facility.size.width,
    facilityHeight: facility.size.height,
    topology,
    calculationScratch: createFacilityOverclockCalculationScratch(content, topology),
  };
  options.onTopologyCacheEvent?.("rebuild");
  return next;
}

export function createOverclockTickSystems(
  content: ContentBundle,
  options: OverclockTickSystemOptions = {},
): TickSystemRegistry {
  return Object.freeze({
    "apply-throttling-stability-and-shutdown": {
      createRuntime() {
        let topologyCache: OverclockTopologyCache | undefined;
        return {
          executionMode: "structural-sharing" as const,
          validateLifecycleState(state: Readonly<GameState>) {
            assertValidStoredOverclockState(state, content);
            assertValidThermalState(state.facility, content.balancing.thermal);
            buildThermalTopology(state.facility, content);
          },
          clearDerivedState() {
            topologyCache = undefined;
            options.onTopologyCacheEvent?.("clear");
          },
          run({ state }: StructuralSharingTickSystemContext): GameState {
            // The immediately preceding Thermal update validates the current-tick field. The
            // lifecycle construction/replacement validator above covers standalone registration.
            topologyCache = resolveTopology(topologyCache, state.facility, content, options);
            const result = calculateFacilityOverclockResult(
              state.facility,
              content,
              topologyCache.topology,
              topologyCache.calculationScratch,
            );
            const issues = validateGeneratedOverclockTickResult(
              state.facility,
              content,
              topologyCache.topology,
              result,
              topologyCache.calculationScratch,
            );
            if (issues.length > 0) {
              throw new Error(
                `Invalid Overclock tick result:\n${issues
                  .map((issue) => `${issue.path}: ${issue.message}`)
                  .join("\n")}`,
              );
            }
            const candidate: GameState = {
              ...state,
              facility: {
                ...state.facility,
                modules: result.modules,
                overclock: result.overclock,
              },
            };
            return candidate;
          },
        };
      },
    },
  });
}
