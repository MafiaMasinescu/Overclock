# ADR-0030: Build Workspace ownership and interactions

Status: accepted and implemented for Phase 3 Task 22; independently reviewed at CP22.
Task 23 rendering/selection addenda are implemented and checkpointed by CP23 in the
commit containing this update; later construction/routing tools remain outside it.

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

## Task 23 renderer addendum

Task 23 implements the presentation side of the accepted boundary without adding a
second gameplay authority. The Pixi adapter owns one private `Application`, one world
root, and the fixed back-to-front layers `grid`, `heat`, `routes`, `modules`, `ports`,
`selection`, `ghost`, and `effects`. Module and route display objects are keyed by
owned projection IDs; immutable geometry revisions reconcile those keys while thermal,
warning, selection, and utilization changes update local visuals without replacing
unrelated objects. No texture cache is introduced until a later sprite contract exists;
the current visuals use bounded local primitives and report a zero cached-texture count.

The adapter owns asynchronous initialization, pending model/size state, generation
checks, a single dirty render request, resize/DPR application, WebGL context-loss
recreation, visibility suspension, listener teardown, and retry status. React owns
layout, status text, toolbar buttons, focus, localization, and inspector presentation.
Camera state is local to the adapter: CSS pointer coordinates are converted to world
coordinates with a 32 CSS-pixel tile, zoom is clamped to `0.35..3`, pan is bounded to
the grid, and device-pixel ratio is applied only to the renderer backing buffer.
Pointer/keyboard input emits typed intents; camera, hover, and the keyboard cursor never
enter SimCore or produce gameplay commands. Hit-test priority is port, module, route,
then in-bounds tile, with stable IDs and a 6 CSS-pixel route tolerance.

Selection context remains a bounded `GameClient.setPresentationContext` update. The
inspector consumes the existing authoritative snapshot and grid projection, including
explicit unavailable values, source tick, Live/Draft mode, route endpoints/capacity,
and live temperature where the projection provides it. No renderer resource, camera
value, telemetry formula, or selection is serialized into authoritative state.

## Task 23 owner-directed selection refinement (2026-10-02)

An ordinary empty-tile click and keyboard Enter replace the current selection with one
tile, including after a rectangle selection. Module/route membership behavior remains
unchanged. Drag still selects an inclusive rectangular tile area on release. This
supersedes the earlier owner-directed accumulation of unrelated empty tiles.

While the pointer is held, a separate Pixi layer shows a darker blue area without
publishing presentation context. Cells are keyed by their actual coordinates; growth
adds only entering rows/columns and shrinkage removes only departing cells, retaining
the display objects for the overlap. Escape, focus loss, pointer cancellation, tool or
camera changes, resizing, and layout replacement cancel this local preview. Drag
endpoints beyond the facility clip to its actual boundary; clicks there remain invalid.

Coordinate labels derive from accepted grid dimensions and camera transforms, using
one-based display indices at the owner's request. Internal tile IDs, hit coordinates,
save data, and Replay remain zero-based; the inspector translates its tile title only
for display, matching the grid labels. They move with the grid, keep a readable CSS
font size, and thin their spacing at low zoom. They replace the removed static
decoration with real presentation geometry, without introducing any simulator data.

The toolbar shows the actual camera zoom as a rounded percentage after the zoom-in
button. It consumes typed camera-change intents, including initial/recreated camera
and Fit, wheel, keyboard, and toolbar changes; no simulator read or command is needed.

## Task 23 review corrections (2026-10-04)

One selection controller owns both canvas and DOM input. It coalesces requests,
preserves unchanged membership identity, clears obsolete epoch/connection intents,
and synchronizes cleared context after same-epoch resync. Non-live gestures and
clock controls are disabled; rejected clock transport promises never change the
display optimistically or retry an unknown outcome.

Twelve definition-keyed primitive designs consume caller-localized short names.
Retained body/design/status/text objects separate actual visual changes from unused
temperature updates; grid/port/selection signatures and keyed heat cells retain
unaffected resources. Dirty counters count real work. Bounded cabinet primitives
use the pinned Pixi batching API. No dependency or authoritative field changes.

Persisted/imported frameCap is detached session metadata read through the existing
Build context query. Only dirty presentation scheduling is capped at 30/45/60;
simulation clock, deterministic state and Replay are unchanged. Geometry source
and Live physical source/tick have separate badges. Unsupported route capacity
and draft-only measurements remain unavailable instead of being derived in UI.
