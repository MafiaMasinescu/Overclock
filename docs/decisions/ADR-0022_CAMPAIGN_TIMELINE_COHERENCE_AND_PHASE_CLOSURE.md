# ADR-0022: Campaign Timeline Coherence and Phase 1 Closure

Status: accepted

Date: 2026-09-16

## Context

Task 15 introduced a deterministic 1946–1948 calendar, but admission validated only that
`campaign.currentYear` was an integer inside the era. Advancement then used the greater of the
stored and derived years. Consequently, production construction accepted tick 0 with year 1948,
which could expose year-gated Task offers early once their real Research prerequisites were met.
Construction and replacement also accepted tick 24,000 with year 1946 and jumped to 1948 on the
next tick instead of rejecting the impossible input.

This decision also reconciles the active Markdown roadmap at Phase 1 closure. The Word documents
remain byte-identical archival references.

## Decision

### Exact committed-state projection

`campaign.currentYear` remains authoritative serialized data, but it is an exact redundant
projection of completed `state.tick` for the current era:

```text
ticksPerYear = secondsPerYear * 1000 / tickMilliseconds
elapsedYears = floor(tick / ticksPerYear)
expectedYear = startYear + min(endYear - startYear, elapsedYears)
campaign.currentYear = expectedYear
```

Ticks and `ticksPerYear` are safe integers; ticks are nonnegative and not negative zero. Era
arithmetic caps elapsed years before addition. Current content maps 0–11,999 to 1946, 12,000–23,999
to 1947, and 24,000 and later valid ticks to 1948. There is no offset, normalization, provenance
exception, or forward-year retention.

`validateCampaignBranchStructure` validates the Campaign branch independently.
`validateCampaignTimelineCoherence` accepts a complete `GameState` and validated content and checks
canonical plain-data ownership before the exact tick/year relation, so direct callers cannot use
accessors or prototype-bearing input. `validateTrustedCampaignTimelineCoherence` is the targeted
variant used only after an existing ownership boundary has accepted the complete state; it avoids
recursive serialization on each warm tick. Direct `SimCore` and `CommandProcessor` construction
without an explicit bundle resolve the bundled validated content once, preserving source
compatibility without making Campaign validation optional.

### Transaction timing and boundaries

Task/Benchmark and Research retain their existing order before Campaign. The Campaign runtime
derives its output from the prospective completed tick (`state.tick + 1`) while the internal
candidate still contains the previous tick. That prospective branch is checked explicitly. After
host-owned tick and clock advancement, the complete candidate is checked again before publication.
The committed-state equality is never applied to the half-advanced internal candidate.

Coherence is enforced by shared production validation at SimCore construction, replacement,
detached save output, Replay recorder construction, Replay playback construction, resume artifact
construction/use, interpreted Replay checkpoints, and every committed tick output. Replay paths
that already construct a production SimCore reuse this boundary rather than duplicate full-state
validation. Replay validates caller-owned initial state before cloning, so cloning cannot execute
accessors or erase a custom prototype before admission. Replacement lifecycle validation uses fresh
candidate tick runtimes; rejected validation discards them without touching live evidence. After a
successful state replacement, the already validated candidate runtimes become the live set, so the
first following tick has evidence for the replacement state. Old runtimes are detached first and
then receive best-effort cleanup; a throwing retirement callback cannot roll back or corrupt the
promoted authority. Save retains the existing targeted Task/Benchmark and Research lifecycle
checks. Failed ticks roll back their state and RNG while retaining earlier committed ticks and
command results.

Task offer reconciliation timing is unchanged: a year-gated offer becomes visible on the tick
after the year transition. `step(0)`, command-only processing, pause, and speed do not advance the
calendar. Stored Power, Compute, Task, Research, Benchmark, Blueprint, and Replay history remains
historical and is not reinterpreted against current operational inputs.

| Boundary | Enforcing path | Evidence |
| --- | --- | --- |
| SimCore construction | canonical input check, resolved validated content, then trusted timeline check | production and direct-construction regressions |
| State replacement | pre-commit full-state check plus promoted validated candidate runtimes | rejected/accepted atomic replacement, accessor, and evidence regressions |
| Detached save | trusted timeline check plus existing targeted lifecycle checks | detached ownership regression |
| Campaign stage | prospective completed-tick calculation and branch validation | both year-boundary production steps |
| Committed tick | `completeTick` full-state validation | missing/tampered output rollback regression |
| Replay recording | canonical input before any seed read, then production SimCore construction | forged/accessor initial-state recorder regressions |
| Replay playback | canonical input before clone, then production SimCore construction | recomputed-hash, accessor, and prototype regressions |
| Resume artifact creation | verified Replay, canonical input before clone, then production reconstruction | invalid initial/prefix/accessor regressions |
| Resume artifact use | parser ownership plus production SimCore construction | rebound forged-state regression |
| Embedded checkpoints | `getStateForSave` when captured and production reconstruction when resumed | checkpoint/resume integration regressions |

### Compatibility

Valid production runs, Replay protocol versions, command order, RNG behavior, balance values,
`saveVersion`, and `contentVersion` do not change. The canonical milestone vectors remain state
`43f71088b7b8afe6`, Replay `a1a59919e8295897`, report `f2be68edc3374681`, and comparison
`957959d2decef0e1`; initial and final RNG remain `1853565737`. Only formerly accepted synthetic
states with an impossible tick/year pair are now rejected.

