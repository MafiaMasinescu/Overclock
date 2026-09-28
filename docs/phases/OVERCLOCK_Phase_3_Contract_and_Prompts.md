# OVERCLOCK Phase 3 Contract and Implementation Prompts

Planning edition 1.0, 27 September 2026. Language of executable prompts: English.

Status: adopted implementation contract; Task 22.1–22.4 and CP22 are complete in the commit
containing this update. Task 23 is not started. This document records the contract, not a Phase 3
closure or permission to skip later independent checkpoints.

Repository path: `docs/phases/OVERCLOCK_Phase_3_Contract_and_Prompts.md`.

## 1. Evidence, authority, and entry decision

Planning reference: repaired Phase 2 parent `d63a34c7b030f748a7eac141bf790eb6e4228f7d`.
The actual synchronized Phase 3 base is `f982c7dbec5f7f444988eb7130b1db3ee7803dfb`,
subject `fix: close phase 2 closure audit findings`; it is the recorded `PHASE3_BASE` and
`TASK_22_BASE` in `docs/status/PHASE_3_ENTRY.md` and `TASK_22_WORKING_STATUS.md`.

The independent audit found two Important defects at this reference:

1. F1: save admission accepts a trailing unpaired high surrogate, including in a module ID. Encoding, SHA verification, decoding, and core construction succeed, but the Worker presentation parser rejects the resulting string.
2. F2: recovery skips a structurally corrupt autosave and loads an older valid generation. The next autosave still fails because rotation attempts to validate the retained corrupt record before pruning.

The audit report is `OVERCLOCK_Phase_2_Closure_Audit.md`; its evidence archive includes a standalone reproducer. Existing tests passing does not close either finding. The audit's fresh Chromium run was blocked by browser download infrastructure. Its EPYC measurements were non-gating. Owner-approved Phase 2 timing/RAM exceptions remain accepted in their recorded scope; they do not waive F1/F2 or future correctness failures.

### 1.1 Mandatory entry conditions

Before any Phase 3 source implementation:

1. The Phase 2 F1/F2 repairs are independently reviewed, committed, pushed, and synchronized. Confirm the repaired commit is a descendant of the planning reference. Record its full hash as `PHASE3_BASE`; do not invent it now.
2. Regressions reject malformed Unicode consistently and prove recovery followed by multiple successful autosaves, including the real Chromium/IndexedDB path. The repair preserves damaged evidence according to the accepted persistence decision.
3. A fresh Phase 2 reclosure report records the exact repaired commit, correctness/determinism/browser results, compatibility, and any retained owner-authorized performance exception. No Critical or Important finding remains.
4. The implementation checkout is clean. HEAD, origin/main and remote main match, with 0/0 divergence. Read applicable `AGENTS.md` files.
5. Compare the repaired APIs with this document. Reconcile filenames, harmless signature changes, or ADR numbering from evidence. Stop only for a material unresolved behavior/ownership conflict. Do not ask again about decisions explicitly settled here.
6. The user explicitly starts Task 22.1. Supplying or reviewing this planning artifact is not itself an instruction to implement Phase 3.

The owner has already accepted the historical Phase 2 timing/RAM limitations in their documented scope. Do not reopen those decisions merely because exact 8 GiB certification is absent; require new evidence or approval only for a new or uncovered gate. F1/F2 remain correctness blockers.

If a condition fails, stop before Phase 3 edits and report the missing evidence. Do not repair Phase 2 inside a Phase 3 checkpoint. The existing audit already provides the narrow repair recommendations.

Authority after adoption: user-approved decisions, applicable repository instructions, accepted ADRs including ADR-0022 and the repaired Phase 2 ADRs, this adopted Phase 3 contract, reconciled Markdown TDD and phase plans. GDD supplies product direction. Word documents remain archival. Historical ADR scope statements describe their original checkpoint; they do not make completed Apply, persistence, or Worker behavior pending again.

### 1.2 Actual Phase 3 inventory

| Old Phase 3 scope                | Current status                      | Reuse and remaining work                                                                                              |
| -------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Camera, zoom and pan             | Absent                              | Empty Pixi adapter mounts a canvas and handles size/lifecycle only.                                                   |
| Grid and module scene            | Partial foundation                  | Owned GridViewModel and stable IDs exist; actual scene reconciliation is absent.                                      |
| Selection and inspector bridge   | Partial                             | PresentationContext and inspector projection exist; public client context method and interaction UI are missing.      |
| Inventory/Catalog Build Tray     | Placeholder                         | Current cards are disabled/static; quantity, reservations, prices and eligibility must come from a narrow read model. |
| Purchase and placement           | Domain complete, UI absent          | Reuse BUY_MODULE, PLACE_MODULE and reservation rules. No replacement economy.                                         |
| Move, rotate, remove, ghost      | Domain complete, UI absent          | Reuse exact footprint/port geometry and draft commands.                                                               |
| Manual Power/Data routes         | Domain complete, UI absent          | Reuse inclusive paths, canonical endpoints, route capacity and validation.                                            |
| Auto-connect and A*              | Absent                              | Add deterministic command-time planning, with unchanged route gameplay.                                               |
| Design lifecycle/Undo/Redo/Apply | Domain complete, UI absent          | Reuse detached draft operations, preview and existing transactions.                                                   |
| Heatmap/temperature overlays     | Transport complete, renderer absent | Consume acknowledged thermal updates and authoritative temperature reads.                                             |
| Blueprint UI                     | Domain complete, UI absent          | Reuse save/rename/materialization/instantiate and fresh-ID ownership.                                                 |
| Diagnostic Pulse                 | Reserved command/type only          | Implement a presentation effect from existing facts; do not register a simulator mutation.                            |
| Responsive Build Workspace       | Static shell only                   | Replace placeholders with truthful controls at four desktop sizes.                                                    |

The current shell still includes literal progress `18%`, static telemetry numbers, a placeholder chart and `PHASE 0` labels. These must disappear from the Phase 3 product surface. Full Task, Research, Overclock and Benchmark workspaces remain Phase 4.

## 2. Goal, deliverable, and boundaries

Deliver a usable desktop Build Workspace around the existing production Worker/GameClient: inspect a live facility, plan a draft, obtain parts in the same workspace, place and edit modules, connect them, review and apply changes, inspect heat, and save/instantiate unlocked subassembly Blueprints. Real commands remain the only mutation path.

In scope: a functional Pixi renderer; camera and desktop input; selection; truthful read-only inspector/header/task summary; Inventory/Catalog controls; Design Mode tools and previews; manual routing plus research-gated automatic route planning; adjacent auto-connect; live heatmap; Blueprint controls; Diagnostic Pulse; Romanian/English strings; basic accessibility; responsive layout; recovery-safe interactions; executable browser/visual/performance evidence.

Deferred: complete gameplay workspaces, task acceptance/allocation UI, Research actions, Overclock controls, Benchmark controls/results, tutorial/prolog, semantic alert/event-log system, charts/history, achievements, Museum/final screen, audio, production forecasts, workload-dependent Power/Heat, new economy settlement, route capacity/congestion gameplay, automatic rerouting, group move/rotation, clipboard import/export, nested Blueprints, thumbnails, mobile/touch, WebGPU-specific optimization, OffscreenCanvas/new workers, cloud services, Tauri, new gameplay content or balance.

Phase 3 does not have to make a new run finish the campaign through UI. Use valid test fixtures to demonstrate research-gated tools; never expose unlock/debug grants in the production app. The milestone bot remains the campaign regression oracle.

Exit requires all seven checkpoints plus the final independent phase-boundary audit. A functioning screen alone is not closure.

## 3. Decision register

These are explicit planning decisions for adoption, not questions delegated to Luna.

| ID     | Decision                                                                                                                                                     | Consequence                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-D01 | Implementation waits for repaired Phase 2 closure; planning can proceed now.                                                                                 | No false READY declaration.                                                                                                                    |
| P3-D02 | Tasks continue as 22–28, with one checkpoint per task.                                                                                                       | Published Task IDs 1–21 remain unchanged.                                                                                                      |
| P3-D03 | Luna xhigh for bounded implementation; Sol High in a fresh chat for independent checkpoints.                                                                 | No promise about quota savings or model equivalence; scope and evidence control risk.                                                          |
| P3-D04 | Existing commands and authoritative schemas remain unchanged.                                                                                                | No generic batch mutation, BUY_AND_PLACE command, new history operation, or save migration.                                                    |
| P3-D05 | One purchase/place gesture may execute BUY_MODULE then PLACE_MODULE.                                                                                         | A successful purchase is not refunded by placement rejection, Undo or Cancel. Explain this before confirmation.                                |
| P3-D06 | Each placed module and each generated connection retains its own existing Undo operation.                                                                    | No claimed atomic undo of a placement series. Blueprint instantiation retains its existing one-group operation.                                |
| P3-D07 | Multi-select supports inspection, Blueprint capture and ordered removal. Group move/rotation is deferred.                                                    | Ordered removal can complete partially; never claim group atomicity.                                                                           |
| P3-D08 | Explicit manual routes remain available before `auto-route` research. A* requires that feature. Adjacent-only auto-connect is basic construction assistance. | Research `research-modular-wiring` keeps the long-route automation unlock.                                                                     |
| P3-D09 | Adjacent auto-connect starts disabled each session; the player can enable it visibly.                                                                        | It applies only after an accepted single-module place/move/rotation, never on load/tick/Undo/Redo/Blueprint instantiation.                     |
| P3-D10 | Route penalties guide path selection only.                                                                                                                   | Crossing, sharing, capacities, stored congestion and allocation formulas remain Phase 1 semantics.                                             |
| P3-D11 | Preview/planning executes through narrow read APIs in the existing Worker.                                                                                   | No UI GameState, main-thread SimCore or save export for pointer movement.                                                                      |
| P3-D12 | Build writes use an epoch-scoped guarded transport wrapper around existing commands.                                                                         | Stale UI intent is rejected before domain enqueue; valid commands use the normal FIFO and Replay path.                                         |
| P3-D13 | Increment the live Worker transport protocol once for this coordinated client/Worker extension.                                                              | Worker protocol 1 becomes 2 if Phase 2 repair has not already advanced it. SaveExecution simulator protocol and Replay versions do not change. |
| P3-D14 | Cost/downtime/diff preview is exact existing output; performance/thermal forecasts stay unavailable.                                                         | No speculative dry-run simulation or invented estimate.                                                                                        |
| P3-D15 | Diagnostic Pulse is presentation-only and read-only.                                                                                                         | The reserved TRIGGER_DIAGNOSTIC_PULSE command stays unregistered; no command/RNG/hash change for a pulse.                                      |
| P3-D16 | Heatmap respects `heatmap` research; temperature inspection remains available.                                                                               | Phase 2's complete thermal transport is not treated as a gameplay unlock.                                                                      |
| P3-D17 | Renderer gets owned normalized models plus separate local overlays.                                                                                          | Selection/hover/camera/ghost/effect clocks stay out of deterministic state and saves.                                                          |
| P3-D18 | Keep pinned React/Pixi/dependencies and current industrial palette.                                                                                          | No React-per-tile renderer, new state framework, external font/asset service or speculative engine rewrite.                                    |
| P3-D19 | Existing settings persist only through Phase 2 settings APIs. Camera/filter/tool/auto-connect preferences remain session-local.                              | No schemaVersion/contentVersion bump for UI preferences.                                                                                       |
| P3-D20 | Chromium automation and screenshots are required evidence.                                                                                                   | Codex can self-review through Playwright and image inspection without native computer use.                                                     |
| P3-D21 | Existing target-host exceptions remain specific to their accepted scope.                                                                                     | Fast development-host timings never certify i7-2600/GTX1050 or erase misses.                                                                   |
| P3-D22 | Checkpoint-neutral permanent wording; temporary handoffs only between subtasks.                                                                              | A commit must not make its own documentation immediately false.                                                                                |

No unresolved product choice is hidden in the prompts. Remaining entry gates are evidence, repair compatibility and owner execution authorization. If the owner later wants purchase cancellation to refund automatically, atomic group edits, or predicted gameplay deltas, that is a new contract decision before implementation.

## 4. Ownership and dependency contract

| Owner                | Owns                                                                                                     | Must not own                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| SimCore              | State, commands, ticks, RNG, transactions, pure Build reads and private read-generation tracking         | DOM, Pixi, wall clock, transport epochs                                 |
| Existing Worker host | One core, request serialization, guarded Build request admission, publication, scheduler and persistence | A second gameplay state or UI camera                                    |
| GameClient/store     | Correlation, immutable admitted models, query/result promises, epoch reset                               | Mutable state, formula recalculation, optimistic authoritative records  |
| Build controller     | Local tool, cursor, selection, pending gesture, camera, one operation coordinator                        | Mutating snapshots, patching GameState, fabricating successful commands |
| React                | Layout, panels, dialogs, text, focus, accessibility and scoped subscriptions                             | One component per tile or render-frame telemetry state                  |
| Pixi adapter         | Scene objects, transforms, hit testing, heat colors and bounded effects                                  | Command dispatch, domain mutations, authoritative identity allocation   |
| Save/Replay          | Existing accepted boundaries                                                                             | Camera, tool, query cache, renderer resource or pulse timing            |

Allowed directions: UI/controller → GameClient → Worker → SimCore; SimCore → neutral read-model types; Pixi → neutral presentation/input types; pure planning → existing grid geometry/manual-route validation. Simulator/domain modules must never import `src/app`, `src/ui` or rendering/browser code. Renderer must never import SimCore, command handlers or devtools.

Content labels and footprints come from validated content/projection. Module sprite keys map to twelve local, readable visual designs using simple primitives/cached textures and short localized labels. Do not fetch remote assets. The canvas depicts one facility and one scale.

## 5. Narrow Build read and write APIs

### 5.1 Read models

Create simulator-neutral Build contracts in `src/sim/selectors` or a focused `src/sim/build` directory. Extend the current public APIs rather than installing a parallel bridge.

The Build context read supplies:

1. Viewed mode, live layout revision, draft revision, current observed tick, read generation, dimensions.
2. Module catalog entries in stable content/ID order: definition ID, name/description keys, category, base footprint, price, research lock, inventory quantity, reservation requirement, reusable installed quantity, available additional placements, purchase eligibility/reason.
3. Undo/Redo availability, active Benchmark Apply lock and exact Apply eligibility/reason. The existing coarse `commandAvailability` hint is not proof that a specific transaction can or cannot succeed.
4. Feature flags derived from existing research for `auto-route`, `heatmap`, `subassembly-blueprints`, `power-headroom-inspector` and `stability-inspector`. Always retain basic temperature/safety warnings and primary header values. Extended inspector details and Diagnostic Pulse must not bypass the applicable existing feature unlock. No new research content.
5. Existing settings needed by rendering and localization, exposed as detached session metadata from the host, not GameState. Apply imported settings through the existing path.

Queries are exact discriminated records for context, placement, move, rotate, removal summary, Apply preview, manual route validation, automatic route plan, adjacent candidates, Blueprint list/detail/materialization preview, and Diagnostic Pulse evidence. Blueprint listing uses stable ID order, a nullable after-ID cursor, limit 1–50, and no unbounded history blob. Query results use strict corresponding result unions with status, reason/localization parameters, observed source and detached data. No generic arbitrary JSON callback.

Reuse `validateModulePlacement`, `resolveRotatedFootprintSize`, `resolveModulePortGeometry`, `calculateDesignInventoryReservations`, `calculateDesignApplyPreview`, `validateManualRoutePath`, `resolveManualRouteEndpoints`, `planBlueprintMaterialization`, and accepted content/Research/Blueprint guards. Extract a small shared pure preflight helper from a command if needed; retain its original ordering, numeric handling and command behavior. Do not create weaker parallel validation.

Placement previews distinguish inventory reuse and Catalog purchase. A Catalog preview can be valid with one required purchase even when the current inventory alone is insufficient. It must verify geometry, unlocks, quantity/arithmetic and the same credit rule as BUY_MODULE. It reports purchase cost separately from eventual Apply labor/salvage. It never reserves, purchases, allocates IDs, or changes RNG.

Blueprint materialization previews strip predicted global IDs/counters from outward data. Use local preview handles, transformed occupied positions, internal route geometry, required inventory and reasons. The existing planner may calculate a candidate internally, but preview output is never authority and cannot reserve those future IDs.

