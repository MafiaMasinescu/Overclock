# ADR-0017: Deterministic Research lifecycle and Compute reservation

Status: Accepted

Date: 1 September 2026

## Context

Research is the remaining vertical-slice progression system. It consumes Research Data and
reserved facility Compute, unlocks the approved content graph, gates later Task content, and ends
the campaign with the transistor-theory reveal and an immutable Museum snapshot. Research must use
the existing authoritative `GameState`, command processor, and `SimCore` tick path. It must not
create a parallel execution path or reinterpret historical Compute output.

Task 11 is decomposed into seven bounded subtasks. Task 11.1 establishes the public shapes,
content rules, structural and aggregate validation, localization, and compatibility expectations.
Task 11.2 owns the pure reservation formulas and Task 11.3 integrates those formulas into the
existing production Compute cache, witness, and output-ownership path. Research commands,
progress, and later lifecycle behavior remain owned by later subtasks.

## Decisions

### 1. Authoritative state and result shapes

`ResearchState` remains authoritative and serializable with:

```ts
interface ResearchState {
  researchData: number;
  statuses: Record<ResearchNodeId, ResearchStatus>;
  active: {
    nodeId: ResearchNodeId;
    startedAtTick: number;
    completedOperations: number;
    reservedComputeShare: number;
  } | null;
  evidenceTags: string[];
}
```

The public Compute additions are:

```ts
interface ResearchComputeResultState {
  nodeId: ResearchNodeId;
  reservedComputeShare: number;
  facilityAvailableComputeFlops: number;
  deliveredUsefulComputeFlops: number;
}

interface FacilityComputeState {
  research: ResearchComputeResultState | null;
}

interface ComputeBreakdown {
  researchFactor: number;
  // bottleneck factor also admits "research"
}
```

`totalAllocatedUsefulComputeFlops` remains the sum of Task useful delivery only. Research delivery
is represented separately in `FacilityComputeState.research` and is never folded into that Task
aggregate. Dirty Compute state contains `research: null`. A Task breakdown created without active
Research contains `researchFactor: 1`. Task 11.1 adds no reservation calculation; Task 11.2 owns
the pure formulas and Task 11.3 owns the production Research result and its Compute integration.

### 2. Research-state invariants

Content-independent validation enforces finite, nonnegative Research Data; unique lexical evidence
tags; valid statuses; at most one active status; exact null/non-null agreement between the active
status and active record; matching active node IDs; nonnegative safe active start ticks no greater
than the state tick; finite nonnegative completed operations; and finite strictly positive active
Compute share at most one. Negative zero is rejected for the numeric fields whose canonical form is
specified by the contract.

Museum snapshot IDs are unique. Museum numeric fields are finite and nonnegative, and each
snapshot's benchmark-run and completed-Research ID arrays are unique. Historical Museum completion
records prevent a completed node from being represented later as locked, available, active, or
cancelled. This is a structural historical guard; status reconciliation behavior remains a later
Task 11 subtask.

Content-aware aggregate validation additionally requires exact status coverage for content Research
IDs, a known active node, active progress strictly below that node's required operations, and an
active share at least the node's minimum. The active status and active record must agree. Final
campaign flags and the fixed final Museum snapshot must agree with final Research completion.

Stored `FacilityComputeState.research` is validated structurally only. It is historical output and
is never reinterpreted using the current `ResearchState` or current Research content.

### 3. Content hardening

Research content requires finite, strictly positive `requiredOperations`; finite, strictly positive
`minimumComputeShare` at most one; and unique IDs in prerequisites, required evidence, required
benchmarks, module unlocks, and feature unlocks. Feature IDs are shape-checked and unique but do not
receive a registry.

Research `sortOrder` values are unique. Every Research prerequisite, evidence, benchmark, module,
and inverse module Research reference must exist. The prerequisite graph remains acyclic. Exactly
one node is `finalReveal: true`, that node is mandatory, and every mandatory non-final node is a
transitive prerequisite of it. Module unlock relationships are bidirectional: a module is listed
by a Research node exactly when that Research node is listed by the module.

The supplied numeric and gameplay content values remain unchanged.

### 4. Global proportional reservation

Reservation is global at facility scope. An active Research node reserves one approved fraction of
the facility's available Compute, and the remaining capacity is shared by Task allocation through
the existing Compute path. Research is not reserved independently per module or per Task.

