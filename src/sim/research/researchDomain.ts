import type {
  ContentBundle,
  DeepReadonly,
  ResearchNodeDefinition,
} from "../../content/schemas/contentSchemas.ts";
import { addMicrodollars, microdollarsToUsd, usdToMicrodollars } from "../economy/money.ts";
import { assertValidStoredComputeState } from "../compute/computeState.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { assertValidResearchComputeResult } from "./researchComputeDomain.ts";
import { assertValidContentAwareResearchState, FINAL_MUSEUM_SNAPSHOT_ID } from "./researchState.ts";
import type {
  BenchmarkResult,
  CampaignState,
  GameState,
  MuseumSnapshot,
  MuseumState,
  ResearchNodeId,
  ResearchState,
} from "../core/types.ts";

const OPERATIONS_PER_TICK_PER_FLOP = 0.1;

export interface ResearchAdvancementResult {
  readonly research: ResearchState;
  readonly campaign: CampaignState;
  readonly museum: MuseumState;
}

/** Same-calculation evidence; it is never part of authoritative or serialized state. */
export interface ResearchAdvancementWitness {
  readonly expected: Readonly<ResearchAdvancementResult>;
  readonly content: ContentBundle;
  readonly research: GameState["research"];
  readonly compute: GameState["facility"]["compute"];
  readonly campaign: GameState["campaign"];
  readonly benchmarkHistory: GameState["benchmarks"]["history"];
  readonly bestRunByBenchmark: GameState["benchmarks"]["bestRunByBenchmark"];
  readonly museum: GameState["museum"];
  readonly facilityName: string;
  readonly liveModules: GameState["facility"]["modules"];
  readonly thermalTiles: GameState["facility"]["thermalTiles"];
  readonly tick: number;
}

