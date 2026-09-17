import type { ContentBundle } from "../content/schemas/contentSchemas.ts";
import { deepFreeze } from "../content/loader/deepFreeze.ts";
import { assertSafeExternalData, cloneOwnedExternalData } from "./inputSafety.ts";
import { PersistenceError } from "./persistenceErrors.ts";
import { HASH_16_PATTERN } from "./persistenceLimits.ts";
import { assertValidInventoryEconomyState } from "../sim/economy/inventoryEconomyState.ts";
import {
  assertValidDesignModeState,
  parseDesignDraftOperation,
} from "../sim/design/designModeState.ts";
import { assertValidStoredComputeState } from "../sim/compute/computeState.ts";
import { assertValidStoredTaskState } from "../sim/tasks/taskState.ts";
import { assertValidStoredResearchState } from "../sim/research/researchState.ts";
import { assertValidStoredBenchmarkState } from "../sim/benchmarks/benchmarkState.ts";
import { assertValidBlueprintState } from "../sim/blueprints/blueprintState.ts";
import { assertCanonicalSerializable, hashCanonicalState } from "../sim/replay/canonicalState.ts";
import { createProductionSimCore } from "../sim/core/productionSimCore.ts";
import type { GameState } from "../sim/core/types.ts";

type UnknownRecord = Record<string, unknown>;

function invalid(path: string, message: string): never {
  throw new PersistenceError("INVALID_STATE", `${path}: ${message}`, path);
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) invalid(path, "must be a plain object");
  return value;
}

function exact(value: unknown, keys: readonly string[], path: string): UnknownRecord {
  const source = record(value, path);
  const actual = Object.keys(source).toSorted();
  const expected = [...keys].toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(path, "contains an unexpected key set");
  }
  return source;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(path, "must be a nonempty string");
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "must be boolean");
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "must be finite");
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)) {
    invalid(path, "must be a safe integer other than negative zero");
  }
  return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
  const parsed = integer(value, path);
  if (parsed < 0) invalid(path, "must be nonnegative");
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonnegativeInteger(value, path);
  if (parsed === 0) invalid(path, "must be positive");
  return parsed;
}

function nullable(
  value: unknown,
  path: string,
  check: (value: unknown, path: string) => void,
): void {
  if (value !== null) check(value, path);
}

function point(value: unknown, path: string): void {
  const source = exact(value, ["x", "y"], path);
  integer(source["x"], `${path}.x`);
  integer(source["y"], `${path}.y`);
}

function rotation(value: unknown, path: string): void {
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270)
    invalid(path, "invalid rotation");
}

function overclock(value: unknown, path: string): void {
  const source = exact(value, ["profile", "frequencyRatio", "voltageRatio"], path);
  if (!(["eco", "balanced", "boost", "manual"] as readonly unknown[]).includes(source["profile"])) {
    invalid(`${path}.profile`, "invalid profile");
  }
  finite(source["frequencyRatio"], `${path}.frequencyRatio`);
  finite(source["voltageRatio"], `${path}.voltageRatio`);
}

function moduleState(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "id",
      "definitionId",
      "position",
      "rotation",
      "operationalState",
      "overclock",
      "binComputeRatio",
      "binEfficiencyRatio",
      "binThermalRatio",
      "binStabilityRatio",
      "startupTicksRemaining",
      "cooldownTicksRemaining",
    ],
    path,
  );
  string(source["id"], `${path}.id`);
  string(source["definitionId"], `${path}.definitionId`);
  point(source["position"], `${path}.position`);
  rotation(source["rotation"], `${path}.rotation`);
  if (
    !(["offline", "starting", "online", "brownout", "shutdown"] as readonly unknown[]).includes(
      source["operationalState"],
    )
  ) {
    invalid(`${path}.operationalState`, "invalid operational state");
  }
  overclock(source["overclock"], `${path}.overclock`);
  for (const field of [
    "binComputeRatio",
    "binEfficiencyRatio",
    "binThermalRatio",
    "binStabilityRatio",
  ] as const) {
    finite(source[field], `${path}.${field}`);
  }
  nonnegativeInteger(source["startupTicksRemaining"], `${path}.startupTicksRemaining`);
  nonnegativeInteger(source["cooldownTicksRemaining"], `${path}.cooldownTicksRemaining`);
}

