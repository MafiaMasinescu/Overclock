# ADR-0019: Deterministic Blueprint contracts and authoritative state

Status: Accepted

Date: 3 September 2026

## Context

Phase 1 Task 13 adds deterministic subassembly Blueprints to the existing headless simulator.
Task 13 has one final checkpoint, and its implementation is divided into six subtasks. This
decision records the complete public contract, including capture, commands, materialization,
Design Mode history, performance, and compatibility.

## Decisions

1. `BlueprintState` is authoritative serializable state with `records` and
   `nextBlueprintSequence`, initialized to `1`. Blueprint IDs use
   `blueprint-${sequence padded to 8 decimal digits}`. Sequences are positive safe integers,
   strictly greater than every allocated record sequence, and never reused. `SAVE` always
   creates a new record. Task 13 creates only `subassembly` records with version `1`; the
   structural union may represent `server`, `rack`, and `facility-zone`, but those kinds are
   not created or instantiated in Task 13.

2. Blueprint names are normalized with JavaScript `trim()`. The normalized value must be
   nonempty, no longer than 80 UTF-16 code units, and contain none of U+0000 through U+001F or
   U+007F. Duplicate names are permitted. `RENAME` changes only the name and preserves version,
   kind, contents, summary, required Research, and content version.

3. Blueprint-local identities are independent of facility identities. Local module IDs use
   `module-${sequence padded to 4 decimal digits}` and local route IDs use
   `route-${sequence padded to 4 decimal digits}`. A record never stores live facility module
   IDs or route IDs. Local IDs are unique and canonical within their respective collections.

4. A Blueprint record has an exact shape: ID, normalized name, positive safe version, supported
   kind, nonempty content version, modules, routes, required Research IDs, positive bounds, and
   finite nonnegative summary values. Subassembly module collections are nonempty. Modules have
   canonical local IDs, string definition IDs, finite integer relative positions, valid
   rotations, and structurally valid saved Overclock settings. Routes have canonical local IDs,
   supported kinds, nonempty endpoint/port fields, local-module endpoints, nonempty orthogonal
   non-repeating paths, and path points inside the stored bounds. Stored module positions and
   route points must fit the stored bounds.

5. Required Research IDs are unique and lexically sorted. Summary values reject NaN, Infinity,
   and negative zero. The monetary summary uses the existing exact microdollar representation.
   Structural validation does not resolve module definition IDs, Research IDs, port IDs,
   footprints, or historical formulas against current content. A historical `contentVersion`
   remains structurally valid after current content changes.

6. Structural validation is separate from content-aware validation. The dedicated Blueprint
   validator checks BlueprintState shape, exact key-to-record-ID agreement, record uniqueness,
   sequence monotonicity, exact record shapes, and all history-safe rules above. Later current
   Blueprint commands add content-aware checks for known definitions, Research eligibility,
   footprint/materialization, route compatibility, and current content-version policy.

7. `BlueprintState` is deeply immutable while owned by the simulator. The authoritative owner
   detaches and recursively freezes it at construction, replacement, and commit boundaries.
   Initial-state validation, `SimCore` construction, save snapshots, state replacement,
   command-candidate validation, and authoritative ownership all validate the Blueprint branch.
   Invalid authoritative Blueprint state is fatal with `SIMULATOR_INVARIANT_VIOLATION` when it
   is encountered in a command or tick transaction. Tick systems do not mutate the branch.

8. Production ticks protect the immutable Blueprint branch by identity. Mutable-clone runtimes
   reuse the frozen authoritative Blueprint branch, and every tick runtime must retain that
   identity. No Blueprint cache, witness, index, mutable scratch data, or exact mutable
   fingerprint is stored in `GameState`. Ordinary production ticks do not scan Blueprint
   records. Any expensive exact fingerprint is limited to focused tests or explicit validation
   paths.

9. Task 13 is implemented through these bounded subtasks:

   - Task 13.2: capture the authoritative live Facility layout into detached local Blueprint
     modules/routes and calculate deterministic summary and bounds.
   - Task 13.3: add pure content-aware Blueprint materialization planning for an existing Design
     Mode draft, including global rotation, transformed footprints and routes, fresh facility-local
     IDs, Research, inventory, candidate geometry, and atomic rejection. This subtask does not
     register command handlers or mutate Design Mode state.
   - Task 13.4: add content-aware `SAVE_BLUEPRINT` and `RENAME_BLUEPRINT` command handling with
     atomic rejection and the name/version/content immutability rules. SAVE consumes the pure
     capture contract without changing its historical semantics.
   - Task 13.5: add FIFO `INSTANTIATE_BLUEPRINT` plus Blueprint Undo/Redo as atomic Design Mode
     transactions with detached history payloads, rollback, ownership, and determinism coverage.
   - Task 13.6: add the audited Blueprint diagnostic, scoped validation hardening, compatibility
     closeout, and permanent documentation. The diagnostic measures pure capture, summary,
     materialization planning, SAVE, INSTANTIATE, Undo, Redo, specified failures, ordinary ticks
     with stored records, and cold construction/replacement separately. Its hard gates are p95
     below 5 ms for pure capture and materialization, below 50 ms for SAVE/INSTANTIATE/Undo/Redo,
     and below 4 ms for a complete production tick on the i7-2600 fixture. Fixture construction
     and warm-up are excluded from timed samples, and no sample is filtered.

