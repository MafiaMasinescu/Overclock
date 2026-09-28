# Phase 3 Task 22 / CP22 diagnostic

## Boundary

Task 22 is based on the repaired Phase 2 checkpoint
`f982c7dbec5f7f444988eb7130b1db3ee7803dfb`. The commit containing this report owns the neutral
Build read and guarded-write boundary only. It does not implement the Pixi scene, visible Build
tools, route planning, or any Task 23 behavior.

No authoritative `GameState`, save, simulator, or Replay schema changes. The Worker transport alone
advances from protocol version 1 to 2 so old and new client/Worker bundles fail closed rather than
misinterpreting the added records.

## Implemented boundary

- SimCore owns exact, frozen Build context and preview reads plus a private per-core generation.
  Generation observes the layout/draft lifecycle, inventory/economy, research unlocks, Blueprints,
  identity counters, Benchmark lock, dimensions, and content identity. It is not serialized, hashed,
  replayed, or placed in `GameState`.
- Placement, edit, Apply, Blueprint, and manual-route readers reuse the existing geometry,
  reservation, purchase, settlement, route, and materialization guards. Shared purchase and Apply
  settlement preflights preserve command rejection ordering and safe-microdollar arithmetic.
- Query results are detached discriminated records with exact source mode, tick, live/draft revision,
  generation, intent correlation, bounded pagination, route-impact detail, and original manual-route
  reasons. Automatic route, adjacent candidates, and Diagnostic Pulse remain explicitly unavailable.
- `QUERY_BUILD` and guarded `BUILD_COMMAND` use the existing Worker epoch, request sequence, byte
  limits, serialization queue, terminal reservation, and `ACK_RESULT` lifecycle. A stale generation
  is not queued; admitted commands return their real domain result and post-operation source.
- GameClient exposes `queryBuild`, `dispatchBuild`, and `setPresentationContext`; the fake client
  fails safely. The preview coordinator permits one in-flight plus one latest replacement, throttles
  to 10 Hz, deduplicates only within the same dependency generation, and discards invalidated or
  mis-correlated responses without retrying commands.
- The owned grid projection adds resolved rotated port geometry and stored route endpoints together
  with strict wire validation and source-map entries. Host settings remain detached session metadata,
  outside deterministic state.

## Independent review corrections

The CP22 review found and corrected narrow Task 22 defects before publication:

1. Build query/command replies were added to terminal ACK accounting.
2. Generic reply payloads were replaced by strict corresponding schemas, including outer/inner
   preview consistency and request kind/intent/source correlation.
3. Semantic preview failures now return rejected results; unknown Blueprint cursors fail instead of
   restarting pagination, and Blueprint records are detached before publication.
4. Purchase and Apply reads reuse the complete domain arithmetic preflights, including quantity,
   weighted-cost, ledger-total, credit, and safe-integer overflow checks.
5. Placement checks all global Design reservations and the exact ID/revision capacity guards; move,
   rotate, removal, and manual-route previews expose route impact and the same capacity limits.
6. Manual-route output preserves ordered domain reasons and rejects a requested route kind that does
   not match resolved endpoints.
7. Actual live/draft source mode is derived from authority before and after guarded commands.
8. Direct query parsing rejects accessor-backed, sparse, or custom-prototype arrays without invoking
   caller accessors.
9. Replacement constructs the Build tracker only after candidate validation and promotion; rejected
   replacement and retained-runtime cleanup cannot contaminate the active tracker.

The final independent review reported no remaining Critical or Important Task 22 defect.

## Verification

The final candidate passed 90 unit files / 1,559 tests and 16 determinism files / 25 tests. Strict
TypeScript, ESLint, repository formatting, content validation, production build, and the checkpoint
scans passed. The affected real-Chromium matrix passed 11/11 with one worker, covering Worker/direct
parity, projection/store ownership, same-tick durable save, corrupt-autosave forward recovery, and
mid-Replay durable recovery. No threshold, timeout, fixture, cohort, or assertion was weakened.

The Build query diagnostic retains 100 warm-up and 500 measured samples for context, placement, and
Apply. On the documented i7-2600 / Windows 10 x64 target host, their p95 values were respectively
`0.2342 ms`, `0.0779 ms`, and `0.1168 ms`; all passed and the diagnostic preserved the initial state
hash. The Worker host diagnostic also passed at `0.0023 ms` no-due wake, `0.5827 ms` due-tick wake,
and `0.2252 ms` direct production step p95.

The unchanged projection diagnostic retained the owner-authorized Phase 3 entry exception without
reclassifying its failures: `N/pure-project` measured `1.7201 ms` p95 against `<1 ms`, and
`N/project-publish-encode` measured `3.3570 ms` p95 against `<2 ms`. Store apply (`3.2504 ms` against
`<5 ms`), direct production tick (`2.3229 ms` against `<4 ms`), and combined tick with projection
(`5.5865 ms` against `<6 ms`) passed. These performance-only exceptions waive neither the new Build
path nor any correctness result.

Task 22 has no visible UI or new screenshot baseline. Real Chromium Worker/projection/persistence
scenarios are behavioral evidence; visual acceptance begins with the later UI-owning tasks.

## Compatibility and next boundary

Existing Phase 1/2 hashes, RNG, command queue, save/import, recovery, Replay, autosave, and
publication ownership remain unchanged. The repaired malformed-Unicode admission and quarantined
autosave rotation regressions remain part of the Chromium checkpoint matrix.

The next permitted boundary is Task 23.1. Task 23 is not started by CP22.
