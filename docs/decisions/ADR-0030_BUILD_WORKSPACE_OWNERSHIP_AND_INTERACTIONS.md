# ADR-0030: Build Workspace ownership and interactions

Status: accepted and implemented for Phase 3 Task 22; independently reviewed at CP22.

## Decision

SimCore remains the sole gameplay authority. It owns `GameState`, validated commands,
100 ms ticks, RNG, transactions and pure Build reads. A private Build read-generation
tracker is derived at read/submission boundaries and is not serialized, hashed, replayed or
stored in authoritative state. Build reads return detached, deeply owned result unions.

The existing Worker host owns one SimCore, request serialization, epoch/request correlation,
guarded Build admission, publication, persistence and cleanup. It does not create a second
gameplay state or own camera state. GameClient/store owns correlation and immutable admitted
models; it never recalculates domain formulas or fabricates authoritative entities.

The future Build controller owns only local tool, cursor, selection, camera and one pending
operation. React owns layout, panels, dialogs, focus and accessibility. Pixi owns scene
objects, transforms, hit testing and bounded effects. Save and Replay retain their accepted
boundaries and do not contain camera, query-cache or renderer resources.

Allowed direction is UI/controller → GameClient → Worker → SimCore and SimCore → neutral
read models. Simulator/domain code must not import app, UI, rendering or browser modules.

## Build read and guarded-write contract

The context source is the validated content bundle plus the current authoritative facility,
inventory, economy, research, Blueprint and Benchmark branches. Catalog ordering is stable
content/ID order. Inventory reservation/reuse, research locks, credit eligibility, Apply
eligibility and feature flags reuse existing domain guards. Placement, edit, Apply, Blueprint
and manual-route reads are advisory; the original validated command handler remains the
acceptance boundary.

Build generation observes live layout, draft lifecycle/identity/revision, inventory,
cash/credit and relevant totals, unlock statuses, Blueprint records, identity counters,
active Benchmark lock, content and dimensions. Temperature-only changes, selection and
camera do not invalidate geometry intent. Cancel followed by re-entry at revision zero does.
Replacement constructs a fresh tracker only after candidate validation; rejected replacement
and fatal rollback cannot promote candidate evidence.

The 22.4 transport extension adds strict `QUERY_BUILD` and guarded Build-command records and
increments only the Worker protocol to version 2, while preserving `simulatorProtocolVersion`,
save and Replay versions. A stale generation is
a transport-level `STALE_BUILD_VIEW` and is not queued; a queued command retains its actual
`CommandResult`. Port geometry is exposed as owned presentation data only when the wire and
store are extended together.

## Explicit non-decisions

No new authoritative state/save/Replay field, balance mechanic, generic callback, browser API,
renderer implementation, automatic route search or Phase 4 feature is introduced by this ADR.
Later tasks may consume this boundary but must not widen it into a second authority.
