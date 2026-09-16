# ADR-0021: Deterministic Campaign Timeline and Milestone Bot

Status: accepted

Supersession note (2026-09-15): ADR-0022 supersedes only the rule that retained an arbitrary
in-era `campaign.currentYear`. The year is now an exact projection of completed ticks. All other
Task ordering, milestone-bot, balance, and evidence decisions in this ADR remain accepted.

## Context

The vertical slice needs a deterministic 1946–1948 campaign clock and a
development-only way to exercise the real public command, tick, and Replay
paths. The bot must diagnose progression without becoming a second simulator or
entering authoritative state.

Task numbering follows the implemented roadmap: Task 13 is Blueprints, Task 14
is Replay, and Task 15 is the campaign timeline and milestone bot. There is no
Task 14 gap in the active roadmap.

## Decisions

- One campaign year lasts 1,200 simulated seconds. With the fixed 100 ms tick,
  `ticksPerYear = secondsPerYear * 1000 / tickMilliseconds = 12,000`.
- A production stage derives the year from `state.tick + 1`, caps it at the
  current era end year, and never decreases a valid current year.
- Task offers are reconciled on the following tick because Task runs before the
  campaign stage in the fixed pipeline.
- Campaign remains authoritative in the existing `GameState.campaign` branch.
  Bot policies, templates, observations, reports, caches, and Replay artifacts
  remain development-only and are not saved in GameState.
- The bot uses the production `SimCore`, ordinary public commands with
  `source: "debug"`, and the existing Replay recorder. Debug resource grants,
  state replacement, fixture injection, hidden retries, and pathfinding are
  prohibited.
- Bot configuration, report data, and templates are detached, canonical,
  strictly validated, and deeply frozen at public boundaries.

## Implementation contract

The fixed template chain is `starter-serial` → `expanded-balanced` →
`cooled-benchmark`. Templates contain fixed module coordinates, footprints,
ports, routes, and symbolic cluster roles. They are executed incrementally
through `BUY_MODULE`, Design Mode commands, `CONNECT_PORTS`, Apply preview, and
`APPLY_DESIGN`; no dynamic pathfinding or direct state mutation is allowed.

The shared bot policy engine selects Research by the exact tuple mandatory,
distance to the final reveal, evidence reachability, content order, and ID. It
selects finite Tasks by evidence production, mandatory reachability, Research
Data reward, operations, deadline, content order, and ID. Baseline Research
reservation is `1.0` without a Task, `max(minimum, 0.35)` with a finite Task,
and `max(minimum, 0.5)` with only a service, capped by the remaining share.
The bot excludes the infinite census service.

Baseline priority is terminal checks, active-Benchmark advancement, the starter
template, eligible template upgrades, first Blueprint SAVE, Sustained before
Peak, Research, finite Task acceptance/allocation, guarded Overclock changes,
productive advancement, and finally hard-lock. The conservative and
aggressive variants use the same engine and selectors. Conservative prefers
Eco during idle and early cooling; aggressive uses Boost for eligible finite
Tasks. Both preserve the fixed 100-tick Boost re-entry stabilization rule and
never use Manual or infinite service.

Milestones use exact authoritative ticks for command/state transitions and
bounded observation intervals for cadence-only observations. The required
target bands are Task completion 1,200–1,800 ticks, first blocking bottleneck
2,400–3,600, Blueprint SAVE 6,000–9,000, and vertical-slice completion
27,000–45,000. An interval is on-target only when the complete interval lies
inside its target; straddling intervals are diagnostic-ambiguous.

Progress projection intentionally excludes raw tick, simulated clock,
thermal-only drift, cache revisions, witness identity, and queue counters.
Forced deadtime requires no eligible command, no meaningful progress, no
calendar transition, and no useful lifecycle completion. A hard-lock requires
600 ticks of unchanged meaningful progress, no calendar transition inside the
approved 3,000-tick maximum forced-deadtime horizon, and no active lifecycle
owner that can change eligibility.

Reports contain fixed-order milestones, blockers, productive and forced wait
episodes, command/rejection counts, terminal status, completion data, finite
metrics, state/Replay/report hashes, and fresh Replay verification. The report
hash excludes only its own `reportHash`; complete Replay artifacts are kept
separate. No bot-owned value is authoritative simulator state.

## Scope

Tasks 15.1–15.7 define the calendar, fixed starter/expanded/cooled templates,
Replay-backed command driver, baseline and variant policies, milestones,
blockers, productive wait, forced deadtime, hard-lock reporting, comparisons,
and diagnostics. The final independent checkpoint is separate and must not be
performed as part of those tasks.

The 1947 and 1948 boundaries are completed ticks 12,000 and 24,000. The
campaign ends at 1948 for this vertical slice; later technology, UI, saves,
workers, analytics, and the reconciled Phase 2+ roadmap remain outside this decision.

## Final evidence and approved balance correction

The permanent diagnostic is `corepack pnpm balance:milestones`. It measures pure
calendar/policy/observer/blocker/template paths separately from public command execution, direct
production ticks, Replay recording, and Replay playback. It also executes all three policies and a
duplicate canonical baseline, and treats every baseline progression, Replay, RNG, deadtime, and
performance contract as an executable gate.

Task 15.6 first preserved the genuine `task-failed` result at tick 2,120. Task 15.7 then applied the
separately approved corrections derived from repeated canonical probes: Ballistic Table
Verification phase operations `430,000 -> 100,000`; Wiring Layout Study Research Data reward
`34 -> 112`; Reactor Diffusion Study phase operations `2,100,000 -> 1,300,000`; Aerodynamic Load
Matrix phase operations `2,400,000 -> 700,000`; Blueprint Documentation Research Data cost
`30 -> 24` and required operations `620,000 -> 2,980,000`. No automatic tuner, retry, grant,
state injection, threshold change, or hidden recovery was introduced.

The canonical baseline now completes at tick 30,270. The first Task is observed in `(1,780, 1,790]`,
the first 100-tick blocker in `(3,560, 3,570]`, the Blueprint at tick 7,620, years 1947 and 1948
exactly at 12,000 and 24,000, and final reveal/completion in `(30,260, 30,270]`. Both Benchmarks
pass, maximum forced deadtime is 2,990 ticks, Replay is `matched`, all 1,859 commands are accepted,
and RNG state remains `1853565737`. Canonical hashes are state `43f71088b7b8afe6`, Replay
`a1a59919e8295897`, and report `f2be68edc3374681`.

Checkpoint hardening makes every documented baseline condition an explicit diagnostic failure and
compares all three duplicate hashes. Hard-lock tracking anchors a changed progress hash at the end
of the interval where it was first observed; a genuinely unchanged interval anchors at its start.
This prevents a 10-tick decision cadence from declaring a 600-tick hard lock early.

Two final unchanged-fixture diagnostics retained identical campaign results and hashes. The first
was host-load sensitive and missed direct production (`4.0002 ms` p95) and Replay recording
(`5.3677 ms` p95). The second clean process passed every hard limit: campaign warm path
`0.0010 ms`, pure policy `0.0014 ms`, direct production `3.5477 ms`, Replay recording `3.4560 ms`,
and Replay playback `4.0512 ms` p95. Results were not averaged and no performance contract,
fixture, sample count, or warm-up changed.
