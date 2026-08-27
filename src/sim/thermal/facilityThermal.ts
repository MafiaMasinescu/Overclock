import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityState, GameState, ThermalTileState } from "../core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  StructuralSharingTickSystemRuntime,
  TickSystemRegistry,
} from "../core/tickSystems.ts";
import { assertValidStoredPowerState } from "../power/powerState.ts";
import {
  assertValidThermalUpdateOutput,
  buildThermalTopology,
  calculateHeatGeneration,
  updateThermalState,
  validateThermalGeneration,
} from "./thermalDomain.ts";
import type {
  ThermalGeneration,
  ThermalGenerationScratch,
  ThermalTopology,
  ThermalUpdateScratch,
} from "./contracts.ts";
import { assertValidThermalState } from "./thermalState.ts";

export type ThermalTopologyCacheEvent = "hit" | "rebuild" | "clear";
export type ThermalStageEvent = "calculate-heat-generation" | "update-thermal-state";
export type ThermalPowerValidationCacheEvent = "hit" | "validated";

export interface ThermalTickSystemOptions {
  readonly onTopologyCacheEvent?: (event: ThermalTopologyCacheEvent) => void;
  readonly onStageEvent?: (stage: ThermalStageEvent) => void;
  readonly onPowerValidationCacheEvent?: (event: ThermalPowerValidationCacheEvent) => void;
}

interface ThermalTopologyCache {
  readonly layoutRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly topology: ThermalTopology;
  readonly generationScratch: ThermalGenerationScratch;
  readonly updateScratch: ThermalUpdateScratch;
}

interface PendingThermalGeneration {
  readonly tick: number;
  readonly layoutRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly facilityIdentity: FacilityState;
  readonly powerIdentity: FacilityState["power"];
  readonly thermalTilesIdentity: readonly ThermalTileState[];
  readonly topologyIdentity: ThermalTopology;
  readonly generation: ThermalGeneration;
}

interface ValidatedPowerInputs {
  readonly modulesIdentity: FacilityState["modules"];
  readonly powerIdentity: FacilityState["power"];
  readonly routesIdentity: FacilityState["routes"];
  readonly contractedPowerWatts: number;
  readonly energyPriceUsdPerKwh: number;
  readonly liveLayoutRevision: number;
}

interface ThermalRuntimeInternal {
  topologyCache: ThermalTopologyCache | undefined;
  pending: PendingThermalGeneration | undefined;
  validatedPowerInputs: ValidatedPowerInputs | undefined;
}

function createRuntime(): ThermalRuntimeInternal {
  return { topologyCache: undefined, pending: undefined, validatedPowerInputs: undefined };
}

function createGenerationScratch(tileCount: number): ThermalGenerationScratch {
  return {
    heatWattsOnTile: new Float64Array(tileCount),
    localCoolingWattsOnTile: new Float64Array(tileCount),
  };
}

function createUpdateScratch(tileCount: number): ThermalUpdateScratch {
  return { nextTemperatureC: new Float64Array(tileCount) };
}

function clearRuntime(runtime: ThermalRuntimeInternal): void {
  runtime.pending = undefined;
  runtime.topologyCache = undefined;
  runtime.validatedPowerInputs = undefined;
}

function hasValidatedPowerInputs(
  validated: ValidatedPowerInputs | undefined,
  state: Readonly<GameState>,
): boolean {
  return (
    validated?.modulesIdentity === state.facility.modules &&
    validated.powerIdentity === state.facility.power &&
    validated.routesIdentity === state.facility.routes &&
    validated.contractedPowerWatts === state.facility.contractedPowerWatts &&
    validated.energyPriceUsdPerKwh === state.economy.energyPriceUsdPerKwh &&
    validated.liveLayoutRevision === state.facility.liveLayoutRevision
  );
}

function assertCurrentCalculatedPower(
  runtime: ThermalRuntimeInternal,
  state: Readonly<GameState>,
  content: ContentBundle,
  options: ThermalTickSystemOptions,
): void {
  if (hasValidatedPowerInputs(runtime.validatedPowerInputs, state)) {
    options.onPowerValidationCacheEvent?.("hit");
    return;
  }
  assertValidStoredPowerState(state, content);
  if (state.facility.power.layoutRevision !== state.facility.liveLayoutRevision) {
    throw new Error("Thermal generation requires current-tick calculated Power.");
  }
  runtime.validatedPowerInputs = {
    modulesIdentity: state.facility.modules,
    powerIdentity: state.facility.power,
    routesIdentity: state.facility.routes,
    contractedPowerWatts: state.facility.contractedPowerWatts,
    energyPriceUsdPerKwh: state.economy.energyPriceUsdPerKwh,
    liveLayoutRevision: state.facility.liveLayoutRevision,
  };
  options.onPowerValidationCacheEvent?.("validated");
}

function resolveTopology(
  runtime: ThermalRuntimeInternal,
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  options: ThermalTickSystemOptions,
): ThermalTopologyCache {
  const cached = runtime.topologyCache;
  if (
    cached?.layoutRevision === facility.liveLayoutRevision &&
    cached.facilityWidth === facility.size.width &&
    cached.facilityHeight === facility.size.height
  ) {
    options.onTopologyCacheEvent?.("hit");
    return cached;
  }
  const topology = buildThermalTopology(facility, content);
  const next: ThermalTopologyCache = {
    layoutRevision: facility.liveLayoutRevision,
    facilityWidth: facility.size.width,
    facilityHeight: facility.size.height,
    topology,
    generationScratch: createGenerationScratch(topology.tileCount),
    updateScratch: createUpdateScratch(topology.tileCount),
  };
  runtime.topologyCache = next;
  options.onTopologyCacheEvent?.("rebuild");
  return next;
}

