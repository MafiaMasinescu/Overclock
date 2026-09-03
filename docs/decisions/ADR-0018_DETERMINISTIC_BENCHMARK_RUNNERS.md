# ADR-0018: Deterministic Benchmark runners

Status: Accepted

Date: 2 September 2026

## Context

Task 12 adds the two vertical-slice Benchmark definitions to the existing authoritative
`GameState`. Task 12.1 establishes the public contract and validation boundaries. Later subtasks
add deterministic commands, configuration/workload guards, sampling, progression, scoring, and
production integration through the existing command processor and `advance-tasks-and-benchmarks`
stage.

## Decisions

1. Feature gating is Research-driven. Every required Benchmark feature must be produced by at least
   one Research node and must be unlocked by a completed provider. `benchmark-peak-throughput`
   requires exactly `["peak-benchmark"]`; `benchmark-sustained-stability` requires exactly `[]`.
   Feature IDs are valid, unique, and lexically ordered. There is no separate mutable feature
   registry.
2. Benchmark cluster eligibility uses a nonempty stable-sorted set of distinct live module IDs, and
   every selected module must currently be compute-capable. The active run captures the selected
   cluster and its requested overclock settings. A captured setting must equal the current requested
   setting while the run is active. Active Benchmark runs cannot coexist with an active Task or
   active Research.
3. Tick timing is exact and deterministic. The simulator tick remains 100 ms, each duration is a
   positive safe integer number of seconds, and `durationTicks = durationSeconds * 10` must be safe.
   A later runner starts at the command's simulation tick, samples at the existing real-tick stage,
   and completes at the exact configured duration boundary. Task 12.1 defines these fields; Task
   12.3 implements command identity, Task 12.4 implements configuration/workload guards, and
   Task 12.5 owns production sampling, progression, and stage registration.
4. Telemetry is facility-wide where the contract names facility conditions: Power uses facility
   delivered totals, headroom, and energy cost; Thermal uses the maximum over the authoritative
   facility thermal tiles; and shutdown is latched from any live facility module. Useful Compute
   and stability aggregation use only the selected cluster's current-tick Compute result records.
   The runner never recalculates Power, Thermal, Overclock, or Compute, and no workload-dependent
   Power or Heat is introduced.
5. Selected-cluster aggregation is deterministic and explainable. For each selected module,
   `weight = theoreticalComputeFlops * powerFactor * thermalFactor`; Useful Compute is the sum of
   `availableComputeFlops`; retry and invalid rates are weighted by `weight`; valid rate is one
   minus weighted invalid rate, or exactly zero when total weight is zero. Peak values are maxima,
   facility Power and cost are accumulated, temperature and headroom extrema are retained, and
   shutdown is latched. Accumulated sums are divided by the exact duration tick count. Task 12.5
   implements this formula at the production stage.
6. Pass/fail comparisons are independent contract checks: average Useful Compute must meet the
   target, valid sample rate must meet its minimum, retry rate must remain below its maximum,
   maximum temperature must not exceed its limit, and shutdown is a failure unless the definition
   explicitly allows it. Failure reasons are stored once in the fixed order `average-compute`,
   `valid-sample-rate`, `retry-rate`, `maximum-temperature`, `shutdown`; `passed` is true exactly
   when the list is empty. Type-specific scoring and comparison are Task 12.2 scope.
7. Completed `BenchmarkResult` records are immutable history. Each run uses
   `benchmark-run-${sequence padded to 8 decimal digits}`, sequences start at one and are never
   reused, cancelled runs do not become partial history entries, and `bestRunByBenchmark` must
   resolve to exactly one passed result of the matching type. Exact type-specific best-run
   comparison is implemented by Task 12.2; historical records are never rewritten.
8. Configuration is locked while a Benchmark is active. The public rejection contract reserves
   `BENCHMARK_NOT_ACTIVE` and `BENCHMARK_CONFIGURATION_LOCKED` alongside
   `BENCHMARK_ALREADY_ACTIVE` and `BENCHMARK_REQUIREMENT_MISSING`. Task 12.1 adds localization and
   schema support; Task 12.3 registers START/CANCEL handlers, and Task 12.4 applies the lock to
   configuration and workload commands through their existing production handlers.
9. Stage ownership remains singular. Task 12.5 registers one canonical
   `createTaskBenchmarkTickSystems(content, options?)` factory at the existing
   `advance-tasks-and-benchmarks` slot after Compute. It calculates, validates, and applies Task
   advancement first, then calculates, validates, and applies Benchmark advancement from that
   candidate; `advance-research` follows and sees a completion in the same tick. The existing
   Task-only factory remains only for compatibility diagnostics. No second command, tick,
   sampling, or state-update path is permitted.
10. Commands and later runner stages remain atomic through the existing candidate transaction. Any
    rejection, validation failure, overflow, freeze failure, or ownership violation rolls back the
    complete candidate, tick, IDs, receipts, results, and RNG state.
11. Historical validation is structural. A historical result's metrics, cluster membership,
    operational state, Power, Thermal, Compute, and overclock settings are not reinterpreted against
    the current live facility. Historical module IDs may refer to modules later removed from layout.
    Content-aware checks are limited to the active run and known references needed for state
    integrity.
12. Benchmark calculations consume no RNG. No random failure samples are part of the Task 12
    foundation or later deterministic runner contract.
13. Performance gates preserve the simulator target of production tick p95 under 4 ms and require
    warm steady-state measurements to be reported separately from cold reconstruction/setup cost.
    Unchanged ticks use branch identity and targeted validation; full history scans and exact-best
    checks belong to construction, save, replacement, and completed Benchmark-state changes.
