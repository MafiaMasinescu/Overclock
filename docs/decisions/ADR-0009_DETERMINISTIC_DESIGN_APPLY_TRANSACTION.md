# ADR-0009: Deterministic Design Apply Transaction

Status: Accepted

Date: 24 August 2026

## Context

Task 5.5 closes an isolated Design Mode draft through the existing content-injected command registry,
`CommandProcessor`, and `SimCore`. The player needs a stable preview before submitting the existing
`APPLY_DESIGN` payload, while independent inventory commands may have changed available parts since
the draft was opened. The transaction must preserve ADR-0002 candidate isolation, ADR-0004 money
rules, and Task 5.1–5.4 grid, route, and history invariants.

## Decisions

1. `calculateDesignApplyPreview(state, content)` is a pure, detached, readonly, JSON-compatible
   API. A ready result exposes the draft revision, final-layout-change flag, stable added/removed/
   moved/rotated/changed module ID arrays, stable consumption and salvage entries, informational
   consumed-inventory book value, gross salvage and labor, net cost, and downtime. It never enters
   `GameState`, consumes RNG, allocates IDs, changes a sequence, or builds the adjacent-port graph.
2. The final diff compares live and draft module/route data, not revision or undo/redo history.
   Added and removed IDs are membership differences; moved and rotated IDs are retained modules with
   changed position or rotation. The changed union is stable and deduplicated, so a moved-and-rotated
   module pays one labor charge. Route-only changes are real layout changes with no module labor or
   downtime.
3. For every definition ID, `consumeQuantity = max(0, draftCount - liveCount)` and
   `salvageQuantity = max(0, liveCount - draftCount)`. This nets same-definition installed hardware.
   Consumption is stable by definition ID, preserves partial-stack average acquisition cost, removes
   an empty stack, and records its book value only for information. Previously purchased inventory is
   not charged again and book value is not lifetime expense.
4. Removed installed modules never return to inventory. Their salvage credit is
   `quantize(priceUsd * salvageRatio)` per unit multiplied by grouped quantity. This retains ADR-0004
   per-unit quantization and uses current validated content rather than acquisition cost.
5. Labor is `quantize(laborCostPerMovedModuleUsd) * changedModuleIds.length`. Net Apply cost is
   `laborCostUsd - salvageCreditUsd` and may be negative. A successful Apply moves cash by the net
   amount, adds gross labor to lifetime expense, adds gross salvage to lifetime income, and preserves
   both per-tick economy flow fields. The final cash must remain at or above the existing negative
   credit limit; no financing, interest, insolvency, or game-over state is introduced.
6. Affected resulting modules are the stable union of added, moved, and rotated IDs that still exist
   in the draft. Preview downtime is the maximum content startup ticks in that set, or zero. Successful
   Apply resets only those modules to `offline` with full startup ticks; it preserves their overclock,
   bin ratios, cooldown, and every unrelated module field. There is no facility-wide downtime field
   and startup does not decrement in this task.
7. `APPLY_DESIGN` validates in this order: active draft; payload values; expected draft revision;
   live/draft/grid/route/history/content invariants; current inventory; shared preview calculation;
   accepted cost and downtime; revision and arithmetic capacity; final credit boundary; atomic commit.
   Invalid payload uses `INVALID_PAYLOAD`, outdated revision uses `STALE_DRAFT_REVISION`, either stale
   accepted preview value uses the new `STALE_DESIGN_PREVIEW`, and current shortages use
   `INSUFFICIENT_INVENTORY`. Corruption remains a fatal ADR-0002 invariant.
8. A changed Apply replaces live modules and routes with detached final draft records, applies the
   affected-module reset, consumes net inventory, settles economy, increments
   `liveLayoutRevision` once, and closes the draft. It preserves module/route sequences, all allocated
   IDs, RNG, thermal tiles/revision, clock/tick, campaign, power, tasks, research, benchmarks,
   blueprints, tutorial, museum, achievements, and unrelated economy fields. An unchanged final draft
   instead requires zero cost/downtime, closes only the draft, and does not increment revision or
   change layout, inventory, economy, sequences, or RNG.

## Consequences

- Replays, saves, hashes, and compatibility vectors now include the stable preview fields, final-diff
  classification, microdollar formula ordering, reset behavior, and `STALE_DESIGN_PREVIEW` rejection.
- Preview remains structural: incomplete but valid layouts may apply. Compute, power, thermal,
  airflow, Useful Compute, estimated deltas, and active-task risk remain explicitly deferred until
  their authoritative systems exist.
- The transaction is off the tick path and needs no graph rebuild. Future changes to the preview,
  money ordering, downtime semantics, revision behavior, or preservation set require compatibility
  analysis and an explicit decision.

## Rejected alternatives

- Charging consumed inventory again would double-charge parts already purchased.
- Summing startup times or storing facility downtime would misrepresent parallel restarts and add
  duplicate authoritative state.
- Treating history length as a diff would charge edits undone back to the exact live layout.
- Returning structural corruption as a gameplay rejection would violate ADR-0002.