10. Blueprint capture is a pure observation of the authoritative live Facility. SAVE requires no
active Design Mode draft, the unlocked `subassembly-blueprints` feature, a nonempty unique live
selection, existing selected modules, currently available definitions, and completed current
Research. It captures only definition ID, relative anchor, rotation, and requested Overclock;
runtime lifecycle, counters, bins, delivered Power/Compute, temperatures, and facility IDs are
not retained. Internal routes are those whose two endpoints are selected; external connections
are omitted. Module ordering is anchor y, anchor x, definition ID, then facility ID as an
invalid-state tie-breaker. Dense local IDs, endpoint recanonicalization, complete-path reversal,
route ordering, tight bounds, and the sorted Research union are deterministic.

11. Blueprint summaries are historical observations. Theoretical Compute is the sum of nominal
base Compute times saved frequency ratio. Peak Power uses the shared effective-full-load Power
and dynamic Overclock helpers with nominal bin and operational ratios of one. Cost uses checked
microdollar accumulation and one final conversion. Maximum temperature is the finite maximum of
the unique occupied live thermal tiles. Capture does not run Power allocation, Compute,
temperature diffusion, cooling, workloads, or RNG, and later content never reinterprets a stored
summary.

12. Instantiation uses the original stored bounds and the four specified global point transforms.
The command position is the top-left of the rotated bounds. Every occupied module tile is
transformed before deriving the new anchor; the existing footprint helper must reproduce the
transformed tile set. Routes transform and translate every stored path point, preserve order
unless endpoint canonicalization requires complete reversal, recalculate current port capacity,
and reset congestion. New modules are offline with current startup ticks, cooldown zero, saved
Overclock, and nominal bin ratios. Fresh facility IDs are allocated in local-ID order and are
never reused, including after failed operations, Cancel, Undo, or Redo. Inventory is reserved in
the Design Mode draft only until existing APPLY_DESIGN consumes inventory, cash, labor, downtime,
and advances the live layout revision; active Benchmark permits draft instantiation but still
blocks Apply.

13. `INSTANTIATE_BLUEPRINT` validates sources, prerequisites, current content, transformed
geometry, routes, cumulative inventory, sequences, and the complete candidate draft before one
atomic Design Mode operation. Its detached immutable operation payload stores Blueprint evidence,
exact added objects, reservation delta, and resulting sequence evidence. Undo removes exact routes
then modules and releases the exact reservation without rewinding sequences. Redo verifies current
preconditions and restores the original objects and IDs without allocating again. Fatal invariant
failures use `SIMULATOR_INVARIANT_VIOLATION` and roll back state and RNG; user rejections never
partially mutate state. Blueprint behavior consumes no RNG and private runtime evidence never
enters state, hashes, saves, receipts, or public contracts.

14. The permanent performance diagnostic is `corepack pnpm performance:blueprints`, documented in
`docs/diagnostics/BLUEPRINT_PERFORMANCE.md`. It uses a large valid 24 by 16 fixture with 16
selected modules, 17 live modules including one external connection, six internal routes, all
four rotations, mixed module footprints, compute/cooling, saved Overclock settings, route paths
outside footprints, and nonuniform observed temperatures. Ordinary production ticks reuse the
immutable Blueprint branch by identity and do not scan Blueprint records. Cold SimCore
construction and state replacement are reported separately from warm command and tick samples.

Export/import, nested Blueprints, editing existing definitions, propagation to instances,
server/rack/facility-zone instantiation, prebuilt-module premiums, automation rules, UI,
events, saves, replay transport, workers, and Task 15 remain outside Task 13.

## Compatibility

Adding `nextBlueprintSequence` changes serialized full-state compatibility hashes. The change is
intentional and is caused only by the new authoritative field; removing the new field restores
the prior projection. `saveVersion`, `contentVersion`, `balancing.json`, and module numeric
content do not change. Existing behavioral projections that exclude the Blueprint branch remain
unchanged.

| Projection | Previous hash | Task 13.1 hash | Structural reason |
| --- | --- | --- | --- |
| Full initial state (`compatibility-blueprint`) | `1ac5a1d2a3739390` | `539d230076b51eda` | Additive `blueprints.nextBlueprintSequence: 1`. |
| Prior-shape Blueprint projection | `1ac5a1d2a3739390` | `1ac5a1d2a3739390` | New field excluded; prior projection preserved. |

The previously published lifecycle vectors change only because the initial authoritative
Blueprint branch now includes the sequence field:

| Fixture | Previous hash | Task 13.1 hash |
| --- | --- | --- |
| Task 7 projection without Compute | `aa48404b98aa1e48` | `bd238ff22638cf12` |
| Task 8 projection without Compute | `62fc84b28af4a39c` | `9cb4b360875645b2` |
| Task 7 full state | `40a2e2270c2ba2bc` | `6d75663a8cd48776` |
| Task 8 full state | `97acfaa5ef64627e` | `5d370ba135412aec` |
| Task 10 lifecycle | `046b2a57813e53a9` | `03ebe1a5b7fba123` |

The affected Task 7, Task 8, and Task 10 compatibility vectors are deliberately updated in
their existing tests and retain their prior-shape projections when the new sequence field is
removed. The final Task 13 command
and Design Mode behavior adds no authoritative state field, so it does not alter the initial
compatibility vector beyond `nextBlueprintSequence`. The subtask order above was corrected on
4 September 2026 after implementation work confirmed that pure materialization is the approved
Task 13.3 boundary and `SAVE_BLUEPRINT`/`RENAME_BLUEPRINT` belongs to Task 13.4.

## Consequences

Blueprint records remain valid historical data without silently changing meaning when content
changes. The validator is independent of current content, while commands carry the cost of
content-aware checks only at explicit Blueprint operations. The authoritative sequence is
serialized, so save/replay hashes change by design. No Blueprint work runs on an ordinary
production tick beyond identity protection of the immutable branch. Previous-configuration
provenance remains deferred because current authoritative state does not track the required
configuration history.
