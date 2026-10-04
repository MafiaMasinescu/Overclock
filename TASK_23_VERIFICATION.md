# Task 23 verification

Updated: 2026-10-04

The sections below retain the historical 2026-09-28 and 2026-10-02 evidence,
including the blocked CP23 review. **Latest CP23 verification — 2026-10-04** at
the end supersedes earlier dispositions, counts and hashes. Failures are retained.

The owner subsequently authorized Task 23 corrections and conditional CP23
commit/push after all applicable checks. Task 24 remains outside this authorization.
See the latest section for the current reviewed candidate and gate results.

This document is the preserved verification artifact for the Task 23
candidate, including the corrections requested after the first independent CP23 review.
It is intentionally preserved as part of CP23. The attached contract and its
prompts were treated as the normative implementation specification; the user's request
supplied the execution boundary, complete verification requirement, and the instruction
initial instruction to leave the candidate uncommitted until manual validation was
complete. That earlier execution boundary does not override the later direct
authorization to finalize and publish CP23.

## Candidate identity and environment

Commands:

```text
git rev-parse HEAD                         -> eb4b2b387bf9293fd6353ee4064131e3cac7ee59
git rev-parse origin/main                  -> eb4b2b387bf9293fd6353ee4064131e3cac7ee59
git ls-remote origin refs/heads/main       -> eb4b2b387bf9293fd6353ee4064131e3cac7ee59 refs/heads/main
node --version                             -> v24.11.0
corepack pnpm --version                    -> 11.22.0
git --version                              -> 2.48.1.windows.1
```

Host:

- Windows 10 Pro 10.0.19045, x64, build 19045.
- Intel Core i7-2600 @ 3.40 GHz, 4 cores / 8 logical processors.
- NVIDIA GeForce GTX 1050, driver `32.0.15.8142`.
- Chromium from Playwright: Chrome 151.0.7922.34.
- This is the documented target-class host, but its available RAM/driver/browser
  conditions remain the conditions of this run; no measurement below is silently
  promoted to certification where the contract says otherwise.

Repository state before handoff:

- `HEAD`, `origin/main`, and remote `main` agree at the CP22 base above.
- No files were staged, committed, or pushed.
- The candidate remains uncommitted after review repair and awaits manual validation
  before CP23 can be resumed.

## Verification matrix