function routeState(value: unknown, path: string): void {
  const source = exact(
    value,
    ["id", "kind", "from", "to", "path", "capacityPerSecond", "congestionRatio"],
    path,
  );
  string(source["id"], `${path}.id`);
  if (source["kind"] !== "power" && source["kind"] !== "data")
    invalid(`${path}.kind`, "invalid route kind");
  for (const endpoint of ["from", "to"] as const) {
    const ref = exact(source[endpoint], ["moduleInstanceId", "portId"], `${path}.${endpoint}`);
    string(ref["moduleInstanceId"], `${path}.${endpoint}.moduleInstanceId`);
    string(ref["portId"], `${path}.${endpoint}.portId`);
  }
  for (const [index, value] of array(source["path"], `${path}.path`).entries())
    point(value, `${path}.path[${index}]`);
  finite(source["capacityPerSecond"], `${path}.capacityPerSecond`);
  finite(source["congestionRatio"], `${path}.congestionRatio`);
}

function mapOf(value: unknown, path: string, check: (value: unknown, path: string) => void): void {
  const source = record(value, path);
  for (const [key, entry] of Object.entries(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      invalid(`${path}.${key}`, "reserved key");
    check(entry, `${path}.${key}`);
  }
}

function moduleMap(value: unknown, path: string): void {
  mapOf(value, path, moduleState);
}
function routeMap(value: unknown, path: string): void {
  mapOf(value, path, routeState);
}

function thermalTile(value: unknown, path: string): void {
  const source = exact(value, ["position", "temperatureC"], path);
  point(source["position"], `${path}.position`);
  finite(source["temperatureC"], `${path}.temperatureC`);
}

function powerState(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "layoutRevision",
      "totalRequestedPowerWatts",
      "totalDeliveredPowerWatts",
      "headroomWatts",
      "energyCostUsdThisTick",
      "byModule",
      "byRoute",
    ],
    path,
  );
  nullable(source["layoutRevision"], `${path}.layoutRevision`, nonnegativeInteger);
  for (const field of [
    "totalRequestedPowerWatts",
    "totalDeliveredPowerWatts",
    "headroomWatts",
    "energyCostUsdThisTick",
  ] as const)
    finite(source[field], `${path}.${field}`);
  mapOf(source["byModule"], `${path}.byModule`, (entry, entryPath) => {
    const item = exact(
      entry,
      [
        "moduleInstanceId",
        "requestedPowerWatts",
        "minimumPowerWatts",
        "deliveredPowerWatts",
        "powerFactor",
        "limitingReason",
      ],
      entryPath,
    );
    string(item["moduleInstanceId"], `${entryPath}.moduleInstanceId`);
    for (const field of [
      "requestedPowerWatts",
      "minimumPowerWatts",
      "deliveredPowerWatts",
      "powerFactor",
    ] as const)
      finite(item[field], `${entryPath}.${field}`);
    if (
      !(
        [
          "none",
          "shutdown",
          "missing-route",
          "source-unavailable",
          "contracted-capacity",
          "route-capacity",
        ] as readonly unknown[]
      ).includes(item["limitingReason"])
    )
      invalid(`${entryPath}.limitingReason`, "invalid limiting reason");
  });
  mapOf(source["byRoute"], `${path}.byRoute`, (entry, entryPath) => {
    const item = exact(entry, ["routeId", "deliveredPowerWatts", "utilizationRatio"], entryPath);
    string(item["routeId"], `${entryPath}.routeId`);
    finite(item["deliveredPowerWatts"], `${entryPath}.deliveredPowerWatts`);
    finite(item["utilizationRatio"], `${entryPath}.utilizationRatio`);
  });
}

function overclockState(value: unknown, path: string): void {
  const source = exact(value, ["layoutRevision", "thermalRevision", "byModule"], path);
  nullable(source["layoutRevision"], `${path}.layoutRevision`, nonnegativeInteger);
  nullable(source["thermalRevision"], `${path}.thermalRevision`, nonnegativeInteger);
  mapOf(source["byModule"], `${path}.byModule`, (entry, entryPath) => {
    const item = exact(
      entry,
      [
        "moduleInstanceId",
        "profile",
        "requestedFrequencyRatio",
        "requestedVoltageRatio",
        "dynamicPowerFactor",
        "sampledTemperatureC",
        "thermalFactor",
        "retryRate",
        "invalidSampleRate",
        "stabilityFactor",
        "shutdownReason",
      ],
      entryPath,
    );
    string(item["moduleInstanceId"], `${entryPath}.moduleInstanceId`);
    if (!(["eco", "balanced", "boost", "manual"] as readonly unknown[]).includes(item["profile"]))
      invalid(`${entryPath}.profile`, "invalid profile");
    for (const field of [
      "requestedFrequencyRatio",
      "requestedVoltageRatio",
      "dynamicPowerFactor",
      "sampledTemperatureC",
      "thermalFactor",
      "retryRate",
      "invalidSampleRate",
      "stabilityFactor",
    ] as const)
      finite(item[field], `${entryPath}.${field}`);
    nullable(item["shutdownReason"], `${entryPath}.shutdownReason`, (inner, innerPath) => {
      if (inner !== "thermal") invalid(innerPath, "invalid shutdown reason");
    });
  });
}

