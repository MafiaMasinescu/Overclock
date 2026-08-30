# ADR-0014: Deterministic Useful Compute

Status: Accepted

Date: 28 August 2026

## Context

Phase 1 Task 9 makes Theoretical and task-specific Useful Compute explainable and deterministic while
preserving the established command, Power, thermal, and Overclock historical-result boundaries.

## Decisions

1. `facility.compute` is authoritative, serializable, and included in canonical state hashes. Its
   dirty state has null layout and thermal revisions, empty stable-ID records, and exact zero totals.
   A calculated state stores both nonnegative safe revisions, module records in stable module-ID order,
   task records in stable task-instance-ID order, and exact theoretical, available, and allocated Useful
   Compute totals.
2. Module records exist only for positive-base-compute definitions when Task 9.3 calculates them. They
   preserve module ID, requested frequency, operational ratio, theoretical compute, Power/Thermal
   factors, retry/invalid rates, Stability Factor, and available compute. Rates and Stability retain
   the Task 8 identity `stabilityFactor = 1 - retryRate - invalidSampleRate`.
3. Task records preserve task/phase identity, copied sorted cluster IDs, requested share, memory and
   routing observations, rates, stability/runnable flags, ordered approved blocking reasons and
   warnings, and `ComputeBreakdown`. The only blocking reasons are `no-active-compute`,
   `insufficient-memory-capacity`, and `data-disconnected`; the only warning is
   `stability-below-minimum`.
4. Stored Compute validation is structural and historical. It checks serializability-compatible shape,
   stable ordering, finite/bounded values, totals, rate identities, formula identities, and internal
   record coverage. It must not reinterpret a stored task result against later phase/status, module
   lifecycle, Power, thermal, congestion, or allocation inputs. Task 9.3 will validate fresh results
   against the exact inputs used to calculate them.
5. Task 9 consumes already-valid active allocations but does not choose or normalise workload shares.
   It writes `deliveredUsefulComputeFlops`; task lifecycle, progress, rewards, research, benchmarks,
   commands, UI, workers, saves, random failures, and Task 10 remain outside Task 9.
6. Validated balancing adds finite positive
   `compute.dataRouteLatencyMicrosecondsPerGridStep = 25`. A compute-relevant definition has positive
   base compute, memory capacity/bandwidth, or a data port. Such a non-overclockable definition must
   have load Power strictly above idle; an overclockable definition must resolve effective load Power
   strictly above idle at minimum Manual frequency and voltage. This distinguishes an initialized
   historical Power result from real load without changing Power state.
7. `contentVersion` remains `0.1.0` and `saveVersion` remains `1` under the existing pre-release
   policy. Full-state hashes intentionally change when `facility.compute` is added. Task 7 and Task 8
   behavioral projections retain their published hashes; Task 9 records an explicit new compatibility
   vector rather than treating the full-hash change as unchanged behavior.
8. Task 9.2 calculates pure module capacity and task Useful Compute from explicit Facility, content,
   Power, Overclock, allocation, and RouteState inputs. The fixed explainable order is Theoretical,
   Power, Thermal, Memory, Interconnect, Suitability, then Stability. Power is weighted by allocated
   theoretical compute; Thermal and retry/invalid rates are weighted after Power and Thermal,
   respectively; aggregate Stability is exactly `1 - retryRate - invalidSampleRate`. This supersedes
   the earlier ambiguous cluster-average wording in the TDD.
9. Data topology uses only stable-sorted authoritative data routes. Stored direction remains
   authoritative except bidirectional-to-bidirectional routes, which work both ways. It precomputes
   path length/latency and effective capacity, never builds an adjacent-port graph or rescans route
   tiles. Overcommit is rejected rather than normalised.
10. Task 9.3 registers only `calculate-theoretical-and-useful-compute` as a private per-SimCore
    structural-sharing runtime. Its topology cache is keyed by live layout revision and facility
    dimensions; congestion refreshes route capacity without path reconstruction, while replacement or
    layout changes clear the cache. The runtime is derived-only and never enters authoritative state,
    hashes, saves, receipts, or replay data.
