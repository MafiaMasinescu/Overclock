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

