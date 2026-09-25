# Phase 2 Task 21 integration diagnostics

Updated: 2026-09-25

Task 21.1 and 21.2 evidence based on CP20
`7dc99c4915caf520199589f807ef70ec66c6518a`. CP21 is the commit containing this reviewed report.

## Host and classification

- CPU: Intel Core i7-2600 @ 3.40 GHz, 4 cores / 8 logical processors.
- OS: Windows 10 Pro x64, build 19045.
- RAM: 16 GiB installed (17,161,457,664 bytes); the Phase 2 contract specifies 8 GiB.
- Node v24.11.0; pnpm 11.22.0; Playwright 1.62.1; Chromium 151.0.7922.34.
- Browser `hardwareConcurrency`: 8; serial Playwright worker; foreground page.

The CPU, OS, Node and browser match the named environment. The RAM does not. Results from this
machine are therefore informative, not exact target-host certification. Some legacy diagnostics
label their own result `target: PASS` after checking only CPU/OS; that script-local label does not
override the contract's 8 GiB requirement. No thresholds or sample counts were changed.

## Browser integration and soak

`corepack pnpm exec playwright test --workers=1` ran 40 Chromium cases: 39 passed and the Worker
performance diagnostic failed. The 60-minute soak completed all 60 one-minute cycles and its
destruction checks passed. It kept one Worker, at most three scheduler timers, and zero pending
ACKs, held ACKs, requests, or commands at each sample.

| Soak measurement | First | Last | Minimum | Maximum | Net change | OLS slope / hour |
|---|---:|---:|---:|---:|---:|---:|
| Chromium process working set | 324.7 MB | 285.3 MB | 285.3 MB | 337.5 MB | -39.4 MB | -56.1 MB |
| Renderer JavaScript heap | 19.3 MB | 23.1 MB | 19.3 MB | 23.1 MB | +3.8 MB | +5.1 MB |

Both series stayed below 500 MiB. Chromium did not expose Worker heap on this Windows run. The
soak's budget comparison is informational because installed RAM differs from the target.

The new real-Worker mid-Replay test passed: it wrote and read a quiescent checkpoint with the
captured queue sequence, recovered into a new Worker, and compared the exact suffix against the
uninterrupted Replay and direct final state. The one-cycle persistence-soak smoke also passed.
Existing browser cases passed for quota/transaction faults, upgrades, two-tab locks, page-death
fencing, worker crash/messageerror, delayed ACK resync, 20 Worker destroy cycles, and Worker/direct
Campaign parity at ticks 12,000 and 24,000. The new cross-domain codec round-trip tests cover active
Task/Research, separate active Benchmark, Design draft/undo/redo history, historical Benchmark, and
high-ID Blueprint state. Timestamp rollback recovery is covered by a focused unit regression.

### Worker publication diagnostic

The full browser run reached 600 single-step publication samples but timed out draining two
publication ACKs. The unchanged isolated diagnostic was then run twice. Both isolated runs drained
ACKs and completed every fixed cohort, but failed the dense-N main-thread publication p95 gate:

| Isolated run | Idle command p95 | Direct tick p95 | Combined tick/projection p95 | Main-thread publication p95 | Worker post p95 | Foreground visible p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 5.9 ms | 1.8 ms | 3.7 ms | 5.0 ms | 0.4 ms | 105.0 ms |
| 2 | 6.3 ms | 1.8 ms | 3.8 ms | 5.2 ms | 0.4 ms | 105.7 ms |

Main-thread publication budget is `<5 ms`; both isolated results miss it (the first is exactly
5.0 ms). Sample counts remained 200 idle, 500 direct tick, 500 combined tick/projection, 100 warm-up
plus 500 measured publications, and 200 visible-latency samples. The misses are preserved; this
host cannot certify the 8 GiB target.

## Phase 1 diagnostic inventory

All 16 permanent Phase 1 diagnostics ran serially with their unchanged fixtures and sample counts.
All rows below are median / p95 / maximum in milliseconds. Cold or large-state paths are separate
rows where the diagnostic defines them. The machine classification caveat above applies to every
measurement, including scripts that report their own CPU/OS-only target classification.

