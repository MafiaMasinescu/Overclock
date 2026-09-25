# Phase 2 Repository Diagnostic

## Purpose

This permanent diagnostic measures the Task 17 atomic durable repository. It separates detached
save preparation from transaction commit, import preview from confirmation, and end-to-end import.
It does not mutate the live simulator or expose a production debug API.

Run it with:

```text
corepack pnpm performance:save-repository
```

## Fixtures and method

- **N:** the audited dense 24 x 16 Phase 1 facility fixture with active Service and Research work,
  nonuniform Thermal state, routes, Overclock, Tasks, Research, Benchmarks, and eight valid Blueprint
  records. Each operation uses 200 measured samples after 20 warm-up iterations.
- **L:** the same facility with 128 valid Blueprint records. It uses 50 measured samples after five
  warm-up iterations and is report-only.
- Fixture creation and JIT warm-up are excluded from measured samples.
- `preparation-encode` includes full current-content admission plus canonical envelope encoding. The
  pure canonical payload encode budget is measured separately by `performance:save-codec`.
- Commits are single repository transactions. Rotation inserts, advances metadata and prunes to the
  newest three autosaves atomically.
- Preview includes bounded inspection, checksum, copy-only migration, compatibility checks and full
  production admission for compatible candidates. Confirmation includes fresh rebind/checksum, Web
  Lock ownership and atomic commit.

## Target-host evidence

Host: Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz, Windows `win32-x64`, Node `v24.11.0`, source build.
Values are milliseconds.

| Fixture | Operation          |   Bytes | Samples | Warm-up | Median |    p95 | Maximum | Contract      |
| ------- | ------------------ | ------: | ------: | ------: | -----: | -----: | ------: | ------------- |
| N       | preparation-encode | 191,346 |     200 |      20 |  83.71 | 118.64 |  152.86 | save <250     |
| N       | commit-manual      |       - |     200 |      20 |   1.45 |   2.39 |    9.53 | save <250     |
| N       | commit-rotation    |       - |     200 |      20 |   6.99 |  10.33 |   17.25 | autosave <250 |
| N       | preview            | 191,346 |     200 |      20 | 271.27 | 346.40 |  448.29 | import <1000  |
| N       | confirm            | 191,346 |     200 |      20 | 100.48 | 124.30 |  260.40 | confirm <250  |
| N       | end-to-end-import  | 191,346 |     200 |      20 | 372.21 | 469.99 |  587.00 | import <1000  |
| L       | preparation-encode | 262,296 |      50 |       5 | 119.71 | 155.38 |  307.66 | report-only   |
| L       | commit-manual      |       - |      50 |       5 |   1.71 |   3.96 |    5.09 | report-only   |
| L       | commit-rotation    |       - |      50 |       5 |   9.40 |  12.21 |   13.81 | report-only   |
| L       | preview            | 262,296 |      50 |       5 | 382.96 | 480.44 |  555.68 | report-only   |
| L       | confirm            | 262,296 |      50 |       5 | 139.56 | 162.10 |  202.18 | report-only   |
| L       | end-to-end-import  | 262,296 |      50 |       5 | 521.92 | 636.53 |  714.37 | report-only   |

The companion codec diagnostic on the same host measured N canonical payload encoding at 19.18 ms
p95, full admit-plus-encode at 118.13 ms p95, and decode at 136.22 ms p95. Every mandatory Task 16
and Task 17 target-host budget passed.

## Chromium evidence

The pinned Chromium matrix uses the production IndexedDB adapter and real same-origin Web Locks. All
19 browser tests pass, including the six Phase 0 smoke tests. Repository scenarios cover:

- transaction rollback after a successful request through the production adapter;
- quota and cancellation preservation;
- versionchange closure, blocked upgrade and incomplete-schema refusal;
- reload with checksum and full admission intact;
- cross-tab writer exclusion;
- real page navigation/close, lock takeover, writer-epoch rotation and stale-writer rejection;
- verified import/export on the real stack;
- raced import confirmation preserving the winner;
- import overwrite refusing an actively locked destination;
- commit durability across reload.

The quota path is an injected browser fault seam; it is not presented as an actual device-quota
exhaustion. Per-scenario wall-clock durations emitted by Playwright are smoke diagnostics rather than
statistical performance gates.

## Revalidation rule

Rerun both save diagnostics, focused repository tests and Chromium matrix after changes to codec,
admission, IndexedDB schema, repository transactions, Web Locks, import/export or load admission.

## Task 21 N/L rerun

Updated 2026-09-25. Command: `corepack pnpm performance:save-repository`. N used 200 samples / 20
warm-ups; L used 50 / 5. Values are median / p95 / maximum milliseconds. Preparation encodes the
input before transaction samples; preview, confirm, and end-to-end import include their full
repository operation.

| Fixture | Operation | Bytes | Median | p95 | Maximum |
|---|---|---:|---:|---:|---:|
| N | Preparation + encode | 191,346 | 83.0473 | 109.1832 | 118.7826 |
| N | Manual commit | — | 1.3757 | 2.3728 | 10.5678 |
| N | Rotation commit | — | 7.2249 | 10.4700 | 18.3442 |
| N | Import preview | 191,346 | 278.6114 | 374.4998 | 698.3400 |
| N | Import confirm | 191,346 | 101.5042 | 135.4746 | 330.5274 |
| N | End-to-end import | 191,346 | 380.1522 | 490.4938 | 811.9728 |
| L | Preparation + encode | 262,296 | 117.6252 | 145.5411 | 162.7620 |
| L | Manual commit | — | 1.6676 | 3.3699 | 4.2937 |
| L | Rotation commit | — | 8.3752 | 12.5357 | 15.1006 |
| L | Import preview | 262,296 | 402.9350 | 468.4113 | 638.8635 |
| L | Import confirm | 262,296 | 145.4211 | 193.1149 | 200.3123 |
| L | End-to-end import | 262,296 | 548.5551 | 639.4039 | 788.0118 |

The command exited successfully. These measurements use the actual host stated in
`PHASE_2_TASK_21.md`; installed RAM differs from the Phase 2 8 GiB target.