function breakdown(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "theoreticalComputeFlops",
      "researchFactor",
      "powerFactor",
      "thermalFactor",
      "memoryFactor",
      "interconnectFactor",
      "suitabilityFactor",
      "stabilityFactor",
      "usefulComputeFlops",
      "bottlenecks",
    ],
    path,
  );
  for (const field of [
    "theoreticalComputeFlops",
    "researchFactor",
    "powerFactor",
    "thermalFactor",
    "memoryFactor",
    "interconnectFactor",
    "suitabilityFactor",
    "stabilityFactor",
    "usefulComputeFlops",
  ] as const)
    finite(source[field], `${path}.${field}`);
  for (const [index, entry] of array(source["bottlenecks"], `${path}.bottlenecks`).entries()) {
    const item = exact(
      entry,
      ["factor", "factorValue", "lostComputeFlops", "explanationKey"],
      `${path}.bottlenecks[${index}]`,
    );
    if (
      !(
        [
          "research",
          "power",
          "thermal",
          "memory",
          "interconnect",
          "suitability",
          "stability",
        ] as readonly unknown[]
      ).includes(item["factor"])
    )
      invalid(`${path}.bottlenecks[${index}].factor`, "invalid factor");
    finite(item["factorValue"], `${path}.bottlenecks[${index}].factorValue`);
    finite(item["lostComputeFlops"], `${path}.bottlenecks[${index}].lostComputeFlops`);
    string(item["explanationKey"], `${path}.bottlenecks[${index}].explanationKey`);
  }
}

