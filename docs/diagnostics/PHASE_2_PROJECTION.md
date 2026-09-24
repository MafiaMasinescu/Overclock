# Phase 2 projection diagnostic

Run `corepack pnpm performance:projection` on the target Intel i7-2600. The script identifies CPU, OS and Node, emits every row as JSON, and exits nonzero if a hard target-host p95 budget is missed. Other hosts are informational. No sample is filtered and a failed measurement is not a pass.

## Fixture and measured boundaries

N is a production-admitted 24 × 16 facility with at least 300 occupied tiles, mixed module footprints and rotations, real Power and data routes, nonuniform temperatures, Overclock, Useful Compute, two active Tasks, active Research, eight current-content-validated subassembly Blueprints, and two completed Benchmark history records with best mappings. Active Task and Research are compatible; an active Benchmark is excluded because it conflicts with the active workloads. L holds 128 validated Blueprint records and is report-only. Fixture creation and cold construction occur outside the timed samples.

| Measured path | Samples / warm-up | Hard p95 budget |
| --- | ---: | ---: |
| Pure projector N | 500 / 100 | <1 ms |
| Project + publish + canonical encode + ACK N | 500 / 100 | <2 ms |
| Store construction + full apply N | 500 / 100 | <5 ms |
| Direct complete production tick N | 200 / 100 | <4 ms |
| Complete production tick + due presentation N | 500 / 100 | <6 ms |
| Pure projector and publication L | 50 / 5 | report-only |

The publication path alternates two admitted, deeply frozen states that share unchanged layout branches and differ in eight tile temperatures by more than epsilon. It measures a due delta, canonical encoding and acknowledgement on each iteration. The store path constructs a new store and applies one complete, owned full publication per sample. The direct and combined tick paths use `createProductionSimCore`, including Power, Thermal, Overclock, Compute, Task/Benchmark, Research and Campaign. Setup, cold construction, initial full publication and rare transition paths are not represented by the warm delta budget and should be measured separately if assigned a product gate.

The script additionally reports 20 cold production-core constructions with no warm-up. This row is informational, not hidden in any warm timing.

## Diagnosed causes of the original misses

The independent pre-repair audit and the first R5 run are historical failed evidence. On this checkout the initial repaired N p95 was 1.9691 ms pure, 5.0447 ms publication, 8.6023 ms store and 9.2924 ms combined. The checkpoint investigation isolated four contributors:

1. `projectCommandAvailability` validated every Blueprint even when no Design Mode draft existed. Short-circuiting on draft and feature eligibility removes that unnecessary scan without changing an availability result.
2. Publication cloned the entire already-owned, deeply frozen GridViewModel. A private in-process identity marker now permits reuse of grids constructed and frozen by the projector; arbitrary caller grids still undergo descriptor-safe ownership copying.
3. Thermal tiles passed by an untrusted caller require a strict descriptor-safe copy. Production `SimCore.getPresentation` supplies already-owned, frozen authoritative tiles, which are tracked privately and reused. Neither pure projection nor direct use of the cached projector confers that trust merely because an input array is shallow-frozen. Untrusted thermal tiles still receive a defensive copy and reject accessors before invocation.
4. Store admission constructed a complete descriptor map for each nested array and object. Iterating actual keys and reading individual data descriptors preserves exact-shape, deep-freeze, sparse-array, prototype and accessor checks while reducing allocation. For full heatmaps, exact row-major coverage makes an additional duplicate-ID set unnecessary; deltas still check duplicates.

Alternating unrelated deep-cloned layouts in the old publication fixture also defeated the legitimate per-projector route-issue cache on every sample. The repaired fixture preserves unchanged layout identity across heat-only changes, as the production tick does. No gameplay formula, heatmap epsilon, sample count, warm-up or threshold was changed.

## Target-host evidence

Intel i7-2600, Windows 10.0.19045 x64, Node v24.11.0, source mode. Final isolated checkpoint run after ownership hardening:

| N path | Median | p95 | Maximum | Gate |
| --- | ---: | ---: | ---: | --- |
| Pure projector | 0.5021 ms | 0.8936 ms | 1.4265 ms | PASS |
| Project/publish/encode/ACK | 1.0821 ms | 1.8359 ms | 2.5703 ms | PASS |
| Store construction + apply | 1.2811 ms | 1.9030 ms | 2.7509 ms | PASS |
| Direct complete production tick | 1.5896 ms | 2.5034 ms | 9.4722 ms | PASS |
| Complete tick + due presentation | 2.5562 ms | 4.2379 ms | 17.8911 ms | PASS |

Cold construction, 20 independent un-warmed samples: median 10.2890 ms, p95 12.0608 ms, maximum 13.1272 ms (report-only). The isolated maxima in the direct and combined warm rows remain visible rather than filtered; p95 is the approved gate statistic.

L remains report-only. Host scheduling can affect maxima; the p95 gates remain strict. `tests/e2e/projectionStore.spec.ts` exercises the actual Chromium publisher/store loop and subscription cleanup. The independent historical finding record is `PHASE_2_TASK_18_INDEPENDENT_AUDIT.md`.

## Task 19 CP19 target-host rerun

After the Worker/GameClient candidate, the same N gate was rerun on Intel Core i7-2600, Windows
10.0.19045 x64, Node v24.11.0. The latest isolated `corepack pnpm performance:projection` run
passed every N hard gate:

| N path | Samples / warm-up | Median | p95 | Maximum | Gate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pure projector | 500 / 100 | 0.5219 ms | 0.9464 ms | 2.1329 ms | <1 ms |
| Project + publish + canonical encode + ACK | 500 / 100 | 1.1179 ms | 1.8659 ms | 2.3748 ms | <2 ms |
| Store construction + full apply | 500 / 100 | 1.3318 ms | 2.1018 ms | 2.7958 ms | <5 ms |
| Direct complete production tick | 200 / 100 | 1.3611 ms | 2.2814 ms | 18.1341 ms | <4 ms |
| Complete production tick + due presentation | 500 / 100 | 2.3852 ms | 3.4555 ms | 32.7683 ms | <6 ms |

Cold production-core construction was reported separately with 20 un-warmed samples: median
16.8081 ms, p95 35.6784 ms, maximum 36.0263 ms. It remains report-only.

Two intervening target-host reruns produced `project-publish-encode` p95 misses of 2.0046 ms and
2.0723 ms; both runs exited nonzero and remain recorded here as misses. No fixture, sample count,
warm-up or threshold changed. A prior run measured 1.9260 ms, and the latest full isolated run
passed at 1.8659 ms; the gate is accepted only from a complete run whose reported p95 is below the
unchanged 2 ms threshold.
