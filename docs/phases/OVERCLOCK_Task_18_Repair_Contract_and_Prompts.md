# OVERCLOCK Task 18 Repair Contract and Prompts

Status: approved repair plan after the independent Task 18 audit dated 2026-09-22.

This is a planning and execution artifact. It does not itself approve the Task 18 candidate, alter
Phase 1 semantics, or begin Task 19.

## 1. Repository and branch contract

Authoritative public base:

```text
c998378286b3e5bda6013636c615fdeee5d22063
```

That commit is the approved public CP17 checkpoint.

The original Task 18 commit `a137a12` was based on superseded local Task 17 commit `9520b30` and must
not be merged directly into `main`.

The independent audit reconstructed Task 18 on the public base in an isolated branch/worktree:

```text
branch: cp18-audit
worktree: D:\miscellaneous\Overclock\cp18_audit
candidate HEAD: 4a870d09c4bbd7a3fe41d9fdf4c39bbcc43cebd2
candidate parent: c998378286b3e5bda6013636c615fdeee5d22063
```

The audit and this contract are the only expected uncommitted files before Task 18.R1:

```text
docs/diagnostics/PHASE_2_TASK_18_INDEPENDENT_AUDIT.md
docs/phases/OVERCLOCK_Task_18_Repair_Contract_and_Prompts.md
```

If that exact worktree still exists, use it. If it does not, reconstruct an equivalent isolated
branch from public CP17, cherry-pick `a137a12`, resolve only `PROJECT_STATUS.md` by preserving the
audited public CP17 section and the original Task 18 section for later reconciliation, then verify
that the resulting tree matches candidate `4a870d0...`. Do not mutate or reset the user's other
worktrees.

All Luna subtasks leave changes uncommitted and unstaged. CP18-R is the only prompt allowed to amend,
push, or synchronize the Task 18 checkpoint.

## 2. Repair goal

Produce one checkpoint-ready Task 18 tree that:

1. preserves the approved public CP17 behavior and all Phase 1 deterministic contracts;
2. exposes truthful immutable presentation values through a narrow SimCore boundary;
3. owns all retained publisher/store values and rejects malformed public inputs without executing
   accessors;
4. applies snapshots and grid publications atomically with exact epoch/base/revision semantics;
5. isolates every subscriber callback failure from store authority and transport acknowledgement;
6. emits complete full heatmaps and minimal cumulative-epsilon deltas;
7. provides genuinely conservative command-availability hints without duplicating gameplay logic;
8. isolates presentation memoization per SimCore/runtime;
9. uses executable target-host performance gates and the contract-required fixtures;
10. reconciles Task 18 documentation with public CP17 ancestry and actual evidence.

## 3. Non-negotiable preserved contracts

The repair must not change:

- `GameState`, `saveVersion`, `contentVersion`, Replay protocol version, save schema version, or
  persistence envelope schema;
- canonical serialization or any published Phase 1/Task 16/Task 17 compatibility vector;
- RNG algorithm/state, tick duration/order, Campaign tick/year equality, command FIFO/atomicity, or
  rollback behavior;
- Power, Thermal, Overclock, Useful Compute, Task, Research, Benchmark, Blueprint, Replay, campaign,
  economy, or inventory formulas;
- Task 17 repository/import/export semantics;
- content balancing or module numeric data;
- the fixed projection sample counts, warm-up counts, fixture density, or approved thresholds merely
  to obtain a pass.

The repair must not implement:

- Worker schemas/host/runtime, real postMessage wiring, real GameClient, scheduler/catch-up,
  visibility handling, autosave/recovery orchestration, Phase 3 renderer/UI, charts, semantic alerts,
  placement previews, or Task 19;
- new gameplay, debug grants, direct state injection, or presentation data inside authoritative
  GameState;
- a second command or simulation execution path.

## 4. Approved repair decisions

### R-D1 — External presentation context

`PresentationContext` remains a public host-to-simulator input and must be parsed before property
access or cloning. Only an exact plain data record is accepted. `selectedIds` must be an exact dense
ordinary array of unique nonempty bounded strings with no custom properties, accessors, symbols, or
altered prototype. Returned context data is detached and frozen.

### R-D2 — Trusted publication values versus future wire data

Task 19 still owns wire schemas. Task 18 owns the in-process publication/store contract. Its public
entry points must nevertheless be descriptor-safe and must never execute accessors while checking
ownership. They may require deeply frozen exact plain data produced by Task 18, but they must reject
prototype-bearing, accessor-backed, sparse, aliased mutable, or inconsistent values deterministically.

### R-D3 — Atomic store admission

`applyPublication` is prepare-then-commit:

1. descriptor-safe outer validation;
2. exact epoch/base/revision checks;
3. ownership/plain-data validation;
4. build a complete deeply frozen candidate using locals only;
5. atomically swap epoch, snapshot, grid, heatmap baseline, and revision;
6. notify subscribers after commit without allowing callbacks to throw through the apply boundary.