| Area                              | Exact command                                                                                                                                                                                                                                                                                                                                                                                                | Result                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TDD focused RED                   | `corepack pnpm exec vitest run tests/unit/pixiCamera.test.ts tests/unit/pixiHitTesting.test.ts tests/unit/pixiSceneReconciliation.test.ts` before implementation                                                                                                                                                                                                                                             | Expected RED: 3 files failed because the three implementation modules did not yet exist.                                                                                                                    |
| Review repair RED                 | Focused hit-test Vitest plus `corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --grep "authoritative tile selection\|CSS-scaled"` before repair                                                                                                                                                                                                                                          | Expected RED: visible external port returned `null`; selected-tile canvas screenshots were identical; scaled center selected `tile:2:3` instead of `tile:12:8`.                                             |
| Manual-validation repair RED      | `corepack pnpm vitest run tests/unit/pixiCamera.test.ts` plus `corepack pnpm playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep "Shift-selected\|minimum zoom"` before repair                                                                                                                                                                                                       | Expected RED: zoomed-out horizontal pan stayed at center; Shift-add left the canvas unchanged; minimum-zoom grid-line contrast reached `0`.                                                                 |
| Owner-selection redesign RED      | `corepack pnpm vitest run tests/unit/selectionController.test.ts` plus `corepack pnpm playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep "direct clicks\|rectangular tile area"` before implementation                                                                                                                                                                              | Expected RED: 2/4 unit tests failed because rectangle selection returned no tile IDs; 2/2 Chromium tests failed because an unmodified click replaced selection and drag selected nothing on the empty grid. |
| Focused renderer unit             | `corepack pnpm vitest run tests/unit/pixiCamera.test.ts tests/unit/pixiHitTesting.test.ts tests/unit/pixiSceneReconciliation.test.ts tests/unit/selectionController.test.ts`                                                                                                                                                                                                                                 | PASS after repair: 4 files, 18 tests.                                                                                                                                                                       |
| Full unit                         | `corepack pnpm test:unit` through `corepack pnpm validate`                                                                                                                                                                                                                                                                                                                                                   | PASS after repair: 94 files, 1,577 tests in 148.63s.                                                                                                                                                        |
| Determinism                       | `corepack pnpm test:determinism`                                                                                                                                                                                                                                                                                                                                                                             | PASS after repair: 16 files, 25 tests in 136.09s.                                                                                                                                                           |
| TypeScript                        | `corepack pnpm typecheck`                                                                                                                                                                                                                                                                                                                                                                                    | PASS: `tsc --noEmit`.                                                                                                                                                                                       |
| Lint                              | `corepack pnpm lint`                                                                                                                                                                                                                                                                                                                                                                                         | PASS: ESLint with no errors.                                                                                                                                                                                |
| Formatting                        | `corepack pnpm format:check`                                                                                                                                                                                                                                                                                                                                                                                 | PASS: all files matched Prettier style.                                                                                                                                                                     |
| Content                           | `corepack pnpm content:validate`                                                                                                                                                                                                                                                                                                                                                                             | PASS: 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, 2 locales.                                                                                                                                      |
| Production build                  | `corepack pnpm build`                                                                                                                                                                                                                                                                                                                                                                                        | PASS: Vite transformed 866 modules and built the production bundle.                                                                                                                                         |
| Combined repository validation    | `corepack pnpm validate`                                                                                                                                                                                                                                                                                                                                                                                     | PASS after repair: format, lint, typecheck, content, 94 unit files / 1,577 tests, and build. Vite transformed 866 modules and emitted only its existing >500 kB chunk-size advisory.                        |
| Task23 browser                    | `corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --project=chromium`                                                                                                                                                                                                                                                                                                                    | PASS after repair: 8/8 Chromium tests in 20.1s.                                                                                                                                                             |
| Existing shell browser            | `corepack pnpm exec playwright test tests/e2e/phase0-smoke.spec.ts`                                                                                                                                                                                                                                                                                                                                          | PASS: 6/6 Chromium tests at 1920×1080, 1600×900, 1366×768, 1280×720, resize/destroy, and RO→EN.                                                                                                             |
| Combined affected browser smoke   | Task23 renderer plus Phase 0 shell cases within the complete affected matrix                                                                                                                                                                                                                                                                                                                                 | PASS after repair: 14/14 Chromium cases.                                                                                                                                                                    |
| Complete affected Chromium matrix | `corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts tests/e2e/phase0-smoke.spec.ts tests/e2e/projectionStore.spec.ts tests/e2e/persistenceControls.spec.ts tests/e2e/workerBootstrap.spec.ts tests/e2e/workerLifecycle.spec.ts tests/e2e/workerParity.spec.ts tests/e2e/workerPersistence.spec.ts tests/e2e/workerPersistenceCorruption.spec.ts tests/e2e/workerPersistenceReplay.spec.ts` | PASS after repair: 32/32 Chromium tests in 49.8s.                                                                                                                                                           |
| Pure renderer performance         | `corepack pnpm performance:pixi`                                                                                                                                                                                                                                                                                                                                                                             | PASS as an informative diagnostic; details below.                                                                                                                                                           |
| Diff hygiene                      | `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                           | PASS: no whitespace errors. Git printed only expected LF→CRLF normalization warnings for modified files.                                                                                                    |

The Task23 Chromium scenarios used real Chromium WebGL. They exercised production
Worker canvas mounting, resize, toolbar zoom/Fit/Pan, bidirectional pan at minimum zoom,
pointer drag, direct click-toggle multi-selection without a modifier, rectangular tile-area
selection, authoritative inspector-to-overlay alignment, CSS-scaled pointer conversion,
pixel-grid visibility at minimum zoom, keyboard cursor + Enter selection, teardown/reload,
and a dense owned-model fixture.
The dense fixture updated thermal values without topology recreation; diagnostics
reported 24 module creations, 7 route creations, and 0 module topology updates for
the thermal-only publication.

Screenshots captured and visually inspected:

- `test-results/task23-ordinary-1600x900.png`
- `test-results/task23-dense-1280x760.png`
- `test-results/task23-min-zoom-1600x900.png`
- `test-results/task23-multi-select-1600x900.png`
- `test-results/task23-rectangle-select-1600x900.png`

The repaired ordinary view showed the selected `tile:1:0` outline aligned with the
inspector and no obsolete static coordinate decoration. The dense view showed readable
module labels, authoritative selection outlines, ports, and power/data route layers,
without the former unconditional cursor at `tile:0:0`. The minimum-zoom view preserved
all 24×16 cell boundaries instead of merging them into larger blocks. The multi-select
view showed both `tile:3:3` and `tile:5:4` outlined after ordinary clicks while the
authoritative inspector remained focused on the primary `tile:3:3`. The rectangle view
showed all six cells in the inclusive `tile:2:2` through `tile:4:3` area outlined.

## Independent-review repairs

- The adapter now consumes the Worker-published inspector entity. Tile selection is
  rendered from that published ID; module and route selection remain sourced from their
  authoritative `GridViewModel.selected` flags. The local keyboard cursor is hidden
  until keyboard navigation starts and no longer masquerades as a selection.
- Pointer coordinates are normalized from the transformed canvas client rectangle into
  the renderer's logical CSS-pixel viewport. DPR remains confined to the backing buffer.
- Visible ports are hit-tested before an out-of-bounds pointer is rejected as an invalid
  tile, preserving external-port geometry without making external tiles selectable.
- The static `00 04 ... 24` DOM decoration and its CSS were removed without replacement.
- Local validated selected IDs are now supplied to the renderer for immediate complete
  multi-selection outlines, while the published inspector remains the authoritative
  primary selection and published module/route flags remain authoritative.
- Grid strokes use Pixi pixel lines so a one-screen-pixel boundary survives fractional
  world scaling at the `0.35` minimum zoom.
- Camera bounds preserve the centered Fit result but permit deterministic horizontal and
  vertical movement when the whole facility fits, clamped so at least one full tile
  remains visible.
- Following owner validation, pointer and keyboard selection no longer require Shift:
  each direct selection toggles membership, while an unmodified drag replaces selection
  with every tile in its inclusive rectangle in stable row-major order. The RO/EN canvas
  instructions describe this behavior. This intentionally supersedes the attached
  contract's Shift-toggle and module-only rectangle interaction for this candidate.

The first post-change `corepack pnpm typecheck` exposed `TS2345` in the new tile-selection
mapping because the mutable `currentModel` closure lost its non-null narrowing. The draw
pass now captures the accepted model in a local constant; the repeated standalone
typecheck and the complete `validate` command both passed. No test, timeout, sample count,
or threshold was weakened to resolve any failure.

## Performance measurements

Exact command:

```text
corepack pnpm performance:pixi
```

The 192-module / 64-route fixture used 80 warm-up iterations and 400 measured
iterations. Output:

```json
{
  "reconciliationMs": {
    "p50": 0.04290000000000305,
    "p95": 0.11990000000000123,
    "max": 0.39090000000001623
  },
  "hitTestMs": {
    "p50": 0.06209999999998672,
    "p95": 0.12870000000000914,
    "max": 1.208500000000015
  },
  "host": {
    "node": "v24.11.0",
    "platform": "win32",
    "arch": "x64",
    "cpu": "Intel64 Family 6 Model 42 Stepping 7, GenuineIntel"
  },
  "fixture": { "modules": 192, "routes": 64, "iterations": 400 },
  "certification": "informative host measurement; not target i7-2600/GTX1050 certification"
}
```

The unchanged repository `workerDiagnostics.spec.ts` was also executed separately as
a compatibility/performance probe. It failed without a correctness failure in the
Task23 fixture: `mainClientPublicationP95Ms=10.299999952316284` against the existing
`<5ms` budget; `foregroundCommandVisibleLatencyP95Ms=103.5` remained under its
`<200ms` budget. Its dense fixture is a standalone Worker harness, not the Pixi
renderer. The threshold and sample counts were not changed, and the miss is retained
as host evidence rather than reclassified as a pass.

The broad `corepack pnpm test:e2e` run reached all affected tests successfully, including
Worker bootstrap/lifecycle/parity/persistence, projection store, persistence controls,
the Task23 tests, and shell smoke. It also entered the historical 60-cycle persistence
soak and the unchanged Worker diagnostic; after the diagnostic miss above, the run was
stopped at soak cycle 7 because the contract explicitly says not to repeat unchanged
long suites as part of this bounded Task23 handoff. This does not replace the bounded
Task23 matrix recorded above.

## Scans and invariants

Commands:

```text
rg -n --glob '*.ts' --glob '*.tsx' "from ['\"](\.\.?/)*(app|ui|rendering|browser)|from ['\"].*/(app|ui|rendering|browser)/" src/sim
rg -n --glob '*.ts' --glob '*.tsx' "Math\.random|Date\.now|performance\.now" src/sim
rg -n "debug|__task23|__.*hook" src/rendering src/ui -g '*.ts' -g '*.tsx'
```

All three scans returned no matches. Simulator authority/import boundaries remain
unchanged; camera, hover, selection, diagnostics, and renderer resources are not
serialized into SimCore state, save data, or Replay.

## File hashes and handoff

Selected SHA-256 hashes from the candidate:

```text
src/rendering/pixi/pixiGridAdapter.ts  fb441370adc46a4b788d87589bc0ba07848875e8153bb7f14055cf0d39c190a7
src/rendering/pixi/camera.ts            4a2c9ff5614e56b4dfd7c2647a10ac026741291d54795d1aef01e3cb37fb9062
src/rendering/pixi/hitTesting.ts        b410106994adf5c9b16440f0834ebdc2ab914c868c4bd884973e96ed704552dd
src/ui/workspaces/selectionController.ts 1df9db59a55cf57ccbd0b841fe2cbd03b5a33f539784fddfb6762e2a8128ed7e
src/ui/workspaces/CenterWorkspace.tsx   913089290e057407c732105f65b19636c9981bf112b81f88954026a3bce31668
src/app/game-client/contracts.ts        56567c31d5ea36bec54adcda298989619d1d6d121c20c0d949904afc82ad8091
tests/e2e/task23-renderer.spec.ts       8e40471c074c02917cb918dc3ad1ce7ba95dbd26d119189ab16957e9dae31ca2
tests/unit/selectionController.test.ts  10f8bfe3d441174174833b6433c72f05fd8e7e45132c92215e525e45cff7ff8d
tests/unit/pixiCamera.test.ts           2b64f0914a8b06e739f38793026eaa2252c60bf4808ea692bd1fbd8a27218ac4
tests/performance/pixiRenderer.performance.ts c3153148d9d7ba1b4e5b51d6a84b6b4222bc5fd673a2e034a1cf7f34faaea4af
```

Screenshot SHA-256 hashes:

```text
test-results/task23-ordinary-1600x900.png     164164a35ab0244cac12f40b543c63cb43bd80716ae8b1f7c14d14ccce7be783
test-results/task23-dense-1280x760.png        5d3a728c43cbfae39f647056805146849e4c7c466351b3ed966c2e1d25b7b58f
test-results/task23-min-zoom-1600x900.png      e15238733f84986aa8238cd726fde329a1a9af3977c023744753ce8fead26eb2
test-results/task23-multi-select-1600x900.png  ee66d2c473da9bc37d1d14b3ca0dd4e477c3d3934b3d5dc51f7d75c8f9796a31
test-results/task23-rectangle-select-1600x900.png 42102f20ab72da8831f994db61cd64a287a65763a42f45bad263a0a01fa6cd3d
```

The complete changed-file list is preserved by `git status --short` and the working
status handoff at `docs/status/TASK_23_WORKING_STATUS.md`. Next step: owner manual
validation of the repaired candidate, followed by explicit authorization to resume
CP23. Do not stage, commit, push, or start later Phase 3 work in this candidate.

## Latest candidate verification — 2026-10-02

Owner-directed refinement: an empty-tile click (including keyboard Enter) replaces
the previous selection with one tile. Rectangle drag still selects an inclusive
area, without Shift. Existing module/route membership behavior is unchanged.
The darker blue preview stays renderer-local until mouse-up. Growing/shrinking
retains overlapping Graphics objects and adds/removes only boundary cells;
cancellation preserves the previous committed selection. Labels use actual zero-based
grid coordinates and camera transforms, with constant 12 CSS-pixel text and sparse
labels at low zoom. This replaces the previously removed static decoration without
inventing coordinates. Simulator, Worker, save, and replay contracts are unchanged.

### Identity and environment

Read-only identity checks were repeated: `git rev-parse HEAD`,
`git rev-parse origin/main`, and `git ls-remote origin refs/heads/main` all resolve to
`eb4b2b387bf9293fd6353ee4064131e3cac7ee59` (CP22). Checkout:
`D:\miscellaneous\Overclock\vertical_slice_v1`. `git status --short` confirms
only local modified/untracked candidate files, with nothing staged. No commit,
push, independent checkpoint approval, or Task 24 work was performed.

Host: Windows 10 Pro 10.0.19045 x64; i7-2600 @ 3.40 GHz, 4 cores / 8 logical
processors; GTX 1050 driver 32.0.15.8142; TotalVisibleMemorySize 16,759,236 KiB
(approximately 16 GiB, not the 8 GiB target condition); Node v24.11.0,
pnpm 11.22.0, Git 2.48.1.windows.1, Playwright Chrome 151.0.7922.34.
Performance remains informative host evidence, not target certification.

### Commands and exact outcomes

All commands below ran from the checkout above.

```text
corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep "one tile|growing and shrinking|coordinate labels"
RED before implementation: 3/3 failed as expected.
Single click: [true,true] instead of [false,true].
Area preview: [false,false,false] instead of [true,true,false].
Coordinate labels: [false,false] instead of [true,true].

