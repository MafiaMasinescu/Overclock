import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type {
  ContentBundle,
  ModuleDefinition,
  ModulePortDefinition,
} from "../../src/content/schemas/contentSchemas.ts";
import {
  arePortsPhysicallyAdjacent,
  resolveCompatiblePortPair,
  resolveModulePortGeometry,
  type ResolvedPortGeometry,
} from "../../src/grid/domain/portGeometry.ts";
import { buildAdjacentPortGraph } from "../../src/grid/domain/adjacentPortGraph.ts";
import { validateGridState } from "../../src/grid/validation/gridState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import type { GridPoint, ModuleInstanceState, Rotation } from "../../src/sim/core/types.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";

const baseContent = loadContentBundle();

function createModule(
  id: string,
  definitionId: string,
  position: GridPoint,
  rotation: Rotation = 0,
): ModuleInstanceState {
  return {
    id,
    definitionId,
    position: { ...position },
    rotation,
    operationalState: "offline",
    overclock: { profile: "balanced", frequencyRatio: 1, voltageRatio: 1 },
    binComputeRatio: 1,
    binEfficiencyRatio: 1,
    binThermalRatio: 1,
    binStabilityRatio: 1,
    startupTicksRemaining: 0,
    cooldownTicksRemaining: 0,
  };
}

function createPort(
  id: string,
  kind: ModulePortDefinition["kind"],
  side: ModulePortDefinition["side"],
  offset = 0,
): ModulePortDefinition {
  return { id, kind, side, offset, capacityPerSecond: 1234 };
}

function createDefinition(
  id: string,
  ports: readonly ModulePortDefinition[],
  footprint = { width: 1, height: 1 },
): ModuleDefinition {
  const template = baseContent.modules["module-data-relay"];
  if (template === undefined) {
    throw new Error("Expected module-data-relay fixture.");
  }
  const mutableTemplate = structuredClone(template) as ModuleDefinition;
  return {
    ...mutableTemplate,
    id,
    footprint: { ...footprint },
    ports: ports.map((port) => ({ ...port })),
  };
}

function withDefinitions(...definitions: readonly ModuleDefinition[]): ContentBundle {
  return {
    ...baseContent,
    modules: {
      ...baseContent.modules,
      ...Object.fromEntries(definitions.map((definition) => [definition.id, definition])),
    },
  };
}

function resolveSingle(
  id: string,
  kind: ModulePortDefinition["kind"],
  side: ModulePortDefinition["side"],
  position: GridPoint,
): ResolvedPortGeometry {
  const definition = createDefinition(`definition-${id}`, [createPort(id, kind, side)]);
  const module = createModule(`module-${id}`, definition.id, position);
  const result = resolveModulePortGeometry(module, definition);
  const port = result.ports[0];
  if (port === undefined) {
    throw new Error(`Expected resolved port ${id}.`);
  }
  return port;
}

