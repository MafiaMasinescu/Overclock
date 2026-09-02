# OVERCLOCK Project Status

Updated: 2026-09-02

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
- Phase 1 Task 5.5, deterministic Design Apply preview and atomic `APPLY_DESIGN`, is checkpointed at
  `24276727271a90e0b2c825be6687aa7996443715`.
- Phase 1 Task 6, deterministic power demand, routing-limited delivery, startup, brownout, route
  utilization, and current-tick energy-cost calculation, is checkpointed at
  `496b249031e244a4c7331faf493b30f63e157e35` and pushed to `origin/main`.
- Phase 1 Task 6.1, deterministic tick-pipeline and Power performance hardening, including the
  checkpoint startup-generation correctness and determinism-timeout stability repairs, is
  checkpointed at `06f6e7893fe8b6ef181375ee1a159f8b11aa2afc` and pushed to `origin/main`.
- Phase 1 Task 7, deterministic thermal contract, pure domain, transactional production integration,
  and performance hardening, is complete and checkpointed by the commit containing this status
  update.
- Phase 1 Task 8, deterministic Overclock and Stability foundations, pure formulas, lifecycle,
  transactional commands, production integration, and performance hardening, is complete.
- Phase 1 Task 9.1 through Task 9.5, deterministic Useful Compute and output ownership, are
  checkpointed at `d5dcab86c016f75bdc43d5db37258dcc54bc28c9`. Phase 1 Task 10, deterministic Task
  lifecycle and allocation under ADR-0016, is complete at its single final checkpoint boundary.
- Phase 1 Task 11, deterministic Research lifecycle and global proportional Compute reservation, is
  complete at its single checkpoint-neutral boundary under ADR-0017. Tasks 11.1 through 11.7 cover
  the additive contract, pure and production reservation, commands, lifecycle/Museum calculation,
  transactional Research integration, and performance/compatibility/documentation closeout. The
  exact next Phase 1 task is Task 12, Benchmark runners.
- Production gameplay commands are `BUY_MODULE`, `SELL_INVENTORY_ITEM`, `ENTER_DESIGN_MODE`,
  `PLACE_MODULE`, `MOVE_MODULE`, `ROTATE_MODULE`, `REMOVE_MODULE`, `CONNECT_PORTS`,
  `DISCONNECT_ROUTE`, `UNDO_DESIGN`, `REDO_DESIGN`, `APPLY_DESIGN`, `CANCEL_DESIGN`,
  `SET_OVERCLOCK_PROFILE`, `SET_MANUAL_OVERCLOCK`, `ACCEPT_TASK`, `ALLOCATE_TASK`, `SET_TASK_HOLD`,
  `ABANDON_TASK`, `START_RESEARCH`, and `CANCEL_RESEARCH`. Production
  gameplay tick systems are Task 6's `calculate-power-demand-and-delivery`, Task 7's
  `calculate-heat-generation` and `update-thermal-state`, Task 8's
  `apply-throttling-stability-and-shutdown`, Task 9's `calculate-theoretical-and-useful-compute`, and
  Task 10's Task-only `advance-tasks-and-benchmarks` stage and Task 11's `advance-research` stage.

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
- At the Task 5.2 checkpoint, `APPLY_DESIGN` was unregistered and returned
  `COMMAND_NOT_AVAILABLE`; Task 5.5 now registers the transaction described below.

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
  - `FacilityState.power: FacilityPowerState`
  - `PowerLimitingReason`
  - `ModulePowerDeliveryState`
  - `RoutePowerDeliveryState`
  - `FacilityPowerState`
- `src/sim/power/powerDemand.ts`:
  - `calculateModulePowerDemand(module, definition)`
  - `calculatePowerDemand(modules, content)`
- `src/sim/power/powerTopology.ts`:
  - `isDirectlySuppliedPowerSource(module, content)`
  - `createPowerTopology(facility, content)`
- `src/sim/power/powerAllocation.ts`:
  - `calculateSourcePortCapacityWatts(portCapacityWatts, sourcePowerFactor)`
  - `allocatePowerDelivery(facility, demands, topology, content)`
- `src/sim/power/powerTransitions.ts`:
  - `applyPowerOperationalTransitions(modules, deliveries)`
- `src/sim/power/facilityPower.ts`:
  - `calculateFacilityPower(state, content)`
  - `createPowerTickSystems(content): TickSystemRegistry`
