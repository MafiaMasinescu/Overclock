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

Status: implemented, pending review and checkpoint.

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