function computeState(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "layoutRevision",
      "thermalRevision",
      "byModule",
      "byTask",
      "research",
      "totalTheoreticalComputeFlops",
      "totalAvailableComputeFlops",
      "totalAllocatedUsefulComputeFlops",
    ],
    path,
  );
  nullable(source["layoutRevision"], `${path}.layoutRevision`, nonnegativeInteger);
  nullable(source["thermalRevision"], `${path}.thermalRevision`, nonnegativeInteger);
  mapOf(source["byModule"], `${path}.byModule`, (entry, entryPath) => {
    const item = exact(
      entry,
      [
        "moduleInstanceId",
        "requestedFrequencyRatio",
        "operationalRatio",
        "theoreticalComputeFlops",
        "powerFactor",
        "thermalFactor",
        "retryRate",
        "invalidSampleRate",
        "stabilityFactor",
        "availableComputeFlops",
      ],
      entryPath,
    );
    string(item["moduleInstanceId"], `${entryPath}.moduleInstanceId`);
    for (const field of [
      "requestedFrequencyRatio",
      "operationalRatio",
      "theoreticalComputeFlops",
      "powerFactor",
      "thermalFactor",
      "retryRate",
      "invalidSampleRate",
      "stabilityFactor",
      "availableComputeFlops",
    ] as const)
      finite(item[field], `${entryPath}.${field}`);
  });
  mapOf(source["byTask"], `${path}.byTask`, (entry, entryPath) => {
    const item = exact(
      entry,
      [
        "taskInstanceId",
        "taskDefinitionId",
        "phaseIndex",
        "phaseId",
        "clusterModuleIds",
        "requestedShare",
        "availableMemoryCapacityBytes",
        "availableMemoryBandwidthBytesPerSecond",
        "deliveredRouteBandwidthBytesPerSecond",
        "extraLatencyMicroseconds",
        "retryRate",
        "invalidSampleRate",
        "meetsStabilityMinimum",
        "runnable",
        "blockingReasons",
        "warnings",
        "breakdown",
      ],
      entryPath,
    );
    string(item["taskInstanceId"], `${entryPath}.taskInstanceId`);
    string(item["taskDefinitionId"], `${entryPath}.taskDefinitionId`);
    nonnegativeInteger(item["phaseIndex"], `${entryPath}.phaseIndex`);
    string(item["phaseId"], `${entryPath}.phaseId`);
    for (const id of array(item["clusterModuleIds"], `${entryPath}.clusterModuleIds`))
      string(id, `${entryPath}.clusterModuleIds`);
    for (const field of [
      "requestedShare",
      "availableMemoryCapacityBytes",
      "availableMemoryBandwidthBytesPerSecond",
      "deliveredRouteBandwidthBytesPerSecond",
      "extraLatencyMicroseconds",
      "retryRate",
      "invalidSampleRate",
    ] as const)
      finite(item[field], `${entryPath}.${field}`);
    boolean(item["meetsStabilityMinimum"], `${entryPath}.meetsStabilityMinimum`);
    boolean(item["runnable"], `${entryPath}.runnable`);
    for (const reason of array(item["blockingReasons"], `${entryPath}.blockingReasons`))
      if (
        !(
          [
            "no-active-compute",
            "insufficient-memory-capacity",
            "data-disconnected",
          ] as readonly unknown[]
        ).includes(reason)
      )
        invalid(`${entryPath}.blockingReasons`, "invalid reason");
    for (const warning of array(item["warnings"], `${entryPath}.warnings`))
      if (warning !== "stability-below-minimum")
        invalid(`${entryPath}.warnings`, "invalid warning");
    breakdown(item["breakdown"], `${entryPath}.breakdown`);
  });
  nullable(source["research"], `${path}.research`, (entry, entryPath) => {
    const item = exact(
      entry,
      [
        "nodeId",
        "reservedComputeShare",
        "facilityAvailableComputeFlops",
        "deliveredUsefulComputeFlops",
      ],
      entryPath,
    );
    string(item["nodeId"], `${entryPath}.nodeId`);
    for (const field of [
      "reservedComputeShare",
      "facilityAvailableComputeFlops",
      "deliveredUsefulComputeFlops",
    ] as const)
      finite(item[field], `${entryPath}.${field}`);
  });
  for (const field of [
    "totalTheoreticalComputeFlops",
    "totalAvailableComputeFlops",
    "totalAllocatedUsefulComputeFlops",
  ] as const)
    finite(source[field], `${path}.${field}`);
}

function designDraft(value: unknown, path: string): void {
  if (value === null) return;
  const source = exact(value, ["revision", "modules", "routes", "undoStack", "redoStack"], path);
  nonnegativeInteger(source["revision"], `${path}.revision`);
  moduleMap(source["modules"], `${path}.modules`);
  routeMap(source["routes"], `${path}.routes`);
  for (const stackName of ["undoStack", "redoStack"] as const) {
    for (const [index, operation] of array(source[stackName], `${path}.${stackName}`).entries()) {
      try {
        parseDesignDraftOperation(operation);
      } catch (error: unknown) {
        invalid(
          `${path}.${stackName}[${index}]`,
          error instanceof Error ? error.message : "invalid operation",
        );
      }
    }
  }
}

function facility(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "id",
      "name",
      "size",
      "ambientTemperatureC",
      "extractionCapacityWatts",
      "contractedPowerWatts",
      "modules",
      "routes",
      "nextModuleInstanceSequence",
      "nextRouteSequence",
      "thermalTiles",
      "liveLayoutRevision",
      "thermalRevision",
      "designDraft",
      "power",
      "overclock",
      "compute",
    ],
    path,
  );
  if (source["id"] !== "facility-alpha") invalid(`${path}.id`, "invalid facility id");
  string(source["name"], `${path}.name`);
  const size = exact(source["size"], ["width", "height"], `${path}.size`);
  positiveInteger(size["width"], `${path}.size.width`);
  positiveInteger(size["height"], `${path}.size.height`);
  for (const field of [
    "ambientTemperatureC",
    "extractionCapacityWatts",
    "contractedPowerWatts",
  ] as const)
    finite(source[field], `${path}.${field}`);
  moduleMap(source["modules"], `${path}.modules`);
  routeMap(source["routes"], `${path}.routes`);
  positiveInteger(source["nextModuleInstanceSequence"], `${path}.nextModuleInstanceSequence`);
  positiveInteger(source["nextRouteSequence"], `${path}.nextRouteSequence`);
  for (const [index, tile] of array(source["thermalTiles"], `${path}.thermalTiles`).entries())
    thermalTile(tile, `${path}.thermalTiles[${index}]`);
  nonnegativeInteger(source["liveLayoutRevision"], `${path}.liveLayoutRevision`);
  nonnegativeInteger(source["thermalRevision"], `${path}.thermalRevision`);
  designDraft(source["designDraft"], `${path}.designDraft`);
  powerState(source["power"], `${path}.power`);
  overclockState(source["overclock"], `${path}.overclock`);
  computeState(source["compute"], `${path}.compute`);
}

