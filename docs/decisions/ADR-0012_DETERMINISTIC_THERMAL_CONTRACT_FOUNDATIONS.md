# ADR-0012: Deterministic Thermal Contract Foundations

Status: Accepted

Date: 26 August 2026

## Context

Phase 1 Task 7 requires deterministic local thermal state after the accepted Power pipeline. Task
7.1 fixes the public thermal semantics, validated content roles, and structural-state boundary only.
It does not register production thermal stages or calculate heat.

## Decisions

1. Full-load effective power is `loadPowerWatts / binEfficiencyRatio`; `binEfficiencyRatio` and
   `binThermalRatio` are finite positive values. Module heat is `heatWattsAtLoad *
   clamp(deliveredPowerWatts / effectiveFullLoadPowerWatts, 0, 1) / binThermalRatio`. Offline and
   shutdown modules produce zero heat; starting and brownout modules are proportional. Cooling
   modules use the same rule. Workload and frequency/voltage overclock heat remain deferred.
2. A module divides its total heat equally across its rotated occupied tiles. Rotation changes only
   positions, so the distributed total is conserved within numeric tolerance.
3. Every module declares strict `thermalBehavior`: `none`, `local-airflow` with positive safe
   `rangeTiles`, or `extraction`. `none` requires zero cooling watts; local airflow requires positive
   cooling watts and an airflow port; extraction requires positive cooling watts. `airflowUnits`
   remains validated content with no Task 7 simulation effect.
4. Local airflow cooling is `coolingWatts * clamp(PowerFactor, 0, 1)`. Each rotated airflow port
   starts at its external adjacent tile, receives an equal share of module capacity, and distributes
   it equally across its nominal directional range. Out-of-bounds assignments are discarded; modules
   do not block airflow, there is no wrap, and overlaps add. Airflow creates no `RouteState`.
5. Effective extraction capacity is the authoritative base `facility.extractionCapacityWatts` plus
   powered extraction-module cooling capacity. Extraction modules provide no directional local
   cooling. Global pressure uses raw generated heat before local cooling.
6. Thermal update uses a common previous generation, N/E/S/W neighbor order, no wrapping, and no
   individual-tile rounding. The order is heat, local cooling, diffusion, global pressure, ambient
   recovery, then clamp. Ambient recovery is `coefficient * (ambient - previous) * dt`; the clamp is
   `[max(balancing.minimumTemperatureC, ambientTemperatureC - 10), balancing.maximumTemperatureC]`.
7. `thermalTiles` and `thermalRevision` remain the only authoritative thermal data. Revision advances
   once only when an authoritative temperature changes; epsilon is future snapshot policy only.
   Changed Apply preserves temperatures; `step(0)` and command-only processing do not run thermal.
8. Generated fields, topology, typed arrays, and stage handoff remain private to one future
   `SimCore` thermal runtime. There is no singleton, cross-simulator cache, generic tick scratch, or
   authoritative heat buffer. A changed `liveLayoutRevision` invalidates thermal topology.
9. Task 7 registers exactly `calculate-heat-generation` then `update-thermal-state` in the existing
   fixed production order. The paired closures claim one runtime per `SimCore`; it owns topology,
   numeric scratch, and a tick-private tagged generation only. The runtime validates cold/current
   Power inputs once, safely reuses unchanged immutable Power input identities, and invalidates on
   lifecycle clear, state replacement, content/runtime replacement, changed layout revision, or
   changed facility dimensions. It never enters authoritative state, snapshots, receipts, saves,
   replay, or hashes.
10. A thermal failure clears pending generation and aborts the current tick under ADR-0003 and
    ADR-0011. The candidate state, tick, clock, RNG, Power result, thermal tiles, and revision do
    not commit; earlier commands and completed ticks retain their existing transaction semantics.
    The production adapter copy-on-writes only changed thermal records and reuses immutable position
    records, while all public pure-domain results remain plain serializable data.
11. Task 7 does not implement throttling, Thermal Factor, emergency shutdown, cooldown recovery,
    frequency/voltage overclock heat, task/research effects, economy settlement, snapshots, heatmap
    UI, workers, or saves.

## Content version decision

`contentVersion` remains `0.1.0`. The loader currently validates one vertical-slice pack version and
contains no schema-compatibility or content migration policy. This task atomically updates every
supplied module and does not change save compatibility; a future independent schema-version policy
requires its own ADR rather than an incidental version bump.

## Consequences

- Task 7.2 can implement pure generation and update functions without deciding observable gameplay.
- Task 7.3 must introduce a per-`SimCore`, thermal-specific stage runtime before production
  registration; ADR-0003 and ADR-0011 atomicity/RNG guarantees remain unchanged.
- Task 7.4 must measure cold topology work separately from warmed thermal and integrated ticks.

## Performance diagnostic and acceptance

`corepack pnpm performance:thermal` runs the audited 24 by 16 diagnostic. It uses at least 288
validly occupied tiles, mixed 1 by 1 through 3 by 2 footprints and all rotations, powered compute,
local-airflow and extraction cooling, nonuniform temperatures, Power routes with shared source and
sink capacity, and startup/brownout cases. Fixture setup and JIT warm-up are excluded from samples.
The command reports median, p95, maximum, samples, CPU, operating system, Node version, build mode,
and warm-up method for cold topology, warm pure generation/update, warm production Power plus
thermal, dirty-layout rebuild, startup transition, and forced validation paths.

On the i7-2600, the final audited run recorded warm pure thermal p95 `0.4173 ms` across 500 samples
and warm complete production Power plus thermal p95 `2.1939 ms` across 200 samples, meeting the hard
`< 0.5 ms` and `< 4 ms` targets. Cold/rebuild and transition paths are reported separately and are
not hidden in fixture setup. The preferred `< 1 ms` integrated headroom target remains a future
optimization opportunity; it is not a Task 7 checkpoint blocker.
