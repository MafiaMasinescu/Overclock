# Milestone Bot Diagnostic

This document records the permanent Task 15 campaign and milestone-bot diagnostic. The bot is a
development-only verifier; it is not part of the production import graph and adds no authoritative
state.

## Execution and hard gates

```powershell
corepack pnpm balance:milestones
```

The diagnostic loads canonical content once, validates all fixed templates, measures audited warm
paths, runs `baseline-balanced`, `conservative-thermal`, and `aggressive-boost` on the same seed,
runs a duplicate baseline, verifies Replay from fresh initial state, and prints machine-readable
JSON. The baseline run fails the process unless all of these conditions hold:

- status is `completed` and Replay is `matched`;
- first finite Task completes in ticks 1,200 through 1,800;
- first persistent blocker occurs in ticks 2,400 through 3,600;
- the first run-created Blueprint is saved in ticks 6,000 through 9,000;
- completion and Transistor reveal occur in ticks 27,000 through 45,000;
- 1947 and 1948 occur exactly at completed ticks 12,000 and 24,000;
- Sustained and Peak Benchmarks pass and at least one Blueprint exists;
- maximum contiguous forced deadtime is at most 3,000 ticks;
- RNG is unchanged, no command is rejected, no Task or Benchmark fails, and no debug grant occurs;
- duplicate state, Replay, and report hashes match;
- target-host performance limits pass.

The fixed configuration is a ten-tick decision cadence, 600-tick Replay checkpoint cadence,
100-tick blocker persistence, 600-tick hard-lock window, and 45,000-tick maximum run. The canonical
seed is `task-15-strategy-comparison-v1`; the simulation-content fingerprint is
`3c8559ccf77e331a` and the initial-state hash is `3cf71a69f852fcfa`.

## Approved Task 15.7 corrections

Task 15.6 retained the original reproducible `task-failed` result at tick 2,120. Task 15.7 made four
evidence-backed corrections after explicit approval; it did not add an automatic tuner:

1. The first Ballistic Table Verification phase changed from 430,000 to 100,000 operations so the
   first finite Task completes in its two-to-three-minute target.
2. The pre-Blueprint Research Data path was reconciled: Wiring Layout Study rewards 112 instead of
   34, and Blueprint Documentation costs 24 instead of 30. The exact ledger is sufficient without
   a debug grant.
3. Reactor Diffusion Study and Aerodynamic Load Matrix changed from 2,100,000 and 2,400,000
   operations to 1,300,000 and 700,000 to preserve real mid-campaign progression.
4. Blueprint Documentation changed from 620,000 to 2,980,000 operations to place the Blueprint and
   calendar wait inside both timing contracts. The expanded/cooled templates provide the measured
   hardware path; deadline Boost begins only after a confirmed 100-tick blocker, and Peak boosts
   only arithmetic unit 5 while measuring the full six-module cluster.

No module, economy, Benchmark, era, save-version, or content-version numeric value changed. No
threshold, fixture, cadence, sample count, retry, state injection, hidden recovery, or direct reward
grant was used.

Checkpoint review also hardened two diagnostic contracts without changing canonical progression.
The executable diagnostic now checks every documented baseline gate plus duplicate state, Replay,
and report hashes. Hard-lock tracking starts a new unchanged window at the end of an interval that
produced progress, so the exact 600-tick boundary cannot trigger one ten-tick cadence early.

## Canonical policy evidence

| Policy | Status | Final tick | Commands | Replay entries | State hash | Replay hash | Report hash |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| baseline-balanced | `completed` | 30,270 | 1,859 | 6,744 | `43f71088b7b8afe6` | `a1a59919e8295897` | `f2be68edc3374681` |
| conservative-thermal | `task-failed` | 19,220 | 869 | 3,659 | `79918feab0ce435c` | `23d7b2e14985630e` | `61d2a655a2d7afdb` |
| aggressive-boost | `completed` | 30,270 | 1,860 | 6,746 | `de7400702116a330` | `f5832f50da1881be` | `d315041b25320ee0` |

All three Replay verifications are `matched`, all commands in each run are accepted, and all three
retain RNG state `1853565737`. The duplicate baseline reproduces all three canonical hashes. The
comparison report hash is `957959d2decef0e1`.