- `src/sim/power/powerState.ts`:
  - `createDirtyPowerState(contractedPowerWatts)`
  - `validatePowerState(state, content, previousModules?)`
  - `assertValidPowerState(state, content, previousModules?)`
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

## Phase 1 Task 7 implementation

- Every module content record declares validated `thermalBehavior`: `none`, directional
  `local-airflow` with a positive range, or `extraction`. Airflow capacity scales by Power Factor,
  uses rotated external-port rays, adds overlapping contributions, discards out-of-bounds shares,
  and does not use `airflowUnits` or `RouteState`. Powered extraction augments the authoritative
  base facility capacity only for global pressure.
- Heat uses the ADR-0012 delivered-power formula, divides equally across the rotated footprint, and
  includes cooling-module self-heat. All temperature writes read one prior field, use fixed N/E/S/W
  diffusion, apply heat/cooling/diffusion/raw-heat pressure/ambient recovery/clamp in that order,
  and do not round individual tiles.
- `thermalTiles` and `thermalRevision` remain the sole authoritative thermal branches. A revision
  advances once only when an exact temperature changes; sub-epsilon changes remain authoritative.
  Apply preserves temperatures, while command-only processing and `step(0)` do not run thermal.
- The per-`SimCore` private runtime owns topology, stable indexes, typed-array scratch, validated
  immutable Power-input identity, and one tagged pending generation. It invalidates on lifecycle
  replacement, runtime/content replacement, changed live layout revision, or facility dimensions;
  it is excluded from GameState, serialization, hashes, saves, receipts, snapshots, and replay.
- Both thermal stages use targeted validation and transactional structural sharing. A thermal error
  clears pending data and preserves the current authoritative state, tick, clock, RNG, Power result,
  thermal tiles, and revision. Changed records reuse immutable coordinates and unaffected state
  branches retain identity.
- `corepack pnpm performance:thermal` runs the audited 24 by 16 dense fixture and reports cold,
  warm pure, warm complete Power-plus-thermal, dirty-layout rebuild, startup transition, and forced
  validation measurements with environment metadata and explicit warm-up policy. The final hard
  targets pass: warm pure p95 `0.4173 ms` across 500 samples and warm complete production p95
  `2.1939 ms` across 200 samples on the i7-2600. Cold/rebuild/transition paths remain separately
  reported; the preferred integrated `< 1 ms` p95 headroom remains a future opportunity.

| Audited Task 7.4 path | Median | p95 | Maximum | Samples |
| --- | ---: | ---: | ---: | ---: |
| Cold thermal topology construction | 0.2109 ms | 0.4703 ms | 1.0104 ms | 200 |
| Warm pure heat generation plus update | 0.2215 ms | 0.4173 ms | 1.2694 ms | 500 |
| Warm complete Power plus thermal production tick | 1.0960 ms | 2.1939 ms | 4.1767 ms | 200 |
| Dirty-layout rebuild production tick | 3.0399 ms | 4.7943 ms | 12.6301 ms | 200 |
| Startup Power-transition production tick | 1.4260 ms | 2.2970 ms | 3.1257 ms | 200 |
| Forced thermal validation path | 0.1263 ms | 0.1516 ms | 0.2333 ms | 200 |

The measurement used Node `v24.11.0`, V8 JIT/type stripping, Windows `10.0.19045` x64, and an Intel
i7-2600. Each direct path had 100 unmeasured warm-up iterations; fixture construction and state
replacement were outside measured intervals, while fresh-core transition paths also discarded 100
warm-up iterations.

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
- Command candidates and legacy mutable tick-system candidates use the platform-neutral
  `structuredClone` implementation available in supported Node and browser runtimes. Registered
  structural-sharing runtimes instead copy changed branches and must provide scoped lifecycle and
  result validation under ADR-0011.
- Canonical candidate validation runs after each legacy injected system stage. The structural Power
  runtime uses targeted validation on normal ticks and complete relevant validation at new-game,
  replacement, structural-mutation, topology-reconstruction, and explicit diagnostic boundaries.
- The temporary initial credit limit remains `0`; tests may supply another finite nonnegative value.
- Content prices and salvage ratios remain current-version inputs. Task 4 adds no market history,
  scarcity, inflation, or price snapshot to inventory stacks.
- Task 5.2 placements use neutral bin ratios of `1` until the dedicated silicon-binning task. The
  future apply command must revalidate inventory before consumption because independent inventory
  commands may run while a draft exists.

