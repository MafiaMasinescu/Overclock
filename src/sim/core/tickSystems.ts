import type { SeededRng } from "../rng/seededRng.ts";
import type { GameState } from "./types.ts";

export const TICK_SYSTEM_STAGE_ORDER = Object.freeze([
  "rebuild-dirty-connectivity",
  "calculate-power-demand-and-delivery",
  "calculate-workload-allocation",
  "calculate-heat-generation",
  "update-thermal-state",
  "apply-throttling-stability-and-shutdown",
  "calculate-theoretical-and-useful-compute",
  "advance-tasks-and-benchmarks",
  "advance-research",
  "apply-economy-and-energy-costs",
  "update-tutorial-achievements-and-campaign",
  "emit-events",
  "produce-dirty-snapshot-data",
] as const);

export const TICK_STAGE_ORDER = Object.freeze([
  "dequeue-and-order-commands",
  "validate-and-apply-commands",
  ...TICK_SYSTEM_STAGE_ORDER,
] as const);

export type TickSystemStage = (typeof TICK_SYSTEM_STAGE_ORDER)[number];

export interface TickSystemContext {
  state: GameState;
  rng: SeededRng;
}

export type TickSystem = (context: TickSystemContext) => void;

interface TickSystemRuntimeLifecycle {
  readonly validateLifecycleState?: (state: Readonly<GameState>) => void;
  readonly clearDerivedState?: () => void;
}

export interface MutableTickSystemRuntime extends TickSystemRuntimeLifecycle {
  readonly executionMode: "mutable-clone";
  readonly run: TickSystem;
}

export interface StructuralSharingTickSystemContext {
  readonly state: Readonly<GameState>;
  readonly rng: SeededRng;
}

export interface StructuralSharingTickSystemRuntime extends TickSystemRuntimeLifecycle {
  readonly executionMode: "structural-sharing";
  readonly run: (context: StructuralSharingTickSystemContext) => GameState;
}

export type TickSystemRuntime = MutableTickSystemRuntime | StructuralSharingTickSystemRuntime;

export interface TickSystemFactory {
  readonly createRuntime: () => TickSystemRuntime;
}

export type TickSystemRegistration = TickSystem | TickSystemFactory;

export type TickSystemRegistry = Readonly<Partial<Record<TickSystemStage, TickSystemRegistration>>>;