export interface ResearchAdvancementCalculation {
  readonly result: ResearchAdvancementResult;
  readonly witness: ResearchAdvancementWitness;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isDeeplyFrozen(value: unknown, visited = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (visited.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  visited.add(value);
  for (const child of Object.values(value)) {
    if (!isDeeplyFrozen(child, visited)) return false;
  }
  return true;
}

function retainFrozenOrClone<T extends object>(value: T, clone: () => T): T {
  return isDeeplyFrozen(value) ? value : clone();
}

function stableRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(record).toSorted()) {
    const value = record[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function cloneResearch(research: Readonly<ResearchState>): ResearchState {
  return {
    researchData: research.researchData,
    statuses: stableRecord(research.statuses),
    active: research.active === null ? null : { ...research.active },
    evidenceTags: [...research.evidenceTags],
  };
}

function cloneCampaign(campaign: Readonly<CampaignState>): CampaignState {
  return { ...campaign };
}

function cloneMuseum(museum: Readonly<MuseumState>): MuseumState {
  return {
    snapshots: museum.snapshots.map((snapshot) => ({
      ...snapshot,
      benchmarkRunIds: [...snapshot.benchmarkRunIds],
      completedResearchIds: [...snapshot.completedResearchIds],
    })),
  };
}

function compareResearchNodes(
  left: DeepReadonly<ResearchNodeDefinition>,
  right: DeepReadonly<ResearchNodeDefinition>,
): number {
  return left.sortOrder - right.sortOrder || compareStableStrings(left.id, right.id);
}

function orderedResearchNodes(content: ContentBundle): DeepReadonly<ResearchNodeDefinition>[] {
  return Object.values(content.research).toSorted(compareResearchNodes);
}

function findFinalResearchNode(
  content: ContentBundle,
  nodes: readonly DeepReadonly<ResearchNodeDefinition>[],
): DeepReadonly<ResearchNodeDefinition> {
  const finalNodes = nodes.filter((node) => node.finalReveal);
  if (finalNodes.length !== 1) {
    throw new Error("Research content must contain exactly one final-reveal node.");
  }
  const finalNode = finalNodes[0];
  if (!finalNode?.mandatory) {
    throw new Error("The final-reveal Research node must be mandatory.");
  }
  if (content.research[finalNode.id] === undefined) {
    throw new Error(`Final Research node ${finalNode.id} is missing from content.`);
  }
  return finalNode;
}

function resolvePassedBenchmark(
  state: Readonly<GameState>,
  benchmarkId: string,
): Readonly<BenchmarkResult> | undefined {
  const runId = state.benchmarks.bestRunByBenchmark[benchmarkId];
  if (typeof runId !== "string") return undefined;
  const matches = state.benchmarks.history.filter((run) => run.runId === runId);
  if (matches.length !== 1) return undefined;
  const run = matches[0];
  return run?.benchmarkId === benchmarkId && run.passed ? run : undefined;
}

function isEligible(
  state: Readonly<GameState>,
  research: Readonly<ResearchState>,
  node: DeepReadonly<ResearchNodeDefinition>,
): boolean {
  return (
    node.prerequisites.every((researchId) => research.statuses[researchId] === "completed") &&
    node.requiredEvidenceTags.every((evidenceTag) => research.evidenceTags.includes(evidenceTag)) &&
    node.requiredBenchmarkIds.every(
      (benchmarkId) => resolvePassedBenchmark(state, benchmarkId) !== undefined,
    )
  );
}

function validateAvailabilityConsistency(
  state: Readonly<GameState>,
  content: ContentBundle,
  nodes: readonly DeepReadonly<ResearchNodeDefinition>[],
): void {
  for (const node of nodes) {
    if (
      state.research.statuses[node.id] === "available" &&
      !isEligible(state, state.research, node)
    ) {
      throw new Error(
        `Contradictory Research state: available node ${node.id} is no longer eligible.`,
      );
    }
  }
  if (Object.keys(content.research).length !== nodes.length) {
    throw new Error("Research content ordering is incomplete.");
  }
}

function validateResearchLifecycleInputs(
  state: Readonly<GameState>,
  content: ContentBundle,
  nodes: readonly DeepReadonly<ResearchNodeDefinition>[],
): DeepReadonly<ResearchNodeDefinition> {
  assertValidContentAwareResearchState(state, content);
  assertValidStoredComputeState(state);
  const finalNode = findFinalResearchNode(content, nodes);
  validateAvailabilityConsistency(state, content, nodes);
  return finalNode;
}

/** Validates lifecycle-sensitive Research inputs without advancing or recalculating Compute. */
export function assertValidResearchLifecycleState(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  validateResearchLifecycleInputs(state, content, orderedResearchNodes(content));
}

function validateFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function addFinite(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isFinite(result)) throw new RangeError(`${label} overflowed.`);
  return normalizeZero(result);
}

function resolveFinalBenchmarkRuns(
  state: Readonly<GameState>,
  finalNode: DeepReadonly<ResearchNodeDefinition>,
): Readonly<BenchmarkResult>[] {
  if (finalNode.requiredBenchmarkIds.length === 0) {
    throw new Error("The final Research node must require at least one benchmark.");
  }
  return finalNode.requiredBenchmarkIds.map((benchmarkId) => {
    const run = resolvePassedBenchmark(state, benchmarkId);
    if (run === undefined) {
      throw new Error(`Final Research benchmark ${benchmarkId} is not a unique passed best run.`);
    }
    for (const [field, value] of [
      ["averagePowerWatts", run.averagePowerWatts],
      ["peakPowerWatts", run.peakPowerWatts],
    ] as const) {
      validateFiniteNonnegative(value, `Benchmark ${benchmarkId} ${field}`);
    }
    return run;
  });
}

function createFinalMuseumSnapshot(
  state: Readonly<GameState>,
  content: ContentBundle,
  finalNode: DeepReadonly<ResearchNodeDefinition>,
  completedResearchIds: readonly ResearchNodeId[],
): MuseumSnapshot {
  const benchmarkRuns = resolveFinalBenchmarkRuns(state, finalNode);
  const thermalTiles = state.facility.thermalTiles.toSorted(
    (left, right) => left.position.y - right.position.y || left.position.x - right.position.x,
  );
  if (thermalTiles.length === 0) throw new Error("Final Museum creation requires thermal tiles.");

  let totalCostMicrodollars = 0;
  for (const moduleId of Object.keys(state.facility.modules).toSorted()) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) throw new Error(`Live module ${moduleId} is missing.`);
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      throw new Error(`Live module ${moduleId} references unknown content ${module.definitionId}.`);
    }
    totalCostMicrodollars = addMicrodollars(
      totalCostMicrodollars,
      usdToMicrodollars(definition.priceUsd),
    );
  }

  let powerSum = 0;
  for (const run of benchmarkRuns) {
    powerSum = addFinite(powerSum, run.averagePowerWatts, "Final benchmark average power");
  }
  let temperatureSum = 0;
  let maxTemperatureC = Number.NEGATIVE_INFINITY;
  for (const tile of thermalTiles) {
    if (!Number.isFinite(tile.temperatureC)) {
      throw new RangeError("Final Museum thermal temperatures must be finite.");
    }
    temperatureSum = addFinite(temperatureSum, tile.temperatureC, "Final thermal temperature");
    maxTemperatureC = Math.max(maxTemperatureC, tile.temperatureC);
  }
  if (!Number.isFinite(maxTemperatureC)) throw new Error("Final Museum thermal field is invalid.");
  validateFiniteNonnegative(state.campaign.currentYear, "Final Museum year");

  const createdAtTick = state.tick + 1;
  if (!Number.isSafeInteger(createdAtTick) || createdAtTick < 0) {
    throw new RangeError("Final Museum createdAtTick overflowed.");
  }

  let peakPowerWatts = 0;
  for (const run of benchmarkRuns) peakPowerWatts = Math.max(peakPowerWatts, run.peakPowerWatts);

  return {
    id: FINAL_MUSEUM_SNAPSHOT_ID,
    createdAtTick,
    systemName: state.facility.name,
    architectureId: "vacuum-tube",
    year: state.campaign.currentYear,
    moduleCount: Object.keys(state.facility.modules).length,
    theoreticalComputeFlops: state.facility.compute.totalTheoreticalComputeFlops,
    usefulComputeFlops: state.facility.compute.totalAvailableComputeFlops,
    averagePowerWatts: normalizeZero(powerSum / benchmarkRuns.length),
    peakPowerWatts: normalizeZero(peakPowerWatts),
    averageTemperatureC: normalizeZero(temperatureSum / thermalTiles.length),
    maxTemperatureC: normalizeZero(maxTemperatureC),
    totalCostUsd: microdollarsToUsd(totalCostMicrodollars),
    benchmarkRunIds: benchmarkRuns.map((run) => run.runId),
    completedResearchIds: [...completedResearchIds],
  };
}

