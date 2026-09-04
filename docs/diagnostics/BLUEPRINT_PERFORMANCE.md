# Blueprint performance diagnostic

The permanent Blueprint diagnostic is:

```powershell
corepack pnpm performance:blueprints
```

It measures the Task 13 pure domain and command paths without changing Blueprint semantics. The
diagnostic fails when a hard p95 target is missed.

## Audited fixture

The fixture is a valid `24 x 16` live facility with 16 selected modules and 17 live modules. It
contains mixed `1 x 1` through `3 x 2` footprints, all four stored module rotations, compute and
cooling modules, saved Overclock settings, six internal routes covering Power and data, route paths
that extend outside module footprints, one omitted selected-to-external connection, and nonuniform
observed thermal temperatures. The capture contains six internal routes; the seventh live route is
omitted because one endpoint is not selected. The fixture marks exactly the current Research needed
by its modules and the Blueprint feature as completed, and provides sufficient inventory for the
draft operation.

The stored-record tick fixture adds 128 valid historical records without changing the live layout.
The target placement is the top-left tile of the fully rotated stored bounds and leaves the source
draft layout intact for collision-free planning.

## Measurement contract

The final audited run used:

- CPU: Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz;
- operating system: Windows `10.0.19045`, `win32`, `x64`;
- Node: `v24.11.0`;
- build mode: Node TypeScript type stripping with V8 JIT;
- warm-up: 100 unmeasured pure iterations, 20 unmeasured command/cold iterations, and 100
  unmeasured production ticks;
- samples: 1,000 pure samples and 200 samples for each command, failure, production-tick, cold
  construction, and state-replacement line;
- fixture construction and JIT warm-up are outside timed samples; no sample is filtered.

Prepared fixtures are constructed before each timed command or pure-planning sample. Cold SimCore
construction and state replacement are measured separately, so their setup cost is visible rather
than hidden in warm command or tick measurements.

## Final audited result

Times are milliseconds. `p95` is the acceptance statistic; maximum values are retained to expose
host scheduling and garbage-collection outliers.

| Operation | Median | p95 | Maximum | Samples | Hard target |
| --- | ---: | ---: | ---: | ---: | --- |
| Pure live-layout capture | 0.5968 | 1.0139 | 3.2228 | 1,000 | p95 < 5 |
| Canonical summary | 0.0454 | 0.0689 | 0.6209 | 1,000 | reported separately |
| Pure rotation/materialization planning | 3.3076 | 4.4555 | 154.3718 | 1,000 | p95 < 5 |
| `SAVE_BLUEPRINT` | 6.7204 | 9.3438 | 13.7200 | 200 | p95 < 50; preferred < 25 |
| `INSTANTIATE_BLUEPRINT` | 13.3205 | 17.7084 | 29.1387 | 200 | p95 < 50; preferred < 25 |
| Blueprint Undo | 13.9015 | 21.3750 | 27.7012 | 200 | p95 < 50; preferred < 25 |
| Blueprint Redo | 10.1106 | 16.0467 | 20.9368 | 200 | p95 < 50; preferred < 25 |
| Collision rejection | 4.4774 | 6.5842 | 8.4953 | 200 | diagnostic only |
| Cumulative inventory shortage | 4.4322 | 6.6127 | 7.8670 | 200 | diagnostic only |
| Incompatible `contentVersion` | 2.6648 | 4.0740 | 6.2959 | 200 | diagnostic only |
| Complete production tick with 128 records | 0.8000 | 1.4973 | 82.7265 | 200 | p95 < 4 |
| Cold SimCore construction | 187.8144 | 220.8800 | 270.8651 | 200 | reported separately |
| State replacement | 175.0254 | 251.5012 | 1028.4976 | 200 | reported separately |

All hard p95 targets passed in this run. The large maximum values on production and replacement
are retained and are not removed by filtering; the acceptance gates use p95 as specified.

## Scoped hardening

The planner reuses command-scoped occupancy results while incrementally validating candidate module
placement, and route-state validation derives and reuses its own occupancy once for the complete
route collection. Public validators do not accept caller-supplied occupancy evidence. This reduces
local reconstruction while preserving canonical ordering, collision outcomes, and all Blueprint
formulas. No occupancy index, cache, witness, or scratch data is stored in authoritative state, and
ordinary production ticks do not scan Blueprint records.

## Invariants audited by the fixture and tests

The diagnostic and focused tests cover deterministic selection and insertion-order independence,
local identity mapping, internal-route-only capture and endpoint/path canonicalization, rotated
multi-tile module anchors, route-inclusive bounds, historical summary preservation, current-content
rejection, cumulative draft inventory reservations, fresh sequence allocation, atomic Design Mode
materialization, exact Undo/Redo objects and IDs, active-Benchmark draft editing, Apply exclusivity,
live-facility/cash/inventory ownership, fatal rollback, and zero RNG consumption.

No export/import, nested Blueprint, existing-definition editing, propagation, facility-zone
instantiation, premiums, automation, UI/events, save/replay transport, workers, or Task 15 behavior
is included in this diagnostic.
