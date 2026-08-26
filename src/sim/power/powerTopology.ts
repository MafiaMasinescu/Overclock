import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityState, ModuleInstanceState } from "../core/types.ts";

export interface IndexedPowerRoute {
  readonly routeId: string;
  readonly sourceModuleIndex: number;
  readonly sourceModuleInstanceId: string;
  readonly sourcePortId: string;
  readonly sourcePortCapacityIndex: number;
  readonly sourcePortCapacityWatts: number;
  readonly sinkModuleIndex: number;
  readonly sinkModuleInstanceId: string;
  readonly sinkPortId: string;
  readonly sinkPortCapacityIndex: number;
  readonly sinkPortCapacityWatts: number;
  readonly routeCapacityWatts: number;
}

export interface PowerTopology {
  readonly moduleIds: readonly string[];
  readonly moduleRecordUsesStableOrder: boolean;
  readonly moduleIdsByPriorityTier: readonly (readonly string[])[];
  readonly moduleIndexesByPriorityTier: readonly (readonly number[])[];
  readonly moduleIndexById: ReadonlyMap<string, number>;
  readonly powerRouteIds: readonly string[];
  readonly indexedRoutes: readonly IndexedPowerRoute[];
  readonly routeCapacitiesWatts: readonly number[];
  readonly routesById: Readonly<Record<string, IndexedPowerRoute>>;
  readonly incomingRouteIdsByModule: Readonly<Record<string, readonly string[]>>;
  readonly incomingRouteIndexesByModuleIndex: readonly (readonly number[])[];
  readonly directlySuppliedSourceModuleIds: readonly string[];
  readonly directlySuppliedSourceModuleIndexes: readonly number[];
  readonly directlySuppliedSourceModuleIdSet: ReadonlySet<string>;
  readonly sourcePortCapacitiesWatts: readonly number[];
  readonly sourcePortModuleIndexes: readonly number[];
  readonly sinkPortCapacitiesWatts: readonly number[];
}

function priorityTier(category: NonNullable<ContentBundle["modules"][string]>["category"]): number {
  switch (category) {
    case "power":
      return 0;
    case "cooling":
      return 1;
    case "memory":
    case "control":
      return 2;
    case "compute":
      return 3;
    case "interconnect":
    case "io":
      return 4;
  }
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}

export function isDirectlySuppliedPowerSource(
  module: Readonly<ModuleInstanceState>,
  content: ContentBundle,
): boolean {
  const definition = content.modules[module.definitionId];
  return (
    definition?.category === "power" && definition.ports.some((port) => port.kind === "power-out")
  );
}