function completedResearchIds(
  research: Readonly<ResearchState>,
  nodes: readonly DeepReadonly<ResearchNodeDefinition>[],
): ResearchNodeId[] {
  return nodes.filter((node) => research.statuses[node.id] === "completed").map((node) => node.id);
}

function validateCurrentResearchCompute(
  state: Readonly<GameState>,
  nodeId: ResearchNodeId,
  reservedComputeShare: number,
): number {
  const computeResearch = state.facility.compute.research;
  assertValidResearchComputeResult(computeResearch);
  if (computeResearch === null) {
    throw new Error("Active Research requires a current Compute Research result.");
  }
  if (
    computeResearch.nodeId !== nodeId ||
    !Object.is(computeResearch.reservedComputeShare, reservedComputeShare)
  ) {
    throw new Error("Current Compute Research result does not match active Research.");
  }
  validateFiniteNonnegative(
    computeResearch.deliveredUsefulComputeFlops,
    "deliveredUsefulComputeFlops",
  );
  return computeResearch.deliveredUsefulComputeFlops;
}

function reconcileAvailability(
  state: Readonly<GameState>,
  nodes: readonly DeepReadonly<ResearchNodeDefinition>[],
  ensureResearchClone: () => ResearchState,
): void {
  for (const node of nodes) {
    if (state.research.statuses[node.id] !== "locked") continue;
    const currentResearch = ensureResearchClone();
    if (currentResearch.statuses[node.id] !== "locked") continue;
    if (isEligible(state, currentResearch, node)) currentResearch.statuses[node.id] = "available";
  }
}

