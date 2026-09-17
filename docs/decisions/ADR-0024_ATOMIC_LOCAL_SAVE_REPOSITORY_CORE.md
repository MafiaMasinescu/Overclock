# ADR-0024: Atomic Local Save Repository Core

## Status

Accepted for Phase 2 Task 17. It defines the frozen version-1 IndexedDB schema
and typed atomic repository core. ADR-0025 and ADR-0026 compose rotation,
locking, and verified import/export. Worker hosting, autosave scheduling,
recovery UI, and gameplay UI remain deferred.

## Context

Task 16 delivers detached verified bytes: strict schemas, bounded traversal,
full-state admission, a canonical envelope codec with SHA-256, and a copy-only
synthetic schema-0 migration. Those bytes are not durable yet. Phase 2 needs a
browser-local store where one transaction commits a slot record together with
its fencing metadata, where a single request succeeding is never mistaken for
durability, and where concurrent sessions cannot silently overwrite each other.

The pre-Phase-2 `SaveRepository` sketch (`list/read/write/delete` plus a bare
`rotateAutosave`) has no revision fencing, no writer ownership, no capture
sequencing, and no transaction-completion rule, so it cannot carry the §10
concurrency contract.

## Decision

The database is `overclock`, version 1, with stores `saves` (key `slotId`),
`autosaves` (native compound key path `[slotId, captureSequence]`),
`slotMeta` (key `slotId`), `settings` (key `global`),
`reports` (key `reportId`), and a reserved empty `blueprints` store that
freezes the v1 shape without behavior.

Every slot carries `SlotMetaRecord { revision, nextCaptureSequence,
writerEpoch, latestRecovery }`. Manual saves and autosaves consume the same
monotonic `nextCaptureSequence`; manual records store their consumed sequence
but never participate in rotation pruning. Recovery locators persist only in
the same transaction as their referenced envelope, and recovery chooses by
`captureSequence`, never by wall-clock timestamp.

Every mutation checks expected `revision` plus `writerEpoch` fencing inside
one readwrite transaction and updates the record and its metadata atomically:
mismatched revision reports `STALE_REVISION`, a changed epoch reports
`STALE_WRITER`, and the losing candidate leaves storage untouched. Success
resolves only on transaction completion, never on single-request success. An
aborted upgrade preserves prior stores. Store creation failure explicitly
aborts the versionchange transaction, and an existing version-1 database is
admitted only when every store and the autosave compound key match the frozen
schema. The database is never deleted to recover an error; `versionchange`
closes the connection and blocks further
mutations until reopened. Missing slots report `INVALID_STATE` (the stable
error list has no not-found code). At most 20 manual slots exist;
slot/global-settings writes use independent revision counters.

All hashing, compression, and canonical encoding run in the caller before a
readwrite transaction opens. The repository accepts an already prepared
`{ envelope, preview }` pair, descriptor-safely validates its exact owned
plain-data shape synchronously, and writes. Stored metadata, settings,
locators, revisions, epochs, and sequence counters are parsed before use;
accessors, unknown keys, unsafe integers, overflow, and key/value disagreement
are rejected.
No async crypto, compression, or arbitrary await runs inside a live
transaction. An immutable operation token captured during preparation turns a
late completion into `CANCELLED` instead of a stray commit.

Storage sits behind an injected transactional boundary with identical commit
semantics in production IndexedDB and in the Node in-memory fake, so unit
tests prove request-success-followed-by-abort, quota, and fencing behavior.
The permanent Chromium matrix also executes abort-after-request-success
through the production adapter and verifies committed generations after reload.

## Consequences

- Concurrent tabs and stale Workers fail loudly with typed errors instead of
  overwriting durable saves.
- Durability claims rest on transaction completion, matching the browser
  platform rather than request callbacks.
- Rotation and Web Locks compose on `nextCaptureSequence` and
  `rotateWriterEpoch` without reshaping stored records.
- Preview tokens, import, export, and load compose on the prepared-pair write
  path without duplicating transaction logic.
- The repository remains browser-local infrastructure. It does not enter the
  deterministic simulator domain or production bundle until a later host owns
  it.

## Implementation notes

`src/save/repository/types.ts` owns the schema constants and record shapes;
`storage.ts` owns the injected boundary, compound-key identity, the error map, and the fault
capable in-memory fake; `indexedDb.ts` owns the real adapter with
open/blocked/versionchange handling; `repository.ts` owns fencing, sequencing,
and atomic slot/settings/delete paths. Focused repository coverage includes
abort-after-success, quota preservation, stale fencing, cancellation,
descriptor-safe hostile input, counter overflow, compound autosave identity,
and atomic delete with an unrelated slot untouched.

## Verification

The final CP17 matrix on Windows `win32-x64`, Node `v24.11.0`, includes 139
focused save/repository tests, 1,359 complete unit tests, 23 determinism tests
in each of two clean processes, and 19 Chromium tests. Strict TypeScript,
ESLint, Prettier, content validation, production build, drift scans, and
`git diff --check` pass. Permanent timing evidence is recorded in
`docs/diagnostics/PHASE_2_REPOSITORY.md`.
