# Phase 2 Task 18 Independent Audit

Date: 2026-09-22

## Verdict

**NOT READY for CP18.**

The Task 18 candidate has a sound overall decomposition and its existing focused and Chromium tests
pass, but the independent review reproduced eight Important contract defects and two Moderate
documentation/API defects. The candidate must be repaired and reviewed again before it can become
the public CP18 baseline. Task 19 must not start from this candidate.

This audit did not repair production code, stage files, commit, push, or begin Task 19.

## Repository identity and reconstruction

- Approved public CP17 base: `c998378286b3e5bda6013636c615fdeee5d22063`.
- Original local Task 18 commit: `a137a12` on the superseded local Task 17 commit `9520b30`.
- Independent audit branch/worktree: `cp18-audit` at
  `D:\miscellaneous\Overclock\cp18_audit`.
- Reconstructed Task 18 candidate: `4a870d09c4bbd7a3fe41d9fdf4c39bbcc43cebd2`.
- Reconstructed parent: the approved public CP17 base `c998378...`.
- Reconstruction method: cherry-pick the local Task 18 commit onto public CP17. The only conflict was
  `docs/status/PROJECT_STATUS.md`; the audited CP17 section was preserved and the original Task 18
  section was appended unchanged so its historical claims could be reviewed rather than silently
  rewritten.
- `origin/main` remained `c998378...`; the audit branch was one local commit ahead and was not
  pushed.

The original local branch and commits were not modified by the reconstruction.

## Independent evidence

The existing Task 18 suites are green but do not cover the defects below:

- focused original Task 18 suites: 59/59 passed;
- extended focused simulator/store selection: 112/112 passed;
- real Chromium projection matrix: 6/6 passed;
- strict TypeScript: passed;
- focused ESLint: passed;
- `git diff --check`: passed.

Seven temporary adversarial tests were then run through public APIs. All seven failed in the exact
way described by findings T18-A01 through T18-A07. The temporary test file was removed after the
reproduction and is not part of the candidate. A separate direct parser probe showed that a crafted
`PresentationContext` with three accessor properties was accepted and all three getters executed.

The target-host diagnostic was rerun on Intel i7-2600, Windows 10.0.19045, Node v24.11.0:

| Operation | Samples / warm-up | Median | p95 | Contract |
| --- | ---: | ---: | ---: | --- |
| pure projection N | 500 / 100 | 0.6317 ms | 0.9341 ms | `<1 ms` PASS |
| project + publish + encode N | 500 / 100 | 1.3527 ms | 2.0341 ms | `<2 ms` **FAIL** |
| store apply N | 500 / 100 | 0.3150 ms | 0.6078 ms | `<5 ms` PASS |
| combined tick + projection N | 500 / 100 | 3.5327 ms | 5.8697 ms | `<6 ms` PASS |
| pure projection L, report-only | 50 / 5 | 0.7429 ms | 1.2900 ms | report-only |
| project + publish + encode L, report-only | 50 / 5 | 1.5389 ms | 4.8222 ms | report-only |

The diagnostic exits successfully even when a hard budget is missed. Its N fixture also omits some
branches required by the approved Phase 2 contract. Therefore the current performance script cannot
serve as a checkpoint gate even when its printed values happen to pass.

The full repository test command was not repeated twice during this audit. The direct Important
reproductions already make the candidate ineligible for checkpoint, and the approved repair
checkpoint requires two fresh complete runs after the fixes.

## Findings

### T18-A01 — Important — Store-built grid values are not deeply immutable

Contract affected: Phase 2 sections 4 and 7.2; Task 18.3 owned immutable store.

`buildNextGrid` creates new mutable `gridSize`, module/route arrays, heatmap object, and heatmap value
array, then freezes only the root object. `getGridViewModel()` therefore exposes mutable store-owned
state. A UI consumer can mutate the arrays or dimensions and corrupt the baseline used by later
patch application.

Evidence:

- `src/app/game-client/store.ts`, `buildNextGrid`, especially the root-only
  `Object.freeze(next)` return;
- independent full-publication reproduction: the root was frozen while `gridSize`, `modules`,
  `routes`, `heatmap`, and `heatmap.values` were not.

Required repair:

- build a fully owned, deeply immutable grid candidate before adoption;
- prove retained consumer references cannot mutate any nested value;
- preserve equal references only when the equal value is already trusted and deeply immutable.

### T18-A02 — Important — Selector/equality callbacks can make a committed apply appear to fail

Contract affected: Task 18.3 callback isolation, atomic publication, and future ACK correlation.