A failed first publication leaves the store empty, disconnected, revision zero, heatmap absent, and
epoch unbound.

### R-D4 — Subscriber failure policy

Snapshot listeners, selector execution, selector equality, and selector listeners are all isolated.
A failing selector subscription remains registered and retains its last successful value; other
subscriptions still run. A committed publication remains reported as applied. No callback can alter
the return result, rollback authority, suppress transport ACK, or mutate store data.

### R-D5 — Nested immutability

Every value reachable through `getSnapshot`, `getGridViewModel`, named selectors, and selector
callbacks is deeply immutable. Store-created arrays and records must be owned and frozen before
commit. Do not use root-only `Object.freeze` as a substitute.

### R-D6 — Exact publication epochs and revisions

Wrapper epoch, grid-publication epoch, store epoch, and fake-transport epoch must agree. A full first
publication uses base revision 0 and advances exactly to 1. A content-changing delta advances by one;
a source-only publication retains the base revision. Revision rollback, jumps, malformed sequences,
and nested epoch mismatch reject atomically and request resync.

### R-D7 — Pending publisher ownership

The publisher may retain one latest pending candidate, but never a caller-owned mutable wrapper or
source. It retains an owned immutable candidate or exact copied fields. Caller mutation after
`publish()` cannot affect `acknowledge`, timeout, resync, or later output.

### R-D8 — Full and delta heatmaps

Every full/first/resync publication carries exactly `width * height` finite row-major heatmap values,
one for each coordinate, even when the renderer toggle is off. The toggle may suppress ordinary
deltas, but the acknowledged baseline still tracks exact transmitted values and later re-enable
preserves cumulative epsilon behavior. The store validates full coverage and legal bounded deltas.

### R-D9 — Availability semantics

`commandAvailability[kind] === true` means no known payload-independent blocker exists and at least
one eligible target exists when an existing pure rule can determine that cheaply. It is still only a
hint; false may be conservative and command handlers remain authoritative. Known blockers must never
produce true. Existing pure domain guards must be extracted/reused rather than reimplemented.

Selection-dependent Blueprint save uses validated `PresentationContext.selectedIds`. Unsupported,
unknown, and dev-only kinds remain absent.

### R-D10 — Inventory presentation field

Rename `build.inventoryRevision` to `build.inventoryUnitCount`. It is the exact safe total inventory
quantity, not a revision. Do not add an authoritative inventory revision to GameState and do not
change compatibility hashes for a presentation-only need.

### R-D11 — Memoization ownership

The module-global route-issue cache is not permitted. Memoization must be isolated per SimCore-owned
presentation runtime and cleared/replaced with state replacement/runtime replacement, or removed if
performance still passes. Public pure projection helpers remain observationally and operationally
independent across SimCore instances and content bundles.

### R-D12 — Performance gates

The permanent diagnostic must exit nonzero on a hard gate miss. It must measure the unchanged
approved N fixture requirements: 24 by 16, at least 75 percent occupied, active Power/Thermal/Compute,
active Task and Research, eight Blueprint records, representative Benchmark/history, and full
production tick composition. Setup/cold construction stays separate. The approved Task 18 budgets
remain:

- pure projector N p95 `<1 ms`, 500 samples after 100 warm-ups;
- project + publish + encode N p95 `<2 ms`, 500 after 100;
- main-thread store processing N p95 `<5 ms`, 500 after 100;
- direct complete production tick p95 `<4 ms`;
- combined tick + due projection can remain a separately reported `<6 ms` integration diagnostic;
- L stays report-only with its documented sample/warm-up counts.

No Task 18 performance miss has an owner waiver. A miss blocks CP18-R.

## 5. Task dependency map

```text
18.R1 Descriptor-safe admission and epoch protocol
  -> 18.R2 Atomic deeply immutable store and callback isolation
       -> 18.R3 Truthful projection, availability, and per-core memoization
            -> 18.R4 Owned publisher and complete heatmap patch protocol
                 -> 18.R5 Diagnostics, regressions, and documentation
                      -> CP18-R independent Sol High checkpoint
```

## 6. Exact execution order

Run each prompt in a fresh Codex task unless it is a correction to that same subtask:

1. Prompt 18.R1 with GPT-5.6 Luna, reasoning xhigh.
2. Review its report and diff; if accepted, Prompt 18.R2.
3. Prompt 18.R3.
4. Prompt 18.R4.
5. Prompt 18.R5.
6. Start a fresh task with GPT-5.6 Sol, reasoning high, and run CP18-R.

Do not commit between Luna subtasks.

---

## Prompt 18.R1 — Descriptor-safe admission and epoch protocol