## Phase 1 Task 9 implementation

- `FacilityState.compute` is authoritative, serializable historical state. Dirty results use null
  revisions and empty stable records; calculated results store module/task breakdowns and exact
  theoretical, available, and allocated totals. Historical validation checks structure and internal
  identities without reinterpreting a prior result against later lifecycle or allocation inputs.
- Module theoretical compute is exactly base compute times bin compute ratio times requested
  frequency ratio times the operational ratio. Startup completion, brownout, shutdown, and idle-only
  Power generation are zero; the following full-load tick may calculate compute. Available compute
  then applies current Power, Thermal, and Stability factors once, with no rounding or RNG.
- Task Useful Compute applies Theoretical, Power, Thermal, Memory, Interconnect, Suitability, and
  Stability in that fixed order. Memory uses the fixed working-set minimum/recommended capacity and
  share-scaled bandwidth rules. Stability is exactly `1 - retryRate - invalidSampleRate`; falling
  below a phase minimum is a warning, not Task 9 acceptance or progress policy.
- Data topology is built only from stable authoritative RouteState records. Canonical direction is
  preserved, only bidirectional-to-bidirectional routes work both ways, and cached topology stores
  stable indexes, endpoint direction, path length, latency, and capacity inputs. Shortest directed
  read/write paths determine latency, widest paths determine bandwidth, and local memory has a
  zero-route path. No adjacent-port graph is built or scanned on the warm Compute path.
- Suitability maps only serial, parallel/vector, memory-heavy, bandwidth, and latency phase tags.
  Each required axis takes the best powered usable cluster-module value in the bidirectionally usable
  component, including usable non-compute members, clamped to `[0.70, 1.25]`; the clamped arithmetic
  mean is used, while no mapped axis is exactly one. Boost has no second suitability bonus.
- The production stage calculates the complete facility result exactly once and returns a detached,
  deeply frozen result plus a transaction-only exact witness. The witness covers content, module,
  Power, Overclock, route, task/allocation, revision, dimension, and private-topology identities and
  rejects stale dependencies or any candidate other than the calculated result. It never enters
  authoritative state, saves, replay, hashes, compatibility vectors, receipts, or public contracts.
- Per-SimCore topology, path/provider/order, validation, and thermal scratch caches are derived-only.
  Their complete identities/revisions invalidate them on replacement or relevant input changes.
  Identity-only route copies retain path metrics only when structure and effective capacities match;
  immutable task projections and exactly equal frozen module-result records may be reused.
  Commit still recursively freezes every newly owned object, while previously verified immutable
  branches are structurally shared. Any failure rolls back state, tick, clock, RNG, IDs, receipts,
  allocations, and results.
- ADR-0015 corrects delivery ownership and stored ratio structure without changing gameplay. The
  private task projection includes `deliveredUsefulComputeFlops` and stores its post-calculation value;
  fresh evidence covers both the exact frozen facility result and detached expected task deliveries.
  A private post-Compute guard makes later-stage delivery replacement fatal and rolls back state and
  RNG, while progress/payout-only changes remain cache-compatible. Stored requested frequency is
  strictly positive and operational ratio is exactly zero or one. Provider selection is explicitly
  lower worst read/write latency, then higher minimum bandwidth, then lexical provider ID.
- Test additions are limited to distinct failure classes and reuse shared fixtures/table rows. Task 10
  exclusively owns allocation selection/lifecycle, acceptance, progress, deadlines, rewards, research,
  and benchmark policy.
- Compatibility projections remain `3981c87f4603e9fd` for Task 7 and `6a3d11ce3e14ca83` for Task 8.
  Full-state vectors with the Task 9 Compute foundation were `b3b11ef7f77ca577` and
  `4f51593129881319`. Task 10.1 intentionally adds serialized state fields, producing
  `955cb3249436db4b` and `755cf754a5bd531b` while preserving the Task 7/8 behavioral projections.

Phase 1 Task 11 extends production Compute with the approved global Research reservation while
reusing the existing per-`SimCore` Compute cache. Research delivery is a separate authoritative
result, Task delivery remains the only contributor to `totalAllocatedUsefulComputeFlops`, and
later stages preserve Compute-owned Research/Task outputs. The full-state compatibility vectors
are `7157962fe832def9` (Task 7 projection), `50e67e1213179a35` (Task 8 projection), and
`bc23753d687706dc` (Task 10 lifecycle). These intentional shape changes are recorded in ADR-0017
and the permanent Research diagnostic; Task 7/8 behavioral projections remain unchanged.