### 5.2 Generation and guarded submission

Add a private Build read-generation tracker per SimCore, outside state/hashes/Replay. It detects changes relevant to a Build decision: live layout revision; draft lifecycle/identity/revision; inventory; cash/credit and relevant arithmetic totals; unlock statuses; active Benchmark configuration lock; Blueprint records; module/route identity counters; content/dimensions. It must detect Cancel followed by re-entering revision 0. Ordinary temperature changes, camera, selection and time alone do not invalidate geometric Build intent.

Track actual dependencies by immutable identities plus the necessary small value projection. Do not canonical-serialize or clone the whole state to detect changes. Advance the safe integer generation lazily at a read/submission boundary; cache state is not gameplay. Rejected state replacement must not contaminate the retained tracker; successful replacement constructs a fresh tracker, and Worker promotion changes epoch. Failure/rollback must not certify a candidate generation as committed.

Expose `queryBuild(...)`, `setPresentationContext(...)`, and `dispatchBuild(command, expectedGeneration)` on GameClient, with exact fake-client counterparts. A Build query carries a client intent sequence. A response carries that sequence, observed source and the current generation. Worker epoch and request sequence retain their existing meaning.

The guarded write accepts only the Build command whitelist: ENTER_DESIGN_MODE, BUY_MODULE, PLACE_MODULE, MOVE_MODULE, ROTATE_MODULE, REMOVE_MODULE, CONNECT_PORTS, DISCONNECT_ROUTE, UNDO_DESIGN, REDO_DESIGN, APPLY_DESIGN, CANCEL_DESIGN, SAVE_BLUEPRINT, RENAME_BLUEPRINT, INSTANTIATE_BLUEPRINT. Clock controls keep `setPaused`/`setSpeed` and their existing sequence rules.

In one serialized Worker operation, validate envelope/epoch and expected Build generation, then enqueue/process the unchanged SimCommand without an await between the guard and domain admission. A stale generation returns a strict transport-level `STALE_BUILD_VIEW` result, explicitly not queued. It consumes no simulator queue sequence or command history. Malformed transport is not a gameplay rejection. Once queued, report the real CommandResult with its command ID and the post-operation generation/source. Do not fabricate a new SimCommand kind, rejection code, receipt or Replay entry for a read/guard failure.

Preserve normal request accounting, byte limits, ACK_RESULT, fatal cleanup and unknown-outcome handling for the new request/reply kinds. Do not weaken existing Worker parsing. Extend strict schemas and source mapping together. Increment only the Worker protocol at the coordinated boundary; old Worker/new client mismatch fails clearly and recreates the matching session through the existing bootstrap, without replaying unknown commands.

Queries are serialized with the host queue and cannot mutate state. Allow at most one pending pointer preview plus one latest replacement. Send at most 10 pointer-preview queries per second; do not send the same tile/rotation/mode again while dependencies are unchanged. Context/catalog refresh is event-driven with a maximum ordinary rate of 2 Hz. Commit-triggered refreshes may bypass that presentation refresh rate. There is no query on each render frame.

### 5.3 UI operation coordinator

One Build operation is active at a time. Freeze its input at confirmation, disable conflicting tools, and use client-generated UUIDs outside the simulator. Distinguish unsubmitted, queued, accepted-awaiting-publication, rejected, and unknown outcome.

The renderer keeps a pending ghost until the authoritative published layout reflects the accepted result. A command result can precede the rate-limited publication. Never manufacture a placed module or route in the store to hide that delay. For source-only/no-op commands, do not wait for a revision increment that cannot occur. One explicit full-resync request is allowed when reconciliation times out; it must not resend the command.

Ignore stale query replies by epoch, intent sequence, tool identity and layout source. On disconnect/load/recovery/new run, clear gestures, previews, selection and command eligibility; keep only harmless local layout preferences. Recreate the adapter on client/session replacement. Unknown outcomes stop the operation and use Phase 2 recovery, never an automatic command retry.

## 6. Build interaction and transaction semantics

### 6.1 Inventory, Catalog and purchase/place

The bottom tray has Inventory, Catalog and Blueprints tabs. Provide category/search filters, footprint, price, quantity/reservation information, research lock and a concrete disabled reason. No separate shop screen.

Inventory mode uses available inventory plus reusable installed hardware under existing net reservations. It never buys silently. Catalog mode uses an available part first and buys exactly one only when required. Selecting a card starts a ghost without spending cash. If no draft exists, entering an edit tool may send ENTER_DESIGN_MODE once, then activate the ghost after acceptance. The live simulation keeps its existing pause state and continues behind the draft.

On a valid placement confirmation:

1. Refresh/validate the frozen placement intent against the current Build generation.
2. If needed, dispatch BUY_MODULE quantity 1 and await its real result. A rejection stops before PLACE_MODULE.
3. After accepted purchase, obtain a fresh placement preview/generation for the same frozen position. If no longer valid, stop and show that the part remains in Inventory.
4. Dispatch PLACE_MODULE once, reconcile the publication, then optionally request adjacent auto-connect.

No automatic refund, SELL compensation, transaction spanning two commands, or claim that Cancel restores pre-purchase cash. Show a brief persistent explanation in Catalog mode. If placement rejects after purchase, offer selecting the purchased part from Inventory. Purchase-only success remains a valid save/Replay event.

Click-to-place and drag from the tray are both supported. Pointer travel alone never submits a command. Use a 4 CSS-pixel drag threshold. Shift keeps the selected tool after a successful placement; each subsequent click/drop places one item. Do not create a continuous paint brush. Every accepted item has its own Undo step and IDs remain monotonic.

### 6.2 Selection and module edits

Click selects one module/route. Shift-click toggles membership. Rectangle selection selects modules whose occupied footprint intersects the rectangle; do not include routes implicitly. Stable ID ordering defines multi-selection. Hover does not dispatch or change selection. Empty click clears; Escape first cancels the active gesture, then returns to select mode, then clears selection. It never silently cancels the entire draft.

Move and rotation edit one selected module at a time. Move preserves the grabbed tile offset. A placement ghost uses its top-left anchor and the existing clockwise 0/90/180/270 rotation convention. Geometry helpers control footprint and ports; do not rotate an already rotated footprint twice. Preview indicates that attached draft routes will be removed under ADR-0006.

Delete supports either selected routes or selected modules, never a mixed implicit action. Multiple selected routes use the same stable, sequential, stop-on-failure policy as multiple module removals, with one DISCONNECT_ROUTE per ID. Show a bounded confirmation for multiple modules with the attached-route impact. Submit module removals in stable ID order, refresh the guarded generation after each result, stop at the first rejection/unknown outcome, and display the accepted count. This is a sequence of individual transactions, not a group transaction. Group translation and group rotation remain unavailable with a clear explanation.

Undo/Redo dispatch the existing command. Do not keep a second authoritative undo stack in UI. A no-op remains accepted without manufacturing a revision. Moving/removing/cancelling never rewinds IDs.

### 6.3 Apply and Cancel

Apply uses the current pure Design Apply preview: changed IDs, consumption, book value as information, gross labor, salvage, net cost and maximum parallel startup downtime. Show negative net cost as a credit. Preserve the existing credit-limit check, not a simplistic `cost <= current cash` approximation. Existing generic availability may be conservative; the specific query must use the real shared guard.

Show structural differences and explicit unavailable labels for power/compute/temperature/task forecasts. The proposed layout is not a simulated future. Submit exactly expectedDraftRevision, acceptedCostUsd and acceptedDowntimeTicks plus the guarded generation. Stale responses refresh the dialog and require a new user confirmation; never silently approve a changed price/downtime. An active Benchmark permits drafting but blocks Apply under existing rules.

Cancel discards only the draft; independently purchased Inventory remains. Ask for confirmation when the draft contains changes. An unchanged draft closes without a fake cost, downtime, layout revision or autosave transition. Use existing accepted transition facts for autosave; UI does not add a parallel save timer or new trigger.

## 7. Routing contract

### 7.1 Immutable Phase 1 route semantics

Power and Data are distinct selectable layers. Airflow ports are visual direction markers and cannot be cable endpoints. Resolve rotated ports and canonical direction through existing helpers. Every stored route includes endpoint module tiles and each orthogonal intermediate tile. It cannot repeat a tile or cross another module footprint. Shared segments, crossings and shared ports remain allowed; duplicate canonical endpoint pairs remain rejected. New route capacity remains the minimum endpoint capacity and stored congestion remains unchanged from current command semantics.

The public manual validators continue deriving occupancy internally. Never reintroduce caller-supplied occupancy evidence, trust a preview path, or bypass the Task 13/13.7 ordering and identity checks.

### 7.2 Manual editing

Select a source port, trace an orthogonal path, then choose a compatible destination. The source's exterior tile and the destination's exterior tile remain mandatory. Directly opposing adjacent ports use the valid length-two special case.

Pointer tracing appends grid cells, not screen pixels. For a pointer jump, fill missing cells horizontally then vertically from the last cell; mark an obstructed/repeated candidate invalid instead of searching around obstacles. Keyboard arrows append one cell; Backspace removes the last optional path point; Enter confirms a resolved destination. A raw diagonal line is never silently serialized. Escape cancels without a command. Manual route validation returns the original ordered reason before confirmation.

Route hit testing uses a 6 CSS-pixel distance tolerance after camera conversion, stable route-ID tie-breaking, and gives visible ports/modules priority. Selected-route inspector shows endpoints, kind, declared capacity, length and known utilization. Null data utilization remains unknown, not zero or a fabricated animation rate.

### 7.3 Deterministic A* planning

The `auto-route` feature enables automatic planning for a selected endpoint pair. It does not automatically connect every facility port. The pure planner lives in the grid/domain layer and is invoked by the Worker read query. No adjacent-port graph rebuild, pathfinding during ticks, or main-thread simulator is allowed.

Canonicalize the endpoint pair before searching. Reuse port geometry and treat endpoint module tiles as terminal-only. Search the free-tile orthogonal graph between exterior tiles, handling direct adjacency and a shared exterior tile explicitly. Build the inclusive final path and pass it through the unchanged public manual validator before returning it.

Deterministic policy:

- Neighbor order: North, East, South, West.
- Base edge cost: 10 integer planning units.
- Shared-edge penalty: 2 times the number of existing routes of the candidate kind using the undirected edge.
- Crossing penalty on entering a tile: 5 times the number of existing straight-through route segments of either kind perpendicular to that incoming edge at that tile. A route endpoint/turn is not a straight-through segment. These are planning congestion costs, not physical simulation quantities.
- Heuristic: 10 times Manhattan distance to the target exterior tile.
- Priority tuple: total estimated cost, heuristic, row-major tile index, insertion ordinal. Equal-cost revisits keep the earlier parent.
- Use safe integers, canonical endpoint ordering and stable route iteration; no localeCompare, RNG, time budget, randomized tie-break or floating epsilon.
- At most one closed expansion per free tile under this consistent heuristic. Queue duplicates are skipped when obsolete. Bound all input/index allocations by validated grid size and existing wire limits; reject unsafe size arithmetic before allocation.
- Failure returns NO_ROUTE_FOUND with a localized query reason; no draft/counter/queue/state mutation.

Indices and optional scratch are private to a planning runtime and keyed to content identity, dimensions and exact live/draft layout generation. Fully reset on changed generation, replacement and failure. A cache hit/miss must produce the identical path and no different command stream.

Only confirmation sends the explicit path in CONNECT_PORTS. Replay replays that path; it does not recompute A*. Live power delivery and changing temperatures do not reroute an accepted route. Manual routes can use paths the planner would rank differently.

### 7.4 Adjacent auto-connect

The visible toggle starts off and is session-local. When enabled, after an accepted single-module placement/move/rotation has appeared in the draft, query physically adjacent compatible port pairs involving that edited module. Use `arePortsPhysicallyAdjacent` and existing compatibility, skip airflow and existing canonical pairs, sort by canonical from/to port references, and propose only length-two paths.

Submit proposed CONNECT_PORTS commands sequentially through guarded submission. Recheck the current generation/pair before each. Stop at a rejection or unknown result; preserve earlier accepted operations and explain partial completion. Each route is a separate Undo step. Do not retry from a tick, load, view refresh, Undo/Redo or Blueprint instantiation. No graph singleton, recursive chain connection or implicit long-route search.

## 8. Renderer, camera and presentation lifecycle

Replace `emptyPixiGridAdapter` with the real adapter while retaining an explicit lifecycle boundary. Use the pinned PixiJS 8.19.0 API and private application/ticker ownership. Async initialization must be generation-guarded; destroy-before-init and remount must not attach a late canvas or leak a renderer. Initialization failure must reach React as a localized recoverable presentation error.

Scene layers, back to front: background/grid; heat field; routes; modules; port markers; selection/hover/ghosts; bounded diagnostic overlay. Use keyed entity maps and reusable visual resources. On publication, update changed entities and remove missing IDs. A full store model is not permission to destroy/rebuild the scene each tick. Differentiate layout, thermal and local-overlay revisions. Invisible labels can be culled; state and exact inspector data cannot.

Keep local overlay input separate from owned GridViewModel. Extend the adapter with narrowly typed overlay/display-options/error hooks as needed; it emits GridIntent only. React must not create components for every tile, module or route. Do not introduce @pixi/react, a second ticker, physics interpolation or authoritative animation events.

Coordinate policy:

1. A tile is 32 world pixels. Module anchors are integer grid coordinates.
2. Pointer coordinates start in canvas-relative CSS pixels, corrected for the actual bounding rectangle. Device pixel ratio affects backing resolution, not gameplay or hit coordinates.
3. Apply the inverse camera transform once, then floor world coordinates for tiles. Negative/out-of-bounds results remain invalid, never wrapped/clamped into a legal placement.
4. Zoom range is 0.35–3.0, anchored at the pointer. Fit centers the complete facility with a 24 CSS-pixel margin when possible. Pan keeps at least one tile visible; center an axis when the complete grid fits within its available space.
5. Middle-drag pans; explicit toolbar Pan supports left-drag. Wheel zoom applies only over the focused canvas and does not steal panel scrolling. Provide visible zoom-in/out and Fit controls.
6. A camera change changes no grid coordinate, command, revision, state hash or RNG.

Use one private render loop capped by existing frameCap settings. Stop it when hidden or destroyed; resuming rendering earns no simulation ticks. Respect reducedMotion without pulse translation/flicker. Reduced Effects lowers cosmetic work while retaining routes, temperature values, warnings and selection. Keep backing DPR clamped to 1–2 as in the existing adapter. Do not dynamically reduce simulation quality or silently change persisted settings.

On WebGL context loss, disable canvas gestures and show a React retry/pause affordance. Existing time/save/recovery controls remain usable. Rebuild presentation resources from the latest admitted model when rendering returns; do not recreate/reset SimCore to repair a canvas. Clearly show actual pause state; never claim the simulation paused when no clock command succeeded.

## 9. Inspector, heatmap, Blueprints and diagnostics

### 9.1 Truthful readouts

Selection updates the existing presentation context through GameClient; local outlines can update immediately. Requests are bounded and superseded safely. Route/tile/module readouts use existing authoritative data and current content; only display available figures. Unknown values use a localized unavailable label. Null memory/retry/data-utilization/forecast values must not become zero.

Show draft geometry as Draft and physical readings as Live. A moved draft module's live temperature describes its live footprint. A new draft-only module has no measured module temperature. Inspecting a tile reads the current published tile field; an explicit exact-temperature query can refresh at most 10 Hz when needed, labelled with observed tick. Do not infer cooling or future performance from a ghost.

### 9.2 Heatmap

Enable only after the existing `heatmap` feature unlock. The renderer consumes the Phase 2 store's complete accumulated field and acknowledged updates; a full/resync initializes every row-major tile even if the display is hidden. Do not treat a delta as a full field or discard off-screen values.

Use a fixed presentation legend at 20, 40, 60, 80 and 100 Celsius with a cool-to-hot sequential palette, bounded visual colors outside that range, and numeric labels. This is a display scale, not a shutdown threshold. Thermal warnings still come from stored production facts. The displayed field may lag by the accepted dirtyEpsilonC/publication cadence; no smoothing may invent a different thermal simulation. Exact current query values and historical Blueprint summary temperatures must be labelled separately.

