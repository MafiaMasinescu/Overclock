import { z } from "zod";

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const localizationKeySchema = z.string().min(3);
const finiteNonNegativeSchema = z.number().finite().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

export const gridPointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export const modulePortSchema = z.object({
  id: idSchema,
  kind: z.enum(["power-in", "power-out", "data-in", "data-out", "data-bidirectional", "airflow"]),
  side: z.enum(["north", "east", "south", "west"]),
  offset: z.number().int().nonnegative(),
  capacityPerSecond: finiteNonNegativeSchema,
});

export const moduleDefinitionSchema = z.object({
  id: idSchema,
  nameKey: localizationKeySchema,
  descriptionKey: localizationKeySchema,
  category: z.enum(["power", "compute", "control", "memory", "io", "interconnect", "cooling"]),
  sortOrder: z.number().int().nonnegative(),
  unlockResearchIds: z.array(idSchema),
  tags: z.array(idSchema),
  footprint: z.object({
    width: z.number().int().min(1).max(3),
    height: z.number().int().min(1).max(3),
  }),
  ports: z.array(modulePortSchema),
  priceUsd: finiteNonNegativeSchema,
  salvageRatio: z.number().finite().min(0).max(1),
  startupTicks: z.number().int().nonnegative(),
  cooldownTicks: z.number().int().nonnegative(),
  baseComputeFlops: finiteNonNegativeSchema,
  memoryCapacityBytes: finiteNonNegativeSchema,
  memoryBandwidthBytesPerSecond: finiteNonNegativeSchema,
  idlePowerWatts: finiteNonNegativeSchema,
  loadPowerWatts: finiteNonNegativeSchema,
  heatWattsAtLoad: finiteNonNegativeSchema,
  coolingWatts: finiteNonNegativeSchema,
  airflowUnits: finiteNonNegativeSchema,
  stableFrequencyRatio: z.number().finite().min(0.5).max(2),
  thermal: z.object({
    normalMaxC: z.number().finite(),
    warningMaxC: z.number().finite(),
    criticalMaxC: z.number().finite(),
    shutdownC: z.number().finite(),
  }),
  suitability: z.object({
    serial: z.number().finite().min(0).max(2),
    parallel: z.number().finite().min(0).max(2),
    memory: z.number().finite().min(0).max(2),
    bandwidth: z.number().finite().min(0).max(2),
    latency: z.number().finite().min(0).max(2),
  }),
});

export const modulesFileSchema = z.object({
  contentVersion: z.string(),
  modules: z.array(moduleDefinitionSchema).min(1),
});

export const taskTagSchema = z.enum([
  "serial",
  "parallel",
  "vector",
  "memory-heavy",
  "bandwidth",
  "latency",
  "cpu",
  "burst",
  "sustained",
  "time-sensitive",
  "multi-phase",
  "thermal",
  "high-precision",
  "experimental",
  "research-unlock",
  "historical",
]);

export const taskPhaseSchema = z.object({
  id: idSchema,
  nameKey: localizationKeySchema,
  operations: z.number().finite().positive(),
  tags: z.array(taskTagSchema),
  memoryCapacityMinBytes: finiteNonNegativeSchema,
  memoryCapacityRecommendedBytes: finiteNonNegativeSchema,
  memoryBandwidthRequiredBytesPerSecond: finiteNonNegativeSchema,
  latencyToleranceMicroseconds: z.number().finite().positive(),
  stabilityMinimum: z.number().finite().min(0).max(1),
});

export const taskDefinitionSchema = z.object({
  id: idSchema,
  nameKey: localizationKeySchema,
  descriptionKey: localizationKeySchema,
  type: z.enum(["service", "project", "research-experiment"]),
  sortOrder: z.number().int().nonnegative(),
  offerYear: z.number().int().min(1946).max(1948),
  tags: z.array(taskTagSchema),
  phases: z.array(taskPhaseSchema).min(1),
  deadlineSeconds: z.number().finite().positive().nullable(),
  payoutUsd: finiteNonNegativeSchema,
  periodicPayoutUsd: finiteNonNegativeSchema,
  periodicPayoutSeconds: z.number().finite().positive().nullable(),
  abandonPenaltyUsd: finiteNonNegativeSchema,
  reputationReward: finiteNonNegativeSchema,
  researchDataReward: finiteNonNegativeSchema,
  evidenceTagRewards: z.array(idSchema),
  prerequisiteResearchIds: z.array(idSchema),
});

