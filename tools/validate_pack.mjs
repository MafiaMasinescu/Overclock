import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueById(items, label) {
  const ids = new Set();
  for (const item of items) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id), `${label}: invalid id ${item.id}`);
    assert(!ids.has(item.id), `${label}: duplicate id ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function assertLocalization(locales, key, owner) {
  for (const [localeName, locale] of Object.entries(locales)) {
    assert(typeof getPath(locale, key) === "string", `${owner}: missing ${localeName} localization ${key}`);
  }
}

function assertAcyclic(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visited.has(id)) return;
    assert(!visiting.has(id), `research: dependency cycle at ${id}`);
    visiting.add(id);
    for (const prerequisite of byId.get(id).prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) visit(node.id);
}

const [modulesFile, tasksFile, researchFile, eraFile, balancingFile, ro, en] = await Promise.all([
  readJson("content/modules.json"),
  readJson("content/tasks.json"),
  readJson("content/research.json"),
  readJson("content/era.json"),
  readJson("content/balancing.json"),
  readJson("content/ro/common.json"),
  readJson("content/en/common.json"),
]);

const versions = [modulesFile, tasksFile, researchFile, eraFile, balancingFile].map(
  (file) => file.contentVersion,
);
assert(versions.every((version) => version === "0.1.0"), "content versions must all be 0.1.0");

assert(modulesFile.modules.length === 12, "vertical slice requires exactly 12 modules");
assert(tasksFile.tasks.length === 8, "vertical slice requires exactly 8 tasks");
assert(researchFile.nodes.length === 10, "vertical slice requires exactly 10 research nodes");
assert(eraFile.era.benchmarkDefinitions.length === 2, "vertical slice requires exactly 2 benchmarks");
assert(balancingFile.tickMilliseconds === 100, "simulation tick must be 100 ms");

const moduleIds = uniqueById(modulesFile.modules, "modules");
const taskIds = uniqueById(tasksFile.tasks, "tasks");
const researchIds = uniqueById(researchFile.nodes, "research");
const benchmarkIds = uniqueById(eraFile.era.benchmarkDefinitions, "benchmarks");
void taskIds;

const locales = { ro, en };
const evidenceRewards = new Set(tasksFile.tasks.flatMap((task) => task.evidenceTagRewards));

for (const module of modulesFile.modules) {
  assertLocalization(locales, module.nameKey, module.id);
  assertLocalization(locales, module.descriptionKey, module.id);
  for (const researchId of module.unlockResearchIds) {
    assert(researchIds.has(researchId), `${module.id}: unknown unlock research ${researchId}`);
  }
  const portIds = new Set();
  for (const port of module.ports) {
    assert(!portIds.has(port.id), `${module.id}: duplicate port ${port.id}`);
    portIds.add(port.id);
  }
  const { normalMaxC, warningMaxC, criticalMaxC, shutdownC } = module.thermal;
  assert(
    normalMaxC < warningMaxC && warningMaxC < criticalMaxC && criticalMaxC < shutdownC,
    `${module.id}: thermal thresholds must increase`,
  );
}

for (const task of tasksFile.tasks) {
  assertLocalization(locales, task.nameKey, task.id);
  assertLocalization(locales, task.descriptionKey, task.id);
  for (const researchId of task.prerequisiteResearchIds) {
    assert(researchIds.has(researchId), `${task.id}: unknown prerequisite ${researchId}`);
  }
  for (const phase of task.phases) {
    assertLocalization(locales, phase.nameKey, `${task.id}/${phase.id}`);
    assert(
      phase.memoryCapacityRecommendedBytes >= phase.memoryCapacityMinBytes,
      `${task.id}/${phase.id}: recommended memory below minimum`,
    );
  }
}

for (const node of researchFile.nodes) {
  assertLocalization(locales, node.nameKey, node.id);
  assertLocalization(locales, node.descriptionKey, node.id);
  for (const prerequisite of node.prerequisites) {
    assert(researchIds.has(prerequisite), `${node.id}: unknown prerequisite ${prerequisite}`);
  }
  for (const moduleId of node.unlockModuleIds) {
    assert(moduleIds.has(moduleId), `${node.id}: unknown module unlock ${moduleId}`);
  }
  for (const benchmarkId of node.requiredBenchmarkIds) {
    assert(benchmarkIds.has(benchmarkId), `${node.id}: unknown benchmark ${benchmarkId}`);
  }
  for (const evidenceTag of node.requiredEvidenceTags) {
    assert(evidenceRewards.has(evidenceTag), `${node.id}: no task rewards ${evidenceTag}`);
  }
}

assertAcyclic(researchFile.nodes);

for (const item of eraFile.era.startingInventory) {
  assert(moduleIds.has(item.definitionId), `era: unknown starting module ${item.definitionId}`);
}

assertLocalization(locales, eraFile.era.nameKey, eraFile.era.id);
for (const benchmark of eraFile.era.benchmarkDefinitions) {
  assertLocalization(locales, benchmark.nameKey, benchmark.id);
}

console.log("Build Pack validation passed: 12 modules, 8 tasks, 10 research nodes, 2 benchmarks, 2 locales.");

