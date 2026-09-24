# Phase 2 Worker and GameClient diagnostics

Updated: 2026-09-24

These measurements close the Task 19 real Worker integration gate. The Chromium fixtures instantiate
the production `SimWorkerHost` in an actual Dedicated Worker and control only its injected test
scheduler. Production builds contain neither the manual controls nor their fixture entry. No
IndexedDB, save, import, export, or recovery behavior is claimed here; those are Task 20.

## Commands and fixture coverage

Run focused browser coverage with:

```powershell
corepack pnpm exec playwright test tests/e2e/workerBootstrap.spec.ts tests/e2e/workerParity.spec.ts tests/e2e/workerLifecycle.spec.ts tests/e2e/workerDiagnostics.spec.ts tests/e2e/phase0-smoke.spec.ts
```

Run the host scheduling diagnostic with:

```powershell
corepack pnpm performance:worker-host
```

The real-browser parity trace performs 21 ordered commands, including accepted and rejected
operations, pause/speed changes, Design Apply, Benchmark start/failure, Task acceptance and
abandonment, Research start/cancel, and Blueprint rejection paths. It advances through Campaign
years 1947 and 1948 at ticks 12,000 and 24,000. Direct and Worker command receipts/results are
compared. At explicit `captureAtBarrier()` points the test compares tick, year, RNG state, full
canonical state hash, and next command sequence. ACK draining is used at chunk boundaries; rate-limited
UI snapshots are not treated as an exact every-tick state clock.
The recorded parity witness is tick 12,000 / year 1947 / RNG `1720442453` / state hash
`5f0c57e688e6a693`, then tick 24,000 / year 1948 / the same RNG / state hash
`ff38b6a736a2ffb0`. Both sides end with queue position 11 after 21 commands; 11 are queued
gameplay commands and clock commands consume no queue sequence.

Lifecycle coverage checks delayed-ACK timeout/full resync, host fatal, real Worker crash, messageerror,
and 20 create/destroy cycles with listener cleanup and one termination per Worker. Bootstrap coverage
executes a production command through a real Worker. The Phase 0 shell regression retains six
viewport, Pixi cleanup, and localization tests.

## Browser and host

- Target classification: `verified-target`.
- CPU: Intel Core i7-2600 @ 3.40 GHz, 4 cores / 8 logical processors.
- OS: Windows 10 x64, build 19045; active Windows power plan: Balanced.
- Node: v24.11.0; Playwright: 1.62.1.
- Browser: Chromium `151.0.7922.34` (`Windows NT 10.0; Win64; x64`).
- Browser measurements use the Vite development server because they exercise test-only Worker
  fixtures. No parallel test runner or benchmark was active during the browser diagnostic.
- The latency diagnostic starts from a dense N state: a 24 × 16 grid at least 75% occupied, two
  active Tasks, active Research, Boost, eight Blueprints, and Benchmark history. Bootstrap smoke
  still verifies the production `INITIALIZE_NEW` path separately.

## Measured evidence

The host diagnostic separates scheduler overhead from direct simulator work. Its latest target-host
run measured 1,500 no-tick wakes (median 0.0007 ms, p95 0.0024 ms, max 0.0184 ms), 500 due-tick
wakes (median 0.2843 ms, p95 0.5713 ms, max 1.2967 ms), and 500 direct `SimCore.step(1)` calls
(median 0.1162 ms, p95 0.2593 ms, max 1.4723 ms).

The real-browser diagnostic enforces ordinary idle request/result (<10 ms), direct production tick
(<4 ms), combined Worker tick/projection (<6 ms), main-thread client publication processing
(<5 ms), and foreground visible-command (<200 ms) budgets. Sample cohorts are:

- idle commands: 20 warm-up plus 200 measured;
- direct dense-N ticks: 100 warm-up plus 500 measured;
- combined Worker tick/projection: the first 100 one-step due callbacks warm up, followed by 500
  measured one-step due callbacks. The fixture counts actual `SimCore.step` calls; the accepted
  measured cohort had 500 one-step callbacks, zero multi-step callbacks, and zero zero-step callbacks;
- Worker `postMessage` and main-client publication: 100 warm-up plus 500 measured real publication
  replies. A publication is sampled only when emitted during a scheduled callback that executed
  exactly one `SimCore.step`. Since the projection can legitimately omit a publication on a tick
  with no changed presentation, this publication cohort is selected independently from the tick
  cohort. Main-client timing is paired to the same Worker replies by `publicationSequence`;
- foreground command visibility: 20 warm-up plus 200 measured.

The complete 33-test Chromium run measured the dense-N fixture on the verified target:

| Path | Samples | p95 | Gate |
|---|---:|---:|---:|
| Idle command result round-trip | 200 | 5.4 ms | <10 ms |
| Direct production tick | 500 | 1.5 ms | <4 ms |
| Combined Worker tick and projection | 500 | 3.2 ms | <6 ms |
| Main-thread client publication processing | 500 | 4.4 ms | <5 ms |
| Worker `postMessage` publication | 500 | 0.4 ms | informative |
| Foreground command visible latency | 200 | 102.7 ms | <200 ms |

The publication p95 values use the same 500 `publicationSequence` values at both ends of the bridge;
the 100 warm-up messages are excluded. The E2E diagnostic passed, as did real Worker bootstrap,
parity, lifecycle and Phase 0 shell checks. Browser timings use the target host and pinned Chromium,
not a substitute machine. These warm diagnostics do not measure durable save/recovery or claim cold
launch performance.

## Verification results

- Worker protocol/host/client/store focused unit selection: 66/66 passed.
- Phase 1 determinism selection: 23/23 passed.
- Real Worker bootstrap + lifecycle: 6/6 Chromium tests passed.
- Real Worker/direct parity: 1/1 Chromium test passed through both year boundaries.
- Full Chromium E2E suite, including Worker, persistence/repository faults, concurrency, projection,
  and Phase 0 shell coverage: 33/33 passed.
- Full candidate validation and repeated unit/determinism runs are recorded in `PROJECT_STATUS.md`.