describe("port transformation", () => {
  const definition = createDefinition(
    "definition-port-transform",
    [
      createPort("north-two", "data-in", "north", 2),
      createPort("east-one", "data-out", "east", 1),
      createPort("south-one", "power-in", "south", 1),
      createPort("west-one", "power-out", "west", 1),
    ],
    { width: 3, height: 2 },
  );

  test.each([
    {
      rotation: 0 as const,
      portId: "north-two",
      facingSide: "north",
      tile: { x: 12, y: 20 },
      adjacent: { x: 12, y: 19 },
    },
    {
      rotation: 0 as const,
      portId: "east-one",
      facingSide: "east",
      tile: { x: 12, y: 21 },
      adjacent: { x: 13, y: 21 },
    },
    {
      rotation: 0 as const,
      portId: "south-one",
      facingSide: "south",
      tile: { x: 11, y: 21 },
      adjacent: { x: 11, y: 22 },
    },
    {
      rotation: 0 as const,
      portId: "west-one",
      facingSide: "west",
      tile: { x: 10, y: 21 },
      adjacent: { x: 9, y: 21 },
    },
    {
      rotation: 90 as const,
      portId: "north-two",
      facingSide: "east",
      tile: { x: 11, y: 22 },
      adjacent: { x: 12, y: 22 },
    },
    {
      rotation: 90 as const,
      portId: "east-one",
      facingSide: "south",
      tile: { x: 10, y: 22 },
      adjacent: { x: 10, y: 23 },
    },
    {
      rotation: 90 as const,
      portId: "south-one",
      facingSide: "west",
      tile: { x: 10, y: 21 },
      adjacent: { x: 9, y: 21 },
    },
    {
      rotation: 90 as const,
      portId: "west-one",
      facingSide: "north",
      tile: { x: 10, y: 20 },
      adjacent: { x: 10, y: 19 },
    },
    {
      rotation: 180 as const,
      portId: "north-two",
      facingSide: "south",
      tile: { x: 10, y: 21 },
      adjacent: { x: 10, y: 22 },
    },
    {
      rotation: 180 as const,
      portId: "east-one",
      facingSide: "west",
      tile: { x: 10, y: 20 },
      adjacent: { x: 9, y: 20 },
    },
    {
      rotation: 180 as const,
      portId: "south-one",
      facingSide: "north",
      tile: { x: 11, y: 20 },
      adjacent: { x: 11, y: 19 },
    },
    {
      rotation: 180 as const,
      portId: "west-one",
      facingSide: "east",
      tile: { x: 12, y: 20 },
      adjacent: { x: 13, y: 20 },
    },
    {
      rotation: 270 as const,
      portId: "north-two",
      facingSide: "west",
      tile: { x: 10, y: 20 },
      adjacent: { x: 9, y: 20 },
    },
    {
      rotation: 270 as const,
      portId: "east-one",
      facingSide: "north",
      tile: { x: 11, y: 20 },
      adjacent: { x: 11, y: 19 },
    },
    {
      rotation: 270 as const,
      portId: "south-one",
      facingSide: "east",
      tile: { x: 11, y: 21 },
      adjacent: { x: 12, y: 21 },
    },
    {
      rotation: 270 as const,
      portId: "west-one",
      facingSide: "south",
      tile: { x: 11, y: 22 },
      adjacent: { x: 11, y: 23 },
    },
  ])(
    "resolves $portId at $rotation degrees",
    ({ rotation, portId, facingSide, tile, adjacent }) => {
      const result = resolveModulePortGeometry(
        createModule("module-transform", definition.id, { x: 10, y: 20 }, rotation),
        definition,
      );
      const port = result.ports.find((candidate) => candidate.portId === portId);

      expect(port).toMatchObject({
        moduleInstanceId: "module-transform",
        portId,
        facingSide,
        moduleTile: tile,
        adjacentTile: adjacent,
        capacityPerSecond: 1234,
      });
    },
  );

  test("allows an adjacent external tile outside the facility without invalidating geometry", () => {
    const definition = createDefinition("definition-external-port", [
      createPort("north", "airflow", "north"),
    ]);
    const result = resolveModulePortGeometry(
      createModule("module-edge", definition.id, { x: 0, y: 0 }),
      definition,
    );

    expect(result).toEqual({
      ports: [
        {
          moduleInstanceId: "module-edge",
          portId: "north",
          kind: "airflow",
          facingSide: "north",
          moduleTile: { x: 0, y: 0 },
          adjacentTile: { x: 0, y: -1 },
          capacityPerSecond: 1234,
        },
      ],
      issues: [],
    });
  });
});

