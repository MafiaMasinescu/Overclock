# ADR-0011: Incremental Tick Transactions and Derived Power Cache

Status: Accepted

Date: 25 August 2026

## Context

The reviewed Task 6 implementation preserved deterministic Power behavior but missed both approved
performance targets on the audited `24 x 16`, 250-module, 270-power-route fixture. The audited
baseline reported pure Power p95 `3.0037 ms` and complete production-tick p95 `55.8291 ms`. A fresh
Task 6.1 reproduction on the target i7-2600 reported `2.5410 ms` and `77.3539 ms` respectively.

Profiling showed two independent costs. Power rebuilt sorted topology and string-keyed capacity
indexes on every tick. ADR-0003's injected-system transaction also cloned, canonically serialized,
and recursively froze the complete `GameState`, even though Power changes only facility modules and
the Power result. Those protections remain correct but are too broad for an ordinary production
tick whose authoritative input was already validated and frozen.

Checkpoint review also exposed a generation-boundary defect in pre-stage validation. A source that
completed startup at the end of tick N was online in the committed module branch, while the
committed Power result still correctly described its tick-N unavailability. Reinterpreting that
historical result with the online tick-N+1 module state expected `route-capacity` instead of the
persisted `source-unavailable` result and prevented the next calculation.

The final checkpoint gate then exposed a separate test-runner stability problem. The unchanged
exact-100 Design undo/redo and SimCore determinism tests exceeded their unchanged 15-second timeout
both individually and with the already-serial Vitest configuration. Profiling showed no Power
topology reconstruction or result-cache invalidation in either fixture. The dominant cost was
whole-state canonical text construction performed only to validate and discard that text; Task 6.1
also added required command-candidate freezing, which reduced the remaining timing margin.

## Decisions

1. `TickSystemRegistry` supports simulator-instantiated runtime factories in addition to the legacy
   mutable callback. Every `SimCore` creates its own runtime instance. A runtime may opt into the
   structural-sharing execution mode; legacy callbacks retain the complete clone and broad
   validation fallback.
2. The Power runtime owns a private derived topology cache. The cache is outside `GameState` and is
   keyed by `facility.liveLayoutRevision`. It contains stable module/source/sink/route order,
   resolved route endpoints and capacities, priority tiers, numeric module/route indexes, shared
   port-capacity groups, and incoming-route indexes.
3. A cache hit is valid only while `liveLayoutRevision` is unchanged. Changed Apply invalidates by
   revision and rebuilds at the following Power tick. Draft edits, undo, redo, cancel, rejected or
   unrelated commands, and command-only processing do not invalidate because they do not change the
   live revision.
4. Runtime caches are explicitly cleared when a `SimCore` is created and when `replaceState()`
   commits a validated replacement. A reused registry still creates independent caches for each
   simulator. Future load/import integration must use this lifecycle boundary rather than replacing
   authoritative state behind the runtime.
5. New game and state-replacement boundaries retain complete canonical, clock, inventory/economy,
   Design Mode, stored-Power, and Power-topology validation. Stored-Power validation treats a
   committed result as historical: it checks structure, references, numeric safety, totals,
   capacities, route flow, and generation-independent reason consistency, but does not infer the
   prior calculation's source availability from a later Power-owned operational state. A cache
   rebuild applies the same historical validation and reconstructs topology from authoritative
   layout/content. Changed Apply continues to perform its existing full grid, route, preview,
   inventory, and transaction validation before changing the live revision.
6. A structural-sharing runtime consumes the frozen authoritative state and returns a candidate root
   at the same tick. Power copies only the root and facility branches plus operational module and
   Power records whose values changed. Unchanged authoritative branches and steady Power/module
   records retain identity. No authoritative commit occurs until every registered stage succeeds.
7. `AuthoritativeState` detaches and recursively freezes initial/replacement state once. Command
   candidates are frozen when committed. Tick commit uses the same recursive function, which stops
   immediately at objects previously verified and frozen by that `AuthoritativeState` instance and
   therefore traverses only new branches. A newly shallow-frozen object is still traversed before it
   is trusted. This protects against retained-reference mutation without rescanning the unchanged
   graph.
8. Warm structural-sharing ticks validate system-controlled tick/clock fields, RNG state, and a
   targeted Power result. The Power validator checks stable coverage and references, deterministic
   demand/minimum values, finite nonnegative delivery, Power Factors, limiting precedence,
   Power-owned startup/brownout transitions, route utilization, shared route/port/contracted
   capacity, facility totals/headroom, layout revision, and exact 0.1-second energy cost. Invalid
   output remains fatal and the complete current tick rolls back. This new-result validation
   receives the exact tick-start state, so contradictory same-generation source availability or
   limiting precedence remains fatal. Current dynamic inputs are validated as they are resolved
   into demand, topology, allocation, and the targeted result.
9. After a successful calculation that causes no Power-owned operational transition, the runtime
   may retain a private reference-keyed result entry. It may reuse that already validated result
   only while the authoritative modules, Power record, route branch, contracted capacity, energy
   price, and live revision inputs are unchanged. The module-branch identity covers source
   operational/startup/cooldown state and every module field used by demand. Results that perform
   startup, brownout, recovery, shutdown, or cooldown transitions are never cached for the following
   tick. This preserves the rule that a source completing startup becomes usable only on the
   following tick.
