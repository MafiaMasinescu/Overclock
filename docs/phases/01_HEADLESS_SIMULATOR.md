# Faza 1: Headless Simulator

## Obiectiv

Construiește simulatorul determinist fără gameplay UI.

## Scope

1. Seeded RNG și canonical state hash.
2. `GameState` inițial și factory de new game.
3. Command queue, receipts, validation și atomic commit.
4. Tick pipeline de 100 ms.
5. Inventory și economy de bază.
6. Grid occupancy, footprint rotation și port graph.
7. Power delivery.
8. Thermal model cu double buffering.
9. Overclock profiles și stability.
10. Useful Compute și `ComputeBreakdown`.
11. Task lifecycle și allocation.
12. Research lifecycle.
13. Benchmark runners.
14. Blueprint save și instantiate la nivel de domeniu.
15. Replay log și determinism tests.
16. Bot simplu pentru milestone timings.

## Task 2: Command pipeline foundation

Status: implemented, pending final verification and approval.

Task 2 includes only:

- strict runtime parsing for the complete existing `SimCommand` union;
- a deterministic, zero-based FIFO queue with immediate `CommandReceipt` values;
- synchronous processed `CommandResult` values;
- expected-tick equality validation at processing time;
- a partial, kind-safe handler registry with exhaustive dispatch;
- per-command candidate state and RNG transactions;
- recoverable `STALE_TICK` and `COMMAND_NOT_AVAILABLE` rejection;
- fatal `SIMULATOR_INVARIANT_VIOLATION` behavior for handler or invariant failures.

Task 2 registers no production command handlers and implements no gameplay behavior. Its accepted
and fatal paths are exercised only with private test-injected handlers. Compatibility details are
fixed by `docs/decisions/ADR-0002_COMMAND_PIPELINE_FOUNDATION.md`.

## Task 3: 100 ms tick pipeline

Status: implemented, pending final review and approval.

Task 3 includes only:

- a directly callable headless `SimCore` over the Task 2 queue and processor;
- fixed 100 ms ticks with completed-tick numbering and time derived as `tick / 10`;
- ordered command processing at the start of the first requested tick;
- command-only processing without time advancement;
- synchronous `SET_PAUSED` and `SET_SPEED` application outside the regular queue;
- an explicit immutable TDD stage tuple and a narrow typed partial registry for private tests;
- atomic tick-system candidates with deterministic RNG commit and rollback;
- detached save-state snapshots;
- focused tick, clock, determinism, and diagnostic performance coverage.

Task 3 registers no production gameplay system. Host scheduling, timers, catch-up, workers, replay,
save/load, snapshots, events, and the later Phase 1 gameplay domains remain deferred. Compatibility
details are fixed by `docs/decisions/ADR-0003_DETERMINISTIC_TICK_PIPELINE.md`.

## Task 4: Inventory transactions and basic economy

Status: approved checkpoint, committed at `8e80b00`.

Task 4 includes only:

- content-injected production handlers for `BUY_MODULE` and `SELL_INVENTORY_ITEM` through the
  existing command processor and `SimCore` registry;
- recoverable typed handler outcomes that preserve ADR-0002 fatal exception behavior;
- deterministic integer-microdollar arithmetic behind the existing public USD `number` fields;
- atomic purchases with research gating, exact credit-boundary support, stack creation/merge, and
  weighted acquisition cost;
- inventory-only sales using current price and salvage ratio, unit-value quantization, partial-stack
  cost preservation, and full-stack removal;
- lifetime income and expense updates while per-tick flow fields remain unchanged;
- a pure quantized energy-cost helper without a production energy-charge tick system;
- narrow inventory/economy state validation, localization, determinism, overflow, and performance
  coverage.

Task 4 does not place or sell installed modules, charge energy, progress research, add financing or
financial game-over behavior, or implement any other gameplay command. Compatibility details are
fixed by `docs/decisions/ADR-0004_DETERMINISTIC_INVENTORY_AND_BASIC_ECONOMY.md`.

## Task 5.1: Deterministic grid and port geometry

Status: approved checkpoint.

Task 5.1 includes only:

- top-left-origin integer coordinates and clockwise rectangular footprint transforms;
- deterministic row-major occupied-tile enumeration and bounds validation;
- a derived plain-data occupancy index with key/ID, unknown-definition, and duplicate-tile checks;
- pure atomic placement validation with collision occupant details and move-instance exclusion;
- side-relative port-offset validation and rotated port tile, facing, and external-tile resolution;
- normalized power/data compatibility and physical adjacency checks;
- a deterministic derived adjacent power/data port graph without authoritative routes;
- focused grid invariants invoked on demand rather than on empty ticks;
- a standalone `24 x 16` grid geometry performance diagnostic.

Task 5.1 does not implement Design Mode lifecycle, placement/move/rotation/removal handlers, route
commands or pathfinding, inventory consumption, costs, downtime, power delivery, airflow or thermal
simulation, snapshots, saves, workers, rendering, or UI. Compatibility details are fixed by
`docs/decisions/ADR-0005_DETERMINISTIC_GRID_AND_PORT_GEOMETRY.md`.

## Task 5.2: Design Mode lifecycle and deterministic draft edits

Status: approved checkpoint, committed at `916476b6e5e8db6253606e7463781e7b594bf325`.

Task 5.2 includes only:

- content-injected production handlers for `ENTER_DESIGN_MODE`, `PLACE_MODULE`, `MOVE_MODULE`,
  `ROTATE_MODULE`, `REMOVE_MODULE`, and `CANCEL_DESIGN` through the existing command registry;
- validated detached draft cloning, revision zero, empty history stacks, and complete cancel;
- monotonic non-reusable module instance IDs from authoritative
  `FacilityState.nextModuleInstanceSequence` without RNG;
- derived inventory reservations based on draft count minus live count, without inventory or cash
  mutation and without a placement-time research check;
- exclusion-aware bounds and collision validation through Task 5.1 geometry APIs;
- accepted move and rotation no-ops with no state, revision, history, sequence, hash, or RNG change;
- one reversible canonical JSON operation per state-changing edit, revision overflow protection,
  and redo clearing only after a real edit;
- deterministic removal of sorted attached draft routes for move, rotate, and remove, without
  rerouting or graph construction;
- focused lifecycle, atomicity, serialization, FIFO, localization, exact 100-run determinism, and
  dense-layout performance coverage.

Task 5.2 does not implement connect/disconnect, path validation, auto-connect, pathfinding, undo or
redo execution, apply, inventory consumption, salvage, labor, downtime, power, thermal behavior,
silicon lottery, overclock behavior, snapshots, saves, workers, rendering, or UI. Compatibility
details are fixed by
`docs/decisions/ADR-0006_DESIGN_MODE_DRAFTS_AND_MODULE_INSTANCE_IDS.md`.

## Task 5.3: Deterministic manual routing

Status: checkpointed at `4d83988792cd02cbe81b6749696cd470ee422c77`.

Task 5.3 includes only:

- content-injected production handlers for `CONNECT_PORTS` and `DISCONNECT_ROUTE` through the
  existing command registry, processor, and `SimCore` path;
- validated draft endpoint resolution through ADR-0005 port compatibility and canonical direction,
  including canonical path reversal when submitted endpoint order is reversed;
- inclusive, uncompressed manual orthogonal paths with bounded length, bounds, unique tiles, and
  module-blocking validation;
- crossings, shared path tiles and segments, and multiple routes per port without capacity
  reservation, while rejecting duplicate normalized endpoint pairs;
- authoritative monotonic `FacilityState.nextRouteSequence` allocation without RNG and with
  collision/overflow rollback;
- detached connect/disconnect history records, route-state invariants, routing localizations, exact
  100-run determinism coverage, and a dedicated routing performance diagnostic;
- live-route validation before draft cloning and continued stable attached-route cleanup for move,
  rotate, and remove.

Task 5.3 does not implement auto-connect, auto-route, A-star, rerouting, preview validation,
undo/redo/apply execution, inventory/cash/labor/downtime effects, capacity reservation, power,
workload, latency, congestion gameplay, thermal behavior, UI, saves, workers, or a later task.
Compatibility details are fixed by `docs/decisions/ADR-0007_DETERMINISTIC_MANUAL_ROUTING.md`.

## Task 5.4: Deterministic Design Mode undo and redo

Status: checkpointed at `631f9d1379a0f12091247ea6a14a5a214dd87548`.

Task 5.4 includes only:

- content-injected production handlers for `UNDO_DESIGN` and `REDO_DESIGN` through the existing
  registry, processor, and `SimCore` path;
- accepted empty-stack exact no-ops, one revision increment per real transition, and atomic
  `INVALID_SYSTEM` rejection for nonempty revision overflow;
