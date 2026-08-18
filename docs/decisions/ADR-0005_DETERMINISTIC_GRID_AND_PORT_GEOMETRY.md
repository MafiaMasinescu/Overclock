# ADR-0005: Deterministic Grid and Port Geometry

Status: Accepted

Date: 18 August 2026

## Context

Phase 1 Task 5.1 establishes geometry that later Design Mode handlers, connectivity systems, and
rendering selectors can consume. The authoritative state already stores facility dimensions,
module positions and rotations, module definitions with rectangular footprints and edge ports, and
manual `RouteState` records. It does not need another stored occupancy or adjacency representation.

Replay compatibility requires coordinate interpretation, rotation transforms, collision ordering,
port direction, and direct-adjacency normalization to be identical across runtimes and independent
of JavaScript object insertion order.

## Decisions

1. Facility coordinates are zero-based integers with the origin at the top-left tile. Positive `x`
   points right and positive `y` points down. A module position identifies the top-left tile of its
   rotated rectangular footprint. A tile is valid exactly when `0 <= x < width` and
   `0 <= y < height`.
2. Rotations are clockwise and limited to `0`, `90`, `180`, and `270`. Rotations `0` and `180`
   preserve rectangular dimensions; `90` and `270` swap them. Local points transform with the
   published Task 5.1 formulas before the module position is added.
3. A rectangular definition occupies every tile in its rotated rectangle. Public occupied-tile
   arrays are always row-major, first by `y` and then by `x`. Placement exactly against the right or
   bottom edge is valid; one outside tile invalidates the whole proposed placement.
4. Occupancy is derived from the supplied module record and validated content. It is never stored in
   `GameState` or saves. The plain-data index sorts module records, tiles, and occupant IDs through
   explicit code-unit comparison and row-major coordinate comparison. Local `Map` and `Set` values
   are implementation details only and never cross the public boundary.
5. Occupancy construction reports unknown definitions and disagreement between a module record key
   and `ModuleInstanceState.id`. Multiple instance IDs on one tile are retained in stable order and
   reported as duplicate occupation. Placement collision issues identify the occupying module.
6. Placement validation is pure and atomic. It returns complete candidate tiles and ordered issues;
   it never mutates or partially places a module. Move validation may exclude exactly one module
   instance ID from derived occupancy. Geometry uses existing stable rejection concepts:
   `INVALID_PAYLOAD`, `OUT_OF_BOUNDS`, and `TILE_OCCUPIED`, plus stable machine-readable reasons and
   no localized human text.
7. Unrotated port offsets are zero-based. North and south offsets increase west-to-east and must be
   smaller than footprint width. West and east offsets increase north-to-south and must be smaller
   than footprint height. Different port kinds may intentionally share an edge tile and offset.
8. Rotation transforms a port's footprint tile and outward-facing side together. Resolved plain data
   contains module instance ID, port ID and kind, transformed facing, occupied module tile, adjacent
   external tile, and capacity per second. An external tile outside the facility remains valid
   geometry but cannot participate in a physical adjacent connection.
9. Power compatibility is exclusively `power-out` to `power-in`, normalized output-to-input. Data
   output and input pairs use their natural direction; a bidirectional port supplies or receives the
   direction required by its directional peer. Two bidirectional data ports normalize through
   stable port-reference order. Airflow ports resolve geometry but do not create power/data graph
   edges or authoritative routes.
10. Physical adjacency requires different module instances, opposite outward faces, and the two
    occupied module tiles to reference each other as their adjacent external tile. Compatibility
    alone does not imply physical adjacency.
11. The adjacent-port graph is derived plain data. Nodes are unique resolved power/data port
    references. Edges are deduplicated normalized compatible physical adjacencies. Nodes and edges
    are sorted using explicit locale-independent code-unit ordering; output does not depend on
    module or content record insertion order. The graph creates no `RouteState`, performs no A*, and
    does not enter authoritative save state.
12. The focused grid validator checks facility dimensions, module record identity, known
    definitions, integer positions, valid rotations, bounds, collisions, and transformed port
    definitions. It is an explicit API for future grid mutations and is not registered on empty
    ticks or tick stages.
13. Vertical-slice content keeps a maximum unrotated footprint of `3 x 2`. Content validation also
    enforces port-ID uniqueness and side-relative offsets before a bundle is returned.

## Consequences

- Future Task 5.2 handlers can validate a complete candidate layout through one deterministic
  geometry foundation without introducing a second source of truth.
- Direct adjacency can be rebuilt after grid mutations and discarded after consumers finish with
  it.
- Existing module definitions remain unchanged and pass the stricter geometry checks.
- Changing the coordinate origin, rotation direction, tile ordering, offset interpretation, port
  normalization, or graph ordering after replay/save publication requires an explicit compatibility
  decision and migration analysis.

## Rejected alternatives

- Storing an occupancy array or graph in `GameState` would duplicate module placement authority and
  permit divergent saves.
- Relying on object, `Map`, or `Set` insertion order would make output sensitive to caller history.
- Rotating only footprint dimensions or only port sides would detach connectors from their edge
  tiles.
- Treating an outside adjacent port tile as an invalid module placement would incorrectly reject
  legal edge placement.
- Creating `RouteState` records for physical adjacency would conflate potential direct connections
  with manual authoritative routing.
