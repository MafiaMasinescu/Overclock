# ADR-0002: Command Pipeline Foundation

Status: Accepted

Date: 18 August 2026

## Context

Phase 1 Task 2 establishes command admission and atomic processing without implementing the
100 ms tick pipeline or any gameplay behavior. The TDD already defines the complete
`SimCommand` catalog and distinguishes immediate enqueue receipts from processed outcomes.
This ADR fixes the remaining compatibility decisions before command handlers are added.

## Decisions

1. The existing `SimCommand` discriminated union remains the complete vertical-slice command
   catalog. Task 2 does not add, remove, rename, or implement any command kind.
2. Runtime admission uses a strict Zod discriminated union for every existing command kind.
   Parsing rejects invalid UUIDs, sources, enums, integer fields, non-finite numbers, unknown
   properties, unknown kinds, sparse arrays, accessors, class instances, and unsupported
   non-JSON values. Successful parsing returns fresh plain JSON-compatible data.
3. `commandId` remains client-owned and must be an RFC-compatible UUID. The simulator never
   generates, replaces, or normalizes it. Invalid envelopes fail before enqueue and receive no
   `CommandReceipt` or `CommandResult`.
4. `CommandReceipt` remains an immediate enqueue acknowledgement. A successful enqueue returns
   `queued: true`; the first `queueSequence` is `0`; and the sequence increments only after a
   successful enqueue. `queued: false` with `queueSequence: null` remains reserved for future
   admission failures.
5. `CommandResult` remains the processed outcome. Each normally processed command produces
   exactly one accepted or recoverably rejected result. Receipts and results are not merged or
   renamed.
6. The queue is deterministic FIFO state outside authoritative `GameState`. It owns freshly
   parsed command data, preserves nested array order, uses no timestamps or generated IDs, is
   excluded from canonical state hashing, and never advances the simulation tick.
7. `expectedTick` is checked at processing time. When present, it must equal the current
   authoritative `GameState.tick`. Past and future mismatches reject with `STALE_TICK` and
   `errors.stale-tick` without changing state or RNG.
8. The handler registry is partial and kind-safe. Each entry receives
   `Extract<SimCommand, { kind: K }>` or its recursively read-only equivalent. Exhaustive dispatch
   ensures a new command kind cannot compile until dispatch coverage is added.
9. Task 2 registers no production handlers. A structurally valid command with no registered
   handler rejects with `COMMAND_NOT_AVAILABLE` and `errors.command-not-available`. Tests may
   inject private handlers to verify accepted and fatal paths; those handlers establish no
   gameplay semantics.
10. Atomicity is per command. A handler works on an isolated candidate state and candidate RNG.
    The candidate is validated and committed once only after the handler completes. Recoverable
    rejection and fatal failure leave that command's original authoritative state and RNG
    unchanged. Earlier successful commands in the same processing pass remain committed.
11. A handler exception, impossible state, or post-handler invariant failure is fatal. Processing
    throws `SimulatorInvariantError` with internal code `SIMULATOR_INVARIANT_VIOLATION`, the valid
    affected `commandId`, and the original cause. The failing command produces no normal result,
    is not retried, and is removed from the queue. Later queued commands remain pending and are
    not processed.
12. Task 2 processing uses the current state tick for `appliedAtTick` and `rejectedAtTick`. It does
    not increment time, schedule work, or start a timer.

## Consequences

- Production behavior remains unavailable until later Phase 1 tasks register concrete handlers.
- The Task 3 tick pipeline will call synchronous command processing at the beginning of a tick,
  before later simulation systems, and will own tick advancement and scheduling policy.
- `GameClient`, worker transport errors, worker `FATAL_ERROR` messages, replay execution, and
  save/load integration remain deferred.
- Changing UUID admission, queue sequencing, receipt/result fields, expected-tick equality, or
  fatal processing behavior after replay/save publication requires an explicit compatibility
  decision and migration analysis.

## Rejected alternatives

- Adding a public test command would pollute the replay contract with non-gameplay behavior.
- Treating handler exceptions as `CommandRejectionCode` values would conflate recoverable player
  input with simulator invariant failures.
- Generating command IDs from RNG, tick, queue sequence, hashes, time, or UUID APIs would violate
  client ownership and deterministic input-stream identity.
- Rolling back an entire processing pass would discard already completed commands and contradict
  per-command atomicity.