describe("port compatibility", () => {
  test("normalizes valid power adjacency from output to input", () => {
    const input = resolveSingle("power-input", "power-in", "west", { x: 1, y: 0 });
    const output = resolveSingle("power-output", "power-out", "east", { x: 0, y: 0 });

    expect(arePortsPhysicallyAdjacent(input, output)).toBe(true);
    expect(resolveCompatiblePortPair(input, output)).toEqual({
      kind: "power",
      from: { moduleInstanceId: "module-power-output", portId: "power-output" },
      to: { moduleInstanceId: "module-power-input", portId: "power-input" },
    });
  });

  test.each([
    ["power-in", "power-in"],
    ["power-out", "power-out"],
  ] as const)("rejects invalid power direction %s to %s", (leftKind, rightKind) => {
    const left = resolveSingle("left", leftKind, "east", { x: 0, y: 0 });
    const right = resolveSingle("right", rightKind, "west", { x: 1, y: 0 });

    expect(resolveCompatiblePortPair(left, right)).toBeNull();
  });

  test.each([
    {
      left: "data-out" as const,
      right: "data-in" as const,
      from: "module-left",
      to: "module-right",
    },
    {
      left: "data-out" as const,
      right: "data-bidirectional" as const,
      from: "module-left",
      to: "module-right",
    },
    {
      left: "data-in" as const,
      right: "data-bidirectional" as const,
      from: "module-right",
      to: "module-left",
    },
    {
      left: "data-bidirectional" as const,
      right: "data-out" as const,
      from: "module-right",
      to: "module-left",
    },
    {
      left: "data-bidirectional" as const,
      right: "data-in" as const,
      from: "module-left",
      to: "module-right",
    },
    {
      left: "data-bidirectional" as const,
      right: "data-bidirectional" as const,
      from: "module-left",
      to: "module-right",
    },
  ])("normalizes $left and $right", ({ left, right, from, to }) => {
    const leftPort = resolveSingle("left", left, "east", { x: 0, y: 0 });
    const rightPort = resolveSingle("right", right, "west", { x: 1, y: 0 });

    expect(resolveCompatiblePortPair(rightPort, leftPort)).toEqual({
      kind: "data",
      from: { moduleInstanceId: from, portId: from === "module-left" ? "left" : "right" },
      to: { moduleInstanceId: to, portId: to === "module-left" ? "left" : "right" },
    });
  });

  test.each([
    ["data-in", "data-in"],
    ["data-out", "data-out"],
  ] as const)("rejects incompatible data directions %s and %s", (leftKind, rightKind) => {
    expect(
      resolveCompatiblePortPair(
        resolveSingle("left", leftKind, "east", { x: 0, y: 0 }),
        resolveSingle("right", rightKind, "west", { x: 1, y: 0 }),
      ),
    ).toBeNull();
  });

  test("rejects power/data combinations", () => {
    expect(
      resolveCompatiblePortPair(
        resolveSingle("power", "power-out", "east", { x: 0, y: 0 }),
        resolveSingle("data", "data-in", "west", { x: 1, y: 0 }),
      ),
    ).toBeNull();
  });

  test("requires opposite-facing ports on adjacent tiles from different modules", () => {
    const left = resolveSingle("left", "data-out", "east", { x: 0, y: 0 });
    const sameFacing = resolveSingle("same-facing", "data-in", "east", { x: 1, y: 0 });
    const nonAdjacent = resolveSingle("non-adjacent", "data-in", "west", { x: 2, y: 0 });
    const sameModule = {
      ...resolveSingle("right", "data-in", "west", { x: 1, y: 0 }),
      moduleInstanceId: left.moduleInstanceId,
    };

    expect(arePortsPhysicallyAdjacent(left, sameFacing)).toBe(false);
    expect(arePortsPhysicallyAdjacent(left, nonAdjacent)).toBe(false);
    expect(arePortsPhysicallyAdjacent(left, sameModule)).toBe(false);
  });
});