export function createPowerTopology(
  facility: Readonly<FacilityState>,
  content: ContentBundle,
): PowerTopology {
  const facilityModuleIds = Object.keys(facility.modules);
  const moduleIds = facilityModuleIds.toSorted();
  const moduleIndexById = new Map(moduleIds.map((moduleId, index) => [moduleId, index] as const));
  const moduleIdsByPriorityTier: string[][] = [[], [], [], [], []];
  const moduleIndexesByPriorityTier: number[][] = [[], [], [], [], []];
  for (const moduleId of moduleIds) {
    const module = facility.modules[moduleId];
    const definition = module === undefined ? undefined : content.modules[module.definitionId];
    if (module?.id !== moduleId || definition === undefined) {
      throw new Error("Power topology module must resolve matching content.");
    }
    const tier = moduleIdsByPriorityTier[priorityTier(definition.category)];
    if (tier === undefined) throw new Error("Power topology priority tier is missing.");
    if (!isDirectlySuppliedPowerSource(module, content)) {
      tier.push(moduleId);
      const moduleIndex = moduleIndexById.get(moduleId);
      const indexTier = moduleIndexesByPriorityTier[priorityTier(definition.category)];
      if (moduleIndex === undefined || indexTier === undefined) {
        throw new Error("Power topology module index is incomplete.");
      }
      indexTier.push(moduleIndex);
    }
  }
  const sourceModuleIds = moduleIds
    .filter((moduleId) => {
      const module = facility.modules[moduleId];
      if (module?.id !== moduleId) {
        throw new Error("Power topology module record key must match its stored ID.");
      }
      return isDirectlySuppliedPowerSource(module, content);
    })
    .toSorted();
  const sourceModuleIndexes = sourceModuleIds.map((moduleId) => {
    const moduleIndex = moduleIndexById.get(moduleId);
    if (moduleIndex === undefined) throw new Error("Power topology source index is incomplete.");
    return moduleIndex;
  });
  const routesById: Record<string, IndexedPowerRoute> = {};
  const indexedRoutes: IndexedPowerRoute[] = [];
  const routeCapacitiesWatts: number[] = [];
  const incomingMutable: Record<string, string[]> = {};
  const incomingRouteIndexesByModuleIndex: number[][] = moduleIds.map(() => []);
  const sourcePortCapacityIndexByKey = new Map<string, number>();
  const sourcePortCapacitiesWatts: number[] = [];
  const sourcePortModuleIndexes: number[] = [];
  const sinkPortCapacityIndexByKey = new Map<string, number>();
  const sinkPortCapacitiesWatts: number[] = [];
  const powerRouteIds = Object.keys(facility.routes)
    .filter((routeId) => facility.routes[routeId]?.kind === "power")
    .toSorted();

  for (const routeId of powerRouteIds) {
    const route = facility.routes[routeId];
    if (route?.id !== routeId) {
      throw new Error("Power topology route record key must match its stored ID.");
    }
    assertFiniteNonnegative(route.capacityPerSecond, "Power route capacity");
    const source = facility.modules[route.from.moduleInstanceId];
    const sink = facility.modules[route.to.moduleInstanceId];
    if (source === undefined || sink === undefined) {
      throw new Error("Power route references an unknown live module.");
    }
    const sourceDefinition = content.modules[source.definitionId];
    const sinkDefinition = content.modules[sink.definitionId];
    if (sourceDefinition === undefined || sinkDefinition === undefined) {
      throw new Error("Power route endpoint references unknown content.");
    }
    const sourcePort = sourceDefinition.ports.find((port) => port.id === route.from.portId);
    const sinkPort = sinkDefinition.ports.find((port) => port.id === route.to.portId);
    if (sourcePort?.kind !== "power-out" || sinkPort?.kind !== "power-in") {
      throw new Error("Power route endpoints must resolve from power-out to power-in.");
    }
    assertFiniteNonnegative(sourcePort.capacityPerSecond, "Source output-port capacity");
    assertFiniteNonnegative(sinkPort.capacityPerSecond, "Sink input-port capacity");

    const sourceModuleIndex = moduleIndexById.get(source.id);
    const sinkModuleIndex = moduleIndexById.get(sink.id);
    if (sourceModuleIndex === undefined || sinkModuleIndex === undefined) {
      throw new Error("Power topology route module index is incomplete.");
    }
    const sourcePortKey = `${source.id}\u0000${sourcePort.id}`;
    let sourcePortCapacityIndex = sourcePortCapacityIndexByKey.get(sourcePortKey);
    if (sourcePortCapacityIndex === undefined) {
      sourcePortCapacityIndex = sourcePortCapacitiesWatts.length;
      sourcePortCapacityIndexByKey.set(sourcePortKey, sourcePortCapacityIndex);
      sourcePortCapacitiesWatts.push(sourcePort.capacityPerSecond);
      sourcePortModuleIndexes.push(sourceModuleIndex);
    }
    const sinkPortKey = `${sink.id}\u0000${sinkPort.id}`;
    let sinkPortCapacityIndex = sinkPortCapacityIndexByKey.get(sinkPortKey);
    if (sinkPortCapacityIndex === undefined) {
      sinkPortCapacityIndex = sinkPortCapacitiesWatts.length;
      sinkPortCapacityIndexByKey.set(sinkPortKey, sinkPortCapacityIndex);
      sinkPortCapacitiesWatts.push(sinkPort.capacityPerSecond);
    }

    const indexedRoute: IndexedPowerRoute = {
      routeId,
      sourceModuleIndex,
      sourceModuleInstanceId: source.id,
      sourcePortId: sourcePort.id,
      sourcePortCapacityIndex,
      sourcePortCapacityWatts: sourcePort.capacityPerSecond,
      sinkModuleIndex,
      sinkModuleInstanceId: sink.id,
      sinkPortId: sinkPort.id,
      sinkPortCapacityIndex,
      sinkPortCapacityWatts: sinkPort.capacityPerSecond,
      routeCapacityWatts: route.capacityPerSecond,
    };
    routesById[routeId] = indexedRoute;
    const routeIndex = indexedRoutes.length;
    indexedRoutes.push(indexedRoute);
    routeCapacitiesWatts.push(route.capacityPerSecond);
    (incomingMutable[sink.id] ??= []).push(routeId);
    const incomingIndexes = incomingRouteIndexesByModuleIndex[sinkModuleIndex];
    if (incomingIndexes === undefined) throw new Error("Power topology sink index is incomplete.");
    incomingIndexes.push(routeIndex);
  }

  const incomingRouteIdsByModule: Record<string, readonly string[]> = {};
  for (const moduleId of Object.keys(incomingMutable).toSorted()) {
    const routeIds = incomingMutable[moduleId];
    if (routeIds === undefined)
      throw new Error("Power topology incoming-route index is incomplete.");
    incomingRouteIdsByModule[moduleId] = Object.freeze(routeIds.toSorted());
  }

  return {
    moduleIds: Object.freeze(moduleIds),
    moduleRecordUsesStableOrder: facilityModuleIds.every(
      (moduleId, index) => moduleId === moduleIds[index],
    ),
    moduleIdsByPriorityTier: Object.freeze(
      moduleIdsByPriorityTier.map((moduleIdsInTier) => Object.freeze(moduleIdsInTier)),
    ),
    moduleIndexesByPriorityTier: Object.freeze(
      moduleIndexesByPriorityTier.map((moduleIndexes) => Object.freeze(moduleIndexes)),
    ),
    moduleIndexById,
    powerRouteIds: Object.freeze(powerRouteIds),
    indexedRoutes: Object.freeze(indexedRoutes),
    routeCapacitiesWatts: Object.freeze(routeCapacitiesWatts),
    routesById,
    incomingRouteIdsByModule,
    incomingRouteIndexesByModuleIndex: Object.freeze(
      incomingRouteIndexesByModuleIndex.map((routeIndexes) => Object.freeze(routeIndexes)),
    ),
    directlySuppliedSourceModuleIds: Object.freeze(sourceModuleIds),
    directlySuppliedSourceModuleIndexes: Object.freeze(sourceModuleIndexes),
    directlySuppliedSourceModuleIdSet: new Set(sourceModuleIds),
    sourcePortCapacitiesWatts: Object.freeze(sourcePortCapacitiesWatts),
    sourcePortModuleIndexes: Object.freeze(sourcePortModuleIndexes),
    sinkPortCapacitiesWatts: Object.freeze(sinkPortCapacitiesWatts),
  };
}