```text
Implement OVERCLOCK Phase 2 Task 18.R1 only: descriptor-safe presentation admission and exact epoch protocol hardening.

Recommended model: GPT-5.6 Luna. Reasoning: xhigh.

Do not commit, stage, push, amend, reset, stash, or begin Task 19.

Repository/worktree contract

Use the isolated Task 18 repair worktree, normally:
D:\miscellaneous\Overclock\cp18_audit

Expected candidate HEAD:
4a870d09c4bbd7a3fe41d9fdf4c39bbcc43cebd2

Expected parent and origin/main:
c998378286b3e5bda6013636c615fdeee5d22063

The only permitted pre-existing uncommitted files are:
- docs/diagnostics/PHASE_2_TASK_18_INDEPENDENT_AUDIT.md
- docs/phases/OVERCLOCK_Task_18_Repair_Contract_and_Prompts.md

If identity or diff ownership differs, stop and report exact evidence. Never modify another worktree.

Preflight

1. Read every applicable AGENTS.md.
2. Read the complete repair contract and independent audit above.
3. Read the normative Task 18 sections and prompts in docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md.
4. Read ADR-0027, PROJECT_STATUS, PresentationContext types/parser, GridPublisher, GameClientStore, fake transport, SimCore presentation API, and their tests.
5. Inspect every accumulated candidate file and confirm no Task 19 work exists.
6. Run the existing focused Task 18 tests before editing.

Implementation scope

A. Harden parsePresentationContext:
- inspect own property descriptors before reading values;
- require exactly the three approved own enumerable data properties;
- reject accessors without invoking them;
- reject symbols, unknown keys, class/prototype-bearing outer values;
- require selectedIds to be an exact dense ordinary Array with Array.prototype, length <= 512, no holes, no custom keys, no accessors and unique bounded nonempty strings;
- reject prototype-bearing or accessor-backed array entries before value access;
- preserve exact boolean/null/string rules;
- return a detached deeply frozen PresentationContext.

B. Harden the Task 18 in-process store/publication admission boundary without implementing Task 19 wire schemas:
- use descriptor-safe checks for any public value inspected by Task 18;
- reject accessor-backed, sparse, custom-property, prototype-bearing or non-plain publication wrappers before cloning/adoption;
- clearly separate trusted internal frozen presentation values from future untrusted wire parsing;
- do not import Worker, IndexedDB, save repository, React or Pixi into src/sim.

C. Fix epoch admission:
- wrapper epoch, GridPublication.epoch and current store epoch must agree;
- a null store epoch is not bound until the complete first candidate is validated and ready to commit;
- failed first admission leaves epoch null and store state unchanged;
- stale/mismatched epochs reject atomically using existing stable result semantics;
- resetForEpoch remains explicit and validated.

D. Validate revision protocol at the store boundary:
- first full publication must have base 0 and next 1;
- ordinary changed deltas advance exactly one;
- source-only publications retain the base revision;
- reject rollback, jump, unsafe integer, negative zero and inconsistent full/delta revisions;
- do not invent Task 19 request sequences.

Required regression-first tests

1. PresentationContext accessor object rejected with zero getter hits.
2. Sparse, subclassed, custom-property, accessor-element and altered-prototype selectedIds rejected.
3. Duplicate selected IDs rejected.
4. Valid context is detached and deeply frozen.
5. Rejected context preserves state hash, tick and RNG.
6. Failed first publication does not bind epoch.
7. Wrapper/grid epoch mismatch rejects without mutation.
8. Stale epoch, reset epoch and fresh full adoption.
9. Invalid first base/next revisions.
10. Invalid delta revision jump/rollback and source-only revision behavior.
11. Accessor-backed publication wrapper rejected with zero getter hits.
12. Class, sparse and prototype-bearing publication structures rejected where Task 18 adopts them.
13. Existing wrong-base and fake-transport ordering regressions.

Forbidden scope

- no Worker schemas, postMessage, scheduler, real GameClient or Task 19;
- no projection formula, command availability, heatmap algorithm, subscriber policy or performance-fixture change in R1;
- no compatibility/version/balancing/content changes.

Verification

Run focused parser/store/publisher/SimCore tests, affected Task 16/17 descriptor-safety tests where reusable, strict TypeScript, ESLint, Prettier check, content validation, production build and git diff --check. Run a focused real Chromium case if browser-facing behavior changed.

Documentation

Update docs/status/PHASE_2_TASK_18_REPAIR_WORKING_STATUS.md with base/candidate hashes, R1 files, public decisions, tests, unresolved findings and exact next subtask 18.R2. Do not rewrite permanent checkpoint claims yet.

Final report

1. Root causes and exact fixes.
2. Files changed and preserved accumulated diff.
3. Parser/epoch/revision semantics.
4. Tests and exact results.
5. Remaining audit findings.
6. Confirmation that all changes are uncommitted/unstaged and Task 19 was not begun.

Stop after 18.R1.
```

