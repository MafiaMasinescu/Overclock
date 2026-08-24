# ADR-0008: Deterministic Design Mode Undo and Redo

Status: Accepted

Date: 24 August 2026

## Context

Phase 1 Task 5.4 executes the reversible, detached Design Mode operation records established by
ADR-0006 and extended for manual routes by ADR-0007. Undo and redo must remain draft-only,
replayable, and independent from inventory changes that can occur while Design Mode is active.

## Decisions

1. `UNDO_DESIGN` and `REDO_DESIGN` use the existing content-injected Design Mode command registry,
   `CommandProcessor`, and `SimCore` path. `APPLY_DESIGN` remains unavailable.
2. Empty undo and redo stacks are accepted exact no-ops, including at maximum draft revision.
3. A real undo removes the last undo operation, applies its inverse, and appends the same logical
   operation to redo. A real redo mirrors this from redo to undo. Operation IDs, kinds, payloads,
   module IDs, and route IDs are preserved; undo and redo create no new operation records.
4. Every real undo or redo increments draft revision exactly once. Revision overflow with a nonempty
   relevant stack rejects atomically with `INVALID_SYSTEM`; it does not transfer an operation.
5. Undo and redo neither restore nor consume module or route sequences. Restored modules and routes
   use the complete exact records stored by their original operations, so IDs are never reused.
6. Undo and redo do not change inventory or economy and do not revalidate derived inventory
   reservations. The deferred apply transaction will perform authoritative inventory validation.
7. History payloads are strictly decoded as detached JSON-compatible records. Malformed history,
   impossible current-state transitions, record mismatches, collisions, and invalid restored grid or
   route state are fatal invariants through ADR-0002, never normal gameplay rejections.
8. Undo and redo validate full draft grid, routing, history, and sequence invariants at command time.
   They do not rebuild ADR-0005's derived adjacent-port graph and add no tick-path work.

## Consequences

- Place, move, rotate, remove, connect, and disconnect are reversible without draft snapshots.
- Independent inventory transactions can continue while a draft is active without blocking history.
- Replay compatibility includes LIFO order and the exact original operation payloads.
- `APPLY_DESIGN`, automatic routing, rerouting, reservations, capacity gameplay, and live-layout
  mutation remain deferred.

## Rejected alternatives

- Restoring sequence counters would reuse identities after undo or cancel.
- Treating corrupted stored history as a recoverable player error would hide authoritative-state
  corruption and violate ADR-0002.
- Revalidating inventory during undo or redo would make an existing draft depend on unrelated
  inventory timing before the apply transaction is defined.
