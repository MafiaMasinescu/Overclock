# Task 23 / CP23 independent review

Historical review: 2026-10-02. Original disposition: **BLOCKED**.
The 2026-10-04 corrective review below supersedes the historical open findings and
publication prohibition only after its recorded final verification is complete.

The owner authorized the final one-based coordinate display and zoom percentage,
then CP23 under the adopted contract. An independent read-only reviewer examined
the complete tracked/untracked Task 23 candidate and neighboring APIs. The main
agent ran the checkpoint gates and reproduced narrow lifecycle findings. The
reviewer made no repository edits. At that historical review no Critical finding
was established; five Important findings remained open after the three narrow
corrections below.

## Identity and scope

Checkout: `D:\miscellaneous\Overclock\vertical_slice_v1`, branch `main`.
`TASK_23_BASE`, HEAD, origin/main, and remote main:
`eb4b2b387bf9293fd6353ee4064131e3cac7ee59` (CP22).
Fetch and public-ref checks confirmed 0/0 divergence. The repaired Phase 2 base
`f982c7dbec5f7f444988eb7130b1db3ee7803dfb` is an ancestor; malformed-Unicode
admission and quarantined-autosave rotation code remain untouched and their
regressions are included in the core/affected browser gates.

No Task 24 work, authoritative-state/save/Replay schema change, balance change,
dependency/lockfile change, Word edit, staging, commit, or push occurred.
`TASK_23_VERIFICATION.md` was retained. At that blocked review the temporary
handoff/plan files remained; the corrective review below records their later
consolidation and closure conditions.

## Owner-requested presentation refinement

The toolbar now shows the actual camera zoom as a rounded percentage after `+`.
The display follows initial camera admission, Fit, wheel, keyboard, and buttons.
Grid labels run from 1 to 24 / 1 to 16. Inspector tile titles use the same display
convention; internal tile IDs and coordinates remain zero-based. Low-zoom label
thinning is retained for readability. The new unit and browser regressions were
observed RED before implementation, then GREEN.

## Narrow corrections verified during checkpoint

1. **Initialization failure cleanup.** Calling Pixi `Application.destroy()` before
   renderer/plugin initialization threw `this._cancelResize is not a function` and
   left UI status initializing. The failed private stage is now destroyed safely;
   obsolete generations cannot publish error status. Actual Chromium with all
   graphics contexts unavailable now shows the recoverable renderer error, exposes
   no canvas, and successfully saves through the production Worker without an
   unhandled rejection. Disabling only WebGL was an invalid failure fixture because
   Pixi falls back to another renderer; that exploratory result is not claimed RED.
2. **Recreation baseline.** Disposal emptied owned module/route containers but
   retained the keyed baseline. Retry recreated no entities despite ready status.
   `clearScene()` now resets its associated baseline. The nonempty dense regression
   observed moduleCreated 24 instead of expected 48 before correction; afterward
   retry recreates all 24 modules / 7 routes, reaching cumulative counts 48 / 14.
3. **Owned Graphics contexts.** Pixi 8.19.0 does not destroy owned contexts when
   passed only `{ children: true }`. Explicit `context: true` now propagates through
   child redraw/removal and application teardown; shared textures are not destroyed
   indiscriminately. An actual-Pixi twenty-cycle probe retained 60 contexts before
   correction and zero afterward. It also verifies one canvas per ready mount,
   no late canvas after pending-init destruction/remount, DPR 2 backing width 1280
   for width 640, repeated-destroy safety, and released adapter counters/canvas.

These are in-scope corrections, not a claim that the remaining review passed.

## Historical Important findings (2026-10-02)

### F1 — dirty updates recreate unaffected visuals; diagnostic undercounts

Locations: `src/rendering/pixi/pixiGridAdapter.ts`, `moduleVisualSignature` (line 87),
visual-update loop (line 455), unconditional port/selection/heat redraws (line 492),
and `update`/`drawGrid` (line 842).

Temperature is in the visual signature although the current body/label does not
display it. Temperature-only publication destroys/recreates that body and label.
Grid, ports, selection, and heat children are rebuilt on every update. The visual
loop does not increment `moduleUpdated`, so zero is not proof of no redraw.
The independent actual-Pixi Chromium harness observed destroyed old body/grid
objects with moduleUpdated still zero. The main dense regression tests topology
recreation, not retained child identities, and does not close this finding.