- LIFO transfer of the original detached operation records without new operation IDs or payload
  reshaping;
- exact restoration/removal of stored module and route records for place, move, rotate, remove,
  connect, and disconnect, without sequence restoration or consumption;
- fatal invariant behavior for malformed history or an impossible current-draft/history transition;
- focused all-kind, atomicity, localization compatibility, exact 100-run determinism, and dense
  undo/redo performance coverage.

Task 5.4 does not implement `APPLY_DESIGN`, inventory revalidation or consumption, live-layout
mutation, auto-routing, pathfinding, rerouting, capacity reservation, power, thermal behavior, UI,
saves, workers, or any later task. Compatibility details are fixed by
`docs/decisions/ADR-0008_DETERMINISTIC_DESIGN_MODE_UNDO_REDO.md`.

## Task 5.5: Deterministic Design Apply preview and transaction

Status: checkpointed at `24276727271a90e0b2c825be6687aa7996443715`.

Task 5.5 implements only the existing-registry `APPLY_DESIGN` handler and shared pure preview;
stable final-diff, inventory, salvage, labor, net-cost, and downtime calculation; atomic live-layout
replacement, net inventory consumption, economy settlement, affected-module offline/startup reset,
and `STALE_DESIGN_PREVIEW`. It does not add functional completeness checks, compute/power/thermal/
airflow/task-risk preview, tick work, graph construction, financing, UI, saves, workers, or Task 5.6.
Compatibility details are fixed by `docs/decisions/ADR-0009_DETERMINISTIC_DESIGN_APPLY_TRANSACTION.md`.

## Task 6: Deterministic power demand and routing-limited delivery

Status: reviewed functional checkpoint; correctness and determinism verification passed, but
performance completion is not approved.

Task 6 adds authoritative dirty/calculated facility power state; pure demand, topology, allocation,
operational transition, facility calculation, and validation APIs; shared contracted, source-port,
route, and sink-port limits; fixed priority tiers with minimum-first allocation; startup, online,
brownout and recovery behavior; route flow/utilization; and Task 4 energy-cost calculation without
settlement. Production registers only `calculate-power-demand-and-delivery`, consumes no RNG, scans
no path tiles, and builds no adjacent-port graph. Changed Design Apply resets power to dirty and the
next real tick recalculates it. Compatibility details are fixed by
`docs/decisions/ADR-0010_DETERMINISTIC_POWER_DEMAND_AND_DELIVERY.md`.

Task 6 does not implement automatic energy deduction, capacity purchasing, workload allocation,
heat, temperature, cooling effects, throttling, stability, shutdown/damage, overclock power,
Useful Compute, task/research progress, pathfinding, saves, UI, or another production tick stage.

Task 6.1 closes the Task 6 performance gates without changing the accepted formulas, ordering,
startup boundary, rollback, serialization, hash, or RNG contracts.

## Task 6.1: Performance Hardening

Status: checkpointed at `06f6e7893fe8b6ef181375ee1a159f8b11aa2afc` and pushed to `origin/main`.

Each `SimCore` owns a private Power topology and result cache outside `GameState`. Topology rebuilds
only after `liveLayoutRevision` changes or an explicit lifecycle replacement. Structural-sharing
transactions copy changed Power branches, scoped validators protect every normal Power commit, and
incremental freezing stops at existing frozen branches. New game, replacement, Apply, explicit
debug/test, and reconstruction boundaries retain broad validation. Compatibility details and the
limited supersession of ADR-0003 are fixed by
`docs/decisions/ADR-0011_INCREMENTAL_TICK_TRANSACTIONS_AND_DERIVED_POWER_CACHE.md`.

Validation-only command, lifecycle, save, and legacy-system boundaries still traverse and reject the
complete unsupported graph categories, but do not materialize canonical JSON text merely to discard
it. Canonical serialization and hash output remain unchanged. This correction keeps both heavy
determinism fixtures at exactly 100 independent runs and leaves Vitest's 15-second timeout and serial
file configuration unchanged.

The checkpoint correctness repair separates stored-result validation from same-generation result
validation. A persisted result is historical and is not reinterpreted with a later operational
state; a newly calculated result is still validated fatally against the exact tick-start inputs.
Consequently, a source completing startup in tick N remains unavailable in that committed result,
forces recalculation in tick N+1, and can then supply its sink. Result-cache reuse additionally
requires unchanged module, Power, and route branch identities plus contracted capacity, energy
price, and live revision. Transition-producing results are not cached for the following tick.

