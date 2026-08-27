import type { ThermalTileState } from "../core/types.ts";

export type ThermalBehaviorRole = "none" | "local-airflow" | "extraction";

export interface ThermalAirflowRay {
  readonly portId: string;
  readonly tileIndexes: readonly number[];
}

export interface ThermalModuleTopology {
  readonly moduleId: string;
  readonly definitionId: string;
  readonly behaviorRole: ThermalBehaviorRole;
  readonly occupiedTileIndexes: readonly number[];
  readonly airflowRays: readonly ThermalAirflowRay[];
}

export interface ThermalTopology {
  readonly layoutRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly tileCount: number;
  readonly moduleIds: readonly string[];
  readonly modules: readonly ThermalModuleTopology[];
  readonly moduleIndexById: Readonly<Record<string, number>>;
  readonly extractionModuleIndexes: readonly number[];
  readonly occupiedTileIndexesByModule: Readonly<Record<string, readonly number[]>>;
}

export interface ThermalGeneration {
  readonly heatWattsOnTile: readonly number[];
  readonly localCoolingWattsOnTile: readonly number[];
  readonly totalGeneratedHeatWatts: number;
  readonly effectiveExtractionCapacityWatts: number;
}

export interface ThermalUpdate {
  readonly thermalTiles: readonly ThermalTileState[];
  readonly temperatureChanged: boolean;
}

export interface ThermalUpdateBalancingContract {
  readonly heatToTemperatureCoefficient: number;
  readonly diffusionCoefficient: number;
  readonly ambientRecoveryCoefficient: number;
  readonly globalHeatCoefficient: number;
  readonly minimumTemperatureC: number;
  readonly maximumTemperatureC: number;
}

/** Caller-owned, private reusable storage. Public results never retain these arrays. */
export interface ThermalGenerationScratch {
  readonly heatWattsOnTile: Float64Array;
  readonly localCoolingWattsOnTile: Float64Array;
}

/** Caller-owned, private reusable storage. Public results never retain this array. */
export interface ThermalUpdateScratch {
  readonly nextTemperatureC: Float64Array;
}

export interface ThermalTickResult {
  readonly generation: ThermalGeneration;
  readonly update: ThermalUpdate;
}

/** Private to one future SimCore thermal runtime; never reachable from authoritative state. */
export interface ThermalRuntime {
  readonly topology: ThermalTopology | undefined;
  readonly generation: ThermalGeneration | undefined;
  clearDerivedState(): void;
}

export interface ThermalIssue {
  readonly path: string;
  readonly message: string;
}
