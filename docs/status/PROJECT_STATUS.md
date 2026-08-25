# OVERCLOCK Project Status

Updated: 2026-08-24

## Current phase

- Phase 1: Headless Simulator.
- Parent checkpoint: Task 4, deterministic inventory transactions and basic economy, committed at
  `8e80b00` and explicitly approved on 18 August 2026.
- Completed checkpoint: Task 5.1, deterministic grid geometry, occupancy, footprint rotation, port
  geometry, compatibility, and derived adjacent-port graph, explicitly approved on 18 August 2026.
- Phase 1 Task 5.2, Design Mode lifecycle and deterministic place, move, rotate, and remove draft
  commands, is validated and checkpointed at `916476b6e5e8db6253606e7463781e7b594bf325`.
- Phase 1 Task 5.3, deterministic manual `CONNECT_PORTS` and `DISCONNECT_ROUTE`, is checkpointed
  at `4d83988792cd02cbe81b6749696cd470ee422c77`.
- Phase 1 Task 5.4, deterministic `UNDO_DESIGN` and `REDO_DESIGN`, is checkpointed at
  `631f9d1379a0f12091247ea6a14a5a214dd87548`.
- Phase 1 Task 5.5, deterministic Design Apply preview and atomic `APPLY_DESIGN`, is implemented
  and pending coordinator review and checkpoint.
- Production gameplay commands are `BUY_MODULE`, `SELL_INVENTORY_ITEM`, `ENTER_DESIGN_MODE`,
  `PLACE_MODULE`, `MOVE_MODULE`, `ROTATE_MODULE`, `REMOVE_MODULE`, `CONNECT_PORTS`,
  `DISCONNECT_ROUTE`, `UNDO_DESIGN`, `REDO_DESIGN`, `APPLY_DESIGN`, and `CANCEL_DESIGN`. No production
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
  the two inventory commands, and Task 5.2/5.3 add one for the eight available Design Mode commands.
  All other
  queued gameplay commands remain unavailable unless tests inject a private handler.

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

## Phase 1 Task 5.2 implementation

- `ENTER_DESIGN_MODE` validates the live grid and clones detached module and route records into a
  revision-zero draft with empty operation stacks. `CANCEL_DESIGN` discards the complete draft.
- Live modules, routes, layout revision, authoritative inventory, economy, clock, tasks, research,
  and RNG remain unchanged through draft edits and cancel.
- `FacilityState.nextModuleInstanceSequence` starts at `1`, is positive and safe, never decreases,
  and allocates `module-instance-00000001` style IDs without RNG. Accepted placements consume one
  sequence; rejection consumes none; removal and cancel do not restore consumed values.
- Generated ID collision, module-sequence overflow, and state-changing draft-revision overflow reject
  atomically with `INVALID_SYSTEM`.
- Inventory reservation is derived in stable definition order as
  `max(0, draftCount - liveCount)`. Placement spends no cash, mutates no inventory, and does not
  repeat research validation. Removing live or new draft hardware makes the corresponding capacity
  reusable in the same draft.
- Placement initializes offline modules with Balanced `1/1` overclock ratios, temporary neutral bin
  ratios, content startup ticks, and zero cooldown. Silicon lottery remains deferred.
- Move and absolute clockwise rotation use Task 5.1 exclusion-aware placement validation and preserve
  all unrelated module fields. Same-position moves and same-rotation commands are accepted exact
  no-ops.
- Every state-changing edit increments revision once, records one detached reversible canonical JSON
  operation using revision plus command UUID, and clears redo. Rejections and no-ops preserve both
  stacks and revision.
- Move, rotate, and remove delete all attached draft routes in stable route-ID order, copy them into
  the operation payload, and preserve unrelated routes. No rerouting or adjacent-graph build occurs.
- `APPLY_DESIGN` remains unregistered and returns `COMMAND_NOT_AVAILABLE`.

## Phase 1 Task 5.3 implementation

- `CONNECT_PORTS` and `DISCONNECT_ROUTE` are registered only through the existing immutable-content
  Design Mode factory, command processor, and `SimCore` command path.
- Endpoint modules and ports resolve from the detached draft and validated content. ADR-0005
  compatibility normalizes power output-to-input, preserves directional data, and stably orders
  bidirectional data. Reversed submitted endpoints reverse the stored inclusive path.
- Manual paths include both endpoint module tiles, are bounded by facility area, remain in bounds,
  move one orthogonal tile per step, have no repeated tile, and cannot cross any module on an interior
  tile. A path's occupancy is built once. No adjacent graph, pathfinding, preview, or empty-tick work
  is added.
- Crossings, shared tiles/segments, and multiple routes on a port are allowed. Duplicate normalized
  endpoint pairs are rejected. Accepted capacity is the exact endpoint minimum and congestion starts
  at zero; no capacity reservation or congestion gameplay exists.
