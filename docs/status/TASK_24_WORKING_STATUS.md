# Phase 3 Task 24 working status

Status: Task 24.1–24.4 implementation complete; publication is unverified and pending investigation; CP24 has not started.

## Ownership and base

- `TASK_24_BASE`: `5c75fbd1fcd7f30f72daccb640d49d05602ccd96` (`feat: render interactive facility canvas`).
- Checkout: `D:\\miscellaneous\\Overclock\\vertical_slice_v1`.
- The implementation is published by the requested commit as explicitly unverified and pending investigation; this does not claim CP24 or independent checkpoint approval.
- CP23 is the published prerequisite. No CP24 or Phase 3 closure is claimed here.

## Completed Task 24 boundary

- 24.1 BuildTray reads the Worker-owned `BuildContextRead`; Inventory/Catalog tabs provide stable localized search and category filters, footprint, availability, price and query-owned lock/credit/inventory reasons. Tool activation is local until one guarded `ENTER_DESIGN_MODE` is admitted; no UI purchase or placement mutation is performed.
- 24.2 placement uses the existing Worker query/command boundary with a 10 Hz latest-preview coordinator, pending/valid/invalid ghosts, click/drag/keyboard confirmation, guarded Catalog `BUY_MODULE` followed by a fresh placement preview and `PLACE_MODULE`, publication reconciliation and Shift-retain behavior.
- 24.3 supports single-module move with grab offset, keyboard arrows, Q/E absolute quarter-turn rotation, attached-route impact in the preview, stable multi-remove with partial rejection, route disconnect, and guarded Undo/Redo. Group transforms remain unavailable.
- 24.4 renders the authoritative Apply preview fields (changed modules, inventory lines, consumed book value, labor, salvage, net payment/credit and maximum startup downtime), confirms with the preview revision/cost/downtime/generation, rejects stale previews for explicit refresh, and provides changed/unchanged Cancel behavior. The browser flow covers manual save, reload and continued edit; no Apply-triggered autosave policy was added.
- A reload regression was repaired in both Build coordinators: session replacement now invalidates stale work without permanently disposing the reusable preview coordinator.

## Accumulated files

Tracked modifications: `content/en/common.json`, `content/ro/common.json`, `docs/status/PROJECT_STATUS.md`, `src/app/game-client/contracts.ts`, `src/rendering/pixi/pixiGridAdapter.ts`, `src/styles.css`, `src/ui/layout/AppShell.tsx`, `src/ui/layout/BuildTray.tsx`, `src/ui/layout/OperationsStack.tsx`, and `src/ui/workspaces/CenterWorkspace.tsx`.

New uncommitted files: `docs/status/TASK_24_WORKING_STATUS.md`, `src/app/game-client/buildCommands.ts`, `src/ui/layout/buildTraySelectors.ts`, `src/ui/workspaces/buildEditController.ts`, `src/ui/workspaces/buildPlacementController.ts`, `src/ui/workspaces/useBuildEditController.ts`, `src/ui/workspaces/useBuildPlacementController.ts`, `tests/e2e/task24-build-tray.spec.ts`, `tests/unit/buildEditController.test.ts`, `tests/unit/buildPlacementController.test.ts`, and `tests/unit/buildTraySelectors.test.ts`.

## Verification evidence

- `corepack pnpm exec vitest run tests/unit --pool=threads --maxWorkers=1 --reporter=dot`: 100 files / 1,600 tests passed in 139.81 s.
- Focused Build unit tests: 3 files / 7 tests passed.
- Determinism/parity selection (`designModeDeterminism`, `designModeUndoRedoDeterminism`, `saveDomainParity`): 3 files / 4 tests passed.
- `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm content:validate`, `corepack pnpm format:check`, `corepack pnpm build`, and `git diff --check`: passed. ESLint emits only existing ignore warnings for JSON/CSS when those paths are named directly; the full lint command exits cleanly. The build retains the existing >500 kB chunk warning.
- `corepack pnpm exec playwright test tests/e2e/task24-build-tray.spec.ts --workers=1`: 3/3 passed at 1280×720, including Romanian and English Apply dialog fields, dialog fit, keyboard placement, Apply, save/load, move, Q/E rotation and Undo/Redo.
- `corepack pnpm exec playwright test tests/e2e/phase0-smoke.spec.ts --workers=1`: 6/6 passed.
- `corepack pnpm exec playwright test tests/e2e/task23-renderer.spec.ts tests/e2e/task23-selection-inspector.spec.ts --workers=1`: 24/24 passed.
- `corepack pnpm performance:design`: passed report-only diagnostic on the current Intel i7-2600 host; p95 enter-draft 14.5534 ms, placement 19.8031 ms, move 16.4315 ms, rotation 15.7977 ms, removal 16.2217 ms, undo 17.6521 ms, redo 19.6684 ms.
- `corepack pnpm performance:apply`: passed report-only diagnostic on the current host; p95 preview 42.2653 ms and successful Apply 26.0149 ms.

The performance scripts explicitly classify these measurements as development-machine/report-only results. They are not a complete target certification because the target GPU/browser certification environment was not established in this checkout. An unconstrained baseline unit invocation previously stalled without a verdict; the recorded fresh single-worker run above is the reproducible gate result, with no timeout or fixture weakening.

## Next boundary

All Task 24 implementation and required handoff evidence are present. The next authorized action is an independent CP24 review/checkpoint using its reviewed allowlist; do not stage, commit, push, or claim CP24/phase closure as part of this task.