14. The Task 8 accepted diagnostic exception remains accepted and unchanged: the target-host pure
    overclock diagnostic measured p95 `0.2605 ms` against the nominal `< 0.25 ms` gate while warm
    production p95 passed at `2.4462 ms`. Task 12 does not alter Task 8 fixtures, thresholds,
    formulas, or diagnostics.

15. Production Task/Benchmark advancement is transactional. A one-tick private immutable evidence
    witness covers the active identity and accumulators, selected cluster, definition, current
    Compute records, facility Power, Thermal field, lifecycle state, and exact expected output.
    Evidence is cleared on success, failure, replacement, and runtime reset; it never enters
    `GameState`, serialization, hashes, saves, replay, receipts, or public contracts. Structural
    production stages preserve the Benchmark branch by identity. Mixed mutable diagnostics use a
    detached exact-output fingerprint so later history or best-run replacement rolls the tick
    back. Any Task/Benchmark calculation, validation, application, or ownership failure rolls back
    the entire candidate while preserving the prior tick, clock, RNG, and completed history.

16. Task 12.6 performance hardening is private and semantics-preserving. Verified immutable
    active, facility, Compute, and Benchmark branches may use identity evidence and cached
    successful validation; mutable direct callers retain deterministic dependency fingerprints.
    Stable active cluster and overclock-summary subbranches are reused only after immutability is
    proven. No cache or witness is authoritative state, and no full-history scan is added to warm
    unchanged production ticks.

17. The permanent Benchmark diagnostic extends the audited dense 24 by 16 Task 7/8/9 fixture
    without reducing its workload: at least 75% occupied tiles, mixed footprints and rotations,
    real Power routes and contention, local airflow and extraction, nonuniform temperatures,
    Overclock stability, Useful Compute, Task, and Research production stages. It measures pure
    sample/advance, combined Task/Benchmark advancement, active production, exact Peak and
    Sustained completion, failed multi-reason completion, fresh-witness validation, both command
    paths, and cold construction/replacement with realistic history. It reports median, p95,
    maximum, sample count, CPU, operating system, Node version, build mode, and warm-up method;
    fixture creation and documented JIT warm-up are excluded, and no sample is filtered.

18. The Task 12 hard gates on Intel i7-2600 remain pure Benchmark sample/advance p95 below
    `0.10 ms`, combined Task plus Benchmark advancement p95 below `0.25 ms`, and complete active
    Benchmark production tick p95 below `4 ms`. The permanent diagnostic records the unchanged
    Task 8 nominal pure-path exception accepted at Task 11: p95 `0.2605 ms` against `< 0.25 ms`.
    Task 12 does not alter Task 8 semantics, fixture, samples, warm-up, threshold, or assertions.

## Compatibility

The additive `nextBenchmarkRunSequence` and Benchmark state/result fields intentionally change
serialized full-state vectors. No supplied balancing, module, or Benchmark numeric values changed,
and behavioral projections that explicitly remove the new Benchmark branch remain unchanged.

| Fixture | Previous hash | Current hash | Structural reason |
| --- | --- | --- | --- |
| Task 7 projection without Compute | `3981c87f4603e9fd` | `aa48404b98aa1e48` | Authoritative Benchmark state now serializes `nextBenchmarkRunSequence`. |
| Task 8 projection without Compute | `6a3d11ce3e14ca83` | `62fc84b28af4a39c` | Authoritative Benchmark state now serializes `nextBenchmarkRunSequence`. |
| Task 7 full state | `7157962fe832def9` | `40a2e2270c2ba2bc` | Authoritative Benchmark state now serializes `nextBenchmarkRunSequence`. |
| Task 8 full state | `50e67e1213179a35` | `97acfaa5ef64627e` | Authoritative Benchmark state now serializes `nextBenchmarkRunSequence`. |
| Task 10 lifecycle | `bc23753d687706dc` | `046b2a57813e53a9` | Authoritative Benchmark state now serializes `nextBenchmarkRunSequence`. |

These are shape changes only. Supplied balancing values, module values, Task 7/8 behavior, prior
Research behavior, GDD content, and Word-document bytes remain unchanged.

Task 12's exact 150-tick Peak pure-domain vector ends with `71d63abb2a2c8cb6`, and its exact
1,200-tick Sustained pure-domain vector ends with `9865fdde48a6deb6`. These hashes cover the new
Benchmark result/history state. Task 12.6's private evidence, validation caches, stable-key caches,
and structural-sharing paths do not enter authoritative state and do not alter either vector.

## Task 12 decomposition and deferred scope

Task 12.1: contract, content, state, validation, localization, compatibility, and no runtime
behavior.

Task 12.2: type-specific scoring, pass/fail comparison, and exact best-run calculation.

Task 12.3: `START_BENCHMARK`, `CANCEL_BENCHMARK`, deterministic run identity, and atomic command
path.

Task 12.4: configuration and workload exclusivity guards for live overclock configuration, live
design application, Research start, and Task activation/resume.

Task 12.5: transactional Task/Benchmark production integration, deterministic facility telemetry
sampling, selected-cluster aggregation, exact completion/progression, history and best-run
application, Research visibility, rollback, lifecycle coordination, and stage ownership.

Task 12.6: final performance hardening, compatibility/documentation closeout, and complete
verification. It must not weaken or remove the Task 12 sampling, progression, scoring, or
rollback contract established by the earlier subtasks.

UI, events, leaderboards, saves/replay, workers, workload-dependent Power/Heat, random failures,
and Task 13 remain deferred. Task 12 is complete at its checkpoint-neutral boundary. No Task 13
implementation is included or approved by this decision.