---

## Prompt 18.R2 — Atomic deeply immutable store and callback isolation

```text
Implement OVERCLOCK Phase 2 Task 18.R2 only: atomic deeply immutable GameClientStore ownership and callback isolation.

Recommended model: GPT-5.6 Luna. Reasoning: xhigh.

Do not commit, stage, push, amend, reset, stash, or begin Task 19.

Preflight and accumulated-diff ownership

1. Read AGENTS.md, the Task 18 repair contract, independent audit, ADR-0027 and PHASE_2_TASK_18_REPAIR_WORKING_STATUS.md.
2. Confirm HEAD remains candidate 4a870d09... with parent/origin c9983782....
3. Inspect all modified/untracked files. They must contain only the two planning artifacts and reviewed R1 changes.
4. Confirm R1 focused gates passed. Preserve its public decisions.
5. Read the complete store/selectors/hooks/fake-transport implementation and tests before editing.

Implementation scope

Refactor applyPublication into strict prepare-then-commit behavior:

1. Perform all protocol and ownership validation before changing epoch, snapshot, grid revision, heatmap baseline, status or any other store field.
2. Build snapshot/grid/heatmap candidates in local variables only.
3. Deeply freeze every store-created record and array before commit, including gridSize, modules, routes, paths, positions, heatmap, heatmap.values, placement/diagnostic arrays and any rebuilt snapshot root.
4. Adopt trusted already-frozen leaf values only when their exact plain-data ownership contract was validated by R1.
5. Commit epoch, snapshot, grid, heat baseline and revision once.
6. Notify only after commit.

Callback isolation policy

- snapshot listener exceptions are swallowed and remaining listeners run;
- selector execution exceptions are swallowed, that subscription retains its last successful value and remains registered, and remaining subscriptions run;
- equality callback exceptions follow the same policy;
- selector-listener exceptions are swallowed;
- no callback exception propagates through applyPublication/resetForEpoch or changes an ApplyResult;
- reentrant subscribe/unsubscribe remains deterministic over the current notification snapshot;
- notification never exposes a partially built candidate.

Atomicity and transport behavior

- a publication that returns applied:true is committed exactly once even if callbacks fail;
- a publication that rejects or throws during pre-commit validation leaves all store fields and references unchanged;
- fake transport advances its expected sequence exactly once for an applied publication and never for a rejected one;
- callback failure after commit cannot suppress that advancement/acknowledgement;
- resetForEpoch swaps to the empty state atomically and callback failures cannot prevent completion.

Required regression-first tests

1. Every value reachable from getGridViewModel is deeply frozen.
2. Mutation attempts on gridSize, modules/routes arrays, paths, heatmap and values throw or have no effect.
3. Every value reachable from getSnapshot and named selectors is deeply frozen.
4. Retained references cannot mutate later store reads.
5. Selector execution throws after initial subscription: apply succeeds, state commits once, other callbacks run.
6. Equality callback throws with the same guarantees.
7. Listener throws with the same guarantees.
8. Throwing callbacks during resetForEpoch do not leave partial state.
9. Pre-commit candidate validation failure preserves all roots, epoch, revision, heat baseline, status and transport sequence.
10. Nested arrays/objects created by a delta remain deeply frozen.
11. Equal section/root reference preservation remains exact.
12. Reentrant subscribe/unsubscribe and 20 mount/unmount cycles remain leak-free.
13. Real Chromium round trip and callback-isolation cases.

Forbidden scope

- no command availability/projector semantic changes (R3);
- no publisher pending/heatmap changes (R4), except minimal type/API adaptation required by R1;
- no Task 19 wire parser/host/client/scheduler;
- no gameplay, persistence or React component redesign.

Verification

Run all Task 18 store tests, R1 tests, fake-client/fake-transport tests, affected shell tests, focused Chromium projection tests, strict TypeScript, ESLint, Prettier check, build, content validation and git diff --check.

Documentation and handoff

Update PHASE_2_TASK_18_REPAIR_WORKING_STATUS.md with R2 semantics, paths, tests, risks and exact next subtask 18.R3. Permanent docs remain provisional until R5.

Final report

1. Atomic prepare/commit design.
2. Deep-ownership proof.
3. Callback failure policy and transport result.
4. Files/tests/results.
5. Remaining findings.
6. Uncommitted/unstaged confirmation and no Task 19.

Stop after 18.R2.
```

---

## Prompt 18.R3 — Truthful projection and per-core memoization

