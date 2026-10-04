# Phase 3 rendering foundation — Task 23

Task 23 implements the owned Pixi 8.19.0 facility scene, local camera/input and
selection/inspector bridge. Task 24 construction and Task 28 certification are
not part of this delivery. Exact commands, failures, environment and candidate
hashes are retained in `../../TASK_23_VERIFICATION.md`.

## Implemented ownership and API mapping

| Concern                                                 | Implemented owner / source                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Gameplay, commands, 100 ms clock, RNG, saves and Replay | Existing SimCore → Worker → GameClient boundary, unchanged                        |
| Owned immutable scene data                              | `GameClient.getGridViewModel()` and store publications                            |
| Actual values and observed tick                         | `UiSnapshot` inspector/header/task/telemetry; no UI formulas                      |
| Canvas and DOM selection                                | One `selectionController` per client; `setPresentationContext`                    |
| Camera/hover/rectangle preview                          | Adapter-local CSS/world geometry, never serialized                                |
| Settings                                                | Existing session metadata from `queryBuild(context)`; persisted/imported frameCap |
| Labels/status/accessibility                             | React/i18next dictionaries; twelve content-definition short names                 |
| Resources and draw scheduling                           | One private Application, retained keyed primitives, dirty RAF capped 30/45/60     |

Fixed layer order is grid, heat, routes, modules, ports, selection, ghost, effects.
A separate local rectangle-preview layer is below ghost. Grid dimension labels
are screen-space text positioned from real camera/grid geometry. The compatibility
`emptyPixiGridAdapter` export now delegates to the real adapter.

Module cabinets have twelve distinct primitive pictograms, not differently colored
copies of one body. Already-rotated footprints and owned port geometry remain the
only gameplay geometry. Labels remain upright; pictograms rotate. Bounded primitives
use Pixi's public batching mode, without a texture framework or new dependency.

Unchanged/temperature-only publications retain module children, grid, ports and
selection. Heat cells retain their Graphics and update only changed values. Actual
dirty work increments diagnostics; zero module updates is paired with identity
assertions, not accepted alone as proof. Removal/retry releases owned contexts and
resets the keyed baseline. Initialization failure, obsolete initialization, context
loss/recreation, resize/DPR, hidden/resume and repeated disposal have browser coverage.

## Input, selection and source truth

Tiles are 32 world pixels. Pointer coordinates first normalize the canvas client
rectangle into logical CSS pixels; DPR affects only backing resolution. Zoom is
0.35–3, Fit reserves 24 CSS pixels, and bounded pan works in both axes even when the
facility fits. Hit order is visible port, module, route (6 CSS-pixel tolerance),
then valid tile. Visible external ports remain selectable; external tiles do not.

The owner-directed refinement supersedes the initial contract's empty-tile toggle
and module-only rectangle sketch: one clicked empty tile replaces selection;
drag selects the inclusive clipped tile rectangle on release without requiring
Shift. A darker blue preview is local until release and retains overlap objects
when rows/columns enter or leave. Escape, pointer cancellation, blur, tool/camera,
resize/layout replacement and connection loss cancel it. Module/route membership
behavior and the DOM Shift path remain available; no removal tool is introduced.

Canvas and entity list share one controller. Requests are bounded to one in-flight
plus one latest intent; unchanged membership does not republish. Removal and epoch
replacement clear stale references. Non-live connections clear pending membership
and disable input; same-epoch readmission synchronizes an empty Worker context so
full resync cannot revive stale outlines. Clock controls preserve authoritative
state, handle rejected transport promises and do not retry unknown outcomes.

Client-scoped external-store readers retain the last immutable admitted snapshot
and grid across an empty epoch. The connection banner and disabled controls mark
this frozen readout; it is not an optimistic replacement. Persistence dialogs stay
mounted during load/resync, preserving their revision-bound status and recovery
controls. A replacement client starts with fresh reader defaults.

Geometry is labelled Live/Draft separately from physical Live readings and observed
tick. Moved installed modules retain Live physical readings; draft-only measurements
remain unavailable. Route endpoints come from the owned projection; capacity is
explicitly unavailable because no accepted route-detail field supplies it. No port
minimum is recomputed in UI. Task progress and compact telemetry consume snapshots;
charts and gameplay action workspaces remain Phase 4 omissions.

Display coordinates are one-based (1–24 / 1–16); internal IDs, saves and Replay stay
zero-based. Labels follow the grid and thin at low zoom. The zoom percentage after
Fit/+ reports the actual camera, including wheel, keyboard and recreation.

The local Select/Pan tool is reapplied when the adapter is recreated for a new
client, so the pressed toolbar button and pointer behavior cannot diverge.
This synchronization runs only on tool/client changes, not on pointer frames.

## Diagnostics and scope limitations

`corepack pnpm performance:pixi` retains its 80 warm-up / 400 measured pure CPU
cohort. It tests synthetic map reconciliation, hit testing and incremental preview,
not rendering or target acceptance.

`task23-renderer-performance.spec.ts` measures actual adapter updates, foreground
WebGL CPU submission and pointer callback, 80 warm-up / 400 measured frames, at
1920×1080/DPR 1. It projects the accepted Phase 2 thermal fixture: 110 mixed modules,
112 routes, 300 occupied tiles and 384 nonuniform heat cells. This Windows-host
diagnostic explicitly selects D3D11 and records the unmasked GTX 1050 identity.
The earlier default-headless/software command-burst timeouts are preserved, not
converted to passes. No timeout, cohort, scene or assertion was reduced.

Task 23 diagnostics do not claim GPU execution time, the audited mixed Power/Data
Task/Research/Boost/Benchmark fixture, 300/3000-frame budgets, 60-second telemetry
cohort, 8 GiB target certification or the Task 28 soak. The projection path is
unchanged; its historical performance exceptions remain historical. Authoritative
hash/RNG equality and compatibility vectors are checked independently.
