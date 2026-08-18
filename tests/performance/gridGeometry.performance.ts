import { cpus } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { buildAdjacentPortGraph } from "../../src/grid/domain/adjacentPortGraph.ts";
import { buildOccupancyIndex, validateModulePlacement } from "../../src/grid/domain/occupancy.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";

interface MeasurementSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

const GRID_WIDTH = 24;
const GRID_HEIGHT = 16;
const content = loadContentBundle();

function createModule(id: string, x: number, y: number): ModuleInstanceState {
  return {
    id,
    definitionId: "module-data-relay",
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

function createDenseModules(): Record<string, ModuleInstanceState> {
  const modules: Record<string, ModuleInstanceState> = {};
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const id = `dense-module-${String(y).padStart(2, "0")}-${String(x).padStart(2, "0")}`;
      modules[id] = createModule(id, x, y);
    }
  }
  return modules;
}

function percentile(sortedSamples: readonly number[], ratio: number): number {
  const index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * ratio) - 1);
  return sortedSamples[index] ?? 0;
}

function measure(operation: () => void, warmups: number, samples: number): MeasurementSummary {
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    operation();
  }
  const elapsed: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
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
  return [
    `median=${summary.medianMs.toFixed(4)} ms`,
    `p95=${summary.p95Ms.toFixed(4)} ms`,
    `max=${summary.maximumMs.toFixed(4)} ms`,
    `samples=${summary.samples}`,
  ].join(", ");
}

const modules = createDenseModules();
const facilitySize = { width: GRID_WIDTH, height: GRID_HEIGHT } as const;
const occupancy = measure(
  () => {
    buildOccupancyIndex({ modules, content });
  },
  50,
  500,
);
const placement = measure(
  () => {
    validateModulePlacement({
      facilitySize,
      definitionId: "module-line-printer",
      position: { x: 10, y: 7 },
      rotation: 0,
      modules,
      content,
    });
  },
  50,
  500,
);
const graph = measure(
  () => {
    buildAdjacentPortGraph({ modules, content });
  },
  5,
  40,
);

const graphFixture = buildAdjacentPortGraph({ modules, content });
const cpu = cpus()[0]?.model ?? "unknown CPU";
console.log("Task 5.1 grid geometry diagnostic (development machine; no i7-2600 gate claim)");
console.log(
  `fixture: ${GRID_WIDTH} x ${GRID_HEIGHT} tiles, ${Object.keys(modules).length} one-tile modules, ` +
    `${graphFixture.nodes.length} power/data port nodes, ${graphFixture.edges.length} adjacency edges`,
);
console.log(`occupancy construction: ${format(occupancy)}`);
console.log(`placement validation (dense six-tile collision): ${format(placement)}`);
console.log(`adjacent-port graph construction: ${format(graph)}`);
console.log(
  `development machine: ${cpu}; ${process.platform} ${process.arch}; Node ${process.version}`,
);
console.log(
  "limitation: figures include development-runtime and host-load effects and do not establish the final target-hardware tick gate.",
);
