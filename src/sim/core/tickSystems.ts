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

export type TickSystemRegistry = Readonly<Partial<Record<TickSystemStage, TickSystem>>>;