| Diagnostic | Principal warm or complete path(s) | Cold / large path(s) | Outcome |
|---|---|---|---|
| `performance:design` | Enter draft 10.8549 / 16.9436 / 25.2316 (200); place 11.8848 / 21.7081 / 51.7192; move 11.5566 / 22.1229 / 36.1106; rotate 11.2665 / 24.7539 / 31.7236; remove 11.7124 / 18.9839 / 36.5931; undo 11.3493 / 22.4403 / 36.5876; redo 11.8156 / 22.9183 / 33.7365. | — | Completed; script labels report-only. |
| `performance:apply` | Apply preview 24.7507 / 59.3213 / 209.1960 (200); successful Apply 57.0130 / 76.0726 / 88.4356. | — | Completed; script labels report-only. |
| `performance:routing` | Connect 6.9865 / 13.1171 / 93.7439 (200); disconnect 6.1864 / 12.2398 / 35.2820. | — | Completed; report-only. |
| `performance:grid` | Occupancy 0.5366 / 1.0270 / 6.7956 (500); dense placement 0.4127 / 1.0374 / 2.4805. | Adjacent-port graph 9.4500 / 14.0288 / 18.9296 (40). | Completed; report-only. |
| `performance:tick` | Empty pipeline 0.0136 / 0.0384 / 3.9657; controlled fixture 5.3031 / 9.4764 / 28.8066. | — | Completed; report-only. |
| `performance:power` | Warm topology/result cache 0.0006 / 0.0012 / 0.1674 (500). | Cold topology 1.7422 / 3.2937 / 6.4114 (200). | Script hard target passed; full-host classification remains informative. |
| `performance:power-tick` | Complete tick 0.0272 / 0.0754 / 0.7075; dirty-path recalculation proxy 0.2511 / 0.6725 / 4.6142; startup-completion tick 1.2834 / 2.8290 / 6.0370; following recalculation tick 1.7385 / 3.3009 / 8.8548 (200 each). | — | Script hard target passed; full-host classification remains informative. |
| `performance:overclock` | Pure domain 0.0997 / 0.1951 / 0.9358 (500); warm production tick 0.9546 / 1.9813 / 39.9039; profile transition 12.1221 / 19.6134 / 31.5315; Manual transition 11.2660 / 21.7095 / 41.4622 (200 each). | Cold topology plus replacement 15.2651 / 23.4724 / 119.4003 (200). | Script hard and preferred targets passed. |
| `performance:compute` | Pure Task 9 calculation 0.0938 / 0.2148 / 2.6726 (500); complete production tick 1.3026 / 2.7818 / 19.8358 (200); congestion recalculation 0.0577 / 0.1210 / 0.9553. | Cold Compute topology 0.1658 / 0.4817 / 3.3165 (200). | Script hard and preferred targets passed. |
| `performance:thermal` | Pure heat/update 0.1207 / 0.3288 / 1.3113 (500); Power+Thermal production tick 0.6145 / 1.2041 / 37.4697 (200); dirty-layout tick 2.8143 / 5.7141 / 24.2146. | Cold Thermal topology 0.3447 / 0.8081 / 2.5892 (200). | Script hard targets passed; preferred path is report-only. |
| `performance:tasks` | First production p95 5.0731 ms against `<4 ms`; isolated unchanged rerun 1.3577 / 2.3445 / 18.8753 (200). Pure advancement on rerun 0.0172 / 0.0651 / 0.9385 (1,000). | — | First miss preserved; isolated rerun passed hard and preferred production gates. |
| `performance:research` | Pure lifecycle 0.0229 / 0.0615 / 0.7821 (1,000); complete production tick 1.5757 / 3.0727 / 15.1488 (200); progress-only Compute cache hit 0.3722 / 0.6529 / 3.9029. | Start/cancel/share-change 16.4957 / 39.4740 / 71.3968; completion 12.5650 / 18.9588 / 44.8375; final reveal/Museum 11.8354 / 22.4032 / 85.0016 (200 each). | Script hard targets passed. |
| `performance:benchmarks` | Pure sample+advancement 0.0581 / 0.1013 / 1.8007 (1,000); production tick with active Benchmark 1.3628 / 2.9822 / 38.5721 (200). | Cold construction with history 21.0854 / 30.8523 / 39.8537 (200). | Preserved owner-accepted pure Benchmark miss: 0.1013 ms versus `<0.10 ms`; combined and production gates passed. |
| `performance:blueprints` | Capture 0.4938 / 1.1171 / 24.1206 (1,000); materialization 2.5160 / 4.4066 / 22.0493; Instantiate 11.3943 / 17.3404 / 31.2463; production tick with 128 records 0.7828 / 1.9941 / 75.9119 (200). | Cold construction 201.8838 / 259.1146 / 440.3247; replacement 166.4921 / 231.8343 / 460.8785 (200). | Listed hard p95 targets passed. |
| `performance:replay` | Direct tick 1.5972 / 3.2121 / 16.1585; recording tick 1.7516 / 3.8833 / 46.3139; playback tick 1.9064 / 3.9232 / 54.0613 (200 each). | Full-state checkpoint input 47.0783 / 59.7970 / 71.0220; end-to-end Replay 106.7349 / 137.9949 / 212.1363; resume verification 128.0670 / 162.0477 / 291.7625 (200). | Script references passed; exact 8 GiB target not certified. |
| `balance:milestones` | Production tick 2.7451 / 4.9728 / 25.6839; Replay recording tick 2.7197 / 4.9287 / 18.7287; playback tick 2.7147 / 4.6005 / 21.6442 (200 each). | Full deterministic three-policy run plus duplicate baseline; baseline completed tick 30,270 with Phase 1 frozen hashes. | New production p95 miss: 4.9728 ms versus `<4 ms`; diagnostic exited nonzero. |

