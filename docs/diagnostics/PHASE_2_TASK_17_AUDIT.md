# Phase 2 Task 17 Independent Checkpoint Audit

## Scope

This audit reviews Task 17.1 through 17.4 against the approved Phase 2 contract and the repaired
Task 16 checkpoint `40955ee1cc258c297cf4cda025efe3d76eb48490`. Task 18 is excluded.

## Candidate lineage

- Approved base: `40955ee1cc258c297cf4cda025efe3d76eb48490`.
- Original local Task 17 commit: `9520b30b0ce12edcb947ed833f204d7f2a6cd3ff`, based on the
  interrupted pre-hardening Task 16 commit `4255537c4cd837946a443235c2b6cd6011ebf508`.
- Audit candidate: Task 17 reapplied onto the approved base in an isolated worktree. The only
  cherry-pick conflict was the stale Task 16/17 status text in `PROJECT_STATUS.md`.

## Findings

### Important: Task 17 was not compatible with the approved Task 16 codec boundary

The repaired Task 16 codec requires a validated `ContentBundle` for every public encode and decode
operation. Task 17 fixtures, browser harnesses, diagnostics, and production import/export/load
callers still used the earlier codec signature. The initial independent focused run therefore failed
55 of 131 tests with `content === undefined` inside `hashSimulationContent`.

Required correction:

- propagate validated current content to every Task 17 codec operation;
- preserve the Task 16 rule that public encode/decode performs full current-content and GameState
  admission;
- reconcile the incompatible-content preview behavior without restoring an unadmitted public codec
  path or deriving gameplay preview fields from an inadmissible state;
- add integration coverage that would fail if Task 17 is tested against the pre-hardening codec.

### Important: permanent status described an obsolete and uncertified base

The original Task 17 status text said that CP16 remained uncertified, named `4255537` as the
de-facto base, and referenced removed Task 16 handoff files. The checkpoint candidate now retains the
certified Task 16 status and describes Task 17 as under independent review on `40955ee`.

### Critical: inactive-slot mutations bypassed the Web Lock owner

Import overwrite and slot deletion could call the repository core without acquiring
`overclock-slot:<slotId>`. A second tab could therefore bind the same stored revision/epoch while
the active tab still held the lock and commit through the core. The repaired boundary must acquire
the destination lock nonblockingly, re-read metadata while holding it, bind the transaction to the
new owner epoch, and release the short-lived lock after success or failure. Real two-context tests
must cover overwrite/delete versus an active writer and stale-epoch rejection after tab death.

### Important: the frozen v1 autosave store did not use its contracted compound key

The candidate created every store with out-of-line string keys and encoded autosaves as padded
`slot:sequence` strings. The approved schema requires the native compound key
`[slotId, captureSequence]`. This must be corrected before the first durable v1 checkpoint so a
future database migration is not required solely to reach the already-approved v1 schema.

### Important: upgrade failure could commit a partial schema

`onupgradeneeded` caught store-creation failures but did not explicitly abort the versionchange
transaction. Swallowing the exception could let stores created before the failure commit. The
adapter must abort the upgrade transaction and regression coverage must fail after at least one
store creation while proving that no partial v1 schema becomes usable.

### Important: import candidate ordering and invalidation were invocation-unsafe

A failed/incompatible preview did not invalidate the previous token, and a slow earlier preview
could publish after a faster later preview. The service must invalidate at invocation start, use a
monotonic invocation generation, publish only the newest completion, and erase expired candidates.

### Important: repository validation was accessor-unsafe and structurally shallow

The prepared-pair path called `structuredClone` before descriptor-safe parsing, so a caller getter
could execute. Stored metadata accepted non-finite/unsafe counters and malformed recovery locators,
and settings were cloned without the strict settings parser. Exact stored-record validation,
overflow guards, key/value coherence, and parser-first ownership are required before arithmetic or
commit.

### Important: browser evidence did not exercise every claimed production path

The abort-after-request-success case used raw IndexedDB, quota was injected before a production
transaction, and the lock lifecycle used explicit session close rather than actual page death. The
checkpoint needs production-adapter abort coverage, accurately labelled quota seam evidence, and a
real page-close/takeover/stale-epoch scenario.

### Important: repository performance fixture was not the contracted dense fixture

The repository diagnostic used a new-game state plus synthetic Blueprint records, while the Task 17
contract inherits the dense 24 x 16 active Phase 1 fixture. The diagnostic must reuse the audited
dense state and report preparation separately from commit/import work.

### Checkpoint hygiene pending

The original local checkpoint retained Task 17 working-status and execution-log artifacts even
though the CP17 contract requires useful evidence to be merged into permanent documentation and
temporary handoff/probe artifacts removed. Their final disposition remains part of this audit.

## Corrections applied

- Task 17 now composes the repaired Task 16 current-content codec boundary. Public encode/decode
  remain fully admitted; only an internal import inspector can describe an incompatible artifact.
- Import overwrite and inactive-slot deletion acquire the destination Web Lock, bind revision/epoch
  while it is held, and retain repository transaction fencing as the final race guard.
- The frozen v1 autosave store uses native `[slotId, captureSequence]` keys. Existing malformed v1
  schemas are refused, and failed upgrades explicitly abort the versionchange transaction.
- Preview invocation generations prevent out-of-order publication; every invocation invalidates the
  previous token and expired candidates are erased.
- Repository inputs and stored records are descriptor-safely parsed before cloning or arithmetic.
  Exact keys, safe counters, overflow, locators, settings and key/value coherence are enforced.
- Chromium now exercises production-adapter rollback, same-origin multi-tab locking, real page
  death/takeover, stale writer rejection and import-overwrite exclusion.
- The permanent performance diagnostic uses the dense 24 x 16 active Phase 1 fixture and separates
  preparation, transaction commit, preview and confirmation.
- Temporary Task 17 handoff/execution logs are removed after their useful evidence is merged into
  ADR-0024 through ADR-0026, PROJECT_STATUS and the permanent diagnostics.

## Verification log

- Initial focused integration run: 10 files, 131 tests; 76 passed and 55 failed. All failures traced
  to missing repaired-CP16 integration and led to the corrections above.
- Independent semantic review: two Critical and six Important findings reproduced; every finding
  has a regression test or permanent browser/diagnostic evidence.
- Final focused save/repository selection: 9 files, 139 tests passed.
- Complete suite, process 1: 79 files/1,359 unit tests and 15 files/23 determinism tests passed.
- Complete suite, process 2: identical 1,359 unit and 23 determinism tests passed.
- Chromium: 19/19 passed.
- Prettier, ESLint, strict TypeScript, content validation, production build and `git diff --check`:
  passed.
- Target i7-2600 diagnostics: canonical encode N p95 19.18 ms; repository preparation 118.64 ms;
  manual commit 2.39 ms; rotation 10.33 ms; preview 346.40 ms; confirmation 124.30 ms; complete
  import 469.99 ms. Every mandatory budget passed.

## Final verdict

READY FOR CP17 CHECKPOINT. No Critical or Important defect remains in the reviewed Task 17 scope.
Task 18 was not reviewed or included.
