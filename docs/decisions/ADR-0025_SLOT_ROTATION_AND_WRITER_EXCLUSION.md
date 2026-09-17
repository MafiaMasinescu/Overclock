# ADR-0025: Slot Rotation and Writer Exclusion

## Status

Accepted for Phase 2 Task 17. It defines autosave rotation, Web Lock ownership,
writer sessions, and the lock boundary for inactive-slot mutations. It does
not implement autosave timers, Worker hosting, recovery UI, or gameplay UI.

## Context

ADR-0024 stores one manual generation per slot with revision and writer
fencing but leaves the `autosaves` store empty and ownership unbound: any
caller with a revision number could write, and no rule caps history growth.
Phase 2 needs bounded history (newest three autosaves per slot sharing the
same capture sequence as manual saves) and single-writer exclusion across
tabs without silent overwrites or lease takeovers.

## Decision

Autosave writes consume the shared monotonic `nextCaptureSequence`, insert
one generation, then prune to exactly the newest three distinct captures in
the same transaction that advances the revision and the recovery locator.
Manual saves consume the sequence but never participate in pruning; recovery
ordering follows `captureSequence`, never wall-clock timestamps.

Writer exclusion uses platform Web Locks named `overclock-slot:<slotId>`.
Opening a session acquires the lock, then binds writes to a fresh writer
epoch via `rotateWriterEpoch`; messages from a released session carry the old
epoch and fail with `STALE_WRITER` even if delivered late. Ownership is
checked before revision (`STALE_WRITER` precedes `STALE_REVISION`) because a
revision from another owner generation is meaningless. A second tab receives
an explicit busy signal for writing while reads stay lock-free. A missing
Web Locks capability is a `STORAGE_ABORTED` capability error, never a silent
single-tab fallback. Lock loss (tab death) frees the lock at the platform;
takeover rotates the epoch again, so the dead session's writes go stale
instead of interleaving.

Import overwrite and inactive-slot deletion use the same nonblocking
`overclock-slot:<slotId>` lock. They re-read and bind revision/epoch while the
lock is held, then release it after success or failure. The low-level
repository core remains an atomic/fenced primitive; production callers enter
through the lock-owning service/session boundary.

## Consequences

- History per slot is bounded: one manual plus three autosaves, all fenced.
- Concurrent tabs fail loudly (`SLOT_BUSY` shape via the busy result,
  `STALE_WRITER`, `STALE_REVISION`) instead of overwriting.
- Import confirmation reuses the prepared-pair write path and fencing errors;
  Task 20.1 timers only need to call
  `writeAutosave` when their dirty generation changes.
- Chromium proof covers cross-tab exclusion, import lock ownership, commit
  durability across reload, real page death, epoch takeover, and stale writer
  rejection.

## Implementation notes

`repository.ts` gains `writeAutosave` (insert, prune, locator, all atomic),
`listAutosaves` (newest-first), `readAutosave`, and `getLatestRecovery`;
`MAX_AUTOSAVE_ROTATIONS = 3` lives in `persistenceLimits.ts`. `webLocks.ts`
owns the lock adapter plus a tab-scoped in-memory `LockManager` fake with
FIFO waiters, abortable waits, and close-releases-locks tab-death semantics.
`slots.ts` owns `WriterSession` (revision tracking, refresh, guarded close)
and lock-guarded inactive-slot deletion. Chromium uses tabs in one browser
context so IndexedDB and Web Locks match real same-origin tab behavior.

## Verification

The final CP17 matrix is summarized in ADR-0024. On the target i7-2600 dense
fixture, autosave rotation p95 is 10.33 ms against the 250 ms budget. The
complete fault/concurrency matrix passes in Chromium; detailed evidence is in
`docs/diagnostics/PHASE_2_REPOSITORY.md`.