function inventory(value: unknown, path: string): void {
  const source = exact(value, ["stacks"], path);
  mapOf(source["stacks"], `${path}.stacks`, (entry, entryPath) => {
    const item = exact(entry, ["definitionId", "quantity", "averageAcquisitionCostUsd"], entryPath);
    string(item["definitionId"], `${entryPath}.definitionId`);
    positiveInteger(item["quantity"], `${entryPath}.quantity`);
    finite(item["averageAcquisitionCostUsd"], `${entryPath}.averageAcquisitionCostUsd`);
  });
}

function tasks(value: unknown, path: string): void {
  const source = exact(
    value,
    ["activeSlotCount", "nextTaskInstanceSequence", "offers", "instances"],
    path,
  );
  positiveInteger(source["activeSlotCount"], `${path}.activeSlotCount`);
  positiveInteger(source["nextTaskInstanceSequence"], `${path}.nextTaskInstanceSequence`);
  for (const [index, offer] of array(source["offers"], `${path}.offers`).entries())
    string(offer, `${path}.offers[${index}]`);
  mapOf(source["instances"], `${path}.instances`, (entry, entryPath) => {
    const item = exact(
      entry,
      [
        "id",
        "definitionId",
        "status",
        "acceptedAtTick",
        "deadlineTick",
        "currentPhaseIndex",
        "phaseCompletedOperations",
        "totalCompletedOperations",
        "allocation",
        "accruedPayoutUsd",
        "serviceWindowCompliant",
      ],
      entryPath,
    );
    string(item["id"], `${entryPath}.id`);
    string(item["definitionId"], `${entryPath}.definitionId`);
    if (
      !(
        [
          "offered",
          "accepted",
          "active",
          "hold",
          "completed",
          "failed",
          "abandoned",
        ] as readonly unknown[]
      ).includes(item["status"])
    )
      invalid(`${entryPath}.status`, "invalid task status");
    nullable(item["acceptedAtTick"], `${entryPath}.acceptedAtTick`, nonnegativeInteger);
    nullable(item["deadlineTick"], `${entryPath}.deadlineTick`, nonnegativeInteger);
    nonnegativeInteger(item["currentPhaseIndex"], `${entryPath}.currentPhaseIndex`);
    nonnegativeInteger(item["phaseCompletedOperations"], `${entryPath}.phaseCompletedOperations`);
    nonnegativeInteger(item["totalCompletedOperations"], `${entryPath}.totalCompletedOperations`);
    finite(item["accruedPayoutUsd"], `${entryPath}.accruedPayoutUsd`);
    nullable(item["serviceWindowCompliant"], `${entryPath}.serviceWindowCompliant`, boolean);
    nullable(item["allocation"], `${entryPath}.allocation`, (allocation, allocationPath) => {
      const a = exact(
        allocation,
        ["clusterModuleIds", "requestedShare", "deliveredUsefulComputeFlops"],
        allocationPath,
      );
      for (const id of array(a["clusterModuleIds"], `${allocationPath}.clusterModuleIds`))
        string(id, `${allocationPath}.clusterModuleIds`);
      finite(a["requestedShare"], `${allocationPath}.requestedShare`);
      finite(a["deliveredUsefulComputeFlops"], `${allocationPath}.deliveredUsefulComputeFlops`);
    });
  });
}

function research(value: unknown, path: string): void {
  const source = exact(value, ["researchData", "statuses", "active", "evidenceTags"], path);
  finite(source["researchData"], `${path}.researchData`);
  mapOf(source["statuses"], `${path}.statuses`, (entry, entryPath) => {
    if (
      !(["locked", "available", "active", "completed", "cancelled"] as readonly unknown[]).includes(
        entry,
      )
    )
      invalid(entryPath, "invalid research status");
  });
  nullable(source["active"], `${path}.active`, (entry, entryPath) => {
    const a = exact(
      entry,
      ["nodeId", "startedAtTick", "completedOperations", "reservedComputeShare"],
      entryPath,
    );
    string(a["nodeId"], `${entryPath}.nodeId`);
    nonnegativeInteger(a["startedAtTick"], `${entryPath}.startedAtTick`);
    finite(a["completedOperations"], `${entryPath}.completedOperations`);
    finite(a["reservedComputeShare"], `${entryPath}.reservedComputeShare`);
  });
  for (const id of array(source["evidenceTags"], `${path}.evidenceTags`))
    string(id, `${path}.evidenceTags`);
}

