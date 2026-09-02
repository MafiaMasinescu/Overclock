# Research lifecycle performance diagnostic

Run the permanent diagnostic with:

```powershell
corepack pnpm performance:research
```

The diagnostic reuses the dense production fixture used by Tasks 7 through 10: a 24 by 16
facility with 110 modules, realistic Power and data routes, contention, nonuniform temperatures,
Overclock inputs, two active Tasks, and the complete Power, Thermal, Overclock, Compute, Task, and
Research stage path. Its scenario coverage also includes a nonzero Research reservation and
progress, Task Evidence Tag completion, cancellation and restart, a completion transition, and
the final reveal with the fixed Museum snapshot. Fixture construction, held-state preparation,
command construction, and JIT warm-up are outside every timed interval.

The measured sample counts are fixed: 1,000 pure reservation-helper samples, 1,000 pure Research
lifecycle samples, 500 warm Task 9 Compute samples with Research, 200 warm full production ticks,
200 progress-only Compute cache-hit samples, 200 start/cancel/share-change recalculation samples,
200 Research completion samples, 200 final Museum samples, and 200 forced exact witness and
ownership-validation samples. Every sample remains in the median, p95, and maximum report; no
outlier filtering or benchmark-specific fixture changes are permitted.

The latest audited run on 2 September 2026 reported:

| Path | Median (ms) | p95 (ms) | Maximum (ms) | Samples |
|---|---:|---:|---:|---:|
| Pure Research reservation helpers | 0.0021 | 0.0048 | 0.0966 | 1,000 |
| Pure Research lifecycle advancement | 0.0286 | 0.0719 | 1.2502 | 1,000 |
| Warm Task 9 Compute with Research | 0.0526 | 0.1082 | 0.8632 | 500 |
| Warm full production tick | 2.1426 | 2.9352 | 11.5366 | 200 |
| Progress-only Compute cache hit | 0.2986 | 0.4642 | 6.3279 | 200 |
| Start/cancel/share-change recalculation | 16.8415 | 37.0887 | 50.2164 | 200 |
| Research completion transition | 12.1525 | 17.2324 | 24.1888 | 200 |
| Final reveal and Museum creation | 12.3856 | 18.7767 | 26.0577 | 200 |
| Forced exact witness and ownership validation | 0.5050 | 0.7442 | 1.0555 | 200 |

Environment: Intel Core i7-2600 @ 3.40 GHz; Windows `win32 10.0.19045 x64`; Node `v24.11.0`;
`NODE_ENV=unset`; Node TypeScript type stripping with V8 JIT; 100 warm-up iterations excluded.

The i7-2600 hard gates are pure reservation p95 below `0.05 ms`, pure Research lifecycle p95
below `0.15 ms`, warm Task 9 Compute p95 below `0.35 ms`, and complete production p95 below
`4 ms`. The preferred complete-production target is p95 below `3 ms`; the recorded run reports
that target without treating it as a blocking gate. Existing Task 8, Task 9, Task 10, and Thermal
diagnostics retain their independent sample counts and gates.

The final checkpoint review also ran those independent diagnostics. Task 8's unchanged pure-domain
path reported median/p95/max `0.1045/0.2605/1.5377 ms` over 500 samples, exceeding its nominal
`< 0.25 ms` p95 gate by `0.0105 ms`; its warm production path passed at p95 `2.4462 ms`. This is an
explicitly accepted checkpoint irregularity, not a threshold or fixture change. Thermal passed with
pure median/p95/max `0.1691/0.2706/0.8587 ms` over 500 samples and production p95 `1.8368 ms` over
200 samples.

Research reservation is global: `R = active.reservedComputeShare`, `researchFactor = 1 - R`,
`effectiveTaskShare = requestedShare * researchFactor`, and Research delivery is
`facilityTotalAvailableComputeFlops * R`. Compute derives the facility available value after
Power, Thermal, and Stability, then applies Research before Power, Thermal, Memory, Interconnect,
Suitability, and Stability. Memory capacity is unscaled; Research delivery is excluded from the
Task useful-delivery total. The diagnostic does not change these formulas, content values, fixture
density, validation, or determinism repetitions to meet a threshold.
