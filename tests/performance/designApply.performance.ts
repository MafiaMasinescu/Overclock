import { cpus } from "node:os";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { SimCommand } from "../../src/sim/commands/contracts.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { SimCore } from "../../src/sim/core/simCore.ts";
import type { ModuleInstanceState } from "../../src/sim/core/types.ts";
import { calculateDesignApplyPreview } from "../../src/sim/design/designApplyPreview.ts";
import { createDesignModeCommandHandlers } from "../../src/sim/design/designModeCommands.ts";

const content = loadContentBundle();
const GRID_WIDTH = 24;
const GRID_HEIGHT = 16;
const RELAY = "module-data-relay";
const PRINTER = "module-line-printer";

interface Summary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
}

function commandId(sequence: number): string {
  return `55090000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function module(id: string, definitionId: string, x: number, y: number): ModuleInstanceState {
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

function denseLiveModules(): Record<string, ModuleInstanceState> {
  const modules: Record<string, ModuleInstanceState> = {};
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    if (y % 4 === 3) continue;
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      if ((x < 3 && y < 3) || ([2, 6].includes(y) && x >= 4 && x <= 9)) continue;
      const id = `dense-${String(y).padStart(2, "0")}-${String(x).padStart(2, "0")}`;
      modules[id] = module(id, RELAY, x, y);
    }
  }
  modules["dense-printer"] = module("dense-printer", PRINTER, 0, 0);
  return modules;
}

function command(core: SimCore, value: SimCommand): void {
  core.enqueue(value);
  const [result] = core.processPendingCommands();
  if (result?.accepted !== true)
    throw new Error(`Fixture command rejected: ${JSON.stringify(result)}`);
}

function connect(sequence: number, y: number): SimCommand {
  return {
    commandId: commandId(sequence),
    source: "debug",
    kind: "CONNECT_PORTS",
    from: { moduleInstanceId: `dense-${String(y).padStart(2, "0")}-03`, portId: "data-east" },
    to: { moduleInstanceId: `dense-${String(y).padStart(2, "0")}-10`, portId: "data-west" },
    path: Array.from({ length: 8 }, (_, x) => ({ x: x + 3, y })),
  };
}

function prepare(): {
  readonly core: SimCore;
  readonly preview: Extract<ReturnType<typeof calculateDesignApplyPreview>, { status: "ready" }>;
} {
  const state = createInitialGameState({ content, seed: "task-5-5-performance" });
  state.facility.modules = denseLiveModules();
  state.inventory.stacks[RELAY] = {
    definitionId: RELAY,
    quantity: 4,
    averageAcquisitionCostUsd: 1,
  };
  const core = new SimCore({
    initialState: state,
    commandHandlers: createDesignModeCommandHandlers(content),
  });
  command(core, { commandId: commandId(1), source: "debug", kind: "ENTER_DESIGN_MODE" });
  command(core, {
    commandId: commandId(2),
    source: "debug",
    kind: "PLACE_MODULE",
    definitionId: RELAY,
    position: { x: 5, y: 3 },
    rotation: 0,
  });
  command(core, {
    commandId: commandId(3),
    source: "debug",
    kind: "PLACE_MODULE",
    definitionId: RELAY,
    position: { x: 7, y: 3 },
    rotation: 0,
  });
  command(core, {
    commandId: commandId(4),
    source: "debug",
    kind: "MOVE_MODULE",
    moduleInstanceId: "dense-00-03",
    position: { x: 3, y: 3 },
  });
  command(core, {
    commandId: commandId(5),
    source: "debug",
    kind: "ROTATE_MODULE",
    moduleInstanceId: "dense-00-05",
    rotation: 90,
  });
  command(core, {
    commandId: commandId(6),
    source: "debug",
    kind: "REMOVE_MODULE",
    moduleInstanceId: "dense-printer",
  });
  command(core, connect(7, 2));
  command(core, connect(8, 6));
  command(core, { commandId: commandId(9), source: "debug", kind: "UNDO_DESIGN" });
  const preview = calculateDesignApplyPreview(core.getStateForSave(), content);
  if (preview.status !== "ready")
    throw new Error(`Fixture preview blocked: ${JSON.stringify(preview)}`);
  return { core, preview };
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function measure<Fixture>(
  prepareFixture: () => Fixture,
  operation: (fixture: Fixture) => void,
): Summary {
  for (let warmup = 0; warmup < 20; warmup += 1) operation(prepareFixture());
  const samples: number[] = [];
  for (let sample = 0; sample < 200; sample += 1) {
    const fixture = prepareFixture();
    const start = process.hrtime.bigint();
    operation(fixture);
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maximumMs: sorted.at(-1) ?? 0,
  };
}

const previewFixture = prepare();
const finalDraft = previewFixture.core.getStateForSave().facility.designDraft;
const previewSummary = measure(prepare, (fixture) => {
  calculateDesignApplyPreview(fixture.core.getStateForSave(), content);
});
const applySummary = measure(prepare, (fixture) => {
  fixture.core.enqueue({
    commandId: commandId(10),
    source: "debug",
    kind: "APPLY_DESIGN",
    expectedDraftRevision: fixture.preview.draftRevision,
    acceptedCostUsd: fixture.preview.netCostUsd,
    acceptedDowntimeTicks: fixture.preview.downtimeTicks,
  });
  const [result] = fixture.core.processPendingCommands();
  if (result?.accepted !== true)
    throw new Error(`Fixture Apply rejected: ${JSON.stringify(result)}`);
});
const format = (summary: Summary) =>
  `median=${summary.medianMs.toFixed(4)} ms, p95=${summary.p95Ms.toFixed(4)} ms, max=${summary.maximumMs.toFixed(4)} ms, samples=200`;
const routePoints = Object.values(finalDraft?.routes ?? {}).reduce(
  (total, route) => total + route.path.length,
  0,
);
console.log("Task 5.5 Design Apply diagnostic (development machine; no Apply-time gate)");
console.log(
  `fixture: ${GRID_WIDTH} x ${GRID_HEIGHT}, modules=${Object.keys(previewFixture.core.getStateForSave().facility.modules).length}, routes=${Object.keys(finalDraft?.routes ?? {}).length}, routePathPoints=${routePoints}, changedModules=${previewFixture.preview.changedModuleIds.length}, inventoryEntries=${previewFixture.preview.inventoryConsumption.length}`,
);
console.log(`preview: ${format(previewSummary)}`);
console.log(`successful Apply: ${format(applySummary)}`);
console.log(
  `development machine: ${cpus()[0]?.model ?? "unknown CPU"}; ${process.platform} ${process.arch}; Node ${process.version}`,
);
