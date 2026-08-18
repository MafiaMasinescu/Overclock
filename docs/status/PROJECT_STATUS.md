# OVERCLOCK Project Status

Updated: 2026-08-18

## Current phase

- Phase 1: Headless Simulator.
- Parent checkpoint: Task 4, deterministic inventory transactions and basic economy, committed at
  `8e80b00` and explicitly approved on 18 August 2026.
- Completed checkpoint: Task 5.1, deterministic grid geometry, occupancy, footprint rotation, port
  geometry, compatibility, and derived adjacent-port graph, explicitly approved on 18 August 2026.
- Phase 1 Task 5.2 has not started.
- Production gameplay commands are limited to `BUY_MODULE` and `SELL_INVENTORY_ITEM`. No production
  gameplay tick system has started.

## Implemented deterministic foundation

- Seed validation, deterministic string-to-state conversion, and injectable/restorable Mulberry32
  RNG.
- Strict canonical JSON serialization with recursive key ordering and authoritative-data rejection
  checks.
- Stable FNV-1a 64-bit canonical state hashing.
- Content-derived initial `GameState` factory with deterministic collection ordering.
- Recursive JSON-only type contract for design-draft payloads.
- Romanian and English localization coverage for initial state and Task 2/Task 4 command rejections.
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
- Task 2 registered no production handlers. Task 4 adds an explicit content-injected factory for
  the two inventory commands; all other queued gameplay commands remain unavailable unless tests
  inject a private handler.

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

## Phase 1 Task 4 implementation

- `CommandHandler` remains source-compatible with existing `void` handlers and may now return a
  typed recoverable rejection. Returned rejections discard the candidate state and RNG; actual
  throws retain ADR-0002 fatal behavior.
- `createInventoryEconomyCommandHandlers(content)` injects the validated immutable `ContentBundle`
  and registers only `BUY_MODULE` and `SELL_INVENTORY_ITEM` through the existing registry.
- Public economy and inventory money remains USD `number`. Internal helpers use safe integer
  microdollars, where 1 USD is 1,000,000 microdollars, and round half away from zero at monetary
  boundaries.
- Ordinary UI cash presentation uses two decimal places, while expanded statistics may expose
  sub-cent values. UI formatting is presentation-only and never re-enters the simulator.
- Purchases use the current quantized content price, require every module unlock research status to
  be `completed`, precompute the complete transaction, allow equality at zero cash and the negative
  credit limit, and reject atomically below it.
- New stacks record current unit cost. Existing stacks use a safe integer weighted acquisition-cost
  calculation rounded to the nearest microdollar.
- Sales use `quantize(current price * salvage ratio)` as unit proceeds before quantity
  multiplication. They ignore research state and acquisition cost, preserve acquisition cost on a
  partial sale, remove zero-remainder stacks, and never inspect or mutate installed facility
  modules.
- Purchases increase lifetime `totalExpenseUsd`; sales increase lifetime `totalIncomeUsd`.
  `lastTickExpenseUsd` and `lastTickIncomeUsd` remain unchanged because discrete commands are not
  periodic tick flows.
- The pure energy helper computes `powerWatts * simulatedSeconds / 3,600,000 * priceUsdPerKwh`,
  validates finite nonnegative inputs and overflow, and quantizes the final cost. No energy-charge
  system or authoritative deduction is registered.
- Initial cash and acquisition costs are microdollar-normalized, zero starting stacks are omitted,
  and command/system candidates enforce the focused inventory/economy invariants.
- Transactions consume no RNG and preserve FIFO order, processing-time expected-tick checks,
  candidate isolation, atomic commit/rejection, and JSON serialization.

## Phase 1 Task 5.1 implementation

- Coordinates use a zero-based top-left origin, positive `x` right, positive `y` down, and module
  positions as the top-left tile of the rotated footprint.
- Pure footprint APIs resolve all four clockwise rotations, transform local coordinates, enumerate
  complete rectangular occupancy in row-major order, and validate exact facility boundaries.
- The derived occupancy index is rebuilt from supplied instance records and immutable content. It
  retains stable occupant IDs per tile and reports unknown definitions, record-key/instance-ID
  disagreement, malformed geometry, and duplicate occupation without entering `GameState`.
- Placement validation is complete and non-mutating. It reports every outside or occupied tile,
  identifies collision occupants, and may exclude one moved instance.
- Port offsets are validated against their unrotated side dimension. Rotation transforms the edge
  tile and facing together; resolved geometry includes its external adjacent tile even when that
  tile is outside the facility.
