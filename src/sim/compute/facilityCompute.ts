import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState, TaskInstanceState } from "../core/types.ts";
import type {
  StructuralSharingTickSystemContext,
  TickSystemRegistry,
} from "../core/tickSystems.ts";
import {
  buildComputeTopology,
  calculateFacilityComputeWithWitness,
  refreshComputeTopologyCongestion,
  refreshPoweredMemoryProviders,
  validateFreshComputeWitness,
  type ComputePathCache,
  type ComputeTopology,
} from "./computeDomain.ts";
import { assertValidStoredComputeState } from "./computeState.ts";

export type ComputeTopologyCacheEvent = "hit" | "rebuild" | "clear";
export type ComputeResultCacheEvent = "calculated" | "reused";

export interface ComputeTickSystemOptions {
  readonly onTopologyCacheEvent?: (event: ComputeTopologyCacheEvent) => void;
  readonly onComputeResultCacheEvent?: (event: ComputeResultCacheEvent) => void;
  /** Test/diagnostic-only observation of a full pure facility calculation. */
  readonly onFacilityCalculation?: () => void;
}

interface ComputeTopologyCache {
  readonly layoutRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly topology: ComputeTopology;
  readonly pathMetrics: ComputePathCache;
  routes: GameState["facility"]["routes"];
}

interface LastComputeCalculation {
  readonly modules: GameState["facility"]["modules"];
  readonly power: GameState["facility"]["power"];
  readonly overclock: GameState["facility"]["overclock"];
  readonly routes: GameState["facility"]["routes"];
  readonly taskInputs: readonly TaskCalculationInput[];
  readonly liveLayoutRevision: number;
  readonly thermalRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly compute: GameState["facility"]["compute"];
}

interface TaskCalculationInput {
  readonly id: string;
  readonly definitionId: string;
  readonly status: TaskInstanceState["status"];
  readonly phaseIndex: number;
  readonly clusterModuleIds: readonly string[] | null;
  readonly requestedShare: number | null;
}

function resolveTopology(
  cached: ComputeTopologyCache | undefined,
  state: Readonly<GameState>,
  content: ContentBundle,
  options: ComputeTickSystemOptions,
): ComputeTopologyCache {
  const { facility } = state;
  if (
    cached?.layoutRevision === facility.liveLayoutRevision &&
    cached.facilityWidth === facility.size.width &&
    cached.facilityHeight === facility.size.height
  ) {
    const topology =
      cached.routes === facility.routes
        ? cached.topology
        : refreshComputeTopologyCongestion(cached.topology, facility.routes);
    options.onTopologyCacheEvent?.("hit");
    if (topology === cached.topology) {
      cached.routes = facility.routes;
      return cached;
    }
    return {
      ...cached,
      routes: facility.routes,
      topology,
      pathMetrics: topology.pathMetrics,
    };
  }
  const topology = buildComputeTopology(facility, content);
  const next: ComputeTopologyCache = {
    layoutRevision: facility.liveLayoutRevision,
    facilityWidth: facility.size.width,
    facilityHeight: facility.size.height,
    topology,
    pathMetrics: topology.pathMetrics,
    routes: facility.routes,
  };
  options.onTopologyCacheEvent?.("rebuild");
  return next;
}

function taskInputs(state: Readonly<GameState>): readonly TaskCalculationInput[] {
  return Object.keys(state.tasks.instances)
    .toSorted()
    .map((taskId) => {
      const task = state.tasks.instances[taskId];
      if (task === undefined) throw new Error(`Missing task instance ${taskId}.`);
      return {
        id: task.id,
        definitionId: task.definitionId,
        status: task.status,
        phaseIndex: task.currentPhaseIndex,
        clusterModuleIds: task.allocation?.clusterModuleIds ?? null,
        requestedShare: task.allocation?.requestedShare ?? null,
      };
    });
}

