# ADR-0006: Design Mode Drafts and Monotonic Module Instance IDs

Status: Accepted

Date: 18 August 2026

## Context

Phase 1 Task 5.2 adds the first production grid-edit commands on top of ADR-0002's command
processor and ADR-0005's geometry APIs. Live facility state must remain authoritative while a player
edits a detached draft. Replay and future save compatibility additionally require module instance
allocation, draft revisions, reversible history, inventory availability, and no-op behavior to be
identical across runtimes.

The existing `DesignDraftState` already stores modules, routes, a revision, and operation stacks as
JSON-compatible authoritative data. Full draft snapshots in undo history, authoritative inventory
reservations, graph rebuilds, and RNG-generated module IDs would duplicate authority or make replay
depend on unrelated state.

## Decisions

1. `ENTER_DESIGN_MODE` validates the live grid, then creates detached module and route records at
   draft revision `0` with empty undo and redo stacks. Draft edits change only the draft. The live
   modules, routes, layout revision, inventory, economy, clock, and RNG remain authoritative and
   unchanged until a future `APPLY_DESIGN` command.
2. `CANCEL_DESIGN` discards the complete draft and has no inventory, economy, salvage, labor,
   downtime, task, research, live-layout, or RNG effect. Consumed module instance sequences are not
   part of the draft and are therefore not restored.
3. `FacilityState.nextModuleInstanceSequence` is a positive safe integer starting at `1`. An
   accepted placement allocates `module-instance-` followed by the decimal sequence in at least
   eight positions with leading zeroes, then increments the sequence exactly once. Rejections,
   moves, rotations, and removals do not increment it. The sequence never decreases; removed or
   cancelled draft IDs are never reused. Allocation consumes no RNG. A generated collision or an
   increment that cannot remain a safe integer rejects with `INVALID_SYSTEM` without mutation.
   This counter and format are save and replay compatibility decisions.
4. A new draft starts at revision `0`. Each accepted state-changing place, move, rotate, or remove
   increments revision exactly once, appends exactly one reversible `DesignDraftOperation`, and
   clears redo. A rejected command does none of those things. A state-changing edit that would
   overflow revision rejects with `INVALID_SYSTEM`.
5. Moving to the current position and rotating to the current absolute clockwise rotation are
   accepted no-ops. They do not change revision, history, redo, module sequence, state hash, or RNG,
   including when revision is already `Number.MAX_SAFE_INTEGER`.
6. Inventory reservations are derived in stable definition-ID order and are never authoritative
   state. For each definition, `requiredFromInventory = max(0, draftCount - liveCount)`. Placement
   requires every resulting requirement to be no greater than current inventory quantity. Removing
   live hardware makes it reusable inside the draft; removing newly placed hardware releases its
   derived reservation. Placement neither spends cash nor repeats the purchase-time research gate.
7. Every real move, rotation, or removal deletes draft routes whose `from` or `to` endpoint names
   the edited module. Removed routes are sorted by stable route ID and copied into the operation
   payload; unrelated routes remain. The handlers do not reroute and do not build an adjacent-port
   graph.
8. Operation IDs combine the resulting draft revision with the client-owned command UUID and use no
   RNG. Place stores the complete created module. Move stores module ID, previous and new positions,
   and removed routes. Rotate stores module ID, previous and new rotations, and removed routes.
   Remove stores the complete removed module and removed routes. Payloads are detached canonical
   JSON-compatible data, not full draft snapshots.
9. Newly placed modules temporarily use `offline`, Balanced ratios `1/1`, four neutral bin ratios
   of `1`, content-defined startup ticks, and zero cooldown ticks. Neutral binning is temporary until
   the dedicated overclock and silicon-binning task; Task 5.2 consumes no RNG and implements no
   silicon lottery.

## Consequences

- Identical initial state and ordered commands allocate identical module IDs and operation history.
- Cancelling a draft may leave gaps in module instance IDs by design; gaps prove non-reuse rather
  than data loss.
- Inventory may change through independent inventory commands while a draft exists. Each placement
  re-derives all requirements from current authoritative inventory, and the future apply command
  must validate again before consuming inventory.
- Task 5.2 grid edits pay focused occupancy and grid-validation costs off tick. They add no work to
  empty ticks and do not pay the Task 5.1 adjacent-graph rebuild cost.
- Changing the module ID prefix, decimal formatting, allocation point, sequence persistence,
  revision rules, no-op semantics, reservation formula, or operation payload meaning after saves or
  replays are published requires an explicit compatibility decision and migration analysis.

## Rejected alternatives

- RNG, wall-clock, hashes, or queue sequence for module IDs would couple identity to unrelated
  execution details or violate deterministic command ownership.
- Restoring the sequence on remove or cancel would reuse IDs within one save.
- Authoritative reservation totals could diverge from live inventory and draft counts.
- Full draft snapshots per operation would grow history unnecessarily and contradict the TDD.
- Preserving attached routes after geometry changes would leave route endpoints semantically stale.
- Rebuilding the complete adjacent-port graph during each edit would implement deferred routing
  work and add the measured Task 5.1 graph cost to handlers.
