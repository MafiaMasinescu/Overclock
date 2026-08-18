import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { ModuleInstanceState, PortRef, RouteKind } from "../../sim/core/types.ts";
import type { GridValidationIssue } from "./contracts.ts";
import { buildOccupancyIndex } from "./occupancy.ts";
import {
  arePortsPhysicallyAdjacent,
  comparePortReferences,
  resolveCompatiblePortPair,
  resolveModulePortGeometry,
  type ResolvedPortGeometry,
} from "./portGeometry.ts";
import { compareGridValidationIssues, compareStableStrings } from "./stableOrdering.ts";

export interface AdjacentPortGraphEdge {
  readonly kind: RouteKind;
  readonly from: PortRef;
  readonly to: PortRef;
}

export interface AdjacentPortGraph {
  readonly nodes: readonly ResolvedPortGeometry[];
  readonly edges: readonly AdjacentPortGraphEdge[];
  readonly issues: readonly GridValidationIssue[];
}

export interface BuildAdjacentPortGraphOptions {
  readonly modules: Readonly<Record<string, ModuleInstanceState>>;
  readonly content: ContentBundle;
}

function portKey(port: PortRef): string {
  return `${port.moduleInstanceId.length}:${port.moduleInstanceId}${port.portId.length}:${port.portId}`;
}

function edgeKey(edge: AdjacentPortGraphEdge): string {
  return `${edge.kind}:${portKey(edge.from)}>${portKey(edge.to)}`;
}

function compareResolvedPorts(left: ResolvedPortGeometry, right: ResolvedPortGeometry): number {
  return comparePortReferences(left, right);
}

function compareEdges(left: AdjacentPortGraphEdge, right: AdjacentPortGraphEdge): number {
  return (
    compareStableStrings(left.kind, right.kind) ||
    comparePortReferences(left.from, right.from) ||
    comparePortReferences(left.to, right.to)
  );
}

export function buildAdjacentPortGraph({
  modules,
  content,
}: BuildAdjacentPortGraphOptions): AdjacentPortGraph {
  const occupancy = buildOccupancyIndex({ modules, content });
  const issues: GridValidationIssue[] = [...occupancy.issues];
  const nodesByReference = new Map<string, ResolvedPortGeometry>();

  for (const [, module] of Object.entries(modules).toSorted(([left], [right]) =>
    compareStableStrings(left, right),
  )) {
    const definition = content.modules[module.definitionId];
    if (definition === undefined) {
      continue;
    }
    const resolved = resolveModulePortGeometry(module, definition);
    issues.push(...resolved.issues);
    for (const port of resolved.ports) {
      if (port.kind === "airflow") {
        continue;
      }
      const key = portKey(port);
      if (!nodesByReference.has(key)) {
        nodesByReference.set(key, port);
      }
    }
  }

  const nodes = [...nodesByReference.values()].toSorted(compareResolvedPorts);
  const edgesByKey = new Map<string, AdjacentPortGraphEdge>();
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (right === undefined || !arePortsPhysicallyAdjacent(left, right)) {
        continue;
      }
      const compatible = resolveCompatiblePortPair(left, right);
      if (compatible !== null) {
        edgesByKey.set(edgeKey(compatible), compatible);
      }
    }
  }

  return {
    nodes,
    edges: [...edgesByKey.values()].toSorted(compareEdges),
    issues: issues.toSorted(compareGridValidationIssues),
  };
}