export const tasksFileSchema = z.object({
  contentVersion: z.string(),
  tasks: z.array(taskDefinitionSchema).min(1),
});

export const researchNodeSchema = z.object({
  id: idSchema,
  nameKey: localizationKeySchema,
  descriptionKey: localizationKeySchema,
  domain: z.enum(["compute", "materials", "memory", "thermal", "software"]),
  sortOrder: z.number().int().nonnegative(),
  mandatory: z.boolean(),
  prerequisites: z.array(idSchema),
  requiredEvidenceTags: z.array(idSchema),
  requiredBenchmarkIds: z.array(idSchema),
  cashCostUsd: finiteNonNegativeSchema,
  researchDataCost: finiteNonNegativeSchema,
  requiredOperations: finiteNonNegativeSchema,
  minimumComputeShare: z.number().finite().min(0).max(1),
  unlockModuleIds: z.array(idSchema),
  unlockFeatureIds: z.array(idSchema),
  finalReveal: z.boolean(),
  graphPosition: z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative() }),
});

export const researchFileSchema = z.object({
  contentVersion: z.string(),
  nodes: z.array(researchNodeSchema).min(1),
});

export const benchmarkDefinitionSchema = z.object({
  id: idSchema,
  nameKey: localizationKeySchema,
  type: z.enum(["peak", "sustained"]),
  durationSeconds: z.number().finite().positive(),
  targetAverageUsefulComputeFlops: finiteNonNegativeSchema,
  minimumValidSampleRate: z.number().finite().min(0).max(1),
  maximumRetryRate: z.number().finite().min(0).max(1),
  maximumTemperatureC: z.number().finite(),
  allowShutdowns: z.boolean(),
});

export const eraFileSchema = z.object({
  contentVersion: z.string(),
  era: z.object({
    id: idSchema,
    nameKey: localizationKeySchema,
    startYear: z.literal(1946),
    endYear: z.literal(1948),
    facilityGrid: z.object({ width: positiveIntegerSchema, height: positiveIntegerSchema }),
    ambientTemperatureC: z.number().finite(),
    startingCashUsd: finiteNonNegativeSchema,
    startingResearchData: finiteNonNegativeSchema,
    startingPowerCapacityWatts: finiteNonNegativeSchema,
    activeTaskSlots: z.literal(2),
    startingInventory: z.array(
      z.object({ definitionId: idSchema, quantity: z.number().int().nonnegative() }),
    ),
    benchmarkDefinitions: z.array(benchmarkDefinitionSchema).length(2),
  }),
});

export const balancingFileSchema = z.object({
  contentVersion: z.string(),
  tickMilliseconds: z.literal(100),
  thermal: z.object({
    heatToTemperatureCoefficient: z.number().finite().positive(),
    diffusionCoefficient: z.number().finite().min(0).max(1),
    ambientRecoveryCoefficient: z.number().finite().min(0).max(1),
    globalHeatCoefficient: z.number().finite().nonnegative(),
    minimumTemperatureC: z.number().finite(),
    maximumTemperatureC: z.number().finite(),
    dirtyEpsilonC: z.number().finite().positive(),
  }),
  overclock: z.object({
    eco: z.object({ frequencyRatio: z.number(), voltageRatio: z.number() }),
    balanced: z.object({ frequencyRatio: z.number(), voltageRatio: z.number() }),
    boost: z.object({ frequencyRatio: z.number(), voltageRatio: z.number() }),
    manual: z.object({
      frequencyRatioMin: z.number(),
      frequencyRatioMax: z.number(),
      voltageRatioMin: z.number(),
      voltageRatioMax: z.number(),
    }),
  }),
  economy: z.object({
    laborCostPerMovedModuleUsd: finiteNonNegativeSchema,
    defaultEnergyPriceUsdPerKwh: finiteNonNegativeSchema,
    autosaveIntervalRealSeconds: positiveIntegerSchema,
  }),
});

export type ModuleDefinition = z.infer<typeof moduleDefinitionSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type ResearchNodeDefinition = z.infer<typeof researchNodeSchema>;
export type EraDefinition = z.infer<typeof eraFileSchema>["era"];
export type BalancingDefinition = z.infer<typeof balancingFileSchema>;

export interface ContentBundle {
  contentVersion: string;
  modules: Readonly<Record<string, ModuleDefinition>>;
  tasks: Readonly<Record<string, TaskDefinition>>;
  research: Readonly<Record<string, ResearchNodeDefinition>>;
  era: Readonly<EraDefinition>;
  balancing: Readonly<BalancingDefinition>;
}