`notify()` evaluates selector and equality callbacks outside the existing exception guards. If one
throws, `applyPublication()` throws after the snapshot/grid swap already committed. A transport can
then withhold its ACK or retry an operation that the store already applied. Later subscribers are
also skipped.

Evidence:

- `src/app/game-client/store.ts`: selector evaluation and equality comparison occur before the
  guarded listener invocation;
- independent reproduction: a selector that throws on its second evaluation propagated from
  `applyPublication()` after the store adopted the publication.

Required repair:

- isolate selector, equality, and listener exceptions from committed store authority;
- specify and test whether a faulty selector remains subscribed; the approved repair policy is to
  keep it subscribed, retain its last successful value, continue other callbacks, and never roll
  back or misreport the committed publication;
- prove fake-transport sequence/ACK behavior remains coherent.

### T18-A03 — Important — Failed first admission poisons the store epoch

Contract affected: epoch fencing, atomic failure, load/recovery readiness.

On the first `applyPublication`, the store assigns `epoch = input.epoch` before ownership and
publication validation. If validation then throws, the empty store remains bound to the invalid
epoch and rejects the next valid first publication as stale.

Evidence:

- `src/app/game-client/store.ts`: epoch assignment precedes `assertDeeplyFrozen` and grid candidate
  construction;
- independent reproduction: an unfrozen first snapshot under `poison-epoch` threw; a valid full
  publication under `valid-epoch` was then rejected as `stale-epoch`.

Required repair:

- prepare and validate the complete candidate first;
- bind a previously-null epoch only in the same final non-throwing commit as snapshot/grid adoption;
- prove all failed first-admission paths leave the store bit-for-bit empty and unbound.

### T18-A04 — Important — Wrapper epoch and grid-publication epoch can disagree

Contract affected: epoch fencing and exact publication correlation.

`PublicationInput.epoch` is checked, but `GridPublication.epoch` is not compared with it. A grid
stamped for one epoch can be adopted under another wrapper epoch.

Evidence:

- no check of `input.grid.epoch` exists in `applyPublication`;
- independent reproduction: wrapper epoch `wrapper-epoch` plus grid epoch `grid-epoch` was accepted.

Required repair:

- require wrapper, publication, store, and transport epochs to agree before any candidate work;
- reject without mutation and request resync using stable existing result semantics;
- cover initial, delta, snapshot-only, reset, stale, and mismatched nested epoch cases.

### T18-A05 — Important — Publisher retains caller-owned pending input

Contract affected: publisher ownership, delayed ACK coalescing, and atomic acknowledgement.

While a publication is in flight, `publish()` stores `latestInput = input`. It later reuses that
external object during `acknowledge()`. Caller mutation after `publish()` can change or invalidate the
pending candidate and make acknowledgement throw after the acknowledged baseline has already moved.

Evidence:

- `src/sim/selectors/gridPublication.ts`: direct assignment to `latestInput` and later
  `publish(retained)`;
- independent reproduction: mutating the pending source width after `publish()` caused
  `acknowledge(0)` to throw `Grid publish view model must match the declared source`.

Required repair:

- retain only an owned immutable pending candidate or the exact owned fields needed to rebuild it;
- never retain the caller's wrapper/source/array references unless their ownership is validated and
  frozen by contract;
- prove delayed ACK, timeout, explicit resync, and mutation-after-call behavior.

### T18-A06 — Important — Presentation-context parsing executes accessors

Contract affected: Task 18.3 instruction to validate external input before cloning and the narrow
SimCore read boundary.

`parsePresentationContext` checks the outer prototype and keys, then destructures properties and
maps the supplied array. It does not descriptor-check fields and does not reject sparse arrays,
custom array properties, altered prototypes, or accessor elements.

Evidence:

- direct public-parser probe: an object with accessor properties for all three required fields was
  accepted and all three getters executed (`accepted: true`, `hits: 3`).

Required repair:

- parse by own data descriptors without invoking getters;
- require an exact plain record and an exact dense ordinary array with no custom properties;
- reject duplicate selected IDs, sparse arrays, accessor elements, prototype-bearing values,
  symbols, and unknown keys before cloning;
- return a detached frozen context and preserve SimCore state/RNG on rejection.

### T18-A07 — Important — `commandAvailability` is not conservative

Contract affected: Phase 2 section 7.1 and ADR-0027's explicit conservative-hint rule.

Several booleans ignore already-known pure blockers. The clearest reproduced case is
`SAVE_BLUEPRINT`: after applying one live module while the `subassembly-blueprints` feature remains
locked, the snapshot advertises `SAVE_BLUEPRINT: true`, but every save command is guaranteed to be
rejected with `RESEARCH_REQUIRED`. Similar broad checks exist for `INSTANTIATE_BLUEPRINT`,
`START_BENCHMARK`, and `APPLY_DESIGN`.

