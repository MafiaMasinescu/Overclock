import { cpus } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState, RouteState } from "../../src/sim/core/types.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";

interface MeasurementSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

const WIDTH = 24;
const HEIGHT = 16;
const RELAY = "module-data-relay";
const ROUTE_COUNT = 10;
const content = loadContentBundle();

function commandId(sequence: number): string {
  return `53020000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function relay(id: string, x: number, y: number): ModuleInstanceState {
  return {
    id,
    definitionId: RELAY,
    position: { x, y },
    rotation: 0,
    operationalState: "offline",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function route(id: string, left: ModuleInstanceState, right: ModuleInstanceState): RouteState {
  return {
    id,
    kind: "data",
    from: { moduleInstanceId: left.id, portId: "data-east" },
    to: { moduleInstanceId: right.id, portId: "data-west" },
    path: Array.from({ length: right.position.x - left.position.x + 1 }, (_, offset) => ({
      x: left.position.x + offset,
      y: left.position.y,
    })),
    capacityPerSecond: 60_000,
    congestionRatio: 0,
  };
}

function createFixture(): {
  modules: Record<string, ModuleInstanceState>;
  routes: Record<string, RouteState>;
} {
  const modules: Record<string, ModuleInstanceState> = {};
  const routes: Record<string, RouteState> = {};
  for (let row = 0; row < ROUTE_COUNT; row += 1) {
    const left = relay(`existing-left-${row}`, 0, row);
    const right = relay(`existing-right-${row}`, 3, row);
    modules[left.id] = left;
    modules[right.id] = right;
    const existing = route(`route-${String(row + 1).padStart(8, "0")}`, left, right);
    routes[existing.id] = existing;
  }
  for (let x = 5; x < WIDTH; x += 2) {
    for (let y = 0; y < HEIGHT; y += 2) {
      const spare = relay(`dense-${x}-${y}`, x, y);
      modules[spare.id] = spare;
    }
  }
  const candidateLeft = relay("candidate-left", 0, HEIGHT - 1);
  const candidateRight = relay("candidate-right", WIDTH - 1, HEIGHT - 1);
  modules[candidateLeft.id] = candidateLeft;
  modules[candidateRight.id] = candidateRight;
  return { modules, routes };
}

const fixture = createFixture();
const candidatePath = Array.from({ length: WIDTH }, (_, x) => ({ x, y: HEIGHT - 1 }));

function createCore(): SimCore {
  const initialState = createInitialGameState({ content, seed: "routing-performance" });
  initialState.facility.modules = structuredClone(fixture.modules);
  initialState.facility.routes = structuredClone(fixture.routes);
  initialState.facility.nextRouteSequence = ROUTE_COUNT + 1;
  return new SimCore({ initialState, commandHandlers: createDesignModeCommandHandlers(content) });
}

function processCommand(core: SimCore, command: SimCommand): void {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result?.accepted !== true) {
    throw new Error(`Performance fixture command rejected: ${JSON.stringify(result)}`);
  }
}

function prepare(command: SimCommand): () => void {
  const core = createCore();
  processCommand(core, { commandId: commandId(1), source: "debug", kind: "ENTER_DESIGN_MODE" });
  core.enqueue(command);
  return () => {
    const [result] = core.processPendingCommands();
    if (result?.accepted !== true) {
      throw new Error(`Performance fixture command rejected: ${JSON.stringify(result)}`);
    }
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function measure(
  prepareOperation: () => () => void,
  warmups: number,
  samples: number,
): MeasurementSummary {
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    prepareOperation()();
  }
  const elapsed: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const operation = prepareOperation();
    const start = process.hrtime.bigint();
    operation();
    elapsed.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  const sorted = elapsed.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
    samples,
  };
}

function format(summary: MeasurementSummary): string {
  return `median=${summary.medianMs.toFixed(4)} ms, p95=${summary.p95Ms.toFixed(4)} ms, max=${summary.maximumMs.toFixed(4)} ms, samples=${summary.samples}`;
}

const connect = measure(
  () =>
    prepare({
      commandId: commandId(2),
      source: "debug",
      kind: "CONNECT_PORTS",
      from: { moduleInstanceId: "candidate-left", portId: "data-east" },
      to: { moduleInstanceId: "candidate-right", portId: "data-west" },
      path: candidatePath,
    }),
  20,
  200,
);
const disconnect = measure(
  () =>
    prepare({
      commandId: commandId(3),
      source: "debug",
      kind: "DISCONNECT_ROUTE",
      routeId: "route-00000001",
    }),
  20,
  200,
);
const existingPathPoints = Object.values(fixture.routes).reduce(
  (total, item) => total + item.path.length,
  0,
);
const cpu = cpus()[0]?.model ?? "unknown CPU";
console.log("Task 5.3 manual routing diagnostic (report-only; no final i7-2600 gate claim)");
console.log(
  `fixture: ${WIDTH} x ${HEIGHT} tiles, ${Object.keys(fixture.modules).length} modules, ${Object.keys(fixture.modules).length}/${WIDTH * HEIGHT} occupied tiles, ${ROUTE_COUNT} existing routes, ${existingPathPoints} existing route path points, candidate path length ${candidatePath.length}`,
);
console.log(`accepted connect: ${format(connect)}`);
console.log(`accepted disconnect: ${format(disconnect)}`);
console.log(
  `development machine: ${cpu}; ${process.platform} ${process.arch}; Node ${process.version}`,
);
console.log(
  "limitation: figures include command-candidate cloning, route and grid validation, runtime and host-load effects; handlers do not build the adjacent-port graph or perform pathfinding.",
);
