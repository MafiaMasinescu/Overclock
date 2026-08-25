import type { ContentBundle, ModuleDefinition } from "../../content/schemas/contentSchemas.ts";
import type {
  FacilityState,
  ModulePowerDeliveryState,
  PowerLimitingReason,
  RoutePowerDeliveryState,
} from "../core/types.ts";
import type { ModulePowerDemand } from "./powerDemand.ts";
import type { PowerTopology } from "./powerTopology.ts";

export interface PowerAllocationResult {
  readonly totalRequestedPowerWatts: number;
  readonly totalDeliveredPowerWatts: number;
  readonly headroomWatts: number;
  readonly byModule: Record<string, ModulePowerDeliveryState>;
  readonly byRoute: Record<string, RoutePowerDeliveryState>;
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function clampUnit(value: number): number {
  return normalizeZero(Math.min(1, Math.max(0, value)));
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isFinite(result) || result < 0) {
    throw new RangeError(`${label} must remain finite and nonnegative.`);
  }
  return normalizeZero(result);
}

function capacityKey(moduleId: string, portId: string): string {
  return `${moduleId}\u0000${portId}`;
}

export function calculateSourcePortCapacityWatts(
  portCapacityWatts: number,
  sourcePowerFactor: number,
): number {
  if (!Number.isFinite(portCapacityWatts) || portCapacityWatts < 0) {
    throw new RangeError("Source output-port capacity must be finite and nonnegative.");
  }
  if (!Number.isFinite(sourcePowerFactor)) {
    throw new RangeError("Source Power Factor must be finite.");
  }
  const result = portCapacityWatts * clampUnit(sourcePowerFactor);
  if (!Number.isFinite(result)) {
    throw new RangeError("Scaled source output-port capacity must be finite.");
  }
  return normalizeZero(result);
}