Prefer a reused small texture/buffer or batched tile visuals, updated only for changed cells. No per-frame temperature calculation, React tile tree or heatmap-size increase for DPR. H toggles; tooltips/inspector remain readable without the heatmap.

### 9.3 Blueprints

Provide a paged list, name/rename form, compatible/locked reason, module/route counts, bounds, required parts and saved summary. Use `subassembly-blueprints` and the existing validation. Save captures selected live modules only and is disabled while a draft exists. Ask the player to Apply or Cancel first; never silently switch the source to the draft.

Instantiation starts a rotated placement ghost in Design Mode, shows all occupied modules and internal routes plus shortages, then dispatches one INSTANTIATE_BLUEPRINT. Inventory is reserved under the existing cumulative rules; no silent purchasing. Apply remains the settlement boundary. Undo/Redo act on the existing complete group with exact IDs, including padded IDs beyond 99,999,999. Historical incompatible records remain visible/renameable but cannot instantiate.

Ctrl+C while the canvas owns focus opens Save Selection as Blueprint when eligible; it does not copy state to the system clipboard. Ctrl+V starts the currently selected saved Blueprint or opens its picker. Text inputs keep native clipboard behavior. Export/import/nesting/edit-propagation remain deferred.

### 9.4 Diagnostic Pulse

D or its button requests detached diagnostic evidence for the current selection; no selection means a bounded facility summary. Derive route-activity and limitation evidence from recorded Power/Compute/Overclock results and existing warning priorities. Never infer data throughput, simulate a future result, synthesize a per-module Compute breakdown, or treat a draft-only route as carrying live traffic.

Show source tick, reason text and stable entity IDs. Known active Power routes can receive a short outline pulse; unknown activity uses a static connection highlight. Use at most 128 simultaneously animated highlights for two seconds, chosen by deterministic severity/ID order; remaining relevant entities remain listed or statically marked. Reduced Motion uses static outlines. Restarting a pulse replaces the current effect. No cooldown gameplay, resource cost, domain command registration, save entry or Replay event.

## 10. Layout, keyboard and visual quality

Retain the GDD's 1940s industrial direction: dark graphite/paper panels, restrained amber instrumentation, cyan Data, orange Power, red thermal warning and green validation. Use labels/patterns/icons with color. Avoid blur filters, excessive glow, scanline animation and external fonts. No fake performance numbers or progress bars.

| Viewport in CSS pixels | Layout contract                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1920 × 1080            | Header 64; rail 72; right inspector about 400; expanded tray about 208; useful canvas at least 980 × 620.                                                |
| 1600 × 900             | Compact rail; right panel about 340; tray 180; preserve all construction controls.                                                                       |
| 1366 × 768             | Icon rail; right panel 300 or collapsible; tray 160; one expanded secondary section.                                                                     |
| 1280 × 720             | Header about 56; rail 56; panel up to 280; tray 160; usable canvas at least 800 × 360 in the normal build configuration. Long dialogs scroll internally. |

Dimensions are centralized tokens. Adjust a token to resolve measured overlap while retaining the minimum usable canvas and all functions; record the evidence. The page must not gain horizontal scroll. Smaller windows show an explicit minimum-size notice without destroying the active session. Mobile/touch behavior is not implemented.

Header keeps Cash, Useful Compute, Power, Temperature and time controls visible. A read-only active Task summary may be compact; do not add Phase 4 task actions. Navigation for unimplemented workspaces is visibly unavailable and never opens a fake screen. Existing persistence/recovery controls remain accessible and must not cover the placement target or Apply confirmation.

Keyboard: B focuses Build; Space uses existing pause; 1/2/3 select 1x/2x/4x; Q/E rotate by one quarter turn; Ctrl+Z/Ctrl+Shift+Z use domain Undo/Redo; Delete invokes the documented removal flow; H heatmap; D diagnostics; Escape unwinds local interaction; F fits camera. O/R/Info Lens remain Phase 4 unless a currently implemented read-only target exists. Do not advertise dead shortcuts.

Canvas is focusable and has an accessible name/instructions. Arrow keys move a visible tile cursor; Enter selects/confirms the current tool; routing uses the documented arrow/Backspace steps. Provide a DOM entity list and visible coordinate/rotation fields as alternatives to drag. Do not use role=application indiscriminately. Dialogs trap and restore focus; labels are localized; pointer-only hover text has a focus equivalent. Ignore shortcuts in input/textarea/select/contenteditable, during IME composition, with irrelevant modifiers, or behind a modal. Prevent repeated destructive keydown submissions.

All new strings exist in RO and EN. Run both locales and 30% text-expansion visual checks. Formatting uses locale; identity/order/formulas do not. Preserve text contrast, visible focus, at least 32 CSS-pixel actionable controls where compact density permits, and critical 44-pixel dialog actions.

## 11. Verification and performance contract

### 11.1 Test economy

Add the smallest test that proves each changed behavior or boundary. Parameterize rotations/edges instead of duplicating fixture factories. Do not add line-for-line implementation tests, snapshots of incidental object layout, or repeated full campaigns per subtask. Preserve existing exact-100 loops and timeouts.

Luna subtasks run their focused unit/integration tests, relevant Chromium cases for visible UI, typecheck, lint, content validation, formatting check on touched files, production build and diff check. They do not rerun every unchanged diagnostic. Sol checkpoints run the full unit/determinism command once, affected browser/regression matrices, and required task diagnostics. CP28 and final closure apply the comprehensive requirements below. Browser unavailability is BLOCKED, never PASS; mocks cannot certify WebGL, real Worker, IndexedDB, pointer capture or native resize behavior.

Required cross-boundary cases include: stale query after cancel/re-enter; old epoch after load; command accepted before publication; unknown purchase outcome; purchase accepted/place rejected; partial multi-remove/auto-connect; active Benchmark blocking Apply; malformed query/Unicode/prototypes/accessors; pointer cancellation/IME; exact rotated port geometry; obstruction/unreachable routing; reverse endpoint canonicalization; all Blueprint rotations and ID carry; Undo/Redo inventory changes; heatmap full/delta/disable/resync; import rejection and post-recovery autosave; renderer failure while persistence controls remain usable.

### 11.2 Visual self-review without native computer use

Use the pinned Playwright Chromium and actual application with the production Worker. Capture screenshots after deterministic public-command scenarios at all four sizes, RO/EN, standard/reduced effects, and selected expanded-text cases. Inspect the images, not only test exit status. Save screenshots and a short review matrix with scenario, size, locale, observations and disposition. DOM assertions alone do not prove visual correctness.

Required scenes: empty healthy session; dense running facility; invalid and pending placement; selected rotated multi-tile module; manual/automatic route preview; Apply dialog including a credit; heatmap and exact readout; Blueprint shortage/incompatibility; narrow viewport with persistence dialog; recovery-held/renderer-error banner. Normalize animation only for deterministic screenshot capture; separately test motion and performance with real timing. Do not blanket-mask the canvas or update golden screenshots merely to accept a broken layout.

### 11.3 Fixtures and budgets

Reuse accepted dense 24×16 Phase 2 N and Phase 1 thermal/Compute fixtures. The Phase 3 render fixture must retain at least 288 occupied tiles, mixed footprints/rotations, real Power/Data routes, nonuniform heat, active Task and Research, existing Boost, and a Benchmark transition variant. Audit those assertions in an executable fixture test. Keep a 128-Blueprint list/history scenario and blocked-route cases. Do not flatten the scene or turn off the Worker/heatmap to pass rendering budgets.

| Measurement                                               | Cohort                                               | Target-host acceptance                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Pure cached Build context/placement read                  | 100 warm-up, 500 measured                            | p95 <2 ms                                                                                                                       |
| Pure A* long route, same audited dense layout             | 100 warm-up, 500 measured                            | p95 <5 ms; report no-route and cold-index separately                                                                            |
| Adjacent candidate query                                  | 100 warm-up, 500 measured                            | p95 <2 ms                                                                                                                       |
| Input-to-valid-preview, actual Worker                     | 50 warm-up, 200 measured settled pointer requests    | p95 <150 ms including the 10 Hz throttle; no hidden skipped requests                                                            |
| Accepted single Build command to visible committed layout | 20 warm-up, 200 measured                             | p95 <250 ms; report purchase/place and multi-command flows separately                                                           |
| Main-thread publication/store admission                   | Phase 2 unchanged cohort                             | Existing <5 ms budget, retain accepted historical exception only as recorded                                                    |
| Renderer update + CPU submission                          | 300 warm-up frames, 3,000 foreground measured frames | p95 <12 ms at 1920×1080 on i7-2600/GTX1050                                                                                      |
| Foreground frame delivery                                 | Same interval, ordinary cap 60                       | Target 60 FPS; median one-second rate ≥58, p5 one-second rate ≥45 in dense scene; report every hitch/max                        |
| Reduced effects                                           | Same fixture at user frameCap 30/45                  | Honor cap, preserve information; report cadence rather than compare to 60                                                       |
| Ordinary React telemetry/publication                      | At least 60 seconds                                  | ≤10 Hz; chart implementation remains deferred                                                                                   |
| Idle mount/destroy lifecycle                              | 20 complete cycles after warm-up                     | Zero retained adapter/listener/ticker/observer/texture-owned resources by deterministic counters                                |
| Integrated session soak                                   | 60 minutes, once at the final candidate              | Bounded resources and no monotonic retained-object growth; record process/heap measurements and <500 MB target where measurable |
| Simulation/Replay/save/load/import/recovery               | Existing Phase 1/2 fixtures/cohorts                  | Unchanged budgets and accepted narrowly scoped exceptions                                                                       |

Renderer CPU timing covers the measured main-thread callback, reconciliation/transforms and render submission; it is not a claim of GPU execution time. Record CPU/GPU/OS/RAM/browser/Node/build mode, DPR, viewport, fixture, warm-up, samples, median/p95/max and raw results. Use `performance.now()` only in presentation/diagnostic code, never simulation/planning decisions. Report pointer coalescing counts and pending queue bounds.

Use real target hardware for a gating claim. A software renderer, virtualized GPU, EPYC host or unknown RAM configuration is non-gating. No automatic exception, threshold increase, fixture reduction, changed sample count, filtered slow frames, disabled assertions or rerun-until-pass. A measured optimization is allowed within the current contract. If certification cannot run, retain the incomplete gate and stop the checkpoint unless the owner explicitly accepts a new scoped exception.

### 11.4 Compatibility and closure gates

Frozen state, save and Replay shapes/versions remain unchanged. Worker protocol and presentation schema may change as expressly listed. Existing save Unicode golden vectors, Campaign boundaries, Power historical results, Compute ownership, Blueprint IDs and Replay fatal/resume tests stay intact. Presentation reads, camera/input movement and pulse must preserve state/RNG/queue hashes.

Canonical milestone baseline remains: completion 30,270; first Task `(1,780,1,790]`; blocker `(3,560,3,570]`; Blueprint 7,620; years 12,000/24,000; maximum forced deadtime 2,990; RNG 1853565737; state `43f71088b7b8afe6`; Replay `a1a59919e8295897`; report `f2be68edc3374681`; comparison `957959d2decef0e1`. If the repaired Phase 2 baseline legitimately records a new vector, reconcile it at entry with an exact documented reason; never change expected hashes for a UI implementation.

New deterministic path/intent fixtures run exactly 100 times with identical inputs and compare canonical path, command stream/results, final state and unchanged RNG. Use fixed test command UUIDs. In real UI, UUIDs are external command identity; do not pretend two independently clicked sessions must have identical operation-ID hashes without an identical command stream.

CP28 runs full `pnpm test` twice in separate processes, `pnpm validate`, complete Chromium, all unchanged Phase 1/2 permanent diagnostics, new Build/routing/render diagnostics, baseline/duplicate milestone, compatibility and forbidden-import/production-bundle/drift scans. Preserve balancing, module numeric content, GDD direction, Word binaries and lockfile unless a specifically approved dependency change is necessary. This plan requires no dependency change.

## 12. Documentation, decisions and handoff

At Task 22.1, add this adopted file and `docs/status/PHASE_3_ENTRY.md`, recording repaired base hash, entry evidence, accepted exceptions, exact task sequence and ADR map. Allocate actual next-unused ADR numbers after the Phase 2 repair. Do not assume ADR-0030 is still available. Suggested semantic ADRs: Build Workspace ownership/interaction; deterministic route planning; renderer/diagnostic presentation. Record the mapping once; later prompts read it.

Maintain TDD, `03_BUILD_WORKSPACE.md`, PROJECT_STATUS and README only for behavior actually completed. Supersede conflicting sketches explicitly: deferred Apply wording is historical, one-gesture purchase is not refund-on-Cancel, each placement/connection has its own Undo, A* penalties are planning-only, unknown forecasts remain unavailable, Diagnostic Pulse is presentation-only. Do not rewrite old compatibility decisions or archival Word files.

Permanent diagnostics: `docs/diagnostics/PHASE_3_BUILD_WORKSPACE.md`, `PHASE_3_ROUTING.md`, `PHASE_3_RENDERING.md`, `PHASE_3_VISUAL_REVIEW.md`. Create these when evidence exists; do not fabricate empty PASS tables in foundations.

Within one task, use `docs/status/TASK_<N>_WORKING_STATUS.md` for base, reviewed accumulated files, completed scope/tests and exact next subtask. Update it at coherent stopping boundaries. Remove it only after useful information moves to permanent docs at its checkpoint. No /status, usage-percentage polling or fabricated remaining-quota claims.

Git status checks between subtasks are a small ownership check, not a repeated phase audit. Fetch/public-ref verification happens at task entry and checkpoint. Preserve all explained uncommitted work for that task; never reset/stash/delete it to obtain a clean preflight. Unknown changes require narrow clarification rather than discarding them.

## 13. Decomposition and checkpoint map

| Task | Required completed gate | Subtasks                                                                                                  | Checkpoint deliverable                                   |
| ---- | ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 22   | Repaired Phase 2 entry  | 22.1 contract/types; 22.2 owned context/generation; 22.3 pure previews; 22.4 Worker/client guarded bridge | CP22: read/command boundary, no real construction UI yet |
| 23   | CP22                    | 23.1 scene lifecycle/reconciliation; 23.2 camera/hit tests; 23.3 selection/inspector and subscriptions    | CP23: truthful inspectable live/draft canvas             |
| 24   | CP23                    | 24.1 Inventory/Catalog; 24.2 purchase/place gestures; 24.3 module edits and history; 24.4 Apply/Cancel    | CP24: complete manual module construction flow           |
| 25   | CP24                    | 25.1 pure route planner; 25.2 manual/automatic route UI; 25.3 adjacent auto-connect and route parity      | CP25: usable deterministic routing                       |
| 26   | CP25                    | 26.1 Blueprint UI; 26.2 heatmap; 26.3 Diagnostic Pulse/reduced effects                                    | CP26: reusable layouts and truthful visual diagnostics   |
| 27   | CP26                    | 27.1 responsive shell; 27.2 keyboard/accessibility/localization; 27.3 visual review/browser matrix        | CP27: usable desktop workspace at all four sizes         |
| 28   | CP27                    | 28.1 integrated performance; 28.2 recovery/soak/compatibility; 28.3 complete verification/docs            | CP28: Phase 3 closure candidate                          |

There are 23 implementation subtasks and seven independent checkpoints. Work stays linear to keep diffs attributable. One subtask prompt per Luna turn/chat; several may share a chat while its context is stable. Sections 1–13 are the normative contract. Implementation chats read those once when starting a new task/chat, then the specifically relevant sections and their own prompt. They do not need to load every future prompt or all historical diagnostics on every subtask. A new chat reads its task handoff and current diff. Never combine unreviewed tasks 22–28 into one final diff.

Each task starts only after its prerequisite checkpoint is approved and published. Phase 4 planning/implementation is outside this document.

## 14. Copy-ready entry verification prompt

Run this after the Phase 2 repair checkpoint, not against the currently defective planning reference. Use Sol High. This is a bounded read-only prerequisite check, not another request to implement Phase 2 or Phase 3.

