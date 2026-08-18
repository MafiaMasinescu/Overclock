import type { z } from "zod";

import {
  balancingFileSchema,
  eraFileSchema,
  localizationFileSchema,
  modulesFileSchema,
  researchFileSchema,
  tasksFileSchema,
  type ContentBundle,
  type LocalizationDictionary,
} from "../schemas/contentSchemas.ts";
import { deepFreeze } from "./deepFreeze.ts";
import { createRawContentPack, type RawContentPack } from "./rawContentPack.ts";

export interface ContentIssue {
  readonly path: string;
  readonly message: string;
}

export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

function formatPath(root: string, path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    return `${result}.${String(segment)}`;
  }, root);
}

function parseFile<Output>(
  root: string,
  schema: z.ZodType<Output>,
  input: unknown,
  issues: ContentIssue[],
): Output | null {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  for (const issue of result.error.issues) {
    issues.push({ path: formatPath(root, issue.path), message: issue.message });
  }
  return null;
}

function collectUnique<Definition extends { id: string }>(
  definitions: readonly Definition[],
  root: string,
  issues: ContentIssue[],
): Map<string, Definition> {
  const result = new Map<string, Definition>();
  definitions.forEach((definition, index) => {
    if (result.has(definition.id)) {
      issues.push({ path: `${root}[${index}].id`, message: `duplicate id ${definition.id}` });
    } else {
      result.set(definition.id, definition);
    }
  });
  return result;
}

function getLocalization(dictionary: LocalizationDictionary, dottedPath: string): string | null {
  let value: unknown = dictionary;
  for (const segment of dottedPath.split(".")) {
    if (value === null || typeof value !== "object") {
      return null;
    }
    value = Reflect.get(value, segment);
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validateLocalization(
  locales: Readonly<Record<"ro" | "en", LocalizationDictionary>>,
  key: string,
  issues: ContentIssue[],
): void {
  for (const locale of ["ro", "en"] as const) {
    if (getLocalization(locales[locale], key) === null) {
      issues.push({ path: `locales.${locale}.${key}`, message: "missing localization" });
    }
  }
}

function validateResearchCycles(
  research: ReadonlyMap<string, { readonly prerequisites: readonly string[] }>,
  issues: ContentIssue[],
): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): boolean => {
    if (active.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      issues.push({ path: "research.nodes", message: `dependency cycle ${cycle.join(" -> ")}` });
      return false;
    }
    if (visited.has(id)) {
      return true;
    }

    const node = research.get(id);
    if (node === undefined) {
      return true;
    }

    active.add(id);
    path.push(id);
    for (const prerequisite of node.prerequisites) {
      if (!visit(prerequisite)) {
        return false;
      }
    }
    path.pop();
    active.delete(id);
    visited.add(id);
    return true;
  };

  for (const id of research.keys()) {
    if (!visit(id)) {
      break;
    }
  }
}

