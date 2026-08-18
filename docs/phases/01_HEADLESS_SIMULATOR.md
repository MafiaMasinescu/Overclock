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

Status: not started. Requires separate approval.

Task 3 will integrate command processing at the beginning of a fixed 100 ms simulation tick and
define tick advancement plus ordered system orchestration. It must not be inferred from or started
as part of Task 2. Host scheduling, pause/speed behavior, timers, catch-up, and worker integration
also remain outside Task 2.

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
