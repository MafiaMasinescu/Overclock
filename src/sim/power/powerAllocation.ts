import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type {
  FacilityPowerState,
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

export interface PowerAllocationScratch {
  readonly deliveredByModule: Float64Array;
  readonly routeDelivered: Float64Array;
  readonly sourcePortRemaining: Float64Array;
  readonly sinkPortRemaining: Float64Array;
  readonly routeRemaining: Float64Array;
  readonly operationalSourceByModule: Uint8Array;
}

export function createPowerAllocationScratch(topology: PowerTopology): PowerAllocationScratch {
  return {
    deliveredByModule: new Float64Array(topology.moduleIds.length),
    routeDelivered: new Float64Array(topology.powerRouteIds.length),
    sourcePortRemaining: new Float64Array(topology.sourcePortCapacitiesWatts.length),
    sinkPortRemaining: new Float64Array(topology.sinkPortCapacitiesWatts.length),
    routeRemaining: new Float64Array(topology.powerRouteIds.length),
    operationalSourceByModule: new Uint8Array(topology.moduleIds.length),
  };
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

export function allocatePowerDelivery(
  facility: Readonly<FacilityState>,
  demands: Readonly<Record<string, ModulePowerDemand>>,
  topology: PowerTopology,
  content: ContentBundle,
  providedScratch?: PowerAllocationScratch,
  previousPower?: Readonly<FacilityPowerState>,
): PowerAllocationResult {
  if (!Number.isFinite(facility.contractedPowerWatts) || facility.contractedPowerWatts < 0) {
    throw new RangeError("Contracted power must be finite and nonnegative.");
  }

  const directSources = topology.directlySuppliedSourceModuleIdSet;
  const scratch = providedScratch ?? createPowerAllocationScratch(topology);
  if (
    scratch.deliveredByModule.length !== topology.moduleIds.length ||
    scratch.routeDelivered.length !== topology.powerRouteIds.length ||
    scratch.sourcePortRemaining.length !== topology.sourcePortCapacitiesWatts.length ||
    scratch.sinkPortRemaining.length !== topology.sinkPortCapacitiesWatts.length ||
    scratch.routeRemaining.length !== topology.powerRouteIds.length ||
    scratch.operationalSourceByModule.length !== topology.moduleIds.length
  ) {
    throw new Error("Power allocation scratch does not match the cached topology.");
  }
  const {
    deliveredByModule,
    routeDelivered,
    sourcePortRemaining,
    sinkPortRemaining,
    routeRemaining,
    operationalSourceByModule,
  } = scratch;
  deliveredByModule.fill(0);
  routeDelivered.fill(0);
  operationalSourceByModule.fill(0);
  sourcePortRemaining.fill(0);
  sinkPortRemaining.set(topology.sinkPortCapacitiesWatts);
  routeRemaining.set(topology.routeCapacitiesWatts);
  let byRoute: Record<string, RoutePowerDeliveryState> | undefined =
    previousPower === undefined ? {} : undefined;

  let remainingContractedPowerWatts = facility.contractedPowerWatts;
  const allocateDirect = (moduleIndex: number, targetWatts: number): void => {
    const delivered = deliveredByModule[moduleIndex] ?? 0;
    const amount = Math.min(Math.max(0, targetWatts - delivered), remainingContractedPowerWatts);
    deliveredByModule[moduleIndex] = safeAdd(delivered, amount, "Module delivery");
    remainingContractedPowerWatts = normalizeZero(remainingContractedPowerWatts - amount);
  };

  const sourceIndexes = topology.directlySuppliedSourceModuleIndexes;
  for (const moduleIndex of sourceIndexes) {
    const moduleId = topology.moduleIds[moduleIndex];
    if (moduleId === undefined) throw new Error("Power source module index is incomplete.");
    allocateDirect(moduleIndex, demands[moduleId]?.minimumPowerWatts ?? 0);
  }
  for (const moduleIndex of sourceIndexes) {
    const moduleId = topology.moduleIds[moduleIndex];
    if (moduleId === undefined) throw new Error("Power source module index is incomplete.");
    allocateDirect(moduleIndex, demands[moduleId]?.requestedPowerWatts ?? 0);
  }

  for (const moduleIndex of sourceIndexes) {
    const sourceId = topology.moduleIds[moduleIndex];
    if (sourceId === undefined) throw new Error("Power source module index is incomplete.");
    const source = facility.modules[sourceId];
    const sourceDemand = demands[sourceId];
    if (
      source !== undefined &&
      sourceDemand !== undefined &&
      source.operationalState !== "shutdown" &&
      source.startupTicksRemaining === 0 &&
      (deliveredByModule[moduleIndex] ?? 0) >= sourceDemand.minimumPowerWatts
    ) {
      operationalSourceByModule[moduleIndex] = 1;
    }
  }
  for (let capacityIndex = 0; capacityIndex < sourcePortRemaining.length; capacityIndex += 1) {
    const sourceModuleIndex = topology.sourcePortModuleIndexes[capacityIndex];
    const sourceModuleId =
      sourceModuleIndex === undefined ? undefined : topology.moduleIds[sourceModuleIndex];
    const source = sourceModuleId === undefined ? undefined : facility.modules[sourceModuleId];
    const sourceDemand = sourceModuleId === undefined ? undefined : demands[sourceModuleId];
    const capacity = topology.sourcePortCapacitiesWatts[capacityIndex];
    if (sourceModuleIndex === undefined || source === undefined || capacity === undefined) {
      throw new Error("Power source-port topology index is incomplete.");
    }
    const sourceFactor =
      sourceDemand === undefined || sourceDemand.requestedPowerWatts === 0
        ? source.operationalState === "shutdown"
          ? 0
          : 1
        : clampUnit((deliveredByModule[sourceModuleIndex] ?? 0) / sourceDemand.requestedPowerWatts);
    sourcePortRemaining[capacityIndex] = calculateSourcePortCapacityWatts(capacity, sourceFactor);
  }

  const allocateRouted = (moduleIndex: number, targetWatts: number): void => {
    const incomingRouteIndexes = topology.incomingRouteIndexesByModuleIndex[moduleIndex] ?? [];
    for (const routeIndex of incomingRouteIndexes) {
      const currentDelivery = deliveredByModule[moduleIndex] ?? 0;
      const remainingDemand = targetWatts - currentDelivery;
      if (remainingDemand <= 0 || remainingContractedPowerWatts <= 0) return;
      const indexed = topology.indexedRoutes[routeIndex];
      if (indexed === undefined || operationalSourceByModule[indexed.sourceModuleIndex] !== 1) {
        continue;
      }
      const amount = Math.min(
        remainingDemand,
        remainingContractedPowerWatts,
        sourcePortRemaining[indexed.sourcePortCapacityIndex] ?? 0,
        sinkPortRemaining[indexed.sinkPortCapacityIndex] ?? 0,
        routeRemaining[routeIndex] ?? 0,
      );
      if (amount <= 0) continue;
      deliveredByModule[moduleIndex] = safeAdd(currentDelivery, amount, "Module delivery");
      routeDelivered[routeIndex] = safeAdd(
        routeDelivered[routeIndex] ?? 0,
        amount,
        "Route delivery",
      );
      remainingContractedPowerWatts = normalizeZero(remainingContractedPowerWatts - amount);
      sourcePortRemaining[indexed.sourcePortCapacityIndex] = normalizeZero(
        (sourcePortRemaining[indexed.sourcePortCapacityIndex] ?? 0) - amount,
      );
      sinkPortRemaining[indexed.sinkPortCapacityIndex] = normalizeZero(
        (sinkPortRemaining[indexed.sinkPortCapacityIndex] ?? 0) - amount,
      );
      routeRemaining[routeIndex] = normalizeZero((routeRemaining[routeIndex] ?? 0) - amount);
    }
  };

  void content;
  for (const moduleIndexes of topology.moduleIndexesByPriorityTier) {
    for (const moduleIndex of moduleIndexes) {
      const moduleId = topology.moduleIds[moduleIndex];
      if (moduleId === undefined) throw new Error("Power module index is incomplete.");
      allocateRouted(moduleIndex, demands[moduleId]?.minimumPowerWatts ?? 0);
    }
    for (const moduleIndex of moduleIndexes) {
      const moduleId = topology.moduleIds[moduleIndex];
      if (moduleId === undefined) throw new Error("Power module index is incomplete.");
      allocateRouted(moduleIndex, demands[moduleId]?.requestedPowerWatts ?? 0);
    }
  }

  let byModule: Record<string, ModulePowerDeliveryState> | undefined =
    previousPower === undefined ? {} : undefined;
  let totalRequestedPowerWatts = 0;
  let totalDeliveredPowerWatts = 0;
  for (let moduleIndex = 0; moduleIndex < topology.moduleIds.length; moduleIndex += 1) {
    const moduleId = topology.moduleIds[moduleIndex];
    if (moduleId === undefined) throw new Error("Power module index is incomplete.");
    const demand = demands[moduleId];
    const module = facility.modules[moduleId];
    if (demand === undefined || module === undefined) {
      throw new Error("Power allocation module coverage is incomplete.");
    }
    const deliveredPowerWatts = normalizeZero(deliveredByModule[moduleIndex] ?? 0);
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
        const incoming = topology.incomingRouteIndexesByModuleIndex[moduleIndex] ?? [];
        const hasOperationalSource = incoming.some((routeIndex) => {
          const indexed = topology.indexedRoutes[routeIndex];
          return (
            indexed !== undefined && operationalSourceByModule[indexed.sourceModuleIndex] === 1
          );
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
    const previous = previousPower?.byModule[moduleId];
    if (
      previous?.moduleInstanceId === moduleId &&
      previous.requestedPowerWatts === demand.requestedPowerWatts &&
      previous.minimumPowerWatts === demand.minimumPowerWatts &&
      previous.deliveredPowerWatts === deliveredPowerWatts &&
      previous.powerFactor === powerFactor &&
      previous.limitingReason === limitingReason
    ) {
      if (byModule !== undefined) byModule[moduleId] = previous;
    } else {
      byModule ??= { ...previousPower?.byModule };
      byModule[moduleId] = {
        moduleInstanceId: moduleId,
        requestedPowerWatts: demand.requestedPowerWatts,
        minimumPowerWatts: demand.minimumPowerWatts,
        deliveredPowerWatts,
        powerFactor,
        limitingReason,
      };
    }
  }

  for (let routeIndex = 0; routeIndex < topology.powerRouteIds.length; routeIndex += 1) {
    const routeId = topology.powerRouteIds[routeIndex];
    const indexed = topology.indexedRoutes[routeIndex];
    if (routeId === undefined) throw new Error("Power route index is incomplete.");
    if (indexed === undefined) throw new Error("Power topology route index is incomplete.");
    const deliveredPowerWatts = normalizeZero(routeDelivered[routeIndex] ?? 0);
    const utilizationRatio =
      indexed.routeCapacityWatts === 0
        ? 0
        : clampUnit(deliveredPowerWatts / indexed.routeCapacityWatts);
    const previous = previousPower?.byRoute[routeId];
    if (
      previous?.routeId === routeId &&
      previous.deliveredPowerWatts === deliveredPowerWatts &&
      previous.utilizationRatio === utilizationRatio
    ) {
      if (byRoute !== undefined) byRoute[routeId] = previous;
    } else {
      byRoute ??= { ...previousPower?.byRoute };
      byRoute[routeId] = { routeId, deliveredPowerWatts, utilizationRatio };
    }
  }

  return {
    totalRequestedPowerWatts,
    totalDeliveredPowerWatts,
    headroomWatts: normalizeZero(
      Math.max(0, facility.contractedPowerWatts - totalDeliveredPowerWatts),
    ),
    byModule: byModule ?? previousPower?.byModule ?? {},
    byRoute: byRoute ?? previousPower?.byRoute ?? {},
  };
}