## Phase 1 Task 10 implementation

- ADR-0016 defines the authoritative sequence, reputation, and service-window fields; capacity slots;
  offer/instance ownership; allocation shares; command rejection; exact deadline and SLA ordering;
  microdollar rewards and abandonment; validation; compatibility; and deferred scope.
- The content-injected Task handlers accept, allocate, hold/resume, and abandon through the existing
  queue. They are atomic, consume no RNG, preserve command-only tick/progress/SLA state, canonicalize
  allocation IDs, reserve shares only while active, and retain terminal allocation/progress history.
- Real ticks run Task advancement after current Task 9 Compute. They reconcile eligible offers, fail
  deadlines before progress, apply only runnable/stable delivery, clamp phases and discard surplus,
  settle whole service windows, and apply completion rewards once. Current Compute-owned delivery is
  preserved through commit, while phase/status changes affect Compute on the following tick.
- Private Task witness evidence is per-`SimCore`, calculation-local, and cleared on replacement and on
  every exit. Structural sharing replaces only changed Task/campaign/Research/economy branches. A Task
  or delivery-ownership failure rolls back the whole tick, clock, economy, state, and RNG.
- Content-independent validation runs at construction, command candidates, saves, replacement, and
  changed final branches; content-aware validation checks content relationships without adding a generic
  content dependency to `SimCore`. Content validation enforces exact tick conversion, service shape,
  phase work, evidence uniqueness, prerequisites, and unchanged supplied numeric values.
- Task 7/8 behavior projections remain `3981c87f4603e9fd` and `6a3d11ce3e14ca83`; Task 10's
  serialized-state vectors are `955cb3249436db4b` and `755cf754a5bd531b`. The fixed 100-tick Task
  lifecycle integration hash is `1fc91ca07fa5a046`.
- The Task 11.1 serialized-state vectors are `7157962fe832def9`, `50e67e1213179a35`, and
  `bc23753d687706dc`; Task 11.3 adds no new compatibility vector because active Research Compute
  results are derived during production ticks and existing no-Research fixtures retain their Task
  delivery values.
- `corepack pnpm performance:tasks` is permanent. Its final audited i7-2600 run measured warm pure Task
  median/p95/max `0.0186/0.0578/1.1083 ms` (1,000 samples) and full production
  `1.3456/2.2562/9.3940 ms` (200 samples), passing `<0.20 ms`, `<4 ms`, and preferred `<3.7 ms` p95
  gates. The diagnostic retains every sample and reports transition, payout, command, and witness paths.
- Task 11 is complete at its single checkpoint-neutral boundary. Its permanent Research diagnostic,
  compatibility results, and final verification are recorded in ADR-0017 and
  `docs/diagnostics/RESEARCH_LIFECYCLE_PERFORMANCE.md`. Task 12, Benchmark runners, is next.

## Verification

- Task 10 focused lifecycle/command/Task 9 ownership regression coverage: PASS, 15 files and 324 tests.
  Complete unit verification: PASS, 40 files and 665 tests. Standalone determinism: PASS, 8 files and
  10 tests. Two separate clean `pnpm test` processes passed those same unit and determinism suites.
  Exact-100 Task lifecycle and final-hash verification, aggregate validation, standalone production
  build, compatibility vectors, static scans, and content/document drift checks pass.
- Task 9.5 focused state/domain/cache/SimCore/compatibility/exact-100 verification: PASS, 7 files and
  98 tests. Standalone unit verification: PASS, 36 files and 580 tests. Standalone determinism: PASS,
  8 files and 10 tests. Two separate clean `pnpm test` processes passed those same unit and
  determinism suites. Aggregate validation passed formatting, ESLint, strict TypeScript, content
  validation, and a production build of 846 modules. The standalone production build, diff check,
  simulator forbidden API/import scan, adjacent-port-graph scan, and balancing/GDD/Word drift checks
  also pass.
