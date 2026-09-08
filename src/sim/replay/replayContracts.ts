import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { CommandReceipt, CommandResult, SimCommand } from "../commands/contracts.ts";
import type { StepResult } from "../core/simCore.ts";
import type { GameState } from "../core/types.ts";
import type { TickSystemStage } from "../core/tickSystems.ts";
import { hashCanonicalState } from "./canonicalState.ts";

export const REPLAY_VERSION = 1 as const;
export const SIMULATOR_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_REPLAY_MAX_ENTRIES = 100_000 as const;
export const DEFAULT_REPLAY_MAX_TICKS = 100_000 as const;

export type ReplayHash = string;
export type ReplayClockCommand = Extract<SimCommand, { kind: "SET_PAUSED" | "SET_SPEED" }>;

export type ReplayOperation =
  | { kind: "enqueue"; command: SimCommand }
  | { kind: "clock"; command: ReplayClockCommand }
  | { kind: "process-pending" }
  | { kind: "step"; ticks: number };

export type ReplayFatalOutcome =
  | {
      kind: "fatal";
      code: "SIMULATOR_INVARIANT_VIOLATION";
      origin: "command";
      commandId: string;
      tick: number;
    }
  | {
      kind: "fatal";
      code: "SIMULATOR_INVARIANT_VIOLATION";
      origin: "tick-system";
      commandId: null;
      tick: number;
      stage: TickSystemStage;
    };

export type ReplayOutcome =
  | { kind: "receipt"; receipt: CommandReceipt }
  | { kind: "clock-result"; result: CommandResult }
  | { kind: "command-results"; results: CommandResult[] }
  | { kind: "step-result"; result: StepResult }
  | ReplayFatalOutcome;

export interface ReplayEntry {
  sequence: number;
  tickBefore: number;
  tickAfter: number;
  operation: ReplayOperation;
  outcome: ReplayOutcome;
}

export interface ReplayCheckpoint {
  afterSequence: number;
  tick: number;
  stateHash: ReplayHash;
  nextQueueSequence: number;
  pendingCommandCount: number;
}

export type ReplayTerminal =
  { kind: "completed"; afterSequence: number } | { kind: "fatal"; afterSequence: number };

export interface ReplayLog {
  replayVersion: typeof REPLAY_VERSION;
  simulatorProtocolVersion: typeof SIMULATOR_PROTOCOL_VERSION;
  seed: string;
  contentVersion: string;
  simulationContentHash: ReplayHash;
  initialStateHash: ReplayHash;
  initialTick: number;
  initialCommandQueueSequence: number;
  entries: ReplayEntry[];
  checkpoints: ReplayCheckpoint[];
  terminal: ReplayTerminal;
}

export interface SimulationContentProjection {
  contentVersion: string;
  modules: ContentBundle["modules"];
  tasks: ContentBundle["tasks"];
  research: ContentBundle["research"];
  era: ContentBundle["era"];
  balancing: ContentBundle["balancing"];
}

export function createSimulationContentProjection(
  content: ContentBundle,
): SimulationContentProjection {
  return {
    contentVersion: content.contentVersion,
    modules: content.modules,
    tasks: content.tasks,
    research: content.research,
    era: content.era,
    balancing: content.balancing,
  };
}

export function hashSimulationContent(content: ContentBundle): ReplayHash {
  return hashCanonicalState(createSimulationContentProjection(content));
}

export interface ReplayMismatch {
  kind: "entry" | "checkpoint" | "terminal" | "initial";
  sequence: number | null;
  category: string;
  path: string | null;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
  lastMatchingCheckpointAfterSequence: number | null;
}

export type ReplayVerificationStatus =
  | "matched"
  | "matched-fatal"
  | "invalid-log"
  | "incompatible"
  | "invalid-initial-state"
  | "limit-exceeded"
  | "diverged"
  | "internal-error";

export interface ReplayVerificationReport {
  status: ReplayVerificationStatus;
  replayHash: ReplayHash | null;
  finalTick: number | null;
  finalStateHash: ReplayHash | null;
  finalQueuePosition: {
    nextSequence: number;
    pendingCount: number;
  } | null;
  executedEntries: number;
  executedTicks: number;
  lastMatchingCheckpointAfterSequence: number | null;
  mismatch?: ReplayMismatch;
}

export interface ReplayRecordingArtifact {
  log: ReplayLog;
  initialState: GameState;
}

export interface ReplayResumeArtifact {
  resumeVersion: 1;
  replayHash: ReplayHash;
  afterSequence: number;
  state: GameState;
  nextQueueSequence: number;
}