On the target i7-2600 in production mode after the repair, the warmed audited fixture passed both
targets: pure Power p95 `0.0013 ms` over 500 samples and complete production-tick p95 `0.0311 ms`
over 200 samples. Cold topology reconstruction was measured separately at median `1.8128 ms`, p95
`2.7236 ms`, and maximum `7.9483 ms` over 200 samples. Startup completion and following-tick forced
recalculation were measured as distinct warm-topology production ticks at p95 `3.7369 ms` and
`3.7034 ms`. No wall-time assertion was added to the unit suite.

## Task 7: Deterministic thermal model

Task 7's single final public checkpoint is the commit containing this status section. Task 7.1
establishes ADR-0012, strict thermal content behavior, structural thermal-state validation, and
private runtime contracts only. Task 7.2 implements pure heat generation and double-buffered update
behavior. Task 7.3 integrates the two registered thermal stages through a per-`SimCore` runtime with
transactional validation and revision semantics. Task 7.4 completes the audited dense
cold/warm/integrated diagnostic, cache and allocation hardening, final regressions, and permanent
documentation. The final fixture is grid-valid 24 by 16 with at least 288 occupied tiles, mixed 1 by
1 through 3 by 2 footprints, all rotations, powered compute, local airflow, extraction, shared Power
capacities, startup/brownout, and nonuniform thermal state. The hard i7-2600 gates are warm pure
thermal p95 below `0.5 ms` and warm complete production Power plus thermal p95 below `4 ms`;
cold/rebuild/transition paths are measured and reported separately by
`corepack pnpm performance:thermal`.

Task 7 is complete after passing its final review, complete test runs, determinism, validation, and
hard performance gates. It does not implement throttling, shutdown/cooldown recovery,
frequency/voltage overclock heat, Thermal Factor, snapshots, heatmap UI, workers, or saves. The next
planned Phase 1 task is `Phase 1 Task 8: Deterministic overclock profiles and stability`.

## Task 8: Deterministic overclock profiles and stability

Task 8 is split deliberately to preserve ADR-0003/ADR-0011 transactional history and the Task 7
thermal boundary.

- Task 8.1: contracts and foundations — ADR-0013, explicit validated eligibility, profile/state
  contracts, dirty-result initialization, structural stored-state validation, reserved rejection
  localization, compatibility updates, and no production behavior.
- Task 8.2: pure overclock, Power, and heat domain — approved dynamic Power factor and heat formulas
  only, with exact inputs and generation validation.
- Task 8.3: pure stability and thermal lifecycle — current-tick maximum-tile sampling, Thermal Factor,
  deterministic stability, thermal shutdown, cooldown, recovery, and restart rules only.
- Task 8.4: transactional SimCore integration — existing command envelopes, atomic target validation,
  Design Apply result dirtying, and a post-thermal lifecycle stage through the current queue, receipt,
  rollback, revision, and incremental-update path.
- Task 8.5: performance, complete verification, and documentation — dense 24 by 16 diagnostics,
  cold/warm/transition measurements, final regression coverage, and permanent status evidence.

Task 8 excludes Useful Compute, workloads, task/research/economy/benchmark progression, RNG outcomes,
health/degradation/damage/failures, silicon lottery, scaling of cooling/source/memory/route capacity,
events, UI, snapshots, heatmaps, workers, saves, and Task 9.

Task 8 is complete after Task 8.5 diagnostics and complete verification. The next planned Phase 1
task is `Phase 1 Task 9: Useful Compute`.

## Nu implementa

- React panels;
- Pixi placement;
- IndexedDB;
- tutorial UI;
- artă și audio.

## Acceptance criteria

- același replay produce același hash în minimum 100 de rulări;
- un sistem valid produce Useful Compute explicabil;
- lipsa de power reduce factorul corect;
- Boost crește power și heat mai repede decât compute;
- thermal shutdown funcționează și se recuperează după cooldown;
- două task-uri pot avansa simultan;
- hold oprește progress, dar nu deadline-ul;
- research rezervă compute;
- blueprint instantiate creează ID-uri noi;
- Peak și Sustained pot trece și eșua în fixtures controlate;
- tick p95 rămâne sub 4 ms în fixture-ul vertical slice.

## Livrabil

Un simulator care poate finaliza vertical slice-ul prin comenzi și teste, fără interfață.