The exact reservation, remaining Task factor, and Research useful-delivery formulas are implemented
as pure helpers in Task 11.2. Production Compute in Task 11.3 derives the Research result from
facility available Compute after Power, Thermal, and Stability, then supplies the resulting factor
to every active allocated Task. Research does not consume Memory, Interconnect, or Suitability
inputs, and its delivery remains outside the Task useful-delivery total.

Task 11.3 applies the fixed factor order `research, power, thermal, memory, interconnect,
suitability, stability`. Effective Task share is used for Compute and bandwidth demand while
memory capacity remains unscaled. A full reservation keeps active Tasks runnable with unchanged
requested shares and zero useful delivery.

### 5. Commands, costs, and cancellation

`START_RESEARCH` and `CANCEL_RESEARCH` remain part of the public command schema, but Task 11.1 does
not register handlers. The later command subtask uses the existing queue and processor.

Starting a node atomically charges its content `cashCostUsd` and `researchDataCost`, validates the
active slot, prerequisites, evidence, benchmarks, and minimum reservation, and records the active
Research record. Cancellation transitions only an active node to `cancelled`; it has no refund and
does not consume RNG. No second command path is permitted.

### 6. Status reconciliation

The permitted status lifecycle is `locked -> available -> active -> completed`, with
`active -> cancelled`. Prerequisite and content eligibility reconciliation is deterministic and
uses stable Research ordering. Completed nodes are terminal and cannot regress. There is at most
one active node, and the active record is reconciled with its status. The behavior is implemented in
the later lifecycle subtasks, not in Task 11.1.

### 7. Final reveal and Museum

The content graph has exactly one mandatory final node with `finalReveal: true`. The final node is
the approved `research-transistor-theory` node in the supplied content. Its completion sets the
approved final campaign flags, creates exactly one fixed-ID Museum snapshot named
`museum-vacuum-tube-final`, and completes the vertical slice. The pure lifecycle calculation
creates a detached immutable result; a later tick stage applies that result to authoritative state.
The snapshot contains the approved final configuration and benchmark/research records. No
transistor components are created.

Final flags and the fixed snapshot cannot exist before final Research completion and cannot be
missing or contradictory after it. Task 11.5 calculates the detached final result; authoritative
application and Research tick registration remain Task 11.6 work.

### 8. Rollback and RNG

Research commands and tick work are atomic through the existing `CommandProcessor` and `SimCore`
transactions. Any rejection or invariant failure rolls back state, tick, clock, economy, Research
Data, statuses, active progress, IDs, receipts, results, and RNG. Research consumes no random
values. No Research behavior may mutate the authoritative tick or host-controlled clock fields.

### 9. Cache ownership

Research and Compute derived caches are private to the owning `SimCore` runtime. They are not
authoritative state, save data, replay data, hashes, receipts, or public result fields. Task 11.3
extends the existing Compute result cache with one immutable Research input projection, either
`null` or `{ nodeId, reservedComputeShare }`; it does not create an independent Research cache.
Reuse ignores `completedOperations`, `startedAtTick`, statuses, Research Data, and evidence tags.
Changing the node, reservation share, or active/null projection invalidates Research and all Task
deliveries atomically. State replacement clears the Compute cache and its witness evidence, and
separate `SimCore` instances never share those projections.

The fresh Compute witness stores detached Research input and exact-result evidence. Immediately
after Compute, `SimCore` captures immutable private evidence for Research presence, node, reserved
share, available Compute, and delivered Research Compute, alongside Task deliveries. Every later
stage preserves those values; structural-sharing stages also preserve the exact Compute branch.

### 10. Compatibility policy

The additive serialized shape is intentional. `saveVersion` and content version policy remain
unchanged. Existing Task 7/8 gameplay projections, balancing values, module numeric values, GDD,
and Word documents do not change. Full-state compatibility vectors must be updated with the exact
structural reason for the new fields; behavioral projections remain unchanged.

From the approved base `2315548d779a983bb8df5f499c358daee2260558`, the current vectors change as
follows:

| Fixture | Old full-state hash | New full-state hash | Structural reason |
| --- | --- | --- | --- |
| Task 7 projection | `955cb3249436db4b` | `7157962fe832def9` | Dirty `FacilityComputeState` now serializes `research: null`. |
| Task 8 projection | `755cf754a5bd531b` | `50e67e1213179a35` | Dirty `FacilityComputeState` now serializes `research: null`. |
| Task 10 lifecycle | `1fc91ca07fa5a046` | `bc23753d687706dc` | The dirty Research Compute field is additive, and calculated Task breakdowns now serialize `researchFactor: 1`. |

These changes are compatibility-shape changes only. No migration, balancing change, or gameplay
projection change is introduced by Task 11.1. Task 11.3 adds no further hash vector because its
active-Research result is derived during Compute and the existing no-Research compatibility
fixtures retain their Task delivery values; the authoritative `research` field and default
`researchFactor` shape are already represented by the Task 11.1 vectors above.

### 11. Deferred scope and Task 11 decomposition

Task 11.1: contract, state, content validation, localization, and compatibility foundations.

Task 11.2: approved global proportional reservation formulas and pure Research Compute/Task factor
domain helpers.

Task 11.3: production Compute reservation, the existing Compute cache extension, fresh witness
validation, historical-result semantics, and Compute-owned Research/Task output ownership.

Task 11.4: `START_RESEARCH` and `CANCEL_RESEARCH`, atomic costs, and cancellation through the
existing command path. Commands do not recalculate Compute or advance Research.

Task 11.5: pure deterministic Research progression, status reconciliation, content-gated
availability, and final Museum result calculation.

Task 11.6: production Research tick integration and authoritative application of the pure result.

Task 11.7: performance, compatibility closeout, permanent documentation, and the single Task 11
checkpoint boundary.

The following are explicitly deferred from Task 11: Research UI, events, additional benchmark
behavior, saves/replay, workers, achievements, thumbnail generation, and Task 12 or later Phase 1
work. Task 12, Benchmark runners, is the exact next Phase 1 task.

## 12. Task 11.7 closeout

Task 11 is implemented as one deterministic lifecycle through the existing command processor,
Compute cache, and `SimCore` stage pipeline. The approved production order is Power, Thermal,
Overclock, Compute, Task/benchmark advancement, then Research advancement at the existing
`advance-research` slot. Compute calculates facility available capacity after Power, Thermal, and
Stability, calculates Research from that value without Memory, Interconnect, or Suitability, then
uses `R = reservedComputeShare`, `researchFactor = 1 - R`, and
`effectiveTaskShare = requestedShare * researchFactor`. Research delivery is
`facilityTotalAvailableComputeFlops * R`; `R = 1` leaves Tasks active and runnable with zero
delivery, preserves requested shares, and gives Research all available capacity. Memory capacity
is unchanged and effective share drives bandwidth and interconnect demand.

The authoritative Research Compute result is stored on `FacilityComputeState.research`. It records
the node ID, exact reservation, facility capacity before reservation, and Research useful delivery.
Task delivery alone contributes to `totalAllocatedUsefulComputeFlops`. The current tick's Compute
branch and Research result are owned by Compute; later Task and Research stages preserve them by
exact scalar projection and structural branch identity. Research stage results apply only changed
Research, campaign, and Museum branches. Private calculation witnesses, cache projections, and
scratch remain detached from state, saves, hashes, receipts, and public results.

The single per-`SimCore` Compute cache uses only `null` or `{ nodeId, reservedComputeShare }` for
Research. Progress, start tick, statuses, Research Data, and Evidence Tags do not invalidate it.
Changing the node, reservation share, or active/null projection invalidates Research and all Task
deliveries atomically. State replacement and runtime reset clear the shared Compute cache and all
private evidence. Stored historical Compute is validated structurally and is never reinterpreted
using the next tick's Research state. Completion may leave the current-tick historical Research
result in place; the next Compute tick recalculates it as `null`. Exact cross-field multiplication
and active-projection validation apply to a fresh Compute result and its private witness, not to a
stored historical result.

`START_RESEARCH` rejection precedence is active Research, node/status availability, prerequisites,
Evidence Tags, required passed benchmark mapping, compute-share shape, cash/credit limit, then
Research Data. Accepted starts charge cash with integer microdollars, add the same cost to lifetime
expense, subtract Research Data, preserve the per-tick expense, tick, and RNG, and record exact
positive-zero progress at the current tick without checking hardware capacity. `CANCEL_RESEARCH`
requires an exact active node/status match, clears progress by clearing `active`, marks the node
cancelled, refunds nothing, and changes no economy, Compute, Task, benchmark, campaign, Museum,
tick, or RNG field. Restart pays both costs again.