corepack pnpm exec vitest run tests/unit/rectanglePreview.test.ts
RED scaffolding check before implementation: import failed because rectanglePreview.ts did not exist.
This is not represented as a behavioral identity-test failure.

corepack pnpm exec vitest run tests/unit/pixiCamera.test.ts tests/unit/pixiHitTesting.test.ts tests/unit/pixiSceneReconciliation.test.ts tests/unit/selectionController.test.ts tests/unit/rectanglePreview.test.ts
PASS: 5 files / 20 tests, 4.25s.

corepack pnpm typecheck
PASS: exit 0.

corepack pnpm validate
PASS: formatting, lint, TypeScript, content, unit tests, build; exit 0.
Unit: 95 files / 1,579 tests, 139.74s.
Content: 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, 2 locales.
Build: 868 modules, 1.55s. Existing >500 kB chunk-size advisory retained.

corepack pnpm test:determinism
PASS: 16 files / 25 tests, 124.42s; exit 0.

corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts tests/e2e/phase0-smoke.spec.ts tests/e2e/projectionStore.spec.ts tests/e2e/persistenceControls.spec.ts tests/e2e/workerBootstrap.spec.ts tests/e2e/workerLifecycle.spec.ts tests/e2e/workerParity.spec.ts tests/e2e/workerPersistence.spec.ts tests/e2e/workerPersistenceCorruption.spec.ts tests/e2e/workerPersistenceReplay.spec.ts
PASS: 35/35 Chromium tests, 50.5s, 4 workers, no retries; exit 0.
Includes 11/11 Task 23 and 6/6 shell cases (17/17 together).

corepack pnpm performance:pixi
PASS: informative CPU diagnostic, exit 0; raw values below.

git diff --check
PASS: exit 0; only expected LF-to-CRLF normalization warnings.
```

The browser matrix checks single-click replacement after rectangle selection,
darker growing/shrinking preview before mouse-up, Escape and focus-loss cancellation,
reverse/clipped-edge drags, real coordinate alignment after pan/zoom, scaled hit
testing, minimum-zoom grid visibility, dense fixture, and existing integration paths.
The unit preview regression explicitly verifies retained Graphics identities and
destruction only on removal/clear. No thresholds, timeouts, fixtures, sample counts,
or assertions were weakened.

Worker parity: tick 12,000 hash `5f0c57e688e6a693`; tick 24,000/final hash
`ff38b6a736a2ffb0`; RNG `1720442453`; queue sequence `11`; 21 trace commands,
11 receipts. The lifecycle case deliberately injects a real Worker crash and emits
a Vite unhandled-error diagnostic; the expected recovery test passed.

Scans (all returned no matches, rg exit 1):

```powershell
rg -n --glob '*.ts' --glob '*.tsx' 'from\s+["''](\.\.?/)*(app|ui|rendering|browser)(/|["''])|from\s+["''][^"'']*/(app|ui|rendering|browser)/' src/sim
rg -n --glob '*.ts' --glob '*.tsx' 'Math\.random|Date\.now|performance\.now' src/sim
rg -n 'debug|__task23|__.*hook' src/rendering src/ui -g '*.ts' -g '*.tsx'
```

The earlier unchanged-host `workerDiagnostics` publication-budget miss and interrupted
broad soak remain historical limitations, not silently repaired or promoted to PASS.
They were not rerun as part of this bounded selection/coordinate repair. No new failure
remained in the affected gates above.

### Performance output

80 warm-up iterations and 400 measured iterations; the preview CPU measurement is
not end-to-end frame time or GPU certification. This run overlapped repository
validation activity. Fixture/sample counts and existing criteria were preserved.

```json
{
  "measurement": "Task 23 scene, hit-test and Pixi preview CPU diagnostics (no GPU rendering)",
  "host": {
    "node": "v24.11.0",
    "platform": "win32",
    "arch": "x64",
    "cpu": "Intel64 Family 6 Model 42 Stepping 7, GenuineIntel"
  },
  "fixture": {
    "modules": 192,
    "routes": 64,
    "iterations": 400,
    "previewCells": 384,
    "previewBoundaryCells": 16
  },
  "camera": { "zoom": 1.3125, "centerWorld": { "x": 384, "y": 256 } },
  "reconciliationMs": {
    "p50": 0.045200000000022555,
    "p95": 0.08010000000012951,
    "max": 0.914600000000064
  },
  "hitTestMs": {
    "p50": 0.05559999999991305,
    "p95": 0.09829999999988104,
    "max": 0.37750000000005457
  },
  "previewStableMs": {
    "p50": 0.049900000000207,
    "p95": 0.09040000000004511,
    "max": 0.6223999999999705
  },
  "previewBoundaryMs": {
    "p50": 0.24520000000006803,
    "p95": 0.4839999999999236,
    "max": 1.227200000000039
  },
  "certification": "informative host measurement; not target i7-2600/GTX1050 certification"
}
```

### Current screenshots and hashes

The seven screenshots below were captured and visually inspected: ordinary/dense
layout, unmerged minimum-zoom grid, single selected tile, committed rectangle, darker
area preview alongside the prior selection, and coordinates following pan/zoom.
The earlier multi-select screenshot/hash above is historical; Playwright regenerated
`test-results`, and the current single-select screenshot replaces that scenario.

SHA-256 (`Get-FileHash -Algorithm SHA256`):

```text
src/rendering/pixi/pixiGridAdapter.ts a4d864858349c91978540a198ebd85a88da20262b9f8c9904b1003df7d7bfd76
src/rendering/pixi/rectanglePreview.ts 383c349129f2836ade93ae7bd63619bea7c6ade0fe38d66cc3f51f5e4f763ea7
src/rendering/pixi/gridCoordinates.ts c4e5e1457c3ec995ddc51fd4e25abc1980a2eef00c401dc76d4bc29e23671633
tests/unit/rectanglePreview.test.ts 2e054a9b898e0f8977f74b32d2d967d1f950919219d0d9e5f96cb45a45796e80
tests/e2e/task23-renderer.spec.ts e7acfcaff08de3b1c36031f8d538731740601f8aaa8c608060ea92a6260b7123
tests/performance/pixiRenderer.performance.ts 0b41d1c6c1394598636790cdf876a876a32d719ccd35194ee6d35972684f11c4
content/en/common.json f0be6613b7acaea4ccd789b30bab986bf2c5726de5c5cac910f19fc904b91b60
content/ro/common.json b68c36f8a5e7c82ac21c27510568a3bac46f61a7bb50cc11bb285eae4280f7ac
docs/decisions/ADR-0030_BUILD_WORKSPACE_OWNERSHIP_AND_INTERACTIONS.md 3635abe32b457c90c0cfd877e941f9fb152c019074fe5db13fc202ffb3314df1
test-results/task23-ordinary-1600x900.png 42b819eafb5d984d6cd163e11703dd14c1951316e870ad9bc6440f1fb3a14fb1
test-results/task23-dense-1280x760.png ea3f48e37347c970238dcf7a4ce630187a438e3283e476dc524bc79af1b5afc6
test-results/task23-min-zoom-1600x900.png 7e8c61769ba3c32a7d8468fd467dbe2315aef27edc050788afbb9af13774409c
test-results/task23-single-select-1600x900.png 415fc2b978ba9e8fa59fc7fa9be60bb862fff358b3dc1e756e11f2017398d298
test-results/task23-rectangle-select-1600x900.png 0e93c0edd9e87ec62bb50bbf586397bec94b503c144b29e60b5791b5b8e57fdd
test-results/task23-area-preview-1600x900.png 958c2924124c701358b5ea553827955c91ba803ff2e67ca86e46c3f8d5feb518
test-results/task23-coordinates-1600x900.png fe8e43e758f07312ffdddb13399e71d3cb0448323fd9216caa471fb6604ff6d1
```

Candidate remains unstaged/uncommitted for owner testing and later independent CP23.

## CP23 review and final owner display refinement — 2026-10-02

The owner manually approved the previous interactions and requested one-based grid
labels plus a real zoom percentage to the right of `+`, then authorized CP23 under
the adopted prompt. Both display refinements are implemented; inspector titles
match the labels, while internal IDs, coordinates, saves, and Replay remain zero-based.
Counter updates consume typed camera intents, not simulated data or a fixed label.

**Disposition: BLOCKED, not READY.** The independent reviewer established seven
Important findings; narrow main-agent corrections plus actual regressions closed
recreation-baseline loss and owned Graphics-context cleanup. A further partial-init
cleanup defect was reproduced and corrected. Five Important findings remain open:
unnecessary thermal redraws/undercounted work; competing DOM/canvas selection owners;
Draft badge over Live physical facts; missing twelve localized module visual designs;
and unapplied persisted frame cap. Exact sources, reproduction classification, and
required corrections are in `docs/diagnostics/PHASE_3_TASK_23_CP23_REVIEW.md`.
Green gates below do not override those findings.

### Identity, environment, commands and results

Environment is the same documented Windows 10 / i7-2600 / GTX 1050 / approximately
16 GiB / Chrome 151 host; Node v24.11.0, pnpm 11.22.0, Git 2.48.1.windows.1.
Fresh preflight: `git fetch origin`; `git rev-parse HEAD origin/main`;
`git ls-remote origin refs/heads/main`; `git rev-list --left-right --count HEAD...origin/main`;
`git merge-base --is-ancestor f982c7d HEAD`. All succeeded; HEAD/tracking/remote main
are `eb4b2b387bf9293fd6353ee4064131e3cac7ee59`, divergence 0/0, repaired ancestor present.
`git diff --cached --name-only` is empty. No files were staged, committed, or pushed.
Temporary handoff/plan files remain because the checkpoint failed; this verification
artifact is preserved as explicitly requested.

```text
corepack pnpm exec vitest run tests/unit/gridCoordinates.test.ts
RED: expected first label "1", received "0" (before display change).

corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep 'reports the actual camera zoom'
RED: Zoom output was absent (before implementation).
GREEN: 1/1 passed, 9.9s. Actual 100%,120%,keyboard100%,wheel86%,minimum35%,Fit and reload100%; first tile displays tile:1:1.

corepack pnpm exec vitest run tests/unit/gridCoordinates.test.ts tests/unit/rectanglePreview.test.ts tests/unit/pixiCamera.test.ts tests/unit/pixiHitTesting.test.ts tests/unit/pixiSceneReconciliation.test.ts tests/unit/selectionController.test.ts
PASS: 6 files / 21 tests, 6.64s.

corepack pnpm test
PASS in one fresh process: 96 unit files / 1,580 tests, 235.96s;
then 16 determinism files / 25 tests, 157.40s; exit 0.
This full core run preceded the narrow initialization/recreation/context-cleanup corrections.
Those corrections change presentation lifecycle only; their affected real-browser regressions were rerun afterward.

corepack pnpm content:validate
PASS: 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, 2 locales; exit 0.

corepack pnpm build
PASS after lifecycle corrections: strict TypeScript plus 868 transformed modules, 924ms Vite build; exit 0.
Existing >500kB advisory retained. The later runtime-erased type annotations do not change emitted behavior.

corepack pnpm typecheck
PASS: exit 0 after the lifecycle/display corrections.

corepack pnpm format:check
PASS: exit 0 after corrected source/test formatting.
The repository .prettierignore excludes docs/content; explicit touched-doc/content formatting is recorded separately.

corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts tests/e2e/phase0-smoke.spec.ts tests/e2e/projectionStore.spec.ts tests/e2e/persistenceControls.spec.ts tests/e2e/workerBootstrap.spec.ts tests/e2e/workerLifecycle.spec.ts tests/e2e/workerParity.spec.ts tests/e2e/workerPersistence.spec.ts tests/e2e/workerPersistenceCorruption.spec.ts tests/e2e/workerPersistenceReplay.spec.ts
Initial display candidate: PASS 36/36, 1.4m.
After three narrow lifecycle corrections: PASS 38/38, 1.1m, 4 workers, no retries; exit 0.
Includes 14 Task23 and 6 shell cases; no unchanged 60-minute soak rerun.

corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep 'real Pixi resources|dense owned-model|renderer initialization fails'
PASS: 3/3, 9.1s, after actual RED reproductions and corrections.

corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep 'real Pixi resources|dense owned-model|renderer initialization fails|reports the actual camera zoom' --output=test-results/task23-final-spotchecks
Final spotcheck: 3 PASS / 1 FAIL, 14.2s. Dense fixture captured before init finished under concurrent lint; canvas was null.
Replaced its fixed 600ms pre-init sleep with actual ready-state observation under the existing test timeout; assertions unchanged.

corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts --project=chromium --grep 'dense owned-model' --output=test-results/task23-dense-ready-spotcheck
PASS: 1/1, 6.7s, after condition-based fixture correction.

