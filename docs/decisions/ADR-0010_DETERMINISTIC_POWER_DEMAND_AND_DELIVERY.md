# ADR-0010: Deterministic Power Demand and Delivery

Status: Accepted

Date: 25 August 2026

## Context

Phase 1 Task 6 activates only the existing `calculate-power-demand-and-delivery` tick stage. The
simulator needs authoritative, explainable power results without introducing workload, thermal,
economy-settlement, pathfinding, or UI behavior. The calculation must preserve ADR-0003 tick
atomicity, ADR-0004 monetary precision, ADR-0007 route semantics, and ADR-0009 Apply behavior.

## Decisions

1. `FacilityState.power` is authoritative plain serializable data. A dirty state uses
   `layoutRevision: null`, empty module/route records, zero requested/delivered power and energy
   cost, and headroom equal to contracted capacity. A calculated state records the current live
   layout revision and contains every live module and every live power route exactly once.
2. A non-shutdown ready module requests `loadPowerWatts / binEfficiencyRatio`; a starting module
   requests `idlePowerWatts / binEfficiencyRatio`; minimum operational power is
   `idlePowerWatts / binEfficiencyRatio`. Ratios must be finite and positive. Watts keep full finite
   precision and normalize negative zero without monetary quantization.
3. A directly supplied source is a live module whose validated content category is `power` and
   which exposes a `power-out` port. It consumes contracted capacity for its own demand. Other
   modules require incoming live power routes. Data and airflow never carry electrical power.
4. Contracted capacity is facility-global. Every route enforces its capacity, while all routes that
   share a source output port or sink input port share that port's capacity. Source output capacity
   is the content port capacity multiplied by the source Power Factor. Distance, path tiles,
   crossings, overlap, and the adjacent-port graph have no Task 6 electrical effect.
5. Allocation priority is fixed: directly supplied power sources; cooling; memory and control;
   compute; interconnect and I/O. Each tier performs a stable module-ID minimum pass followed by a
   stable module-ID remaining-demand pass. Routed consumption uses stable route-ID order.
6. A source supplies routes only when it was not shutdown, its startup counter was already zero at
   tick start, and it receives minimum power. A source completing startup becomes online at tick end
   and begins supplying routes on the following tick.
7. Power delivery alone owns startup and brownout transitions. Below minimum positive power enters
   brownout without decrementing startup. Delivery at or above minimum decrements startup exactly
   once, transitions to online at zero, recovers brownout automatically, and preserves cooldown.
   Shutdown is preserved.
8. Limiting reasons use stable precedence: shutdown, missing route, unavailable source, contracted
   capacity, route/source-port/sink-port capacity, then none. Facility totals are stable sums;
   headroom is `max(0, contracted - delivered)`. Route utilization is delivered route flow divided
   by route capacity, or zero for zero capacity, clamped to `[0, 1]`.
9. Current-tick energy cost calls the ADR-0004 helper with total delivered watts, exactly `0.1`
   simulated seconds, and the current energy price. The result is stored but never deducted; Task 6
   does not register the later economy stage or mutate any economy aggregate.
10. Demand, topology, allocation, transitions, facility calculation, and validation are pure APIs.
    The immutable-content production factory registers only `calculate-power-demand-and-delivery`.
    Construction uses locale-independent stable ordering and consumes no RNG. Any failure remains
    inside ADR-0003's candidate and rolls back the complete current tick.

## Consequences

- Canonical state, hashes, saves, and future snapshots now include the additive power result.
- Successful changed Design Apply resets power to dirty but does not calculate it synchronously;
  draft edits, undo, redo, cancel, and unchanged Apply preserve live power.
- Startup and brownout are available to later compute and thermal stages, but Task 6 produces no
  Useful Compute, heat, cooling effect, damage, or economy settlement.
- Derived topology is rebuilt without path-tile scans or adjacent-port-graph construction. Any
  future persistent non-authoritative topology cache or broad tick-pipeline performance change
  requires compatibility analysis and, where it changes ADR-0003 guarantees, explicit approval.

## Functional checkpoint status

- Task 6 functional correctness and determinism verification passed with the exact 100-run tests
  unchanged.
- This is a functional checkpoint, not performance completion. The pure-power p95 target below
  `1 ms` remains open, and the complete production-tick p95 target below `4 ms` remains open.
- The combined `corepack pnpm test` command remains sensitive to host load at the unchanged
  determinism timeouts; the focused, complete unit, and standalone determinism gates are verified
  separately without skipped tests or narrowed discovery.
- The exact next task is `Phase 1 Task 6.1: Performance Hardening`, not Task 7. Task 6.1 does not
  change this ADR's gameplay contract without a separately approved contract decision.

## Rejected alternatives

- Storing maps, sets, classes, cached graphs, or route paths inside authoritative power state would
  violate the serializable-state boundary or duplicate derived geometry.
- Allocating full demand before minimum power would starve later modules in the same priority tier.
- Multiplying capacity per route would incorrectly duplicate shared port capacity allowed by
  ADR-0007's shared-port routing.
- Calculating power during Apply would make command-only processing run tick behavior and alter the
  approved preview/settlement boundary.
- Deducting energy cost in the power stage would bypass the approved later economy stage.