- The unchanged Task 9 diagnostic on 31 August 2026 measured pure median/p95/max
  `0.0678/0.1468/1.4512 ms` (500 samples) and complete production
  `1.8632/3.1380/13.8847 ms` (200 samples), passing the permanent `<0.35 ms` and `<4 ms` p95 gates.
  Cold topology was `0.1965/0.4404/1.9985 ms`; changed congestion and allocation
  `0.0804/0.1229/1.2449 ms`; transitions `0.0814/0.1113/2.5101 ms`; fresh result/witness
  `0.1258/0.1854/0.6129 ms`; exact witness validation `0.0030/0.0048/0.0419 ms`. Fixture, warm-up,
  samples, formulas, balancing, and thresholds remain unchanged.
- Focused Task 9 state, pure-domain, production, witness, and compatibility coverage: PASS, 6 files
  and 87 tests. The coverage includes exactly one full facility calculation, immutable result/evidence,
  every result-family tamper, every actual dependency family, directed and bidirectional routes,
  shared allocations, contention/congestion, transition timing, historical validation, zero RNG,
  rollback, serialization, and exact 100-run determinism.
- Complete Task 9-era unit suite: PASS, 36 files and 570 tests. Standalone determinism: PASS, 8 files
  and 10 tests. Task 9's dense production fixture now repeats results, state, tick, IDs, hash, and RNG
  identically across exactly 100 independent runs. `corepack pnpm test` passed twice in separate clean
  processes with the same counts.
- The unchanged dense 24 by 16 fixture contains 110 modules, 112 routes, 60 route path points, two
  active allocations sharing one module, eight transition modules, and five inventory stacks. Three
  clean i7-2600 processes measured pure Task 9 p95 `0.1684/0.1858/0.1667 ms` and complete production
  p95 `2.8424/3.1910/2.8493 ms`, passing the hard `<0.35 ms` and `<4 ms` gates, plus the preferred
  `<3.7 ms` production target, in every run. Fixture construction and 100 JIT warm-ups were excluded.
- In those runs, fresh calculate-once result/witness p95 was `0.1763/0.1856/0.1933 ms`; exact witness
  validation p95 was `0.0024/0.0024/0.0021 ms`. The earlier production path calculated the full
  facility twice; the final path calculates it once and validates the exact frozen result and exhaustive
  dependency evidence without serialization or a lossy-hash shortcut.
- The independent checkpoint review retained the unchanged diagnostic and confirmed host-load-sensitive
  production variance after its correctness corrections. A prior three-process sequence measured pure
  p95 `0.2106/0.1715/0.2325 ms` and production p95 `3.9602/3.2206/5.5204 ms`. Later probes across
  successive semantics-preserving allocation reductions recorded production p95 `4.5879`, `4.4575`,
  and `6.7941 ms`; their corresponding pure Task 9 p95 values remained below the hard gate. These later
  probes were not a clean acceptance set: live process-rate sampling showed Opera consuming about
  `2.66` CPU cores and ChatGPT processes about `1.29` CPU cores, and cold topology, dynamic,
  transition, and production timings inflated together while exact witness validation remained near
  `0.003 ms`. The project owner explicitly accepted this as a target-PC process-contention irregularity
  for the checkpoint on 30 August 2026. The permanent `<0.35 ms` pure and `<4 ms` production gates,
  sample counts, warm-up, fixture, and failure behavior remain unchanged; future comparisons must run
  with unrelated heavy processes inactive and must not filter samples or alter priority/affinity.

- Focused Task 6 and Task 6.1 coverage: PASS, 4 files and 79 tests, including historical startup
  generation acceptance, strict same-generation contradiction rejection, topology/result-cache
  lifecycle and dynamic-input invalidation, changed Apply, draft/undo/redo/cancel stability,
  replacement, cold/warm equality, fatal state/RNG rollback, brownout/recovery/shutdown/cooldown
  boundaries, structural sharing, incremental immutability, scratch isolation, and RNG preservation.
- Complete unit suite: PASS, 25 files and 431 tests. Complete standalone determinism suite: PASS, 6
  files and 8 tests with all exact-100 runs and explicit 15-second timeouts unchanged. The timeout
  repair separates validation-only canonical graph traversal from canonical text construction;
  unsupported values still fail and hashes/serialized output are unchanged. No timeout, exact-run
  assertion, discovery, `fileParallelism`, or worker setting changed.
- Before repair, three isolated clean-process runs measured Design undo/redo at `22.213`, `18.872`,
  and `20.429` seconds and SimCore determinism at `16.895`, `16.349`, and `14.350` seconds. Base
  checkpoint runs overlapped the same unstable range. After repair, the three isolated timings were
  `12.170/10.942/10.740` and `8.017/7.998/8.060` seconds. Together in one serial process they passed
  at `12.242` and `9.574` seconds.
