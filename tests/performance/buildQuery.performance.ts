// Phase 3 Task 22 bounded Build-read diagnostic.
// The 100 warm-up / 500 measured cohorts are intentionally unchanged between
// runs. Results are target-gating only on the documented i7-2600 host.

import { arch, cpus, platform } from "node:os";
import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { createProductionSimCore } from "../../src/sim/core/productionSimCore.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

const content = loadContentBundle();
const WARMUP = 100;
const MEASURED = 500;
const isTargetHost =
  platform() === "win32" && arch() === "x64" && (cpus()[0]?.model ?? "").includes("i7-2600");

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function measure(label: string, run: () => void): void {
  for (let index = 0; index < WARMUP; index += 1) run();
  const samples: number[] = [];
  for (let index = 0; index < MEASURED; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      label,
      warmup: WARMUP,
      samples: MEASURED,
      medianMs: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maximumMs: Math.max(...samples),
      host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown" },
      targetHost: isTargetHost,
      gating: isTargetHost ? "target" : "informative",
    }),
  );
}

const core = createProductionSimCore({
  content,
  initialState: createInitialGameState({ content, seed: "task-22-build-query-performance" }),
});
const initialHash = hashCanonicalState(core.getStateForSave());
measure("context", () => {
  core.queryBuild({ kind: "context", mode: "live", clientIntentSequence: 1 });
});
const commandId = "79000000-0000-4000-8000-000000000001";
core.enqueue({ commandId, source: "debug", kind: "ENTER_DESIGN_MODE" });
core.processPendingCommands();
const postDesignHash = hashCanonicalState(core.getStateForSave());
const definitionId = "module-power-distribution";
measure("placement", () => {
  core.queryBuild({
    kind: "placement",
    mode: "draft",
    clientIntentSequence: 2,
    input: { definitionId, position: { x: 10, y: 10 }, rotation: 0, source: "catalog" },
  });
});
measure("apply", () => {
  core.queryBuild({ kind: "apply", mode: "draft", clientIntentSequence: 3 });
});
const finalHash = hashCanonicalState(core.getStateForSave());
if (postDesignHash !== finalHash) throw new Error("Build query reads mutated authoritative state.");
console.log(JSON.stringify({ initialHash, stateHashPreserved: true }));