- Power pairs normalize output-to-input. Directional data pairs retain their direction;
  bidirectional pairs normalize by stable port-reference order. Airflow resolves geometry but never
  becomes a route or graph edge.
- The derived graph contains unique, explicitly sorted power/data port nodes and deduplicated
  physical compatible-adjacency edges. It creates no `RouteState` and does no routing.
- `validateGridState` and `assertValidGridState` cover focused facility/module/port invariants on
  demand and are not registered in the empty production tick path.
- Content validation enforces unique per-module port IDs, side-relative offsets, and the maximum
  unrotated `3 x 2` footprint while preserving all 12 supplied module definitions unchanged.

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
  - `CommandHandlerRejection`
  - `CommandDispatchOutcome`
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
- `src/sim/economy/money.ts`:
  - `MICRODOLLARS_PER_USD`
  - `usdToMicrodollars(valueUsd): number`
  - `microdollarsToUsd(valueMicrodollars): number`
  - `quantizeUsd(valueUsd): number`
  - `isMicrodollarAlignedUsd(valueUsd): boolean`
  - `addMicrodollars(left, right): number`
  - `multiplyMicrodollars(value, multiplier): number`
  - `divideMicrodollarsHalfAwayFromZero(numerator, denominator): number`
  - `calculateEnergyCostUsd(powerWatts, simulatedSeconds, energyPriceUsdPerKwh): number`
- `src/sim/economy/inventoryEconomyState.ts`:
  - `assertValidInventoryEconomyState(state): void`
- `src/sim/economy/inventoryTransactions.ts`:
  - `InventoryEconomyCommandHandlers`
  - `createInventoryEconomyCommandHandlers(content): InventoryEconomyCommandHandlers`
- `src/grid/domain/footprintGeometry.ts`:
  - `resolveRotatedFootprintSize(size, rotation): Size2D`
  - `transformLocalFootprintPoint(point, unrotatedSize, rotation): GridPoint`
  - `enumerateOccupiedTiles(position, unrotatedSize, rotation): GridPoint[]`
  - `isGridPointInBounds(point, facilitySize): boolean`
- `src/grid/domain/occupancy.ts`:
  - `buildOccupancyIndex(options): OccupancyIndex`
  - `findOccupyingModuleInstanceIds(occupancy, tile): readonly ModuleInstanceId[]`
  - `validateModulePlacement(options): PlacementValidationResult`
- `src/grid/domain/portGeometry.ts`:
  - `resolveModulePortGeometry(module, definition): ResolvedModulePortGeometry`
  - `arePortsPhysicallyAdjacent(left, right): boolean`
  - `resolveCompatiblePortPair(left, right): CompatiblePortPair | null`
- `src/grid/domain/adjacentPortGraph.ts`:
  - `buildAdjacentPortGraph(options): AdjacentPortGraph`
- `src/grid/validation/gridState.ts`:
  - `validateGridState(facility, content): readonly GridValidationIssue[]`
  - `assertValidGridState(facility, content): void`
  - `GridStateInvariantError`

## Queue, result, and atomicity semantics

- `CommandReceipt` remains immediate enqueue acknowledgement; `CommandResult` remains the later
  processed outcome.
- Queue state is not part of `GameState`, canonical state hashing, or RNG state.
- Caller-owned command objects and nested arrays are not retained after enqueue.
- `expectedTick`, when present, must equal the current processing tick. Past and future values reject
  with `STALE_TICK` and processing continues.
- Recoverable rejection preserves the authoritative canonical hash and RNG state.
- A registered handler may return `CommandHandlerRejection`; the processor emits it as a normal
  rejection without committing candidate state or RNG. Handler throws remain fatal invariant
  failures.
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
- Authoritative money uses 1,000,000 microdollars per USD and round-half-away-from-zero at monetary
  boundaries. Purchase and sale formula ordering is frozen by
  `docs/decisions/ADR-0004_DETERMINISTIC_INVENTORY_AND_BASIC_ECONOMY.md`.
- Grid origin, clockwise rotation formulas, row-major occupancy, side-relative port offsets,
  compatibility normalization, and derived graph ordering are frozen by
  `docs/decisions/ADR-0005_DETERMINISTIC_GRID_AND_PORT_GEOMETRY.md`.

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
- The temporary initial credit limit remains `0`; tests may supply another finite nonnegative value.
- Content prices and salvage ratios remain current-version inputs. Task 4 adds no market history,
  scarcity, inflation, or price snapshot to inventory stacks.