- The final complete `corepack pnpm test` command passed twice consecutively in clean processes: 25
  files/431 unit tests followed by 6 files/8 determinism tests in each run, with wall times `81.142`
  and `81.028` seconds.
- Published RNG, canonical-hash, money, geometry, routing, undo/redo, and Apply compatibility vectors
  remain covered by the passing unit and determinism selections.
- Fresh pre-optimization reproduction on the target i7-2600: pure Power median `1.4983 ms`, p95
  `2.5410 ms`, max `4.5027 ms`; complete tick median `45.4178 ms`, p95 `77.3539 ms`, max
  `102.3123 ms`. Stage p95 values were clone `11.8016 ms`, canonical validation `39.4833 ms`, Power
  `7.6584 ms`, freeze `3.3009 ms`, and derived/orchestration residual `15.1097 ms`.
- Final post-repair production-mode i7-2600 diagnostic on the same audited fixture after separate
  JIT warm-up: warm pure Power median `0.0009 ms`, p95 `0.0013 ms`, max `0.1267 ms`, 500 samples;
  complete production tick median `0.0163 ms`, p95 `0.0311 ms`, max `0.2605 ms`, 200 samples. Both
  acceptance targets pass.
- Cold topology reconstruction was excluded from setup and steady timing and measured separately:
  median `1.8128 ms`, p95 `2.7236 ms`, max `7.9483 ms`, 200 samples. Dirty-input proxies reported
  Power recalculation p95 `0.6753 ms` and targeted validation p95 `1.6424 ms`. Startup completion and
  following-tick forced recalculation were timed separately as warm-topology production ticks at p95
  `3.7369 ms` and `3.7034 ms`; fixture construction and the first topology-building tick were
  excluded, while the transition work itself remained timed.
- Existing diagnostics completed: Apply preview/apply p95 `59.0372/42.5961 ms`; routing
  connect/disconnect p95 `24.1001/18.0402 ms`; Design Mode operation p95 values
  `27.9098-35.3817 ms`; grid occupancy/placement/graph p95 `1.3127/1.0978/26.1613 ms`; empty/private
  tick p95 now `0.0097/10.0025 ms` for empty/private fixtures.
- Task 7 focused coverage: PASS, 5 files and 53 tests, including content roles, structural state,
  pure heat/cooling/diffusion, transactional stages, runtime cache reuse/invalidation, rollback,
  revision/identity behavior, deterministic thermal hash, and the audited fixture.
- Task 1 through Task 6.1 regression and published compatibility selection: PASS, 13 files and 243
  tests for seed/RNG, canonical hash, money, geometry/ports, routing, undo/Apply, Power, and exact
  determinism vectors.
- Final `corepack pnpm test` passed twice in separate clean processes: 29 files/472 unit tests then
  6 files/8 determinism tests on each run. Exact 100-run loops, timeouts, and assertions remain
  unchanged.
- Formatting, ESLint, strict TypeScript, content validation, production build, and aggregate
  `corepack pnpm validate`: PASS. Content validation reports 12 modules, 8 tasks, 10 research nodes,
  2 benchmarks, and 2 locales; the production build transforms 846 modules.
- `git diff --check`, forbidden simulator API/import scan, and thermal adjacent-port-graph scan:
  PASS. GDD and Word documents are unchanged. `content/balancing.json` is unchanged; the only module
  content additions are the approved `thermalBehavior` declarations, with no numerical balance or
  route-content drift.

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
- Legacy mutable system callbacks still pay for an isolated candidate clone and broad canonical
  validation. A future production system may opt into structural sharing only with explicit
  copy-on-write ownership, lifecycle validation, and targeted output invariants.
- `SimulatorInvariantError.commandId` uses an internal diagnostic identifier for tick-system errors
  so the Task 2 command-error field remains backward compatible; tick-system consumers should use
  the added `tick` and `stage` diagnostics.
- Six-decimal public USD values remain IEEE-754 numbers. Canonical conversion is deterministic for
  the checked safe microdollar range, but future monetary systems must continue using the helpers
  instead of ad hoc floating-point arithmetic.
- The transaction registry is intentionally explicit: callers must inject the validated immutable
  content bundle and pass the returned handlers to the existing processor or `SimCore` registry.