```text
Implement OVERCLOCK Phase 2 Task 18.R3 only: truthful projection fields, conservative command availability, and isolated presentation memoization.

Recommended model: GPT-5.6 Luna. Reasoning: xhigh.

Do not commit, stage, push, amend, reset, stash, or begin Task 19.

Preflight

1. Read AGENTS.md, the complete repair contract/audit, Phase 2 projection policy, ADR-0027, source mapping, public command handlers/domain guards and repair working status.
2. Confirm candidate HEAD/parent/origin are unchanged and accumulated files are only planning + R1/R2.
3. Confirm R1/R2 focused gates passed.
4. Inventory every command kind currently included in commandAvailability and every pure blocker already implemented in its production handler.
5. Find every consumer of inventoryRevision before changing the presentation-only interface.

Implementation scope

A. Command availability

Implement approved R-D9. True means no known payload-independent blocker and at least one eligible target where existing pure rules can establish that cheaply. Reuse/extract production pure guards; do not copy formulas or maintain a second validation implementation.

At minimum close:
- SAVE_BLUEPRINT: unlocked feature, no active design draft, nonempty valid selected live-module set, and known completed required research;
- INSTANTIATE_BLUEPRINT: active draft, feature/research/content compatibility, and at least one structurally/current-content eligible subassembly record;
- APPLY_DESIGN: active draft, no active Benchmark lock, and an accepted pure preview exists;
- START_BENCHMARK: no active Benchmark/Research/Task and at least one unlocked definition with at least one potentially valid nonempty cluster under existing pure validation;
- START_RESEARCH, ACCEPT_TASK, allocation/hold/abandon, overclock and Undo/Redo: false for every already-known state blocker;
- unknown/dev-only command kinds remain omitted.

Do not claim payload-specific validity when the required payload is absent. Conservative false is permitted.

B. Inventory field truthfulness

Rename UiSnapshot.build.inventoryRevision to inventoryUnitCount across neutral types, fake client, projector, source mapping, selectors/tests/docs. Preserve the exact safe total-unit derivation. Do not add GameState fields or compatibility changes.

C. Memoization ownership

Remove the module-global routeIssueCache. Either:
- introduce a SimCore-owned presentation projector/runtime with private cache, instantiated with content and replaced/cleared on state replacement/runtime replacement; or
- remove memoization if the final target-host gates pass.

Independent SimCore instances and content bundles must never share mutable presentation cache. Public direct projection helpers must remain deterministic and isolated. No cache enters GameState, saves, Replay, hashes, snapshots, receipts or public serialization.

D. Source truthfulness

Reaudit every projection field and source-mapping entry after the changes. No guessed zero may replace unknown. Preserve null policy, draft/live distinction, exact labels, stored physics and shared domain formulas.

Required regression-first tests

1. Locked Blueprint feature plus live module => SAVE_BLUEPRINT false.
2. Active design draft => SAVE_BLUEPRINT false.
3. Valid unlocked selected live modules => SAVE_BLUEPRINT true.
4. Blueprint without design draft => INSTANTIATE_BLUEPRINT false.
5. Active Benchmark => APPLY_DESIGN false while draft editing remains available.
6. Active Task/Research/locked feature/no viable cluster => START_BENCHMARK false.
7. Valid cases for every command hint changed.
8. Dev/unknown commands omitted.
9. inventoryUnitCount distinguishes its truthful meaning and old inventoryRevision is absent.
10. Independent SimCore instances do not share memoization/evidence.
11. State replacement clears/rebuilds private presentation cache.
12. Equivalent projections remain deterministic across object insertion order and 100 repeats.
13. State hash, tick and RNG remain unchanged by projection.
14. Frozen source mapping covers every field and no obsolete field remains.

Forbidden scope

- no command handler acceptance semantics change except extracting a pure guard with identical results;
- no heatmap/store protocol changes beyond required type adaptation;
- no Task 19, UI component, renderer or gameplay work;
- no GameState/version/hash changes.

Verification

Run all projection/command-domain tests affected, Blueprint/Benchmark/Design/Research/Task regressions, exact-100 projection determinism, strict TypeScript, ESLint, Prettier, content validation, build, git diff --check and forbidden import/API scans.

Documentation

Update repair working status. Record every availability rule and memoization owner. Exact next subtask: 18.R4.

Final report

1. Availability matrix and reused guards.
2. Presentation field/API changes.
3. Cache ownership/lifecycle.
4. Files/tests/results and invariant hashes.
5. Remaining findings.
6. Uncommitted/unstaged and no Task 19.

Stop after 18.R3.
```

---

## Prompt 18.R4 — Owned publisher and complete heatmap protocol

