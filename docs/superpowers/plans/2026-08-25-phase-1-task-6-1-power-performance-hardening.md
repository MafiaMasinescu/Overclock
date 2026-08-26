# Phase 1 Task 6.1 Power Performance Hardening Implementation Plan

> **For agentic workers:** Execute this plan inline with `superpowers:test-driven-development` and
> `superpowers:verification-before-completion`. The user explicitly forbids commits and subagents for
> this task, so every checkpoint remains uncommitted in the current worktree.

**Goal:** Reduce warmed pure Power p95 below 1 ms and complete production-tick p95 below 4 ms on the
audited 24 x 16 i7-2600 fixture without changing deterministic gameplay behavior.

**Architecture:** Add a simulator-instantiated structural-sharing tick-system runtime so each
`SimCore` owns its Power topology cache and scratch storage. Power will rebuild immutable derived
topology only at lifecycle boundaries or when `liveLayoutRevision` changes, calculate into private
scratch arrays, validate only its output patch during warm ticks, and return frozen copy-on-write
branches. Legacy injected mutable tick systems retain the ADR-0003 clone/full-validation fallback.

**Tech Stack:** TypeScript 5.9 strict mode, Node 24, Vitest 4, pnpm 11, existing deterministic
simulator/content APIs.

**Spec:** `docs/TDD_VERTICAL_SLICE.md`, `docs/phases/01_HEADLESS_SIMULATOR.md`, ADR-0003,
ADR-0010, and the user-approved Task 6.1 prompt for this task.

## Global Constraints

- Preserve the fixed 100 ms tick and immutable 15-stage order.
- Preserve command FIFO timing, per-tick atomicity, prior-tick survival, and RNG rollback.
- Power consumes no RNG and changes no gameplay formula, priority, capacity, or transition.
- Derived caches, indexes, and scratch arrays remain outside `GameState` and every serialized form.
- Whole-state cloning, canonical serialization, and recursive traversal of unchanged frozen branches
  are forbidden on the ordinary production Power tick.
- Do not change timeouts, exact-100-run coverage, discovery, parallelism, gameplay content, the GDD,
  or Word documents.
- Do not implement Task 7 or any deferred UI, worker, save/load, settlement, workload, or thermal
  system.
- Do not commit or push.

---

### Task 1: Capture the accepted baseline and stage profile

**Files:**

- Modify: `tests/performance/powerDomain.performance.ts`
- Modify: `tests/performance/powerTick.performance.ts`
- Modify: relevant performance documentation during Task 8

**Interfaces:**

- Consume the existing audited `createPowerPerformanceFixture(seed): GameState`.
- Produce summaries containing `medianMs`, `p95Ms`, `maximumMs`, and `sampleCount`.

- [x] Verify the Task 6 base, clean worktree, and `HEAD === origin/main`.
- [x] Run 500 warmed pure-domain and 200 warmed production-tick samples under
  `NODE_ENV=production`.
- [ ] Extend the diagnostics to report cache reconstruction separately and to profile transaction,
  Power calculation, targeted validation, incremental freeze, and commit stages without folding
  fixture creation into steady-state timing.

### Task 2: Introduce simulator-owned tick runtimes and topology-cache tests

**Files:**

- Modify: `src/sim/core/tickSystems.ts`
- Modify: `src/sim/core/simCore.ts`
- Modify: `src/sim/core/authoritativeState.ts`
- Test: `tests/unit/powerPerformanceHardening.test.ts`

**Interfaces:**

- Produce `StructuralSharingTickSystemFactory.create(): StructuralSharingTickSystemRuntime`.
- Produce runtime methods `execute(context): GameState`, `validateLifecycleState(state): void`, and
  `clearDerivedState(): void`.
- Preserve callable legacy `TickSystem` registrations and their full-clone validation fallback.

- [ ] Write tests proving a reused registry creates independent runtimes per `SimCore`, unchanged
  ticks reuse one cache, and lifecycle replacement clears it.
- [ ] Run the focused tests and verify they fail because the runtime/factory contract is absent.
- [ ] Add the minimal factory materialization and lifecycle hooks while retaining the legacy path.
- [ ] Run the focused tests and existing `simCore` tests to green.

### Task 3: Cache complete stable Power topology

**Files:**

- Modify: `src/sim/power/powerTopology.ts`
- Modify: `src/sim/power/facilityPower.ts`
- Test: `tests/unit/powerPerformanceHardening.test.ts`
- Test: `tests/unit/powerTickSystem.test.ts`

**Interfaces:**

- Extend `PowerTopology` with stable module/source/sink/route ordering, resolved definitions and
  ports, priority tiers, numeric capacity-group indexes, and incoming-route indexes.
- Produce a per-runtime cache keyed by `liveLayoutRevision`; rebuild on cache miss, revision change,
  or lifecycle clear.
- Provide non-authoritative diagnostics counters for cache hits, rebuilds, and lifecycle clears.

- [ ] Write failing tests for cold/warm equality, revision-triggered rebuild, and no rebuild after
  draft-only editing, undo, redo, cancel, or command-only processing.
- [ ] Rebuild the topology from stable sorted IDs once and freeze the cache outside authoritative
  state.
- [ ] Route production calculation through the cached topology while keeping
  `calculateFacilityPower` as the deterministic cold pure API.
- [ ] Verify cache tests, Task 6 unit tests, and exact startup-boundary behavior.

### Task 4: Replace the production clone with a structural-sharing transaction

**Files:**

- Modify: `src/sim/core/simCore.ts`
- Modify: `src/sim/core/authoritativeState.ts`
- Modify: `src/sim/power/facilityPower.ts`
- Test: `tests/unit/powerPerformanceHardening.test.ts`
- Test: `tests/unit/simCore.test.ts`

