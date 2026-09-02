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
import { secondsToTaskTicks } from "../../sim/tasks/taskState.ts";

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

function hasSameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
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

  const researchSortOrders = new Map<number, number>();
  researchFile.nodes.forEach((node, nodeIndex) => {
    const previousIndex = researchSortOrders.get(node.sortOrder);
    if (previousIndex !== undefined) {
      issues.push({
        path: `research.nodes[${nodeIndex}].sortOrder`,
        message: `duplicate sortOrder ${node.sortOrder}; already used at index ${previousIndex}`,
      });
    } else {
      researchSortOrders.set(node.sortOrder, nodeIndex);
    }
  });

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

      const dimension = port.side === "north" || port.side === "south" ? "width" : "height";
      if (port.offset >= module.footprint[dimension]) {
        issues.push({
          path: `modules.modules[${moduleIndex}].ports[${portIndex}].offset`,
          message: `${port.side} port offset must be smaller than footprint ${dimension}`,
        });
      }
    });
    module.unlockResearchIds.forEach((researchId, researchIndex) => {
      if (!research.has(researchId)) {
        issues.push({
          path: `modules.modules[${moduleIndex}].unlockResearchIds[${researchIndex}]`,
          message: `unknown research node ${researchId}`,
        });
      }
    });
    if (new Set(module.unlockResearchIds).size !== module.unlockResearchIds.length) {
      issues.push({
        path: `modules.modules[${moduleIndex}].unlockResearchIds`,
        message: "must contain unique Research IDs",
      });
    }
    const { normalMaxC, warningMaxC, criticalMaxC, shutdownC } = module.thermal;
    if (!(normalMaxC < warningMaxC && warningMaxC < criticalMaxC && criticalMaxC < shutdownC)) {
      issues.push({
        path: `modules.modules[${moduleIndex}].thermal`,
        message: "thresholds must increase from normal to shutdown",
      });
    }
    if (module.loadPowerWatts < module.idlePowerWatts) {
      issues.push({
        path: `modules.modules[${moduleIndex}].loadPowerWatts`,
        message: "load power must be greater than or equal to idle power",
      });
    }
    if (module.overclockable && module.baseComputeFlops <= 0) {
      issues.push({
        path: `modules.modules[${moduleIndex}].overclockable`,
        message: "overclockable modules require positive base compute flops",
      });
    }
    const computeRelevant =
      module.baseComputeFlops > 0 ||
      module.memoryCapacityBytes > 0 ||
      module.memoryBandwidthBytesPerSecond > 0 ||
      module.ports.some(
        (port) =>
          port.kind === "data-in" ||
          port.kind === "data-out" ||
          port.kind === "data-bidirectional",
      );
    if (computeRelevant) {
      if (!module.overclockable && module.loadPowerWatts <= module.idlePowerWatts) {
        issues.push({
          path: `modules.modules[${moduleIndex}].loadPowerWatts`,
          message: "compute-relevant non-overclockable modules require load power strictly above idle power",
        });
      }
      if (module.overclockable) {
        const { frequencyRatioMin, voltageRatioMin } = balancingFile.overclock.manual;
        const effectiveLoadPowerWatts = Math.max(
          module.idlePowerWatts,
          module.loadPowerWatts * voltageRatioMin ** 2 * frequencyRatioMin,
        );
        if (effectiveLoadPowerWatts <= module.idlePowerWatts) {
          issues.push({
            path: `modules.modules[${moduleIndex}].loadPowerWatts`,
            message:
              "compute-relevant overclockable modules require minimum-manual effective load power strictly above idle power",
          });
        }
      }
    }
    switch (module.thermalBehavior.role) {
      case "none":
        if (module.coolingWatts !== 0) {
          issues.push({
            path: `modules.modules[${moduleIndex}].thermalBehavior`,
            message: "none thermal behavior requires zero cooling watts",
          });
        }
        break;
      case "local-airflow":
        if (module.coolingWatts <= 0) {
          issues.push({
            path: `modules.modules[${moduleIndex}].thermalBehavior`,
            message: "local-airflow thermal behavior requires positive cooling watts",
          });
        }
        if (!module.ports.some((port) => port.kind === "airflow")) {
          issues.push({
            path: `modules.modules[${moduleIndex}].thermalBehavior`,
            message: "local-airflow thermal behavior requires at least one airflow port",
          });
        }
        break;
      case "extraction":
        if (module.coolingWatts <= 0) {
          issues.push({
            path: `modules.modules[${moduleIndex}].thermalBehavior`,
            message: "extraction thermal behavior requires positive cooling watts",
          });
        }
        break;
    }
  });

  const { eco, balanced, boost, manual } = balancingFile.overclock;
  const ratios = [
    eco.frequencyRatio,
    eco.voltageRatio,
    balanced.frequencyRatio,
    balanced.voltageRatio,
    boost.frequencyRatio,
    boost.voltageRatio,
    manual.frequencyRatioMin,
    manual.frequencyRatioMax,
    manual.voltageRatioMin,
    manual.voltageRatioMax,
  ];
  if (ratios.some((ratio) => !Number.isFinite(ratio) || ratio <= 0)) {
    issues.push({
      path: "balancing.overclock",
      message: "all overclock ratios and bounds must be finite and strictly positive",
    });
  }
  if (
    manual.frequencyRatioMin > manual.frequencyRatioMax ||
    manual.voltageRatioMin > manual.voltageRatioMax
  ) {
    issues.push({
      path: "balancing.overclock.manual",
      message: "manual overclock bounds must be ordered inclusively",
    });
  }
  if (balanced.frequencyRatio !== 1 || balanced.voltageRatio !== 1) {
    issues.push({
      path: "balancing.overclock.balanced",
      message: "balanced overclock ratios must be exactly 1 and 1",
    });
  }
  for (const [profile, settings] of Object.entries({ eco, balanced, boost })) {
    if (
      settings.frequencyRatio < manual.frequencyRatioMin ||
      settings.frequencyRatio > manual.frequencyRatioMax ||
      settings.voltageRatio < manual.voltageRatioMin ||
      settings.voltageRatio > manual.voltageRatioMax
    ) {
      issues.push({
        path: `balancing.overclock.${profile}`,
        message: "preset overclock ratios must be inside the inclusive manual bounds",
      });
    }
  }

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
    if (task.type === "service") {
      if (task.periodicPayoutUsd <= 0 || task.periodicPayoutSeconds === null) {
        issues.push({
          path: `tasks.tasks[${taskIndex}]`,
          message: "service tasks require positive periodic payout and periodic payout seconds",
        });
      }
    } else if (task.periodicPayoutUsd !== 0 || task.periodicPayoutSeconds !== null) {
      issues.push({
        path: `tasks.tasks[${taskIndex}]`,
        message: "non-service tasks require zero periodic payout and null periodic payout seconds",
      });
    }
    for (const [field, seconds] of [
      ["deadlineSeconds", task.deadlineSeconds],
      ["periodicPayoutSeconds", task.periodicPayoutSeconds],
    ] as const) {
      if (seconds === null) continue;
      try {
        secondsToTaskTicks(seconds, `tasks.tasks[${taskIndex}].${field}`);
      } catch {
        issues.push({
          path: `tasks.tasks[${taskIndex}].${field}`,
          message: "must convert exactly to a positive safe integer 100 ms tick count",
        });
      }
    }
    if (new Set(task.evidenceTagRewards).size !== task.evidenceTagRewards.length) {
      issues.push({
        path: `tasks.tasks[${taskIndex}].evidenceTagRewards`,
        message: "must contain unique evidence reward IDs",
      });
    }
    task.phases.forEach((phase, phaseIndex) => {
      validateLocalization(locales, phase.nameKey, issues);
      if (!Number.isFinite(phase.operations) || phase.operations <= 0) {
        issues.push({
          path: `tasks.tasks[${taskIndex}].phases[${phaseIndex}].operations`,
          message: "must be finite and strictly positive",
        });
      }
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
      const module = modules.get(moduleId);
      if (module !== undefined && !module.unlockResearchIds.includes(node.id)) {
        issues.push({
          path: `research.nodes[${nodeIndex}].unlockModuleIds[${moduleIndex}]`,
          message: `module ${moduleId} must reciprocally unlock research node ${node.id}`,
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

  modulesFile.modules.forEach((module, moduleIndex) => {
    const expectedResearchIds = researchFile.nodes
      .filter((node) => node.unlockModuleIds.includes(module.id))
      .map((node) => node.id);
    if (!hasSameStringSet(module.unlockResearchIds, expectedResearchIds)) {
      issues.push({
        path: `modules.modules[${moduleIndex}].unlockResearchIds`,
        message: "must be the exact inverse of Research unlockModuleIds",
      });
    }
  });

  const finalNodes = researchFile.nodes.filter((node) => node.finalReveal);
  if (finalNodes.length !== 1) {
    issues.push({
      path: "research.nodes",
      message: "must contain exactly one final-reveal node",
    });
  } else {
    const finalNode = finalNodes[0];
    if (finalNode === undefined) throw new Error("Final Research node is missing.");
    const reachable = new Set<string>();
    const pending = [finalNode.id];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (nodeId === undefined || reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      const node = research.get(nodeId);
      if (node !== undefined) pending.push(...node.prerequisites);
    }
    if (!finalNode.mandatory) {
      issues.push({
        path: `research.nodes[${researchFile.nodes.indexOf(finalNode)}].mandatory`,
        message: "the final-reveal node must be mandatory",
      });
    }
    researchFile.nodes.forEach((node, nodeIndex) => {
      if (node.mandatory && node.id !== finalNode.id && !reachable.has(node.id)) {
        issues.push({
          path: `research.nodes[${nodeIndex}].mandatory`,
          message: "mandatory non-final nodes must be transitive prerequisites of the final node",
        });
      }
    });
  }

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