```text
Verify OVERCLOCK's repaired Phase 2 entry for the supplied Phase 3 contract.
Use GPT Sol with high reasoning. Do not edit, stage, commit, push or implement Phase 3.
Read applicable AGENTS.md, PROJECT_STATUS, current accepted ADRs, the independent Phase 2 audit with F1/F2, its repair report, and the supplied Phase 3 contract.
Fetch public main. Require clean HEAD = origin/main = remote main and 0/0 divergence. Verify the repaired commit is a descendant of d63a34c7b030f748a7eac141bf790eb6e4228f7d. Stop if the repair range is ambiguous.
Review the actual repair and prove that a trailing lone surrogate is rejected before save promotion/publication, including keys and values. Prove corrupt-autosave fallback followed by Continue and repeated autosaves restores progress and three complete valid rotations under the accepted damaged-evidence policy.
Run focused repaired save/Worker/repository tests and their real Chromium cases. Verify the separate complete reclosure evidence belongs to this repaired commit, including complete tests/determinism/validation, compatibility and recorded performance exceptions. Do not call mocks a native browser pass.
Compare current GameClient, Worker, projection, Design, route and Blueprint APIs with the Phase 3 planning reference. List exact harmless naming changes; stop on an unresolved behavior/ownership change.
Report full repaired base hash, refs, parent/range, clean state, repair proof, available/blocked browser evidence, remaining scoped exceptions and either ENTRY READY or ENTRY BLOCKED. ENTRY READY permits the user to invoke Task 22.1; it does not automatically execute it or design Phase 4.
```

## 15. Copy-ready Luna implementation prompts

Each block below is one complete implementation request. Keep this complete contract available to the implementation chat. The block names the exact applicable sections and repeats the operating gates; do not run all blocks as one autonomous implementation request.

### Prompt 22.1: Adopt the conditional contract and define Build read types

```text
Implement OVERCLOCK Phase 3 Task 22.1: Adopt the conditional contract and define Build read types.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This is the first Phase 3 edit. Run git fetch origin, inspect HEAD/origin/main/remote main, ahead/behind and git status. Require a clean synchronized descendant of d63a34c7b030f748a7eac141bf790eb6e4228f7d with the independently reviewed F1/F2 Phase 2 repairs. Read their commit diff and exact browser/reclosure evidence. Record that full hash as both PHASE3_BASE and TASK_22_BASE. Stop without edits if the repair or closure remains unresolved. Do not assume the earlier public closure claim overrides the later independent findings.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 1–5, 12–13. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
neutral Build query/result types; Phase 3 entry and ownership ADR; phase/status/TDD/README documentation.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Verify the repaired Phase 2 entry first. Import the complete attached contract unchanged except for evidenced API/ADR-number reconciliation. Record PHASE3_BASE and the repair/browser evidence in docs/status/PHASE_3_ENTRY.md. Explain any accepted performance exception precisely.
2. Allocate the next unused ADR for Build Workspace ownership and interactions. Record its actual path in the entry document. Mark later routing/renderer details as approved design but not implemented features.
3. Define exact neutral query, source-stamp, guarded-write outcome and result unions described in sections 5–9. Separate core data from host-owned settings/epoch data. Define bounded Blueprint pagination and preview-only local handles. Existing SimCommand, GameState, saved execution and Replay schemas remain unchanged.
4. Define typed local input/overlay contracts, including one-operation status and ownership. Do not register transport handlers or make required changes to the current public GridViewModel/GameClient that would break the running Phase 2 app; integration belongs to 22.4.
5. Create TASK_22_WORKING_STATUS.md with the base, intended allowlist and exact next step. Update the Phase 3 plan with all 23 subtasks and seven checkpoints.

Forbidden scope
No implementation of query calculations, Worker protocol changes, renderer, new commands, route search or Phase 2 repair. No speculative generic framework or authoritative state field.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Check discriminated contract exhaustiveness and meaningful schema limits only where runtime schemas are introduced. Reuse descriptor-safe/Unicode validation policy from the repaired baseline; do not invent another string sanitizer.
2. Run current save schema, Worker protocol and presentation foundation tests as compatibility smoke. Verify that the production app still builds without using the new contracts.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: saveSchema, workerProtocol, projection, compatibility-vector selection.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
No new benchmark is required for declaration/documentation-only changes. Confirm no production tick registration changed.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Adopt the contract; create entry evidence and the ownership ADR; reconcile only affected TDD/phase/status/README scope. Do not claim later tasks completed.
Update docs/status/TASK_22_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 22.2: Implement owned Build context and generation lifecycle

```text
Implement OVERCLOCK Phase 3 Task 22.2: Implement owned Build context and generation lifecycle.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_22_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 22 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 4–5.2, 11.4. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
neutral Build context/catalog reader; private per-SimCore generation runtime; construction/replacement/rollback ownership integration.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the context/catalog read with correct inventory/reservation/reuse quantities, content labels/prices, Research feature flags and source metadata. Keep host settings/epoch out of core state and outputs until the host composes them later.
2. Implement the private per-core read-generation tracker in 5.2. Detect draft lifecycle and revision, inventory/cash/credit/relevant totals, unlocks, Blueprint records, identity counters and Benchmark lock. Cancel/re-enter revision 0 must invalidate older intent; temperature-only changes must not invalidate geometry.
3. Expose a narrow immutable Build read method without getStateForSave, callbacks into authority, canonical whole-state comparisons or browser APIs. Wire new/rejected/accepted replacement and fatal rollback so candidate evidence cannot leak into the retained runtime.
4. Keep preview query variants typed but unavailable until 22.3 or their named later subtask. Do not extend the existing required wire-published models or transport in this step.
5. Create focused context/generation tests and an initial bounded read diagnostic. No renderer or visible controls yet.

Forbidden scope
No Worker protocol change, geometry preview implementation, command behavior change, public state access, persistent generation/counter, read-triggered authority mutation or unsupported future UI.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test exact current quantities including same-definition hardware removed from the draft, locked versus available entries, stable ordering and nullable/unavailable information.
2. Test generation changes across every declared dependency, no-op reads, temperature-only ticks and Cancel/re-enter with the same numeric draft revision. Test two cores, retained reference mutation, rejected replacement, accepted replacement and fatal rollback.
3. Prove repeated context reads preserve state hash, queue position, RNG and all authoritative identities. Test overflow/invalid input on the private read boundary without weakening source validation.
4. Run current Design/inventory/Blueprint core construction and replacement regressions. Keep existing published vectors unchanged.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: SimCore construction/replacement/rollback, Design/inventory reservation, projection ownership, Campaign boundary and Blueprint state.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Create the context cohort with 100 warm-up and 500 measured reads; report cold allocation separately. Target-host p95 <2 ms, development-host evidence non-gating. Do not optimize by removing admission.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Document the context source map, precise generation dependency projection and lifecycle/rollback guarantees in the ownership ADR. Record exact next subtask 22.3 in Task 22 handoff.
Update docs/status/TASK_22_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 22.3: Implement pure Build previews and reuse exact command guards

```text
Implement OVERCLOCK Phase 3 Task 22.3: Implement pure Build previews and reuse exact command guards.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_22_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 22 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 4–6, 9.1, 11.4. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
pure placement/edit/Apply/Blueprint/manual-route preview readers; focused shared domain guards and source mapping.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Use the owned context and generation runtime completed in 22.2. Implement placement, move, rotation, removal-impact, Apply, Blueprint list/detail/materialization and manual-route validation reads on that boundary.
2. Reuse existing geometry, reservation, purchase-credit, Apply and Blueprint helpers. Extract a small shared pure guard only when necessary, retaining command ordering and arithmetic exactly. Distinguish Inventory placement from a Catalog preview needing one purchase, and respect allowed credit.
3. Return deeply owned discriminated results. Strip predicted Blueprint IDs/counters to local ghost handles; consume no real ID, queue entry or RNG. Treat invalid external input as a rejected query and internal authoritative corruption according to the existing fatal contract.
4. Keep automatic route planning, adjacent candidates and diagnostic evidence explicitly unavailable until their later tasks. Do not alter the public current Worker model/schema yet; integrate ports and the wire together in 22.4.
5. Extend source mapping and only the necessary generation dependencies from 22.2. Do not reimplement its ownership/lifecycle tracker.

Forbidden scope
No DOM/React/Pixi/browser/RNG access in core reads; no getStateForSave for previews; no authoritative reservation, query token or generation field; no formula or credit-policy changes.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test four rotations, edges/collision, removed-live reuse, global/cumulative inventory shortage, purchase research gate versus owned parts, valid credit and arithmetic overflow.
2. Prove exact shared Apply output/eligibility for zero diff, route-only diff, net credit, changed inventory and active Benchmark. Prove Blueprint preview/materialization consumes no ID/RNG and cannot affect a later real instantiation.
3. Compare old command rejection precedence/results before and after any shared-guard extraction. Test strict rejected results, frozen output, repeated reads and no state/queue/hash mutation.
4. Retain 22.2 generation/rollback tests and add a dependency regression only when the new reader needs one.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: designModeCommands/designApply/UndoRedo, inventoryEconomy, blueprintMaterialization/Instantiation, simCore ownership, Campaign replacement.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Extend the bounded Build-read diagnostic with 100 warm-up/500 measured placement and Apply-related reads. Report expensive Blueprint planning separately; do not apply the simple <2 ms context gate to full materialization.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Add exact source mapping, generation dependencies, rejected-versus-fatal behavior and shared-guard extraction notes to the ownership ADR and handoff.
Update docs/status/TASK_22_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 22.4: Integrate strict Worker Build queries and guarded GameClient writes

```text
Implement OVERCLOCK Phase 3 Task 22.4: Integrate strict Worker Build queries and guarded GameClient writes.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_22_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 22 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 4–5, 8, 11.1. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Worker protocol/host; GameClient/store/fake client; neutral presentation contracts/projector/source mapping.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Add queryBuild, setPresentationContext and dispatchBuild to real and fake GameClient. Expose the latest owned PlayerSettings as host metadata for Build consumers without adding it to GameState. Keep existing persistence and clock APIs intact.
2. Introduce strict QUERY_BUILD and guarded Build-command transport records and matching correlated reply types. Use existing epoch/request sequencing, byte/node/string bounds, descriptor admission, terminal-result reservations and ACK_RESULT release. Increment the actual current Worker protocol once and update client, Worker and all affected protocol fixtures together. Do not touch simulatorProtocolVersion or Replay/save versions.
3. Check expected Build generation and allowed command kind immediately before existing domain enqueue/process in one serialized operation. Return STALE_BUILD_VIEW as explicitly not queued; accepted/rejected domain commands retain their actual CommandResult. Reads and guard rejections do not consume the gameplay queue.
4. Integrate resolved port geometry and route endpoint fields into the public GridViewModel, strict wire schemas, store validators and projection source map together. Provide only the fields needed for rendering/hit testing. Preserve full/delta ownership and acknowledged baselines.
5. Add the bounded preview coordinator primitive: one pending request and one latest replacement, 10 Hz pointer rate, stale response suppression, lifecycle clearing and no unknown-outcome retry. Do not build the visible construction tools yet.

Forbidden scope
No parser bypass, shallow-frozen caller trust, unbounded request queue, raw GameState transfer, tick scheduler change, fake command success, automatic replay after timeout or graphical implementation.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test exact request/reply schemas, Unicode/accessor/prototype/extra-key rejection, wrong epoch/sequence/command ID, non-safe generation and byte limits.
2. Test stale generation not queued versus genuine domain rejection queued; dispatch accepted before publication; cancellation and context replacement with outstanding reads; result ACKs under saturation; old protocol version rejection; destroy/fatal cleanup.
3. Run production-host and real Chromium Worker tests proving reads are immutable, queues stay bounded, valid Build commands match direct execution and metadata does not enter state/hash/Replay. Retain the Phase 2 F1/F2 repaired regressions.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: workerProtocol, simWorkerHost, workerGameClient, gameClientStore, gridPublication, projection, saveDomainParity, workerPersistence/Replay browser cases.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Rerun performance:projection and performance:worker-host unchanged, plus the new query diagnostic. Record overhead of strict query parsing and coalescing without changing Phase 2 thresholds.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Finalize CP22 API/wire/version and ownership documentation. Record unsupported later query variants honestly. Prepare the reviewed allowlist; leave work uncommitted for CP22.
Update docs/status/TASK_22_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 23.1: Implement the owned Pixi scene and safe lifecycle

```text
Implement OVERCLOCK Phase 3 Task 23.1: Implement the owned Pixi scene and safe lifecycle.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This starts a new checkpoint group. Fetch origin and verify HEAD, origin/main and remote main agree, ahead/behind is 0/0 and the worktree is clean. Confirm CP22 is actually committed, reviewed and pushed, and all earlier Phase 3 prerequisites are recorded. Record HEAD as TASK_23_BASE. Do not reuse the original planning hash as this task's base. If unexplained commits or files exist, stop and report them without resetting or stashing.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 4, 8, 11.2–11.3. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
src/rendering/pixi; CenterWorkspace adapter lifecycle; renderer unit/browser tests.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Replace the empty adapter with a real private Pixi application using the pinned 8.19.0 APIs. Retain generation-safe async initialization, queued initial size/model and idempotent teardown. Propagate init/context failures to a localized React presentation status.
2. Create ordered layers for grid, heat placeholder, routes, modules, ports, selection/ghost and bounded effects. Implement twelve readable module visuals from local primitives/cached textures keyed by content sprite/definition identity. Use the projected rotated footprint/ports without a second gameplay geometry model.
3. Reconcile keyed modules/routes by immutable model changes and revisions. Do not rebuild the scene for every thermal/telemetry tick. Remove and destroy only removed owned entities; distinguish shared cached texture ownership from per-instance resources.
4. Subscribe CenterWorkspace to subsequent client/store publications and update the adapter from the admitted model, including accepted commands while paused. Remove static canvas decorations/labels that falsely claim an empty Phase 0 grid.
5. Keep interaction emission disabled beyond harmless hover until 23.2/23.3. Add deterministic dev/test resource counters without exposing mutation hooks in production.

Forbidden scope
No per-tile React tree, simulator/core import, shared global ticker, remote assets, gameplay interpolation, state mutation, camera interaction or construction tools in this subtask.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test mount, model-before-init, resize-before-init, destroy-before-init, delayed init resolving after remount, repeated destroy, init failure and context loss/recreation.
2. Test full model, unchanged model, thermal-only changes, module add/remove/rotation and route changes without unrelated recreation. Retained GridViewModel objects must not be modified.
3. Run a real Chromium WebGL smoke showing the production Worker facility, labels and correct route layers. Capture and inspect one ordinary and one dense-scene screenshot. Verify no old canvas/ticker/observer survives teardown.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: Phase 0 shell smoke adjusted for real content, workerBootstrap, projectionStore and persistenceControls.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Measure initial reconciliation and steady model updates diagnostically; count changed versus recreated objects. Do not claim target render acceptance until the audited Task 28 fixture exists.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Record adapter/resource ownership, scene layers and failure behavior in the renderer ADR or ownership ADR addendum. Update handoff and truthful implemented status.
Update docs/status/TASK_23_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 23.2: Add camera transforms, hit testing and canvas input primitives

```text
Implement OVERCLOCK Phase 3 Task 23.2: Add camera transforms, hit testing and canvas input primitives.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_23_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 23 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 6.2, 7.2, 8, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
renderer camera/coordinate modules; GridIntent input controller; focused transform and browser tests.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the single screen-CSS/world/grid conversion module with tile size 32, inverse camera transform, DPR separation, pointer-anchored zoom 0.35–3 and deterministic fit/pan bounds.
2. Add middle-drag and toolbar Pan, wheel zoom over canvas only, zoom buttons and Fit. Retain pointer capture across drags and cancel safely on pointercancel, blur, visibility loss, resize-invalidated gesture or adapter destroy. Distinguish click from drag at 4 CSS pixels.
3. Implement module/port/route hit tests from owned geometry. Use 6 CSS-pixel route tolerance and stable ID ties, with visible module/port priority. Empty/out-of-bounds positions do not become valid tiles by clamping.
4. Emit typed intents only. Camera and hover stay local; no command is sent for pan/zoom/move. Add a visible keyboard cursor and input primitives required by later tools without enabling unfinished operations.