Required repair:

- define `true` as “no known payload-independent blocker and at least one eligible target exists
  when that can be determined by an existing pure guard”;
- use the validated presentation selection when an action is selection-dependent;
- extract/reuse existing pure domain guards instead of duplicating handler formulas;
- keep command validation authoritative and allow conservative false values.

### T18-A08 — Important — Full heatmap snapshots can be incomplete

Contract affected: first/full publication, resync, and exact full-grid reconstruction.

When `heatmapEnabled` is false, the first publication still says `heatmap.full: true` but carries an
empty value array. The store accepts it as the full bootstrap baseline. This contradicts the source
mapping's full-snapshot rule and makes completeness depend on later temperature values and UI toggle
history.

Evidence:

- independent reproduction: a 24 by 16 first publication returned `full: true` with zero values,
  not 384;
- `buildNextGrid` treats that empty array as its complete heatmap baseline.

Required repair:

- every full/resync publication must contain exactly one row-major value for every tile, regardless
  of current rendering visibility;
- validate full coverage, coordinate uniqueness/order, bounds, finiteness, and delta legality before
  store adoption;
- preserve cumulative epsilon behavior for ordinary deltas.

### T18-A09 — Moderate — `inventoryRevision` is not a revision

`build.inventoryRevision` is the total quantity across inventory stacks. Different inventories can
have the same total, so this value cannot identify inventory changes. The frozen source mapping
documents the substitution, but the public field name still promises revision semantics.

Required repair decision:

- before Phase 3 consumes the interface, rename it to truthful `inventoryUnitCount`; do not add an
  authoritative GameState revision or change Phase 1 hashes for this presentation need.

### T18-A10 — Important documentation/checkpoint evidence defect

The permanent Task 18 documentation is not valid checkpoint evidence:

- `PROJECT_STATUS.md` names superseded local base `9520b30`, says CP18 is local and unsynchronized,
  and claims zero Critical/Important findings;
- ADR-0027 says the Task 18 gates passed although the diagnostic records hard misses;
- the performance program prints budget strings but never fails its process on a miss;
- fixture N does not include the contract-required eight Blueprints and representative
  Benchmark/history, and its combined tick explicitly excludes Campaign, Research, and Benchmark;
- ADR-0027 says the comparison cache lives at the publication boundary while the implementation
  puts a module-global route cache in `projector.ts`;
- the retained execution log records the obsolete ancestry and now-refuted checkpoint conclusions.

Required repair:

- reconcile all permanent claims against the public CP17 base and the repaired implementation;
- make diagnostics executable gates with exact unchanged sample/warm-up counts and required fixture
  branches;
- remove the obsolete execution log after useful evidence is merged into permanent docs;
- do not call a miss a pass or technical success without a new explicit owner waiver.

## Additional ownership risk to close during repair

`assertDeeplyFrozen` traverses values by property access and accepts prototype-bearing frozen
objects. Task 19 will own strict wire schemas, but Task 18's public store boundary must still clearly
distinguish trusted internal publication values from untrusted wire input. The repair should make
the internal adoption preconditions descriptor-safe and exact; Task 19 must not rely on a
getter-executing “frozen” check as validation.

The projector's module-global route-issue cache is not known to produce incorrect output for valid
state/content pairs, but it is shared by independent SimCore instances and contradicts the claimed
pure/per-instance ownership model. The repair contract requires moving memoization into an isolated
presentation runtime owned by each SimCore, or removing it if the target-host gate can still pass.

## Repair boundary

The approved repair is split into five Luna subtasks plus one independent Sol checkpoint in
`docs/phases/OVERCLOCK_Task_18_Repair_Contract_and_Prompts.md`.

The repair must not implement Worker transport, a real GameClient, scheduler, persistence wiring,
renderer/UI, Task 19, or Phase 3. It must preserve Phase 1 GameState, save/replay protocol versions,
canonical hashes, RNG, fixed tick order, and all public CP17 behavior.

## Recommended execution order

1. Task 18.R1 — descriptor-safe context and protocol/epoch admission.
2. Task 18.R2 — deeply immutable atomic store and callback isolation.
3. Task 18.R3 — truthful projection/availability and per-core cache ownership.
4. Task 18.R4 — owned publisher and complete heatmap patch protocol.
5. Task 18.R5 — executable performance gates and permanent documentation reconciliation.
6. CP18-R — independent Sol High review, amend the local Task 18 candidate, and publish only if all
   gates pass.