/** Pure Research lifecycle calculation. No tick registration, host API, or RNG access. */
export function advanceResearchSystem(
  state: Readonly<GameState>,
  content: ContentBundle,
): ResearchAdvancementCalculation {
  const nodes = orderedResearchNodes(content);
  const finalNode = validateResearchLifecycleInputs(state, content, nodes);

  const nextBranches: {
    research?: ResearchState;
    campaign?: CampaignState;
    museum?: MuseumState;
  } = {};
  const ensureResearchClone = (): ResearchState => {
    nextBranches.research ??= cloneResearch(state.research);
    return nextBranches.research;
  };

  const ensureCampaignClone = (): CampaignState => {
    nextBranches.campaign ??= cloneCampaign(state.campaign);
    return nextBranches.campaign;
  };

  const ensureMuseumClone = (): MuseumState => {
    nextBranches.museum ??= cloneMuseum(state.museum);
    return nextBranches.museum;
  };

  if (state.research.active === null) {
    for (const node of nodes) {
      if (state.research.statuses[node.id] !== "locked") continue;
      if (isEligible(state, state.research, node)) {
        ensureResearchClone().statuses[node.id] = "available";
      }
    }
  } else {
    const active = state.research.active;
    const activeNode = content.research[active.nodeId];
    if (activeNode === undefined)
      throw new Error(`Active Research node ${active.nodeId} is unknown.`);
    const deliveredUsefulComputeFlops = validateCurrentResearchCompute(
      state,
      active.nodeId,
      active.reservedComputeShare,
    );
    const operationsThisTick = deliveredUsefulComputeFlops * OPERATIONS_PER_TICK_PER_FLOP;
    if (!Number.isFinite(operationsThisTick) || operationsThisTick < 0) {
      throw new RangeError("Research operations this tick must be finite and nonnegative.");
    }

    if (operationsThisTick > 0) {
      const remainingOperations = activeNode.requiredOperations - active.completedOperations;
      if (!Number.isFinite(remainingOperations) || remainingOperations <= 0) {
        throw new RangeError("Research remaining operations are invalid.");
      }
      const appliedOperations = Math.min(operationsThisTick, remainingOperations);
      const completedOperations = addFinite(
        active.completedOperations,
        appliedOperations,
        "Research completed operations",
      );
      if (completedOperations >= activeNode.requiredOperations) {
        const research = ensureResearchClone();
        research.statuses[active.nodeId] = "completed";
        research.active = null;
        reconcileAvailability(state, nodes, ensureResearchClone);

        if (activeNode.finalReveal) {
          if (state.museum.snapshots.some((snapshot) => snapshot.id === FINAL_MUSEUM_SNAPSHOT_ID)) {
            throw new Error(
              "The fixed final Museum snapshot already exists before final completion.",
            );
          }
          const completedIds = completedResearchIds(research, nodes);
          const museum = ensureMuseumClone();
          museum.snapshots.push(createFinalMuseumSnapshot(state, content, finalNode, completedIds));
          const campaign = ensureCampaignClone();
          campaign.transistorRevealed = true;
          campaign.verticalSliceCompleted = true;
        }
      } else {
        ensureResearchClone().active = {
          ...active,
          completedOperations: normalizeZero(completedOperations),
        };
      }
    }
  }

  const result = deepFreeze({
    research:
      nextBranches.research ??
      retainFrozenOrClone(state.research, () => cloneResearch(state.research)),
    campaign:
      nextBranches.campaign ??
      retainFrozenOrClone(state.campaign, () => cloneCampaign(state.campaign)),
    museum:
      nextBranches.museum ?? retainFrozenOrClone(state.museum, () => cloneMuseum(state.museum)),
  });
  const witness = Object.freeze({
    expected: result,
    content,
    research: state.research,
    compute: state.facility.compute,
    campaign: state.campaign,
    benchmarkHistory: state.benchmarks.history,
    bestRunByBenchmark: state.benchmarks.bestRunByBenchmark,
    museum: state.museum,
    facilityName: state.facility.name,
    liveModules: state.facility.modules,
    thermalTiles: state.facility.thermalTiles,
    tick: state.tick,
  });
  return Object.freeze({ result, witness });
}

/** Validates same-calculation evidence without recalculating the Research lifecycle. */
export function validateFreshResearchAdvance(
  state: Readonly<GameState>,
  content: ContentBundle,
  result: Readonly<ResearchAdvancementResult>,
  witness: Readonly<ResearchAdvancementWitness>,
): string[] {
  try {
    if (
      witness.content !== content ||
      witness.research !== state.research ||
      witness.compute !== state.facility.compute ||
      witness.campaign !== state.campaign ||
      witness.benchmarkHistory !== state.benchmarks.history ||
      witness.bestRunByBenchmark !== state.benchmarks.bestRunByBenchmark ||
      witness.museum !== state.museum ||
      witness.facilityName !== state.facility.name ||
      witness.liveModules !== state.facility.modules ||
      witness.thermalTiles !== state.facility.thermalTiles ||
      witness.tick !== state.tick
    ) {
      return ["Research advancement inputs changed before candidate-state validation."];
    }
    return result === witness.expected
      ? []
      : ["Research advancement candidate does not match detached exact calculation evidence."];
  } catch (error: unknown) {
    return [error instanceof Error ? error.message : "Research advancement validation failed."];
  }
}

export function isModuleUnlocked(
  moduleId: string,
  research: Readonly<ResearchState>,
  content: ContentBundle,
): boolean {
  const module = content.modules[moduleId];
  return module?.unlockResearchIds.every((id) => research.statuses[id] === "completed") ?? false;
}

export function isFeatureUnlocked(
  featureId: string,
  research: Readonly<ResearchState>,
  content: ContentBundle,
): boolean {
  return Object.values(content.research).some(
    (node) =>
      node.unlockFeatureIds.includes(featureId) && research.statuses[node.id] === "completed",
  );
}
