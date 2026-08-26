import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { calculateEnergyCostUsd } from "../economy/money.ts";
import type { FacilityPowerState, GameState, ModuleInstanceState } from "../core/types.ts";

export interface PowerStateIssue {
  readonly path: string;
  readonly message: string;
}

export function createDirtyPowerState(contractedPowerWatts: number): FacilityPowerState {
  if (!Number.isFinite(contractedPowerWatts) || contractedPowerWatts < 0) {
    throw new RangeError("Contracted power must be finite and nonnegative.");
  }

  return {
    layoutRevision: null,
    totalRequestedPowerWatts: 0,
    totalDeliveredPowerWatts: 0,
    headroomWatts: contractedPowerWatts === 0 ? 0 : contractedPowerWatts,
    energyCostUsdThisTick: 0,
    byModule: {},
    byRoute: {},
  };
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function stableSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total) || total < 0) throw new RangeError("Power total overflowed.");
  }
  return total === 0 ? 0 : total;
}

function pushIf(
  issues: PowerStateIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

export function isValidPowerOperationalTransition(
  previous: Readonly<ModuleInstanceState>,
  next: Readonly<ModuleInstanceState>,
  deliveredPowerWatts: number,
  requestedPowerWatts: number,
  minimumPowerWatts: number,
): boolean {
  if (
    next.id !== previous.id ||
    next.definitionId !== previous.definitionId ||
    next.position.x !== previous.position.x ||
    next.position.y !== previous.position.y ||
    next.rotation !== previous.rotation ||
    next.overclock.profile !== previous.overclock.profile ||
    next.overclock.frequencyRatio !== previous.overclock.frequencyRatio ||
    next.overclock.voltageRatio !== previous.overclock.voltageRatio ||
    next.binComputeRatio !== previous.binComputeRatio ||
    next.binEfficiencyRatio !== previous.binEfficiencyRatio ||
    next.binThermalRatio !== previous.binThermalRatio ||
    next.binStabilityRatio !== previous.binStabilityRatio ||
    next.cooldownTicksRemaining !== previous.cooldownTicksRemaining
  ) {
    return false;
  }
  if (previous.operationalState === "shutdown") {
    return (
      next.operationalState === "shutdown" &&
      next.startupTicksRemaining === previous.startupTicksRemaining
    );
  }
  if (requestedPowerWatts > 0 && deliveredPowerWatts < minimumPowerWatts) {
    return (
      next.operationalState === "brownout" &&
      next.startupTicksRemaining === previous.startupTicksRemaining
    );
  }
  const expectedStartup = Math.max(0, previous.startupTicksRemaining - 1);
  return (
    next.startupTicksRemaining === expectedStartup &&
    next.operationalState === (expectedStartup === 0 ? "online" : "starting")
  );
}

const OPERATIONAL_STATES = new Set(["offline", "starting", "online", "brownout", "shutdown"]);
const LIMITING_REASONS = new Set([
  "none",
  "shutdown",
  "missing-route",
  "source-unavailable",
  "contracted-capacity",
  "route-capacity",
]);

export function validatePowerState(
  state: Readonly<GameState>,
  content: ContentBundle,
  calculationInputModules?: Readonly<Record<string, ModuleInstanceState>>,
): PowerStateIssue[] {
  const issues: PowerStateIssue[] = [];
  const { facility } = state;
  const { power } = facility;
  pushIf(
    issues,
    !isFiniteNonnegative(facility.contractedPowerWatts),
    "facility.contractedPowerWatts",
    "must be finite and nonnegative",
  );
  for (const [path, value] of [
    ["facility.power.totalRequestedPowerWatts", power.totalRequestedPowerWatts],
    ["facility.power.totalDeliveredPowerWatts", power.totalDeliveredPowerWatts],
    ["facility.power.headroomWatts", power.headroomWatts],
    ["facility.power.energyCostUsdThisTick", power.energyCostUsdThisTick],
  ] as const) {
    pushIf(issues, !isFiniteNonnegative(value), path, "must be finite and nonnegative");
  }

  const moduleKeys = Object.keys(power.byModule);
  const routeKeys = Object.keys(power.byRoute);
  pushIf(
    issues,
    moduleKeys.join("\u0000") !== moduleKeys.toSorted().join("\u0000"),
    "facility.power.byModule",
    "keys must use stable ordering",
  );
  pushIf(
    issues,
    routeKeys.join("\u0000") !== routeKeys.toSorted().join("\u0000"),
    "facility.power.byRoute",
    "keys must use stable ordering",
  );

  if (power.layoutRevision === null) {
    pushIf(
      issues,
      power.totalRequestedPowerWatts !== 0,
      "facility.power.totalRequestedPowerWatts",
      "dirty state must be zero",
    );
    pushIf(
      issues,
      power.totalDeliveredPowerWatts !== 0,
      "facility.power.totalDeliveredPowerWatts",
      "dirty state must be zero",
    );
    pushIf(
      issues,
      power.energyCostUsdThisTick !== 0,
      "facility.power.energyCostUsdThisTick",
      "dirty state must be zero",
    );
    pushIf(
      issues,
      power.headroomWatts !== facility.contractedPowerWatts,
      "facility.power.headroomWatts",
      "dirty state must equal contracted capacity",
    );
    pushIf(issues, moduleKeys.length !== 0, "facility.power.byModule", "dirty state must be empty");
    pushIf(issues, routeKeys.length !== 0, "facility.power.byRoute", "dirty state must be empty");
    return issues;
  }

  pushIf(
    issues,
    !Number.isSafeInteger(power.layoutRevision) || power.layoutRevision < 0,
    "facility.power.layoutRevision",
    "must be a nonnegative safe integer or null",
  );
  pushIf(
    issues,
    power.layoutRevision !== facility.liveLayoutRevision,
    "facility.power.layoutRevision",
    "must match the live layout revision",
  );
  const expectedModuleKeys = Object.keys(facility.modules).toSorted();
  const expectedRouteKeys = Object.keys(facility.routes)
    .filter((routeId) => facility.routes[routeId]?.kind === "power")
    .toSorted();
  const hasSufficientSourcePower = (moduleId: string): boolean => {
    const source = facility.modules[moduleId];
    const definition = source === undefined ? undefined : content.modules[source.definitionId];
    const delivery = power.byModule[moduleId];
    return (
      source !== undefined &&
      definition?.category === "power" &&
      definition.ports.some((port) => port.kind === "power-out") &&
      source.operationalState !== "shutdown" &&
      delivery !== undefined &&
      delivery.deliveredPowerWatts >= delivery.minimumPowerWatts
    );
  };
  const wasEligibleSourceAtCalculationStart = (moduleId: string): boolean => {
    const sourceAtTickStart = calculationInputModules?.[moduleId];
    return (
      hasSufficientSourcePower(moduleId) &&
      sourceAtTickStart !== undefined &&
      sourceAtTickStart.operationalState !== "shutdown" &&
      sourceAtTickStart.startupTicksRemaining === 0
    );
  };
  pushIf(
    issues,
    moduleKeys.toSorted().join("\u0000") !== expectedModuleKeys.join("\u0000"),
    "facility.power.byModule",
    "must cover every live module exactly once",
  );
  pushIf(
    issues,
    routeKeys.toSorted().join("\u0000") !== expectedRouteKeys.join("\u0000"),
    "facility.power.byRoute",
    "must cover every live power route exactly once",
  );

  for (const moduleId of moduleKeys.toSorted()) {
    const result = power.byModule[moduleId];
    const module = facility.modules[moduleId];
    if (result === undefined) continue;
    pushIf(
      issues,
      result.moduleInstanceId !== moduleId,
      `facility.power.byModule.${moduleId}.moduleInstanceId`,
      "must match its record key",
    );
    pushIf(
      issues,
      module === undefined,
      `facility.power.byModule.${moduleId}.moduleInstanceId`,
      "must reference a live module",
    );
    for (const [field, value] of [
      ["requestedPowerWatts", result.requestedPowerWatts],
      ["minimumPowerWatts", result.minimumPowerWatts],
      ["deliveredPowerWatts", result.deliveredPowerWatts],
    ] as const) {
      pushIf(
        issues,
        !isFiniteNonnegative(value),
        `facility.power.byModule.${moduleId}.${field}`,
        "must be finite and nonnegative",
      );
    }
    pushIf(
      issues,
      result.deliveredPowerWatts > result.requestedPowerWatts,
      `facility.power.byModule.${moduleId}.deliveredPowerWatts`,
      "must not exceed requested power",
    );
    pushIf(
      issues,
      result.minimumPowerWatts > result.requestedPowerWatts,
      `facility.power.byModule.${moduleId}.minimumPowerWatts`,
      "must not exceed requested power",
    );
    pushIf(
      issues,
      !Number.isFinite(result.powerFactor) || result.powerFactor < 0 || result.powerFactor > 1,
      `facility.power.byModule.${moduleId}.powerFactor`,
      "must be in [0, 1]",
    );
    pushIf(
      issues,
      !LIMITING_REASONS.has(result.limitingReason),
      `facility.power.byModule.${moduleId}.limitingReason`,
      "must be a supported limiting reason",
    );
    if (module !== undefined) {
      pushIf(
        issues,
        !OPERATIONAL_STATES.has(module.operationalState),
        `facility.modules.${moduleId}.operationalState`,
        "must be a supported operational state",
      );
      pushIf(
        issues,
        !Number.isSafeInteger(module.startupTicksRemaining) || module.startupTicksRemaining < 0,
        `facility.modules.${moduleId}.startupTicksRemaining`,
        "must be a nonnegative safe integer",
      );
      pushIf(
        issues,
        !Number.isSafeInteger(module.cooldownTicksRemaining) || module.cooldownTicksRemaining < 0,
        `facility.modules.${moduleId}.cooldownTicksRemaining`,
        "must be a nonnegative safe integer",
      );
      const expectedFactor =
        module.operationalState === "shutdown"
          ? 0
          : result.requestedPowerWatts === 0
            ? 1
            : Math.min(1, Math.max(0, result.deliveredPowerWatts / result.requestedPowerWatts));
      pushIf(
        issues,
        result.powerFactor !== expectedFactor,
        `facility.power.byModule.${moduleId}.powerFactor`,
        "does not match delivered and requested power",
      );
      pushIf(
        issues,
        module.operationalState === "shutdown" && result.limitingReason !== "shutdown",
        `facility.power.byModule.${moduleId}.limitingReason`,
        "shutdown modules must use shutdown",
      );
      pushIf(
        issues,
        module.operationalState !== "shutdown" &&
          result.deliveredPowerWatts === result.requestedPowerWatts &&
          result.limitingReason !== "none",
        `facility.power.byModule.${moduleId}.limitingReason`,
        "full delivery must use none",
      );
    }
    const calculationInputModule = calculationInputModules?.[moduleId];
    if (module !== undefined && calculationInputModule !== undefined) {
      pushIf(
        issues,
        !isValidPowerOperationalTransition(
          calculationInputModule,
          module,
          result.deliveredPowerWatts,
          result.requestedPowerWatts,
          result.minimumPowerWatts,
        ),
        `facility.modules.${moduleId}`,
        "contains an invalid power-owned operational transition",
      );
    }
  }

  const sourcePortTotals: Record<string, number> = {};
  const sinkPortTotals: Record<string, number> = {};
  const deliveredBySinkRoutes: Record<string, number> = {};
  for (const routeId of routeKeys.toSorted()) {
    const result = power.byRoute[routeId];
    const route = facility.routes[routeId];
    if (result === undefined) continue;
    pushIf(
      issues,
      result.routeId !== routeId,
      `facility.power.byRoute.${routeId}.routeId`,
      "must match its record key",
    );
    pushIf(
      issues,
      route?.kind !== "power",
      `facility.power.byRoute.${routeId}.routeId`,
      "must reference a live power route",
    );
    pushIf(
      issues,
      !isFiniteNonnegative(result.deliveredPowerWatts),
      `facility.power.byRoute.${routeId}.deliveredPowerWatts`,
      "must be finite and nonnegative",
    );
    pushIf(
      issues,
      !Number.isFinite(result.utilizationRatio) ||
        result.utilizationRatio < 0 ||
        result.utilizationRatio > 1,
      `facility.power.byRoute.${routeId}.utilizationRatio`,
      "must be in [0, 1]",
    );
    if (route === undefined) continue;
    pushIf(
      issues,
      result.deliveredPowerWatts > route.capacityPerSecond,
      `facility.power.byRoute.${routeId}.deliveredPowerWatts`,
      "must not exceed route capacity",
    );
    const expectedUtilization =
      route.capacityPerSecond === 0
        ? 0
        : Math.min(1, result.deliveredPowerWatts / route.capacityPerSecond);
    pushIf(
      issues,
      result.utilizationRatio !== expectedUtilization,
      `facility.power.byRoute.${routeId}.utilizationRatio`,
      "does not match route flow and capacity",
    );
    const source = facility.modules[route.from.moduleInstanceId];
    const sink = facility.modules[route.to.moduleInstanceId];
    const sourceDefinition =
      source === undefined ? undefined : content.modules[source.definitionId];
    const sinkDefinition = sink === undefined ? undefined : content.modules[sink.definitionId];
    const sourcePort = sourceDefinition?.ports.find((port) => port.id === route.from.portId);
    const sinkPort = sinkDefinition?.ports.find((port) => port.id === route.to.portId);
    if (
      source === undefined ||
      sink === undefined ||
      sourcePort?.kind !== "power-out" ||
      sinkPort?.kind !== "power-in"
    ) {
      issues.push({
        path: `facility.power.byRoute.${routeId}`,
        message: "must not deliver through non-power endpoints",
      });
      continue;
    }
    const sourceKey = `${source.id}\u0000${sourcePort.id}`;
    const sinkKey = `${sink.id}\u0000${sinkPort.id}`;
    sourcePortTotals[sourceKey] = stableSum([
      sourcePortTotals[sourceKey] ?? 0,
      result.deliveredPowerWatts,
    ]);
    sinkPortTotals[sinkKey] = stableSum([sinkPortTotals[sinkKey] ?? 0, result.deliveredPowerWatts]);
    deliveredBySinkRoutes[sink.id] = stableSum([
      deliveredBySinkRoutes[sink.id] ?? 0,
      result.deliveredPowerWatts,
    ]);
    const sourceFactor = power.byModule[source.id]?.powerFactor ?? 0;
    pushIf(
      issues,
      result.deliveredPowerWatts > 0 && !hasSufficientSourcePower(source.id),
      `facility.power.byRoute.${routeId}.deliveredPowerWatts`,
      "must not flow from a source below minimum power",
    );
    pushIf(
      issues,
      calculationInputModules !== undefined &&
        result.deliveredPowerWatts > 0 &&
        !wasEligibleSourceAtCalculationStart(source.id),
      `facility.power.byRoute.${routeId}.deliveredPowerWatts`,
      "must not flow from a source unavailable at calculation start",
    );
    const scaledSourceCapacity = sourcePort.capacityPerSecond * sourceFactor;
    pushIf(
      issues,
      !Number.isFinite(scaledSourceCapacity) ||
        (sourcePortTotals[sourceKey] ?? 0) > scaledSourceCapacity,
      `facility.power.byRoute.${routeId}.deliveredPowerWatts`,
      "exceeds shared source-output capacity",
    );
    pushIf(
      issues,
      (sinkPortTotals[sinkKey] ?? 0) > sinkPort.capacityPerSecond,
      `facility.power.byRoute.${routeId}.deliveredPowerWatts`,
      "exceeds shared sink-input capacity",
    );
  }

  for (const moduleId of expectedModuleKeys) {
    const module = facility.modules[moduleId];
    const definition = module === undefined ? undefined : content.modules[module.definitionId];
    const isDirectSource =
      definition?.category === "power" &&
      definition.ports.some((port) => port.kind === "power-out");
    if (!isDirectSource) {
      pushIf(
        issues,
        (deliveredBySinkRoutes[moduleId] ?? 0) !==
          (power.byModule[moduleId]?.deliveredPowerWatts ?? 0),
        `facility.power.byModule.${moduleId}.deliveredPowerWatts`,
        "must match summed incoming power-route flow",
      );
    }
  }

  const incomingRouteIdsByModule: Record<string, string[]> = {};
  for (const routeId of expectedRouteKeys) {
    const route = facility.routes[routeId];
    if (route === undefined) continue;
    (incomingRouteIdsByModule[route.to.moduleInstanceId] ??= []).push(routeId);
  }
  for (const moduleId of expectedModuleKeys) {
    const module = facility.modules[moduleId];
    const result = power.byModule[moduleId];
    if (
      module === undefined ||
      result === undefined ||
      module.operationalState === "shutdown" ||
      result.deliveredPowerWatts >= result.requestedPowerWatts
    ) {
      continue;
    }
    const definition = content.modules[module.definitionId];
    const isDirectSource =
      definition?.category === "power" &&
      definition.ports.some((port) => port.kind === "power-out");
    let expectedReason: FacilityPowerState["byModule"][string]["limitingReason"];
    if (isDirectSource) {
      expectedReason = "contracted-capacity";
    } else {
      const incomingRouteIds = incomingRouteIdsByModule[moduleId] ?? [];
      if (incomingRouteIds.length === 0) expectedReason = "missing-route";
      else if (
        calculationInputModules === undefined &&
        result.deliveredPowerWatts === 0 &&
        result.limitingReason === "source-unavailable"
      ) {
        continue;
      } else if (
        calculationInputModules !== undefined &&
        !incomingRouteIds.some((routeId) => {
          const route = facility.routes[routeId];
          return (
            route !== undefined && wasEligibleSourceAtCalculationStart(route.from.moduleInstanceId)
          );
        })
      ) {
        expectedReason = "source-unavailable";
      } else if (power.headroomWatts === 0) expectedReason = "contracted-capacity";
      else expectedReason = "route-capacity";
    }
    pushIf(
      issues,
      result.limitingReason !== expectedReason,
      `facility.power.byModule.${moduleId}.limitingReason`,
      `must use ${expectedReason} by stable precedence`,
    );
  }

  const requestedTotal = stableSum(
    expectedModuleKeys.map((id) => power.byModule[id]?.requestedPowerWatts ?? 0),
  );
  const deliveredTotal = stableSum(
    expectedModuleKeys.map((id) => power.byModule[id]?.deliveredPowerWatts ?? 0),
  );
  pushIf(
    issues,
    power.totalRequestedPowerWatts !== requestedTotal,
    "facility.power.totalRequestedPowerWatts",
    "does not match module total",
  );
  pushIf(
    issues,
    power.totalDeliveredPowerWatts !== deliveredTotal,
    "facility.power.totalDeliveredPowerWatts",
    "does not match module total",
  );
  pushIf(
    issues,
    power.totalDeliveredPowerWatts > facility.contractedPowerWatts,
    "facility.power.totalDeliveredPowerWatts",
    "must not exceed contracted capacity",
  );
  pushIf(
    issues,
    power.headroomWatts !== Math.max(0, facility.contractedPowerWatts - deliveredTotal),
    "facility.power.headroomWatts",
    "does not match contracted capacity and delivery",
  );
  try {
    const expectedEnergyCost = calculateEnergyCostUsd(
      deliveredTotal,
      0.1,
      state.economy.energyPriceUsdPerKwh,
    );
    pushIf(
      issues,
      power.energyCostUsdThisTick !== expectedEnergyCost,
      "facility.power.energyCostUsdThisTick",
      "does not match Task 4 energy calculation",
    );
  } catch {
    issues.push({
      path: "facility.power.energyCostUsdThisTick",
      message: "cannot be validated from finite economy inputs",
    });
  }
  return issues;
}

export function assertValidPowerState(
  state: Readonly<GameState>,
  content: ContentBundle,
  calculationInputModules?: Readonly<Record<string, ModuleInstanceState>>,
): void {
  const issues = validatePowerState(state, content, calculationInputModules);
  if (issues.length > 0) {
    throw new Error(
      `Invalid power state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

export function assertValidStoredPowerState(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  assertValidPowerState(state, content);
}