10. Power allocation reuses private typed numeric scratch arrays for module/route delivery,
   source/sink/route remaining capacity, and source availability. Demand records are also private
   reusable scratch. Scratch and topology objects never become reachable from committed state,
   saves, hashes, snapshots, receipts, results, or replay data.
11. Controlled diagnostics use a separate JIT warm-up under `NODE_ENV=production`, V8 JIT, and Node
    TypeScript type stripping. They measure at least 500 warmed pure-Power samples and 200 complete
    production ticks. Fixture setup is excluded, and cold topology reconstruction is reported as a
    separate measurement.
12. This ADR supersedes ADR-0003 decisions 15 and 16 only for registered structural-sharing
    production runtimes. ADR-0003's fixed stage order, per-tick atomicity, protected clock/tick
    fields, fatal attribution, RNG rollback, earlier-command and earlier-tick survival, and legacy
    mutable-system protections remain unchanged.
13. Validation-only boundaries use `assertCanonicalSerializable()` to enforce the same supported
    primitive, prototype, property-descriptor, finite-number, array-density, and acyclic-graph rules
    without constructing canonical JSON text that will be discarded. Canonical serialization and
    hashing remain unchanged whenever their output is required. This applies to command admission,
    candidate validation, simulator construction/replacement/save validation, and the legacy
    mutable-system fallback; it neither removes traversal nor relaxes fatal invariant handling.

## Consequences

- Derived cache and scratch history cannot affect canonical serialization or deterministic hashes.
- A failed later stage may leave a valid private topology cache populated, but exposes no candidate
  authoritative state. Retrying the same authoritative revision may safely reuse that cache.
- Historical validation cannot prove transition-dependent semantics that are not stored with the
  result. That proof is performed before commit by the strict same-generation validator with the
  exact calculation inputs; lifecycle validation must not manufacture a missing generation by
  substituting current operational state.
- Structural runtimes must own scoped lifecycle and output validation. A future production system
  may opt into this path only with equivalent domain invariants and copy-on-write ownership.
- `replaceState()` rejects replacement while commands are pending, validates a detached boundary,
  commits atomically, and clears derived runtimes. It does not implement save/load transport.
- Cold reconstruction remains intentionally more expensive than a warm tick and is paid only after
  lifecycle/revision changes.
- Wall-time p95 remains sensitive to operating-system scheduling on the i7-2600. Correctness gates
  contain no unstable timing assertion; the controlled diagnostic is the acceptance measurement.
- Validation and canonical output construction now have separate APIs. New validation-only call
  sites must use the validator, while hashes, replay vectors, comparisons, and persisted canonical
  text must continue to use `canonicalSerialize()` or `hashCanonicalState()`.

## Measured outcome

The final production-mode diagnostic ran on the target Intel Core i7-2600 under Windows 10 build
19045, Node `v24.11.0`, and pnpm `11.22.0`. After a separate JIT warm-up, the audited fixture
reported:

- warm pure Power runtime, 500 samples: median `0.0009 ms`, p95 `0.0013 ms`, maximum `0.1267 ms`;
- complete production Power tick, 200 samples: median `0.0163 ms`, p95 `0.0311 ms`, maximum
  `0.2605 ms`;
- cold topology reconstruction, 200 samples and separate from fixture setup: median `1.8128 ms`,
  p95 `2.7236 ms`, maximum `7.9483 ms`;
- forced dirty-input Power recalculation proxy, 200 samples: median `0.4735 ms`, p95 `0.6753 ms`,
  maximum `3.4203 ms`;
- targeted validation after recalculation proxy, 200 samples: median `0.7356 ms`, p95 `1.6424 ms`,
  maximum `6.9778 ms`;
- startup-completion production tick with warm topology, 200 samples: median `1.6628 ms`, p95
  `3.7369 ms`, maximum `9.1028 ms`;
- following-tick forced production recalculation with warm topology, 200 samples: median `2.2233 ms`,
  p95 `3.7034 ms`, maximum `8.1446 ms`.

The stability repair retained both exact-100 loops and every equality, hash, receipt, command-result,
RNG, and state assertion. Three clean-process runs measured Design undo/redo at `12.170`, `10.942`,
and `10.740` seconds and SimCore determinism at `8.017`, `7.998`, and `8.060` seconds. The two files
together passed in one serial process at `12.242` and `9.574` seconds respectively. Two consecutive
complete `pnpm test` runs passed with 431 unit tests and 8 determinism tests each.

The warm pure-Power p95 below `1 ms` and complete production-tick p95 below `4 ms` targets both
pass. The dirty-input proxies and production startup paths are reported separately and are not
additive to the steady-state tick. Fixture construction and the first topology-building tick are
excluded from the startup measurements; the startup transition itself remains inside its timed
production tick.

## Rejected alternatives

- Storing topology, maps, sets, or typed scratch in `GameState` would contaminate hashes and saves.
- A factory-global cache would couple independent simulators and allow one lifecycle to affect
  another.
- Keying only by object identity would invalidate on ordinary structural-sharing ticks and would not
  express the authoritative layout contract.
- Keeping whole-state clone/canonical/freeze on the production Power path cannot meet the complete
  tick budget.
- Removing invariant validation entirely would trade deterministic fatal rollback for silent
  corruption.
- Rewriting ADR-0003 would erase the historical contract and its still-supported legacy fallback.
