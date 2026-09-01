# ADR-0016: Deterministic Task lifecycle and allocation

Status: Accepted

Date: 31 August 2026

## Context

Task 9 owns historical Useful Compute outputs for already-valid allocations. Task 10 owns all Task
lifecycle policy without adding a second command path or changing Power, Heat, or Compute formulas.
Task 10 applies that contract through the existing queued command processor and the fixed `SimCore`
pipeline. Task 9 retains ownership of current-tick Useful Compute delivery; Task 10 consumes it without
rewriting it.

## Decisions

1. `TaskSystemState.nextTaskInstanceSequence` is authoritative, starts at `1`, is a positive safe
   integer, monotonically increases, is never reused, and produces `task-instance-00000001` via a
   minimum-eight-digit decimal suffix. `CampaignState.reputation` is authoritative, starts at `0`,
   and is finite/nonnegative. `TaskInstanceState.serviceWindowCompliant` is `true` at service
   acceptance, a boolean only for nonterminal services, and `null` for non-services and terminal
   services. `activeSlotCount` remains authoritative slot capacity, not occupied-slot count.
2. Offers are content definitions only and never create instances. One vertical-slice instance may
   exist per definition; offers and instances are disjoint; terminal instances never return to offers.
   Accepted, active, and hold occupy capacity, terminals do not. Accepted instances have no
   allocation; active requires one; hold retains one; terminals retain any final allocation and all
   progress as historical data.
3. The permitted generic lifecycle is offer to accepted, accepted to active through allocation,
   active to hold, hold to active, active to completed, and accepted/active/hold to failed or
   abandoned. Commands use the existing queued command processor and real-tick advancement runs only
   in `advance-tasks-and-benchmarks`, after Task 9 Compute.
4. `ACCEPT_TASK` validates known/offered/eligible definition, completed research
   prerequisites, no earlier instance, capacity, and a safe sequence. It takes no cluster and does
   not validate dynamic Power, thermal, routing, memory, or module lifecycle.
5. A valid allocation uses stable-sorted distinct module IDs, at least one module and positive-base
   compute module, `requestedShare` in `(0, 1]`, and finite nonnegative delivery. Active allocations
   reserve no more than one share per module; hold allocations reserve no share. A future allocation
   command requires existing live modules. Historical terminal or stalled allocations may retain
   missing module IDs, and structurally valid but dynamically unavailable clusters remain allocated;
   Task 9 reports their current degraded or zero delivery. Task 10 adds no workload scaling to Power
   or Heat.
6. Progress is `deliveredUsefulComputeFlops * 0.1` only for an active allocated task with a
   current runnable Task 9 record meeting the phase stability minimum. Unstable delivery yields zero
   progress without changing active status. Phase surplus is discarded and the next phase starts next
   tick.
7. A deadline uses exact positive safe 100 ms tick conversion: `durationTicks = seconds * 10` and
   `deadlineTick = acceptedAtTick + durationTicks`. At advancement start, an unfinished task at or
   past its deadline fails before progress; `deadlineTick - 1` is the final progress tick. Accepted
   and hold deadlines continue. Failure has no cash penalty.
8. Completion applies final rewards exactly once through integer microdollar helpers: payout
   increases cash, total income, and accrued payout; reputation, Research Data, and lexically unique
   evidence rewards update once. Abandon applies its content penalty once to cash and total expense,
   leaves command-only `lastTickExpenseUsd` unchanged, and may cross discretionary credit limits.
9. A service window starts on acceptance and is compliant only when every real tick is active,
   runnable, above stability minimum, and has positive delivered Useful Compute. At each boundary
   where `(tick - acceptedAtTick + 1) % intervalTicks === 0`, a wholly compliant window pays its full
   periodic amount; otherwise it pays zero, never prorates/catches up, and resets if nonterminal.
10. Content validates service/non-service periodic-field compatibility, exact deadline/interval tick
    conversion, finite positive phase operations, unique evidence rewards, valid research
    prerequisites, and unchanged supplied numeric values. Existing Task rejection codes have English
    and Romanian localization.
11. The content-independent validator covers sequences/IDs, key agreement, statuses, unique
    definitions/offers, offer-instance disjointness, timestamps, allocation compatibility and shape,
    slots, active shares, progress, microdollar payout alignment, service-field shape, reputation,
    Research Data, and sorted unique evidence. The content-aware validator additionally covers known
    definitions, phase and total-progress bounds, content deadlines, service compatibility, eligible
    offers, content offer order, canonical generated IDs, and positive-base-compute live allocations.
    Stored Task 9 results remain historical and are never reinterpreted against lifecycle state.
12. Content-independent Task validation runs at initial `SimCore` construction, command candidates,
    save snapshots, replacement, and final tick validation whenever Task, campaign, or research
    branches change. `SimCore` gains no generic content dependency. Task 7/8 behavioral projections
    remain published; full state hashes intentionally change because the new fields serialize.

## Consequences

- `ACCEPT_TASK`, `ALLOCATE_TASK`, `SET_TASK_HOLD`, and `ABANDON_TASK` are content-injected handlers.
  Acceptance has no cluster argument; allocation accepts live structurally valid clusters despite
  current dynamic Power, thermal, routing, memory, or lifecycle degradation. Hold releases active
  share reservation, and abandonment applies only the contractual microdollar penalty.
- Real ticks reconcile offers, fail overdue tasks before progress, consume the current matching Task 9
  result, evaluate SLA windows, and apply rewards. Command-only processing and `step(0)` perform none
  of those lifecycle operations. A phase/status change is a Compute input only on the following tick.
- A private per-`SimCore` Task runtime retains exact calculation evidence only until fresh validation
  and structural-sharing commit. It never enters state, saves, hashes, replay, receipts, or public
  results, and clears on replacement and every calculation exit. Any Task calculation, validation,
  money, freeze, or delivery-ownership failure rolls back the complete tick and RNG.
- Stored Compute is validated after Compute changes, not reinterpreted after a later Task progress or
  reward change. The post-Compute delivery guard remains fatal for any later replacement.
- The permanent diagnostic is `corepack pnpm performance:tasks`; its documented warm fixture retains
  1,000 pure samples, 200 production/transition samples, 500 two-task samples, all samples, and the
  hard i7-2600 gates of `<0.20 ms` pure and `<4 ms` production p95.
- Full-state compatibility vectors become `955cb3249436db4b` (Task 7 projection fixture) and
  `755cf754a5bd531b` (Task 8 projection fixture); the stripped Task 7/8 behavior vectors remain
  `3981c87f4603e9fd` and `6a3d11ce3e14ca83`.

## Exclusions

Task 10 implements no Research lifecycle or Compute reservation, Benchmark runner, workload-dependent
Power or Heat, task-generated route congestion, random Task failure, task-fit/deadline-prediction UI,
event emission, energy settlement, save/replay/worker change, or heatmap UI. It consumes no RNG.
