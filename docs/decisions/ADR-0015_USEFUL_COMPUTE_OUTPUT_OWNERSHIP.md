# ADR-0015: Useful Compute output ownership and structural validation

Status: Accepted

Date: 31 August 2026

## Context

ADR-0014 made `facility.compute` historical and introduced same-transaction exact validation, but
two implementation clauses were incomplete. The private task projection omitted
`deliveredUsefulComputeFlops` and retained its pre-calculation value, so a later stage could replace
that output while leaving the Compute result cache reusable. Stored module-result validation also
accepted a zero requested frequency and fractional operational ratios even though calculated results
can produce neither.

## Decisions

1. This ADR supersedes only ADR-0014's affected output-ownership, fresh-witness, task-projection, and
   stored-ratio validation clauses. All Compute formulas, balancing, topology, historical-result,
   determinism, and performance contracts remain unchanged.
2. Compute owns every allocated task's `deliveredUsefulComputeFlops` from the
   `calculate-theoretical-and-useful-compute` stage through commit. A private transaction-scoped guard
   captures detached task-ID/value evidence after Compute. Every later stage may replace unrelated
   Task fields but must preserve those exact outputs. A mismatch is a fatal tick-system invariant and
   rolls back the candidate state and candidate RNG.
3. Commands execute before Compute and may invalidate or zero delivery. The following real tick must
   calculate from current inputs and install current delivery before later stages run.
4. The private task calculation projection includes delivery as owned output. A fresh calculation
   stores the post-calculation candidate projection, not the pre-calculation projection. Progress,
   payout, or other unrelated Task changes remain cache-compatible when all actual Compute inputs and
   delivery outputs are unchanged. Status and phase changes preserve the current tick's delivery but
   remain Compute inputs for the following tick.
5. Fresh calculation evidence contains both the exact deeply frozen `FacilityComputeState` and a
   separate deeply frozen record of expected task delivery scalar values. Validation proves current
   input identities, exact facility-result identity, and exact candidate delivery coverage and values.
   Candidate allocations do not share mutable objects with the evidence.
6. The guard, witness, task projections, topology, path metrics, and other cache data remain private to
   one `SimCore` runtime. They never enter authoritative state, saves, replay, canonical hashes,
   compatibility vectors, receipts, or public command/result contracts, and lifecycle replacement
   clears them.
7. Stored `ModuleComputeResultState.requestedFrequencyRatio` is finite and strictly positive.
   `operationalRatio` is exactly `0` or `1`. Negative zero satisfies neither calculated-ratio contract.
   Dirty Compute state remains unchanged.
8. Stored calculated Compute remains historical. Validation does not reinterpret it against later
   task status, phase, progress, allocation decisions, Power, thermal, Overclock, routes, or
   congestion.
9. Existing memory-provider selection is formalized without changing results: choose lower maximum
   directed read/write latency, then higher minimum read/write/provider bandwidth, then lexical
   provider ID.

## Consequences

- A later stage can advance task-owned lifecycle and economic fields without invalidating a valid
  Compute result, but it cannot overwrite the delivery consumed by that same tick.
- A command or earlier stage that changes an actual Compute input or owned output invalidates result
  reuse on the following real tick.
- Validation remains calculate-once and avoids whole-state cloning, canonical serialization, lossy
  hashes, recursive full-state validation, and generic scratch state on the hot path.
- The audited fixture, sample counts, warm-up, formulas, balancing, and hard p95 thresholds remain
  unchanged.

## Exclusions

Task 9.5 adds no Task 10 offer, acceptance, allocation-selection, lifecycle, progress, deadline,
payout, reward, research, or benchmark policy.
