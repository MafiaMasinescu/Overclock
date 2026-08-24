# ADR-0007: Deterministic Manual Routing

Status: Accepted

Date: 24 August 2026

## Context

Phase 1 Task 5.3 adds the first route mutations to the isolated Design Mode draft established by
ADR-0006. Manual routing must be replayable, leave the live layout authoritative, and retain enough
plain data for later congestion and routing work without prematurely implementing pathfinding,
bandwidth reservation, or power delivery.

## Decisions

1. `CONNECT_PORTS` and `DISCONNECT_ROUTE` use the existing content-injected command registry and
   command processor. They require an active draft and mutate only draft routes.
2. Endpoint modules and exact port IDs resolve from the draft and validated content. Airflow is
   excluded; capacities must be finite and positive; ADR-0005 remains the sole authority for
   compatibility and canonical direction. Power normalizes output-to-input, directional data keeps
   direction, and bidirectional data uses stable port-reference order.
3. A path includes both endpoint module tiles. In submitted endpoint order it starts at the from
   module tile, immediately visits its outward adjacent tile, ends through the to adjacent tile, and
   ends at the to module tile. If endpoint canonicalization reverses the connection, the stored path
   is reversed with the stored canonical endpoints.
4. Paths have length two through facility area, remain in bounds, step orthogonally one tile at a
   time, and never repeat a tile. Interior points must be free of every module, including every
   non-port tile of either endpoint module. Candidate occupancy is built once; no path is compressed.
5. Power and data remain separate logical layers, but Task 5.3 permits every route crossing,
   overlap, shared segment, and shared port. Only a duplicate normalized endpoint pair is rejected.
   Hard grid-edge capacity, reservations, crossing penalties, congestion gameplay, auto-routing,
   and rerouting remain deferred.
6. An accepted route stores capacity equal to the minimum endpoint capacity and `congestionRatio: 0`.
   These values do not reserve or aggregate capacity.
7. `FacilityState.nextRouteSequence` is a positive safe integer starting at `1`. Accepted connects
   allocate `route-` plus at least eight zero-padded decimal digits and increment it once. Rejection,
   disconnect, cancel, and future undo never restore it. Collision and overflow reject atomically
   with `INVALID_SYSTEM`. The field, format, and non-reuse rule are save/replay compatibility.
8. `INVALID_ROUTE` supplies stable reasons for invalid manual paths, missing draft routes, and
   duplicate pairs. Validation proceeds from schema and expected tick through draft/endpoints,
   compatibility, capacity, duplicate pair, path shape/bounds/steps/repeats/occupancy, then revision,
   sequence, collision, mutation, and route-state validation.
9. An accepted connect or disconnect increments draft revision once, appends one detached canonical
   JSON operation using revision plus command UUID, and clears redo. Connect stores `{ route }`;
   disconnect stores the complete removed `{ route }`. Neither command has an accepted no-op.
10. The pure route-state validator checks record identity, endpoint resolution and canonical
    direction, path rules, exact capacity, congestion range, unique endpoint pairs, and route
    sequence. `ENTER_DESIGN_MODE` validates live routes before cloning. Move, rotate, and remove
    continue their ADR-0006 stable attached-route cleanup.
11. Routing validation is command-time only. It builds no adjacent-port graph, route preview index,
    A-star search, or empty-tick work. The dedicated 24 x 16 diagnostic reports accepted connect and
    disconnect timings with bounded linear path processing.

## Consequences

- Identical initial state and ordered commands produce identical route IDs, endpoints, paths,
  history, canonical hashes, and RNG state.
- Cancelling or disconnecting creates intentional sequence gaps rather than reusable route IDs.
- Existing routes can cross without mutation, preserving canonical paths for later congestion work.
- Changing route ID format, endpoint normalization, inclusive path representation, validation order,
  or capacity semantics after saves/replays exist requires an explicit compatibility decision and
  migration analysis.

## Rejected alternatives

- RNG, time, hashes, command UUIDs, or queue sequence for route identity couple IDs to unrelated
  execution state.
- Storing only path interior points loses endpoint/facing information needed for deterministic
  validation and future route analysis.
- Blocking crossings, segments, or ports now would introduce unapproved capacity gameplay.
- A-star, auto-connect, automatic rerouting, or pointer-movement validation would create a second
  routing policy before manual routing is settled.
- Rebuilding ADR-0005's adjacent graph in handlers adds unrelated mutation cost and does not validate
  a submitted manual path.
