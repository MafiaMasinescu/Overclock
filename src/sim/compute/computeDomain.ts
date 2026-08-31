import type {
  ContentBundle,
  DeepReadonly,
  TaskDefinition,
} from "../../content/schemas/contentSchemas.ts";
import type {
  ComputeBreakdown,
  FacilityComputeState,
  FacilityState,
  GameState,
  ModuleComputeResultState,
  RouteState,
  TaskAllocationState,
  TaskComputeResultState,
  TaskInstanceState,
} from "../core/types.ts";

export interface ComputeTopologyRoute {
  readonly routeId: string;
  readonly fromModuleId: string;
  readonly toModuleId: string;
  readonly capacityBytesPerSecond: number;
  readonly latencyMicroseconds: number;
}

export interface ComputeTopologySourceRoute {
  readonly routeId: string;
  readonly fromModuleId: string;
  readonly fromPortId: string;
  readonly toModuleId: string;
  readonly toPortId: string;
  readonly pathPointCount: number;
}

export interface ComputeTopology {
  readonly moduleIds: readonly string[];
  readonly computeModuleIds: readonly string[];
  readonly moduleDefinitionIds: Readonly<Record<string, string>>;
  readonly sourceRoutes: readonly ComputeTopologySourceRoute[];
  readonly sourceRoutesById: Readonly<Record<string, ComputeTopologySourceRoute>>;
  readonly routes: readonly ComputeTopologyRoute[];
  readonly outgoing: Readonly<Record<string, readonly ComputeTopologyRoute[]>>;
  readonly pathMetrics: ComputePathCache;
}

export interface ModuleComputeCapacity {
  readonly byModule: Readonly<Record<string, ModuleComputeResultState>>;
  readonly totalTheoreticalComputeFlops: number;
  readonly totalAvailableComputeFlops: number;
}

/**
 * Ephemeral same-transaction evidence. It intentionally never enters authoritative state:
 * The deeply frozen expected result cannot be changed through any alias, while branch identities
 * prove the calculation's inputs remained current until candidate-state validation.
 */
export interface ComputeCalculationWitness {
  readonly expected: Readonly<FacilityComputeState>;
  readonly expectedTaskDeliveries: Readonly<Record<string, number>>;
  readonly content: ContentBundle;
  readonly modules: GameState["facility"]["modules"];
  readonly power: GameState["facility"]["power"];
  readonly overclock: GameState["facility"]["overclock"];
  readonly routes: GameState["facility"]["routes"];
  readonly taskInstances: GameState["tasks"]["instances"];
  readonly liveLayoutRevision: number;
  readonly thermalRevision: number;
  readonly facilityWidth: number;
  readonly facilityHeight: number;
  readonly topology: ComputeTopology;
}

export interface FacilityComputeCalculation {
  readonly compute: FacilityComputeState;
  readonly taskDeliveries: Readonly<Record<string, number>>;
  readonly witness: ComputeCalculationWitness;
}

const FACTOR_ORDER = [
  "power",
  "thermal",
  "memory",
  "interconnect",
  "suitability",
  "stability",
] as const;

