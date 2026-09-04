import { cpus, release } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createBlueprintCommandHandlers } from "../../src/sim/blueprints/blueprintCommands.ts";
import {
  calculateCanonicalBlueprintSummary,
  captureCanonicalBlueprintPayload,
} from "../../src/sim/blueprints/blueprintCapture.ts";
import { planBlueprintMaterialization } from "../../src/sim/blueprints/blueprintMaterialization.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type {
  BlueprintRecord,
  GameState,
  GridPoint,
  ModuleInstanceState,
  PortRef,
  Rotation,
  RouteState,
} from "../../src/sim/core/types.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";
import {
  enumerateOccupiedTiles,
  resolveRotatedFootprintSize,
} from "../../src/grid/domain/footprintGeometry.ts";
import {
  resolveManualRouteEndpoints,
  validateManualRoutePath,
} from "../../src/sim/routing/manualRouting.ts";
import type { TickSystemRegistry } from "../../src/sim/core/tickSystems.ts";
import { createComputeTickSystems } from "../../src/sim/compute/facilityCompute.ts";
import { createOverclockTickSystems } from "../../src/sim/overclock/facilityOverclock.ts";
import { createPowerTickSystems } from "../../src/sim/power/facilityPower.ts";
import { createResearchTickSystems } from "../../src/sim/research/facilityResearch.ts";
import { createTaskTickSystems } from "../../src/sim/tasks/facilityTasks.ts";
import { createThermalTickSystems } from "../../src/sim/thermal/facilityThermal.ts";

const content = loadContentBundle();
const WIDTH = 24;
const HEIGHT = 16;
const PURE_WARMUPS = 100;
const PURE_SAMPLES = 1_000;
const COMMAND_WARMUPS = 20;
const COMMAND_SAMPLES = 200;
const TICK_WARMUPS = 100;
const TICK_SAMPLES = 200;
const BLUEPRINT_RECORD_COUNT = 128;
const LOGIC = "module-vacuum-tube-logic";
const ARITHMETIC = "module-arithmetic-unit";
const POWER = "module-power-distribution";
const RELAY = "module-data-relay";
const CONTROL = "module-control-unit";
const ACCUMULATOR = "module-accumulator-register";
const DELAY = "module-delay-line-memory";
const PUNCH = "module-punch-card-reader";
const PAPER = "module-paper-tape-reader";
const PRINTER = "module-line-printer";
const AIR_MOVER = "module-air-mover";
const ROOM_COOLING = "module-room-cooling";

interface MeasurementSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

interface ModulePlan {
  readonly id: string;
  readonly definitionId: string;
  readonly position: GridPoint;
  readonly rotation: Rotation;
  readonly operationalState: ModuleInstanceState["operationalState"];
  readonly overclock: ModuleInstanceState["overclock"];
}