The closure review additionally repaired six admission/ownership gaps without changing valid-run
semantics: Replay clone-before-validation, optional content on direct simulator construction,
rejected replacement validation mutating live runtime evidence, accepted replacement discarding the
new runtime evidence, retirement cleanup corrupting a retained runtime when it threw, and
accessor-unsafe direct use of the exported full-state Campaign validator. Warm paths use the
explicitly trusted targeted helper.

This ADR supersedes only ADR-0021's rule that advancement never decreases and therefore retains an
arbitrary in-era `currentYear`. All other ADR-0021 Campaign timing, Task ordering, milestone-bot,
balance, and evidence decisions remain accepted historical context.

## Phase closure decisions

- D1: active Git phases are 0 foundations, 1 deterministic headless simulator, 2 content-baseline
  integration/persistence/worker/client/selectors, 3 Build Workspace, 4 Playable Loop, and 5 Browser
  Release Candidate. Desktop/Tauri is a separate post-RC phase.
- D2: the strict loader, 12 modules, 8 Tasks, 10 Research nodes, 2 Benchmarks, balancing fixtures,
  and milestone bot are Phase 2 entry prerequisites and regression evidence, not pending content
  implementations. Durable worker recovery remains pending a persistence contract.
- D3: current status names the actual production composition and no longer defers Replay execution,
  Task 15, or the milestone bot.
- D4: historical Task 2/3 status is labelled as historical; duplicate Phase 1 scope numbering is
  corrected without renumbering published Task IDs or commit history.
- D5: the TDD distinguishes implemented behavior, type/contract-only foundations, explicit no-op
  slots, and deferred systems with owning phases.
- D6: both Word documents are archival and byte-identical; accepted ADRs and reconciled Markdown
  contracts take precedence.
- D7: verified mojibake in the Markdown TDD Task and Blueprint passages is repaired
  passage-by-passage as UTF-8 without changing gameplay semantics; no blanket re-encoding is used.
- D8: Replay diagnostics report actual host metadata and classify the documented target only from a
  precise normalized CPU/OS/architecture match. Unknown, mixed, virtualized, or mismatched hosts
  remain non-gating. Hardware detection does not certify background-load isolation.

## Residual ownership

Phase 2 owns worker, persistence, recovery boundaries, selectors, and transport-level snapshot/event
delivery. Phase 3 owns auto-connect/A* routing and renderer/heatmap consumption. Phase 4 owns future
contracts for workload-dependent Power/Heat and automatic energy settlement if retained, plus
gameplay event semantics, UI, achievements, and tutorial behavior. Phase 5 owns cross-browser and
release hardening. Assignment is not implementation.

FNV state hashes remain deterministic compatibility diagnostics, not the future SHA-256 save
integrity envelope. SHA-256 alone is not authentication against an adversary able to rewrite an
envelope. Verified in-memory Replay resume is not durable persistence, migration, autosave, or
worker recovery.

## Closure verification

The candidate passed 1,220 unit tests and 22 determinism tests in two independent complete test
processes, the complete validation pipeline, and all six pinned Playwright Chromium cases. The
initial 16-diagnostic matrix ran on the target Intel Core i7-2600 host. Replay p95 measured
`3.3762 ms` direct, `3.0821 ms` while recording, and `2.4299 ms` during playback, passing the
`<4/<5/<5 ms` gates. The milestone baseline and duplicate baseline retained completion tick
30,270, year transitions 12,000/24,000, RNG `1853565737`, state hash `43f71088b7b8afe6`, Replay
hash `a1a59919e8295897`, report hash `f2be68edc3374681`, and comparison hash
`957959d2decef0e1`.

After the final review corrected accepted-replacement runtime promotion, the directly affected
Blueprint diagnostic passed every hard gate. Two unchanged Benchmark diagnostic runs retained the
combined and production gates but missed the pure `<0.10 ms` p95 gate at `0.1035 ms` and
`0.1559 ms`. Both misses are retained as evidence. No fixture, sample count, warm-up, threshold, or
Benchmark implementation was changed. On 2026-09-16, the project owner accepted these two pure
Benchmark misses as a temporary checkpoint exception because the target machine was concurrently
loaded with multiple applications. This is an owner-reported plausible cause, not a technically
proven attribution: hardware detection cannot certify background-load isolation. The `<0.10 ms`
target remains unchanged, neither run is recorded as a technical pass, and the exception applies
only to this Task 15.8 checkpoint. It does not extend to the combined or production Benchmark
paths, any other performance gate, or future diagnostics. A future isolated target-host run remains
required follow-up evidence, but this accepted exception authorizes Phase 1 checkpoint publication.

The permanent tick-pipeline diagnostic initially crossed tick 12,000 without registering the
Campaign stage and was therefore rejected by the repaired invariant. Its unrelated high-tick
fixture now includes the production Campaign stage while preserving its warm-up, sample counts,
controlled stage work, and report-only thresholds. The corrected diagnostic passed; this fixture
repair does not alter production composition or authoritative gameplay behavior.