git diff --check
PASS: exit 0, only expected LF-to-CRLF warnings.
```

Worker parity remains tick12000 `5f0c57e688e6a693`, tick24000/final
`ff38b6a736a2ffb0`, RNG `1720442453`, queue sequence 11, 21 trace commands / 11
receipts. The expected injected Worker-crash diagnostic still belongs to its passing
lifecycle test. Existing frozen compatibility vectors were not edited.

### Preserved failures and correction evidence

- Lint initially rejected optional-chain style and a type-only import. The first
  correction passed full lint. Later lifecycle tests exposed six lint errors
  (a runtime-before-init guard over Pixi's post-init required type, intentionally
  unbound methods in test instrumentation, and void-return arrows). Those were
  corrected without relaxing rules; an intermediate `this: void` method annotation
  was itself rejected and replaced by a function-property type. Final lint results
  are recorded in the final hygiene addendum.
- The WebGL-only failure fixture failed its assertion because Pixi legally fell
  back to another renderer (ready, no page error). It was not true fault RED.
  With GPU plus all canvas contexts unavailable, the original code reproducibly
  emitted `TypeError: this._cancelResize is not a function` and never published error
  status. Safe partial cleanup is GREEN and saving remains operational.
- The independent reviewer used actual installed Pixi in an isolated Chromium
  harness to reproduce recreation loss, retained Graphics contexts, and unnecessary
  thermal redraws. The other integration/deliverable findings were source-traced,
  not independently executed shell scenarios; the review report says so explicitly.
- Main nonempty retry RED: cumulative module creation remained 24, expected 48.
  Resetting the disposed keyed baseline gives 48 modules / 14 routes after retry.
- Main real-Pixi context RED: 60 contexts remained alive across twenty ready/destroy
  cycles. Explicit owned-context cleanup gives zero. A first instrumentation attempt
  imported a second unversioned Vite Pixi module and failed with duplicate extension
  registration; it was fixed to reuse the already-loaded versioned module URL before
  true behavior RED. No production test hook was introduced.
- Five Important findings remain open; no new exception was requested or inferred.
  Earlier unchanged-host diagnostics misses/interrupted soak remain historical,
  not waived correctness defects or new target certification.

### Diagnostics, scans and visual evidence

`corepack pnpm performance:pixi` passed as an informative CPU-only diagnostic on
the same host, unchanged 80 warm-up / 400 measured cohort, 192 modules / 64 routes,
384 preview cells / 16 boundary cells, camera zoom1.3125 center(384,256):

| CPU diagnostic      |              p50 ms |              p95 ms |             max ms |
| ------------------- | ------------------: | ------------------: | -----------------: |
| Pure reconciliation | 0.04580000000032669 | 0.10469999999986612 | 0.7276999999999134 |
| Hit test            | 0.06059999999979482 | 0.13700000000017099 | 0.6946000000002641 |
| Preview unchanged   | 0.05249999999978172 | 0.11910000000034415 |   1.19399999999996 |
| Preview boundary    |  0.2594000000003689 |  0.6390999999998712 | 3.3961999999996806 |

These are not actual adapter-update/render-submission costs, GPU timings, or Task28
target certification. That evidence gap is part of open F1; no improvement is claimed.
Projection data paths were unchanged, so its unchanged diagnostic was not repeated.

Simulator forbidden import/time scans recorded earlier were repeated with no matches;
production app/rendering/UI scans for devtools/manual-harness/test hooks returned no
matches. The emitted-bundle scan below returned no matches after the production build:

```powershell
rg -n '(devtools|manual-harness|workerTestHarness|__workerTest|__task23|/tests/)' src/app src/rendering src/ui -g '*.ts' -g '*.tsx'
rg -n 'workerTestHarness|manual-harness|__workerTestResult|__task23|Injected real Worker' dist
git diff --name-only -- content/modules content/tasks content/research content/benchmarks docs/GDD.md pnpm-lock.yaml '*.docx'
```

No gameplay numeric content, balancing, GDD, lockfile, or Word drift was present.
Only RO/EN presentation keys changed. Simulator, save, Worker, and game-client
implementation paths remained unchanged; camera timing/selection stay outside
state/RNG/Replay. Some exploratory scans referenced nonexistent guessed entry/save
paths; those errors were not accepted as scan passes, and actual paths were located
and checked before handoff.

Current captures: Windows10/Chromium151/RO, ordinary1600x900, dense1280x760,
minimumzoom/single/rectangle/preview/coordinates1600x900, renderer-error plus successful
save1600x900. The regenerated images were directly inspected, not masked or approved
solely from DOM assertions. All-twelve localized visuals and their RO/EN review remain
missing under open F4; the shell's existing RO-to-EN browser test is not that evidence.

SHA256 (`Get-FileHash -Algorithm SHA256`), latest selected source and screenshot values:

```text
src/rendering/pixi/pixiGridAdapter.ts 0db4b4889d14d7986962a5679474c67ec7721b20cc44fccab27fbdd555885491
src/rendering/pixi/gridCoordinates.ts 1854b94c19528d19bff8a6c3d381ffeb57f3477a0fd891ddd25ba7ba8763d4b0
src/ui/workspaces/CenterWorkspace.tsx 0d0137aafd19015c42e65a03a5acb3cad8cb2aecfb7599accd71054204846659
src/ui/layout/OperationsStack.tsx 2c188884fe65b0ded59ef8307616e536fe01b7ff242e620f0bbf4367088eb0d6
tests/unit/gridCoordinates.test.ts de37fa889453806237cf9b272b8b3d9e8942ff5ba9db9d9c345333781f5fb9e4
tests/e2e/task23-renderer.spec.ts 162ccc9a6c0caa87c1a117d9cbf0eb55de52242354d7e7d7dff9ce52ed2307a9
content/en/common.json 0a423b744edf53d7a1acbf7fe03ef8def5be0132fea54f1ef9da6981e883e7d4
content/ro/common.json e66da1996710d0a95da7da7a9a0af1de211deb28888d71154c6a8c48fc7dc626
test-results/task23-ordinary-1600x900.png be12fec548d5a08dd841abc16d3939c94b34930989edbe0a6da64964ed503040
test-results/task23-dense-1280x760.png 9cb33e89554131b0e01f381b833b8a7977b705c23e3aaf1149cec52e0eb3e696
test-results/task23-min-zoom-1600x900.png 91d1dcadb6782f9b45d26c4a6026c82658f6639836f7ca73b756ccc7d30691bf
test-results/task23-single-select-1600x900.png 68f4ffb0cdc3b6c59afe46074129e3dcd4f0893f85722d2343ddc8087711e5ff
test-results/task23-rectangle-select-1600x900.png 79a3c3c56c66f5b5068e2bdea5d7911096f80eebf458e66b071d706cad00a832
test-results/task23-area-preview-1600x900.png ff763618df6689b1f80a119f1c08f1ec367309f36dbe6ce82b36f87f5c39801b
test-results/task23-coordinates-1600x900.png 7c07f62893683096720ca5c2b2a3a4c0bb93a85e8b616a7d79e4c42cb8f86020
test-results/task23-renderer-error-1600x900.png 2673d57a6b4e91dc7d07adbf0907e32f33efe1367685fc1d9c38bb522ad53692
```

Source byte hashes identify the blocked candidate, not an approved staged tree.
No final staged smoke or commit/push was attempted because checkpoint conditions fail.

### Final hygiene addendum — 2026-10-02

After the final test-only factory type annotation, full `corepack pnpm lint`
completed with exit 0. Targeted lint also completed with exit 0:

```powershell
corepack pnpm exec eslint src/rendering/pixi/pixiGridAdapter.ts tests/e2e/task23-renderer.spec.ts tests/unit/gridCoordinates.test.ts
```

The ordinary, dense, minimum-zoom, single-selection, rectangle-selection, preview,
coordinate and recoverable-renderer-error captures listed above have all been
directly inspected. Single selection shows one tile aligned with its one-based
inspector title; rectangle selection shows the expected contiguous six tiles.
Screenshot and source hashes above remain the final selected candidate hashes.
Localization hashes reflect explicit Prettier normalization, not numeric content
changes. Documentation and localization are ignored by the default formatting
gate, so the touched files are additionally checked with `--ignore-path NUL`.

Final commands and exact outcomes after the last test-only edit:

```text
corepack pnpm typecheck
PASS: tsc --noEmit, exit 0.
corepack pnpm lint
PASS: eslint ., exit 0.
corepack pnpm format:check
PASS: All matched files use Prettier code style!, exit 0.
corepack pnpm exec prettier --check --ignore-path NUL TASK_23_VERIFICATION.md docs/diagnostics/PHASE_3_TASK_23_CP23_REVIEW.md docs/status/TASK_23_WORKING_STATUS.md docs/status/PROJECT_STATUS.md docs/decisions/ADR-0030_BUILD_WORKSPACE_OWNERSHIP_AND_INTERACTIONS.md content/en/common.json content/ro/common.json
PASS: All matched files use Prettier code style!, exit 0.
git diff --check
PASS: exit 0; only LF-to-CRLF advisory warnings.
git diff --cached --name-only
Empty output: nothing staged.
git rev-parse HEAD origin/main
Both: eb4b2b387bf9293fd6353ee4064131e3cac7ee59.
Get-FileHash content/en/common.json,content/ro/common.json,tests/e2e/task23-renderer.spec.ts,src/rendering/pixi/pixiGridAdapter.ts -Algorithm SHA256
All four match the selected final hashes recorded above.
```

Disposition remains **CP23 BLOCKED**: five Important findings remain open. The
index is empty, HEAD remains CP22, and no Task 24 work or publication is authorized
by this failed checkpoint. Passing bounded gates does not override those findings.

## Latest CP23 verification — 2026-10-04

This section supersedes all earlier candidate-ready/blocked dispositions and
hashes. Historical failures above are retained. The owner authorized resolving
Task 23 and completing CP23 commit/push, not Task 24. The conditional publication
subject is `feat: render interactive facility canvas`; its identity/parent and
remote synchronization are verified from Git after publication, not guessed here.

### Base, environment and review scope

Checkout: `D:\miscellaneous\Overclock\vertical_slice_v1`, ordinary `main`.
Fresh `git fetch origin`, `git rev-parse HEAD origin/main` and
`git ls-remote origin refs/heads/main` all identify TASK_23_BASE:
`eb4b2b387bf9293fd6353ee4064131e3cac7ee59`.
`git merge-base --is-ancestor f982c7dbec5f7f444988eb7130b1db3ee7803dfb HEAD`
exited 0. Repaired malformed-UTF16 save admission and quarantined corrupt-generation
rotation remain present in the unchanged codec and Worker persistence source.

Windows 10 Pro 10.0.19045/build 19045 x64; i7-2600 @ 3.40 GHz, 4 cores/8 logical
processors; RAM 17,161,457,664 bytes (~15.98 GiB); GTX 1050 2 GiB, driver
32.0.15.8142. Node v24.11.0, pnpm 11.22.0, Git 2.48.1.windows.1; Chromium
151.0.7922.34; Pixi 8.19.0, React 19.2.8, Vite 8.2.1. The extra RAM relative to
the 8 GiB target and renderer-fixture limitations prevent target certification.

A fresh independent read-only reviewer inspected the entire tracked/untracked
Task 23 diff and neighboring Worker/store/projector/persistence APIs. It performed
no repository or Git writes. The five historical Important findings were corrected:
retained keyed dirty resources; one shared selection controller; geometry versus
Live physical provenance/tick with unknown capacity kept unavailable; twelve
localized primitive module identities; and persisted 30/45/60 presentation caps.
Further disconnect/clock rejection and same-epoch resync findings were reproduced
and corrected. Full-browser persistence regressions were also repaired without
changing their existing tests. Final evidence review follows the recorded gates;
test counts alone do not establish closure.

The reviewer's final post-extraction source verdict found no Critical/Important
issue. A subsequent evidence-only follow-up did not complete (reviewer execution
service usage-limit error); no independent final-documentation approval is
fabricated. The checkpoint executor checked the final artifact against actual
outputs, opened all selected images and verified all 54 recorded source/screenshot
hashes (36 source/test/localization/package, 18 screenshots; zero mismatches).

### Fresh core and browser gates

```text
corepack pnpm test
Final unit: PASS, 97 files / 1593 tests, 198.12s.
Final determinism: PASS, 16 files / 25 tests, 158.02s; complete command exit 0.
corepack pnpm lint
PASS, exit 0 after the client-scoped admitted-reader extraction.
corepack pnpm typecheck
PASS, tsc --noEmit, exit 0 after that extraction.
corepack pnpm content:validate
PASS, 12 modules / 8 tasks / 10 research nodes / 2 benchmarks / 2 locales, exit 0.
corepack pnpm build
PASS, 869 modules, 901ms, exit 0 after the Pan-tool correction.
Existing >500 kB chunk advisory retained:
Worker 606.79 kB; main 540.63 kB (gzip 159.05 kB).
corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts tests/e2e/task23-selection-inspector.spec.ts tests/e2e/task23-dirty-updates.spec.ts tests/e2e/task23-frame-cap.spec.ts tests/e2e/task23-settings.spec.ts tests/e2e/task23-visuals.spec.ts tests/e2e/phase0-smoke.spec.ts tests/e2e/projectionStore.spec.ts tests/e2e/persistenceControls.spec.ts tests/e2e/workerBootstrap.spec.ts tests/e2e/workerLifecycle.spec.ts tests/e2e/workerParity.spec.ts tests/e2e/workerPersistence.spec.ts tests/e2e/workerPersistenceCorruption.spec.ts tests/e2e/workerPersistenceReplay.spec.ts --workers=1 --output=test-results/cp23-tool-final
PASS, 53/53 Chromium tests, 3.7m, including the added Pan replacement regression.
corepack pnpm exec playwright test tests/e2e/persistenceControls.spec.ts tests/e2e/task23-selection-inspector.spec.ts tests/e2e/task23-settings.spec.ts --workers=1 --output=test-results/cp23-final-reader
PASS, 12/12, 1.6m, after the final AppShell helper extraction.
```

The matrix includes lifecycle/init rejection/obsolete completion, context loss/
recreation, retained identity/dirty updates, hidden/dispose scheduling, 30/45/60
cadence, persisted/imported settings, camera/pan/fractional zoom, CSS scaling/DPR,
visible external ports, authoritative tile/rectangle selection, incremental preview
and cancellation, real Worker DOM/canvas inspector/source truth, removal/replacement/
fatal/full-resync, ordinary/identity screenshots, existing projection/persistence
controls, Worker ACK/lifecycle/parity and durable corruption/replay recovery.
The unchanged 60-minute soak was not repeated, as CP23 explicitly requires the
relevant lifecycle/fault cases rather than a soak at every checkpoint.

Exact Worker parity on the corrected full matrix:
21 trace commands, 11 queued receipts, queue sequence 11;
tick 12000/year 1947 hash `5f0c57e688e6a693`;
tick 24000/year 1948/final hash `ff38b6a736a2ffb0`;
RNG `1720442453` at both observations.
The actual production-Worker manual-save selection witness has identical before/
after simulation hash `f6973bc9e8dfb73f` and RNG `156228482`. The earlier cohort's
equal before/after hash was `5573eb152618b433`; this real-time fixture pauses at
an observed tick >=30 (latest screenshot tick 30, earlier tick 31), so it is an
intra-cohort equality witness, not a fixed-tick cross-run golden. UI selection,
camera, presentation clock and renderer caches do not enter GameState/Replay/save
vectors. The fresh determinism suite includes the existing exact compatibility
fixtures; no expected vector, gameplay formula or threshold was changed.

### Measured rendering and input diagnostics

```text
corepack pnpm exec playwright test tests/e2e/task23-renderer-performance.spec.ts --workers=1 --output=test-results/cp23-hardware-performance
PASS, 1/1, 16.9s total (12.2s test), 80 warm-up / 400 measured frames.
1920x1080 / DPR 1; actual foreground adapter RAF/WebGL CPU submission.
Accepted Phase 2 thermal fixture projected for this diagnostic:
24x16, 110 mixed modules, 112 routes, 300 occupied tiles, 384 nonuniform heat cells.
Explicit Windows --use-angle=d3d11; unmasked GPU:
ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C81) Direct3D11 vs_5_0 ps_5_0, D3D11)