Correction required: distinguish geometry, consumed visual state, thermal data,
and local overlays; retain unaffected resources; count actual work. Add retained
identity assertions for unchanged/thermal-only models and measure actual adapter
updates. The pure map/hit-test/preview diagnostic is not that measurement. No
target timing failure is inferred from this correctness/evidence finding.

### F2 — competing canvas and DOM entity-list selection owners

Locations: `src/ui/layout/OperationsStack.tsx:155` and `:174`;
`src/ui/workspaces/CenterWorkspace.tsx:61` and `:118`.

Source-traced sequence: select module A (or a route) from the DOM list; that button
publishes context directly. The Worker selected flags change the grid model.
`pruneSelection` creates a fresh normalized array from the canvas's previous local
selection; its context effect republishes that previous selection, clearing A or
restoring an older tile. The two input paths do not share selection ownership.

Correction required: one selection controller for canvas and DOM input; avoid
republishing unchanged membership. Verify the actual shell with a nonempty
production-Worker facility and subsequent publications. The independent reviewer
source-traced this sequence but did not execute the shell reproduction; do not
misrepresent it as an automated browser failure. Existing empty-grid scenarios
and a separately mounted dense adapter do not cover it.

### F3 — Draft badge incorrectly labels Live physical readings

Location: `src/ui/layout/OperationsStack.tsx:197`; authoritative physical source
is in `src/sim/selectors/projector.ts`.

Source-traced sequence: move an installed module in Design Mode and inspect it.
Its temperature/Power/Compute evidence remains Live, but the sole badge derives
from draft grid mode. Geometry and measured facts are not distinguished.

Correction required: label Draft geometry separately from Live physical values
with observed tick; preserve unavailable measurements for draft-only modules and
routes. Add moved-installed, draft-only, and live/unavailable route cases. This
was source-traced, not executed as a new browser reproduction.

### F4 — required twelve module visual identities are missing

Location: `src/rendering/pixi/pixiGridAdapter.ts:296`, label at line 312.

Every definition uses the same stretched generic body colored by operational
state/warning; `spriteKey`/definition changes affect reconciliation only. The label
is an instance-ID suffix, not the required short localized content identity.

Correction required: twelve readable local primitive designs keyed by projected
identity and localized labels; inspect all identities/representative rotations in
RO and EN. No new texture framework or gameplay geometry is required. This is an
explicit Task 23.1 deliverable gap, not a measured browser failure.

### F5 — persisted frame cap is not applied

Locations: `src/rendering/pixi/pixiGridAdapter.ts:236` and
`src/ui/workspaces/CenterWorkspace.tsx:67`.

The adapter submits dirty renders on unrestricted requestAnimationFrame callbacks.
The workspace does not obtain/supply persisted frameCap; there is no 30/45/60 cap
mechanism. Continuous pan on a 60 Hz display can request successive submissions
despite a saved 30 FPS setting. No configured-cap timing was independently measured;
the missing mechanism is established by source, not a claimed timing-budget miss.

Correction required: consume existing session settings through approved metadata,
cap only presentation scheduling, and verify continuous-input cadence plus hidden/
resume behavior at all supported caps. Do not alter simulation cadence or settings
schema, or treat historical host exceptions as a waiver.

## Verification and continuation

Exact commands, results, exploratory failures, current hashes, screenshot paths,
host conditions, and timing output are recorded in `../../TASK_23_VERIFICATION.md`.
Core tests passed before the narrow lifecycle corrections; affected lifecycle tests
are rerun on the corrected source. No test count or screenshot closes F1–F5.

Task 24 construction, future routing/Blueprint/heatmap features, Task 28 target
certification/soak, and Phase 4 remain outside this review. Remaining review gaps
include actual shell selection/source scenarios, configured frame-cap cadence,
all-twelve RO/EN visual evidence, actual adapter-update measurements, and stronger
obsolete-rejection/context-loss coverage. Correct Task 23 and rerun the affected
gates before another independent CP23 decision. That historical candidate was not published.

## Corrective review — 2026-10-04