function finite(value: number, label: string, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and at least ${minimum}.`);
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key in value) {
      if (Object.hasOwn(value, key)) deepFreeze(value[key as keyof typeof value]);
    }
    Object.freeze(value);
  }
  return value;
}

function portKind(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  moduleId: string,
  portId: string,
): string {
  const module = facility.modules[moduleId];
  const definition = module === undefined ? undefined : content.modules[module.definitionId];
  const port = definition?.ports.find((candidate) => candidate.id === portId);
  if (port === undefined)
    throw new RangeError(`Unknown data route endpoint ${moduleId}.${portId}.`);
  return port.kind;
}

function dataDirections(
  route: Readonly<RouteState>,
  facility: Readonly<FacilityState>,
  content: ContentBundle,
): readonly [string, string][] {
  if (route.kind !== "data") return [];
  finite(route.capacityPerSecond, `Route ${route.id} capacity`);
  if (
    !Number.isFinite(route.congestionRatio) ||
    route.congestionRatio < 0 ||
    route.congestionRatio > 1
  ) {
    throw new RangeError(`Route ${route.id} congestion must be in [0, 1].`);
  }
  const fromKind = portKind(facility, content, route.from.moduleInstanceId, route.from.portId);
  const toKind = portKind(facility, content, route.to.moduleInstanceId, route.to.portId);
  if (fromKind === "data-bidirectional" && toKind === "data-bidirectional") {
    return [
      [route.from.moduleInstanceId, route.to.moduleInstanceId],
      [route.to.moduleInstanceId, route.from.moduleInstanceId],
    ];
  }
  return [[route.from.moduleInstanceId, route.to.moduleInstanceId]];
}

export function buildComputeTopology(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
): ComputeTopology {
  const moduleIds = Object.keys(facility.modules).toSorted();
  const computeModuleIds: string[] = [];
  const moduleDefinitionIds: Record<string, string> = {};
  for (const moduleId of moduleIds) {
    const module = facility.modules[moduleId];
    if (module === undefined) throw new RangeError(`Missing module ${moduleId}.`);
    moduleDefinitionIds[moduleId] = module.definitionId;
    if ((content.modules[module.definitionId]?.baseComputeFlops ?? 0) > 0) {
      computeModuleIds.push(moduleId);
    }
  }
  const sourceRoutes: ComputeTopologySourceRoute[] = [];
  const sourceRoutesById: Record<string, ComputeTopologySourceRoute> = {};
  const routes: ComputeTopologyRoute[] = [];
  for (const routeId of Object.keys(facility.routes).toSorted()) {
    const route = facility.routes[routeId];
    if (route?.kind !== "data") continue;
    const sourceRoute = {
      routeId,
      fromModuleId: route.from.moduleInstanceId,
      fromPortId: route.from.portId,
      toModuleId: route.to.moduleInstanceId,
      toPortId: route.to.portId,
      pathPointCount: route.path.length,
    };
    sourceRoutes.push(sourceRoute);
    sourceRoutesById[routeId] = sourceRoute;
    const steps = Math.max(1, route.path.length - 1);
    const latency = steps * content.balancing.compute.dataRouteLatencyMicrosecondsPerGridStep;
    const capacity = route.capacityPerSecond * (1 - route.congestionRatio);
    for (const [fromModuleId, toModuleId] of dataDirections(route, facility, content)) {
      routes.push({
        routeId,
        fromModuleId,
        toModuleId,
        capacityBytesPerSecond: capacity,
        latencyMicroseconds: latency,
      });
    }
  }
  routes.sort(
    (left, right) =>
      left.fromModuleId.localeCompare(right.fromModuleId) ||
      left.toModuleId.localeCompare(right.toModuleId) ||
      left.routeId.localeCompare(right.routeId),
  );
  const outgoing: Record<string, ComputeTopologyRoute[]> = {};
  for (const moduleId of moduleIds) outgoing[moduleId] = [];
  for (const route of routes) (outgoing[route.fromModuleId] ??= []).push(route);
  const topology: ComputeTopology = {
    moduleIds,
    computeModuleIds,
    moduleDefinitionIds,
    sourceRoutes,
    sourceRoutesById,
    routes,
    outgoing,
    pathMetrics: new Map(),
  };
  for (const moduleId of moduleIds) {
    bestPath(topology, moduleId, moduleId, topology.pathMetrics);
  }
  return topology;
}

/**
 * Congestion is dynamic input, whereas path direction and length are layout data. Refreshing only
 * capacities preserves the cached structural topology while keeping each tick's route delivery exact.
 */
export function refreshComputeTopologyCongestion(
  topology: ComputeTopology,
  routesById: Readonly<Record<string, RouteState>>,
): ComputeTopology {
  let sourceCount = 0;
  for (const routeId in routesById) {
    if (!Object.hasOwn(routesById, routeId)) continue;
    const route = routesById[routeId];
    if (route?.kind !== "data") continue;
    const source = topology.sourceRoutesById[routeId];
    if (
      source?.routeId !== routeId ||
      source.fromModuleId !== route.from.moduleInstanceId ||
      source.fromPortId !== route.from.portId ||
      source.toModuleId !== route.to.moduleInstanceId ||
      source.toPortId !== route.to.portId ||
      source.pathPointCount !== route.path.length
    ) {
      throw new RangeError(
        `Data route ${routeId} changed topology without a live layout revision.`,
      );
    }
    sourceCount += 1;
  }
  if (sourceCount !== topology.sourceRoutes.length) {
    throw new RangeError("Data route coverage changed without a live layout revision.");
  }
  let routes: ComputeTopologyRoute[] | undefined;
  for (let index = 0; index < topology.routes.length; index += 1) {
    const edge = topology.routes[index];
    if (edge === undefined) throw new RangeError("Cached data route coverage is incomplete.");
    const route = routesById[edge.routeId];
    if (route?.kind !== "data") {
      throw new RangeError(`Cached data route ${edge.routeId} is unavailable.`);
    }
    finite(route.capacityPerSecond, `Route ${route.id} capacity`);
    if (
      !Number.isFinite(route.congestionRatio) ||
      route.congestionRatio < 0 ||
      route.congestionRatio > 1
    ) {
      throw new RangeError(`Route ${route.id} congestion must be in [0, 1].`);
    }
    const capacityBytesPerSecond = route.capacityPerSecond * (1 - route.congestionRatio);
    if (edge.capacityBytesPerSecond !== capacityBytesPerSecond) {
      routes ??= [...topology.routes];
      routes[index] = { ...edge, capacityBytesPerSecond };
    }
  }
  if (routes === undefined) return topology;
  const outgoing: Record<string, ComputeTopologyRoute[]> = {};
  for (const moduleId of topology.moduleIds) outgoing[moduleId] = [];
  for (const route of routes) (outgoing[route.fromModuleId] ??= []).push(route);
  const refreshed: ComputeTopology = { ...topology, routes, outgoing, pathMetrics: new Map() };
  for (const moduleId of refreshed.moduleIds) {
    bestPath(refreshed, moduleId, moduleId, refreshed.pathMetrics);
  }
  return refreshed;
}

function isLoadOperational(facility: Readonly<FacilityState>, moduleId: string): boolean {
  const module = facility.modules[moduleId];
  const power = facility.power.byModule[moduleId];
  return (
    module?.operationalState === "online" &&
    power !== undefined &&
    power.deliveredPowerWatts >= power.minimumPowerWatts &&
    power.requestedPowerWatts > power.minimumPowerWatts
  );
}

export function calculateModuleComputeCapacity(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  stableModuleIds: readonly string[] = Object.keys(facility.modules).toSorted(),
  previousByModule?: Readonly<Record<string, ModuleComputeResultState>>,
): ModuleComputeCapacity {
  const byModule: Record<string, ModuleComputeResultState> = {};
  let totalTheoreticalComputeFlops = 0;
  let totalAvailableComputeFlops = 0;
  for (const moduleId of stableModuleIds) {
    const module = facility.modules[moduleId];
    if (module === undefined) continue;
    const definition = content.modules[module.definitionId];
    if (definition === undefined || definition.baseComputeFlops <= 0) continue;
    const power = facility.power.byModule[moduleId];
    const overclock = facility.overclock.byModule[moduleId];
    if (power === undefined || overclock === undefined)
      throw new RangeError(`Missing Power or Overclock result for ${moduleId}.`);
    const operationalRatio = isLoadOperational(facility, moduleId) ? 1 : 0;
    const theoreticalComputeFlops =
      definition.baseComputeFlops *
      module.binComputeRatio *
      overclock.requestedFrequencyRatio *
      operationalRatio;
    const availableComputeFlops =
      theoreticalComputeFlops *
      power.powerFactor *
      overclock.thermalFactor *
      overclock.stabilityFactor;
    const previous = previousByModule?.[moduleId];
    const canReusePrevious =
      previous !== undefined &&
      Object.isFrozen(previous) &&
      previous.moduleInstanceId === moduleId &&
      previous.requestedFrequencyRatio === overclock.requestedFrequencyRatio &&
      previous.operationalRatio === operationalRatio &&
      previous.theoreticalComputeFlops === theoreticalComputeFlops &&
      previous.powerFactor === power.powerFactor &&
      previous.thermalFactor === overclock.thermalFactor &&
      previous.retryRate === overclock.retryRate &&
      previous.invalidSampleRate === overclock.invalidSampleRate &&
      previous.stabilityFactor === overclock.stabilityFactor &&
      previous.availableComputeFlops === availableComputeFlops;
    byModule[moduleId] = canReusePrevious
      ? previous
      : {
          moduleInstanceId: moduleId,
          requestedFrequencyRatio: overclock.requestedFrequencyRatio,
          operationalRatio,
          theoreticalComputeFlops,
          powerFactor: power.powerFactor,
          thermalFactor: overclock.thermalFactor,
          retryRate: overclock.retryRate,
          invalidSampleRate: overclock.invalidSampleRate,
          stabilityFactor: overclock.stabilityFactor,
          availableComputeFlops,
        };
    totalTheoreticalComputeFlops += theoreticalComputeFlops;
    totalAvailableComputeFlops += availableComputeFlops;
  }
  return {
    byModule,
    totalTheoreticalComputeFlops,
    totalAvailableComputeFlops,
  };
}

export function refreshPoweredMemoryProviders(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  cached?: readonly string[],
  stableModuleIds: readonly string[] = Object.keys(facility.modules).toSorted(),
): readonly string[] {
  let providerIndex = 0;
  let providers: string[] | undefined;
  for (const id of stableModuleIds) {
    const module = facility.modules[id];
    const definition = module === undefined ? undefined : content.modules[module.definitionId];
    if (
      definition === undefined ||
      definition.memoryCapacityBytes <= 0 ||
      !isLoadOperational(facility, id)
    )
      continue;
    if (providers !== undefined) {
      providers.push(id);
    } else if (cached?.[providerIndex] !== id) {
      providers = [...(cached?.slice(0, providerIndex) ?? []), id];
    }
    providerIndex += 1;
  }
  if (providers === undefined && cached?.length === providerIndex) return cached;
  return providers ?? cached?.slice(0, providerIndex) ?? [];
}

interface PathMetric {
  readonly latency: number;
  readonly bandwidth: number;
}

function isPreferredMemoryProvider(
  providerId: string,
  latency: number,
  bandwidth: number,
  selectedProviderId: string | undefined,
  selectedLatency: number,
  selectedBandwidth: number,
): boolean {
  return (
    selectedProviderId === undefined ||
    latency < selectedLatency ||
    (latency === selectedLatency &&
      (bandwidth > selectedBandwidth ||
        (bandwidth === selectedBandwidth && providerId.localeCompare(selectedProviderId) < 0)))
  );
}

export type ComputePathCache = Map<string, ReadonlyMap<string, PathMetric>>;

function bestPath(
  topology: ComputeTopology,
  start: string,
  end: string,
  cache?: ComputePathCache,
): PathMetric | null {
  const cached = cache?.get(start);
  if (cached !== undefined) return cached.get(end) ?? null;
  const results = new Map<string, PathMetric>();
  results.set(start, { latency: 0, bandwidth: Number.POSITIVE_INFINITY });
  if (start !== end && (topology.outgoing[start]?.length ?? 0) === 0) {
    cache?.set(start, results);
    return null;
  }
  const pending = [start];
  const queued = new Set(pending);
  for (const currentId of pending) {
    queued.delete(currentId);
    const current = results.get(currentId);
    if (current === undefined) continue;
    for (const edge of topology.outgoing[currentId] ?? []) {
      const prior = results.get(edge.toModuleId);
      const latency = Math.min(
        prior?.latency ?? Number.POSITIVE_INFINITY,
        current.latency + edge.latencyMicroseconds,
      );
      const bandwidth = Math.max(
        prior?.bandwidth ?? 0,
        Math.min(current.bandwidth, edge.capacityBytesPerSecond),
      );
      if (prior?.latency === latency && prior.bandwidth === bandwidth) continue;
      results.set(edge.toModuleId, { latency, bandwidth });
      if (!queued.has(edge.toModuleId)) {
        pending.push(edge.toModuleId);
        queued.add(edge.toModuleId);
      }
    }
  }
  cache?.set(start, results);
  return results.get(end) ?? null;
}

function phaseSuitability(
  phase: DeepReadonly<TaskDefinition>["phases"][number],
  facility: Readonly<FacilityState>,
  content: ContentBundle,
  cluster: readonly string[],
): number {
  const axes: ("serial" | "parallel" | "memory" | "bandwidth" | "latency")[] = [];
  if (phase.tags.includes("serial")) axes.push("serial");
  if (phase.tags.includes("parallel") || phase.tags.includes("vector")) axes.push("parallel");
  if (phase.tags.includes("memory-heavy")) axes.push("memory");
  if (phase.tags.includes("bandwidth")) axes.push("bandwidth");
  if (phase.tags.includes("latency")) axes.push("latency");
  if (axes.length === 0) return 1;
  let suitabilityTotal = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
    const axis = axes[axisIndex];
    if (axis === undefined) continue;
    let maximum = 0.7;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
    for (let moduleIndex = 0; moduleIndex < cluster.length; moduleIndex += 1) {
      const id = cluster[moduleIndex];
      if (id === undefined) continue;
      const suitability =
        content.modules[facility.modules[id]?.definitionId ?? ""]?.suitability[axis];
      if (suitability !== undefined) maximum = Math.max(maximum, clamp(suitability, 0.7, 1.25));
    }
    suitabilityTotal += maximum;
  }
  return clamp(suitabilityTotal / axes.length, 0.7, 1.25);
}

export function calculateTaskComputeResult(
  state: Readonly<GameState>,
  content: ContentBundle,
  topology: ComputeTopology,
  capacity: ModuleComputeCapacity,
  task: Readonly<TaskInstanceState>,
  allocation: Readonly<TaskAllocationState>,
  pathCache?: ComputePathCache,
  memoryProviders?: readonly string[],
): TaskComputeResultState {
  if (task.status !== "active" || task.allocation === null)
    throw new RangeError("Task calculation requires an active allocated task.");
  const definition = content.tasks[task.definitionId];
  const phase = definition?.phases[task.currentPhaseIndex];
  if (definition === undefined || phase === undefined)
    throw new RangeError("Task definition or phase is unavailable.");
  const cluster = [...allocation.clusterModuleIds];
  if (
    !Number.isFinite(allocation.requestedShare) ||
    allocation.requestedShare < 0 ||
    allocation.requestedShare > 1
  ) {
    throw new RangeError("Allocation must be stable, unique, and in [0, 1].");
  }
  let previousModuleId: string | undefined;
  let totalSelectedTheoreticalComputeFlops = 0;
  let theoreticalWeightTotal = 0;
  let weightedPower = 0;
  let afterPowerTotal = 0;
  let weightedThermal = 0;
  let afterThermalTotal = 0;
  let weightedRetry = 0;
  let weightedInvalid = 0;
  const contributingModuleIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let index = 0; index < cluster.length; index += 1) {
    const moduleId = cluster[index];
    if (
      moduleId === undefined ||
      (previousModuleId !== undefined && previousModuleId >= moduleId)
    ) {
      throw new RangeError("Allocation must be stable, unique, and in [0, 1].");
    }
    if (state.facility.modules[moduleId] === undefined) {
      throw new RangeError(`Allocation references unknown module ${moduleId}.`);
    }
    previousModuleId = moduleId;
    const record = capacity.byModule[moduleId];
    if (record === undefined) continue;
    totalSelectedTheoreticalComputeFlops += record.theoreticalComputeFlops;
    const theoreticalWeight = allocation.requestedShare * record.theoreticalComputeFlops;
    theoreticalWeightTotal += theoreticalWeight;
    weightedPower += record.powerFactor * theoreticalWeight;
    const afterPower = theoreticalWeight * record.powerFactor;
    afterPowerTotal += afterPower;
    weightedThermal += record.thermalFactor * afterPower;
    const afterThermal = afterPower * record.thermalFactor;
    afterThermalTotal += afterThermal;
    weightedRetry += record.retryRate * afterThermal;
    weightedInvalid += record.invalidSampleRate * afterThermal;
    if (record.operationalRatio === 1 && record.theoreticalComputeFlops > 0) {
      contributingModuleIds.push(record.moduleInstanceId);
    }
  }
  const theoretical = allocation.requestedShare * totalSelectedTheoreticalComputeFlops;
  const powerFactor = theoreticalWeightTotal === 0 ? 0 : weightedPower / theoreticalWeightTotal;
  const thermalFactor = afterPowerTotal === 0 ? 0 : weightedThermal / afterPowerTotal;
  const retryRate = afterThermalTotal === 0 ? 0 : weightedRetry / afterThermalTotal;
  const invalidSampleRate = afterThermalTotal === 0 ? 0 : weightedInvalid / afterThermalTotal;
  const stabilityFactor = 1 - retryRate - invalidSampleRate;
  const providers = memoryProviders ?? refreshPoweredMemoryProviders(state.facility, content);
  const commonProviders: string[] = [];
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex];
    if (provider === undefined) continue;
    let usableByCluster = true;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
    for (let computeIndex = 0; computeIndex < contributingModuleIds.length; computeIndex += 1) {
      const computeId = contributingModuleIds[computeIndex];
      if (computeId === undefined) continue;
      if (
        bestPath(topology, computeId, provider, pathCache) === null ||
        bestPath(topology, provider, computeId, pathCache) === null
      ) {
        usableByCluster = false;
        break;
      }
    }
    if (usableByCluster) commonProviders.push(provider);
  }
  const needsMemory =
    phase.memoryCapacityMinBytes > 0 || phase.memoryBandwidthRequiredBytesPerSecond > 0;
  let selectedCount = 0;
  let availableMemoryBandwidthBytesPerSecond = Number.POSITIVE_INFINITY;
  let clusterLatency = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let computeIndex = 0; computeIndex < contributingModuleIds.length; computeIndex += 1) {
    const computeId = contributingModuleIds[computeIndex];
    if (computeId === undefined) continue;
    let bestProvider: string | undefined;
    let bestRead: PathMetric | undefined;
    let bestWrite: PathMetric | undefined;
    let bestBandwidth = 0;
    let bestLatency = Number.POSITIVE_INFINITY;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
    for (let providerIndex = 0; providerIndex < commonProviders.length; providerIndex += 1) {
      const provider = commonProviders[providerIndex];
      if (provider === undefined) continue;
      const read = bestPath(topology, provider, computeId, pathCache);
      const write = bestPath(topology, computeId, provider, pathCache);
      if (read === null || write === null) continue;
      const providerBandwidth =
        content.modules[state.facility.modules[provider]?.definitionId ?? ""]
          ?.memoryBandwidthBytesPerSecond ?? 0;
      const bandwidth = Math.min(read.bandwidth, write.bandwidth, providerBandwidth);
      const latency = Math.max(read.latency, write.latency);
      if (
        isPreferredMemoryProvider(
          provider,
          latency,
          bandwidth,
          bestProvider,
          bestLatency,
          bestBandwidth,
        )
      ) {
        bestProvider = provider;
        bestRead = read;
        bestWrite = write;
        bestBandwidth = bandwidth;
        bestLatency = latency;
      }
    }
    if (bestProvider !== undefined && bestRead !== undefined && bestWrite !== undefined) {
      selectedCount += 1;
      availableMemoryBandwidthBytesPerSecond = Math.min(
        availableMemoryBandwidthBytesPerSecond,
        bestBandwidth,
      );
      clusterLatency = Math.max(clusterLatency, bestLatency);
    }
  }
  const disconnected =
    needsMemory &&
    (contributingModuleIds.length === 0 || selectedCount !== contributingModuleIds.length);
  let availableMemoryCapacityBytes = 0;
  if (contributingModuleIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
    for (let providerIndex = 0; providerIndex < commonProviders.length; providerIndex += 1) {
      const id = commonProviders[providerIndex];
      if (id === undefined) continue;
      availableMemoryCapacityBytes +=
        content.modules[state.facility.modules[id]?.definitionId ?? ""]?.memoryCapacityBytes ?? 0;
    }
  }
  if (selectedCount === 0) availableMemoryBandwidthBytesPerSecond = 0;
  const deliveredRouteBandwidthBytesPerSecond = availableMemoryBandwidthBytesPerSecond;
  const capacityFactor =
    availableMemoryCapacityBytes < phase.memoryCapacityMinBytes
      ? 0
      : phase.memoryCapacityRecommendedBytes === 0
        ? 1
        : Math.min(1, availableMemoryCapacityBytes / phase.memoryCapacityRecommendedBytes);
  const requiredBandwidth = allocation.requestedShare * phase.memoryBandwidthRequiredBytesPerSecond;
  const bandwidthFactor =
    requiredBandwidth === 0
      ? 1
      : clamp(deliveredRouteBandwidthBytesPerSecond / requiredBandwidth, 0.25, 1);
  const memoryFactor = Math.min(capacityFactor, bandwidthFactor);
  const extraLatencyMicroseconds = Math.max(
    0,
    clusterLatency - content.balancing.compute.dataRouteLatencyMicrosecondsPerGridStep,
  );
  const latencyPenalty = clamp(
    extraLatencyMicroseconds / phase.latencyToleranceMicroseconds,
    0,
    0.35,
  );
  const congestionPenalty =
    requiredBandwidth === 0
      ? 0
      : clamp(1 - deliveredRouteBandwidthBytesPerSecond / requiredBandwidth, 0, 0.45);
  const interconnectFactor = disconnected
    ? 0
    : clamp(1 - latencyPenalty - congestionPenalty, 0.2, 1);
  const usableClusterModuleIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let moduleIndex = 0; moduleIndex < cluster.length; moduleIndex += 1) {
    const moduleId = cluster[moduleIndex];
    if (moduleId === undefined || !isLoadOperational(state.facility, moduleId)) continue;
    let usable = !needsMemory;
    for (
      let providerIndex = 0;
      needsMemory && providerIndex < commonProviders.length;
      providerIndex += 1
    ) {
      const provider = commonProviders[providerIndex];
      if (
        provider !== undefined &&
        bestPath(topology, moduleId, provider, pathCache) !== null &&
        bestPath(topology, provider, moduleId, pathCache) !== null
      ) {
        usable = true;
        break;
      }
    }
    if (usable) usableClusterModuleIds.push(moduleId);
  }
  const suitabilityFactor = phaseSuitability(
    phase,
    state.facility,
    content,
    usableClusterModuleIds,
  );
  const blockingReasons: TaskComputeResultState["blockingReasons"] = [];
  if (theoretical === 0) blockingReasons.push("no-active-compute");
  if (availableMemoryCapacityBytes < phase.memoryCapacityMinBytes)
    blockingReasons.push("insufficient-memory-capacity");
  if (disconnected) blockingReasons.push("data-disconnected");
  const meetsStabilityMinimum = stabilityFactor >= phase.stabilityMinimum;
  const warnings: TaskComputeResultState["warnings"] = meetsStabilityMinimum
    ? []
    : ["stability-below-minimum"];
  let value = theoretical;
  const bottlenecks: ComputeBreakdown["bottlenecks"] = [];
  for (const [factor, factorValue] of [
    ["power", powerFactor],
    ["thermal", thermalFactor],
    ["memory", memoryFactor],
    ["interconnect", interconnectFactor],
    ["suitability", suitabilityFactor],
    ["stability", stabilityFactor],
  ] as const) {
    const after = value * factorValue;
    if (factorValue < 1)
      bottlenecks.push({
        factor,
        factorValue,
        lostComputeFlops: value - after,
        explanationKey: `compute.bottlenecks.${factor}`,
      });
    value = after;
  }
  bottlenecks.sort(
    (left, right) =>
      right.lostComputeFlops - left.lostComputeFlops ||
      FACTOR_ORDER.indexOf(left.factor) - FACTOR_ORDER.indexOf(right.factor),
  );
  return {
    taskInstanceId: task.id,
    taskDefinitionId: task.definitionId,
    phaseIndex: task.currentPhaseIndex,
    phaseId: phase.id,
    clusterModuleIds: cluster,
    requestedShare: allocation.requestedShare,
    availableMemoryCapacityBytes,
    availableMemoryBandwidthBytesPerSecond,
    deliveredRouteBandwidthBytesPerSecond,
    extraLatencyMicroseconds,
    retryRate,
    invalidSampleRate,
    meetsStabilityMinimum,
    runnable: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    breakdown: {
      theoreticalComputeFlops: theoretical,
      powerFactor,
      thermalFactor,
      memoryFactor,
      interconnectFactor,
      suitabilityFactor,
      stabilityFactor,
      usefulComputeFlops: value,
      bottlenecks,
    },
  };
}

export function calculateFacilityCompute(
  state: Readonly<GameState>,
  content: ContentBundle,
  cachedTopology?: ComputeTopology,
  cachedPathMetrics?: ComputePathCache,
  cachedMemoryProviders?: readonly string[],
): FacilityComputeState {
  const topology = cachedTopology ?? buildComputeTopology(state.facility, content);
  const capacity = calculateModuleComputeCapacity(
    state.facility,
    content,
    topology.computeModuleIds,
    state.facility.compute.byModule,
  );
  const byTask: Record<string, TaskComputeResultState> = {};
  const shares: Record<string, number> = {};
  const pathCache = cachedPathMetrics ?? topology.pathMetrics;
  const memoryProviders =
    cachedMemoryProviders ??
    refreshPoweredMemoryProviders(state.facility, content, undefined, topology.moduleIds);
  let totalAllocatedUsefulComputeFlops = 0;
  const taskIds = Object.keys(state.tasks.instances).toSorted();
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
  for (let taskIndex = 0; taskIndex < taskIds.length; taskIndex += 1) {
    const taskId = taskIds[taskIndex];
    if (taskId === undefined) continue;
    const task = state.tasks.instances[taskId];
    if (task?.status !== "active" || task.allocation === null) continue;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators in the audited tick path.
    for (
      let moduleIndex = 0;
      moduleIndex < task.allocation.clusterModuleIds.length;
      moduleIndex += 1
    ) {
      const moduleId = task.allocation.clusterModuleIds[moduleIndex];
      if (moduleId === undefined) continue;
      shares[moduleId] = (shares[moduleId] ?? 0) + task.allocation.requestedShare;
    }
    const result = calculateTaskComputeResult(
      state,
      content,
      topology,
      capacity,
      task,
      task.allocation,
      pathCache,
      memoryProviders,
    );
    byTask[taskId] = result;
    totalAllocatedUsefulComputeFlops += result.breakdown.usefulComputeFlops;
  }
  for (const moduleId in shares) {
    if (Object.hasOwn(shares, moduleId) && (shares[moduleId] ?? 0) > 1) {
      throw new RangeError("Task allocations overcommit a module.");
    }
  }
  return {
    layoutRevision: state.facility.liveLayoutRevision,
    thermalRevision: state.facility.thermalRevision,
    byModule: capacity.byModule,
    byTask,
    totalTheoreticalComputeFlops: capacity.totalTheoreticalComputeFlops,
    totalAvailableComputeFlops: capacity.totalAvailableComputeFlops,
    totalAllocatedUsefulComputeFlops,
  };
}

export function calculateFacilityComputeWithWitness(
  state: Readonly<GameState>,
  content: ContentBundle,
  cachedTopology?: ComputeTopology,
  cachedPathMetrics?: ComputePathCache,
  cachedMemoryProviders?: readonly string[],
): FacilityComputeCalculation {
  const topology = cachedTopology ?? buildComputeTopology(state.facility, content);
  const compute = calculateFacilityCompute(
    state,
    content,
    topology,
    cachedPathMetrics,
    cachedMemoryProviders,
  );
  const expected = deepFreeze(compute);
  const taskDeliveries: Record<string, number> = {};
  for (const taskId of Object.keys(state.tasks.instances).toSorted()) {
    const task = state.tasks.instances[taskId];
    if (task?.allocation === null || task?.allocation === undefined) continue;
    const deliveredUsefulComputeFlops =
      task.status === "active" ? compute.byTask[taskId]?.breakdown.usefulComputeFlops : 0;
    if (deliveredUsefulComputeFlops === undefined) {
      throw new Error(`Compute result is missing active allocated task ${taskId}.`);
    }
    taskDeliveries[taskId] = deliveredUsefulComputeFlops;
  }
  deepFreeze(taskDeliveries);
  return {
    compute,
    taskDeliveries,
    witness: Object.freeze({
      expected,
      expectedTaskDeliveries: taskDeliveries,
      content,
      modules: state.facility.modules,
      power: state.facility.power,
      overclock: state.facility.overclock,
      routes: state.facility.routes,
      taskInstances: state.tasks.instances,
      liveLayoutRevision: state.facility.liveLayoutRevision,
      thermalRevision: state.facility.thermalRevision,
      facilityWidth: state.facility.size.width,
      facilityHeight: state.facility.size.height,
      topology,
    }),
  };
}

function hasExactTaskDeliveries(
  taskInstances: Readonly<GameState["tasks"]["instances"]>,
  expected: Readonly<Record<string, number>>,
): boolean {
  let allocationCount = 0;
  for (const taskId in taskInstances) {
    if (!Object.hasOwn(taskInstances, taskId)) continue;
    const allocation = taskInstances[taskId]?.allocation;
    if (allocation === null || allocation === undefined) continue;
    allocationCount += 1;
    if (
      !Object.hasOwn(expected, taskId) ||
      !Object.is(expected[taskId], allocation.deliveredUsefulComputeFlops)
    ) {
      return false;
    }
  }
  return allocationCount === Object.keys(expected).length;
}

function hasCurrentWitnessDependencies(
  state: Readonly<GameState>,
  content: ContentBundle,
  witness: ComputeCalculationWitness,
  topology: ComputeTopology | undefined,
): boolean {
  const { facility } = state;
  return (
    witness.content === content &&
    witness.modules === facility.modules &&
    witness.power === facility.power &&
    witness.overclock === facility.overclock &&
    witness.routes === facility.routes &&
    witness.taskInstances === state.tasks.instances &&
    witness.liveLayoutRevision === facility.liveLayoutRevision &&
    witness.thermalRevision === facility.thermalRevision &&
    witness.facilityWidth === facility.size.width &&
    witness.facilityHeight === facility.size.height &&
    witness.topology === topology
  );
}

/**
 * Validates a just-calculated candidate without deriving Compute a second time. Branch identities
 * cover every authoritative input used by the calculation; the frozen expected result is compared
 * structurally and exactly, so neither a stale branch nor a mutable aliased result can pass.
 */
export function validateFreshComputeWitness(
  state: Readonly<GameState>,
  content: ContentBundle,
  candidate: Readonly<FacilityComputeState>,
  candidateTaskInstances: Readonly<GameState["tasks"]["instances"]>,
  witness: ComputeCalculationWitness,
  topology?: ComputeTopology,
): string[] {
  try {
    if (!hasCurrentWitnessDependencies(state, content, witness, topology)) {
      return ["Compute calculation inputs changed before candidate-state validation."];
    }
    if (candidate !== witness.expected) {
      return ["Compute candidate does not match its detached exact calculation evidence."];
    }
    return hasExactTaskDeliveries(candidateTaskInstances, witness.expectedTaskDeliveries)
      ? []
      : ["Compute candidate task deliveries do not match exact calculation evidence."];
  } catch (error: unknown) {
    return [error instanceof Error ? error.message : "Compute calculation validation failed."];
  }
}

export function validateFreshComputeCalculation(
  state: Readonly<GameState>,
  content: ContentBundle,
  calculation: Readonly<FacilityComputeState>,
  cachedTopology?: ComputeTopology,
): string[] {
  try {
    return JSON.stringify(calculateFacilityCompute(state, content, cachedTopology)) ===
      JSON.stringify(calculation)
      ? []
      : ["Compute calculation does not match its exact inputs."];
  } catch (error: unknown) {
    return [error instanceof Error ? error.message : "Compute calculation validation failed."];
  }
}