Forbidden scope
No simulator coordinates changed by camera, DOM-per-entity input, global browser shortcut interception, state mutations, placement commands or route search.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test transform round trips at DPR 1/1.25/2, nonzero canvas offset, ancestor CSS scaling, negative coordinates, four zoom extremes/centers and resized containers.
2. Test pointer anchor under zoom, small-grid centering, pan clamping, hit ordering, route tie-break, grab offset and exact boundary pixels.
3. Use real browser mouse/wheel/keyboard/pointer-cancel sequences. Verify panel wheel events do not zoom the canvas, camera movement leaves state/RNG/queue unchanged and destroy releases capture/listeners.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: renderer lifecycle, workerBootstrap, presentation ownership and shell browser smoke.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Record input callback and hit-test costs on the dense scene. Prove no Worker preview traffic or per-frame topology rebuild is introduced by camera movement.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Document coordinate units, zoom/pan policy, input priority and test evidence. Keep this a presentation-only change.
Update docs/status/TASK_23_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 23.3: Connect selection, inspector and truthful live summaries

```text
Implement OVERCLOCK Phase 3 Task 23.3: Connect selection, inspector and truthful live summaries.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_23_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 23 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 5.3, 6.2, 9.1, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Build controller; selection overlays; existing inspector/header/OperationsStack consumers.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement single, Shift-toggle and rectangle module selection with stable IDs. Mixed route/module removal is not enabled. Selection is local and sends bounded setPresentationContext updates; rendering can show the outline immediately while the authoritative inspector arrives.
2. Connect the existing inspector projection and Build detail queries. Show module, route and tile data with source tick and Live/Draft distinction. Clear stale entity references after removal, Apply/Cancel, load and recovery. Never fabricate a module Compute breakdown.
3. Replace literal Task progress, static chart, retry/memory zeros and power-headroom placeholder with available real snapshot values or a localized unavailable/empty state. Preserve only a read-only Task summary and compact telemetry in Phase 3.
4. Bind time controls to existing setPaused/setSpeed. Keep persistence and held/recovery controls operational. Handle pending inspector responses and disconnected state without optimistic authoritative changes.
5. Add the visible entity list and basic focus paths used by later keyboard construction.

Forbidden scope
No Task/Research/Overclock/Benchmark action workspaces, forecasts, charts, fake data, simulator mutation through selection or per-frame React telemetry updates.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test rectangle intersection of multi-tile rotated footprints, stable selection order, Shift toggle, empty click, removed selection, rapid selection change and stale replies after epoch replacement.
2. Test null readouts, actual Task progress, selected route endpoints/capacity and live temperature of a moved draft module. New draft-only modules show no invented temperature.
3. Run Chromium selection/inspector/time/persistence scenarios and inspect dense screenshots in both locales. Prove camera/selection/context queries leave authoritative hashes and RNG unchanged.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: projector source mapping, worker/client context handling, persistenceControls, workerLifecycle and renderer tests.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Verify ordinary React telemetry notifications stay at or below 10 Hz and pointer hover does not trigger inspector queries per frame. Rerun relevant projection diagnostic only if its data paths changed.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Prepare CP23 visual evidence, implemented API mapping and known Phase 4 omissions. Leave all Task 23 changes uncommitted for CP23.
Update docs/status/TASK_23_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 24.1: Replace the Build Tray with Inventory and Catalog reads

```text
Implement OVERCLOCK Phase 3 Task 24.1: Replace the Build Tray with Inventory and Catalog reads.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This starts a new checkpoint group. Fetch origin and verify HEAD, origin/main and remote main agree, ahead/behind is 0/0 and the worktree is clean. Confirm CP23 is actually committed, reviewed and pushed, and all earlier Phase 3 prerequisites are recorded. Record HEAD as TASK_24_BASE. Do not reuse the original planning hash as this task's base. If unexplained commits or files exist, stop and report them without resetting or stashing.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 5.1, 6.1, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
BuildTray and focused Build panels/controllers; localization; pure UI selectors.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Replace placeholder cards with the owned Build context. Implement Inventory/Catalog tabs, category/search filters, stable content order, quantity/reservations/reusable hardware, footprint and prices.
2. Show research locks and purchase/placement reasons from the query. Respect current credit eligibility rather than duplicating a cash comparison. Owned Inventory placement does not acquire a new purchase-time Research gate.
3. Selecting a definition prepares a local tool. Enter Design Mode once when needed through the guarded coordinator, then wait for its accepted source before enabling the ghost. No purchase occurs on hover, selection, filter change or entering Design Mode.
4. Display the Catalog rule that accepted purchases remain in Inventory after Cancel/Undo or a failed placement. Add narrow refresh triggers and 2 Hz ordinary context throttling. Read existing settings for locale/display preferences.

Forbidden scope
No purchase or PLACE command implementation yet beyond safe tool activation/ENTER; no new shop screen, stock state in React, autosell/refund or save schema changes.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test locked/unlocked content, zero stock, reusable removed-live modules, shortages caused by independent inventory changes, search/filter localization and deterministic card order.
2. Test that selecting/hovering never spends money, repeat activation does not send repeated ENTER, stale/unknown ENTER prevents activation and active Benchmark still permits drafting.
3. Browser-test tray selection, scrolling and disabled reasons at 1920×1080 and 1280×720. Preserve text-input keyboard behavior.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: Build query/guard tests, inventory/economy semantics, Design enter/cancel and persistence controls.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Verify bounded context queries and no catalog rebuild from temperature-only updates. Measure long localized cards without adding a new benchmark suite.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Record Inventory versus Catalog behavior and source mapping. Update Task 24 handoff; placement remains explicitly incomplete.
Update docs/status/TASK_24_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 24.2: Implement placement ghosts and the purchase/place operation

```text
Implement OVERCLOCK Phase 3 Task 24.2: Implement placement ghosts and the purchase/place operation.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_24_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 24 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 5.3, 6.1, 8, 11.1. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Build operation coordinator; placement overlays; tray drag/drop and keyboard placement.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement click-to-place and tray drag/drop with rotated footprint/port ghosts. Query valid/invalid placement at no more than 10 Hz, one request in flight plus one latest candidate. Keep the cursor responsive with a locally positioned pending ghost; only the Worker marks domain validity.
2. On confirmation freeze definition/position/rotation/source. Execute the exact Inventory or Catalog sequence in 6.1 through dispatchBuild. Requery after a successful purchase, because that changes generation and inventory. Do not turn the pair into a new simulator transaction.
3. Keep pending visuals until the published draft reflects the real accepted placement. Use actual returned source/generation and owned model identity; do not allocate a display ID that looks authoritative. If a purchase succeeds but placement fails, expose the retained item and no refund.
4. Shift retains the tool for one placement per later click/drop; release/cancel submits nothing. Limit to one active Build operation. Adjacent auto-connect remains a disabled capability until Task 25.

Forbidden scope
No source artifact/state mutation, continuous painting, automatic retry on timeout, purchase during preview, refund compensation, generic command batching or fake accepted module.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test all footprint sizes/rotations at boundaries; out-of-bounds/collision; source-only no-op cases; stale query; double-click; pointercancel; pending publication; load during gesture and unknown command result.
2. Test BUY rejection prevents PLACE; BUY accepted then geometry/inventory changed; PLACE rejection retains purchased inventory; Cancel/Undo do not refund; repeated placement stops on shortage; state/RNG roll back on genuine domain failure.
3. Use a production Worker browser case to place from inventory and from catalog, then save/load and verify the real module appears exactly once. Verify no purchase when dragging outside the canvas.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: Build guard, inventoryEconomy, DesignMode placement, worker ordering/results and save continuation.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Measure settled preview round trip and accepted placement-to-publication latency with the stated cohorts where available. Record purchase and placement parts separately; no hidden setup purchase.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Document partial purchase/place outcome, pending/unknown UI states and per-placement Undo semantics. Add evidence screenshots and the focused failure sequence.
Update docs/status/TASK_24_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 24.3: Wire move, rotate, remove and existing Undo/Redo

```text
Implement OVERCLOCK Phase 3 Task 24.3: Wire move, rotate, remove and existing Undo/Redo.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_24_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 24 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 5.3, 6.2, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Build edit controller/overlays; module/route selection controls; Design history UI.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement one-module move with grab offset and Q/E absolute quarter-turn rotation. Show geometry and attached-route removal before confirmation. Use shared domain previews and guarded commands; update no live geometry locally.
2. Implement selected-route disconnect and selected-module deletion as separate modes. For multiple modules, show stable ordered removal and attached-route impact, then dispatch one removal at a time with refreshed generation. Stop on the first failure and display accepted/remaining counts.
3. Implement Undo/Redo buttons and shortcuts from real domain stack availability. A genuine no-op must not wait for a fake revision increment. Do not automatically rerun auto-connect after Undo/Redo.
4. Keep group move/rotation explicitly unavailable. Preserve all existing ID, route cleanup, Blueprint-group and history semantics.

Forbidden scope
No group transaction/history type, secondary UI undo stack, ID rewinding, automatic route repair, mutation of a selected frozen model or retry of an unknown outcome.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test move/rotate no-op; changed footprint collision; attached versus unrelated routes; pending edit cancellation; stable multi-remove ordering and partial rejection; mixed selection safety.
2. Test every supported operation followed by Undo and Redo, including Blueprint group history inherited from Phase 1. Verify exact IDs, original route records, revision count and monotonic counters.
3. Browser-test pointer and keyboard alternatives, modal focus, held keys, input-focused Ctrl+Z and normal text deletion. Save/load a nonempty draft/history and continue editing without lost ownership.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: designModeCommands, Design history/Apply, blueprintInstantiation, manualRouting, save round-trip.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Measure an edit and its publication separately. Confirm no graph rebuild or path search on move/rotate/remove; attached routes are removed by the existing command.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Record partial multi-remove behavior, single-object move/rotation scope and keyboard precedence. Keep future group transforms deferred.
Update docs/status/TASK_24_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 24.4: Complete exact Apply/Cancel review and manual-build acceptance

```text
Implement OVERCLOCK Phase 3 Task 24.4: Complete exact Apply/Cancel review and manual-build acceptance.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_24_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 24 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 6.3, 9.1, 11.1. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Apply/Cancel dialogs; controller reconciliation; Build flow browser integration.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Present the exact existing Apply preview: changed modules, net inventory use, book value, labor, salvage, net payment/credit and maximum startup downtime. Render unknown production/thermal forecasts as unavailable rather than estimating them.
2. Use the exact shared credit/Benchmark/domain guard. Confirm with expectedDraftRevision, acceptedCostUsd and acceptedDowntimeTicks plus the current guarded generation. A stale preview refreshes the dialog and requires explicit reconfirmation.
3. Implement Cancel confirmation for a changed draft and harmless closure for an unchanged draft. Independently purchased Inventory persists. Preserve live temperatures, unrelated branches, current clock and all Phase 1 Apply reset semantics.
4. Complete one production-browser path from Inventory/Catalog selection through edits, Undo/Redo, Apply, an explicit verified manual save through the existing Phase 2 API, reload and continued edit. Preserve the existing dirty tracking and autosave triggers; do not add an Apply-triggered autosave policy. Keep cancel-after-purchase behavior explicit and tested.

Forbidden scope
No new Apply transaction, recomputed UI money/downtime formula, forecast simulator, change to autosave triggers, automatic Apply on dialog close or Benchmark bypass.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test zero-change Apply, route-only diff, net credit, allowed negative cash, stale cost/downtime/revision, credit rejection, inventory changed while dialog open and active Benchmark lock.
2. Test Cancel leaves live layout/temperatures unchanged, retains accepted purchases and does not rewind allocated IDs. Test accepted Apply before publication, recovery during dialog and dirty draft save/load.
3. Inspect dialog at 1280×720 in both locales with 30% longer text. Run the complete manual construction browser scenario and exact state/queue/RNG comparison against direct commands.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: all affected Design/economy/Blueprint domains, workerSaveTransitions, persistenceControls and direct/save/Replay parity.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Rerun performance:design and performance:apply unchanged if shared guards changed. Preserve the off-tick cost reporting; measure real UI publication latency without subtracting dialog command work.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Finalize Task 24 permanent evidence and remove obsolete UI placeholder/Apply-deferred wording in current sections only. Prepare CP24 allowlist, leave uncommitted.
Update docs/status/TASK_24_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 25.1: Implement bounded deterministic route planning

```text
Implement OVERCLOCK Phase 3 Task 25.1: Implement bounded deterministic route planning.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This starts a new checkpoint group. Fetch origin and verify HEAD, origin/main and remote main agree, ahead/behind is 0/0 and the worktree is clean. Confirm CP24 is actually committed, reviewed and pushed, and all earlier Phase 3 prerequisites are recorded. Record HEAD as TASK_25_BASE. Do not reuse the original planning hash as this task's base. If unexplained commits or files exist, stop and report them without resetting or stashing.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 7.1, 7.3–7.4, 11.3–11.4. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
pure grid route-planning domain; planning runtime; Worker read-query implementation; routing ADR.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the exact A* search policy in 7.3, including canonical endpoint order, exterior-tile search, adjacency/shared-exterior special cases, inclusive path assembly and final public manual validation.
2. Use integer base/shared-edge/crossing costs, North/East/South/West expansion, the exact priority tuple and first-parent equal-cost policy. Do not use dynamic Power utilization, wall-clock cutoff or random search order. Keep congestion costs presentation planning only.
3. Implement a bounded adjacent-candidate read using existing physical adjacency/compatibility and stable canonical pairs. Do not create an adjacent-port graph singleton or a periodic facility scan.
4. Bind automatic planning to the existing auto-route feature; adjacent-only assistance remains basic as contracted. Invalid/locked/stale/unreachable queries consume no IDs, queue entries or RNG.
5. Own any indexes/scratch per core planning runtime and exact Build generation. Replace unavailable query variants with implemented results, without expanding the command schema.

Forbidden scope
No route-capacity or congestion gameplay, authoritative planner state, live rerouting, tick-time search, caller-trusted occupancy, nearest-provider heuristic replacement or hidden new Research feature.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test direct adjacent ports; shared exterior tile; all rotations and multi-tile footprints; obstacles/corners/no-wrap; unreachable endpoint; same module/airflow/duplicate pair; reverse submitted endpoints.
2. Test exact path under equal costs and shuffled object insertion; sharing/crossing penalties; positive safe cost bounds; stale runtime cache; two cores; replacement; input/output mutation and scratch reuse.
3. Run exactly 100 repetitions of a nontrivial path matrix with identical canonical paths and unchanged state/RNG. Feed each accepted path through the unchanged manual CONNECT validator and production command.
4. Freeze tests proving manual crossings/capacity remain unchanged and Task 13.7 endpoint/path ordering above ID carry remains valid.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: grid geometry/ports, manualRouting, Design history, blueprintCapture/Materialization and route ID ordering.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Add performance:build-routing, 100 warm-up/500 measured pure automatic and adjacent samples. Report cold index, blocked/no-route and dense crossings separately. Targets <5 ms/<2 ms on target host.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Create the next-unused routing ADR and update the recorded ADR map. Supersede only old deferred A* planning text. Record the exact cost/tie-break/feature policy and no gameplay-capacity change.
Update docs/status/TASK_25_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 25.2: Build manual and research-gated automatic route tools