- The final complete vertical-slice fixture may add later systems that consume the remaining tick
  budget. Task 6.1 proves only the audited Power fixture and preserves the broader under-4-ms gate
  for future integrated profiling.
- Result-cache invalidation intentionally names every current authoritative Power input. Future
  Power formulas must extend that dirty-input key and its regression tests before using new state.
- Stored Power results do not contain a serialized calculation-input generation. Lifecycle and
  topology-rebuild validation therefore prove historical structural consistency without
  reinterpreting source availability from a later operational state. Strict targeted validation
  proves every new result against its exact tick-start inputs before commit.
- Wall-time diagnostics remain sensitive to host scheduling. Performance acceptance uses a
  controlled warmed diagnostic; normal tests contain no unstable timing assertion.
- Compute's calculate-once witness and private topology/order/provider caches enumerate every current
  dependency. Any future Compute formula or input branch must extend that evidence and its stale-input
  regression coverage before the optimized fresh-validation path may consume it.
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
- Design preview intentionally remains structural/economic and does not estimate functional Power,
  thermal, Overclock, Useful Compute, or task-risk effects.

## Task boundary

Task 6.1 is checkpointed at `06f6e7893fe8b6ef181375ee1a159f8b11aa2afc`; Task 7, Task 8, and Task 9.1
through Task 9.5 are complete. Task 10 is complete under ADR-0016 at its single final checkpoint
boundary. Task 11 is complete at its single checkpoint-neutral boundary under ADR-0017. The exact
next Phase 1 task is Task 12, Benchmark runners; no Task 12 implementation is included here.

## Phase 1 Task 6 implementation

- `FacilityState.power` is authoritative serializable data with an explicit dirty shape and complete
  calculated module/power-route coverage tied to `liveLayoutRevision`.
- Validated immutable content supplies idle/load demand, minimum power, categories, ports, and
  capacities. Demand divides by finite positive bin efficiency and does not apply overclock,
  workload, or thermal factors.
- Direct power sources consume global contracted capacity first. Routed delivery shares source
  output, route, and sink input capacities; allocation uses fixed category tiers, stable IDs, and a
  minimum pass before remaining demand.
- Power delivery owns automatic startup, brownout, and recovery while preserving shutdown and
  cooldown. Sources that finish startup supply routes beginning on the following tick.
- Facility totals, headroom, module Power Factors/reasons, route flow/utilization, and the Task 4
  exact-0.1-second energy cost are calculated without economy settlement or RNG use.
- Production registers only `calculate-power-demand-and-delivery`. Apply resets changed layouts to
  dirty; drafts and command-only processing do not run power. Failures remain transactional under
  ADR-0003 and ADR-0011.

## Phase 1 Task 6.1 implementation

- Every `SimCore` materializes its own Power runtime. Its private topology cache contains stable
  ordering, resolved definitions/ports/routes, numeric indexes, capacity groups, and allocation
  indexes outside authoritative state.
- Topology is keyed by `liveLayoutRevision`, rebuilt after changed Apply, and cleared explicitly at
  construction or validated state replacement. Draft-only edits, undo, redo, cancel, command-only
  processing, and unrelated commands do not invalidate it.
- A validated warm result may be reused only while the module, Power, and route branches retain
  identity, contracted capacity, energy price, and live revision retain value, and the preceding
  calculation caused no operational transition. Module identity covers source operational,
  startup/cooldown, demand, and other allocation inputs. Startup completion therefore invalidates
  reuse and makes a source available only on the following tick.
- Production Power ticks use copy-on-write structural sharing and targeted Power validation. Initial
  state, replacement, structural mutation, and topology-reconstruction boundaries validate stored
  historical Power structure. A new result is checked against the exact tick-start state, so a
  contradictory same-generation limiting reason still causes deterministic fatal rollback.
- Initial/replacement state is detached and frozen once. Tick commit recursively freezes only new
  branches and stops at objects already verified by the owning authoritative state; newly
  shallow-frozen branches are still traversed, so retained references cannot mutate authoritative
  state.
- Private typed allocation/validation scratch arrays and reusable demand records are never reachable
  from authoritative state, canonical serialization, hashes, saves, snapshots, receipts, or replay
  data. Power still consumes no RNG.
- ADR-0011 supersedes only ADR-0003 decisions 15 and 16 for registered structural-sharing runtimes;
  immutable stage order, fixed tick timing, atomicity, rollback, RNG protection, and the legacy
  mutable-system fallback remain intact.