11. A module's theoretical compute is exactly
    `baseComputeFlops * binComputeRatio * requestedFrequencyRatio * operationalRatio`. Operational
    ratio is one only for a post-Power online module whose delivered Power reaches minimum and whose
    requested Power is strictly above minimum; startup completion, brownout, shutdown, and idle-only
    generation are zero. The following full-load tick may calculate compute. Available compute then
    applies current Power, Thermal, and Stability factors exactly once, without rounding.
12. Memory capacity is a fixed working-set requirement; bandwidth is scaled by requested share.
    Capacity is zero below minimum, one when recommended capacity is zero, otherwise capped at
    `available / recommended`. Zero required bandwidth is one; otherwise bandwidth is
    `clamp(available / required, 0.25, 1)`. Memory Factor is their minimum. Directed shortest paths
    determine latency, directed widest paths determine bandwidth, and every contributing compute
    module must have read/write reachability to a common powered memory-provider set. Local memory is
    a zero-route path. Disconnection is exactly zero; a connected Interconnect Factor is the clamped
    latency/congestion penalty result in `[0.20, 1]`.
13. Suitability maps only `serial`, `parallel`/`vector`, `memory-heavy`, `bandwidth`, and `latency` to
    the corresponding content axes. Each required axis uses the maximum powered usable cluster-module
    value in the bidirectionally usable data component, including a usable non-compute cluster module,
    clamped to `[0.70, 1.25]`; the arithmetic mean is clamped to the same range. No mapped axis is
    exactly one. Frequency already carries Boost, so suitability adds no second Boost bonus.
14. Fresh production validation calculates the complete facility result exactly once. The calculation
    returns a detached deeply frozen result plus a transaction-only witness containing the exact
    content, module, Power, Overclock, route, task-instance, revision, dimension, and private topology
    identities used. The fresh validator rejects any changed dependency or any candidate other than
    that immutable exact result. The witness never enters `GameState`, saves, replay, hashes,
    compatibility vectors, receipts, or public commands/results. Stored historical validation remains
    structural and unchanged.
15. SimCore validates a changed Compute/task branch after its producing stage and does not repeat the
    same allocation-heavy structural validation during tick finalization when those exact branch
    identities are already validated. Authoritative commit still recursively freezes every new object;
    its reusable iterative work stack skips previously verified branches and never skips descendants
    merely because a parent was shallow-frozen. Thermal generation/update scratch, stable module order,
    powered-memory providers, path metrics, and validation records are private per-runtime data and are
    cleared or identity-invalidated on replacement, topology, membership, lifecycle, Power, thermal,
    Overclock, route, allocation, content, revision, or dimension changes as applicable. Identity-only
    route copies preserve path metrics only when every data-route structure and effective capacity is
    unchanged. Immutable task-input projections and exactly equal frozen module-result records may be
    reused; changed scalar dependencies always rebuild the affected result.
16. Compute consumes no RNG. Any input, calculation, validation, or freeze failure aborts the candidate
    tick and preserves state, tick, clock, RNG, IDs, receipts, and the last completed results. Tests add
    rows only for a distinct failure class and reuse shared fixtures otherwise. Task 10 exclusively owns
    task selection/allocation lifecycle, acceptance, progress, deadlines, rewards, and related policy.

## Consequences

- Task 9 adds contracts, pure formulas/topology, the existing production stage, calculate-once exact
  validation, performance hardening, documentation, and compatibility coverage.
- On the audited i7-2600 fixture, three final clean processes measured pure p95
  `0.1684/0.1858/0.1667 ms` and complete production p95 `2.8424/3.1910/2.8493 ms`, passing the hard
  `<0.35 ms` and `<4 ms` gates in every run.
- A later independent checkpoint review observed production p95 failures while unrelated Opera and
  ChatGPT processes consumed several CPU cores and unrelated diagnostic sections slowed together.
  The project owner accepted that measured process-contention result as a checkpoint irregularity.
  This does not change formulas, fixture complexity, sample filtering, warm-up, process scheduling,
  or the permanent thresholds; authoritative comparisons require the heavy workloads to be inactive.

## Exclusions

Task 9 does not implement task progress, task commands, allocation selection/normalization, economy,
benchmarks, research, UI, workers, save/replay schema changes, random failures, or Task 10.
