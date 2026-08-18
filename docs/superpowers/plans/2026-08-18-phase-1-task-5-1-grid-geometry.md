# Phase 1 Task 5.1 Grid Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic grid geometry, derived occupancy, rotated port geometry, compatibility, an adjacent-port graph, focused grid invariants, content checks, tests, diagnostics, and compatibility documentation without implementing Design Mode commands.

**Architecture:** Keep authoritative `GameState` unchanged. Add plain-data, pure domain functions under `src/grid/` that derive row-major tiles, occupancy records, resolved ports, and sorted graph nodes/edges from module instances plus validated content. Add a focused validator that future grid mutation handlers can invoke, but do not register it in the empty tick path.

**Tech Stack:** TypeScript 5.9 strict mode, Zod 4 content schemas, Vitest 4, Node 24 diagnostics, pnpm 11.

**Spec:** `docs/TDD_VERTICAL_SLICE.md` sections 9-11 and 18-19, `docs/GDD.md` sections 12 and 14, plus the approved Task 5.1 request in this task.

## Global Constraints

- Origin is top-left; positive x is right; positive y is down; coordinates are zero-based integers.
- Rotations are clockwise and limited to `0`, `90`, `180`, and `270`.
- Occupied tiles are always returned in row-major order by y then x.
- Derived occupancy and graphs never enter authoritative `GameState`.
- Returned public data is plain canonical-JSON-compatible data with locale-independent ordering.
- Existing build command handlers remain unavailable; no Design Mode lifecycle or mutation command is implemented.
- Do not modify `docs/TDD_VERTICAL_SLICE.md` or `docs/GDD.md`, and do not commit.

---

### Task 1: Content geometry validation

**Files:**
- Modify: `src/content/schemas/contentSchemas.ts`
- Modify: `src/content/loader/contentLoader.ts`
- Modify: `tests/unit/contentLoader.test.ts`

**Interfaces:**
- Produces: exported `ModulePortDefinition`, maximum unrotated `3 x 2` schema enforcement, duplicate port-ID and side-relative offset validation through `validateContent`.

- [ ] Add tests that mutate a cloned raw pack to create duplicate port IDs, invalid north/south and east/west offsets, and a height of three.
- [ ] Run `corepack pnpm vitest run tests/unit/contentLoader.test.ts` and verify the new tests fail for the missing offset/height behavior.
- [ ] Restrict unrotated height to two and add deterministic per-module/per-port semantic issues.
- [ ] Re-run the focused test and verify all supplied content still loads.

### Task 2: Footprint geometry, occupancy, placement, and grid invariants

**Files:**
- Create: `src/grid/domain/contracts.ts`
- Create: `src/grid/domain/footprintGeometry.ts`
- Create: `src/grid/domain/occupancy.ts`
- Create: `src/grid/validation/gridState.ts`
- Create: `tests/unit/gridGeometry.test.ts`

**Interfaces:**
- Produces: `resolveRotatedFootprintSize`, `transformLocalFootprintPoint`, `enumerateOccupiedTiles`, `isGridPointInBounds`, `buildOccupancyIndex`, `findOccupyingModuleInstanceIds`, `validateModulePlacement`, `validateGridState`, and `assertValidGridState`.
- Produces plain issue/result records using `INVALID_PAYLOAD`, `OUT_OF_BOUNDS`, and `TILE_OCCUPIED` with stable machine-readable reasons.

- [ ] Add literal tests for square/non-square dimensions, every `3 x 2` rotation, row-major ordering, all boundaries, exact-edge placement, one-tile failures, collisions, move exclusion, unknown definitions, key mismatches, malformed positions/rotations, and duplicate occupation.
- [ ] Run `corepack pnpm vitest run tests/unit/gridGeometry.test.ts` and verify failure because the APIs do not exist.
- [ ] Implement rotation transforms and row-major enumeration without mutating input.
- [ ] Implement a deterministically sorted plain-data occupancy index and collision lookup.
- [ ] Implement atomic placement validation and the focused facility validator/assertion.
- [ ] Re-run focused tests, then refactor while green.

### Task 3: Port geometry, compatibility, and adjacent graph

**Files:**
- Create: `src/grid/domain/portGeometry.ts`
- Create: `src/grid/domain/adjacentPortGraph.ts`
- Create: `tests/unit/portGeometry.test.ts`

**Interfaces:**
- Produces: `resolveModulePortGeometry`, `arePortsPhysicallyAdjacent`, `resolveCompatiblePortPair`, and `buildAdjacentPortGraph`.
- Resolved ports include module/port IDs, kind, rotated facing, module tile, external adjacent tile, and capacity per second.
- Graph nodes and edges are sorted by explicit code-unit string comparison; power/data direction is normalized; airflow creates no graph edge.

- [ ] Add literal tests for every side and rotation, nonzero offsets, external tiles, compatibility matrices, physical adjacency rejection, airflow exclusion, insertion-order independence, edge deduplication, canonical serialization, and exactly 100 identical runs.
- [ ] Run `corepack pnpm vitest run tests/unit/portGeometry.test.ts` and verify failure because the APIs do not exist.
- [ ] Implement port tile/side transformation and external-tile resolution.
- [ ] Implement physical adjacency and normalized power/data compatibility.
- [ ] Implement deterministic node/edge derivation and deduplication without authoritative routes.
- [ ] Re-run focused tests, then refactor while green.

### Task 4: Diagnostic and documentation

**Files:**
- Create: `tests/performance/gridGeometry.performance.ts`
- Modify: `package.json`
- Create: `docs/decisions/ADR-0005_DETERMINISTIC_GRID_AND_PORT_GEOMETRY.md`
- Modify: `docs/phases/01_HEADLESS_SIMULATOR.md`
- Modify: `docs/status/PROJECT_STATUS.md`

**Interfaces:**
- Produces: `corepack pnpm performance:grid`, reporting median, p95, maximum, iteration counts, `24 x 16` fixture size, and development-machine limitation.

- [ ] Add a controlled dense `24 x 16` fixture and separately measure occupancy construction, placement validation, and graph construction after warmup.
- [ ] Run the diagnostic and record its fresh measurements without claiming the i7-2600 gate.
- [ ] Record coordinate, rotation, occupancy, port-offset, compatibility, and derived-graph decisions in ADR-0005.
- [ ] Mark Task 5.1 implemented in phase/status docs and set the exact next task to the approved Task 5.2 wording.

### Task 5: Verification and final audit

**Files:**
- Inspect every changed file and the complete diff.

- [ ] Run focused Task 5.1 tests and Task 2/3/4 regression tests.
- [ ] Run complete unit and determinism suites plus both performance diagnostics.
- [ ] Run format check, lint, typecheck, content validation, build, and full validate.
- [ ] Run `git diff --check`, forbidden API/import scans, TDD/GDD drift checks, published RNG/hash vectors, and Task 4 money-vector tests.
- [ ] Confirm build commands still return `COMMAND_NOT_AVAILABLE`, geometry leaves state/RNG unchanged, no authoritative occupancy/graph state was added, and no out-of-scope subsystem appears in the diff.
- [ ] Inspect `git status`, `git diff --stat`, and the complete `git diff`; report exact results and measurements without committing.