```text
Implement OVERCLOCK Phase 3 Task 25.2: Build manual and research-gated automatic route tools.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_25_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 25 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 5.3, 7.1–7.3, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
routing input controller; projected ports/routes; route inspector and toolbar.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement visible Power/Data tools, source selection, compatible port affordances and manual orthogonal tracing. Follow the contracted horizontal-then-vertical gap fill, invalid-state explanation, keyboard arrows/Backspace and final endpoint confirmation.
2. Show ready versus pending/invalid path separately. A route enters the scene as authoritative only after CONNECT_PORTS acceptance/publication. Escape/pointercancel emits no command. Manual tracing remains available without auto-route research.
3. Add automatic route preview for an explicit endpoint pair when unlocked. Call Worker planning through the coalesced query bridge, then submit the explicit returned path using guarded CONNECT_PORTS. Query success is not permission to bypass command validation.
4. Implement selection/hit tolerance, endpoint/capacity/length inspector and explicit disconnect confirmation. Unknown data utilization remains unavailable and cannot drive a fake flow animation.

Forbidden scope
No renderer-side pathfinding, adjacent graph construction per pointer move, auto-routing before unlock, airflow connections, dropped endpoint cells or optimistic route insertion.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Browser-test manual route with bends, gap fill obstruction, reverse endpoint entry, adjacent route, repeated tile, no route, locked automatic mode, rapid target switching and camera zoom while tracing.
2. Test stale preview after module rotation, accepted route before publication, duplicate connect rejection, disconnect plus Undo/Redo, old epoch reply and unknown command outcome.
3. Compare explicit browser-emitted commands with direct SimCore execution using fixed test UUIDs. Validate route geometry and stored capacity from the production result, not screenshots alone.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: manualRouting, route planner, worker Build guard/correlation, Design history and projection route fields.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Measure real Worker preview latency including throttle and query traffic. Preserve 10 Hz/one-pending bounds under rapid mouse movement. No global fps claim from unit timings.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Document route tool controls, research lock, endpoint representation, pending/rejection UX and truthful utilization labels. Add screenshots for manual/automatic/invalid paths.
Update docs/status/TASK_25_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 25.3: Integrate adjacent auto-connect and certify routing behavior

```text
Implement OVERCLOCK Phase 3 Task 25.3: Integrate adjacent auto-connect and certify routing behavior.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_25_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 25 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 6.2, 7.4, 11. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Build operation coordinator; adjacent toggle/results; route integration/determinism/browser diagnostics.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the session-local default-off Adjacent Auto-connect toggle. Trigger only after accepted single-module place/move/rotation is reconciled. Query sorted physically adjacent pairs involving that module, then submit one guarded CONNECT per pair.
2. Revalidate each pair against the latest generation, skip already connected pairs, stop on failure/unknown outcome and show accepted counts. Do not connect on load, tick, render, selection, Apply, Undo/Redo or Blueprint instantiation.
3. Keep separate Undo records for placement and every connection; show this behavior accurately. Do not offer a false atomic group undo. Test cancellation while a sequence is awaiting a result without losing knowledge of accepted work.
4. Complete manual/automatic/adjacent save and Replay parity, including blocked paths and ID sequence carry. Finalize routing diagnostic and fixture audit.

Forbidden scope
No global autowiring, cascading discovery of distant ports, automatic route restoration after Undo, batch SimCommand, changed route semantics or benchmark fixture simplification.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Prove default-off sends no CONNECT; enabled adjacent-only behavior is deterministic; airflow/incompatible/duplicate pairs are excluded; partial failure preserves prior commands and stops unsent work.
2. Prove Undo/Redo/load/recovery never fire new auto-connect commands; same edited module sequence produces identical ordered explicit paths over exactly 100 runs and unchanged RNG.
3. Run production Chromium construction with rotated endpoints, save/load and replayed direct parity. Keep the original public-validator stale-occupancy regression and Blueprint route-ordering regressions unchanged.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: routing/Design/Blueprint suites, worker protocol/queue, saveDomainParity and browser Build tools.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Run performance:build-routing and unchanged performance:routing, performance:grid and performance:compute. Report target classification and retain every sample; do not rebuild adjacency in production.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Finalize routing ADR/diagnostic and CP25 allowlist. Record partial sequence semantics and exact unlock distinction. Leave Task 25 uncommitted.
Update docs/status/TASK_25_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 26.1: Expose Blueprint capture, rename and instantiation safely

```text
Implement OVERCLOCK Phase 3 Task 26.1: Expose Blueprint capture, rename and instantiation safely.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This starts a new checkpoint group. Fetch origin and verify HEAD, origin/main and remote main agree, ahead/behind is 0/0 and the worktree is clean. Confirm CP25 is actually committed, reviewed and pushed, and all earlier Phase 3 prerequisites are recorded. Record HEAD as TASK_26_BASE. Do not reuse the original planning hash as this task's base. If unexplained commits or files exist, stop and report them without resetting or stashing.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 5.1, 9.3, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Blueprint tray/picker/forms; materialization overlays; existing Build coordinator.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the paged stable Blueprint list with current/historical compatibility, required parts, bounds and saved summaries. Reuse existing feature checks and allow rename of structurally valid incompatible historical records.
2. Save only eligible selected live modules. While in Design Mode, disable Save with Apply/Cancel guidance; never silently capture draft geometry. Name validation/localization follows the existing command schema.
3. Instantiate through a rotated ghost based on the sanitized Worker materialization preview. Show module and route extents, edge/collision/shortage reasons, then dispatch one INSTANTIATE_BLUEPRINT. No auto-buy or extra auto-connect follows it.
4. Wire Ctrl+C/Ctrl+V as the contracted in-app Blueprint actions only when the canvas owns focus. Retain native clipboard behavior in text fields. Keep one atomic Blueprint Undo operation and existing fresh-ID ownership.

Forbidden scope
No Blueprint file import/export, nesting, source editing/propagation, thumbnail system, group transform command, source record mutation or UI-generated authoritative IDs.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test unlock, live versus draft capture, compatible versus historical list/rename, name rejection, pagination stability, all four rotations, bounds including route points, cumulative inventory shortage and active Benchmark drafting.
2. Test one-step Undo/Redo of the entire instantiated group, failed Redo inventory precondition atomicity, Cancel non-reuse and module/route sequences beyond 99,999,999.
3. Browser-test selection→Save→rename→enter draft→preview→instantiate→Undo/Redo→Apply→save/load. Preserve source Blueprint and RNG. Verify delayed preview IDs are never used for commands.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: all Blueprint domain/history/determinism tests, Build queries and guarded writes, save round-trip and routing.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Measure list opening/paging with 128 records and materialization preview separately. Rerun performance:blueprints unchanged if any shared path changed.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Document live-only capture, historical compatibility, in-app clipboard shortcuts, inventory/no-auto-buy rules and evidence. Keep export/import deferred.
Update docs/status/TASK_26_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 26.2: Render the authoritative heatmap and temperature overlays

```text
Implement OVERCLOCK Phase 3 Task 26.2: Render the authoritative heatmap and temperature overlays.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_26_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 26 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 8, 9.1–9.2, 11.1. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
renderer heat layer/legend; heatmap toolbar; selected tile/module readouts.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the research-gated heatmap toggle and five fixed presentation legend stops. Use the store's complete accumulated thermal field, not the most recent delta alone. A hidden heatmap still retains the valid baseline needed when enabled.
2. Reuse a texture/buffer or bounded batched visuals; update changed cells and upload only on dirty publication. No per-frame thermal calculation or interpolation. Keep exact numeric readouts, existing warning facts and color-independent labels.
3. Display live versus draft physics correctly, including moved draft modules and null draft-only temperature. An explicit exact read request is bounded to 10 Hz and labelled with observed tick; dirtyEpsilon/publication lag is documented.
4. Handle full resync, dimension/mode change, client replacement, disabled display, changed reduced settings and context loss without retaining old heat from another session.

Forbidden scope
No alternate thermal simulation, UI threshold inferred as shutdown rule, fake zero temperature, per-tile React elements, full GPU resource rebuild every tick or visibility-based data loss.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test full row-major field, single delta, accumulated sub-epsilon changes, toggle-off/on, heatmap unlock, full resync, epoch replacement and missing/stale values rejection.
2. Test legend values/clipping independent from actual warning thresholds, rotated module live temperature and unknown draft temperature. Mutation attempts must not change store or authoritative state.
3. Capture actual Chromium screenshots with heatmap on/off, selection and reduced effects. Verify full field values against published source data, not pixel color alone.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: thermal state/determinism, gridPublication/store ownership, worker publication and renderer lifecycle.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Measure dirty update/upload and render CPU with the dense heat field. Verify no temperature work per render frame and no extra simulator tick cost. Keep all heatmap cells in the stress fixture.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Record palette as presentation-only, source/epsilon semantics and GPU resource ownership. Update renderer evidence and TDD heatmap status.
Update docs/status/TASK_26_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 26.3: Add evidence-based Diagnostic Pulse and reduced effects

```text
Implement OVERCLOCK Phase 3 Task 26.3: Add evidence-based Diagnostic Pulse and reduced effects.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_26_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 26 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 4, 8, 9.4, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
pure diagnostic query/source mapping; pulse overlay/controller; existing display settings integration.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the previously unavailable diagnostic query from existing Power/Compute/Overclock and warning evidence. Return stable entity references, observed tick, reason keys and known/unknown activity. No future estimate or invented per-module breakdown.
2. Bind D/button to a presentation-only two-second pulse, bounded to 128 animated highlights with deterministic ordering. Restart replaces the old effect. Other relevant entities remain static/listed. Do not dispatch the reserved simulator pulse command.
3. Honor reducedMotion with static outlines and reducedEffects by reducing cosmetic work only. Read and persist those existing settings via Phase 2 APIs; do not add save fields or change settings silently.
4. Ensure pulse/context loss/visibility/remount stops all effect callbacks, keeps alerts/labels readable, and does not replay historical effects after Worker reconnection.

Forbidden scope
No new semantic event/alert system, audio, resource cost, cooldown gameplay, domain command handler, animation RNG, fake data-route throughput or Phase 4 Explain Loss rewrite.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Test selection and no-selection evidence, known Power route versus unknown data route, draft-only route, stable severity ties and capped highlights.
2. Prove pulse/settings/camera do not change GameState/queue/RNG/Replay; stale query after recovery cannot start an effect. Test rapid repeated pulse, destroy during pulse and visibility/reducedMotion transitions.
3. Browser-inspect normal and static reduced variants in both locales. Run settings save/import/recovery tests proving existing schema and metadata isolation remain unchanged.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: projector/Compute/Power historical semantics, Worker Build read safety, settings persistence, renderer and Blueprint UI.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Record maximum simultaneous highlights and dense pulse render CPU. No per-frame allocations proportional to route history or Blueprint count. Prepare full Task 26 evidence for CP26.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Finalize renderer/diagnostic ADR, source map and explicit presentation-only pulse decision. Prepare CP26 allowlist and leave uncommitted.
Update docs/status/TASK_26_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 27.1: Finish responsive layout and remove misleading shell placeholders

```text
Implement OVERCLOCK Phase 3 Task 27.1: Finish responsive layout and remove misleading shell placeholders.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This starts a new checkpoint group. Fetch origin and verify HEAD, origin/main and remote main agree, ahead/behind is 0/0 and the worktree is clean. Confirm CP26 is actually committed, reviewed and pushed, and all earlier Phase 3 prerequisites are recorded. Record HEAD as TASK_27_BASE. Do not reuse the original planning hash as this task's base. If unexplained commits or files exist, stop and report them without resetting or stashing.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 2, 9.1, 10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
AppShell/Header/rail/BuildTray/OperationsStack; centralized CSS tokens; persistence/control placement.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement all four viewport layouts and centralized tokens from section 10. Preserve minimum canvas size, visible primary resources/time controls, accessible construction tools and one expanded secondary section at small sizes.
2. Integrate inspector, Build tabs, toolbars and existing persistence/recovery UI without covering the target tile or Apply actions. Long dialogs scroll internally and preserve their primary actions. Smaller-than-minimum windows show a notice without resetting the session.
3. Remove every misleading static progress, resource, chart, phase/read-only label and placeholder navigation affordance in the shipped Build surface. Use actual values or explicit unavailable states; keep Phase 4 workspaces unimplemented.
4. Keep the existing industrial palette and content-driven module labels. No external font/asset request or CSS mutation of canvas coordinates.

Forbidden scope
No Phase 4 screen implementation, arbitrary new asset package, detached-window system, mobile mode, formula in JSX or source-state reset on resize.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Browser-test 1920×1080, 1600×900, 1366×768 and 1280×720 for overflow, minimum canvas, reachable controls, dialog scroll/focus and persistent UI state across resize.
2. Check both locales plus 30% expanded labels, zero/large/negative numeric values, many Blueprint names and recovery banners. Test pointer coordinates before/after each layout change.
3. Inspect screenshots for occlusion, clipping, unreadable colors, fake values and canvas dominance. Do not treat passing bounding-box assertions as the whole visual review.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: Build workflows, camera coordinate tests, persistenceControls, workerBootstrap and recovered session display.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Check resize bursts coalesce and do not reconstruct core/Worker or all scene resources. CSS-only work does not justify repeated simulator performance suites.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Record final token choices, viewport evidence and remaining Phase 4 placeholders that are explicitly unavailable. Update visual review matrix.
Update docs/status/TASK_27_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 27.2: Complete keyboard, accessibility and localization behavior

```text
Implement OVERCLOCK Phase 3 Task 27.2: Complete keyboard, accessibility and localization behavior.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_27_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 27 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 6–10. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
shortcut/focus controller; DOM alternatives; localized error/reason rendering; dialog semantics.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Implement the complete Phase 3 keyboard table with scoped precedence. Ignore editable elements, composition, irrelevant modifiers and blocked modals; prevent destructive repeat events. Keep O/R/Info Lens unadvertised until their real Phase 4 implementation.
2. Complete keyboard cursor, coordinate/rotation fields, entity list, visible alternatives to drag/hover and route tracing. Make canvas and buttons appropriately labelled, focus visible and dialogs focus-trapping/restoring.
3. Localize all newly reachable strings in RO/EN, including current domain/query reasons, purchase retention, partial sequence outcomes and unavailable telemetry. Use proper locale formatting without using localized strings for IDs or ordering.
4. Respect reduced motion and color-independent state cues. Preserve normal browser/OS clipboard in text fields and clarify the canvas-specific Blueprint shortcuts.

Forbidden scope
No global keyboard hijacking, role=application blanket, inaccessible color-only errors, unrelated translation rewrites, localization in simulator formulas or new accessibility dependency without approval.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Run a keyboard-only inventory placement, rotation/move, manual connection, Undo/Redo, Apply and Blueprint flow from actual production UI.
2. Test IME composition, held Delete, input Ctrl+Z/C/V, modal Escape priority, focus after rejection/recovery and screen-reader labels/live announcements without 10 Hz verbosity.
3. Run both locale content validation and browser text-expansion checks. Verify unlock and disabled reasons remain available without hover and all essential buttons are reachable at 1280×720.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: all Build interaction browser cases, command coordinator no-double-submit tests, settings/language import and persistence controls.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Check accessibility announcements and React subscriptions are change-driven, not frame-driven. No need for a new pure-domain diagnostic.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Record shortcut priority, keyboard test matrix, localization review and intentional Phase 4 omissions. Keep the test rationale focused on behavior.
Update docs/status/TASK_27_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 27.3: Run and review the full Build visual/browser acceptance matrix

```text
Implement OVERCLOCK Phase 3 Task 27.3: Run and review the full Build visual/browser acceptance matrix.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_27_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 27 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 10–11.2. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
Playwright Build scenarios, stable visual baselines and PHASE_3_VISUAL_REVIEW.md.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Create a reproducible screenshot matrix using the real application and production Worker, admitted/public-command fixtures, deterministic display settings and recorded browser/platform/DPR. Include every required scene from section 11.2.
2. Capture all four sizes, both locales, reduced-effects variants and representative expanded text. Inspect images directly and correct concrete visual defects within Task 27 scope. Keep a small reviewed golden set for critical layouts; preserve other screenshots as test evidence with reproducible scenario metadata.
3. Run pointer/keyboard Build flows and Phase 2 persistence controls together. Test renderer init/context failure, resize during drag, publication resync and recovery-held UI.
4. Do not expose test fixtures, state replacement controls, debug commands or manual Worker timer entry points in the production bundle. Keep platform-specific screenshot baselines explicit; do not claim cross-platform pixel identity.

Forbidden scope
No blanket canvas masks, snapshot update to conceal a defect, assertion/timeout weakening, production test hooks, Phase 4 expansion or fake visual evidence when Chromium is unavailable.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Run the complete relevant Build visual/interaction suite plus affected Phase 2 browser tests. Fail on console errors, uncaught rejections, inaccessible primary actions and missing localization.
2. Verify screenshots include invalid/pending states, credit Apply, real heat, Blueprint shortage, dense geometry and recovery. Check both geometric DOM constraints and rendered image appearance.
3. Run a 20-cycle mount/destroy smoke and verify owned resource counters return to zero. Reserve the long integrated soak for Task 28.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: Phase 2 Chromium controls, Worker lifecycle/publication, Build direct-command parity and renderer lifecycle.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Record visual-test timing separately from performance. Disabled animation for a screenshot is not evidence for a 60 FPS or pulse budget.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Finalize visual review with exact scenarios, screenshots, observations and fixes; link accepted baselines and platform. Prepare CP27 allowlist; leave uncommitted.
Update docs/status/TASK_27_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 28.1: Audit the integrated dense fixture and measure rendering/input budgets

