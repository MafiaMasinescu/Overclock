# ADR-0028: Worker host, scheduler, and GameClient

Status: Accepted for Phase 2 Task 19.

## Context

Phase 2 needs one production `SimCore` in a dedicated browser Worker and one `GameClient` bridge for
the shell. Phase 1 keeps ownership of deterministic state, command ordering, RNG, ticks, and Replay.
The Task 18 projection and publication contracts remain the only presentation boundary. The earlier
TDD worker sketches are refined here where they conflict with the Phase 2 contract.

## Decision

`src/app/worker/protocol.ts` defines exact version-1 request and reply envelopes. Descriptor-safe
admission, bounded traversal, strict schemas, epoch checks, monotonic directional sequences, and
request correlation happen at the wire boundary. Commands reuse the existing Phase 1 parser. The
client never retries an unknown command outcome.

Terminal replies reserve bounded host capacity before the request enters the serial operation
queue. At most 512 terminal results may be reserved or remain unacknowledged. `ACK_RESULT` is a
one-way transport message that releases a result slot and receives no reply; if the queue cannot
reserve another slot, the host enters a sanitized transport-fatal state. Existing result
acknowledgements remain admissible after a fatal so clients can release completed results, while
later requests receive `OUTCOME_UNKNOWN` and are never replayed.

`SimWorkerHost` owns one production core and serializes requests, clock commands, scheduler work,
captures, and maintenance. Gameplay commands enqueue and immediately call
`processPendingCommands()` at the current tick. Clock changes use `applyClockCommand()` and consume
no command queue sequence. The 25 ms host wake measures monotonic elapsed time, applies the active
speed to a 100 ms accumulator, and runs at most 20 ordinary `step(1)` ticks before yielding. Pause,
visibility loss, long gaps, and asynchronous maintenance hold the scheduler and reset its timing
origin. Continue starts from a fresh origin; no offline progress is inferred.

Capture is a serialized empty-queue barrier. It returns detached state and queue position without
serializing the complete state during ordinary ticks. Maintenance excludes its elapsed time from
simulation. Fatal errors stop scheduling/admission and preserve completed command/tick commits
according to Phase 1 semantics. Unknown outcomes are not replayed. Durable load, save, import, and
recovery requests remain unavailable until Task 20.

The production entry constructs the host around the browser Worker global and exposes no debug-step
request. Test-only manual timer controls live in `tests/e2e/fixtures/workerManualEntry.ts`; production
build scanning verifies they do not enter the application bundle.

`createWorkerGameClient()` owns one dedicated Worker, request promises, the stable store, event/control
subscriptions, heartbeat and visibility handling, and teardown. Results correlate by epoch and
request sequence, with the domain command ID checked as an additional witness. Timed-out operations
settle as outcome-unknown and are never resent. Fatal, crash, `error`, and `messageerror` close
admission, settle pending work, remove listeners/timers, and terminate the Worker.

The store atomically admits an owned snapshot/grid pair before the client ACKs a publication. One
grid publication may be in flight; later changes coalesce to the latest state. Deltas require the
next publication sequence and exact acknowledged base revision. A strictly newer full publication
may skip lost publication sequences and rebase from its complete contents when its grid revision does
not regress. This is required after an applied publication loses its ACK: the client's revision can
be ahead of the host's acknowledged base, and the host's full resync is authoritative. Duplicate,
stale, and regressing full publications remain rejected. Epochs, scheduler values, queue sequence,
and presentation revisions stay outside `GameState` and Replay.

The host emits bounded, epoch-scoped committed-fact batches only from existing authoritative
transitions. A sequence gap produces a control notice and requests a full snapshot. The client
surfaces localized connection state in the existing shell; it does not add gameplay rules or a
second simulator authority.

## Consequences and scope

The deterministic `GameState`, RNG, 100 ms fixed tick order, Phase 1 command/result semantics,
Campaign year projection, save version, Replay version, and canonical hashes remain unchanged.
Production Worker scheduling and message transport are outside simulator imports. Task 19 does not
implement durable writes, save/load UI, autosave, import/export, or worker recovery; these remain
Task 20 scope. Task 18 continues to own projection and revision-patch semantics; this ADR records
their Worker delivery and resync integration.

## Verification

Real Chromium evidence and target-host measurements are recorded in
`docs/diagnostics/PHASE_2_WORKER.md`. The parity fixture compares ordered results and receipts plus
tick, Campaign year, RNG, canonical hash, and queue position at explicit host capture barriers. It
uses the production host in a real Worker with a test-only deterministic scheduler. Dense-N browser
publication samples use 100 warm-up and 500 measured Worker replies emitted during one-step
callbacks; the main-thread processing samples pair with those same replies by publication sequence.
