# Phase 2 persistence diagnostics

Updated: 2026-09-25

These measurements cover the Task 20 normal N save, autosave, load, import, and recovery paths.
They use the production Worker client with real Chromium Worker, IndexedDB, Web Locks, and browser
crypto. Fixture seeding is outside the timed samples; each measured operation includes its required
capture, verification, transaction, or Worker startup work.

## Commands and cohorts

Run the Worker persistence smoke and persistence-control UI checks with:

```powershell
corepack pnpm exec playwright test --workers=1 tests/e2e/workerPersistence.spec.ts tests/e2e/persistenceControls.spec.ts
```

Run the target-host N cohort with:

```powershell
corepack pnpm exec playwright test --workers=1 tests/e2e/persistencePerformance.spec.ts
```

The N state reuses the admitted 24 × 16 dense fixture: at least 288 occupied tiles, active Power,
Thermal and Compute state, two Tasks, active Research, eight valid Blueprints, and representative
Benchmark history. The uncompressed save envelope is 113,341 bytes. Saves use the production
uncompressed format. The import target is a separate inactive slot.

Manual save, autosave, load, import preview, and import confirmation each use 20 warm-up and 200
measured samples. Autosave samples follow a committed pause change so each is a distinct dirty
generation; its cohort includes autosave rotation. Load samples include candidate decode/admission,
new-epoch promotion and full `READY`. Import preview includes decode and admission; confirmation
includes the durable commit. Recovery has five warm-up and 50 measured samples; every sample starts
a fresh Worker and includes database verification, recovery admission, and full `READY`. The
five-warm-up recovery samples are excluded from the reported cohort.

## Host and browser

- Classification: verified target.
- CPU: Intel Core i7-2600 @ 3.40 GHz, 4 cores / 8 logical processors.
- OS: Windows 10 Pro x64, build 19045.
- Active power plan: Balanced.
- Node: v24.11.0; pnpm: 11.22.0; Playwright: 1.62.1.
- Browser: Chromium 151.0.7922.34; `hardwareConcurrency`: 8.
- The diagnostic ran with one Playwright worker and no parallel benchmark. The page remained in the
  foreground for the measured operations.

## Measured evidence

All budgets are p95 gates from the Phase 2 contract. Maximums are reported as diagnostics and are
not substituted for the p95 acceptance criteria.

| Path | Samples / warm-up | Median | p95 | Maximum | p95 budget |
|---|---:|---:|---:|---:|---:|
| Manual save N | 200 / 20 | 47.3 ms | 60.8 ms | 70.6 ms | <250 ms |
| Autosave N, including rotation | 200 / 20 | 54.9 ms | 80.6 ms | 258.0 ms | <250 ms |
| Load N through full `READY` | 200 / 20 | 107.3 ms | 118.6 ms | 126.8 ms | <500 ms |
| Import preview N | 200 / 20 | 107.1 ms | 121.3 ms | 145.3 ms | <1,000 ms |
| Confirm import N to commit | 200 / 20 | 42.1 ms | 51.2 ms | 59.2 ms | <250 ms |
| Fresh Worker recovery N | 50 / 5 | 648.8 ms | 763.5 ms | 939.0 ms | <1,500 ms |

Every CP20 measured p95 passed its unchanged budget. Autosave had one 258.0 ms maximum above the
250 ms numeric threshold; the contract gates p95, so this outlier remains visible rather than being
reported as a p95 miss. A separate isolated CP20 run also passed: p95 manual 58.2 ms, autosave
61.6 ms, load 120.9 ms, preview 121.2 ms, confirm 50.7 ms, recovery 740.2 ms. The prior Task 20
implementation cohort reported p95 62.7, 67.3, 143.5, 131.9, 58.0, and 804.5 ms respectively.

The first CP20 full Chromium run passed 36/37 tests. During the measured persistence test, a source
edit triggered Vite HMR and destroyed its `page.evaluate` context after about 1.2 minutes; it
produced no acceptance measurement. After source edits stopped, the isolated persistence test passed
1/1 and the complete serial Chromium suite passed 37/37 in 5.1 minutes. The same full run recorded
Worker/direct parity at tick 12,000/year 1947, RNG 1720442453, state hash
`5f0c57e688e6a693`, and tick 24,000/year 1948, state hash `ff38b6a736a2ffb0`.

The browser user agent was `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
(KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36`.

## Final staged-source audit