The owner explicitly authorized resolving the findings and completing CP23,
including commit/push only after verification. Scope remains Task 23; Task 24 is
not started. A fresh read-only reviewer examined all tracked and untracked Task 23
files against CP22 and relevant Worker/store/projector/persistence neighbors.

F1 is corrected by retained module children, dimension/port/selection signatures,
keyed heat cells and counters for actual work. Chromium identity assertions cover
unchanged and temperature-only publications and one changed heat cell. F2 now has
one shared bounded selection controller; the actual nonempty production-Worker
shell verifies both input surfaces, later publications, removals and replacements.
F3 separates geometry source from Live physical source/tick and preserves missing
measurements for draft-only entities. Unsupported capacity remains unavailable,
not computed from ports. F4 implements twelve distinct primitive identities with
localized short names and quarter-turn footprints. F5 consumes existing session
settings, honors 30/45/60 caps only in presentation, and verifies hidden/resume,
disposal and persisted/explicitly imported settings on the real renderer.

The independent corrective review found two further Important disconnect cases:
selection remained enabled after Worker failure, and rejected clock promises were
unhandled. It reproduced both in Chromium. Connection-aware selection now clears
pending membership/generations; input/clock controls are disabled and guarded, and
clock rejections leave authoritative state unchanged without retry. A subsequent
review identified same-epoch resync restoring stale Worker context: its controller
probe reproduced the missing clearing request; Worker/renderer integration was
source-traced. Readmission now submits one empty context. Unit RED/GREEN and an
actual production-Worker stale-publication/full-resync browser regression verify
cleared module/route flags, null inspector and subsequent selection.

The complete browser matrix then exposed two existing persistence-control cases:
temporary null snapshots unmounted the drawer during load, hiding recovery/status.
AppShell now retains the last immutable admitted snapshot/grid during the empty
epoch boundary; connection state disables interaction and explicitly labels the
resync. This preserves the persistence component tree without fabricating new
authoritative state. Both unchanged persistence regressions pass after correction.

The reviewer made no repository edits or Git writes. Final gate results, direct
screenshot inspection, CPU/GPU classification and the publication decision are
recorded in the latest 2026-10-04 section of `../../TASK_23_VERIFICATION.md`.

### Corrected code verdict and final evidence

The fresh reviewer's final source verdict after the admitted-reader extraction
found no Critical/Important issue. Its additional evidence-only follow-up could
not complete because the reviewer execution service returned a usage-limit error;
that follow-up is not represented as a completed independent documentation pass.
The checkpoint executor separately validated the final evidence against command
outputs, directly inspected eighteen images, and checked all 54 source/screenshot
byte hashes. Complete core, affected browser, compatibility and diagnostic gates
pass; the explicit staged smoke and TypeScript guard publication as specified by
CP23. No new performance exception or Task 28 certification is asserted.

The executor's last source trace found an additional narrow tool-state mismatch:
client replacement retained the Pan button but recreated the adapter in Select.
A production-Worker browser regression failed with six selected tiles while Pan
was pressed. A tool/client-scoped synchronization effect now reapplies the existing
local mode; no gameplay state, renderer lifetime or per-frame subscription changed.
The dedicated regression and complete 53-case Chromium matrix pass. Fresh complete
core, lint, TypeScript, content and production build pass after the correction.
The executor reviewed this minimal delta directly. A later targeted independent
source follow-up also completed: it traced the creation/effect/init/input order,
verified the new regression's behavioral assertions, and explicitly closed the
Pan/client-replacement blocker with no Critical/Important finding. The earlier
evidence-only documentation follow-up remains uncompleted; it is distinct from
this successful final source review. No Critical/Important finding remains.

## CP23 disposition — PASS

The corrected candidate passes the required core/browser/compatibility/diagnostic
gates and the exact 45-path staged review. Focused staged smoke passes 7 unit files /
34 tests and 6 real Chromium lifecycle/settings/persistence scenarios. Evidence-only
documentation updates are checked with explicit Prettier and strict TypeScript
before publication; source/test bytes stay unchanged from that passing smoke.
The owner-authorized checkpoint is the commit containing this report, with exact
subject `feat: render interactive facility canvas` and parent CP22
`eb4b2b387bf9293fd6353ee4064131e3cac7ee59`. Git post-push identity/synchronization
is checked separately and reported in the checkpoint handoff. No Task 24 is begun.
