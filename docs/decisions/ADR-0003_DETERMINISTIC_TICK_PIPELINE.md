# ADR-0003: Deterministic Fixed-Step Tick Pipeline

Status: Accepted

Date: 18 August 2026

## Context

Phase 1 Task 3 connects the Task 2 command processor to the TDD's fixed simulation order. The
current deliverable is a directly callable headless `SimCore`; real-time host scheduling, workers,
snapshots, events, replay, saves, and gameplay systems remain deferred.

The TDD assigns pause and speed scheduling to the future host. The synchronous clock-command entry
point established here does not schedule ticks: it updates the authoritative clock fields that the
future host will route and observe.

## Decisions

1. One simulation tick is always exactly 100 milliseconds, or 0.1 simulated seconds. Tick duration
   is not configurable and never scales with speed.
2. `GameState.tick` counts completed ticks. A new game starts at tick `0`; the first successful
   `step(1)` completes at tick `1`.
3. `clock.simulatedSeconds` is derived after a completed tick as `tick / 10`. It is never advanced
   through repeated floating-point addition. Task 3 does not update `campaign.currentYear`.
4. `step()` defaults to one tick. It accepts only nonnegative safe integers and rejects a request
   that would exceed `Number.MAX_SAFE_INTEGER` before consuming commands or changing state.
5. `StepResult` contains the authoritative start and end ticks, completed tick count,
   `ticksExecuted / 10`, and ordered command results. It is plain JSON data and does not calculate a
   state hash.
6. At the beginning of a requested tick, commands are drained in deterministic FIFO order and
   processed at the current authoritative tick. All commands waiting before `step(n)` are handled
   in the first requested tick. Tick systems run only after command processing succeeds, and the
   tick increments only after all systems succeed.
7. `step(0)` is a complete no-op. `processPendingCommands()` is the separate command-only entry
   point: it works while paused or running and does not execute systems, advance tick, or change
   simulated time.
8. Manual headless `step()` executes the requested fixed ticks regardless of `clock.paused` or
   `clock.speed`. Pause and speeds `1`, `2`, and `4` affect only future host scheduling. Four-times
   speed will mean four ordinary ticks, never a larger delta.
9. `applyClockCommand()` accepts only `SET_PAUSED` and `SET_SPEED`. It parses the existing command
   envelope, applies exact expected-tick equality, accepts idempotent assignments, returns a normal
   accepted or `STALE_TICK` result at the current tick, and never consumes a queue sequence. Clock
   commands sent through the regular queue retain Task 2's `COMMAND_NOT_AVAILABLE` behavior.
   `SimCore` excludes clock handlers from its queued-handler type and removes them from an unsafe
   runtime injection, while the standalone Task 2 processor remains backward compatible.
10. The complete TDD order is represented by an explicit tuple: dequeue and order commands;
    validate and apply commands; rebuild dirty connectivity; calculate power demand and delivery;
    calculate workload allocation; calculate heat generation; update thermal state; apply
    throttling, stability, and shutdown; calculate theoretical and Useful Compute; advance tasks
    and benchmarks; advance research; apply economy and energy costs; update tutorial,
    achievements, and campaign; emit events; produce dirty snapshot data.
11. Production registers no gameplay tick systems in Task 3. A narrow typed partial registry may be
    injected by tests. Registry keys never determine execution order; iteration always follows the
    fixed tuple.
12. Task 2 atomicity remains per command. Recoverable command rejection does not stop a tick. A
    fatal command failure stops before systems, while earlier command commits remain authoritative.
13. Tick systems share one isolated candidate and one RNG restored from the post-command state.
    Their state changes, completed tick, derived time, and resulting RNG state commit together only
    after every registered stage succeeds.
14. A throwing system or invalid candidate produces `SimulatorInvariantError` with
    `SIMULATOR_INVARIANT_VIOLATION`, the current tick, and stage identifier. The failing tick's
    candidate and RNG use are discarded, later systems do not run, command commits remain, and any
    earlier completed ticks remain committed.
15. Tick systems cannot change tick or host-controlled clock fields. After each executed stage,
    candidate validation checks protected fields, unsigned 32-bit RNG state, and canonical
    serializability so failures identify the system that produced them. Before commit, the complete
    system candidate is recursively frozen so a retained callback reference cannot mutate
    authoritative nested state.
16. Empty production ticks use structural sharing and narrow root/clock copies. They do not clone,
    canonical-serialize, or hash the complete state. Injected system ticks currently use an isolated
    clone and per-stage canonical validation; later gameplay systems may replace this with narrower
    domain candidates and validators when profiling justifies it.
17. Performance measurement lives outside `src/sim`, uses Node timing, warms up both fixtures, and
    reports median, p95, and maximum for the empty pipeline and a controlled private system fixture.
    Measurements are diagnostic and do not claim the final Intel i7-2600 gate before the complete
    vertical-slice fixture exists.
18. Timers, accumulators, catch-up, offline assist, the 20-tick host burst, workers, GameClient
    routing, replay logging, save/load, snapshot throttling, event delivery, and all gameplay systems
    remain deferred.

## Consequences

- Tick grouping does not affect fixed-time formulas or deterministic RNG progression.
- A save boundary receives a detached plain-data state snapshot, never the authoritative reference.
- Queue sequence, replay policy, and future host timing remain independent from explicit clock
  commands.
- Registered system ticks currently pay isolation and validation costs; the empty Task 3 production
  pipeline does not.

## Rejected alternatives

- Variable delta time would make speed and grouping alter gameplay results.
- Treating `step(0)` as command processing would make a zero-tick call mutate state.
- Routing clock commands through the regular queue would consume queue sequence and conflict with
  host-controlled scheduling.
- Rolling back command commits after a later system failure would contradict ADR-0002.
- Cloning or hashing the complete state on every empty tick would spend the performance budget on
  work that provides no Task 3 gameplay value.