- `FacilityState.nextRouteSequence` starts at `1`, is positive/safe/monotonic, and allocates
  `route-00000001` style IDs without RNG. Accepted connects consume one value; rejection,
  disconnect, cancel, and future undo never restore it. Collision and overflow reject atomically.
- `INVALID_ROUTE` supplies stable reasons for route lookup, duplicate pair, path length, endpoint,
  step, and repeat failures. English and Romanian route rejection localization is content-only.
- Connect and disconnect each increment draft revision once, clear redo, and write a detached
  canonical `{ route }` operation payload. They preserve live layout, inventory, economy, clock,
  tasks, research, RNG, and tick. The pure route validator checks records, canonical endpoints/path,
  capacity, congestion, duplicate pairs, and route sequence; enter validates live routes before clone.

## Phase 1 Task 5.4 implementation

- At the Task 5.4 checkpoint, `UNDO_DESIGN` and `REDO_DESIGN` were registered through the existing
  immutable-content Design Mode factory, command processor, and `SimCore` path; Task 5.5 now adds
  the registered `APPLY_DESIGN` transaction described below.
- Empty relevant stacks are accepted exact no-ops, including at maximum revision. A nonempty stack
  with revision overflow rejects atomically as `INVALID_SYSTEM`.
- Real undo and redo move the same logical detached operation between LIFO stacks, preserve its
  operation ID and complete payload, and increment revision exactly once. They create no operations.
- All six operation kinds restore or remove exact stored modules and routes, including complete route
  paths, capacity, and congestion. Module and route sequences do not change and IDs are never reused.
- Undo and redo mutate only the draft; they leave live layout, inventory, economy, RNG, clock,
  tasks, and research unchanged. They do not revalidate inventory or build an adjacent-port graph.
- Malformed history, transition mismatches, collisions, and invalid restored grid or route records
  are fatal ADR-0002 invariants. The handlers validate draft grid, routes, history, and sequences
  before candidate commit. Compatibility is recorded by ADR-0008.

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
- `src/sim/core/types.ts`:
  - `FacilityState.nextModuleInstanceSequence: number`
  - `FacilityState.nextRouteSequence: number`
- `src/sim/design/designModeState.ts`:
  - `assertValidDesignModeState(state, minimumModuleInstanceSequence?, minimumRouteSequence?): void`
- `src/sim/design/designModeCommands.ts`:
  - `DesignModeCommandHandlers`
  - `DesignInventoryReservation`
  - `calculateDesignInventoryReservations(facility, draft, inventory)`
  - `createDesignModeCommandHandlers(content): DesignModeCommandHandlers`
- `src/sim/routing/manualRouting.ts`:
  - `resolveManualRouteEndpoints(...)`
  - `validateManualRoutePath(...)`
  - `validateManualRouteConnection(...)`
  - `validateRouteState(...)`
  - `assertValidRouteState(...)`
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
- Design-draft isolation, revision and no-op semantics, derived inventory reservations, monotonic
  module instance IDs, reversible operation payloads, attached-route cleanup, and temporary neutral
  bin values are frozen by
  `docs/decisions/ADR-0006_DESIGN_MODE_DRAFTS_AND_MODULE_INSTANCE_IDS.md`.

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
- Task 5.2 placements use neutral bin ratios of `1` until the dedicated silicon-binning task. The
  future apply command must revalidate inventory before consumption because independent inventory
  commands may run while a draft exists.

## Verification

- Focused Task 5.4 coverage: PASS, one unit file with 10 tests plus one exact-100-run determinism
  file. It covers registration, unavailable apply, Design Mode rejections, exact empty no-ops,
  overflow, all six operation kinds, LIFO, ID/sequence preservation, atomicity, fatal corruption,
  FIFO, expected tick, and canonical serialization.
- Task 2 through Task 5.3 regression selection: PASS, 9 files and 215 tests.
- Complete unit suite: PASS, 19 files and 332 tests. Complete determinism suite: PASS, 4 files and
  4 tests.
- Design Mode scope: undo and redo are available only through the injected production factory;
  `APPLY_DESIGN` remains `COMMAND_NOT_AVAILABLE` without state or RNG changes.
- Published RNG, canonical-hash, money, and geometry compatibility selection: PASS, 5 files and 125
  tests;
  `seedToUint32("phase-one") === 2799575867` and
  `hashCanonicalState({ a: 1 }) === "9c3e82dd6fcae8b1"`; the published `0.000028 USD` energy-cost
  vector and Task 5.1 coordinate, rotation, occupancy, and port compatibility vectors remain green.
- Routing diagnostic on the development i7-2600: `24 x 16`, 102 modules/occupied tiles, 10 existing
  routes, 40 existing path points, and a 24-point candidate path. Connect median `13.8881 ms`, p95
  `19.9269 ms`, max `27.3699 ms`; disconnect median `10.7683 ms`, p95 `14.8870 ms`, max `19.0893 ms`,
  with 200 samples each. It builds no adjacent-port graph or pathfinding work.