## Phase 1 Task 11 implementation and closeout

- ADR-0017 fixes the additive Research state/result contract, content hardening, global Compute
  reservation, exact cache projection, historical-result semantics, command precedence/costs,
  lifecycle eligibility, progress, final reveal, Museum formulas, rollback, ownership, and
  determinism. The fixed production order is Compute after Power/Thermal/Stability, Task
  advancement, then `advance-research`; Research does not consume Memory, Interconnect, Suitability,
  or RNG.
- The shared per-`SimCore` Compute cache reuses only the Research projection `null` or
  `{ nodeId, reservedComputeShare }`. Progress/status/Data/Evidence changes are cache-compatible;
  node/share/active-null changes invalidate Research and Task deliveries atomically. The current
  Compute branch and its Research result remain owned by Compute, and later stages preserve them.
- `START_RESEARCH` and `CANCEL_RESEARCH` use the existing command processor. Starts pay cash and
  Research Data atomically with integer microdollars; cancellation has no refund and loses progress.
  Research eligibility requires completed prerequisites, required Evidence Tags, and unique matching
  passed benchmark mappings. Final completion creates only `museum-vacuum-tube-final` and no
  transistor hardware.
- The permanent diagnostic is `corepack pnpm performance:research`, documented in
  `docs/diagnostics/RESEARCH_LIFECYCLE_PERFORMANCE.md`. Its audited i7-2600 p95 values are
  `0.0048 ms` reservation, `0.0719 ms` lifecycle, `0.1082 ms` Task 9 Compute, and `2.9352 ms`
  complete production, with all Research hard gates passing. It retains the fixed sample counts,
  dense fixture, validation, formulas, and determinism repetitions.
- Final checkpoint performance verification records one explicit exception: the unchanged Task 8
  pure-domain diagnostic measured median/p95/max `0.1045/0.2605/1.5377 ms` over 500 samples, so its
  p95 exceeded the nominal `< 0.25 ms` gate by `0.0105 ms`; warm Task 8 production passed at p95
  `2.4462 ms`. The user accepted this isolated irregularity without any change to Task 8 code,
  formulas, fixture, samples, warm-up, assertions, timeout, or threshold. Thermal passed at pure p95
  `0.2706 ms` and production p95 `1.8368 ms`.
- Compatibility changes are limited to serialized `research: null` on dirty Compute and
  `researchFactor: 1` in Task breakdowns. Published full-state vectors are `7157962fe832def9`,
  `50e67e1213179a35`, and `bc23753d687706dc`, with exact structural reasons in ADR-0017. Task 7/8
  behavioral projections, balancing/module numeric values, GDD, and Word documents remain unchanged.
- Task 11 is complete at its single checkpoint-neutral boundary. Task 12, Benchmark runners, is
  the exact next Phase 1 task; no Task 12 behavior is included.

## Explicitly deferred

- Real-time tick scheduling, timers, catch-up, pause/speed host scheduling, and worker integration.
- Every production gameplay command handler except `BUY_MODULE`, `SELL_INVENTORY_ITEM`,
  `ENTER_DESIGN_MODE`, `PLACE_MODULE`, `MOVE_MODULE`, `ROTATE_MODULE`, `REMOVE_MODULE`,
  `CONNECT_PORTS`, `DISCONNECT_ROUTE`, `UNDO_DESIGN`, `REDO_DESIGN`, `APPLY_DESIGN`,
  `CANCEL_DESIGN`, `SET_OVERCLOCK_PROFILE`, `SET_MANUAL_OVERCLOCK`, `ACCEPT_TASK`,
  `ALLOCATE_TASK`, `SET_TASK_HOLD`, `ABANDON_TASK`, `START_RESEARCH`, and `CANCEL_RESEARCH`.
- Automatic energy deductions, power capacity purchases, labor and relocation costs, Research
  staffing or maintenance beyond the approved lifecycle, inflation, market events, scarcity,
  financing, interest, insolvency, bailout, bankruptcy, and financial game over.
- Installed-module sales, auto-connect, auto-route, pathfinding, rerouting, and route preview.
- Benchmarks, blueprints, replay execution, balancing bot, Research UI, Research events, and later
  progression features outside the approved Task 11 lifecycle.
- React/Pixi integration, IndexedDB, save/load, migrations, export, and import.
