import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState, ModuleInstanceState, ModulePowerDeliveryState } from "../core/types.ts";
import { calculateEnergyCostUsd } from "../economy/money.ts";
import type { FacilityPowerCalculation } from "./facilityPower.ts";
import { calculateModulePowerDemand, type ModulePowerDemand } from "./powerDemand.ts";
import { isValidPowerOperationalTransition } from "./powerState.ts";
import type { PowerTopology } from "./powerTopology.ts";

export interface PowerTickValidationScratch {
  readonly sourcePortTotals: Float64Array;
  readonly sinkPortTotals: Float64Array;
  readonly routedDeliveryByModule: Float64Array;
  readonly demand: ModulePowerDemand;
}

export function createPowerTickValidationScratch(
  topology: PowerTopology,
): PowerTickValidationScratch {
  return {
    sourcePortTotals: new Float64Array(topology.sourcePortCapacitiesWatts.length),
    sinkPortTotals: new Float64Array(topology.sinkPortCapacitiesWatts.length),
    routedDeliveryByModule: new Float64Array(topology.moduleIds.length),
    demand: {
      moduleInstanceId: "",
      requestedPowerWatts: 0,
      minimumPowerWatts: 0,
    },
  };
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid Power tick result at ${path}: ${message}.`);
}

function assertFiniteNonnegative(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0) fail(path, "must be finite and nonnegative");
}

function assertStableCoverage(
  record: Readonly<Record<string, unknown>>,
  expectedIds: readonly string[],
  path: string,
): void {
  const actualIds = Object.keys(record);
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((actualId, index) => actualId !== expectedIds[index])
  ) {
    fail(path, "must cover the expected IDs exactly in stable order");
  }
}

function addFiniteNonnegative(left: number, right: number, path: string): number {
  const total = left + right;
  if (!Number.isFinite(total) || total < 0) fail(path, "must remain finite and nonnegative");
  return total === 0 ? 0 : total;
}

function samePowerUnownedModuleFields(
  previous: Readonly<ModuleInstanceState>,
  next: Readonly<ModuleInstanceState>,
): boolean {
  return (
    next.id === previous.id &&
    next.definitionId === previous.definitionId &&
    next.position.x === previous.position.x &&
    next.position.y === previous.position.y &&
    next.rotation === previous.rotation &&
    next.overclock.profile === previous.overclock.profile &&
    next.overclock.frequencyRatio === previous.overclock.frequencyRatio &&
    next.overclock.voltageRatio === previous.overclock.voltageRatio &&
    next.binComputeRatio === previous.binComputeRatio &&
    next.binEfficiencyRatio === previous.binEfficiencyRatio &&
    next.binThermalRatio === previous.binThermalRatio &&
    next.binStabilityRatio === previous.binStabilityRatio &&
    next.cooldownTicksRemaining === previous.cooldownTicksRemaining
  );
}

function expectedLimitingReason(
  previousState: Readonly<GameState>,
  result: FacilityPowerCalculation,
  topology: PowerTopology,
  moduleId: string,
  delivery: Readonly<ModulePowerDeliveryState>,
): ModulePowerDeliveryState["limitingReason"] {
  const previousModule = previousState.facility.modules[moduleId];
  if (previousModule?.operationalState === "shutdown") return "shutdown";
  if (delivery.deliveredPowerWatts >= delivery.requestedPowerWatts) return "none";
  if (topology.directlySuppliedSourceModuleIdSet.has(moduleId)) return "contracted-capacity";
  const incomingRouteIds = topology.incomingRouteIdsByModule[moduleId] ?? [];
  if (incomingRouteIds.length === 0) return "missing-route";
  const hasEligibleSource = incomingRouteIds.some((routeId) => {
    const route = topology.routesById[routeId];
    if (route === undefined) return false;
    const sourceBefore = previousState.facility.modules[route.sourceModuleInstanceId];
    const sourceDelivery = result.power.byModule[route.sourceModuleInstanceId];
    return (
      sourceBefore !== undefined &&
      sourceBefore.operationalState !== "shutdown" &&
      sourceBefore.startupTicksRemaining === 0 &&
      sourceDelivery !== undefined &&
      sourceDelivery.deliveredPowerWatts >= sourceDelivery.minimumPowerWatts
    );
  });
  if (!hasEligibleSource) return "source-unavailable";
  return result.power.headroomWatts === 0 ? "contracted-capacity" : "route-capacity";
}

export function assertValidPowerTickResult(
  previousState: Readonly<GameState>,
  result: FacilityPowerCalculation,
  topology: PowerTopology,
  content: ContentBundle,
  providedScratch?: PowerTickValidationScratch,
): void {
  const { power, modules } = result;
  const scratch = providedScratch ?? createPowerTickValidationScratch(topology);
  if (
    scratch.sourcePortTotals.length !== topology.sourcePortCapacitiesWatts.length ||
    scratch.sinkPortTotals.length !== topology.sinkPortCapacitiesWatts.length ||
    scratch.routedDeliveryByModule.length !== topology.moduleIds.length
  ) {
    fail("scratch", "must match the cached topology");
  }
  scratch.sourcePortTotals.fill(0);
  scratch.sinkPortTotals.fill(0);
  scratch.routedDeliveryByModule.fill(0);
  if (power.layoutRevision !== previousState.facility.liveLayoutRevision) {
    fail("power.layoutRevision", "must match the authoritative live layout revision");
  }
  assertStableCoverage(modules, topology.moduleIds, "modules");
  assertStableCoverage(power.byModule, topology.moduleIds, "power.byModule");
  assertStableCoverage(power.byRoute, topology.powerRouteIds, "power.byRoute");
  assertFiniteNonnegative(power.totalRequestedPowerWatts, "power.totalRequestedPowerWatts");
  assertFiniteNonnegative(power.totalDeliveredPowerWatts, "power.totalDeliveredPowerWatts");
  assertFiniteNonnegative(power.headroomWatts, "power.headroomWatts");
  assertFiniteNonnegative(power.energyCostUsdThisTick, "power.energyCostUsdThisTick");

  let requestedTotal = 0;
  let deliveredTotal = 0;
  for (const moduleId of topology.moduleIds) {
    const previousModule = previousState.facility.modules[moduleId];
    const nextModule = modules[moduleId];
    const delivery = power.byModule[moduleId];
    if (previousModule === undefined || nextModule === undefined || delivery === undefined) {
      fail(`modules.${moduleId}`, "must preserve complete live-module coverage");
    }
    if (!samePowerUnownedModuleFields(previousModule, nextModule)) {
      fail(`modules.${moduleId}`, "must not change fields outside Power ownership");
    }
    const definition = content.modules[previousModule.definitionId];
    if (definition === undefined) fail(`modules.${moduleId}.definitionId`, "must resolve content");
    const demand = calculateModulePowerDemand(previousModule, definition, scratch.demand);
    if (delivery.moduleInstanceId !== moduleId) {
      fail(`power.byModule.${moduleId}.moduleInstanceId`, "must match its record key");
    }
    for (const [field, value] of [
      ["requestedPowerWatts", delivery.requestedPowerWatts],
      ["minimumPowerWatts", delivery.minimumPowerWatts],
      ["deliveredPowerWatts", delivery.deliveredPowerWatts],
    ] as const) {
      assertFiniteNonnegative(value, `power.byModule.${moduleId}.${field}`);
    }
    if (delivery.requestedPowerWatts !== demand.requestedPowerWatts) {
      fail(`power.byModule.${moduleId}.requestedPowerWatts`, "must match deterministic demand");
    }
    if (delivery.minimumPowerWatts !== demand.minimumPowerWatts) {
      fail(`power.byModule.${moduleId}.minimumPowerWatts`, "must match deterministic minimum");
    }
    if (delivery.deliveredPowerWatts > delivery.requestedPowerWatts) {
      fail(`power.byModule.${moduleId}.deliveredPowerWatts`, "must not exceed requested power");
    }
    const expectedFactor =
      previousModule.operationalState === "shutdown"
        ? 0
        : delivery.requestedPowerWatts === 0
          ? 1
          : Math.min(1, delivery.deliveredPowerWatts / delivery.requestedPowerWatts);
    if (delivery.powerFactor !== expectedFactor) {
      fail(`power.byModule.${moduleId}.powerFactor`, "must match delivered/requested power");
    }
    if (
      delivery.limitingReason !==
      expectedLimitingReason(previousState, result, topology, moduleId, delivery)
    ) {
      fail(`power.byModule.${moduleId}.limitingReason`, "must follow stable precedence");
    }
    if (
      !isValidPowerOperationalTransition(
        previousModule,
        nextModule,
        delivery.deliveredPowerWatts,
        delivery.requestedPowerWatts,
        delivery.minimumPowerWatts,
      )
    ) {
      fail(`modules.${moduleId}`, "must contain only the valid Power operational transition");
    }
    requestedTotal = addFiniteNonnegative(
      requestedTotal,
      delivery.requestedPowerWatts,
      "power.totalRequestedPowerWatts",
    );
    deliveredTotal = addFiniteNonnegative(
      deliveredTotal,
      delivery.deliveredPowerWatts,
      "power.totalDeliveredPowerWatts",
    );
  }

  for (let routeIndex = 0; routeIndex < topology.powerRouteIds.length; routeIndex += 1) {
    const routeId = topology.powerRouteIds[routeIndex];
    const indexed = topology.indexedRoutes[routeIndex];
    if (routeId === undefined) fail("power.byRoute", "must resolve stable route ordering");
    const routeResult = power.byRoute[routeId];
    if (indexed === undefined || routeResult === undefined) {
      fail(`power.byRoute.${routeId}`, "must resolve cached topology");
    }
    if (routeResult.routeId !== routeId) {
      fail(`power.byRoute.${routeId}.routeId`, "must match its record key");
    }
    assertFiniteNonnegative(
      routeResult.deliveredPowerWatts,
      `power.byRoute.${routeId}.deliveredPowerWatts`,
    );
    if (routeResult.deliveredPowerWatts > indexed.routeCapacityWatts) {
      fail(`power.byRoute.${routeId}.deliveredPowerWatts`, "must not exceed route capacity");
    }
    const sourceBefore = previousState.facility.modules[indexed.sourceModuleInstanceId];
    const sourceDelivery = power.byModule[indexed.sourceModuleInstanceId];
    if (
      routeResult.deliveredPowerWatts > 0 &&
      (sourceBefore === undefined ||
        sourceBefore.operationalState === "shutdown" ||
        sourceBefore.startupTicksRemaining !== 0 ||
        sourceDelivery === undefined ||
        sourceDelivery.deliveredPowerWatts < sourceDelivery.minimumPowerWatts)
    ) {
      fail(
        `power.byRoute.${routeId}.deliveredPowerWatts`,
        "must not flow from a source unavailable at tick start",
      );
    }
    const expectedUtilization =
      indexed.routeCapacityWatts === 0
        ? 0
        : Math.min(1, routeResult.deliveredPowerWatts / indexed.routeCapacityWatts);
    if (routeResult.utilizationRatio !== expectedUtilization) {
      fail(`power.byRoute.${routeId}.utilizationRatio`, "must match flow and capacity");
    }
    scratch.sourcePortTotals[indexed.sourcePortCapacityIndex] = addFiniteNonnegative(
      scratch.sourcePortTotals[indexed.sourcePortCapacityIndex] ?? 0,
      routeResult.deliveredPowerWatts,
      `power.byRoute.${routeId}.deliveredPowerWatts`,
    );
    scratch.sinkPortTotals[indexed.sinkPortCapacityIndex] = addFiniteNonnegative(
      scratch.sinkPortTotals[indexed.sinkPortCapacityIndex] ?? 0,
      routeResult.deliveredPowerWatts,
      `power.byRoute.${routeId}.deliveredPowerWatts`,
    );
    scratch.routedDeliveryByModule[indexed.sinkModuleIndex] = addFiniteNonnegative(
      scratch.routedDeliveryByModule[indexed.sinkModuleIndex] ?? 0,
      routeResult.deliveredPowerWatts,
      `power.byModule.${indexed.sinkModuleInstanceId}.deliveredPowerWatts`,
    );
    const sourceFactor = power.byModule[indexed.sourceModuleInstanceId]?.powerFactor ?? 0;
    if (
      (scratch.sourcePortTotals[indexed.sourcePortCapacityIndex] ?? 0) >
        indexed.sourcePortCapacityWatts * sourceFactor ||
      (scratch.sinkPortTotals[indexed.sinkPortCapacityIndex] ?? 0) > indexed.sinkPortCapacityWatts
    ) {
      fail(`power.byRoute.${routeId}.deliveredPowerWatts`, "must respect shared port capacity");
    }
  }

  for (let moduleIndex = 0; moduleIndex < topology.moduleIds.length; moduleIndex += 1) {
    const moduleId = topology.moduleIds[moduleIndex];
    if (moduleId === undefined) fail("power.byModule", "must resolve stable module ordering");
    if (
      !topology.directlySuppliedSourceModuleIdSet.has(moduleId) &&
      (scratch.routedDeliveryByModule[moduleIndex] ?? 0) !==
        power.byModule[moduleId]?.deliveredPowerWatts
    ) {
      fail(`power.byModule.${moduleId}.deliveredPowerWatts`, "must match incoming route flow");
    }
  }
  if (power.totalRequestedPowerWatts !== requestedTotal) {
    fail("power.totalRequestedPowerWatts", "must match the stable module total");
  }
  if (power.totalDeliveredPowerWatts !== deliveredTotal) {
    fail("power.totalDeliveredPowerWatts", "must match the stable module total");
  }
  if (deliveredTotal > previousState.facility.contractedPowerWatts) {
    fail("power.totalDeliveredPowerWatts", "must not exceed contracted capacity");
  }
  if (
    power.headroomWatts !==
    Math.max(0, previousState.facility.contractedPowerWatts - deliveredTotal)
  ) {
    fail("power.headroomWatts", "must match contracted capacity minus delivery");
  }
  const expectedEnergyCost = calculateEnergyCostUsd(
    deliveredTotal,
    0.1,
    previousState.economy.energyPriceUsdPerKwh,
  );
  if (power.energyCostUsdThisTick !== expectedEnergyCost) {
    fail("power.energyCostUsdThisTick", "must match the exact 0.1-second energy calculation");
  }
}