function benchmarks(value: unknown, path: string): void {
  const source = exact(
    value,
    ["nextBenchmarkRunSequence", "active", "history", "bestRunByBenchmark"],
    path,
  );
  positiveInteger(source["nextBenchmarkRunSequence"], `${path}.nextBenchmarkRunSequence`);
  nullable(source["active"], `${path}.active`, (entry, entryPath) => {
    benchmarkActive(entry, entryPath);
  });
  for (const [index, entry] of array(source["history"], `${path}.history`).entries())
    benchmarkResult(entry, `${path}.history[${index}]`);
  mapOf(source["bestRunByBenchmark"], `${path}.bestRunByBenchmark`, (entry, entryPath) =>
    string(entry, entryPath),
  );
}

function benchmarkCommon(value: unknown, path: string): UnknownRecord {
  const source = record(value, path);
  string(source["runId"], `${path}.runId`);
  string(source["benchmarkId"], `${path}.benchmarkId`);
  for (const id of array(source["clusterModuleIds"], `${path}.clusterModuleIds`))
    string(id, `${path}.clusterModuleIds`);
  nonnegativeInteger(source["startedAtTick"], `${path}.startedAtTick`);
  return source;
}

function benchmarkResult(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "runId",
      "benchmarkId",
      "clusterModuleIds",
      "passed",
      "startedAtTick",
      "durationTicks",
      "averageUsefulComputeFlops",
      "peakUsefulComputeFlops",
      "peakPowerWatts",
      "averagePowerWatts",
      "maxTemperatureC",
      "minimumPowerHeadroomWatts",
      "retryRate",
      "validSampleRate",
      "costUsd",
      "shutdownObserved",
      "failureReasons",
      "overclockSummary",
    ],
    path,
  );
  benchmarkCommon(source, path);
  boolean(source["passed"], `${path}.passed`);
  nonnegativeInteger(source["durationTicks"], `${path}.durationTicks`);
  for (const field of [
    "averageUsefulComputeFlops",
    "peakUsefulComputeFlops",
    "peakPowerWatts",
    "averagePowerWatts",
    "maxTemperatureC",
    "minimumPowerHeadroomWatts",
    "retryRate",
    "validSampleRate",
    "costUsd",
  ] as const)
    finite(source[field], `${path}.${field}`);
  boolean(source["shutdownObserved"], `${path}.shutdownObserved`);
  for (const reason of array(source["failureReasons"], `${path}.failureReasons`))
    if (
      !(
        [
          "average-compute",
          "valid-sample-rate",
          "retry-rate",
          "maximum-temperature",
          "shutdown",
        ] as readonly unknown[]
      ).includes(reason)
    )
      invalid(`${path}.failureReasons`, "invalid failure reason");
  mapOf(source["overclockSummary"], `${path}.overclockSummary`, overclock);
}

function benchmarkActive(value: unknown, path: string): void {
  const source = exact(
    value,
    [
      "runId",
      "benchmarkId",
      "startedAtTick",
      "elapsedTicks",
      "clusterModuleIds",
      "accumulatedUsefulComputeFlops",
      "peakUsefulComputeFlops",
      "accumulatedPowerWatts",
      "peakPowerWatts",
      "maxTemperatureC",
      "minimumPowerHeadroomWatts",
      "accumulatedRetryRate",
      "accumulatedValidSampleRate",
      "accumulatedCostUsd",
      "shutdownObserved",
      "overclockSummary",
    ],
    path,
  );
  benchmarkCommon(source, path);
  nonnegativeInteger(source["elapsedTicks"], `${path}.elapsedTicks`);
  for (const field of [
    "accumulatedUsefulComputeFlops",
    "peakUsefulComputeFlops",
    "accumulatedPowerWatts",
    "peakPowerWatts",
    "accumulatedRetryRate",
    "accumulatedValidSampleRate",
    "accumulatedCostUsd",
  ] as const)
    finite(source[field], `${path}.${field}`);
  nullable(source["maxTemperatureC"], `${path}.maxTemperatureC`, finite);
  nullable(source["minimumPowerHeadroomWatts"], `${path}.minimumPowerHeadroomWatts`, finite);
  boolean(source["shutdownObserved"], `${path}.shutdownObserved`);
  mapOf(source["overclockSummary"], `${path}.overclockSummary`, overclock);
}