**Interfaces:**

- Structural runtimes consume an authoritative read-only state and return a candidate root at the
  same tick.
- `AuthoritativeState.commitOwned(candidate)` incrementally deep-freezes only unfrozen objects;
  initial-state and command boundaries fully detach and freeze once.
- `SimCore.replaceState(state)` performs detached lifecycle validation, requires no pending commands,
  commits atomically, and clears every derived runtime.

- [ ] Write failing tests for unchanged-branch identity, changed-branch replacement, retained
  reference mutation resistance, state replacement, and rollback after a later fatal system.
- [ ] Start structural-only ticks from the frozen current state instead of `structuredClone`.
- [ ] Keep mixed/legacy registries on the clone-and-full-validation path.
- [ ] Return new root/facility/modules/Power branches only when their authoritative values change.
- [ ] Verify focused rollback, immutability, save detachment, and legacy-system regressions.

### Task 5: Add scoped Power validation

**Files:**

- Modify: `src/sim/power/powerState.ts`
- Modify: `src/sim/power/facilityPower.ts`
- Test: `tests/unit/powerPerformanceHardening.test.ts`
- Test: `tests/unit/powerDomain.test.ts`

**Interfaces:**

- Produce `assertValidPowerTickResult(previousState, calculation, topology): void`.
- Lifecycle/cache-rebuild validation retains complete Power coverage and reference checks.
- Warm-tick validation checks all changed delivery/transition/route/facility values and cross-field
  capacity, totals, revision, reference, startup, brownout, and energy-cost invariants.

- [ ] Write failing corruption tests for module delivery, route flow, totals, revisions, invalid
  references, non-finite values, and non-Power-owned module changes.
- [ ] Remove whole-state canonical, inventory, Design Mode, and complete Power validation from the
  structural-only warm path.
- [ ] Validate the Power patch using stable topology indexes and literal invariant relationships.
- [ ] Verify validation failure leaves state, tick, RNG, and populated cache behavior deterministic.

### Task 6: Remove repeated allocation work and temporary allocation

**Files:**

- Modify: `src/sim/power/powerDemand.ts`
- Modify: `src/sim/power/powerAllocation.ts`
- Modify: `src/sim/power/powerTransitions.ts`
- Modify: `src/sim/power/facilityPower.ts`
- Test: `tests/unit/powerDomain.test.ts`

**Interfaces:**

- Runtime scratch owns fixed-size numeric arrays for demand, module delivery, route delivery,
  remaining contracted/route/port capacity, and source availability.
- Stable topology numeric indexes replace per-tick sorts, `Set` construction, string capacity keys,
  and temporary tier arrays.
- Public pure APIs preserve their current return contracts.

- [ ] Add failing equivalence cases comparing indexed warm calculation with the cold public API.
- [ ] Fill and reuse scratch arrays without exposing them through returned objects.
- [ ] Reuse unchanged module and Power records; allocate/freeze only values that differ.
- [ ] Scan committed state recursively to prove no typed array, cache, `Map`, `Set`, or scratch object
  leaked into authoritative data.
- [ ] Re-run the pure-domain diagnostic and stop optimizing once the measured p95 is below 1 ms.

### Task 7: Exact determinism and lifecycle regression coverage

**Files:**

- Create or modify: `tests/determinism/powerPerformanceHardeningDeterminism.test.ts`
- Modify only if required: existing Task 1 through Task 6 regression tests

**Interfaces:**

- Preserve published canonical state/hash/RNG vectors and exact 100-run loops.

- [ ] Add an exact 100-run scenario covering cold cache, warm cache, draft-only commands, changed
  Apply invalidation, and subsequent Power ticks.
- [ ] Compare cold and warm authoritative serialization and hashes exactly.
- [ ] Run focused Task 6/6.1, complete unit, and standalone determinism suites after each material
  change without timeout or discovery changes.

### Task 8: ADR and documentation

**Files:**

- Create: `docs/decisions/ADR-0011_INCREMENTAL_TICK_TRANSACTIONS_AND_DERIVED_POWER_CACHE.md`
- Modify: `docs/TDD_VERTICAL_SLICE.md`
- Modify: `docs/phases/01_HEADLESS_SIMULATOR.md`
- Modify: `docs/status/PROJECT_STATUS.md`
- Modify: relevant performance diagnostic documentation

**Interfaces:**

- ADR-0011 explicitly supersedes ADR-0003 decisions 15 and 16 only for structural-sharing production
  runtimes while preserving the legacy fallback and all atomicity semantics.

- [ ] Document cache ownership/invalidation, lifecycle clearing, transaction/rollback, scoped
  validation, incremental immutability, scratch isolation, measurements, remaining risks, and target
  pass/fail status.
- [ ] Keep ADR-0003 and ADR-0010 historical text unchanged.

### Task 9: Full verification and uncommitted handoff

**Files:** all Task 6.1 changes only.

- [ ] Run focused Task 6/6.1 tests, complete unit, standalone determinism, and the combined
  `corepack pnpm test` twice consecutively in clean processes.
- [ ] Run formatting, ESLint, strict TypeScript, content validation, production build, and
  `corepack pnpm validate`.
- [ ] Run `git diff --check`, simulator forbidden API/import scans, adjacent-port-graph usage scan,
  gameplay-content/balance drift, and GDD/Word-document drift checks.
- [ ] Run final production diagnostics with separate warm-up, at least 500 pure samples, at least
  200 complete-tick samples, and separately reported cold topology reconstruction.
- [ ] Record CPU, runtime, OS, build mode, and target-hardware status.
- [ ] Inspect every modified/untracked file, leave all Task 6.1 work uncommitted, do not push, and do
  not begin Task 7.
