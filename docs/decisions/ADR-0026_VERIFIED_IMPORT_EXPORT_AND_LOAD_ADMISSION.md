# ADR-0026: Verified Import, Export, and Load Admission

## Status

Accepted for Phase 2 Task 17. It defines the import preview/confirmation
protocol, slot export, and load admission; it does not implement Worker
transport epochs, host promotion, autosave timers, recovery UI, or dialogs.

## Context

ADR-0024/0025 make committed generations durable and fenced, but bytes can
only enter through gameplay capture. Phase 2 needs a verified side door for
external files: preview what a file holds without writing, confirm exactly
the previewed candidate into a chosen destination, export a committed
generation back to bytes, and admit a stored generation for a future load —
all without touching the live run and without trusting filenames, clocks, or
cached previews.

## Decision

Preview inspects the envelope (checksum before parsing), migrates copy-only,
and descriptor-safely extracts bounded scalar preview fields. Compatible
candidates must additionally match the simulation fingerprint and pass full
production state admission with the captured queue sequence and expected
state hash before becoming committable. Incompatible or inadmissible files
return a reasoned preview with no token. Inspection is an import-only internal
boundary; public decode remains fully admitted against current content. A committable
preview stores exactly one owned candidate plus a token binding source
digest, migrated candidate digest, content fingerprint, destination plan
(including the bound revision and writer epoch for overwrites), and a
five-minute monotonic creation mark. Every preview invocation invalidates the
old candidate first; a monotonic generation prevents an older slow invocation
from replacing a newer result. Expired candidates are erased.

Confirmation re-proves the candidate digest, re-resolves content, acquires the
destination Web Lock nonblockingly, enforces the bound destination and
revision, refuses actively simulated slots, then
rebinds the owned candidate to the destination with a fresh checksum (source
bytes untouched) and commits the slot plus optional settings application in
one repository transaction. The token burns only on success; failures retain
it for retry. Overwrite races fail as `SLOT_BUSY`, `STALE_REVISION`, or
`STALE_WRITER`; the transaction rechecks ownership and revision while the lock
is held.

Export reads metadata and manual bytes in one read-only transaction, verifies
the expected revision, re-serializes the stored envelope through the single canonical rule,
re-verifies its checksum by decoding, and returns fresh owned bytes; stored
timestamps and contents never change, and the path is read-only. Load
admission decodes a stored manual or autosave generation, re-checks content
compatibility, admits through a fresh production core, and returns an
isolated candidate with the captured queue sequence. Transport-epoch binding
of tokens is a Task 19 concern: pre-Worker tokens never leave the service,
so no cross-epoch replay exists yet.

## Consequences

- External files enter durability only through one verified, bound,
  single-use gate; substitution, replay, and silent overwrite are typed
  errors, not edge cases.
- Settings travel inside every save but apply globally only on explicit
  confirmation, in the same transaction as the slot.
- Task 20.2/20.3 can build host promotion, timers, and dialogs on
  `confirmImport`, `exportSlot`, and `admitLoadedSave` without new storage
  primitives; the `isSlotActive` predicate already wires the future host.
- There is no public codec admission gap: public encode/decode remain fully
  current-content admitted. Only the import preview inspector can describe an
  incompatible artifact, and it cannot produce a committable candidate.

## Implementation notes

`repository.ts` gains atomic `commitImport` (new-slot create plus save, or
fenced overwrite, optionally with settings, in one transaction);
`codec.ts` gains `encodeEnvelopeBytes` (single canonical rule for stored
envelopes, reusing envelope safety limits after finding that default string
limits reject the multi-kilobyte payload string). `import/importService.ts`
owns preview/confirm plus the future-client error table;
`export/exportService.ts` owns verified read-only export;
`load/loadAdmission.ts` owns isolated load candidates. Focused coverage includes
substitution, expiry, invocation-order races, active-lock refusal, destination
drift, quota retry, corruption, and an export-to-import round trip.

## Verification

The final CP17 matrix is summarized in ADR-0024. On the target i7-2600 dense
fixture, import preview p95 is 346.40 ms, confirmation p95 is 124.30 ms, and
complete preview-plus-confirm p95 is 469.99 ms. All are below their Phase 2
budgets. Real Chromium covers verified import/export, overwrite races, active
slot exclusion, reload, and corruption/fault behavior.