function blueprints(value: unknown, path: string): void {
  record(value, path);
}

function tutorial(value: unknown, path: string): void {
  const source = exact(
    value,
    ["guidanceMode", "currentStepId", "completedStepIds", "skipped"],
    path,
  );
  if (!(["simple", "engineering", "skip"] as readonly unknown[]).includes(source["guidanceMode"]))
    invalid(`${path}.guidanceMode`, "invalid guidance mode");
  nullable(source["currentStepId"], `${path}.currentStepId`, string);
  for (const id of array(source["completedStepIds"], `${path}.completedStepIds`))
    string(id, `${path}.completedStepIds`);
  boolean(source["skipped"], `${path}.skipped`);
}

function museum(value: unknown, path: string): void {
  const source = exact(value, ["snapshots"], path);
  for (const [index, entry] of array(source["snapshots"], `${path}.snapshots`).entries()) {
    const item = exact(
      entry,
      [
        "id",
        "createdAtTick",
        "systemName",
        "architectureId",
        "year",
        "moduleCount",
        "theoreticalComputeFlops",
        "usefulComputeFlops",
        "averagePowerWatts",
        "peakPowerWatts",
        "averageTemperatureC",
        "maxTemperatureC",
        "totalCostUsd",
        "benchmarkRunIds",
        "completedResearchIds",
      ],
      `${path}.snapshots[${index}]`,
    );
    string(item["id"], `${path}.snapshots[${index}].id`);
    nonnegativeInteger(item["createdAtTick"], `${path}.snapshots[${index}].createdAtTick`);
    string(item["systemName"], `${path}.snapshots[${index}].systemName`);
    if (item["architectureId"] !== "vacuum-tube")
      invalid(`${path}.snapshots[${index}].architectureId`, "invalid architecture");
    nonnegativeInteger(item["year"], `${path}.snapshots[${index}].year`);
    nonnegativeInteger(item["moduleCount"], `${path}.snapshots[${index}].moduleCount`);
    for (const field of [
      "theoreticalComputeFlops",
      "usefulComputeFlops",
      "averagePowerWatts",
      "peakPowerWatts",
      "averageTemperatureC",
      "maxTemperatureC",
      "totalCostUsd",
    ] as const)
      finite(item[field], `${path}.snapshots[${index}].${field}`);
    for (const id of array(item["benchmarkRunIds"], `${path}.snapshots[${index}].benchmarkRunIds`))
      string(id, `${path}.snapshots[${index}].benchmarkRunIds`);
    for (const id of array(
      item["completedResearchIds"],
      `${path}.snapshots[${index}].completedResearchIds`,
    ))
      string(id, `${path}.snapshots[${index}].completedResearchIds`);
  }
}

function achievements(value: unknown, path: string): void {
  const source = exact(value, ["unlockedIds", "unlockedAtTick"], path);
  for (const id of array(source["unlockedIds"], `${path}.unlockedIds`))
    string(id, `${path}.unlockedIds`);
  mapOf(source["unlockedAtTick"], `${path}.unlockedAtTick`, nonnegativeInteger);
}

