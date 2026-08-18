# OVERCLOCK Project Status

Updated: 2026-08-18

## Current phase

- Phase 1: Headless Simulator.
- Completed task: Task 2, typed command pipeline foundation.
- Task 2 is implemented and verified locally but remains uncommitted pending review.
- No 100 ms tick pipeline, production command handler, or gameplay system has started.

## Implemented deterministic foundation

- Seed validation, deterministic string-to-state conversion, and injectable/restorable Mulberry32
  RNG.
- Strict canonical JSON serialization with recursive key ordering and authoritative-data rejection
  checks.
- Stable FNV-1a 64-bit canonical state hashing.
- Content-derived initial `GameState` factory with deterministic collection ordering.
- Recursive JSON-only type contract for design-draft payloads.
- Romanian and English localization coverage for initial state and Task 2 command rejections.
- Determinism coverage includes 100 repeated runs plus fixed ASCII and Unicode vectors.

## Phase 1 Task 2 implementation

- The complete existing `SimCommand` union has strict runtime Zod schema coverage.
- Invalid envelopes fail before enqueue and produce neither a receipt nor a processed result.
- `CommandQueue` owns freshly parsed command values and preserves deterministic FIFO insertion order.
- Successful enqueue receipts use zero-based `queueSequence` values that increment only after
  successful admission.
- `CommandProcessor.processQueuedCommands()` is an explicit synchronous entry point. It processes
  against the current authoritative tick and never advances time.
- `CommandHandlerRegistry` is partial and preserves kind-specific command payload typing through
  `Extract<SimCommand, { kind: K }>`.
- Exhaustive dispatch makes a new `SimCommand` kind a compile-time error until dispatch is updated.
- No production command handlers are registered. Structurally valid commands therefore reject with
  `COMMAND_NOT_AVAILABLE` unless tests inject a private handler.

## Public types and APIs

- Existing public contracts preserved in `src/sim/commands/contracts.ts`:
  - `SimCommand`
  - `CommandReceipt`
  - `CommandResult`
  - `CommandRejectionCode`
- `src/sim/commands/commandSchema.ts`:
  - `simCommandSchema`
  - `parseSimCommand(input): SimCommand`
- `src/sim/commands/commandQueue.ts`:
  - `CommandQueue.enqueue(input): CommandReceipt`
  - `CommandQueue.dequeue(): SimCommand | undefined`
  - `CommandQueue.pendingCount`
- `src/sim/commands/commandHandlers.ts`:
  - `CommandHandlerContext`
  - `CommandHandler<K>`
  - `CommandHandlerRegistry`
  - `dispatchRegisteredCommand(...)`
- `src/sim/commands/commandProcessor.ts`:
  - `CommandProcessor`
  - `CommandProcessor.enqueue(input): CommandReceipt`
  - `CommandProcessor.processQueuedCommands(): CommandResult[]`
  - `CommandProcessor.getState(): GameState`
  - `CommandProcessor.pendingCommandCount`
  - `SimulatorInvariantError`
  - `SIMULATOR_INVARIANT_VIOLATION`

## Queue, result, and atomicity semantics

- `CommandReceipt` remains immediate enqueue acknowledgement; `CommandResult` remains the later
  processed outcome.
- Queue state is not part of `GameState`, canonical state hashing, or RNG state.
- Caller-owned command objects and nested arrays are not retained after enqueue.
- `expectedTick`, when present, must equal the current processing tick. Past and future values reject
  with `STALE_TICK` and processing continues.
- Recoverable rejection preserves the authoritative canonical hash and RNG state.
- Each registered handler receives an isolated candidate state and candidate RNG. A completed
  candidate is validated and committed exactly once.
- Handler exceptions and post-handler invariant failures throw `SimulatorInvariantError`, roll back
  that command, produce no normal result, stop the pass, remove the failing command, and preserve
  later queued commands.
- Earlier accepted commands remain committed when a later command fails fatally.

## Frozen compatibility decisions

- Seed conversion is FNV-1a 32-bit over each UTF-16 code unit, low byte then high byte.
- RNG is Mulberry32 with serialized unsigned 32-bit state.
- Published ASCII seed vector: `seedToUint32("phase-one") === 2799575867`.
- Canonical objects use locale-independent lexicographic key ordering; array element order is
  preserved.
- State hash is FNV-1a 64-bit over UTF-8 canonical JSON, encoded as 16 lowercase hexadecimal
  characters.
- Published ASCII hash vector: `hashCanonicalState({ a: 1 }) === "9c3e82dd6fcae8b1"`.
- `commandId` is a client-supplied RFC-compatible UUID and is never generated or normalized by the
  simulator.
- The first successful enqueue uses sequence `0`; sequences increment only after success.
- `STALE_TICK` uses `errors.stale-tick`; unavailable commands use
  `errors.command-not-available`.
- Fatal handler or candidate failures use internal code `SIMULATOR_INVARIANT_VIOLATION`, not a new
  public `CommandRejectionCode`.
- Command compatibility details are recorded in
  `docs/decisions/ADR-0002_COMMAND_PIPELINE_FOUNDATION.md`.

## Temporary assumptions

- New games retain the Task 1 defaults: paused at tick `0`, speed `1`, Simple Guidance, and no active
  tutorial step.
- The Task 2 candidate validator enforces canonical serializability and forbids handler-driven tick
  advancement. Later gameplay tasks must add their domain invariants before registering handlers.
- Queue admission currently has no capacity or policy rejection. `queued: false` and a null sequence
  remain reserved.
- Duplicate valid client command IDs are not deduplicated in Task 2; ordered command streams own
  their identifiers, and replay/transport policy remains deferred.
- Candidate state cloning uses the platform-neutral `structuredClone` implementation available in
  the repository's supported Node and browser runtimes; it does not access DOM, storage, workers, or
  wall-clock APIs.

## Verification

- Focused command tests: PASS, 2 files and 28 tests.
- Complete unit suite: PASS, 9 files and 70 tests.
- Formatting check: PASS.
- ESLint: PASS.
- Strict TypeScript checking: PASS.
- Content validation: PASS, 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, and 2 locales.
- Production build: PASS, 846 modules transformed.
- `corepack pnpm validate`: PASS.
- `git diff --check`: PASS.
- Simulator forbidden import/API scan: PASS; no random, wall-clock, scheduling, React, PixiJS, DOM,
  browser storage, or worker matches.

## Known risks

- FNV seed and state hashes are deterministic but non-cryptographic and have theoretical collision
  risk.
- Canonically equivalent Unicode strings in different normalization forms produce different seeds,
  hashes, and command IDs if the client supplies different text.
- Full gameplay-specific candidate invariant validation remains intentionally deferred until concrete
  handlers exist.
- Queue capacity, duplicate-command policy, worker transport errors, and delivery of results emitted
  before a later fatal failure require future host/replay decisions.
- Save checksum and migration behavior are not implemented; the TDD reserves SHA-256 for save
  integrity.

## Exact next task

Await approval for Phase 1 Task 3: integrate the approved command processor at the beginning of the
fixed 100 ms tick pipeline, define tick advancement and ordered system orchestration, and preserve
the TDD's fixed tick order. Do not start Task 3 without separate approval.

## Explicitly deferred

- 100 ms tick scheduling, timers, catch-up, pause/speed host behavior, and worker integration.
- Every production gameplay command handler.
- Economy, inventory transactions, tasks, and research progression.
- Grid placement, routing, power delivery, thermal simulation, and overclock behavior.
- Useful Compute, benchmarks, blueprints, replay execution, and balancing bot.
- React/Pixi integration, IndexedDB, save/load, migrations, export, and import.
