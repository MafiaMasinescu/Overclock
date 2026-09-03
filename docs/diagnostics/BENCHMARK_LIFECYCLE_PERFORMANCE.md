# Benchmark lifecycle performance diagnostic

Run the permanent diagnostic with:

```powershell
corepack pnpm performance:benchmarks
```

The diagnostic extends the audited Task 7/8/9 production fixture without reducing its workload:
the facility is 24 by 16 tiles with at least 75% occupied tiles, mixed footprints and rotations,
real Power routes and shared contention, local airflow and extraction, nonuniform temperatures,
Overclock stability, Useful Compute, Task, and Research production stages. Peak and Sustained
Benchmark definitions are structurally valid variants of the same fixture. The runner uses no RNG,
wall-clock simulation input, browser API, storage, worker, or benchmark-specific semantic change.

## Measured paths

Each path reports median, p95, maximum, and sample count. The fixed counts are:

- 1,000 warm pure Benchmark sample/active-run advancement samples;
- 1,000 warm combined Task plus Benchmark advancement samples;
- 200 complete production ticks with an active Sustained Benchmark;
- 200 Peak completion samples and 200 Sustained completion samples, each seeded immediately before
  its exact final sample;
- 200 failed multi-reason completion samples;
- 200 exact fresh-witness validation samples;
- 200 `START_BENCHMARK` and 200 `CANCEL_BENCHMARK` command samples;
- 200 cold constructions and 200 state replacements with 100 realistic historical results.

Fixture construction and 100 documented JIT warm-up iterations per path are outside timed samples.
Command timings include enqueue/process work and exclude core construction, matching the existing
lifecycle diagnostics. Completion timings include transition/result append, best-run comparison,
and fresh validation. No timed sample is filtered. The diagnostic also prints an inactive full-tick
baseline and internal stage timing for the warm-path ownership audit.

## Audited result

Environment: Intel(R) Core(TM) i7-2600 CPU @ 3.40 GHz; Windows `win32 10.0.19045 x64`; Node
`v24.11.0`; `NODE_ENV=unset`; Node TypeScript type stripping with V8 JIT. Warm-up method: 100
unmeasured iterations per direct path; fixture and diagnostic setup excluded; no sample filtered.

| Path | Median (ms) | p95 (ms) | Maximum (ms) | Samples |
| --- | ---: | ---: | ---: | ---: |
| Pure Benchmark sample/active-run advancement | 0.0622 | 0.0965 | 3.2767 | 1,000 |
| Pure Benchmark sample only | 0.0308 | 0.0461 | 3.6303 | 1,000 |
| Active Benchmark stored validation only | 0.0121 | 0.0291 | 1.6679 | 1,000 |
| Active Benchmark content-aware validation only | 0.0264 | 0.0381 | 1.3787 | 1,000 |
| Stored Task validation only | 0.0024 | 0.0033 | 0.0621 | 1,000 |
| Stored Research validation only | 0.0035 | 0.0064 | 0.2163 | 1,000 |
| Combined Task plus Benchmark advancement | 0.1171 | 0.2146 | 2.3245 | 1,000 |
| Complete production tick with active Benchmark | 2.1866 | 3.8753 | 16.3004 | 200 |
| Complete production tick without active Benchmark baseline | 1.2650 | 2.1593 | 37.6795 | 200 |
| Combined stage internal timing | 0.1640 | 0.3193 | 27.1330 | 300 |
| Research stage internal timing | 0.0458 | 0.0850 | 1.0127 | 300 |
| Peak completion path | 0.0669 | 0.1345 | 0.2903 | 200 |
| Sustained completion path | 0.0603 | 0.1575 | 0.5463 | 200 |
| Failed multi-reason completion | 0.0973 | 0.1601 | 5.1635 | 200 |
| Exact fresh-witness validation | 0.0006 | 0.0007 | 0.0334 | 200 |
| `START_BENCHMARK` command path | 8.4006 | 12.5736 | 19.7555 | 200 |
| `CANCEL_BENCHMARK` command path | 7.2341 | 11.5888 | 14.1616 | 200 |
| Cold construction with realistic history | 19.4657 | 29.0705 | 36.1181 | 200 |
| State replacement with realistic history | 18.5383 | 29.1876 | 32.0805 | 200 |

The Intel i7-2600 hard gates are pure sample/advance p95 below `0.10 ms`, combined Task plus
Benchmark advancement p95 below `0.25 ms`, and complete active production p95 below `4 ms`. The
audited run passes all three. The Task 8 nominal pure gate remains separately documented as an
accepted unchanged exception at p95 `0.2605 ms`; it is not a Task 12 failure and no Task 8 fixture,
threshold, sample count, warm-up, or implementation was changed.

## Contract covered by the diagnostic

For selected module `i`, `weight_i = theoreticalComputeFlops_i * powerFactor_i * thermalFactor_i`.
Useful Compute is the sum of selected `availableComputeFlops_i`; retry and invalid rates are
weight-averaged, and valid rate is `1 - invalidRate`, or exactly zero when total weight is zero.
Power delivered, headroom, energy cost, maximum temperature over every authoritative thermal tile,
and shutdown detection are facility-wide. Accumulation advances one 100 ms sample, uses exact
microdollar helpers for cost, and completes only at `durationSeconds * 10` samples.

Failure checks use inclusive compute, valid-rate, retry-rate, and temperature comparisons, with
shutdown allowed only by content. Failure reasons are stored once in fixed order:
`average-compute`, `valid-sample-rate`, `retry-rate`, `maximum-temperature`, `shutdown`.

Only passed records are eligible for best-run selection. Peak comparison is average Useful Compute,
peak Useful Compute, valid rate, retry rate, average Power, minimum headroom, maximum temperature,
then cost. Sustained comparison is average Useful Compute, retry rate, valid rate, average Power,
minimum headroom, maximum temperature, cost, then peak Useful Compute. Exact ties retain the earlier
run and failed results never replace a best run.

The command path uses deterministic padded run IDs and FIFO candidate transactions. One Benchmark
is active at most; live Overclock changes, `APPLY_DESIGN`, Research start, and Task activation or
resume are locked during a run, while draft edits, Task acceptance/abandonment, and cancellation
remain allowed. The combined stage applies Task first and Benchmark second; Research follows.
Fresh evidence is private, immutable, generation-specific, excluded from state/serialization/hash/
save/replay/receipts, and cleared on success, failure, replacement, and runtime reset. Historical
records are structural history and are not reinterpreted against current modules, Compute, Power,
Thermal, lifecycle, or Overclock state.

Deferred scope remains workload-dependent Power/Heat, random failure samples, UI, events,
leaderboards, saves/replay, workers, and later phase behavior.

Task 12 is complete at its checkpoint-neutral boundary. No Task 13 implementation is included in
this diagnostic or approved by the Task 12 contract.