export function assertStructurallyAdmissibleGameState(value: unknown): asserts value is GameState {
  assertSafeExternalData(value);
  const root = exact(
    value,
    [
      "saveVersion",
      "contentVersion",
      "seed",
      "tick",
      "rngState",
      "clock",
      "campaign",
      "economy",
      "facility",
      "inventory",
      "tasks",
      "research",
      "benchmarks",
      "blueprints",
      "tutorial",
      "museum",
      "achievements",
    ],
    "gameState",
  );
  if (root["saveVersion"] !== 1) invalid("gameState.saveVersion", "unsupported save version");
  string(root["contentVersion"], "gameState.contentVersion");
  string(root["seed"], "gameState.seed");
  nonnegativeInteger(root["tick"], "gameState.tick");
  nonnegativeInteger(root["rngState"], "gameState.rngState");
  const clock = exact(root["clock"], ["paused", "speed", "simulatedSeconds"], "gameState.clock");
  boolean(clock["paused"], "gameState.clock.paused");
  if (!([1, 2, 4] as readonly unknown[]).includes(clock["speed"]))
    invalid("gameState.clock.speed", "invalid speed");
  finite(clock["simulatedSeconds"], "gameState.clock.simulatedSeconds");
  const campaign = exact(
    root["campaign"],
    [
      "eraId",
      "currentYear",
      "objectiveKey",
      "transistorRevealed",
      "verticalSliceCompleted",
      "reputation",
    ],
    "gameState.campaign",
  );
  string(campaign["eraId"], "gameState.campaign.eraId");
  nonnegativeInteger(campaign["currentYear"], "gameState.campaign.currentYear");
  string(campaign["objectiveKey"], "gameState.campaign.objectiveKey");
  boolean(campaign["transistorRevealed"], "gameState.campaign.transistorRevealed");
  boolean(campaign["verticalSliceCompleted"], "gameState.campaign.verticalSliceCompleted");
  finite(campaign["reputation"], "gameState.campaign.reputation");
  const economy = exact(
    root["economy"],
    [
      "cashUsd",
      "creditLimitUsd",
      "energyPriceUsdPerKwh",
      "lastTickIncomeUsd",
      "lastTickExpenseUsd",
      "totalIncomeUsd",
      "totalExpenseUsd",
    ],
    "gameState.economy",
  );
  for (const field of [
    "cashUsd",
    "creditLimitUsd",
    "energyPriceUsdPerKwh",
    "lastTickIncomeUsd",
    "lastTickExpenseUsd",
    "totalIncomeUsd",
    "totalExpenseUsd",
  ] as const)
    finite(economy[field], `gameState.economy.${field}`);
  facility(root["facility"], "gameState.facility");
  inventory(root["inventory"], "gameState.inventory");
  tasks(root["tasks"], "gameState.tasks");
  research(root["research"], "gameState.research");
  benchmarks(root["benchmarks"], "gameState.benchmarks");
  blueprints(root["blueprints"], "gameState.blueprints");
  tutorial(root["tutorial"], "gameState.tutorial");
  museum(root["museum"], "gameState.museum");
  achievements(root["achievements"], "gameState.achievements");
}

export interface GameStateAdmissionOptions {
  readonly state: unknown;
  readonly content: ContentBundle;
  readonly nextQueueSequence: number;
  readonly expectedStateHash?: string;
}

export function admitGameStateForSave(options: GameStateAdmissionOptions): GameState {
  if (
    !Number.isSafeInteger(options.nextQueueSequence) ||
    options.nextQueueSequence < 0 ||
    Object.is(options.nextQueueSequence, -0)
  )
    throw new PersistenceError(
      "INVALID_STATE",
      "nextQueueSequence must be a nonnegative safe integer.",
    );
  if (options.expectedStateHash !== undefined && !HASH_16_PATTERN.test(options.expectedStateHash))
    throw new PersistenceError(
      "INVALID_STATE",
      "expectedStateHash must be a canonical state hash.",
    );
  assertStructurallyAdmissibleGameState(options.state);
  const owned = cloneOwnedExternalData(options.state);
  assertStructurallyAdmissibleGameState(owned);
  if (owned.contentVersion !== options.content.contentVersion)
    throw new PersistenceError(
      "INCOMPATIBLE_CONTENT",
      "GameState contentVersion does not match validated content.",
    );
  assertValidInventoryEconomyState(owned);
  assertValidDesignModeState(owned);
  assertValidStoredComputeState(owned);
  assertValidStoredTaskState(owned);
  assertValidStoredResearchState(owned);
  assertValidStoredBenchmarkState(owned);
  assertValidBlueprintState(owned.blueprints);
  assertCanonicalSerializable(owned);
  if (
    options.expectedStateHash !== undefined &&
    hashCanonicalState(owned) !== options.expectedStateHash
  )
    throw new PersistenceError(
      "CHECKSUM_MISMATCH",
      "GameState hash does not match execution metadata.",
    );
  try {
    const core = createProductionSimCore({
      content: options.content,
      initialState: owned,
      initialCommandQueueSequence: options.nextQueueSequence,
    });
    const admitted = core.getStateForSave();
    if (hashCanonicalState(admitted) !== hashCanonicalState(owned))
      throw new Error("Production admission changed the state.");
    return deepFreeze(admitted) as GameState;
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError(
      "INVALID_STATE",
      error instanceof Error ? error.message : "GameState admission failed.",
    );
  }
}
