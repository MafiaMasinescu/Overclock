# ADR-0029: Durable autosave, recovery, and local reports

Status: Accepted for Phase 2 Task 20.

## Context

Tasks 16 and 17 define detached save bytes and the atomic local repository. Tasks 18 and 19 define
owned presentation, the Worker protocol, scheduler, and `GameClient`. Task 20 connects those
boundaries into a usable local browser loop without changing Phase 1 simulation behavior or adding
cloud services, telemetry upload, or gameplay UI.

## Decision

### Worker capture and autosave

`SimWorkerHost` captures a detached `GameState` and `nextQueueSequence` at a synchronous empty-queue
barrier. A private dirty generation tracks committed state, queue, settings, and local-stat changes;
capture hashing is not added to the tick path. Manual and autosave writes use the existing
repository and writer-epoch/revision fences. The host reports a save only after the repository
transaction completes.

Foreground autosaves run at 60-second monotonic intervals when dirty. Committed Task and Research
completion, Benchmark start/terminal transitions, Campaign year changes, vertical-slice completion,
pause/unpause, and visibility changes request coalesced captures. The host keeps one in-flight save
and one newest pending capture. Three distinct autosave generations are retained; manual saves do
not consume rotations. Hiding requests a best-effort dirty save and never claims forced-close
durability.

Committed lifecycle observation reads a detached fact projection. The projection now carries
Campaign year and vertical-slice completion so the host can observe these boundaries without
changing tick order, events, or deterministic state.

Heartbeat lifecycle transitions are published at maintenance entry and exit as well as on the
periodic heartbeat. This keeps the five-second bound for one stuck maintenance operation while
preventing a sequence of individually short saves from appearing to be one continuous operation.
Maintenance elapsed time remains excluded from the simulation clock.

### Load, recovery, and import

Load prepares and fully admits a candidate before promotion. Successful promotion sends
`SESSION_REPLACED`, rotates the epoch, publishes the full `READY` snapshot, and holds scheduling
until Continue. Other pending old-epoch requests fail as `SESSION_REPLACED`; stale old-epoch replies
are ignored, and the client never retries a command.

Recovery starts a fresh Worker, re-verifies the newest durable generation, and falls back through
older autosaves to the latest valid manual save in capture-sequence order. It reports skipped damaged
generations without deleting them and exposes recovered tick/year plus the possible-loss interval
when a prior live tick is known. A failed candidate leaves the previous live authority intact.

Slot summaries select the newest cached preview, including autosave-only slots, and label it
`unchecked`. Load and export verify the chosen generation before use; export also fences the record
and slot revision in a read-only transaction. A malformed manual record does not block listing an
otherwise usable autosave. A manual record may
legitimately carry an older revision than slot metadata because later autosaves advance metadata;
it is invalid only if its own revision is ahead. Listing skips recognized corrupt records but
propagates storage failures. Import remains a separate explicit preview and
confirmation flow, bound to destination revision. Imported device settings are not applied unless
the user checks the explicit option.

A new run defers creation of its repository slot and writer lock until its first durable save. This
keeps listing and deletion available when 20 durable slots already exist. The capacity check occurs
in the transaction that first makes a slot durable, so a 21st durable slot cannot commit. Failed
import confirmation returns data prepared before the durable transaction, avoiding a false failure
from an informational read after commit. A failure while releasing the short-lived import lock after
commit also preserves the committed success outcome and consumes its token.

### Local reports and shell

Reports are schema-validated, allowlisted local records capped at 64 KiB each and 20 retained
records. A reserved sequence record preserves deterministic pruning order after deletions. Reports
contain no free text, raw state, file path/name, URL, stack, user agent, CPU identity, or personal
data. Creation, listing, export, and deletion are explicit local actions; there is no upload or
analytics path.

The shell exposes the persistence operations through public `GameClient` methods and Romanian and
English strings. Import cancellation preserves the selected source bytes. Overwrite shows the
destination slot and revision in an explicit confirmation and uses the bound preview token. During
an epoch handoff, React keeps rendering the
last accepted snapshot until the replacement `READY` publication arrives; it does not read the
temporarily empty store as a new game state.

## Consequences

`GameState`, save version, Replay version, RNG, tick order, and canonical hashes remain unchanged.
The added lifecycle projection fields are read-only host evidence. Browser persistence remains local
and subject to browser storage eviction. Manual export remains the user's portable backup.

## Verification

Task 20 browser timing uses the production Worker, IndexedDB, Web Locks, and dense N fixture. Exact
host details, sample cohorts, p95 gates, and measurements are recorded in
`docs/diagnostics/PHASE_2_PERSISTENCE.md`. Task 20 unit, deterministic, content, type, build, lint,
and browser results are recorded in `docs/status/PROJECT_STATUS.md`.