After the last import lock-release correction, the affected Chromium set passed 14/14 with one
worker. Its N p95 values were 50.0 ms manual save, 56.9 ms autosave, 104.1 ms load, 110.2 ms import
preview, 43.6 ms import confirmation, and 617.7 ms fresh-Worker recovery. The cohort used the same
113,341-byte envelope and 200/20 or 50/5 sample counts shown above. Real IndexedDB quota,
upgrade, rotation, two-tab writer exclusion, page-death fencing, and raced overwrite tests passed.

The affected prior projection diagnostic first missed N `project-publish-encode` at p95 2.0276 ms
against `<2 ms`. An immediate isolated rerun missed it at 2.6149 ms, while the unchanged CP19
checkout also missed at 2.7275 ms. A five-second process sample found Opera consuming 9.70 CPU
seconds and ChatGPT 4.93 CPU seconds on the 4-core/8-thread target. After the user paused the busy
Opera activity, the unchanged staged Task 20 source passed all enforced projection gates: N pure
project 0.7104 ms (`<1`), project/publish/encode 1.5671 ms (`<2`), direct tick 2.0276 ms (`<4`),
combined tick/projection 3.2481 ms (`<6`), and store apply 2.4669 ms (`<5`). Cold production-core
construction was measured separately at p95 11.1341 ms without excluded warm-up. The initial
misses remain recorded as host-load-sensitive failures, rather than rewritten as passes.

Replay diagnostics on the busy host reported playback p95 8.8145 ms against the `<5 ms` target
reference, though that script returned success. With Opera paused, direct tick p95 was 2.3084 ms
(`<4`), recording tick 2.1030 ms (`<5`), and playback 1.6419 ms (`<5`); cold core construction
was separately 28.9840 ms p95. The codec diagnostic passed N canonical encode p95 13.7028 ms,
SHA-256 1.3789 ms, and gzip encode/decode 4.0675/5.7451 ms. The in-memory repository diagnostic
passed and separated N preparation p95 89.2449 ms from manual transaction commit 2.0377 ms and
autosave rotation commit 9.0489 ms; real IndexedDB evidence is the Chromium cohort above.

## Task 21 CP21 browser and soak evidence

Updated 2026-09-25. The 40-case serial Chromium run passed 39 tests and failed the Worker
publication diagnostic while draining two ACKs. The persistence N cohort measured manual save,
autosave including rotation, load through full `READY`, import preview, import confirmation, and
fresh-Worker recovery p95s of 60.3, 70.0, 128.8, 127.5, 53.5, and 818.9 ms respectively. Each is
below its unchanged p95 budget (250, 250, 500, 1,000, 250, and 1,500 ms). This entire host run is
informative because installed RAM was 16 GiB against the contract's 8 GiB target.

The added real-Worker mid-Replay checkpoint/recovery test passed, as did the one-cycle soak smoke.
The full 60-minute soak completed 60 of 60 one-minute cycles, persisted and read back each cycle,
and completed cleanup with at most three scheduler timers and zero pending requests, commands, or
ACKs at its samples. Chromium working set ranged 285.3–337.5 MB; renderer heap ranged 19.3–23.1 MB.
Both remained below the 500 MiB budget. Worker heap was unavailable from Chromium on this Windows
host. Full sample series and slope are in `PHASE_2_TASK_21.md`.

The final Task 21 full-suite rerun passed 40/40 and measured a fresh persistence N cohort. Values
below are median / p95 / maximum milliseconds:

| Path | Samples / warm-up | Median | p95 | Maximum | p95 budget |
|---|---:|---:|---:|---:|---:|
| Manual save N | 200 / 20 | 54.0 | 64.1 | 74.4 | <250 ms |
| Autosave N, including rotation | 200 / 20 | 57.4 | 71.8 | 101.7 | <250 ms |
| Load N through full `READY` | 200 / 20 | 124.3 | 156.0 | 380.3 | <500 ms |
| Import preview N | 200 / 20 | 122.5 | 156.8 | 171.5 | <1,000 ms |
| Confirm import N to commit | 200 / 20 | 46.9 | 63.7 | 86.9 | <250 ms |
| Fresh Worker recovery N | 50 / 5 | 698.0 | 983.2 | 1,507.3 | <1,500 ms |

Every final-run p95 was within its unchanged budget. The recovery maximum exceeded the p95 budget,
but the contract gates p95; the maximum is retained here as diagnostic evidence. The final soak's
Chromium working set was first 324.4 MB, last 289.0 MB, minimum 244.2 MB and maximum 336.5 MB
(net -35.4 MB; OLS slope -81.9 MB/hour). Renderer heap was first 19.3 MB, last 23.1 MB, minimum
19.3 MB and maximum 23.1 MB (net +3.8 MB; OLS slope +5.1 MB/hour). Worker heap was unavailable.
As above, these results do not certify the contract's exact 8 GiB host.