The milestone baseline completed with matched Replay, duplicate baseline hashes, initial/final RNG
`1853565737`, state hash `43f71088b7b8afe6`, Replay hash `a1a59919e8295897`, report hash
`f2be68edc3374681`, and comparison hash `957959d2decef0e1`. The run reproduced the published
Campaign transitions at ticks 12,000 and 24,000 and completed at tick 30,270. Its production-tick
timing miss remains a miss.

## Phase 2 diagnostic detail

The fresh save-codec and save-repository N/L rows, projection gate misses and follow-up, Worker-host
measurements, and the full browser results are appended to their focused diagnostics:

- `PHASE_2_SAVE_CODEC.md`
- `PHASE_2_REPOSITORY.md`
- `PHASE_2_PROJECTION.md`
- `PHASE_2_WORKER.md`
- `PHASE_2_PERSISTENCE.md`

## Candidate disposition

Correctness suites and the full 60-minute browser soak passed. The initial Task 21 full Chromium run
passed 39/40 after the Worker diagnostic timed out draining two ACKs. Two isolated runs then drained
ACKs but missed the dense-N main-client publication p95. After the final fixture formatting and lint
corrections, the complete serial Chromium suite passed 40/40; main-client publication p95 was
4.4 ms against `<5 ms`, and all final-run browser cohorts passed their unchanged gates. The earlier
ACK timeout and isolated p95 misses remain preserved. The Task lifecycle transient miss passed its
unchanged isolated rerun; the projection miss reproduced on its isolated rerun; the Task 15 milestone
production-tick p95 also missed. The accepted pure Benchmark miss remains unchanged.

The final CP21 gates passed two independent complete `corepack pnpm test` processes (each 88
unit files / 1,511 tests and 16 determinism files / 25 tests), standalone `corepack pnpm
test:determinism`, `corepack pnpm validate`, and serial `corepack pnpm exec playwright test
--workers=1` (40/40). The latter includes the 60/60 persistence soak. Exact-source simulator API,
production-to-devtools import, production-bundle marker, gameplay-source, Word-file and diff checks
were clean. Content validation is part of `validate`. Compatibility vectors, exact-100 schedules,
recovery ordering, ownership/security/corruption, browser concurrency and cleanup are covered by the
passing suites. The final host/browser cohort details are in `PHASE_2_WORKER.md` and
`PHASE_2_PERSISTENCE.md`.

The exact 8 GiB target host was not available: this machine has 16 GiB installed. Consequently none
of its performance measurements certifies the contract target, even though the final available-host
run passed. The two earlier isolated publication p95 misses, projection misses, Task transient miss,
Task 15 milestone miss, and accepted Benchmark miss remain recorded. No threshold, sample count,
fixture, timeout or performance result was changed to manufacture a pass.

After this limitation and the preserved misses were reported, the owner explicitly authorized CP21
on 2026-09-25. This is a checkpoint decision with the non-target evidence retained; it does not
reclassify the host or any missed measurement as a target pass.

The Task 21 implementation and CP21 review are complete on the available host, but exact target-host
budget evidence remains unavailable. Phase 3 has not begun; entry still requires the separate final
read-only Phase 2 closure audit and explicit approval.