## Verification

- Focused Task 5.1 tests: PASS, 4 files and 89 tests.
- Focused Task 2, Task 3, and Task 4 regression selection: PASS, 8 files and 142 tests.
- Complete unit suite: PASS, 16 files and 261 tests.
- Determinism suite: PASS. Task 5.1 unit coverage also repeats identical geometry, issue, occupancy,
  and graph output across exactly 100 runs and confirms state/RNG purity.
- Existing build-command scope: PASS; all 11 Design Mode/build commands return
  `COMMAND_NOT_AVAILABLE` without changing authoritative state or RNG.
- Published compatibility vectors: PASS, 2 files and 27 tests;
  `seedToUint32("phase-one") === 2799575867` and
  `hashCanonicalState({ a: 1 }) === "9c3e82dd6fcae8b1"`.
- Task 4 money vectors and transaction regression: PASS, 3 files and 62 tests, including the
  published `0.000028 USD` energy-cost vector.
- Grid diagnostic on the development i7-2600: `24 x 16`, 384 one-tile modules, 1,152 power/data
  nodes, and 368 edges. Occupancy median `0.4142 ms`, p95 `0.8804 ms`, max `1.5181 ms`; dense
  six-tile placement median `0.4810 ms`, p95 `0.8115 ms`, max `1.2879 ms`; graph median
  `10.5507 ms`, p95 `15.0561 ms`, max `21.6211 ms`. This report-only off-tick diagnostic includes
  development-runtime and host-load effects and is not the final target-hardware tick gate.
- Existing tick diagnostic: empty median `0.0004 ms`, p95 `0.0016 ms`, max `0.6458 ms`; controlled
  private fixture median `6.3273 ms`, p95 `9.5356 ms`, max `18.0200 ms`.
- Formatting check, ESLint, strict TypeScript checking, and `corepack pnpm validate`: PASS.
- Content validation: PASS, 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, and 2 locales.
- Production build: PASS, 846 modules transformed.
- `git diff --check`: PASS.
- Forbidden import/API scans: PASS; no random, wall-clock, scheduling, React, PixiJS, rendering, UI,
  DOM, browser storage, or worker matches in `src/sim` or `src/grid`, and no `Map`, `Set`, or `Date`
  in authoritative state contracts.
- TDD, GDD, and gameplay balance-content drift checks: PASS; those files are unchanged.

## Known risks

- FNV seed and state hashes are deterministic but non-cryptographic and have theoretical collision
  risk.
- Canonically equivalent Unicode strings in different normalization forms produce different seeds,
  hashes, and command IDs if the client supplies different text.
- Full gameplay-wide candidate invariant validation remains intentionally deferred; Task 4 adds only
  inventory/economy invariants.
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
- Six-decimal public USD values remain IEEE-754 numbers. Canonical conversion is deterministic for
  the checked safe microdollar range, but future monetary systems must continue using the helpers
  instead of ad hoc floating-point arithmetic.
- The transaction registry is intentionally explicit: callers must inject the validated immutable
  content bundle and pass the returned handlers to the existing processor or `SimCore` registry.
- The final i7-2600 under-4-ms performance gate remains open until the complete controlled vertical
  slice fixture exists.
- The dense adjacent-port graph diagnostic intentionally rebuilds derived data and currently uses a
  pairwise node comparison. It is not on the tick path; Task 5.2 or connectivity work should profile
  mutation-time rebuild frequency before deciding whether a spatial candidate index is warranted.

## Exact next task

Phase 1 Task 5.2: Design Mode lifecycle and PLACE, MOVE, ROTATE, REMOVE command handlers using the approved grid geometry.

## Explicitly deferred

- Real-time tick scheduling, timers, catch-up, pause/speed host scheduling, and worker integration.
- Every production gameplay command handler except `BUY_MODULE` and `SELL_INVENTORY_ITEM`.
- Automatic energy deductions, power capacity purchases, labor and relocation costs, task rewards,
  research costs/progression, maintenance, inflation, market events, scarcity, financing, interest,
  insolvency, bailout, bankruptcy, and financial game over.
- Design Mode lifecycle and grid mutation handlers, installed-module sales, routing, power delivery,
  thermal simulation, and overclock behavior.
- Useful Compute, benchmarks, blueprints, replay execution, and balancing bot.
- React/Pixi integration, IndexedDB, save/load, migrations, export, and import.