- Design Mode diagnostic on the same host: `24 x 16`, 280 modules, 285/384 occupied tiles (`74.2%`),
  and 0 routes. Enter median `16.7308 ms`, p95 `21.6428 ms`, max `27.4148 ms`; placement median
  `17.6411 ms`, p95 `24.2837 ms`, max `35.0756 ms`; move median `17.0019 ms`, p95 `22.5208 ms`, max
  `27.1827 ms`; rotation median `16.6999 ms`, p95 `22.1574 ms`, max `28.5796 ms`; removal median
  `17.1248 ms`, p95 `22.7270 ms`, max `29.6150 ms`; undo median `16.9555 ms`, p95 `21.6917 ms`, max
  `25.5715 ms`; redo median `17.0013 ms`, p95 `21.8024 ms`, max `37.0843 ms`, with 200 samples each.
- Grid diagnostic on the same host: `24 x 16`, 384 one-tile modules, 1,152 power/data nodes, and 368
  edges. Occupancy median `0.4830 ms`, p95 `0.9497 ms`, max `1.6379 ms`; dense six-tile placement
  median `0.5244 ms`, p95 `0.7729 ms`, max `1.9512 ms`; graph median `9.7960 ms`, p95 `12.2885 ms`,
  max `17.3997 ms`.
- Tick diagnostic: empty median `0.0004 ms`, p95 `0.0014 ms`, max `0.0662 ms`; controlled private
  fixture median `6.5721 ms`, p95 `9.1420 ms`, max `13.2827 ms`. The complete vertical-slice
  i7-2600 under-4-ms gate remains open.
- Formatting check, ESLint, strict TypeScript checking, and `corepack pnpm validate`: PASS.
- Content validation: PASS, 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, and 2 locales.
- Production build: PASS, 846 modules transformed.
- `git diff --check`: PASS.
- Forbidden import/API scans: PASS; no random, wall-clock, scheduling, React, PixiJS, rendering, UI,
  DOM, browser storage, or worker matches in `src/sim` or `src/grid`, and no `Map`, `Set`, or `Date`
  in authoritative state contracts.
- GDD, Word documents, module content, and balance drift checks: PASS; those files are unchanged.
  The intentional Markdown TDD diff is limited to the approved route sequence, manual routing, path,
  crossing/capacity, `INVALID_ROUTE`, and deterministic command contracts.

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
- Dense Design Mode command processing includes full command-candidate cloning, canonical candidate
  validation, and focused grid validation, producing roughly 15 to 16 ms medians on the development
  i7-2600 fixture. These edits are off tick and build no graph. Task 5.3 manual routing also scans
  route invariants at command time; keep it out of pointer movement and profile any future route or
  segment index before adding one.

## Phase 1 Task 5.5 implementation

- `APPLY_DESIGN` is registered through the existing immutable-content Design Mode factory, command
  processor, and `SimCore` path. Its pure preview has stable final-diff, inventory consumption,
  salvage, labor, net-cost, and maximum-startup downtime values; `STALE_DESIGN_PREVIEW` is localized
  in English and Romanian.
- Apply revalidates current inventory and all structural invariants, commits completely or not at all,
  preserves sequences/RNG/thermal/tick/unrelated state, and never builds the adjacent-port graph.
- Current preview intentionally defers functional compute, power, thermal, airflow, and task-risk
  effects until authoritative systems exist.

## Task boundary

Task 5.5 is implemented and pending coordinator review and checkpoint. No later task has begun; the
next task remains pending coordinator decision.

## Explicitly deferred

- Real-time tick scheduling, timers, catch-up, pause/speed host scheduling, and worker integration.
- Every production gameplay command handler except `BUY_MODULE`, `SELL_INVENTORY_ITEM`,
  `ENTER_DESIGN_MODE`, `PLACE_MODULE`, `MOVE_MODULE`, `ROTATE_MODULE`, `REMOVE_MODULE`,
  `CONNECT_PORTS`, `DISCONNECT_ROUTE`, `UNDO_DESIGN`, `REDO_DESIGN`, and `CANCEL_DESIGN`.
- Automatic energy deductions, power capacity purchases, labor and relocation costs, task rewards,
  research costs/progression, maintenance, inflation, market events, scarcity, financing, interest,
  insolvency, bailout, bankruptcy, and financial game over.
- Installed-module sales, auto-connect, auto-route, pathfinding, rerouting, route preview, apply,
  hard route capacity, power delivery, thermal simulation, and overclock behavior.
- Useful Compute, benchmarks, blueprints, replay execution, and balancing bot.
- React/Pixi integration, IndexedDB, save/load, migrations, export, and import.