```text
Implement OVERCLOCK Phase 2 Task 18.R4 only: owned pending publication state and complete heatmap patch protocol.

Recommended model: GPT-5.6 Luna. Reasoning: xhigh.

Do not commit, stage, push, amend, reset, stash, or begin Task 19.

Preflight

1. Read AGENTS.md, repair contract/audit, Task 18 Phase 2 patch rules, ADR-0027 and repair working status.
2. Confirm exact candidate ancestry and that accumulated diff contains only planning + R1-R3.
3. Confirm prior focused gates passed.
4. Read GridPublisher, store adoption, source mapping, thermal-state validation and all patch tests.

Implementation scope

A. Pending candidate ownership

- never retain caller-owned GridPublishInput, source wrapper, mutable arrays or mutable records;
- validate first, then copy/freeze exact retained fields or retain only already-validated frozen presentation roots plus copied scalar source/now fields;
- mutation of every caller-owned wrapper immediately after publish must not affect ACK, coalescing, timeout, resync or emitted bytes;
- ACK must not partially advance its acknowledged baseline before all follow-up candidate preparation that can throw; use prepare-then-commit ordering for acknowledgement as well;
- wrong sequence/base and timeout preserve exact resync semantics.

B. Full heatmap completeness

- first, explicit-resync, mode-change, dimension-change and observed-load full publications carry exactly width*height finite values in strict row-major coordinates, independent of heatmapEnabled;
- no duplicate, missing, out-of-bounds, sparse or non-finite tile can reach store authority;
- full baseline becomes the exact transmitted temperatures.

C. Delta semantics

- ordinary enabled deltas compare with last acknowledged transmitted values using content-owned epsilon;
- cumulative sub-epsilon drift is not lost;
- disabled ordinary heatmap updates emit no heat values but retain enough owned current evidence to report cumulative drift correctly when re-enabled;
- entity upserts/removals remain minimal and lexically ordered;
- source-only publications retain grid revision, changed content advances exactly one;
- full publications advance exactly one from acknowledged base.

D. Store patch validation

Before candidate construction validate publication entity IDs, duplicate upsert/removal conflicts, heat coordinates/order/coverage, finite values, source dimensions/mode, base/next and nested epoch. Do not implement general Task 19 wire schemas.

Required regression-first tests

1. First heatmap-disabled full publication still contains all 384 exact row-major tiles.
2. Full resync/mode/dimension/load paths also have complete coverage.
3. Missing, duplicate, reordered, sparse, out-of-bounds and non-finite full values reject atomically.
4. Illegal deltas reject atomically.
5. Caller mutates pending source width/revisions/now/wrapper after publish: ACK remains exact and does not throw.
6. Caller mutates input array/wrapper after publish where type erasure permits: no effect.
7. Delayed ACK with multiple candidates emits only latest state from acknowledged base.
8. Follow-up preparation failure cannot partially advance ACK baseline.
9. Timeout and explicit resync retain latest owned candidate.
10. Cumulative epsilon over multiple disabled/enabled transitions.
11. Exact removals, Undo/Redo and view-mode changes.
12. Publisher/store outputs remain deeply frozen and contain no typed scratch.
13. 100 repeated operation streams produce byte-identical publications.

Forbidden scope

- no Worker/backpressure scheduler beyond the existing one-in-flight publisher primitive;
- no renderer/heatmap UI;
- no gameplay formulas or Task 19;
- no threshold/sample weakening.

Verification

Run all patch/store/projection tests, thermal/grid/design regressions, exact-100 patch determinism, focused Chromium projection scenarios, typecheck/lint/format/content/build/diff-check and forbidden API/import scans.

Documentation

Update repair working status with exact ACK transaction semantics, owned pending representation, full/delta rules and next subtask 18.R5.

Final report

1. Ownership and ACK transaction design.
2. Full/delta heatmap contract.
3. Protocol validation.
4. Files/tests/results.
5. Remaining findings.
6. Uncommitted/unstaged and no Task 19.

Stop after 18.R4.
```

---

## Prompt 18.R5 — Executable diagnostics and permanent documentation