function priorityTier(definition: { readonly category: ModuleDefinition["category"] }): number {
  switch (definition.category) {
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

export function allocatePowerDelivery(
  facility: Readonly<FacilityState>,
  demands: Readonly<Record<string, ModulePowerDemand>>,
  topology: PowerTopology,
  content: ContentBundle,
): PowerAllocationResult {
  if (!Number.isFinite(facility.contractedPowerWatts) || facility.contractedPowerWatts < 0) {
    throw new RangeError("Contracted power must be finite and nonnegative.");
  }

  const directSources = new Set(topology.directlySuppliedSourceModuleIds);
  const deliveredByModule: Record<string, number> = {};
  const routeDelivered: Record<string, number> = {};
  const byRoute: Record<string, RoutePowerDeliveryState> = {};
  for (const routeId of topology.powerRouteIds) {
    routeDelivered[routeId] = 0;
  }
  for (const moduleId of Object.keys(demands).toSorted()) {
    deliveredByModule[moduleId] = 0;
  }

  let remainingContractedPowerWatts = facility.contractedPowerWatts;
  const allocateDirect = (moduleId: string, targetWatts: number): void => {
    const delivered = deliveredByModule[moduleId] ?? 0;
    const amount = Math.min(Math.max(0, targetWatts - delivered), remainingContractedPowerWatts);
    deliveredByModule[moduleId] = safeAdd(delivered, amount, "Module delivery");
    remainingContractedPowerWatts = normalizeZero(remainingContractedPowerWatts - amount);
  };

  const sourceIds = topology.directlySuppliedSourceModuleIds;
  for (const moduleId of sourceIds) {
    allocateDirect(moduleId, demands[moduleId]?.minimumPowerWatts ?? 0);
  }
  for (const moduleId of sourceIds) {
    allocateDirect(moduleId, demands[moduleId]?.requestedPowerWatts ?? 0);
  }

  const operationalSources = new Set<string>();
  const sourcePortRemaining: Record<string, number> = {};
  const sinkPortRemaining: Record<string, number> = {};
  const routeRemaining: Record<string, number> = {};
  for (const sourceId of sourceIds) {
    const source = facility.modules[sourceId];
    const sourceDemand = demands[sourceId];
    if (
      source !== undefined &&
      sourceDemand !== undefined &&
      source.operationalState !== "shutdown" &&
      source.startupTicksRemaining === 0 &&
      (deliveredByModule[sourceId] ?? 0) >= sourceDemand.minimumPowerWatts
    ) {
      operationalSources.add(sourceId);
    }
  }
  for (const routeId of topology.powerRouteIds) {
    const indexed = topology.routesById[routeId];
    if (indexed === undefined) throw new Error("Power topology route index is incomplete.");
    const source = facility.modules[indexed.sourceModuleInstanceId];
    const sourceDemand = demands[indexed.sourceModuleInstanceId];
    const sourceKey = capacityKey(indexed.sourceModuleInstanceId, indexed.sourcePortId);
    if (sourcePortRemaining[sourceKey] === undefined) {
      const sourceFactor =
        sourceDemand === undefined || sourceDemand.requestedPowerWatts === 0
          ? source?.operationalState === "shutdown"
            ? 0
            : 1
          : clampUnit(
              (deliveredByModule[indexed.sourceModuleInstanceId] ?? 0) /
                sourceDemand.requestedPowerWatts,
            );
      sourcePortRemaining[sourceKey] = calculateSourcePortCapacityWatts(
        indexed.sourcePortCapacityWatts,
        sourceFactor,
      );
    }
    const sinkKey = capacityKey(indexed.sinkModuleInstanceId, indexed.sinkPortId);
    sinkPortRemaining[sinkKey] ??= indexed.sinkPortCapacityWatts;
    routeRemaining[routeId] = indexed.routeCapacityWatts;
  }

  const allocateRouted = (moduleId: string, targetWatts: number): void => {
    const incomingRouteIds = topology.incomingRouteIdsByModule[moduleId] ?? [];
    for (const routeId of incomingRouteIds) {
      const currentDelivery = deliveredByModule[moduleId] ?? 0;
      const remainingDemand = targetWatts - currentDelivery;
      if (remainingDemand <= 0 || remainingContractedPowerWatts <= 0) return;
      const indexed = topology.routesById[routeId];
      if (indexed === undefined || !operationalSources.has(indexed.sourceModuleInstanceId)) {
        continue;
      }
      const sourceKey = capacityKey(indexed.sourceModuleInstanceId, indexed.sourcePortId);
      const sinkKey = capacityKey(indexed.sinkModuleInstanceId, indexed.sinkPortId);
      const amount = Math.min(
        remainingDemand,
        remainingContractedPowerWatts,
        sourcePortRemaining[sourceKey] ?? 0,
        sinkPortRemaining[sinkKey] ?? 0,
        routeRemaining[routeId] ?? 0,
      );
      if (amount <= 0) continue;
      deliveredByModule[moduleId] = safeAdd(currentDelivery, amount, "Module delivery");
      routeDelivered[routeId] = safeAdd(routeDelivered[routeId] ?? 0, amount, "Route delivery");
      remainingContractedPowerWatts = normalizeZero(remainingContractedPowerWatts - amount);
      sourcePortRemaining[sourceKey] = normalizeZero(
        (sourcePortRemaining[sourceKey] ?? 0) - amount,
      );
      sinkPortRemaining[sinkKey] = normalizeZero((sinkPortRemaining[sinkKey] ?? 0) - amount);
      routeRemaining[routeId] = normalizeZero((routeRemaining[routeId] ?? 0) - amount);
    }
  };

  const tierModuleIds: string[][] = [[], [], [], [], []];
  for (const moduleId of Object.keys(facility.modules).toSorted()) {
    if (directSources.has(moduleId)) continue;
    const module = facility.modules[moduleId];
    const definition = module === undefined ? undefined : content.modules[module.definitionId];
    if (module === undefined || definition === undefined) {
      throw new Error("Power allocation references unknown module content.");
    }
    const tier = tierModuleIds[priorityTier(definition)];
    if (tier === undefined) throw new Error("Power allocation priority tier is missing.");
    tier.push(moduleId);
  }
  for (const moduleIds of tierModuleIds) {
    for (const moduleId of moduleIds) {
      allocateRouted(moduleId, demands[moduleId]?.minimumPowerWatts ?? 0);
    }
    for (const moduleId of moduleIds) {
      allocateRouted(moduleId, demands[moduleId]?.requestedPowerWatts ?? 0);
    }
  }

  const byModule: Record<string, ModulePowerDeliveryState> = {};
  let totalRequestedPowerWatts = 0;
  let totalDeliveredPowerWatts = 0;
  for (const moduleId of Object.keys(demands).toSorted()) {
    const demand = demands[moduleId];
    const module = facility.modules[moduleId];
    if (demand === undefined || module === undefined) {
      throw new Error("Power allocation module coverage is incomplete.");
    }
    const deliveredPowerWatts = normalizeZero(deliveredByModule[moduleId] ?? 0);
    totalRequestedPowerWatts = safeAdd(
      totalRequestedPowerWatts,
      demand.requestedPowerWatts,
      "Total requested power",
    );
    totalDeliveredPowerWatts = safeAdd(
      totalDeliveredPowerWatts,
      deliveredPowerWatts,
      "Total delivered power",
    );

    let limitingReason: PowerLimitingReason = "none";
    if (module.operationalState === "shutdown") {
      limitingReason = "shutdown";
    } else if (deliveredPowerWatts < demand.requestedPowerWatts) {
      if (directSources.has(moduleId)) {
        limitingReason = "contracted-capacity";
      } else {
        const incoming = topology.incomingRouteIdsByModule[moduleId] ?? [];
        const hasOperationalSource = incoming.some((routeId) => {
          const indexed = topology.routesById[routeId];
          return indexed !== undefined && operationalSources.has(indexed.sourceModuleInstanceId);
        });
        if (incoming.length === 0) limitingReason = "missing-route";
        else if (!hasOperationalSource) limitingReason = "source-unavailable";
        else if (remainingContractedPowerWatts === 0) limitingReason = "contracted-capacity";
        else limitingReason = "route-capacity";
      }
    }
    const powerFactor =
      module.operationalState === "shutdown"
        ? 0
        : demand.requestedPowerWatts === 0
          ? 1
          : clampUnit(deliveredPowerWatts / demand.requestedPowerWatts);
    byModule[moduleId] = {
      moduleInstanceId: moduleId,
      requestedPowerWatts: demand.requestedPowerWatts,
      minimumPowerWatts: demand.minimumPowerWatts,
      deliveredPowerWatts,
      powerFactor,
      limitingReason,
    };
  }

  for (const routeId of topology.powerRouteIds) {
    const indexed = topology.routesById[routeId];
    if (indexed === undefined) throw new Error("Power topology route index is incomplete.");
    const deliveredPowerWatts = normalizeZero(routeDelivered[routeId] ?? 0);
    byRoute[routeId] = {
      routeId,
      deliveredPowerWatts,
      utilizationRatio:
        indexed.routeCapacityWatts === 0
          ? 0
          : clampUnit(deliveredPowerWatts / indexed.routeCapacityWatts),
    };
  }

  return {
    totalRequestedPowerWatts,
    totalDeliveredPowerWatts,
    headroomWatts: normalizeZero(
      Math.max(0, facility.contractedPowerWatts - totalDeliveredPowerWatts),
    ),
    byModule,
    byRoute,
  };
}
