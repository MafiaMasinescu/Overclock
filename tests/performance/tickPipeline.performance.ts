import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { TickSystemRegistry } from "../../src/sim/core/tickSystems.ts";

interface MeasurementSummary {
  medianMs: number;
  p95Ms: number;
  maximumMs: number;
}

const content = loadContentBundle();

function createCore(label: string, tickSystems?: TickSystemRegistry): SimCore {
  return new SimCore({
    initialState: createInitialGameState({ content, seed: `performance-${label}` }),
    tickSystems: tickSystems ?? {},
  });
}

function elapsedMilliseconds(start: bigint, end: bigint): number {
  return Number(end - start) / 1_000_000;
}

function percentile(sortedSamples: readonly number[], ratio: number): number {
  const index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * ratio) - 1);
  return sortedSamples[index] ?? 0;
}

function summarize(samples: number[]): MeasurementSummary {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
  };
}

function measure(core: SimCore, warmupTicks: number, measuredTicks: number): MeasurementSummary {
  core.step(warmupTicks);
  const samples: number[] = [];

  for (let tick = 0; tick < measuredTicks; tick += 1) {
    const start = process.hrtime.bigint();
    core.step();
    samples.push(elapsedMilliseconds(start, process.hrtime.bigint()));
  }

  return summarize(samples);
}

function format(summary: MeasurementSummary): string {
  return [
    `median=${summary.medianMs.toFixed(4)} ms`,
    `p95=${summary.p95Ms.toFixed(4)} ms`,
    `max=${summary.maximumMs.toFixed(4)} ms`,
  ].join(", ");
}

const controlledSystems: TickSystemRegistry = {
  "calculate-workload-allocation"({ state, rng }) {
    state.facility.liveLayoutRevision += rng.nextUint32() & 1;
  },
  "produce-dirty-snapshot-data"({ state }) {
    state.facility.thermalRevision += 1;
  },
};

const empty = measure(createCore("empty"), 2_000, 10_000);
const controlled = measure(createCore("controlled", controlledSystems), 200, 1_000);

console.log("Task 3 tick pipeline diagnostic (development machine; no target-hardware gate)");
console.log(`empty pipeline: ${format(empty)}`);
console.log(`controlled private fixture: ${format(controlled)}`);