updateMs:
p50 1; p95 1.4000000953674316; max 1.9000000953674316.
renderSubmissionMs:
p50 3.0999999046325684; p95 4.5; max 5.1000001430511475.
pointerCallbackMs:
p50 0.5; p95 0.7000000476837158; max 0.9000000953674316.
Actual diagnostics:
moduleCreated 110; moduleUpdated 0; moduleRemoved 0;
routeCreated 112; routeUpdated 0; routeRemoved 0;
gridUpdated 1; portsUpdated 1; selectionUpdated 1;
heatCellsUpdated 864; renderCount 480;
initialized true; liveCanvas 1; listeners 11; cachedTexture 0; frameCap 60.

corepack pnpm performance:pixi
PASS diagnostic, 80 warm-up / 400 samples:
synthetic 192 modules, 64 routes, 384 preview cells / 16 entering boundary cells;
1280x720, camera zoom 1.3125.
reconcile: p50 0.04380000000014661; p95 0.09049999999979264; max 0.7814999999998236 ms.
hit: p50 0.05039999999985412; p95 0.11549999999988358; max 0.7539999999999054 ms.
stablePreview: p50 0.04909999999995307; p95 0.08829999999989013; max 0.6539000000000215 ms.
boundaryPreview: p50 0.23739999999997963; p95 0.46050000000013824; max 1.2109000000000378 ms.
```

Separate percentiles are not summed into a fabricated frame p95. CPU WebGL
submission is not GPU execution time; the pointer callback is not end-to-end
Worker publication latency. Pure reconciliation is not actual rendering.
Task 23 explicitly makes these diagnostic measurements: the audited Task 28
mixed Power/Data Task/Research/Boost/Benchmark fixture, 300/3000 frame budgets,
60-second telemetry, 8 GiB hardware certification and final soak are not claimed.
Projection/store algorithms were unchanged, so their diagnostic was not rerun;
historical projection exceptions are not new renderer waivers.

### Failures and corrections retained

- F1 actual Pixi child-identity RED: unchanged publication recreated module
  children. GREEN asserts retained children and actual dirty counters; heat
  updates touch only the changed cell. F5 controlled 120 Hz input RED produced
  120 renders instead of <=31 at 30 FPS; GREEN covers 30/45/60 plus hidden/resume/
  disposal. Stored-30-FPS shell RED rendered at unrestricted cadence; GREEN uses
  persisted and explicitly imported session metadata without simulation changes.
- Disconnect unit RED retained module membership; actual shell RED kept route
  controls enabled after Worker failure and exposed unhandled clock rejection.
  Connection guards/reset and caught transport promises corrected those paths.
- Same-epoch resync unit RED did not submit the clearing context. GREEN covers
  both degraded and resync-required transitions. Two first browser probe fixtures
  produced no publication (transition list empty), so were not accepted as RED
  evidence; the final real Worker fixture injects one stale protocol publication,
  requests actual full resync, then verifies empty module/route flags and null
  inspector before a new selection succeeds.
- Complete first browser matrix: 50/52 PASS, 2 persistence-control failures
  (3.5m). Temporary null snapshot during load unmounted the drawer and lost
  recovery/status. Existing tests were unchanged; retained immutable admitted
  readouts corrected it. Isolated cases passed 2/2 (14.0s), then the complete
  corrected matrix passed 52/52. Final lint rejected inline mutated local readers
  in React useMemo (3 react-hooks/immutability errors); the equivalent external-
  store reader factory was extracted outside render, without suppressions.
  Fresh lint/TypeScript/build and all 12 affected shell cases then passed.
  The repository formatting gate next reported one fixture whitespace warning;
  Prettier normalized task23ShellHarness.tsx without semantic changes, then the
  full repository format check passed. Final staged smoke covers that fixture.
- Earlier focused eslint instrumentation/type/prototype issues were corrected,
  not disabled. The preview-context disposal probe passed first try: no source
  leak fix or false RED claim is made for that suspicion.
- Default-headless exploratory performance runs timed out at the unchanged
  30-second limit, including synchronous 480-update bursts and a foreground
  scheduling probe. Progress probing located software/GL context loss overhead.
  A temporary teardown probe also threw on a null label; it was corrected and
  removed. No temporary instrumentation is shipped. The accepted diagnostic
  measures foreground adapter work on explicitly identified GTX 1050 D3D11,
  not a timeout-to-pass claim for the default software-rendering environment.
  Neither timeout, cohort, fixture size, assertions nor performance limits were
  weakened. Public bounded-primitive batching reduced actual submission work.
  The earlier isolated D3D11 run also passed (16.3s total / 11.7s test): update
  p50/p95/max 0.7999999523162842/1.2000000476837158/2 ms; submission
  2.3999998569488525/3.700000047683716/5 ms; callback
  0.39999985694885254/0.6000001430511475/1.1000001430511475 ms.
  The fresh run recorded above is the latest result, not the fastest selected run.
- Direct inspection found the first synthetic gallery occluded by the persistence
  drawer. Only the test-host layer was corrected; all eight fresh final galleries
  were reopened and reviewed without occlusion. Earlier occluded captures are not
  accepted as visual proof.
- Initial simulator scan matched the word "window" in a service-window error
  message, not a forbidden browser API. The precise API/import scan below has no
  matches. LF-to-CRLF advisories and the build chunk-size advisory remain visible.
- Final source tracing found the Pan button retained across client replacement,
  while the recreated adapter defaulted to Select. Exact production-Worker RED:
  aria-pressed Pan stayed true but a drag published tile:12:8, tile:12:9,
  tile:13:8, tile:13:9, tile:14:8, tile:14:9. The effect now reapplies the one
  local tool state on tool/client/controller changes; toolbar callbacks only set
  that state. Dedicated regression RED 1/1 failed (11.1s test), GREEN 1/1 passed
  (10.9s total / 7.3s test), then complete 53/53 passed (3.7m). It asserts a new
  canvas, pressed Pan, moved canvas pixels, no selection context and null inspector.
  A new lint error flagged a statically unreachable elementHandle null branch;
  removing that dead branch preserved all meaningful assertions. Fresh complete
  core and lint/TypeScript/content/build passed on the corrected source. The final
  staged smoke covers the post-lint test bytes. No renderer/measurement code changed.
  A subsequent targeted independent source review completed and closed this last
  blocker: effect order, retained mode, async initialization and gesture cancellation
  were traced; the reviewer found no Critical/Important issue and made no edits.
  Its earlier evidence-only documentation follow-up limitation remains historical
  and is not confused with this completed final source review.
- Prior pre-Pan gates remain valid historical passes, not final-byte claims:
  complete core 97/1593 at 179.48s and 16/25 at 132.65s; corrected browser 52/52
  at 3.4m; staged pnpm validate 97/1593 at 147.91s and 869-module build at 833ms;
  separate staged determinism 16/25 at 144.57s. The first staged allowlist checker
  falsely reported a mismatch because JavaScript ordinal and PowerShell culture
  sort orders differed. Exact ordinal HashSet membership then proved 45/45 paths,
  zero unexpected paths, zero unstaged/untracked files; no file was dropped to pass.

### Scans, ownership and documentation

```powershell
git diff --name-only -- src/sim src/save src/grid/domain content/modules.json content/balancing.json pnpm-lock.yaml '*.docx'
# Empty: no gameplay/save/domain/lockfile/Word drift.
rg -n 'Math\.random|Date\.now|performance\.now|globalThis\.(window|document)|\b(window|document)\.|from ["\x27](react|pixi\.js)' src/sim
# No matches, rg exit 1.
rg -n '__task23|task23ShellHarness|Injected real Worker|resyncSelection' src
# No matches, rg exit 1.
rg -n '__task23|task23ShellHarness|Injected real Worker|resyncSelection' dist
# No matches, rg exit 1.
git diff --check
# PASS, exit 0 (only Git line-ending advisories).
```

Renderer imports consume owned read models and presentation time only. Shared
selection is private UI intent with bounded Worker context publication; dirty
scene signatures never become authoritative caches. All test hooks remain under
tests/e2e/fixtures. The production bundle has no test harness or injected failure.
Localization adds names/UI strings only; no numeric content changes. Explicit
Prettier normalization may alter byte hashes/Markdown table spacing but not
gameplay contracts; source hashes below identify the selected bytes.

Useful temporary Task 23 handoff/plan content is consolidated into permanent
rendering diagnostics, ADR-0030, TDD, Phase 3 status and visual review. The two
temporary files were removed with apply_patch; this verification file and the
historical CP23 findings remain preserved. Permanent docs describe completed
behavior and explicitly exclude Task 24, later routing/Blueprint/heatmap tools,
Task 28 certification and Phase 4.

### Direct visual evidence and SHA-256

All eighteen selected images were opened directly, with bounded findings recorded
in `docs/diagnostics/PHASE_3_VISUAL_REVIEW.md`. RO/EN galleries cover twelve
identities at 0/90 degrees and 1920x1080, 1600x900, 1366x768, 1280x720.
Ordinary/selection/preview/coordinates/minimum-zoom/error captures are 1600x900;
dense renderer-only fixture is 1280x760. Nonempty real Worker shell RO/EN is
1600x900. Gallery/dense/performance fixtures are explicitly distinguished from
gameplay-valid Worker evidence and Task 28 target acceptance.
Screenshots are ignored runtime artifacts, retained at the absolute checkout path
above and reproducible with the recorded browser commands. Their byte hashes:

```text
test-results/task23-area-preview-1600x900.png 05548aa9b5a950a96e8af7a8a40b35f31acde91e8dd73647dff3fe727518fa54
test-results/task23-coordinates-1600x900.png 7c07f62893683096720ca5c2b2a3a4c0bb93a85e8b616a7d79e4c42cb8f86020
test-results/task23-dense-1280x760.png 3c8a361399b39941722b68f0173450012aff833cf7c332764098d0e977005d43
test-results/task23-identities-en-1280x720.png ab41b6215c7b9bb9d306f1e42dcc0df34020e7e5cf1fc9b509173c9571466354
test-results/task23-identities-en-1366x768.png ee06b70f57cf4b32c743793bcf7a0a64f426bdda532422002fb967d852f8c40a
test-results/task23-identities-en-1600x900.png 3e4301f75ac225863649eaf042f4c2a601d5b3cc661aba46aa9ba028682ef380
test-results/task23-identities-en-1920x1080.png e5c673c6ad9b219833fe264c89ebda16759c314536f1be18d87f76f08e9e8423
test-results/task23-identities-ro-1280x720.png 6bea36277b878e3c83d31802c45d3955033f2f71b5df17fca96f662534bd8831
test-results/task23-identities-ro-1366x768.png 8c0c749db4c7b0866b81f1244a04e7fd979778fcba5bcf069ec384cd9f795579
test-results/task23-identities-ro-1600x900.png 9b9c3861d4cb2730ed28392394990482aba8b971a6886ef8470d9ade8088150c
test-results/task23-identities-ro-1920x1080.png b21f4f2945cf1ddf8213d5f8614d5d588169aaa95029b171c87366da663820cf
test-results/task23-min-zoom-1600x900.png 91d1dcadb6782f9b45d26c4a6026c82658f6639836f7ca73b756ccc7d30691bf
test-results/task23-ordinary-1600x900.png 904b90db0485a7d16a50c486bac05b2ff2c0db351ce240dfa43d4a3fdc8fd14d
test-results/task23-rectangle-select-1600x900.png 4f4f90948c217e175824d66053c604cdbe085739731ac4a903a5c63c4bbdd3d6
test-results/task23-renderer-error-1600x900.png 2673d57a6b4e91dc7d07adbf0907e32f33efe1367685fc1d9c38bb522ad53692
test-results/task23-single-select-1600x900.png 06247c8d58c5ef6d0e27ee9c57a77a58932353dfdedd366cdd4b73a1f4c4fbd4
test-results/task23-worker-shell-en-1600x900.png 5c4dded93a6adabb13c2f8f00d9662a420edbebf5ab21d7506ff8e29f5b2e928
test-results/task23-worker-shell-ro-1600x900.png 37a0bf436deaa42bf6f7bb1b874600a90973a192ba4c0e0f29c26f8f219a02e3
```

Current source/test/localization/package byte SHA-256 (not normalized Git blob
hashes). Formatting-only JSON normalization occurred after browser capture; its
unchanged parsed strings are the same visual candidate. AppShell's final reader
extraction is covered by the twelve post-extraction shell cases. This document
cannot contain its own final SHA without a self-reference; the committed tree
identifies it and the permanent docs.

```text
content/en/common.json ba39266a74ab407fe41bd595250462a901fd87945116f9e25ac0a87812a49ef8
content/ro/common.json 2be6343f9138a4ee45bf24ee747211559bbd4800b7af2a7d4f775f332ab40c5c
package.json e87ed85f9cd455f27c9f268e2dbeedc6f4cfbbc8d119bcb73c0655ef9691a1ea
src/app/game-client/contracts.ts 31a4306578c45fafd27d8bf1150071e758e9ecf3c5ddce5de9b9fd3964216a9b
src/rendering/pixi/emptyPixiGridAdapter.ts d6e39753c09d2dc3a775a288cc92d660d471701cc8b9dcfdf29a5d240bbff063
src/styles.css ce4834d29c37426b86313eca37d4177a67a7ca561bfef6ae4b0f7a446be9dc46
src/ui/layout/AppShell.tsx 3260367ced8a494d9d2056fa4b797026be48b5f55dd4a9429be40ca9a5262c8c
src/ui/layout/Header.tsx 9fa41e489f4ae40adfeba9d8a455e316f8f977fcca041c857b089a214ffdd3f1
src/ui/layout/OperationsStack.tsx 8e1c1338e965350c408cbd4894b9a4dddcd20c2ac45ab8bb3bc678b367768a64
src/ui/workspaces/CenterWorkspace.tsx 56e60cd0d970f7381f6a9b84e7319f88193cec59fffe3f250867859db8c04740
src/rendering/pixi/camera.ts 4a2c9ff5614e56b4dfd7c2647a10ac026741291d54795d1aef01e3cb37fb9062
src/rendering/pixi/gridCoordinates.ts 1854b94c19528d19bff8a6c3d381ffeb57f3477a0fd891ddd25ba7ba8763d4b0
src/rendering/pixi/hitTesting.ts b410106994adf5c9b16440f0834ebdc2ab914c868c4bd884973e96ed704552dd
src/rendering/pixi/moduleVisual.ts 8bb54875a9785dc4f0980569ccfc33440e5abba2e2fd3353c572ca628f24233c
src/rendering/pixi/pixiGridAdapter.ts 19c2667683085de0a23966a3c5f7551a4d35c1f8c9760ff81e88f98c91eedb3d
src/rendering/pixi/rectanglePreview.ts 383c349129f2836ade93ae7bd63619bea7c6ade0fe38d66cc3f51f5e4f763ea7
src/rendering/pixi/sceneReconciliation.ts 05425abba1679f28b1ff28d83aa3dbb7088aa814fde97f232f24bfd5c2249005
src/ui/workspaces/selectionController.ts 55cacae509e6f3306017af861bd78351119aa67f860f94bb0817205a5b812156
src/ui/workspaces/useRendererSettings.ts b5d4f2e65be681d45d54d5ace66319fb8b1d5bd2454c021ccdd00b1f559f3ba9
tests/e2e/fixtures/task23ShellHarness.html b12e0b30d01729c69a255685892a11462ce7455f9da76eda450425f5db5ad9cc
tests/e2e/fixtures/task23ShellHarness.tsx 44c7cacf0d32ffe92ab4849151aa0251ecfa38d32d0a1baddc06a89d24668ce1
tests/e2e/task23-dirty-updates.spec.ts f3ab605ee575a0ac1aa12cd9b4a7cf03e977a68ce6362b15ee4d89bf90ed1f4c
tests/e2e/task23-frame-cap.spec.ts db680ed2e899063e872f2b6a859da59c90edd487c91d5ffd28824d5445b5fdba
tests/e2e/task23-renderer-performance.spec.ts 20a22795e38fca42bffd4541b0ede0aa7ae5c51f83182732c14a90c379299db3
tests/e2e/task23-renderer.spec.ts 884c179fa30e9ca0876baa83d813016c15ca51fb4ab2ea40c26cb22f68610b30
tests/e2e/task23-selection-inspector.spec.ts 83041b0aa70db323058d3569077003ee160056fc247afeb0aed8241dfa22f17b
tests/e2e/task23-settings.spec.ts ba3fc8af0d48081cdd8e24194beeb43fbcd15ba4424b6fa64ca73b478891e072
tests/e2e/task23-visuals.spec.ts 922da1773c47c8ef3eb377d8a36f8bbf65404a03ada133c65e728904669704cc
tests/performance/pixiRenderer.performance.ts 0b41d1c6c1394598636790cdf876a876a32d719ccd35194ee6d35972684f11c4
tests/unit/gridCoordinates.test.ts de37fa889453806237cf9b272b8b3d9e8942ff5ba9db9d9c345333781f5fb9e4
tests/unit/moduleVisual.test.ts 72c004cdddb70504ca529f415e12417cb19a6bd2450605db33968a7ace7177e6
tests/unit/pixiCamera.test.ts 2b64f0914a8b06e739f38793026eaa2252c60bf4808ea692bd1fbd8a27218ac4
tests/unit/pixiHitTesting.test.ts b8cb053f587467a9ff7cca80830e58dfa2d76bac72f19df80d80829d2f8211b7
tests/unit/pixiSceneReconciliation.test.ts 5d23d53c55122e56f95632db64d07fc668921affd817d1570492d31f8b02757c
tests/unit/rectanglePreview.test.ts 80f243d37f663446001e230a20c142e5ed91a493f7e679bc46a0e582a65e2dd5
tests/unit/selectionController.test.ts f4c00ae8e58bbe21d80dc5f7ca566f1a7766619bd87bc37bdcf7f2fc9b4d2ff5
```

### Exact reviewed CP23 allowlist

45 paths, all and only Task 23 implementation, regression/diagnostic fixtures,
UI localization and permanent documentation. No unrelated lock/Office file or
ignored test output is staged. Final staged smoke/strict TypeScript and Git
publication checks are performed only after the last evidence edit.

```text
TASK_23_VERIFICATION.md
content/en/common.json
content/ro/common.json
docs/TDD_VERTICAL_SLICE.md
docs/decisions/ADR-0030_BUILD_WORKSPACE_OWNERSHIP_AND_INTERACTIONS.md
docs/diagnostics/PHASE_3_RENDERING.md
docs/diagnostics/PHASE_3_TASK_23_CP23_REVIEW.md
docs/diagnostics/PHASE_3_VISUAL_REVIEW.md
docs/phases/03_BUILD_WORKSPACE.md
docs/phases/OVERCLOCK_Phase_3_Contract_and_Prompts.md
docs/status/PROJECT_STATUS.md
package.json
src/app/game-client/contracts.ts
src/rendering/pixi/camera.ts
src/rendering/pixi/emptyPixiGridAdapter.ts
src/rendering/pixi/gridCoordinates.ts
src/rendering/pixi/hitTesting.ts
src/rendering/pixi/moduleVisual.ts
src/rendering/pixi/pixiGridAdapter.ts
src/rendering/pixi/rectanglePreview.ts
src/rendering/pixi/sceneReconciliation.ts
src/styles.css
src/ui/layout/AppShell.tsx
src/ui/layout/Header.tsx
src/ui/layout/OperationsStack.tsx
src/ui/workspaces/CenterWorkspace.tsx
src/ui/workspaces/selectionController.ts
src/ui/workspaces/useRendererSettings.ts
tests/e2e/fixtures/task23ShellHarness.html
tests/e2e/fixtures/task23ShellHarness.tsx
tests/e2e/task23-dirty-updates.spec.ts
tests/e2e/task23-frame-cap.spec.ts
tests/e2e/task23-renderer-performance.spec.ts
tests/e2e/task23-renderer.spec.ts
tests/e2e/task23-selection-inspector.spec.ts
tests/e2e/task23-settings.spec.ts
tests/e2e/task23-visuals.spec.ts
tests/performance/pixiRenderer.performance.ts
tests/unit/gridCoordinates.test.ts
tests/unit/moduleVisual.test.ts
tests/unit/pixiCamera.test.ts
tests/unit/pixiHitTesting.test.ts
tests/unit/pixiSceneReconciliation.test.ts
tests/unit/rectanglePreview.test.ts
tests/unit/selectionController.test.ts
```

### Final formatting and evidence hygiene

```powershell
corepack pnpm format:check
# PASS: All matched files use Prettier code style!, exit 0.
$task23FormatPaths = @('content/en/common.json','content/ro/common.json','docs/TDD_VERTICAL_SLICE.md','docs/decisions/ADR-0030_BUILD_WORKSPACE_OWNERSHIP_AND_INTERACTIONS.md','docs/phases/03_BUILD_WORKSPACE.md','docs/phases/OVERCLOCK_Phase_3_Contract_and_Prompts.md','docs/status/PROJECT_STATUS.md','TASK_23_VERIFICATION.md','docs/diagnostics/PHASE_3_RENDERING.md','docs/diagnostics/PHASE_3_TASK_23_CP23_REVIEW.md','docs/diagnostics/PHASE_3_VISUAL_REVIEW.md')
corepack pnpm exec prettier --check --ignore-path NUL @task23FormatPaths
# PASS: All matched files use Prettier code style!, exit 0.
```

The explicit check includes touched documentation and localization ignored by
normal repository formatting. Every selected source and screenshot hash above
is checked against the actual final bytes; staged smoke uses non-capture browser
cases so it does not overwrite the selected visual evidence.

### Final staged smoke and CP23 decision

```text
corepack pnpm exec vitest run tests/unit/gridCoordinates.test.ts tests/unit/moduleVisual.test.ts tests/unit/pixiCamera.test.ts tests/unit/pixiHitTesting.test.ts tests/unit/pixiSceneReconciliation.test.ts tests/unit/rectanglePreview.test.ts tests/unit/selectionController.test.ts
PASS, 7 files / 34 tests, 7.42s, exit 0.
corepack pnpm exec playwright test tests/e2e/persistenceControls.spec.ts tests/e2e/task23-selection-inspector.spec.ts tests/e2e/task23-settings.spec.ts --grep 'selected Pan tool|same-epoch|Worker failure|production shell consumes|persistence controls keep|new run clears' --workers=1 --output=test-results/cp23-staged-smoke
PASS, 6/6, 44.5s, exit 0. No selected screenshot was overwritten.
git diff --cached --check
PASS, exit 0.
Final recorded-byte audit: 54/54 hashes match, zero mismatches.
Staged allowlist: exact ordinal set of 45 paths; no extra staged path.
Staged gameplay/save/domain/content-numeric/lockfile/Word drift: none.
Final emitted-bundle and production-harness scans: no matches (rg exit 1).
```

**CP23 disposition: PASS for the corrected reviewed candidate.** No Critical or
Important finding remains. All required evidence passes within Task 23's explicit
diagnostic classification; there is no new performance waiver. The documented
independent-review follow-up limitation is not represented as a completed signoff.
Following these recorded results only permanent evidence/status documentation was
edited; explicit formatting and strict TypeScript are rechecked after that final
edit. Source/test bytes remain the passing staged-smoke bytes. Commit/push uses
the exact subject and parent above; final Git checks require equal HEAD/origin/main/
remote main, 0/0 ahead/behind, exactly this allowlist and clean status. The published
commit's full identity cannot be embedded in its own file; obtain it with
`git log -1 --format="%H %P %s"`. Post-publication checks are reported in the final
handoff. Task 24 requires separate authorization and is not started.