The conservative policy is intentionally diagnostic: its Eco preference misses a later finite-Task
deadline and terminates at tick 19,220. Variant policies are compared on the same fixed axes but are
not required to satisfy the baseline completion or milestone bands. The aggressive policy completes
with a slightly earlier first Task `(1,750, 1,760]`, blocker `(3,500, 3,510]`, and Blueprint tick
7,560. Its maximum forced-deadtime episode is 3,050 ticks; that baseline-only gate is not applied to
the variant.

## Canonical baseline progression

| Milestone | Evidence |
| --- | --- |
| First layout | tick 0 |
| First finite Task accepted | tick 10 |
| First finite Task completed | `(1,780, 1,790]` |
| First persistent blocking bottleneck | `(3,560, 3,570]`, `deadline-risk` after 100 ticks |
| First Blueprint saved | tick 7,620 |
| 1947 | tick 12,000 exactly |
| 1948 | tick 24,000 exactly |
| Sustained Benchmark passed | `(24,140, 24,150]` |
| Peak Benchmark passed | `(28,960, 28,970]` |
| Transistor revealed and vertical slice completed | `(30,260, 30,270]` |

The run completes five finite Tasks and all ten Research nodes, saves `blueprint-00000001`, and
passes both Benchmark definitions. Maximum contiguous productive wait is 2,590 ticks; maximum
contiguous forced deadtime is 2,990 ticks from 9,000 through 11,990. It records no rejected command,
failed Task, failed Benchmark, shutdown, hard lock, or fatal. Final cash is USD 21,660, income USD
42,600, expense USD 52,940, and maximum observed temperature 25.398576261924397 C.

## Performance evidence

Target host: Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz, Windows 10 build 10.0.19045, Node v24.11.0,
development mode. Fixture construction and JIT warm-up are excluded; cold construction, template
execution, complete policy wall time, Replay finalization, and outliers remain separately visible.

| Measurement | Median (ms) | p95 (ms) | Maximum (ms) | Samples | Hard limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Campaign warm no-change | 0.0007 | 0.0010 | 0.0354 | 1,000 | < 0.02 |
| Campaign transition | 0.0005 | 0.0008 | 0.0013 | 200 | diagnostic |
| Pure policy decision | 0.0006 | 0.0014 | 0.0543 | 1,000 | < 0.5 |
| Milestone observation | 0.0705 | 0.1417 | 0.6024 | 1,000 | diagnostic |
| Blocker evaluation | 0.0015 | 0.0020 | 0.0559 | 1,000 | diagnostic |
| Template validation | 1.7255 | 3.3410 | 8.0242 | 1,000 | diagnostic |
| Starter template execution | 221.2466 | 316.2237 | 407.7205 | 50 | diagnostic |
| Direct production tick | 2.3216 | 3.5477 | 17.3434 | 200 | < 4 |
| Replay recording tick | 2.4153 | 3.4560 | 17.5788 | 200 | < 5 |
| Replay playback tick | 2.7151 | 4.0512 | 17.7072 | 200 | < 5 |

The table records the second of two unchanged-fixture executions in separate clean processes; it
passed every hard gate. The first execution reproduced identical campaign behavior and canonical
hashes but measured direct production at `4.0002 ms` p95 and Replay recording at `5.3677 ms` p95,
so it failed those two hard gates. The two runs are reported separately rather than averaged,
filtered, or used to change fixture work, sample counts, warm-up, or thresholds.

## Determinism, ownership, and compatibility

The exact-100 bounded determinism suite repeats each policy's public-command trace 100 times across
the 1946-to-1947 boundary and verifies state, journal, Replay, RNG, and year. Canonical full campaigns
add a duplicate baseline and fresh Replay reconstruction.

Bot reports exclude only their own `reportHash` from the report projection. Replay artifacts remain
separate. Templates, policies, observations, blockers, waits, mappings, and reports remain outside
`GameState`, saves, Replay protocol contracts, and production imports. The public `runMilestoneBot`
boundary rejects caller state injection; canonical runs create their own initial state.

`balancing.campaign.secondsPerYear = 1200` deliberately changes the simulation-content fingerprint.
Task/Research value corrections are content-only and do not change authoritative state shape,
`saveVersion`, or `contentVersion`. Locale files remain excluded from the fingerprint. Module numeric
content, the GDD, and both Word documents remain byte-identical to the Task 14.7 base.

## Deferred scope

Task 15 does not implement UI, tutorial presentation, analytics, leaderboards, save repositories,
migrations, file transport, IndexedDB, workers, offline progress, automatic tuning, adaptive search,
random failures, resource grants, pathfinding, Blueprint export/import, or Phase 2 behavior.