```text
Implement OVERCLOCK Phase 3 Task 28.1: Audit the integrated dense fixture and measure rendering/input budgets.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This starts a new checkpoint group. Fetch origin and verify HEAD, origin/main and remote main agree, ahead/behind is 0/0 and the worktree is clean. Confirm CP27 is actually committed, reviewed and pushed, and all earlier Phase 3 prerequisites are recorded. Record HEAD as TASK_28_BASE. Do not reuse the original planning hash as this task's base. If unexplained commits or files exist, stop and report them without resetting or stashing.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 11.3–11.4. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
tests/performance Build/routing/render browser harnesses; necessary measured presentation optimizations.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Build the final Phase 3 dense fixture by extending the accepted Phase 2 N fixture. Assert occupancy ≥288, mixed footprints/rotations, actual routes, nonuniform temperatures, active workloads, Boost and the Benchmark variant. Keep the 128-Blueprint scenario separate and honest.
2. Implement permanent Build-read/route and actual-browser render/input diagnostics with the exact cohorts/budgets in section 11.3. Measure direct tick and combined render/Worker behavior separately; include cold resource creation, full resync, dirty updates and pointer coalescing counts.
3. Profile before optimizing. Allowed changes are keyed reconciliation, cached visual resources, bounded buffers, measured allocation reduction and scoped subscriptions. Preserve validators, formulas, fixtures, samples and user-visible information.
4. Classify CPU/GPU/OS/RAM/browser/Node/DPR/build mode precisely. Store raw median/p95/max and samples. Do not run heavy suites concurrently with target timing or claim a GPU gate on software rendering.

Forbidden scope
No benchmark weakening, dropping scene work, time-based domain search, hidden purchase/setup work, changed Phase 1/2 target, forced GC/CPU-affinity trick or new owner exception.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Add one executable fixture audit for actual occupancy/workload/thermal/routing properties and one diagnostics-instrumentation check where needed. Do not mirror the renderer implementation with many unit tests.
2. Run targeted renderer/store/query ownership regressions after any optimization. Compare before/after the same fixture and retain all failed measurements.
3. Confirm rendering captures CPU submission separately from frame cadence and cannot report a missing measurement as zero. Verify idle resource reuse and bounded input queues.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: projection/gridPublication/store, Build read/guard, route planner, renderer lifecycle and existing save/Worker diagnostic fixtures.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Run every new Phase 3 budget with its fixed cohort. Rerun affected existing performance:projection, performance:worker-host and simulator diagnostics. Mark unavailable target hardware as non-gating/blocked, never PASS.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Create/finalize PHASE_3_BUILD_WORKSPACE, PHASE_3_ROUTING and PHASE_3_RENDERING diagnostics with precise methodology and limits. Update handoff with unresolved gates.
Update docs/status/TASK_28_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 28.2: Prove integrated recovery, compatibility and lifecycle durability

```text
Implement OVERCLOCK Phase 3 Task 28.2: Prove integrated recovery, compatibility and lifecycle durability.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_28_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 28 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 1.1, 5.3, 11.1–11.4. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
cross-domain Build/Worker/persistence/Replay tests; real-browser soak and recovery evidence.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Exercise Build gestures and committed operations across pause/speed, autosave, manual save, import rejection, load, Worker fatal/restart, full publication resync and renderer remount/context failure.
2. Re-run repaired Phase 2 F1/F2 cases through the now-visible UI path: hostile save cannot become a broken publication, and corruption fallback followed by Continue and repeated autosaves yields three valid complete rotations without destroying required damaged evidence.
3. Record a deterministic Build command scenario, save mid-sequence with a nonempty draft/history, resume the suffix and compare direct/Worker/Replay final state, queue and RNG. Repeat new deterministic route/intent fixtures exactly 100 times; preserve all published baseline vectors.
4. Run 20 complete renderer mount/destroy cycles and one 60-minute combined browser soak using production Worker/persistence. Include periodic editing/cancel/apply, heatmap/pulse, save/load and recovery. Keep all operations legal and results verified; do not overwrite user slots or a normal browser profile.

Forbidden scope
No production debug grants/hooks, state normalization to hide malformed input, corruption deletion outside the repaired policy, unknown-command retry, filtered memory samples or reduced soak duration.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Assert no duplicate commands from remount, no accepted preview from old epoch, no UI mutation of snapshot/state, no lost delta baseline, preserved autosave/import transactionality and correct held-state Continue.
2. Prove original save/import bytes remain unchanged; metadata time/settings/camera do not enter deterministic hashes; failed Build/domain operations retain rollback semantics.
3. Record resource counters, live Worker/timer/listener/request counts, process/heap availability and bounded growth. If native browser metrics are unavailable, report that limitation rather than inventing values.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: all Phase 2 migration/corruption/recovery/parity/determinism suites; Campaign, Blueprint and Replay fatal/resume; complete Build browser paths.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Use the final Task 28 fixture/cohorts; do not perform target microbenchmarks concurrently with the soak. Preserve exact 60-minute evidence and hardware classification.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Document compatibility, recovery sequences, soak evidence and resource ownership. Record any defect and narrow fix within Phase 3; a Phase 2 contract change requires explicit separate disposition.
Update docs/status/TASK_28_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

### Prompt 28.3: Finish complete verification and prepare the Phase 3 closure candidate

```text
Implement OVERCLOCK Phase 3 Task 28.3: Finish complete verification and prepare the Phase 3 closure candidate.
Recommended execution model: GPT Luna, reasoning xhigh. This is one bounded implementation subtask. Stop before its independent Sol checkpoint. Do not implement a later subtask.

Preflight and accumulated-diff ownership
This continues the same uncommitted task. Inspect git status, staged files and the complete accumulated diff from TASK_28_BASE recorded in the handoff. HEAD must still equal that base. Confirm earlier Task 28 subtasks passed their recorded gates. Preserve every explained earlier change. Do not require a clean worktree or fetch/re-audit the entire project again. Stop only for unexplained ownership, changed base, failed prerequisite or a material contract conflict.
Read every applicable AGENTS.md; docs/status/PROJECT_STATUS.md; docs/status/PHASE_3_ENTRY.md when present; normative sections 1–13 of OVERCLOCK_Phase_3_Contract_and_Prompts.md once per new task/chat and the current prompt's cited sections thereafter; the relevant mapped Phase 3 ADRs; and the relevant current source/tests. Read the task handoff when continuing. For 22.1 use the attached planning artifact and the accepted Phase 2 ADRs before adopting it. Do not rely on an earlier conversational summary.
Contract focus: sections 1–13. The complete contract remains binding. Existing frozen Phase 1/2 behavior takes precedence over an obsolete sketch; this contract explicitly settles its listed Phase 3 refinements.

Scope and expected touch area
final correctness/performance/browser evidence; permanent docs and removal of temporary Task 28 handoff.
Paths are a focused allowlist proposal, not permission to edit unrelated files. Follow actual existing names. Add only files necessary for this subtask; explain any dependency expansion.
1. Review the entire Phase 3 implementation against this contract and the repaired Phase 2 baseline. Verify all 13 original Build Workspace scope items, every explicit scope refinement and all 22 decisions.
2. Run the full required matrix: pnpm test twice in separate clean processes, pnpm validate, full Chromium suite, exact determinism, all 20 unchanged Phase 1/2 permanent Node diagnostics, new Build/routing/render diagnostics, baseline plus duplicate milestone, compatibility vectors and production bundle/import scans.
3. Reconcile permanent TDD/Phase 3/status/README/ADRs/diagnostics using checkpoint-neutral language. Move useful handoff information into permanent records and remove the temporary Task 28 file. Do not erase a failed timing row or an accepted historical exception.
4. Check source/asset/license/localization evidence, no production debug/devtools path, unchanged balancing/module numeric/Word/lockfile content, and no authoritative save/Replay schema change. Prepare an exact CP28 allowlist.
5. Stop before the independent CP28 checkpoint, even when every gate passes. Do not start Phase 4 or mark independent Phase 3 closure complete.

Forbidden scope
No commit/push/staging, empty checkpoint, last-minute feature expansion, Phase 4 plan, weakening any test or claiming a blocked browser/target-host gate passed.
Also exclude all Phase 4/5 work, new balance/content mechanics, new authoritative state/save/Replay formats, new dependencies and unrelated refactors. Do not fix the earlier Phase 2 findings as part of this task.

Mandatory invariants and precedence
1. SimCore is the only gameplay authority. UI/Pixi receive owned projections; all mutations use existing validated commands through the approved client/host path.
2. Retain 100 ms ticks, clock-command semantics, queue/receipt correlation, rollback, monotonic IDs, RNG behavior and every accepted historical-result contract.
3. No untrusted accessor/prototype/Unicode bypass, stale epoch/generation promotion, scratch leakage, unknown-outcome retry, optimistic authoritative entity or duplicate formula in UI.
4. Read/preview validity is advisory until the original command handler accepts current inputs. Distinguish not-queued transport rejection, domain rejection, accepted result awaiting publication and unknown outcome.
5. Resolve routine filenames/ADR numbering from evidence. Apply the explicit decision register without asking for the same approval again. If a genuinely new product/compatibility conflict remains, report it before changing that behavior.

Required tests
1. Run and report all complete suites with actual counts; do not hard-code old test totals. Recheck the two original Phase 2 repairs and new stale Build/ownership/partial-operation cases.
2. Verify canonical milestone completion, years, RNG and all four hashes against PHASE3_BASE. Diagnose any difference instead of updating expectations.
3. Confirm current reviewed screenshots match the final candidate, with no new presentation changes after the evidence run. Reuse an unchanged exact-candidate soak, otherwise rerun the affected long lifecycle gate.

Regression gates
Run the smallest focused unit/integration selection covering this change and these adjacent areas: complete repository unit/determinism/browser/validation, all Phase 1/2 permanent diagnostics and new Phase 3 suites.
Run corepack pnpm typecheck, corepack pnpm lint, corepack pnpm content:validate, Prettier check on touched files, corepack pnpm build, and git diff --check. Run relevant Playwright Chromium cases for the UI/Worker/browser behavior changed here. Actual browser absence is BLOCKED, not a mocked pass. Do not reduce repetitions, alter frozen vectors, increase timeouts or update visual baselines merely to make a failing check pass.
Do not repeat every unchanged performance suite or full campaign in this bounded subtask. Add meaningful tests for behavior and boundaries, not line-by-line implementation mirrors.

Performance
Every required budget has raw exact-candidate evidence or an explicitly accepted owner exception. Report normal/dense/reduced/cold/transition paths separately; no claim of universal target pass from development hardware.
Use unchanged fixtures/cohorts for existing diagnostics. Only the documented target host can provide gating evidence; report every miss and classify other hosts honestly.

Documentation and handoff
Finalize every permanent Phase 3 document, allowlist, compatibility/performance/visual/recovery evidence and remaining deferred scope. Report readiness for CP28 only.
Update docs/status/TASK_28_WORKING_STATUS.md with base, accumulated files, completed contract points, exact test commands/results, remaining gates and the next subtask/checkpoint. Keep permanent wording checkpoint-neutral. If this is the final documentation subtask, merge useful handoff information before removal as the contract requires.

Final report
Report: implemented scope; changed files; invariants/source mapping; tests and actual counts; browser/visual evidence; performance and host classification; documentation; risks/blocked gates; exact next step. State that no files were staged, committed or pushed. Do not claim a checkpoint or phase closure passed independently.

Leave all work uncommitted and unstaged. Preserve existing reviewed task changes. If interrupted, finish a coherent small boundary and update the handoff. Do not query /status or invent usage percentages.
```

## 16. Independent Sol checkpoint prompts

Each block is a separate approved checkpoint boundary. Use a fresh review chat so the reviewer assesses the diff independently.

### Independent checkpoint CP22

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 22, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Task 23. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_22_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 22; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 22 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
Build ownership ADR; strict query/read generation; stale guarded submission; protocol/version alignment; source mapping; pure guard parity; query immutability; replacement/rollback evidence; unchanged GameState/Replay.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run the complete corepack pnpm test once in a fresh process, strict TypeScript, ESLint, repository formatting check, content validation and production build. Run the affected real Chromium matrix and the exact relevant compatibility/determinism tests. Do not rerun the unchanged 60-minute soak at every checkpoint; run the relevant lifecycle/fault tests. A later comprehensive gate does not excuse a missing task gate now.
Task-specific regression matrix: Worker protocol/client/host, projection/store, Build queries and repaired save admission/recovery.
Performance evidence: performance:projection, performance:worker-host, Build read diagnostic.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 22 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 22 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
feat: add owned build workspace query bridge
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_22_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

### Independent checkpoint CP23

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 23, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Task 24. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_23_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 23; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 23 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
Async mount/destroy races; keyed scene updates; owned texture/ticker cleanup; coordinate/DPR math; port/route hit order; selection and inspector truthfulness; no per-frame React updates; real source data instead of placeholders.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run the complete corepack pnpm test once in a fresh process, strict TypeScript, ESLint, repository formatting check, content validation and production build. Run the affected real Chromium matrix and the exact relevant compatibility/determinism tests. Do not rerun the unchanged 60-minute soak at every checkpoint; run the relevant lifecycle/fault tests. A later comprehensive gate does not excuse a missing task gate now.
Task-specific regression matrix: Renderer lifecycle, camera/hit testing, selection/inspector, actual Chromium canvas and existing persistence controls.
Performance evidence: Projection diagnostic if changed; measured scene-update and input costs.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 23 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 23 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
feat: render interactive facility canvas
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_23_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

### Independent checkpoint CP24

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 24, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Task 25. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_24_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 24; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 24 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
BUY then PLACE partial outcome; no refund on Cancel/Undo; stale preview/unknown result; credit-limit parity; no-op revisions; attached route cleanup; ordered partial removal; exact Apply cost/downtime; active Benchmark guard; existing history/IDs.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run the complete corepack pnpm test once in a fresh process, strict TypeScript, ESLint, repository formatting check, content validation and production build. Run the affected real Chromium matrix and the exact relevant compatibility/determinism tests. Do not rerun the unchanged 60-minute soak at every checkpoint; run the relevant lifecycle/fault tests. A later comprehensive gate does not excuse a missing task gate now.
Task-specific regression matrix: Design/economy/Blueprint history, command correlation, manual Build browser flow and save/load draft continuation.
Performance evidence: performance:design, performance:apply, actual preview and command-to-visible latency.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 24 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 24 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
feat: connect inventory and design mode workspace
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_24_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

### Independent checkpoint CP25

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 25, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Task 26. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_25_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 25; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 25 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
Integer A* costs/ties; canonical inclusive paths; manual-validator ownership; no gameplay congestion/capacity change; research gates; adjacent-only scope; partial sequential auto-connect; no triggers on Undo/load; ID carry and exact-100 paths.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run the complete corepack pnpm test once in a fresh process, strict TypeScript, ESLint, repository formatting check, content validation and production build. Run the affected real Chromium matrix and the exact relevant compatibility/determinism tests. Do not rerun the unchanged 60-minute soak at every checkpoint; run the relevant lifecycle/fault tests. A later comprehensive gate does not excuse a missing task gate now.
Task-specific regression matrix: Grid/manual routing/Design/Blueprint, exact route determinism, Worker command parity and Chromium route tools.
Performance evidence: performance:build-routing plus unchanged performance:routing, performance:grid, performance:compute.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 25 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 25 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
feat: add deterministic route planning and construction UI
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_25_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

### Independent checkpoint CP26

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 26, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Task 27. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_26_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 26; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 26 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
Live-only capture; historical records; materialization preview ID stripping; one-group Undo; heatmap baseline/epsilon/source truth; no draft future physics; Diagnostic Pulse fact provenance; reduced effects; no domain pulse command or hash change.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run the complete corepack pnpm test once in a fresh process, strict TypeScript, ESLint, repository formatting check, content validation and production build. Run the affected real Chromium matrix and the exact relevant compatibility/determinism tests. Do not rerun the unchanged 60-minute soak at every checkpoint; run the relevant lifecycle/fault tests. A later comprehensive gate does not excuse a missing task gate now.
Task-specific regression matrix: Blueprint, thermal/publication/store, diagnostic query safety, settings persistence and Chromium Blueprint/heatmap/reduced-motion flows.
Performance evidence: performance:blueprints, dense heat/pulse render measurements and projection diagnostic if changed.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 26 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 26 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
feat: add blueprint tools and thermal diagnostics
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_26_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