describe("derived adjacent-port graph", () => {
  const sourceDefinition = createDefinition("definition-source", [
    createPort("power-out", "power-out", "east"),
    createPort("data-out", "data-out", "east"),
    createPort("airflow-out", "airflow", "east"),
  ]);
  const sinkDefinition = createDefinition("definition-sink", [
    createPort("power-in", "power-in", "west"),
    createPort("data-in", "data-in", "west"),
    createPort("airflow-in", "airflow", "west"),
  ]);
  const content = withDefinitions(sourceDefinition, sinkDefinition);
  const source = createModule("module-source", sourceDefinition.id, { x: 0, y: 0 });
  const sink = createModule("module-sink", sinkDefinition.id, { x: 1, y: 0 });

  test("builds potential direct power and data edges without airflow or RouteState", () => {
    const graph = buildAdjacentPortGraph({
      modules: { [sink.id]: sink, [source.id]: source },
      content,
    });

    expect(graph.nodes.map(({ portId }) => portId)).toEqual([
      "data-in",
      "power-in",
      "data-out",
      "power-out",
    ]);
    expect(graph.edges).toEqual([
      {
        kind: "data",
        from: { moduleInstanceId: "module-source", portId: "data-out" },
        to: { moduleInstanceId: "module-sink", portId: "data-in" },
      },
      {
        kind: "power",
        from: { moduleInstanceId: "module-source", portId: "power-out" },
        to: { moduleInstanceId: "module-sink", portId: "power-in" },
      },
    ]);
    expect(graph).not.toHaveProperty("routes");
    expect(graph.nodes.some(({ kind }) => kind === "airflow")).toBe(false);
  });

  test("is independent of module and content record insertion order", () => {
    const forward = buildAdjacentPortGraph({
      modules: { [source.id]: source, [sink.id]: sink },
      content,
    });
    const reverseContent: ContentBundle = {
      ...content,
      modules: Object.fromEntries(Object.entries(content.modules).reverse()),
    };
    const reverse = buildAdjacentPortGraph({
      modules: { [sink.id]: sink, [source.id]: source },
      content: reverseContent,
    });

    expect(reverse).toEqual(forward);
  });

  test("deduplicates nodes and edges when duplicate instance records are supplied", () => {
    const graph = buildAdjacentPortGraph({
      modules: { source, "source-alias": source, sink },
      content,
    });

    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(2);
  });

  test("returns canonical JSON data and repeats identical graph output exactly 100 times", () => {
    const run = () =>
      buildAdjacentPortGraph({ modules: { [sink.id]: sink, [source.id]: source }, content });
    const expected = canonicalSerialize(run());

    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(canonicalSerialize(run())).toBe(expected);
    }
  });

  test("leaves authoritative state and RNG unchanged", () => {
    const state = createInitialGameState({ content: baseContent, seed: "pure-port-geometry" });
    state.facility.modules = { [source.id]: source, [sink.id]: sink };
    const before = canonicalSerialize(state);
    const rngBefore = state.rngState;

    resolveModulePortGeometry(source, sourceDefinition);
    buildAdjacentPortGraph({ modules: state.facility.modules, content });

    expect(canonicalSerialize(state)).toBe(before);
    expect(state.rngState).toBe(rngBefore);
  });

  test("resolves airflow geometry but creates no route edge for it", () => {
    const sourcePorts = resolveModulePortGeometry(source, sourceDefinition).ports;

    expect(sourcePorts.find(({ portId }) => portId === "airflow-out")).toMatchObject({
      kind: "airflow",
      moduleTile: { x: 0, y: 0 },
      adjacentTile: { x: 1, y: 0 },
    });
    expect(
      buildAdjacentPortGraph({ modules: { [source.id]: source, [sink.id]: sink }, content }).edges,
    ).toHaveLength(2);
  });

  test("grid validation reports malformed transformed port definitions", () => {
    const invalidDefinition = createDefinition("definition-invalid-port", [
      createPort("bad-east", "data-out", "east", 1),
    ]);
    const invalidContent = withDefinitions(invalidDefinition);
    const state = createInitialGameState({ content: baseContent, seed: "invalid-port-invariant" });
    state.facility.modules = {
      "module-invalid": createModule("module-invalid", invalidDefinition.id, { x: 0, y: 0 }),
    };

    expect(validateGridState(state.facility, invalidContent)).toContainEqual({
      code: "INVALID_PAYLOAD",
      reason: "INVALID_PORT_DEFINITION",
      moduleInstanceId: "module-invalid",
      definitionId: "definition-invalid-port",
      portId: "bad-east",
    });
  });
});
