import type {
  ContentBundle,
  DeepReadonly,
  ResearchNodeDefinition,
  TaskDefinition,
} from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import { detachAndFreezeReplayData } from "../../sim/replay/replayOwnership.ts";

export interface MilestonePolicyResearchGraph {
  readonly nodes: readonly DeepReadonly<ResearchNodeDefinition>[];
  readonly finalNodeId: string;
  readonly distanceToFinal: Readonly<Record<string, number>>;
  readonly firstBlueprintNodeId: string;
  readonly distanceToFirstBlueprint: Readonly<Record<string, number>>;
  readonly evidenceTasks: Readonly<Record<string, readonly string[]>>;
  readonly benchmarkIds: Readonly<Record<string, readonly string[]>>;
}

function orderedNodes(content: ContentBundle): readonly DeepReadonly<ResearchNodeDefinition>[] {
  return Object.values(content.research).toSorted(
    (left, right) => left.sortOrder - right.sortOrder || compareStableStrings(left.id, right.id),
  );
}

function assertAcyclic(nodes: readonly DeepReadonly<ResearchNodeDefinition>[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Research graph contains a cycle at ${id}.`);
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (node === undefined) throw new Error(`Research graph references unknown node ${id}.`);
    visiting.add(id);
    for (const prerequisite of node.prerequisites.toSorted(compareStableStrings))
      visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

function calculateDistances(
  nodes: readonly DeepReadonly<ResearchNodeDefinition>[],
  finalNodeId: string,
): Readonly<Record<string, number>> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const distance: Record<string, number> = Object.fromEntries(
    nodes.map((node) => [node.id, Number.MAX_SAFE_INTEGER]),
  );
  distance[finalNodeId] = 0;
  const queue = [finalNodeId];
  for (const current of queue) {
    const currentDistance = distance[current] ?? Number.MAX_SAFE_INTEGER;
    const currentNode = byId.get(current);
    if (currentNode === undefined)
      throw new Error(`Research graph references unknown node ${current}.`);
    for (const dependant of currentNode.prerequisites.toSorted(compareStableStrings)) {
      const candidate = currentDistance + 1;
      if (candidate < (distance[dependant] ?? Number.MAX_SAFE_INTEGER)) {
        distance[dependant] = candidate;
        queue.push(dependant);
      }
    }
  }
  return Object.freeze(distance);
}

function evidenceMap(content: ContentBundle): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, readonly string[]> = {};
  for (const node of Object.values(content.research)) {
    for (const evidence of node.requiredEvidenceTags) {
      const taskIds = Object.values(content.tasks)
        .filter((task) => task.evidenceTagRewards.includes(evidence))
        .toSorted(
          (left, right) =>
            left.sortOrder - right.sortOrder || compareStableStrings(left.id, right.id),
        )
        .map((task) => task.id);
      result[evidence] = Object.freeze(taskIds);
    }
  }
  return Object.freeze(result);
}

function benchmarkMap(content: ContentBundle): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, readonly string[]> = {};
  for (const node of Object.values(content.research)) {
    for (const benchmarkId of node.requiredBenchmarkIds) {
      const definition = content.era.benchmarkDefinitions.find(
        (candidate) => candidate.id === benchmarkId,
      );
      result[benchmarkId] = Object.freeze(definition === undefined ? [] : [definition.id]);
    }
  }
  return Object.freeze(result);
}

export function createMilestonePolicyResearchGraph(
  content: ContentBundle,
): MilestonePolicyResearchGraph {
  const nodes = orderedNodes(content);
  assertAcyclic(nodes);
  const finalNodes = nodes.filter((node) => node.finalReveal);
  if (finalNodes.length !== 1 || finalNodes[0] === undefined) {
    throw new Error("Milestone policy requires exactly one final Research node.");
  }
  const finalNode = finalNodes[0];
  const distanceToFinal = calculateDistances(nodes, finalNode.id);
  const blueprintNodes = nodes.filter((node) =>
    node.unlockFeatureIds.includes("subassembly-blueprints"),
  );
  if (blueprintNodes.length !== 1 || blueprintNodes[0] === undefined) {
    throw new Error("Milestone policy requires exactly one first-Blueprint Research node.");
  }
  const firstBlueprintNode = blueprintNodes[0];
  const distanceToFirstBlueprint = calculateDistances(nodes, firstBlueprintNode.id);
  for (const node of nodes) {
    if (node.mandatory && distanceToFinal[node.id] === Number.MAX_SAFE_INTEGER) {
      throw new Error(`Mandatory Research node ${node.id} cannot reach the final reveal.`);
    }
  }
  return detachAndFreezeReplayData({
    nodes,
    finalNodeId: finalNode.id,
    distanceToFinal,
    firstBlueprintNodeId: firstBlueprintNode.id,
    distanceToFirstBlueprint,
    evidenceTasks: evidenceMap(content),
    benchmarkIds: benchmarkMap(content),
  });
}

export function reachableMandatoryCount(
  evidenceTags: readonly string[],
  stateStatuses: Readonly<Record<string, string>>,
  graph: MilestonePolicyResearchGraph,
): number {
  const evidence = new Set(evidenceTags);
  return graph.nodes.filter(
    (node) =>
      node.mandatory &&
      stateStatuses[node.id] !== "completed" &&
      node.requiredEvidenceTags.every((tag) => evidence.has(tag)),
  ).length;
}

export function taskProducesRequiredEvidence(
  task: DeepReadonly<TaskDefinition>,
  graph: MilestonePolicyResearchGraph,
  statuses: Readonly<Record<string, string>>,
): boolean {
  const rewards = new Set(task.evidenceTagRewards);
  return graph.nodes.some(
    (node) =>
      node.mandatory &&
      statuses[node.id] !== "completed" &&
      node.requiredEvidenceTags.some((tag) => rewards.has(tag)),
  );
}