At each Research calculation, locked nodes become available only when prerequisites are completed,
Evidence Tags are present, and each required benchmark resolves through `bestRunByBenchmark` to
exactly one matching passed history result. Cash and Research Data do not affect eligibility.
Nodes are processed by sort order and lexical ID; completed, active, cancelled, and still-eligible
available statuses are monotonic. Active progress is `deliveredUsefulComputeFlops * 0.1`, with no
rounding, finite-overflow rejection, clamp to remaining operations, and surplus discard. Completion
clears the active record and reconciles newly available nodes in the same calculation. Task
Evidence Tag rewards can therefore unlock Research in the same tick, while Research completion
affects Task offers on the following tick.

Completion of the mandatory unique final node sets `transistorRevealed` and
`verticalSliceCompleted`, preserves objective and reputation, and creates exactly one detached
Museum snapshot with ID `museum-vacuum-tube-final`. Its timestamp is `state.tick + 1`; its system,
architecture, year, live module count, Compute totals, benchmark run IDs, and completed Research
IDs follow the approved content and stable ordering. Average and peak benchmark power use required
best passed runs in content order, thermal mean and maximum use every authoritative tile in
row-major order, and installed-module cost sums current content prices in integer microdollars and
converts once. No transistor module or inventory is created.

Command, tick, witness, ownership, Museum, overflow, and mutation failures remain atomic through
the existing candidate transaction: the complete tick, clock, Research, campaign, Museum, Tasks,
rewards, Compute, economy, and RNG roll back while earlier committed ticks remain intact.
Research consumes no RNG. Exact 100-run Research lifecycle and final-hash coverage, insertion-order
independence, JSON serialization, detached-result protection, and independent runtime isolation
remain required determinism guarantees.

The additive serialized compatibility changes from the approved base are the dirty Compute
`research: null` field and default Task `researchFactor: 1`. The published full-state vectors are
`7157962fe832def9` for the Task 7 projection, `50e67e1213179a35` for the Task 8 projection, and
`bc23753d687706dc` for the Task 10 lifecycle; their exact structural reasons remain recorded in
the compatibility table above. No supplied balancing values, module numeric values, Task 7/8
behavioral projections, GDD, or Word-document bytes changed.

The permanent diagnostic is `corepack pnpm performance:research`. Its latest audited i7-2600 run
reported p95 values of `0.0048 ms` for pure reservation, `0.0719 ms` for pure lifecycle,
`0.1082 ms` for Task 9 Compute with Research, and `2.9352 ms` for complete production. It used
the fixed 1,000/1,000/500/200 sample schedule plus the five additional 200-sample paths, retained
all samples, excluded 100 warm-ups and setup, and passed every Research hard gate. The preferred
production target below `3 ms` p95 is informative. Full fixture and environment results are in
`docs/diagnostics/RESEARCH_LIFECYCLE_PERFORMANCE.md`.

The same final checkpoint review recorded one explicitly accepted performance irregularity in the
unchanged Task 8 diagnostic: pure-domain p95 was `0.2605 ms` over 500 samples against the nominal
`< 0.25 ms` gate, while median was `0.1045 ms` and warm production p95 passed at `2.4462 ms`.
The checkpoint acceptance is a documented one-run exception only; Task 8 code, formulas, fixture,
sample count, warm-up, assertions, timeout, and threshold remain unchanged. The independent Thermal
diagnostic passed at pure p95 `0.2706 ms` and production p95 `1.8368 ms`.

## Consequences

- Existing Compute consumers provide and validate `researchFactor`; production Compute supplies the
  active Research factor while no-Research Task results retain factor `1`.
- Dirty and calculated Compute states remain distinguishable, and historical Research results can be
  validated without consulting mutable current Research state.
- Research and Task delivery results share one Compute cache and one invalidation boundary; the
  cache is private and never enters authoritative serialization or hashes.
- Full-state hashes change because the public serialized shape changes. The exact vector updates are
  recorded above; Task 7/8 gameplay projections and all supplied numeric content remain stable.
- Research UI, events, workers, saves/replay, achievements, thumbnail generation, and Task 12 remain
  outside this completed lifecycle boundary.
