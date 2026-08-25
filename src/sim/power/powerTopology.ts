import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { FacilityState, ModuleInstanceState } from "../core/types.ts";

export interface IndexedPowerRoute {
  readonly routeId: string;
  readonly sourceModuleInstanceId: string;
  readonly sourcePortId: string;
  readonly sourcePortCapacityWatts: number;
  readonly sinkModuleInstanceId: string;
  readonly sinkPortId: string;
  readonly sinkPortCapacityWatts: number;
  readonly routeCapacityWatts: number;
}

export interface PowerTopology {
  readonly powerRouteIds: readonly string[];
  readonly routesById: Readonly<Record<string, IndexedPowerRoute>>;
  readonly incomingRouteIdsByModule: Readonly<Record<string, readonly string[]>>;
  readonly directlySuppliedSourceModuleIds: readonly string[];
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
  const sourceModuleIds = Object.keys(facility.modules)
    .filter((moduleId) => {
      const module = facility.modules[moduleId];
      if (module?.id !== moduleId) {
        throw new Error("Power topology module record key must match its stored ID.");
      }
      return isDirectlySuppliedPowerSource(module, content);
    })
    .toSorted();
  const routesById: Record<string, IndexedPowerRoute> = {};
  const incomingMutable: Record<string, string[]> = {};
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

    routesById[routeId] = {
      routeId,
      sourceModuleInstanceId: source.id,
      sourcePortId: sourcePort.id,
      sourcePortCapacityWatts: sourcePort.capacityPerSecond,
      sinkModuleInstanceId: sink.id,
      sinkPortId: sinkPort.id,
      sinkPortCapacityWatts: sinkPort.capacityPerSecond,
      routeCapacityWatts: route.capacityPerSecond,
    };
    (incomingMutable[sink.id] ??= []).push(routeId);
  }

  const incomingRouteIdsByModule: Record<string, readonly string[]> = {};
  for (const moduleId of Object.keys(incomingMutable).toSorted()) {
    const routeIds = incomingMutable[moduleId];
    if (routeIds === undefined)
      throw new Error("Power topology incoming-route index is incomplete.");
    incomingRouteIdsByModule[moduleId] = Object.freeze(routeIds.toSorted());
  }

  return {
    powerRouteIds: Object.freeze(powerRouteIds),
    routesById,
    incomingRouteIdsByModule,
    directlySuppliedSourceModuleIds: Object.freeze(sourceModuleIds),
  };
}
