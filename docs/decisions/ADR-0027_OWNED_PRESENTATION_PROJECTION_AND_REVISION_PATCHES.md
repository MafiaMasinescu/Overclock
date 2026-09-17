# ADR-0027: Owned presentation projection and revision patches

Status: Accepted for Phase 2 Task 18.

## Context

The Phase 0 shell has placeholder data. Phase 2 needs a deterministic, truthful simulator-owned presentation that React and Pixi can consume without reading or mutating authoritative `GameState`. Task 18 supplies the in-process boundary; Task 19 owns Worker transport and scheduling.

## Decision

The neutral contracts and pure projection live in `src/sim/selectors`; `src/app/game-client/snapshots.ts` re-exports the app-facing types. `SimCore.getPresentation` parses a descriptor-safe context and projects against owned authoritative state without `getStateForSave` or a callback. The result carries a deeply frozen `UiSnapshot` and `GridViewModel`, authoritative frozen thermal tiles and source revisions. The route-issue comparison memo is private to a projector instance owned by one `SimCore`; replacement constructs a fresh presentation runtime. No cache enters `GameState`, save, Replay, hashes or receipts.

The source mapping table in `sourceMapping.ts` fixes the provenance of each view-model field. Unimplemented forecasts, deadline risk, aggregate memory/retry telemetry, and data-route utilization remain `null`; alerts, placement preview and diagnostics remain empty. `build.inventoryUnitCount` sums actual inventory quantities, not a revision counter. Draft geometry is distinguishable from live physics. `commandAvailability` is a conservative hint based on existing domain guards; command handlers remain authoritative. In particular, an action known to be blocked by Research, Benchmark exclusivity, Design Mode or inventory must not report `true`. Availability need not validate Blueprint records when no draft can instantiate them.

`gridPublication.ts` owns grid/thermal full and delta patches. One publication may be in flight; later inputs coalesce to the latest owned candidate. Deltas compare with the acknowledged baseline. ACK advances the baseline atomically, including source-only changes; wrong or stale ACK requests resync. Full and resync heatmaps contain every tile in row-major order even when the heatmap display is disabled. Heat thresholds reuse `balancing.thermal.dirtyEpsilonC`; sub-epsilon changes accumulate against acknowledged values. A new epoch requires a fresh publisher. No caller-owned mutable pending value is retained.

The publisher accepts only exact plain wrapper/source records with data properties. An untrusted grid or thermal array is descriptor-safely copied and validated before retention. Projector-built frozen grids may be reused by identity; only `SimCore.getPresentation` marks already-owned authoritative thermal tiles for in-process reuse. Neither pure projection nor direct cached-projector use grants this trust to a shallow-frozen caller array. These private identity marks are non-authoritative and never serialized. Work after a full publication still validates the final publication and freezes its outward value.

`GameClientStore` verifies exact epoch agreement across wrapper/publication/store, validates deeply frozen plain values before adoption, builds a complete immutable candidate, and commits snapshot/grid/heat baseline once. Failed admission cannot bind the first epoch. Full heatmaps use exact row-major coverage; deltas check duplicate tile coordinates. Section references are reused only when values are equal and already owned. Identical republications need no listener notification. Selector, equality and listener exceptions are isolated after commit and cannot turn an applied publication into a reported failure; a failed listener does not advance its notification baseline. The host explicitly rotates epochs with `resetForEpoch`.

Task 19 may define wire schemas and cloning. A structured clone does not carry private in-process identity evidence, so receiver admission must remain strict. This ADR does not authorize bypassing Worker parsing, creating a second simulator authority, or putting presentation values in Replay.

## Verification and consequences

The permanent diagnostic in `docs/diagnostics/PHASE_2_PROJECTION.md` uses an admitted dense 24 × 16 N fixture with active Task and Research, eight valid Blueprints, completed Benchmark history and full production tick composition. It exits nonzero when the target i7-2600 misses a hard p95 gate. The historical independent findings and their repair contract remain in `docs/diagnostics/PHASE_2_TASK_18_INDEPENDENT_AUDIT.md` and `docs/phases/OVERCLOCK_Task_18_Repair_Contract_and_Prompts.md`.

Phase 1 simulator formulas, deterministic state, content, save version and Replay contracts remain unchanged. Real Worker/GameClient transport, background scheduling, autosave and recovery remain Task 19 or later scope.