### Independent checkpoint CP27

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 27, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Task 28. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_27_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 27; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 27 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
Four viewport minima; both locales/expanded text; inspected screenshots; absence of static false data; keyboard/IME/modal precedence; focus recovery; color-independent information; reachable persistence controls; production fixture isolation.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run the complete corepack pnpm test once in a fresh process, strict TypeScript, ESLint, repository formatting check, content validation and production build. Run the affected real Chromium matrix and the exact relevant compatibility/determinism tests. Do not rerun the unchanged 60-minute soak at every checkpoint; run the relevant lifecycle/fault tests. A later comprehensive gate does not excuse a missing task gate now.
Task-specific regression matrix: Complete Build visual/keyboard/browser selection plus affected Phase 2 UI/lifecycle cases.
Performance evidence: Resize/resource counters, 20 lifecycle cycles and relevant measured presentation regressions.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 27 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 27 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
feat: complete responsive accessible build workspace
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_27_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

### Independent checkpoint CP28

```text
Perform an independent in-depth review and checkpoint for OVERCLOCK Phase 3 Task 28, after all its implementation subtasks.
Recommended model: GPT Sol, reasoning high, in a fresh review chat. Do not start Phase 4 or any later task. Do not create an empty commit.

Authorization and preflight
This checkpoint invocation authorizes committing and pushing only if every applicable condition below passes. Read all applicable AGENTS.md instructions, the adopted Phase 3 contract, PHASE_3_ENTRY.md, mapped ADRs, permanent phase/TDD/status/diagnostics, and the task handoff if present.
Fetch origin. Reconstruct TASK_28_BASE from the recorded preceding checkpoint and Git, not from an assumed hash. Verify HEAD is that base and local/tracking/remote refs have no unexplained divergence. Inventory all tracked/untracked/staged changes. Every candidate file must belong to reviewed Task 28; preserve any unrelated user work and stop rather than include, reset or stash it.
Verify the repaired Phase 2 baseline is an ancestor and its F1/F2 fixes remain present. Inspect the complete accumulated Task 28 diff and the unchanged neighboring APIs needed to judge integration.

Independent review focus
Entire Phase 3 diff from PHASE3_BASE; final candidate hashes; all scoped decisions; F1/F2 repair retention; real Worker/save/Replay parity; 60-minute soak; target/exception honesty; screenshots matching candidate; frozen Phase 1/2 formulas/content.
Trace one successful and one rejected/fatal path end to end. Challenge ownership, stale data, repeat input, partial outcomes and lifecycle cleanup. Do not accept a test count, a green screenshot, or the implementer's report as proof by itself. Reproduce suspicious behavior with the smallest meaningful regression.
Narrow corrections inside the approved task are allowed. Do not change gameplay semantics, widen scope, weaken gates or repair an unrelated subsystem silently. If a Critical/Important issue cannot be resolved within this contract, stop before staging/commit and report its exact reproduction. Reconcile checkpoint-neutral documentation without seeking redundant approval for decisions already settled by this contract.

Verification
Run corepack pnpm test twice in separate clean processes, corepack pnpm validate, and the complete Chromium suite. Run all exact determinism/compatibility assertions and the canonical plus duplicate milestone. Verify the final 60-minute soak and all Phase 3 visual/target-host evidence were produced from this exact candidate; rerun affected evidence after any review repair. Run every unchanged Phase 1/2 permanent diagnostic and every new Phase 3 diagnostic. Preserve the recorded accepted exceptions without broadening them.
Task-specific regression matrix: Complete unit/determinism/Chromium/validation matrix, exactly repeated full tests, milestone baseline/duplicate, corruption/recovery and every new Phase 3 test.
Performance evidence: All 20 unchanged Phase 1/2 Node diagnostics plus new Build/routing/render/input diagnostics and exact-candidate soak.
Run git diff --check; simulator forbidden API/import scan; production-to-devtools/manual-harness scan; emitted-bundle scan; authoritative-state/cache audit where relevant; gameplay content/balancing/Word/lockfile drift inspection. Confirm renderer/presentation time never enters deterministic state or Replay.
Inspect required screenshots directly and record viewport/locale/platform. Browser failure or absent target hardware remains a missing gate unless the owner has explicitly accepted that exact exception. Earlier host exceptions do not excuse a new correctness defect or a new performance path.

Checkpoint conditions
1. No Critical or Important correctness, ownership, security, determinism, UI usability or contract defect remains in the reviewed scope.
2. Required tests, browser scenarios, compatibility and performance evidence pass or have an exact recorded owner exception for a performance-only limitation.
3. Existing Phase 1/2 state/RNG/Replay/save vectors and formulas are preserved.
4. Permanent docs describe completed behavior without uncommitted/pending-checkpoint claims. Move useful handoff content into them and remove temporary Task 28 handoff/probe files.
5. The exact reviewed allowlist contains all and only Task 28 work. No fake/stale evidence or production test/debug hook is included.

If all conditions pass
Stage only the explicit allowlist. Inspect the staged diff and run a focused staged smoke plus strict TypeScript after the last edit. Do not modify files after that smoke without rechecking the affected gate.
Commit with subject:
test: harden build workspace integration and diagnostics
Push to origin/main. Verify HEAD, origin/main and remote main resolve to the same new full commit hash, ahead/behind is 0/0, parent is TASK_28_BASE and the worktree is clean. Do not amend/rewrite an earlier published checkpoint or include an empty commit.

If any condition fails
Do not commit or push. Leave the candidate available for correction. Report the precise blocker, reproduction, affected contract, changed files and outstanding verification. Do not call it READY and do not move forward.

Final report
Give exact commit/parent/refs/clean-state evidence if checkpointed; review findings and narrow corrections; committed allowlist; test counts/commands; deterministic/hash/RNG results; browser/screenshots; performance table and host/exception classification; permanent documentation; remaining risks; next permitted task. If blocked, explicitly state no commit/push and the safe continuation boundary. Do not use /status or claim a numeric usage allowance.
```

## 17. Final independent Phase 3 closure prompt

Run after CP28 is committed and public main is clean. This is separate from the CP28 review. Use Sol High in a fresh chat.

```text
Perform the independent OVERCLOCK Phase 3 closure and Phase 4 entry-readiness audit.
Recommended model: GPT Sol, reasoning high. This is read-only. Do not implement or plan Phase 4. Do not create an empty commit.

Repository: https://github.com/MafiaMasinescu/Overclock
Read every applicable AGENTS.md. Fetch current public main and verify HEAD/origin/main/remote main, 0/0 divergence and a clean worktree. Reconstruct PHASE3_BASE and CP22–CP28 from Git, PHASE_3_ENTRY.md and PROJECT_STATUS. Stop if the range or a changed file's ownership is ambiguous.
Read the complete approved Phase 3 contract, current TDD/phase plan, mapped ADRs, all permanent Phase 3 diagnostics/visual evidence and relevant Phase 1/2 contracts. Treat Word files as archival. Verify the Phase 2 F1/F2 repairs remain intact.

Audit the full phase transition and specifically prove:
1. UI, controller and Pixi cannot mutate simulator state; only existing typed commands mutate it.
2. Build query generations, strict Worker schema/correlation, source freshness, lifecycle reset and result ACKs prevent stale or cross-session intent.
3. Camera/DPR/hit testing is correct at all four resolutions; input never changes domain coordinates through an implicit transform.
4. Renderer reconciliation is incremental; async initialization, context loss, remount, resources and subscriptions are safe.
5. Inventory/Catalog prices, reservations/unlocks/credit and purchase→placement partial outcomes match the accepted command contracts; no refund or fake atomicity is implied.
6. Move/rotate/remove/Undo/Redo/Apply/Cancel preserve live/draft ownership, original ID/history semantics, exact cost/downtime, Benchmark guards and rollback.
7. Manual/A*/adjacent routing preserves canonical paths, public occupancy validation, capacity/congestion gameplay and research gating; auto-connect never fires from replay/load/Undo/tick.
8. Blueprint live-only capture, historical compatibility, rotation, inventory, one-group history and large ID carry remain correct.
9. Heatmap uses the actual published field, accumulated delta baseline and exact readouts correctly; Diagnostic Pulse uses recorded facts without commands/RNG/fake throughput.
10. Every user-facing Phase 3 control works through mouse and keyboard at 1280×720 and the larger sizes, in RO/EN and reduced-motion settings; screenshots show actual state, not placeholders.
11. Save/Replay mid-draft continuation, import atomicity, repaired corrupt-autosave recovery, native Worker ownership and stale UI clearing still work.
12. All frozen Phase 1/2 formulas, deterministic hashes, RNG, Campaign boundaries and canonical milestone bands remain intact.

Run from the clean checkout:
- Complete Phase 3 focused tests and affected Phase 1/2 regressions.
- Complete corepack pnpm test twice in separate processes and corepack pnpm validate.
- Complete real Chromium suite, including visual/keyboard, native Worker/persistence, corruption and recovery cases. Inspect required screenshots directly.
- All unchanged permanent Phase 1/2 diagnostics and new Phase 3 Build/routing/render/input diagnostics. Run target timings in isolation and classify hardware accurately.
- Exact-100 new path/intent/save continuation tests and existing deterministic/compatibility suites; canonical and duplicate milestone baseline.
- Git diff --check, forbidden domain API/import scans, production→devtools/manual-harness and emitted-bundle scans, authoritative cache/serialization inspection, balancing/module numeric/Word/lockfile drift inspection.
Review exact-commit 20-cycle and 60-minute soak evidence. Re-run the long gate if the evidence predates a change to the relevant lifecycle path or is not attributable to the audited commit. Do not mislabel retained prior evidence as a fresh run.

Performance claims require documented target hardware, or an explicit existing owner exception covering the exact limitation. Preserve failed rows and unavailable metrics. No changed fixture/sample/warm-up/threshold, retries-until-pass, or correctness waiver.

Report Git identity/range, original scope coverage, findings by severity with exact reproduction, tests, visual review, deterministic/compatibility/RNG evidence, performance, renderer/Worker/state ownership, persistence/recovery, documentation contradictions, remaining risks and READY or NOT READY for a separate Phase 4 contract.
READY requires no known Critical/Important defect, complete required functional/browser evidence, valid performance evidence or its exact authorized exception, clear deferred boundaries and clean synchronized Git. If a defect exists, recommend only a narrow repair; do not repair it in this read-only session.
Stop after the audit. Do not implement or plan Phase 4, modify documentation merely to create a commit, or run /status/usage-percentage polling.
```

## 18. Exact execution order

1. Complete and checkpoint the Phase 2 audit repairs outside this plan.
2. Run the read-only entry prompt. Record the repaired PHASE3_BASE when ENTRY READY.
3. Luna xhigh: 22.1 → 22.2 → 22.3 → 22.4. Sol High: CP22.
4. Luna xhigh: 23.1 → 23.2 → 23.3. Sol High: CP23.
5. Luna xhigh: 24.1 → 24.2 → 24.3 → 24.4. Sol High: CP24.
6. Luna xhigh: 25.1 → 25.2 → 25.3. Sol High: CP25.
7. Luna xhigh: 26.1 → 26.2 → 26.3. Sol High: CP26.
8. Luna xhigh: 27.1 → 27.2 → 27.3. Sol High: CP27.
9. Luna xhigh: 28.1 → 28.2 → 28.3. Sol High: CP28.
10. Sol High in a fresh audit chat: final Phase 3 closure. Stop before Phase 4 planning until the user requests it.

There is no commit between subtasks of the same task. Each checkpoint reviews its entire accumulated diff. Checkpoint prompts authorize commit/push only after their conditions pass. Routine preflights do not repeat the full phase audit or require a clean worktree in the middle of an approved task.

## 19. Risks and explicit dispositions

| Risk                                                 | Contract response                                                                    | Remaining condition                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Current Phase 2 defects                              | F1/F2 remain hard entry blockers.                                                    | Repair/reclosure happens first on the development PC.                               |
| Future Phase 2 repair changes API/ADR numbering      | Pin the repaired base and reconcile names/ADR map at entry.                          | Material new contract conflict requires a decision before edits.                    |
| Commands accepted before visible publication         | One coordinator, pending visuals, guarded generation and bounded resync.             | Real delayed/lost-publication browser tests.                                        |
| One-gesture purchase appears atomic                  | Explicit retained Inventory/partial outcome, no automatic refund.                    | Owner may request a future separate atomic purchase contract; not implemented here. |
| Auto-connect adds several Undo records               | Visible separate operations, deterministic order and partial result.                 | Atomic grouping is deferred.                                                        |
| Dense rendering stresses old target hardware         | Keyed resources, dirty heat updates, capped effects, real diagnostics.               | Hardware acceptance cannot be certified from a cloud host.                          |
| Model scope drift or accidental old-contract rewrite | Small subtasks, complete source-based prompts and independent checkpoint boundaries. | New behavior conflicts stop only the affected boundary.                             |
| Screenshot tests hide real defects                   | Inspect images, small reviewed golden set, no blanket canvas mask.                   | Pixel baselines are tied to browser/platform.                                       |
| Browser download/access unavailable                  | Mark native gates blocked and retain completed evidence.                             | Do not replace Worker/WebGL/IndexedDB proof with mocks.                             |
| Presentation fields become second truth              | Owned narrow queries and fact provenance, unknowns stay null.                        | Full gameplay forecasting/Explain Loss expansion is Phase 4.                        |
| Resource leakage and stale context                   | Generation-safe init, complete cleanup, 20 cycles and final 60-minute soak.          | Browser memory metrics may be unavailable; report exact limits.                     |
| Historical performance exceptions spread silently    | Retain precise existing scope and raw misses.                                        | Any new waiver requires explicit owner authorization.                               |

## 20. Source ledger

Repository evidence at planning commit d63a34c7b030f748a7eac141bf790eb6e4228f7d:

- AGENTS.md; README_START_HERE.md; docs/status/PROJECT_STATUS.md.
- docs/phases/03_BUILD_WORKSPACE.md, 04_PLAYABLE_LOOP.md, 05_RELEASE_CANDIDATE.md and OVERCLOCK_Phase_2_Contract_and_Prompts.md.
- docs/TDD_VERTICAL_SLICE.md sections 18–20, 28–35, 40–43; docs/GDD.md sections 33–35 and reconciled production roadmap.
- ADR-0005 through ADR-0009 for geometry/Design/manual routes/history/Apply; ADR-0019 and Task 13.7 behavior for Blueprints; ADR-0022 for phase ownership; ADR-0027 through ADR-0029 for presentation/Worker/persistence.
- src/app/game-client/contracts.ts; workerGameClient.ts; store.ts; src/app/worker/protocol.ts and simWorkerHost.ts.
- src/sim/selectors/presentationTypes.ts, sourceMapping.ts, projector.ts and gridPublication.ts.
- src/sim/design/designModeCommands.ts and designApplyPreview.ts; src/sim/routing/manualRouting.ts; src/grid/domain geometry helpers.
- src/sim/blueprints/blueprintMaterialization.ts and blueprintCommands.ts; current content/research.json feature unlocks.
- src/rendering/pixi/emptyPixiGridAdapter.ts and current UI layout/workspace components; package.json and Playwright configuration.

Official PixiJS 8 references used to verify lifecycle/loop assumptions, checked during planning:

- [Application](https://pixijs.com/8.x/guides/components/application): asynchronous init and private-application options.
- [Ticker](https://pixijs.com/8.x/guides/components/ticker) and [Ticker plugin](https://pixijs.com/8.x/guides/components/application/ticker-plugin): listener cleanup, start/stop and frame cap. Ticker minFPS is a delta clamp, not proof of delivered minimum FPS.
- [Performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips): batching/resource/event/filter tradeoffs.

The repository's pinned package types take precedence over an example that targets another library release. These references do not authorize a dependency upgrade.

Planning ends here. No Phase 3 code, repository edit, staging, commit or push accompanies this artifact.