function sameTaskInputs(
  left: readonly TaskCalculationInput[],
  right: readonly TaskCalculationInput[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((input, index) => {
    const candidate = right[index];
    if (
      input.id !== candidate?.id ||
      input.definitionId !== candidate.definitionId ||
      input.status !== candidate.status ||
      input.phaseIndex !== candidate.phaseIndex ||
      input.requestedShare !== candidate.requestedShare ||
      input.clusterModuleIds?.length !== candidate.clusterModuleIds?.length
    )
      return false;
    return (
      input.clusterModuleIds?.every(
        (moduleId, moduleIndex) => moduleId === candidate.clusterModuleIds?.[moduleIndex],
      ) ?? candidate.clusterModuleIds === null
    );
  });
}

function assertCurrentComputeInputs(
  state: Readonly<GameState>,
  content: ContentBundle,
  topology: ComputeTopology,
): void {
  const { facility } = state;
  if (facility.power.layoutRevision !== facility.liveLayoutRevision) {
    throw new Error("Compute requires current Power results for the live layout revision.");
  }
  if (
    facility.overclock.layoutRevision !== facility.liveLayoutRevision ||
    facility.overclock.thermalRevision !== facility.thermalRevision
  ) {
    throw new Error("Compute requires current Overclock results for the live thermal revision.");
  }
  let moduleCount = 0;
  for (const moduleId in facility.modules) {
    if (Object.hasOwn(facility.modules, moduleId)) moduleCount += 1;
  }
  if (moduleCount !== topology.moduleIds.length) {
    throw new Error("Compute topology module coverage changed without a live layout revision.");
  }
  for (const moduleId of topology.moduleIds) {
    const module = facility.modules[moduleId];
    if (!module || module.definitionId !== topology.moduleDefinitionIds[moduleId]) {
      throw new Error(
        `Compute topology module ${moduleId} changed without a live layout revision.`,
      );
    }
    const definition = content.modules[module.definitionId];
    if (!definition) throw new Error(`Unknown module definition ${module.definitionId}.`);
    if (definition.baseComputeFlops <= 0) continue;
    if (!facility.power.byModule[moduleId]) {
      throw new Error(`Compute requires a Power result for ${moduleId}.`);
    }
    if (!facility.overclock.byModule[moduleId]) {
      throw new Error(`Compute requires an Overclock result for ${moduleId}.`);
    }
  }
}

function withDeliveredUsefulCompute(
  state: Readonly<GameState>,
  compute: GameState["facility"]["compute"],
): GameState["tasks"] {
  let instances = state.tasks.instances;
  for (const taskId of Object.keys(state.tasks.instances).toSorted()) {
    const task = state.tasks.instances[taskId];
    if (!task?.allocation) continue;
    const deliveredUsefulComputeFlops =
      task.status === "active" ? compute.byTask[taskId]?.breakdown.usefulComputeFlops : 0;
    if (deliveredUsefulComputeFlops === undefined) {
      throw new Error(`Compute result is missing active allocated task ${taskId}.`);
    }
    if (task.allocation.deliveredUsefulComputeFlops === deliveredUsefulComputeFlops) continue;
    if (instances === state.tasks.instances) instances = { ...state.tasks.instances };
    instances[taskId] = {
      ...task,
      allocation: { ...task.allocation, deliveredUsefulComputeFlops },
    };
  }
  return instances === state.tasks.instances ? state.tasks : { ...state.tasks, instances };
}

function isReusable(
  last: LastComputeCalculation | undefined,
  state: Readonly<GameState>,
  currentTaskInputs: readonly TaskCalculationInput[],
): boolean {
  const { facility } = state;
  if (!last) return false;
  return (
    last.modules === facility.modules &&
    last.power === facility.power &&
    last.overclock === facility.overclock &&
    last.routes === facility.routes &&
    last.liveLayoutRevision === facility.liveLayoutRevision &&
    last.thermalRevision === facility.thermalRevision &&
    last.facilityWidth === facility.size.width &&
    last.facilityHeight === facility.size.height &&
    last.compute === facility.compute &&
    sameTaskInputs(last.taskInputs, currentTaskInputs)
  );
}

export function createComputeTickSystems(
  content: ContentBundle,
  options: ComputeTickSystemOptions = {},
): TickSystemRegistry {
  return Object.freeze({
    "calculate-theoretical-and-useful-compute": {
      createRuntime() {
        let topologyCache: ComputeTopologyCache | undefined;
        let lastCalculation: LastComputeCalculation | undefined;
        let memoryProviders: readonly string[] | undefined;
        let taskInputInstances: GameState["tasks"]["instances"] | undefined;
        let cachedTaskInputs: readonly TaskCalculationInput[] | undefined;
        return {
          executionMode: "structural-sharing" as const,
          validateLifecycleState(state: Readonly<GameState>) {
            assertValidStoredComputeState(state);
            buildComputeTopology(state.facility, content);
          },
          clearDerivedState() {
            topologyCache = undefined;
            lastCalculation = undefined;
            memoryProviders = undefined;
            taskInputInstances = undefined;
            cachedTaskInputs = undefined;
            options.onTopologyCacheEvent?.("clear");
          },
          run({ state }: StructuralSharingTickSystemContext): GameState {
            topologyCache = resolveTopology(topologyCache, state, content, options);
            assertCurrentComputeInputs(state, content, topologyCache.topology);
            memoryProviders = refreshPoweredMemoryProviders(
              state.facility,
              content,
              memoryProviders,
              topologyCache.topology.moduleIds,
            );
            if (taskInputInstances !== state.tasks.instances || cachedTaskInputs === undefined) {
              taskInputInstances = state.tasks.instances;
              cachedTaskInputs = taskInputs(state);
            }
            const currentTaskInputs = cachedTaskInputs;
            if (isReusable(lastCalculation, state, currentTaskInputs)) {
              options.onComputeResultCacheEvent?.("reused");
              return state;
            }
            const calculation = calculateFacilityComputeWithWitness(
              state,
              content,
              topologyCache.topology,
              topologyCache.pathMetrics,
              memoryProviders,
            );
            options.onFacilityCalculation?.();
            const compute = calculation.compute;
            const tasks = withDeliveredUsefulCompute(state, compute);
            const candidate: GameState = {
              ...state,
              facility: { ...state.facility, compute },
              tasks,
            };
            const issues = validateFreshComputeWitness(
              state,
              content,
              candidate.facility.compute,
              calculation.witness,
              topologyCache.topology,
            );
            if (issues.length > 0) {
              throw new Error(`Invalid Compute tick result:\n${issues.join("\n")}`);
            }
            lastCalculation = {
              modules: state.facility.modules,
              power: state.facility.power,
              overclock: state.facility.overclock,
              routes: state.facility.routes,
              taskInputs: currentTaskInputs,
              liveLayoutRevision: state.facility.liveLayoutRevision,
              thermalRevision: state.facility.thermalRevision,
              facilityWidth: state.facility.size.width,
              facilityHeight: state.facility.size.height,
              compute,
            };
            options.onComputeResultCacheEvent?.("calculated");
            return candidate;
          },
        };
      },
    },
  });
}
