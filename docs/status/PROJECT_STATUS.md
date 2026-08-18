# OVERCLOCK Project Status

Updated: 2026-08-18

## Current phase

- Phase 1: Headless Simulator.
- Completed checkpoint: Task 2, typed command pipeline foundation, committed at `52081df`.
- Current task: Task 3, deterministic fixed-step 100 ms tick pipeline, implemented and pending
  final review and approval.
- No production gameplay command handler or gameplay tick system has started.

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

## Phase 1 Task 3 implementation

- `SimCore` owns the authoritative state boundary, deterministic command queue and processor, and
  fixed tick-system registry.
- `step()` defaults to one fixed 100 ms tick and accepts only nonnegative safe integers that cannot
  overflow the authoritative completed-tick count.
- Completed time is derived as `tick / 10`; it is never accumulated and never scaled by speed.
- Commands drain in FIFO order at the current tick before systems. All commands waiting before a
  multi-tick call process in its first requested tick.
- `step(0)` is a complete no-op. `processPendingCommands()` is the command-only path and works while
  paused without running systems or advancing time.
- Manual stepping ignores pause and speed. The future host retains responsibility for deciding when
  and how often to call it.
- `applyClockCommand()` synchronously supports only `SET_PAUSED` and `SET_SPEED`, including exact
  expected-tick checks and idempotent acceptance, without consuming queue sequence.
- `SimCore` statically excludes clock handlers from its queued-handler registry and removes them
  from unsafe runtime injection, preserving queued `COMMAND_NOT_AVAILABLE` behavior.
- The complete 15-stage TDD order is an explicit tuple. Production registers none of the 13 later
  gameplay stages; private tests may inject a narrow typed partial registry.
- Tick systems run against an isolated candidate and seeded RNG. State, resulting RNG, completed
  tick, and derived time commit together only after every stage succeeds.
- Candidate invariants are checked after each executed stage for accurate diagnostics. Successful
  candidates are frozen before shared nested data becomes authoritative, preventing retained test
  references from mutating committed state.
- Empty production ticks use structural sharing with narrow root and clock copies. They do not clone,
  canonical-serialize, or hash the complete state.
- `getStateForSave()` returns a detached, canonically serializable plain-data snapshot.

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
- `src/sim/core/simCore.ts`:
  - `SimCore`
  - `SimCoreOptions`
  - `SimCoreCommandHandlerRegistry`
  - `StepResult`
  - `ClockCommand`
  - readonly `tick`
  - `enqueue(command): CommandReceipt`
  - `processPendingCommands(): readonly CommandResult[]`
  - `step(ticks?: number): StepResult`
  - `applyClockCommand(command): CommandResult`
  - `getStateForSave(): GameState`
- `src/sim/core/tickSystems.ts`:
  - `TICK_STAGE_ORDER`
  - `TICK_SYSTEM_STAGE_ORDER`
  - `TickSystemStage`
  - `TickSystemContext`
  - `TickSystemRegistry`

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
- Recoverable command rejection does not stop the current tick. Fatal command processing stops
  before tick-system execution.
- A throwing system or invalid system candidate rolls back all changes and RNG use from that tick,
  stops later stages, and throws `SimulatorInvariantError` with the current tick and stage.
- Command commits completed before a system failure remain committed. Completed earlier ticks in a
  multi-tick call also remain committed.
- Tick systems cannot change tick, simulated seconds, pause, or speed.

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
- Command candidates and injected tick-system candidates use the platform-neutral `structuredClone`
  implementation available in the supported Node and browser runtimes. Empty production ticks do
  not clone the complete state. Later gameplay tasks may introduce narrower system candidates after
  measuring the complete fixture.
- Canonical candidate validation runs after each injected system stage. Production Task 3 registers
  no systems, so the empty hot path avoids full-state serialization.

## Verification

- Focused tick and clock tests: PASS, 1 file and 43 tests.
- Focused Task 2 and Task 3 regression tests: PASS, 3 files and 71 tests.
- Complete unit suite: PASS, 10 files and 113 tests.
- Determinism fixture: PASS, identical receipts, results, and final hash across 100 runs.
- Performance diagnostic: PASS as a report-only command. Empty pipeline median `0.0004 ms`, p95
  `0.0027 ms`, max `0.7443 ms`; controlled private fixture median `5.8395 ms`, p95 `9.6400 ms`,
  max `13.2946 ms`. These development-machine results are not a final target-hardware claim.
- Formatting check: PASS.
- ESLint: PASS.
- Strict TypeScript checking: PASS.
- Content validation: PASS, 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, and 2 locales.
- Production build: PASS, 846 modules transformed.
- `corepack pnpm validate`: PASS.
- `git diff --check`: PASS.
- Simulator forbidden import/API scan: PASS; no random, wall-clock, scheduling, React, PixiJS, DOM,
  browser storage, or worker matches.
- Read-only implementation review: PASS after fixing clock-handler injection, exact invalid-stage
  attribution, retained system-candidate mutation, and a strict typing failure; targeted re-review
  found no remaining Critical or Important issue.

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
- The controlled private-system fixture currently pays for a full isolated candidate clone and one
  canonical validation per tick. This is intentionally diagnostic, not proof of the final i7-2600
  p95 gate; later systems should introduce narrower candidates if the complete fixture requires it.
- `SimulatorInvariantError.commandId` uses an internal diagnostic identifier for tick-system errors
  so the Task 2 command-error field remains backward compatible; tick-system consumers should use
  the added `tick` and `stage` diagnostics.

## Exact next task

Await review and approval of Phase 1 Task 3. Do not start Task 4 or any later gameplay system without
separate approval.

## Explicitly deferred

- Real-time tick scheduling, timers, catch-up, pause/speed host scheduling, and worker integration.
- Every production gameplay command handler.
- Economy, inventory transactions, tasks, and research progression.
- Grid placement, routing, power delivery, thermal simulation, and overclock behavior.
- Useful Compute, benchmarks, blueprints, replay execution, and balancing bot.
- React/Pixi integration, IndexedDB, save/load, migrations, export, and import.