function assertPendingMatches(
  runtime: ThermalRuntimeInternal,
  state: Readonly<GameState>,
): PendingThermalGeneration {
  const pending = runtime.pending;
  const cache = runtime.topologyCache;
  if (pending === undefined || cache === undefined) {
    throw new Error("Thermal update requires exactly one pending heat generation.");
  }
  const { facility } = state;
  if (
    pending.tick !== state.tick ||
    pending.layoutRevision !== facility.liveLayoutRevision ||
    pending.facilityWidth !== facility.size.width ||
    pending.facilityHeight !== facility.size.height ||
    pending.facilityIdentity !== facility ||
    pending.powerIdentity !== facility.power ||
    pending.thermalTilesIdentity !== facility.thermalTiles ||
    pending.topologyIdentity !== cache.topology
  ) {
    throw new Error("Thermal pending heat generation is stale for the current candidate state.");
  }
  return pending;
}

function assertSafeThermalRevisionIncrement(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Thermal revision cannot be incremented safely.");
  }
}

function reuseUnchangedThermalTiles(
  previous: readonly ThermalTileState[],
  next: readonly ThermalTileState[],
): ThermalTileState[] {
  if (previous.length !== next.length) {
    throw new Error("Thermal update must preserve complete tile coverage.");
  }
  return next.map((nextTile, index) => {
    const previousTile = previous[index];
    if (previousTile === undefined) throw new Error("Thermal tile coverage is incomplete.");
    return previousTile.temperatureC === nextTile.temperatureC
      ? previousTile
      : { position: previousTile.position, temperatureC: nextTile.temperatureC };
  });
}

function stageOneRuntime(
  runtime: ThermalRuntimeInternal,
  content: ContentBundle,
  options: ThermalTickSystemOptions,
): StructuralSharingTickSystemRuntime {
  return {
    executionMode: "structural-sharing",
    validateLifecycleState(state) {
      assertValidThermalState(state.facility, content.balancing.thermal);
      buildThermalTopology(state.facility, content);
    },
    clearDerivedState() {
      clearRuntime(runtime);
      options.onTopologyCacheEvent?.("clear");
    },
    run({ state }: StructuralSharingTickSystemContext): GameState {
      runtime.pending = undefined;
      try {
        assertValidThermalState(state.facility, content.balancing.thermal);
        assertCurrentCalculatedPower(runtime, state, content, options);
        const cache = resolveTopology(runtime, state.facility, content, options);
        const generation = calculateHeatGeneration(
          state.facility,
          content,
          cache.topology,
          cache.generationScratch,
        );
        const issues = validateThermalGeneration(generation, cache.topology.tileCount);
        if (issues.length > 0) {
          throw new Error(
            `Invalid generated thermal fields:\n${issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join("\n")}`,
          );
        }
        runtime.pending = {
          tick: state.tick,
          layoutRevision: state.facility.liveLayoutRevision,
          facilityWidth: state.facility.size.width,
          facilityHeight: state.facility.size.height,
          facilityIdentity: state.facility,
          powerIdentity: state.facility.power,
          thermalTilesIdentity: state.facility.thermalTiles,
          topologyIdentity: cache.topology,
          generation,
        };
        options.onStageEvent?.("calculate-heat-generation");
        return state;
      } catch (error: unknown) {
        runtime.pending = undefined;
        throw error;
      }
    },
  };
}

function stageTwoRuntime(
  runtime: ThermalRuntimeInternal,
  content: ContentBundle,
  options: ThermalTickSystemOptions,
): StructuralSharingTickSystemRuntime {
  return {
    executionMode: "structural-sharing",
    run({ state }: StructuralSharingTickSystemContext): GameState {
      try {
        const pending = assertPendingMatches(runtime, state);
        const cache = runtime.topologyCache;
        if (cache === undefined) throw new Error("Thermal topology cache is missing.");
        const update = updateThermalState(
          state.facility,
          pending.generation,
          content.balancing.thermal,
          content.balancing.tickMilliseconds / 1_000,
          cache.updateScratch,
        );
        assertValidThermalUpdateOutput(
          state.facility,
          pending.generation,
          update,
          content.balancing.thermal,
        );
        options.onStageEvent?.("update-thermal-state");
        if (!update.temperatureChanged) return state;
        assertSafeThermalRevisionIncrement(state.facility.thermalRevision);
        return {
          ...state,
          facility: {
            ...state.facility,
            thermalTiles: reuseUnchangedThermalTiles(
              state.facility.thermalTiles,
              update.thermalTiles,
            ),
            thermalRevision: state.facility.thermalRevision + 1,
          },
        };
      } finally {
        runtime.pending = undefined;
      }
    },
  };
}

/**
 * The factories are claimed in SimCore's fixed stage order, making the runtime private to one core
 * construction while allowing the paired thermal stages to share only their own derived state.
 */
export function createThermalTickSystems(
  content: ContentBundle,
  options: ThermalTickSystemOptions = {},
): TickSystemRegistry {
  let constructionRuntime: ThermalRuntimeInternal | undefined;
  return Object.freeze({
    "calculate-heat-generation": {
      createRuntime() {
        if (constructionRuntime !== undefined) {
          throw new Error(
            "Thermal stage runtime construction is already pending its update stage.",
          );
        }
        const runtime = createRuntime();
        constructionRuntime = runtime;
        return stageOneRuntime(runtime, content, options);
      },
    },
    "update-thermal-state": {
      createRuntime() {
        const runtime = constructionRuntime;
        if (runtime === undefined) {
          throw new Error("Thermal update runtime requires the paired generation stage.");
        }
        constructionRuntime = undefined;
        return stageTwoRuntime(runtime, content, options);
      },
    },
  });
}