export function validateContent(raw: RawContentPack): ContentBundle {
  const issues: ContentIssue[] = [];
  const modulesFile = parseFile("modules", modulesFileSchema, raw.modules, issues);
  const tasksFile = parseFile("tasks", tasksFileSchema, raw.tasks, issues);
  const researchFile = parseFile("research", researchFileSchema, raw.research, issues);
  const eraFile = parseFile("era", eraFileSchema, raw.era, issues);
  const balancingFile = parseFile("balancing", balancingFileSchema, raw.balancing, issues);
  const ro = parseFile("locales.ro", localizationFileSchema, raw.locales.ro, issues);
  const en = parseFile("locales.en", localizationFileSchema, raw.locales.en, issues);

  if (
    modulesFile === null ||
    tasksFile === null ||
    researchFile === null ||
    eraFile === null ||
    balancingFile === null ||
    ro === null ||
    en === null
  ) {
    throw new ContentValidationError(issues);
  }

  const versionedFiles = [modulesFile, tasksFile, researchFile, eraFile, balancingFile];
  versionedFiles.forEach((file, index) => {
    if (file.contentVersion !== "0.1.0") {
      const roots = ["modules", "tasks", "research", "era", "balancing"] as const;
      const root = roots[index];
      if (root === undefined) {
        throw new Error("Content version root is missing.");
      }
      issues.push({
        path: `${root}.contentVersion`,
        message: `expected 0.1.0, received ${file.contentVersion}`,
      });
    }
  });

  const modules = collectUnique(modulesFile.modules, "modules.modules", issues);
  collectUnique(tasksFile.tasks, "tasks.tasks", issues);
  const research = collectUnique(researchFile.nodes, "research.nodes", issues);
  const benchmarks = collectUnique(
    eraFile.era.benchmarkDefinitions,
    "era.era.benchmarkDefinitions",
    issues,
  );
  const evidenceTags = new Set(tasksFile.tasks.flatMap((task) => task.evidenceTagRewards));
  const locales = { ro, en } as const;

  modulesFile.modules.forEach((module, moduleIndex) => {
    validateLocalization(locales, module.nameKey, issues);
    validateLocalization(locales, module.descriptionKey, issues);
    const portIds = new Set<string>();
    module.ports.forEach((port, portIndex) => {
      if (portIds.has(port.id)) {
        issues.push({
          path: `modules.modules[${moduleIndex}].ports[${portIndex}].id`,
          message: `duplicate port id ${port.id}`,
        });
      }
      portIds.add(port.id);
    });
    module.unlockResearchIds.forEach((researchId, researchIndex) => {
      if (!research.has(researchId)) {
        issues.push({
          path: `modules.modules[${moduleIndex}].unlockResearchIds[${researchIndex}]`,
          message: `unknown research node ${researchId}`,
        });
      }
    });
    const { normalMaxC, warningMaxC, criticalMaxC, shutdownC } = module.thermal;
    if (!(normalMaxC < warningMaxC && warningMaxC < criticalMaxC && criticalMaxC < shutdownC)) {
      issues.push({
        path: `modules.modules[${moduleIndex}].thermal`,
        message: "thresholds must increase from normal to shutdown",
      });
    }
  });

  tasksFile.tasks.forEach((task, taskIndex) => {
    validateLocalization(locales, task.nameKey, issues);
    validateLocalization(locales, task.descriptionKey, issues);
    task.prerequisiteResearchIds.forEach((researchId, researchIndex) => {
      if (!research.has(researchId)) {
        issues.push({
          path: `tasks.tasks[${taskIndex}].prerequisiteResearchIds[${researchIndex}]`,
          message: `unknown research node ${researchId}`,
        });
      }
    });
    task.phases.forEach((phase, phaseIndex) => {
      validateLocalization(locales, phase.nameKey, issues);
      if (phase.memoryCapacityRecommendedBytes < phase.memoryCapacityMinBytes) {
        issues.push({
          path: `tasks.tasks[${taskIndex}].phases[${phaseIndex}].memoryCapacityRecommendedBytes`,
          message: "recommended memory is below the minimum",
        });
      }
    });
  });

  researchFile.nodes.forEach((node, nodeIndex) => {
    validateLocalization(locales, node.nameKey, issues);
    validateLocalization(locales, node.descriptionKey, issues);
    node.prerequisites.forEach((researchId, prerequisiteIndex) => {
      if (!research.has(researchId)) {
        issues.push({
          path: `research.nodes[${nodeIndex}].prerequisites[${prerequisiteIndex}]`,
          message: `unknown research node ${researchId}`,
        });
      }
    });
    node.unlockModuleIds.forEach((moduleId, moduleIndex) => {
      if (!modules.has(moduleId)) {
        issues.push({
          path: `research.nodes[${nodeIndex}].unlockModuleIds[${moduleIndex}]`,
          message: `unknown module ${moduleId}`,
        });
      }
    });
    node.requiredBenchmarkIds.forEach((benchmarkId, benchmarkIndex) => {
      if (!benchmarks.has(benchmarkId)) {
        issues.push({
          path: `research.nodes[${nodeIndex}].requiredBenchmarkIds[${benchmarkIndex}]`,
          message: `unknown benchmark ${benchmarkId}`,
        });
      }
    });
    node.requiredEvidenceTags.forEach((evidenceTag, evidenceIndex) => {
      if (!evidenceTags.has(evidenceTag)) {
        issues.push({
          path: `research.nodes[${nodeIndex}].requiredEvidenceTags[${evidenceIndex}]`,
          message: `no task rewards evidence tag ${evidenceTag}`,
        });
      }
    });
  });

  eraFile.era.startingInventory.forEach((stack, stackIndex) => {
    if (!modules.has(stack.definitionId)) {
      issues.push({
        path: `era.era.startingInventory[${stackIndex}].definitionId`,
        message: `unknown module ${stack.definitionId}`,
      });
    }
  });
  validateLocalization(locales, eraFile.era.nameKey, issues);
  eraFile.era.benchmarkDefinitions.forEach((benchmark) => {
    validateLocalization(locales, benchmark.nameKey, issues);
  });

  validateResearchCycles(research, issues);

  if (issues.length > 0) {
    throw new ContentValidationError(issues);
  }

  return deepFreeze({
    contentVersion: "0.1.0",
    modules: Object.fromEntries(modulesFile.modules.map((module) => [module.id, module])),
    tasks: Object.fromEntries(tasksFile.tasks.map((task) => [task.id, task])),
    research: Object.fromEntries(researchFile.nodes.map((node) => [node.id, node])),
    era: eraFile.era,
    balancing: balancingFile,
    locales,
  });
}

export function loadContentBundle(raw: RawContentPack = createRawContentPack()): ContentBundle {
  return validateContent(raw);
}
