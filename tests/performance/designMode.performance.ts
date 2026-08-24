import { cpus } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";

interface MeasurementSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

const GRID_WIDTH = 24;
const GRID_HEIGHT = 16;
const RELAY = "module-data-relay";
const PRINTER = "module-line-printer";
const PRINTER_ID = "dense-printer";
const content = loadContentBundle();

function commandId(sequence: number): string {
  return `52980000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function moduleFixture(
  id: string,
  definitionId: string,
  x: number,
  y: number,
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation: 0,
    operationalState: "offline",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: content.modules[definitionId]?.startupTicks ?? 0,
    cooldownTicksRemaining: 0,
  };
}

function createDenseModules(): Record<string, ModuleInstanceState> {
  const modules: Record<string, ModuleInstanceState> = {};
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    if (y % 4 === 3) {
      continue;
    }
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      if (x < 3 && y < 3) {
        continue;
      }
      const id = `dense-${String(y).padStart(2, "0")}-${String(x).padStart(2, "0")}`;
      modules[id] = moduleFixture(id, RELAY, x, y);
    }
  }
  modules[PRINTER_ID] = moduleFixture(PRINTER_ID, PRINTER, 0, 0);
  return modules;
}

const denseModules = createDenseModules();

function createCore(): SimCore {
  const initialState = createInitialGameState({ content, seed: "design-mode-performance" });
  initialState.facility.modules = structuredClone(denseModules);
  initialState.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 4,
    averageAcquisitionCostUsd: 1,
  };
  return new SimCore({
    initialState,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
}

function processCommand(core: SimCore, command: SimCommand): void {
  core.enqueue(command);
  const [result] = core.processPendingCommands();
  if (result?.accepted !== true) {
    throw new Error(`Performance fixture command rejected: ${JSON.stringify(result)}`);
  }
}

function prepare(command: SimCommand, enterFirst: boolean): () => void {
  const core = createCore();
  if (enterFirst) {
    processCommand(core, {
      commandId: commandId(1),
      source: "debug",
      kind: "ENTER_DESIGN_MODE",
    });
  }
  core.enqueue(command);
  return () => {
    const [result] = core.processPendingCommands();
    if (result?.accepted !== true) {
      throw new Error(`Performance fixture command rejected: ${JSON.stringify(result)}`);
    }
  };
}

function prepareUndo(): () => void {
  const core = createCore();
  processCommand(core, { commandId: commandId(15), source: "debug", kind: "ENTER_DESIGN_MODE" });
  processCommand(core, {
    commandId: commandId(16),
    source: "debug",
    kind: "MOVE_MODULE",
    moduleInstanceId: "dense-00-03",
    position: { x: 3, y: 3 },
  });
  core.enqueue({ commandId: commandId(17), source: "debug", kind: "UNDO_DESIGN" });
  return () => {
    const [result] = core.processPendingCommands();
    if (result?.accepted !== true)
      throw new Error(`Performance fixture command rejected: ${JSON.stringify(result)}`);
  };
}

function prepareRedo(): () => void {
  const core = createCore();
  processCommand(core, { commandId: commandId(18), source: "debug", kind: "ENTER_DESIGN_MODE" });
  processCommand(core, {
    commandId: commandId(19),
    source: "debug",
    kind: "MOVE_MODULE",
    moduleInstanceId: "dense-00-03",
    position: { x: 3, y: 3 },
  });
  processCommand(core, { commandId: commandId(20), source: "debug", kind: "UNDO_DESIGN" });
  core.enqueue({ commandId: commandId(21), source: "debug", kind: "REDO_DESIGN" });
  return () => {
    const [result] = core.processPendingCommands();
    if (result?.accepted !== true)
      throw new Error(`Performance fixture command rejected: ${JSON.stringify(result)}`);
  };
}

function percentile(sortedSamples: readonly number[], ratio: number): number {
  const index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * ratio) - 1);
  return sortedSamples[index] ?? 0;
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
  return [
    `median=${summary.medianMs.toFixed(4)} ms`,
    `p95=${summary.p95Ms.toFixed(4)} ms`,
    `max=${summary.maximumMs.toFixed(4)} ms`,
    `samples=${summary.samples}`,
  ].join(", ");
}

const enterDraft = measure(
  () => prepare({ commandId: commandId(10), source: "debug", kind: "ENTER_DESIGN_MODE" }, false),
  20,
  200,
);
const placement = measure(
  () =>
    prepare(
      {
        commandId: commandId(11),
        source: "debug",
        kind: "PLACE_MODULE",
        definitionId: RELAY,
        position: { x: 4, y: 3 },
        rotation: 0,
      },
      true,
    ),
  20,
  200,
);
const movement = measure(
  () =>
    prepare(
      {
        commandId: commandId(12),
        source: "debug",
        kind: "MOVE_MODULE",
        moduleInstanceId: "dense-00-03",
        position: { x: 3, y: 3 },
      },
      true,
    ),
  20,
  200,
);
const rotation = measure(
  () =>
    prepare(
      {
        commandId: commandId(13),
        source: "debug",
        kind: "ROTATE_MODULE",
        moduleInstanceId: PRINTER_ID,
        rotation: 90,
      },
      true,
    ),
  20,
  200,
);
const removal = measure(
  () =>
    prepare(
      {
        commandId: commandId(14),
        source: "debug",
        kind: "REMOVE_MODULE",
        moduleInstanceId: "dense-00-04",
      },
      true,
    ),
  20,
  200,
);
const undo = measure(prepareUndo, 20, 200);
const redo = measure(prepareRedo, 20, 200);

const occupiedTiles = Object.values(denseModules).reduce(
  (total, module) =>
    total +
    (content.modules[module.definitionId]?.footprint.width ?? 0) *
      (content.modules[module.definitionId]?.footprint.height ?? 0),
  0,
);
const cpu = cpus()[0]?.model ?? "unknown CPU";
console.log(
  "Task 5.4 Design Mode regression diagnostic (development machine; no final i7-2600 gate claim)",
);
console.log(
  `fixture: ${GRID_WIDTH} x ${GRID_HEIGHT} tiles, ${Object.keys(denseModules).length} modules, ` +
    `${occupiedTiles}/${GRID_WIDTH * GRID_HEIGHT} occupied tiles (${(
      (occupiedTiles / (GRID_WIDTH * GRID_HEIGHT)) *
      100
    ).toFixed(1)}%), 0 routes`,
);
console.log(`enter-draft cloning: ${format(enterDraft)}`);
console.log(`placement validation and commit: ${format(placement)}`);
console.log(`move validation and commit: ${format(movement)}`);
console.log(`rotation validation and commit: ${format(rotation)}`);
console.log(`removal validation and commit: ${format(removal)}`);
console.log(`undo validation and commit: ${format(undo)}`);
console.log(`redo validation and commit: ${format(redo)}`);
console.log(
  `development machine: ${cpu}; ${process.platform} ${process.arch}; Node ${process.version}`,
);
console.log(
  "limitation: figures include candidate cloning, focused grid validation, development-runtime, and host-load effects; handlers do not rebuild the adjacent-port graph.",
);