const MODULE_PLANS: readonly ModulePlan[] = [
  {
    id: "facility-module-01",
    definitionId: POWER,
    position: { x: 0, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-02",
    definitionId: LOGIC,
    position: { x: 4, y: 0 },
    rotation: 0,
    operationalState: "starting",
    overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
  },
  {
    id: "facility-module-03",
    definitionId: ARITHMETIC,
    position: { x: 8, y: 0 },
    rotation: 90,
    operationalState: "brownout",
    overclock: { profile: "manual", frequencyRatio: 1.32, voltageRatio: 1.08 },
  },
  {
    id: "facility-module-04",
    definitionId: RELAY,
    position: { x: 11, y: 0 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-05",
    definitionId: ACCUMULATOR,
    position: { x: 0, y: 3 },
    rotation: 90,
    operationalState: "shutdown",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-06",
    definitionId: DELAY,
    position: { x: 4, y: 3 },
    rotation: 90,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-07",
    definitionId: PUNCH,
    position: { x: 7, y: 3 },
    rotation: 180,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-08",
    definitionId: PAPER,
    position: { x: 10, y: 3 },
    rotation: 90,
    operationalState: "offline",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-09",
    definitionId: PRINTER,
    position: { x: 0, y: 7 },
    rotation: 270,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-10",
    definitionId: AIR_MOVER,
    position: { x: 4, y: 7 },
    rotation: 180,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-11",
    definitionId: ROOM_COOLING,
    position: { x: 7, y: 7 },
    rotation: 90,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-12",
    definitionId: LOGIC,
    position: { x: 10, y: 7 },
    rotation: 270,
    operationalState: "starting",
    overclock: { profile: "eco", frequencyRatio: 0.8, voltageRatio: 0.9 },
  },
  {
    id: "facility-module-13",
    definitionId: ARITHMETIC,
    position: { x: 0, y: 11 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-14",
    definitionId: RELAY,
    position: { x: 4, y: 11 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
  {
    id: "facility-module-15",
    definitionId: CONTROL,
    position: { x: 7, y: 11 },
    rotation: 180,
    operationalState: "online",
    overclock: { profile: "boost", frequencyRatio: 1.25, voltageRatio: 1.1 },
  },
  {
    id: "facility-module-16",
    definitionId: ROOM_COOLING,
    position: { x: 10, y: 10 },
    rotation: 90,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  },
];

function commandId(sequence: number): string {
  return `13600000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function key(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function pointFromKey(value: string): GridPoint {
  const [xValue, yValue] = value.split(",");
  const x = xValue === undefined ? Number.NaN : Number(xValue);
  const y = yValue === undefined ? Number.NaN : Number(yValue);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y))
    throw new Error("Invalid fixture point key.");
  return { x, y };
}

function moduleFixture(plan: ModulePlan): ModuleInstanceState {
  const definition = content.modules[plan.definitionId];
  if (definition === undefined) throw new Error(`Missing fixture definition ${plan.definitionId}.`);
  return {
    id: plan.id,
    definitionId: plan.definitionId,
    position: { ...plan.position },
    rotation: plan.rotation,
    operationalState: plan.operationalState,
    overclock: { ...plan.overclock },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: plan.operationalState === "starting" ? 4 : 0,
    cooldownTicksRemaining: 0,
  };
}

function occupiedTiles(modules: Readonly<Record<string, ModuleInstanceState>>): Set<string> {
  const occupied = new Set<string>();
  for (const module of Object.values(modules)) {
    const definition = content.modules[module.definitionId];
    if (definition === undefined)
      throw new Error(`Missing fixture definition ${module.definitionId}.`);
    for (const point of enumerateOccupiedTiles(
      module.position,
      definition.footprint,
      module.rotation,
    )) {
      occupied.add(key(point));
    }
  }
  return occupied;
}

function routePath(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  endpoints: {
    readonly from: { readonly moduleTile: GridPoint; readonly adjacentTile: GridPoint };
    readonly to: { readonly moduleTile: GridPoint; readonly adjacentTile: GridPoint };
  },
): GridPoint[] {
  const start = endpoints.from.adjacentTile;
  const goal = endpoints.to.adjacentTile;
  const blocked = occupiedTiles(modules);
  blocked.delete(key(start));
  blocked.delete(key(goal));
  const parents = new Map<string, string | null>([[key(start), null]]);
  const queue = [start];
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (key(current) === key(goal)) break;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const nextKey = key(next);
      if (next.x < 0 || next.x >= WIDTH || next.y < 0 || next.y >= HEIGHT) continue;
      if (blocked.has(nextKey) || parents.has(nextKey)) continue;
      parents.set(nextKey, key(current));
      queue.push(next);
    }
  }
  if (!parents.has(key(goal))) throw new Error("Fixture route has no valid path.");
  const middle: GridPoint[] = [];
  let cursor: string | null = key(goal);
  while (cursor !== null) {
    middle.push(pointFromKey(cursor));
    cursor = parents.get(cursor) ?? null;
  }
  middle.reverse();
  return [endpoints.from.moduleTile, ...middle, endpoints.to.moduleTile];
}

function routeFixture(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  id: string,
  from: PortRef,
  to: PortRef,
): RouteState {
  const endpoints = resolveManualRouteEndpoints({ modules }, content, from, to);
  if ("code" in endpoints) throw new Error(`Fixture route endpoints invalid: ${endpoints.code}.`);
  const path = routePath(modules, endpoints);
  const pathFailure = validateManualRoutePath(
    { size: { width: WIDTH, height: HEIGHT }, modules },
    content,
    endpoints.from,
    endpoints.to,
    path,
  );
  if (pathFailure !== null) throw new Error(`Fixture route path invalid: ${pathFailure.reason}.`);
  return {
    id,
    kind: endpoints.kind,
    from: { moduleInstanceId: endpoints.from.moduleInstanceId, portId: endpoints.from.portId },
    to: { moduleInstanceId: endpoints.to.moduleInstanceId, portId: endpoints.to.portId },
    path,
    capacityPerSecond: Math.min(endpoints.from.capacityPerSecond, endpoints.to.capacityPerSecond),
    congestionRatio: 0,
  };
}

function fixtureState(): GameState {
  const state = createInitialGameState({ content, seed: "task-13-blueprint-performance" });
  const completedResearchIds = new Set([
    "research-stable-power-distribution",
    "research-vacuum-tube-reliability",
    "research-forced-airflow",
    "research-accumulator-design",
    "research-delay-line-memory",
    "research-buffered-io",
    "research-modular-wiring",
    "research-blueprint-documentation",
  ]);
  for (const researchId of completedResearchIds) state.research.statuses[researchId] = "completed";
  const modules: Record<string, ModuleInstanceState> = {};
  for (const plan of MODULE_PLANS) modules[plan.id] = moduleFixture(plan);
  const external = moduleFixture({
    id: "facility-module-external",
    definitionId: RELAY,
    position: { x: 6, y: 6 },
    rotation: 0,
    operationalState: "online",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
  });
  modules[external.id] = external;
  state.facility.modules = modules;
  state.facility.contractedPowerWatts = 100_000;
  state.facility.power = {
    ...state.facility.power,
    headroomWatts: state.facility.contractedPowerWatts,
  };
  state.facility.thermalTiles = state.facility.thermalTiles.map((tile) => ({
    ...tile,
    temperatureC: 20 + ((tile.position.x * 7 + tile.position.y * 11) % 40),
  }));
  const routes: Record<string, RouteState> = {};
  routes["facility-route-01"] = routeFixture(
    modules,
    "facility-route-01",
    { moduleInstanceId: "facility-module-01", portId: "power-out-east" },
    { moduleInstanceId: "facility-module-02", portId: "power-in-west" },
  );
  routes["facility-route-02"] = routeFixture(
    modules,
    "facility-route-02",
    { moduleInstanceId: "facility-module-02", portId: "data-east" },
    { moduleInstanceId: "facility-module-04", portId: "data-west" },
  );
  routes["facility-route-03"] = routeFixture(
    modules,
    "facility-route-03",
    { moduleInstanceId: "facility-module-04", portId: "data-west" },
    { moduleInstanceId: "facility-module-12", portId: "data-west" },
  );
  routes["facility-route-04"] = routeFixture(
    modules,
    "facility-route-04",
    { moduleInstanceId: "facility-module-01", portId: "power-out-south" },
    { moduleInstanceId: "facility-module-11", portId: "power-in-west" },
  );
  routes["facility-route-05"] = routeFixture(
    modules,
    "facility-route-05",
    { moduleInstanceId: "facility-module-13", portId: "data-out-east" },
    { moduleInstanceId: "facility-module-14", portId: "data-west" },
  );
  routes["facility-route-06"] = routeFixture(
    modules,
    "facility-route-06",
    { moduleInstanceId: "facility-module-02", portId: "data-west" },
    { moduleInstanceId: "facility-module-15", portId: "data-west" },
  );
  routes["facility-route-external"] = routeFixture(
    modules,
    "facility-route-external",
    { moduleInstanceId: "facility-module-15", portId: "data-east" },
    { moduleInstanceId: external.id, portId: "data-west" },
  );
  state.facility.routes = routes;
  state.facility.nextModuleInstanceSequence = 1;
  state.facility.nextRouteSequence = 1;
  for (const plan of MODULE_PLANS) {
    const existing = state.inventory.stacks[plan.definitionId];
    state.inventory.stacks[plan.definitionId] = {
      definitionId: plan.definitionId,
      quantity: Math.max(existing?.quantity ?? 0, 100),
      averageAcquisitionCostUsd: content.modules[plan.definitionId]?.priceUsd ?? 0,
    };
  }
  return state;
}

const selectedModuleIds = MODULE_PLANS.map(({ id }) => id);
const captureTemplate = fixtureState();
const capturePayload = captureCanonicalBlueprintPayload(
  captureTemplate,
  content,
  selectedModuleIds,
);
const captureSummary = calculateCanonicalBlueprintSummary(
  captureTemplate,
  content,
  selectedModuleIds,
);
if (capturePayload.routes.length !== 6)
  throw new Error("Fixture must capture six internal routes.");
if (
  !capturePayload.routes.some((route) => route.kind === "power") ||
  !capturePayload.routes.some((route) => route.kind === "data")
) {
  throw new Error("Fixture must contain both internal Power and data routes.");
}
if (!capturePayload.routes.some((route) => route.relativePath.length > 4)) {
  throw new Error("Fixture must contain a route path extending beyond module footprints.");
}
if (new Set(MODULE_PLANS.map(({ rotation }) => rotation)).size !== 4) {
  throw new Error("Fixture must contain all four stored module rotations.");
}
if (
  new Set(captureTemplate.facility.thermalTiles.map(({ temperatureC }) => temperatureC)).size < 2
) {
  throw new Error("Fixture must contain nonuniform observed temperatures.");
}
const primaryRecord: BlueprintRecord = {
  id: "blueprint-00000001",
  name: "Task 13 Blueprint performance fixture",
  ...capturePayload,
  summary: captureSummary,
};

function stateWithRecords(recordCount: number): GameState {
  const state = structuredClone(captureTemplate);
  const records: Record<string, BlueprintRecord> = {};
  for (let index = 1; index <= recordCount; index += 1) {
    const id = `blueprint-${index.toString().padStart(8, "0")}`;
    records[id] = { ...structuredClone(primaryRecord), id, name: `Diagnostic Blueprint ${index}` };
  }
  state.blueprints = { records, nextBlueprintSequence: recordCount + 1 };
  return state;
}

function targetFor(record: BlueprintRecord, rotation: Rotation = 0): GridPoint {
  const bounds = resolveRotatedFootprintSize(record.bounds, rotation);
  return { x: WIDTH - bounds.width, y: HEIGHT - bounds.height };
}

function designState(recordCount = 1): GameState {
  const state = stateWithRecords(recordCount);
  state.facility.designDraft = {
    revision: 0,
    modules: structuredClone(state.facility.modules),
    routes: structuredClone(state.facility.routes),
    undoStack: [],
    redoStack: [],
  };
  return state;
}

const primaryTarget = targetFor(primaryRecord);

const fullSystems: TickSystemRegistry = {
  ...createPowerTickSystems(content),
  ...createThermalTickSystems(content),
  ...createOverclockTickSystems(content),
  ...createComputeTickSystems(content),
  ...createTaskTickSystems(content),
  ...createResearchTickSystems(content),
};

function createCommandCore(state: GameState): SimCore {
  return new SimCore({
    initialState: state,
    commandHandlers: {
      ...createBlueprintCommandHandlers(content),
      ...createDesignModeCommandHandlers(content),
    },
  });
}

function processCommand(core: SimCore, command: SimCommand): void {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result?.accepted !== true)
    throw new Error(`Fixture command rejected: ${JSON.stringify(result)}`);
}

function processExpectedCommand(core: SimCore, command: SimCommand, code: string): void {
  core.enqueue(command);
  const result = core.processPendingCommands()[0];
  if (result?.accepted !== false || result.code !== code)
    throw new Error(`Expected ${code}, got ${JSON.stringify(result)}`);
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): MeasurementSummary {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    samples: sorted.length,
  };
}

function measure(operation: () => void, warmups: number, sampleCount: number): MeasurementSummary {
  for (let warmup = 0; warmup < warmups; warmup += 1) operation();
  const samples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const start = process.hrtime.bigint();
    operation();
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  return summarize(samples);
}

function measurePrepared<Fixture>(
  prepare: () => Fixture,
  operation: (fixture: Fixture) => void,
  warmups: number,
  sampleCount: number,
): MeasurementSummary {
  for (let warmup = 0; warmup < warmups; warmup += 1) operation(prepare());
  const samples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const fixture = prepare();
    const start = process.hrtime.bigint();
    operation(fixture);
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  return summarize(samples);
}

function instantiateCommand(): Extract<SimCommand, { kind: "INSTANTIATE_BLUEPRINT" }> {
  return {
    commandId: commandId(1),
    source: "debug",
    kind: "INSTANTIATE_BLUEPRINT",
    blueprintId: primaryRecord.id,
    position: primaryTarget,
    rotation: 0,
  };
}

function saveSummary(): MeasurementSummary {
  return measurePrepared(
    () => createCommandCore(structuredClone(captureTemplate)),
    (core) => {
      processCommand(core, {
        commandId: commandId(2),
        source: "debug",
        kind: "SAVE_BLUEPRINT",
        name: "Performance fixture",
        selectedModuleIds,
      });
    },
    COMMAND_WARMUPS,
    COMMAND_SAMPLES,
  );
}

function instantiateSummary(): MeasurementSummary {
  return measurePrepared(
    () => createCommandCore(designState()),
    (core) => {
      processCommand(core, instantiateCommand());
    },
    COMMAND_WARMUPS,
    COMMAND_SAMPLES,
  );
}

function undoSummary(): MeasurementSummary {
  return measurePrepared(
    () => {
      const core = createCommandCore(designState());
      processCommand(core, instantiateCommand());
      return core;
    },
    (core) => {
      processCommand(core, { commandId: commandId(3), source: "debug", kind: "UNDO_DESIGN" });
    },
    COMMAND_WARMUPS,
    COMMAND_SAMPLES,
  );
}

function redoSummary(): MeasurementSummary {
  return measurePrepared(
    () => {
      const core = createCommandCore(designState());
      processCommand(core, instantiateCommand());
      processCommand(core, { commandId: commandId(4), source: "debug", kind: "UNDO_DESIGN" });
      return core;
    },
    (core) => {
      processCommand(core, { commandId: commandId(5), source: "debug", kind: "REDO_DESIGN" });
    },
    COMMAND_WARMUPS,
    COMMAND_SAMPLES,
  );
}

const capture = measure(
  () => {
    captureCanonicalBlueprintPayload(captureTemplate, content, selectedModuleIds);
  },
  PURE_WARMUPS,
  PURE_SAMPLES,
);
const summary = measure(
  () => {
    calculateCanonicalBlueprintSummary(captureTemplate, content, selectedModuleIds);
  },
  PURE_WARMUPS,
  PURE_SAMPLES,
);
const planning = measurePrepared(
  () => designState(),
  (state) => {
    const result = planBlueprintMaterialization(state, content, primaryRecord.id, primaryTarget, 0);
    if (result.status !== "ready")
      throw new Error(`Materialization fixture rejected: ${JSON.stringify(result)}`);
  },
  PURE_WARMUPS,
  PURE_SAMPLES,
);
const save = saveSummary();
const instantiate = instantiateSummary();
const undo = undoSummary();
const redo = redoSummary();
const collision = measurePrepared(
  () => {
    const state = designState();
    const collisionModule = moduleFixture({
      id: "fixture-collision",
      definitionId: RELAY,
      position: primaryTarget,
      rotation: 0,
      operationalState: "online",
      overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    });
    if (state.facility.designDraft === null) throw new Error("Collision fixture draft is missing.");
    state.facility.designDraft.modules[collisionModule.id] = collisionModule;
    return createCommandCore(state);
  },
  (core) => {
    processExpectedCommand(core, instantiateCommand(), "TILE_OCCUPIED");
  },
  COMMAND_WARMUPS,
  COMMAND_SAMPLES,
);
const shortage = measurePrepared(
  () => {
    const state = designState();
    const definitionId = LOGIC;
    state.inventory.stacks[definitionId] = {
      definitionId,
      quantity: 1,
      averageAcquisitionCostUsd: 0,
    };
    return createCommandCore(state);
  },
  (core) => {
    processExpectedCommand(core, instantiateCommand(), "INSUFFICIENT_INVENTORY");
  },
  COMMAND_WARMUPS,
  COMMAND_SAMPLES,
);
const incompatible = measurePrepared(
  () => {
    const state = designState();
    const record = state.blueprints.records[primaryRecord.id];
    if (record === undefined) throw new Error("Compatibility fixture record is missing.");
    state.blueprints.records[primaryRecord.id] = {
      ...record,
      contentVersion: "historical-content",
    };
    return createCommandCore(state);
  },
  (core) => {
    processExpectedCommand(core, instantiateCommand(), "BLUEPRINT_INVALID");
  },
  COMMAND_WARMUPS,
  COMMAND_SAMPLES,
);

const productionCore = new SimCore({
  initialState: stateWithRecords(BLUEPRINT_RECORD_COUNT),
  tickSystems: fullSystems,
});
const production = measure(
  () => {
    productionCore.step();
  },
  TICK_WARMUPS,
  TICK_SAMPLES,
);

const coldTemplate = stateWithRecords(BLUEPRINT_RECORD_COUNT);
const coldConstruction = measurePrepared(
  () => structuredClone(coldTemplate),
  (state) => {
    new SimCore({ initialState: state, tickSystems: fullSystems });
  },
  COMMAND_WARMUPS,
  COMMAND_SAMPLES,
);
const replacementCore = new SimCore({
  initialState: structuredClone(coldTemplate),
  tickSystems: fullSystems,
});
const stateReplacement = measurePrepared(
  () => structuredClone(coldTemplate),
  (state) => {
    replacementCore.replaceState(state);
  },
  COMMAND_WARMUPS,
  COMMAND_SAMPLES,
);

function format(value: MeasurementSummary): string {
  return `median=${value.medianMs.toFixed(4)} ms, p95=${value.p95Ms.toFixed(4)} ms, max=${value.maximumMs.toFixed(4)} ms, samples=${value.samples}`;
}

console.log("Task 13.6 audited Blueprint performance diagnostic");
console.log(
  `fixture: ${WIDTH} x ${HEIGHT}, selectedModules=${selectedModuleIds.length}, liveModules=${Object.keys(captureTemplate.facility.modules).length}, internalRoutes=${capturePayload.routes.length}, omittedExternalRoutes=1, storedBlueprintRecords=${BLUEPRINT_RECORD_COUNT}`,
);
console.log(`capture: ${format(capture)}`);
console.log(`canonical summary: ${format(summary)}`);
console.log(`rotation/materialization planning: ${format(planning)}`);
console.log(`SAVE_BLUEPRINT command: ${format(save)}`);
console.log(`INSTANTIATE_BLUEPRINT command: ${format(instantiate)}`);
console.log(`Blueprint Undo: ${format(undo)}`);
console.log(`Blueprint Redo: ${format(redo)}`);
console.log(`collision rejection: ${format(collision)}`);
console.log(`cumulative inventory shortage rejection: ${format(shortage)}`);
console.log(`incompatible contentVersion rejection: ${format(incompatible)}`);
console.log(
  `complete production tick with ${BLUEPRINT_RECORD_COUNT} stored Blueprints: ${format(production)}`,
);
console.log(`cold SimCore construction: ${format(coldConstruction)}`);
console.log(`state replacement: ${format(stateReplacement)}`);
console.log(
  `environment: CPU=${cpus()[0]?.model ?? "unknown"}; OS=${process.platform} ${release()} ${process.arch}; Node=${process.version}; NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; build mode=Node TypeScript type stripping with V8 JIT`,
);
console.log(
  `warm-up: ${PURE_WARMUPS} unmeasured pure iterations; ${COMMAND_WARMUPS} unmeasured command/cold iterations; ${TICK_WARMUPS} unmeasured production ticks; fixture construction and JIT setup are excluded from measured samples; no sample is filtered.`,
);
console.log(
  "hard Intel i7-2600 targets: capture p95 < 5 ms; materialization p95 < 5 ms; SAVE/INSTANTIATE/Undo/Redo p95 < 50 ms; complete production p95 < 4 ms.",
);

if (
  capture.p95Ms >= 5 ||
  planning.p95Ms >= 5 ||
  save.p95Ms >= 50 ||
  instantiate.p95Ms >= 50 ||
  undo.p95Ms >= 50 ||
  redo.p95Ms >= 50 ||
  production.p95Ms >= 4
) {
  process.exitCode = 1;
}