```text
Implement OVERCLOCK Phase 2 Task 18.R5 only: performance/verification hardening and permanent Task 18 documentation reconciliation.

Recommended model: GPT-5.6 Luna. Reasoning: xhigh.

Do not commit, stage, push, amend, reset, stash, or begin Task 19.

Preflight

1. Read AGENTS.md, repair contract, independent audit, ADR-0027, projection diagnostic, PROJECT_STATUS, Phase 2 contract, TDD and repair working status.
2. Confirm candidate ancestry and that every accumulated implementation path belongs to R1-R4.
3. Confirm all R1-R4 focused gates passed.
4. Reproduce current diagnostic before optimization. Record actual CPU, OS, Node, build mode and host load limitations.

Diagnostic fixture requirements

Build/extend an audited N fixture that is valid under current production admission and contains:
- 24 by 16 grid with at least 75 percent occupied tiles;
- mixed module footprints/rotations and real routes;
- active Power, Thermal, Overclock and Useful Compute;
- active Task and active Research represented in the truthful projection workload without violating production exclusivity;
- exactly eight valid Blueprint records;
- representative completed Benchmark history and best mapping; if active Benchmark conflicts with active Task/Research, measure a separate valid benchmark variant rather than constructing impossible state;
- nonuniform heatmap values and a genuine due patch;
- all current Phase 1 production tick systems for the direct complete-tick measurement.

Use public/validated construction helpers. Do not bypass admission or inject impossible state.

Executable hard gates

The script must throw/exit nonzero when a hard target-host gate fails:
- pure projection N: 500 samples after 100 warm-ups, p95 <1 ms;
- project + publish + encode N: 500/100, p95 <2 ms;
- store processing N: 500/100, p95 <5 ms;
- direct complete production tick: retain the existing audited Phase 1 sample/warm-up contract, p95 <4 ms.

Also report combined complete tick + due projection separately against <6 ms and keep L report-only with its fixed documented counts. Report cold construction separately. Do not hide setup, validation, first-full work or transition work in warm measurements where the operation claims to include them.

Allowed optimization

- measured allocation reduction;
- per-SimCore private memoization;
- structural sharing and validated frozen value reuse;
- avoiding duplicate stable work;
- targeted validation that preserves the same contract.

Forbidden optimization

- changing formulas, null policy, canonical ordering or epsilon;
- lowering density/branch coverage;
- reducing sample/warm-up/repetition counts;
- raising thresholds/timeouts;
- dropping validation, freezing, ownership or ACK work;
- filtering samples or rerunning until favorable;
- calling a miss a pass without a new explicit owner waiver.

Permanent documentation reconciliation

1. Update ADR-0027 to match repaired implementation, true cache owner, final protocol and actual gates.
2. Update PHASE_2_PROJECTION.md with audited fixture, executable-gate behavior and fresh target-host results.
3. Replace the stale Task 18 section in PROJECT_STATUS with checkpoint-neutral text rooted at public CP17 c998378.... Do not invent the final CP18 SHA.
4. Update TDD/README only where the repaired public interface or run instructions require it.
5. Keep the independent audit and repair contract as permanent historical planning/evidence artifacts.
6. Merge useful repair working-status evidence into permanent docs and delete PHASE_2_TASK_18_REPAIR_WORKING_STATUS.md.
7. Delete docs/status/PHASE_2_TASK_18_EXECUTION_LOG.md after merging any still-useful evidence; it records obsolete ancestry and refuted conclusions.
8. Permanent wording must not claim uncommitted, awaiting review, local checkpoint, or a future SHA.

Required verification before handoff

- all Task 18 focused/adversarial tests;
- affected Task 16/17 and Phase 1 domain regressions;
- complete unit suite once;
- standalone determinism suite once, preserving exact-100 tests;
- full Chromium projection and shell E2E;
- corepack pnpm validate;
- strict TypeScript, ESLint, Prettier, content validation and build;
- git diff --check;
- forbidden sim browser/time/storage/API scans;
- production-to-devtools/harness and bundle scans;
- compatibility vectors;
- balancing/module/GDD/Word/lockfile drift inspection;
- fresh target-host diagnostics with nonzero failure behavior proved by a controlled test of the gate function, not by weakening the real threshold.

If any hard gate fails, preserve evidence, leave everything uncommitted, and report the blocker. Do not proceed by documenting a technical miss as a pass.

Final report

1. Closed audit finding matrix T18-A01 through T18-A10.
2. Final public contracts and ownership.
3. Exact files and deleted temporary/stale files.
4. Focused/unit/determinism/E2E/validation results.
5. Compatibility and drift results.
6. Target-host performance table and executable gate behavior.
7. Documentation state.
8. Remaining risks and CP18-R readiness.
9. Confirmation changes remain unstaged/uncommitted and Task 19 was not begun.

Stop before CP18-R. A fresh Sol task performs the checkpoint.
```

---

## Prompt CP18-R — Independent repair review, amend, and publish

