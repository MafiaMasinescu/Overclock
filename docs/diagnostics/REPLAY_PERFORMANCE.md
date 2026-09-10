# Task 14 Replay performance diagnostic

Run the diagnostic with:

```powershell
corepack pnpm performance:replay
```

The diagnostic is an in-memory development measurement over the real production `SimCore`. It
reports setup-sensitive work separately from warm production work. Fixture construction is excluded
from every timed line, JIT warm-up is explicit, and no samples are filtered.

## Fixture A: dense production

The fixture is 24 by 16 with 300 occupied tiles (at least 75 percent occupancy), mixed footprints
and rotations, real Power and data routes with shared contention, a nonuniform Thermal field,
Overclocked module state, Compute state, Task-compatible offers, Research-compatible state, an
active Sustained Benchmark, 128 stored Blueprint records, and all production stages from
`createProductionSimCore`. Module IDs are canonicalized before constructing the production core.

The direct, recording, and playback production lines use separate cores. Playback uses a parsed
Replay trace and a warmed core; it executes one recorded `step(1)` entry per timed sample and checks
the exact recorded outcome and tick boundary. Registry composition, fixture creation, and the first
100 warm-up steps are excluded from the playback samples. Recording measures `step(1)` through the
recorder without an explicit checkpoint. The simulation-content fingerprint line measures the
contracted `hashSimulationContent(content)` operation over the simulation-content projection; it
does not time generic `canonicalSerialize(content)` as a substitute and excludes content loading
from the timed callback.

## Fixture B: protocol and fatal paths

The normal protocol trace contains 17 entries and 4 explicit checkpoints. It covers accepted and
rejected commands, Blueprint save, Design Mode entry, instantiation, Undo, Redo, Cancel, clock,
command-only processing, `step(0)`, and a normal final step. Its serialized ReplayLog is 5,576 UTF-8
bytes. The separate resume artifact is 21,344 UTF-8 bytes and uses a nonzero empty-queue boundary.

The expected-fatal trace is measured separately with an explicit test-only injected tick-system
failure. Fatal normalization is tested without exposing error causes, stacks, or host data in the
serialized log. The production recorder and runner never accept arbitrary replacement registries.

## Measurement method

- Production, command, checkpoint, finalization, fatal, resume, and cold paths: 200 measured samples.
- Compact metadata paths (enqueue and clock): 1,000 measured samples.
- Warm-up: 100 iterations unless a line has its own explicit warm-up; finalization uses prepared
  one-shot recorders with zero warm-up so each measured recorder finalizes exactly once.
- Timing source: `process.hrtime.bigint()`.
- Environment: Node development TypeScript execution; fixture construction excluded.
- Reported fields: median, p95, maximum, and sample count.

## Latest measured run

Environment:

- CPU: Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz
- OS: Windows 10.0.19045 (`win32`)
- Node: v24.11.0
- Build mode: development TypeScript
- Warm-up: 100 iterations unless stated above
- Dense fixture: 24 by 16, active production stages, 128 stored Blueprint records
- Protocol: 17 entries, 4 checkpoints, 5,576 ReplayLog bytes, 21,344 resume-artifact bytes

| Path | Median | p95 | Maximum | Samples |
| --- | ---: | ---: | ---: | ---: |
| Direct production `step(1)` | 1.9134 ms | 3.2388 ms | 17.0506 ms | 200 |
| Recording production `step(1)`, no checkpoint | 1.9752 ms | 3.5094 ms | 37.7337 ms | 200 |
| Playback production trace | 1.5553 ms | 2.4196 ms | 39.3546 ms | 200 |
| Enqueue recording | 0.0555 ms | 0.1013 ms | 0.5076 ms | 1,000 |
| Clock recording | 0.0654 ms | 0.1103 ms | 2.6800 ms | 1,000 |
| Command-only processing | 1.0938 ms | 2.1626 ms | 4.1821 ms | 200 |
| Full-state checkpoint serialization/hash | 45.8550 ms | 60.9550 ms | 74.8011 ms | 200 |
| Simulation-content fingerprint (`hashSimulationContent`) | 4.8723 ms | 7.0430 ms | 11.5007 ms | 200 |
| Strict Replay parsing | 1.1426 ms | 1.9777 ms | 3.0406 ms | 200 |
| Normal Replay finalization | 14.9664 ms | 19.8375 ms | 30.0898 ms | 200 |
| Normal end-to-end Replay | 105.9737 ms | 134.5951 ms | 215.3439 ms | 200 |
| Expected-fatal Replay | 37.5477 ms | 48.5775 ms | 61.1756 ms | 200 |
| Resume artifact verification/construction | 124.0967 ms | 151.2408 ms | 223.3291 ms | 200 |
| Resumed remaining execution | 48.5795 ms | 59.7033 ms | 72.0545 ms | 200 |
| Cold production `SimCore` construction | 30.0061 ms | 40.5402 ms | 50.8269 ms | 200 |

## Gate interpretation

The Task 14 hard references on an i7-2600 are:

- direct warm production p95 `<4 ms`;
- recording warm production p95 `<5 ms`;
- playback warm production p95 `<5 ms`.

The latest unfiltered run measured `3.2388 ms`, `3.5094 ms`, and `2.4196 ms`, respectively, so all
three hard references passed. No formula, gameplay threshold, fixture complexity, sample count,
assertion, or Replay semantic was changed for this final rerun. Checkpoint hashing, content
fingerprinting, parsing/finalization, complete Replay, resume, and cold construction have no
ordinary-tick hard reference and remain separate measurements.

The preferred wrapper overhead reference is direct p95 plus 1 ms. The measured wrapper lines are
reported honestly; the hard references take precedence over the preferred overhead guideline.

## Audit rules

The diagnostic must continue to prove that ordinary direct `SimCore` ticks perform no Replay work,
production registries are not composed per tick, the growing journal is not cloned or serialized on
every append, checkpoints are the only full-state hash boundaries, private Replay data does not
enter `GameState`, and all production validation remains enabled. Future reruns must preserve the
fixture, sample counts, warm-up declaration, thresholds, and no-filter policy.