```text
Perform the independent OVERCLOCK Phase 2 Task 18 repaired checkpoint review.

Recommended model: GPT-5.6 Sol. Reasoning: high.

Do not begin Task 19 or Phase 3.

Repository identity

Expected worktree/branch:
D:\miscellaneous\Overclock\cp18_audit
branch cp18-audit

Expected local candidate HEAD before amendment:
4a870d09c4bbd7a3fe41d9fdf4c39bbcc43cebd2

Expected candidate parent and public origin/main:
c998378286b3e5bda6013636c615fdeee5d22063

Expected current candidate subject:
feat: add owned presentation snapshots and revision patches

The complete reviewed R1-R5 repair is expected as an unstaged/uncommitted diff on top of that local candidate. The local candidate was never published, so the successful checkpoint must amend it into one clean Task 18 commit whose parent remains public CP17. Never force-push.

Preflight

1. Read every applicable AGENTS.md.
2. Fetch origin read-only and verify origin/main/remote main equal c998378....
3. Verify HEAD/parent/subject exactly as above, nothing staged, and no unrelated files.
4. Read the Phase 2 contract, independent audit, repair contract, ADR-0027, diagnostic, PROJECT_STATUS, TDD and every changed file.
5. Reconstruct the contract independently; do not trust Luna reports or old CP18 claims.
6. Confirm PHASE_2_TASK_18_REPAIR_WORKING_STATUS.md and the stale Task 18 execution log are absent from the final intended tree.

Mandatory finding audit

Independently reproduce and verify closure of T18-A01 through T18-A10:

1. every store output is deeply immutable;
2. selector/equality/listener failures cannot escape or misreport a committed apply;
3. failed first adoption cannot bind epoch;
4. wrapper/grid/store/transport epochs agree;
5. pending publisher input is owned against caller mutation;
6. PresentationContext and store admission reject accessors without executing them;
7. commandAvailability has no known-blocker true values, including Blueprint, Benchmark and Apply cases;
8. full heatmaps contain exact complete row-major coverage even when disabled;
9. inventoryUnitCount is truthful and inventoryRevision is absent;
10. docs, ancestry, cache ownership and performance evidence match implementation.

Also adversarially review:

- sparse/custom/subclassed/prototype-bearing arrays and records;
- duplicate IDs, unknown keys, symbols, negative zero and unsafe revisions;
- initial/full/delta/source-only revision transitions;
- dropped/wrong/delayed ACK, timeout, explicit resync and epoch reset;
- removal/upsert conflicts and heatmap bounds/duplicates/nonfinite values;
- callback reentrancy and 20 mount/unmount cycles;
- independent SimCore instances, replacement cache clearing and retained-reference mutation;
- exact-100 publication/projection determinism with unchanged RNG/hash;
- no mutable presentation cache or values in GameState/save/Replay/public receipts.

Correct any in-scope Critical or Important defect and add a regression test. Do not weaken contracts or implement Task 19. If a correction changes an approved public decision, stop without checkpoint and report it.

Required final gates

Run from a clean dependency state where practical:

- all Task 18 focused and adversarial tests;
- affected Design, Blueprint, Benchmark, Research, Task, Thermal, Power, Replay, save-codec and repository regressions;
- complete pnpm test twice in separate processes;
- standalone determinism and exact-100 tests;
- corepack pnpm validate;
- complete pinned Chromium E2E;
- strict TypeScript, ESLint, Prettier, content validation and production build;
- git diff --check and later git diff --cached --check;
- forbidden simulator API/import scans;
- production-to-devtools/harness and dist bundle scans;
- compatibility vectors;
- balancing/module numeric/GDD/Word/lockfile drift checks.

Performance checkpoint

Run the unchanged repaired executable projection diagnostic on the documented i7-2600 target host. All hard gates must pass legitimately:

- pure projection N p95 <1 ms;
- project + publish + encode N p95 <2 ms;
- store processing N p95 <5 ms;
- direct complete production tick p95 <4 ms;
- combined complete tick + due projection p95 <6 ms if retained as a hard integration row.

Keep exact fixture branches, sample counts and warm-ups. Report cold/setup separately. Do not filter, repeat-until-pass, change threshold, or apply the unrelated Phase 1 Benchmark exception. If any hard Task 18 gate misses, do not amend, commit or push.

Checkpoint conditions

Proceed only if:

- no Critical or Important finding remains;
- all correctness, determinism, browser and hard performance gates pass;
- permanent docs are checkpoint-neutral and accurate;
- final diff from c998378 contains only Task 18 implementation/tests/docs plus the independent audit and repair contract;
- no temporary handoff, probe, output, test artifact or dependency link is tracked;
- Task 19 is absent.

Checkpoint procedure

1. Build an explicit reviewed allowlist. Never use blind git add -A.
2. Stage only that allowlist.
3. Review the full staged diff from parent c998378 and staged file list.
4. Run git diff --cached --check, strict TypeScript and a focused staged smoke.
5. Because the candidate commit is local and unpublished, amend it without changing the subject:
   git commit --amend --no-edit
6. Verify the amended commit has parent c998378... and exact subject:
   feat: add owned presentation snapshots and revision patches
7. Push normally to origin/main without force.
8. Verify local HEAD, origin/main and remote main are identical, ahead/behind 0/0, and worktree clean.

If remote main changed, any gate fails, or ownership is unclear: do not amend/push; preserve the reviewable worktree and report the exact blocker.

Final report

1. Final commit SHA, parent and subject.
2. Exact committed allowlist.
3. Findings independently reproduced and closure evidence.
4. Any additional defects corrected.
5. Focused/unit/determinism/E2E counts and both complete runs.
6. Compatibility/hash/RNG evidence.
7. Target-host performance table.
8. Ownership, protocol, callback and rollback conclusions.
9. Documentation and removed temporary artifacts.
10. Remote synchronization and clean-state evidence.
11. Deferred Task 19 scope and confirmation it was not begun.

Stop after CP18-R.
```
