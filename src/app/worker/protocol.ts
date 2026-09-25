import { z } from "zod";

import { parseSimCommand } from "../../sim/commands/commandSchema.ts";
import type { CommandReceipt, CommandResult, SimCommand } from "../../sim/commands/contracts.ts";
import type { GridPublication } from "../../sim/selectors/gridPublication.ts";
import type { UiSnapshot } from "../../sim/selectors/presentationTypes.ts";
import { localReportSchema, playerSettingsSchema, savePreviewSchema } from "../../save/schema.ts";
import { PERSISTENCE_ERROR_CODES } from "../../save/persistenceErrors.ts";
import { MAX_INPUT_FILE_BYTES } from "../../save/persistenceLimits.ts";

export const WORKER_PROTOCOL_VERSION = 1 as const;
export const MAX_OUTSTANDING_REQUESTS = 256;
export const MAX_AGGREGATE_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_ORDINARY_REQUEST_BYTES = 256 * 1024;
export const MAX_RESULT_QUEUE_ENTRIES = 512;

const MAX_WIRE_NODES = 100_000;
const MAX_WIRE_DEPTH = 64;
const MAX_WIRE_STRING_UNITS = 16_384;
const epochSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/);
const nonnegativeSafeInteger = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0));
const positiveSafeInteger = nonnegativeSafeInteger.refine((value) => value > 0);
const finiteNumber = z.number();
const nonemptyText = z.string().min(1).max(MAX_WIRE_STRING_UNITS);
const safeIdentifier = z.string().min(1).max(256);
const emptyBody = z.strictObject({});
const boundedStringArray = z.array(nonemptyText).max(512);
const gridPoint = z.strictObject({ x: z.number().int(), y: z.number().int() });
// Reuse the Phase 1 exact parser. The input has already passed descriptor
// admission and been detached, so this cannot invoke caller accessors.
const commandSchema = z.unknown().transform((value) => parseSimCommand(value));
const slotId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

const requestBodySchemas = {
  INITIALIZE_NEW: z.strictObject({
    seed: z.string().min(1).max(256),
    contentVersion: nonemptyText,
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  }),
  LOAD_SLOT: z.strictObject({ slotId }),
  COMMAND: z.strictObject({ command: commandSchema }),
  REQUEST_FULL_SNAPSHOT: emptyBody,
  ACK_PUBLICATION: z.strictObject({ publicationSequence: nonnegativeSafeInteger }),
  ACK_RESULT: z.strictObject({ outboundSequence: nonnegativeSafeInteger }),
  SET_PRESENTATION_CONTEXT: z.strictObject({
    selectedIds: boundedStringArray.refine((values) => new Set(values).size === values.length),
    inspectedEntityId: safeIdentifier.max(256).nullable(),
    heatmapEnabled: z.boolean(),
  }),
  SET_HOST_VISIBILITY: z.strictObject({ visible: z.boolean() }),
  CONTINUE_HOST: emptyBody,
  REQUEST_SAVE: z.strictObject({ reason: z.enum(["manual", "autosave", "checkpoint", "exit"]) }),
  LIST_SLOTS: emptyBody,
  PREVIEW_IMPORT: z.strictObject({
    fileBytes: z.instanceof(ArrayBuffer),
    destination: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("new") }),
        z.strictObject({ kind: z.literal("overwrite"), slotId }),
      ])
      .optional(),
  }),
  CONFIRM_IMPORT: z.strictObject({
    token: nonemptyText,
    destination: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("new") }),
      z.strictObject({ kind: z.literal("overwrite"), slotId }),
    ]),
    expectedRevision: nonnegativeSafeInteger.nullable(),
    applySettings: z.boolean(),
  }),
  EXPORT_SLOT: z.strictObject({ slotId, expectedRevision: nonnegativeSafeInteger }),
  DELETE_SLOT: z.strictObject({ slotId, expectedRevision: nonnegativeSafeInteger }),
  UPDATE_SETTINGS: z.strictObject({ settings: playerSettingsSchema }),
  REQUEST_REPORT: z.strictObject({ reportId: nonemptyText }),
  CREATE_REPORT: emptyBody,
  LIST_REPORTS: emptyBody,
  DELETE_REPORT: z.strictObject({ reportId: nonemptyText }),
  RECOVER: z.strictObject({ slotId }),
  SHUTDOWN: emptyBody,
} as const;

type RequestKind = keyof typeof requestBodySchemas;
export const WORKER_REQUEST_KINDS = Object.freeze(Object.keys(requestBodySchemas) as RequestKind[]);
interface RequestFor<K extends RequestKind> {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly epoch: string;
  readonly requestSequence: number;
  readonly kind: K;
  readonly body: z.infer<(typeof requestBodySchemas)[K]>;
}
export type WorkerRequest = { [K in RequestKind]: RequestFor<K> }[RequestKind];

const requestSchemas = Object.entries(requestBodySchemas).map(([kind, body]) =>
  z.strictObject({
    protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
    epoch: epochSchema,
    requestSequence: nonnegativeSafeInteger,
    kind: z.literal(kind),
    body,
  }),
);

export const workerRequestSchema = z.discriminatedUnion(
  "kind",
  requestSchemas as [(typeof requestSchemas)[number], ...typeof requestSchemas],
);
export type WorkerRequestKind = RequestKind;
const workerEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  epoch: epochSchema,
  requestSequence: nonnegativeSafeInteger,
  kind: nonemptyText,
  body: z.unknown(),
});
export type WorkerRequestEnvelope = z.infer<typeof workerEnvelopeSchema>;

const numericRecord = z.record(
  z.string().max(256),
  z.union([z.string().max(1024), finiteNumber, z.boolean()]),
);
const rejectionCodes = [
  "INVALID_PAYLOAD",
  "STALE_TICK",
  "NOT_IN_DESIGN_MODE",
  "ALREADY_IN_DESIGN_MODE",
  "STALE_DRAFT_REVISION",
  "STALE_DESIGN_PREVIEW",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_INVENTORY",
  "INSUFFICIENT_RESEARCH_DATA",
  "RESEARCH_REQUIRED",
  "OUT_OF_BOUNDS",
  "TILE_OCCUPIED",
  "INVALID_PORT",
  "INCOMPATIBLE_PORTS",
  "INVALID_ROUTE",
  "NO_ROUTE_FOUND",
  "INVALID_SYSTEM",
  "TASK_SLOT_LIMIT",
  "TASK_REQUIREMENT_MISSING",
  "TASK_NOT_ACTIVE",
  "RESEARCH_NOT_AVAILABLE",
  "RESEARCH_ALREADY_ACTIVE",
  "OVERCLOCK_OUT_OF_RANGE",
  "OVERCLOCK_TARGET_INVALID",
  "OVERCLOCK_UNSUPPORTED",
  "OVERCLOCK_UNAVAILABLE_IN_DESIGN_MODE",
  "BLUEPRINT_INVALID",
  "BENCHMARK_ALREADY_ACTIVE",
  "BENCHMARK_REQUIREMENT_MISSING",
  "BENCHMARK_NOT_ACTIVE",
  "BENCHMARK_CONFIGURATION_LOCKED",
  "COMMAND_NOT_AVAILABLE",
] as const;
const commandResultSchema = z.union([
  z.strictObject({
    commandId: z.uuid(),
    accepted: z.literal(true),
    appliedAtTick: nonnegativeSafeInteger,
  }),
  z.strictObject({
    commandId: z.uuid(),
    accepted: z.literal(false),
    rejectedAtTick: nonnegativeSafeInteger,
    code: z.enum(rejectionCodes),
    messageKey: nonemptyText,
    parameters: numericRecord.optional(),
  }),
]);

const nullableNonnegative = nonnegativeSafeInteger.nullable();
const taskCardSchema = z.strictObject({
  taskInstanceId: safeIdentifier,
  definitionId: safeIdentifier,
  nameKey: nonemptyText,
  status: z.enum(["offered", "accepted", "active", "hold", "completed", "failed", "abandoned"]),
  tags: z.array(nonemptyText),
  progressRatio: finiteNumber,
  phaseIndex: nonnegativeSafeInteger,
  phaseCount: positiveSafeInteger,
  deadlineTick: nullableNonnegative,
  projectedCompletionTick: nullableNonnegative,
  deadlineRisk: z.enum(["none", "low", "high"]).nullable(),
  allocatedUsefulComputeFlops: finiteNumber,
});
const alertSchema = z.strictObject({
  id: safeIdentifier,
  severity: z.enum(["info", "success", "warning", "critical"]),
  messageKey: nonemptyText,
  parameters: numericRecord.optional(),
  entityId: safeIdentifier.optional(),
});
const breakdownEntrySchema = z.strictObject({
  factor: z.enum([
    "research",
    "power",
    "thermal",
    "memory",
    "interconnect",
    "suitability",
    "stability",
  ]),
  factorValue: finiteNumber,
  lostComputeFlops: finiteNumber,
  explanationKey: nonemptyText,
});
const computeBreakdownSchema = z.strictObject({
  theoreticalComputeFlops: finiteNumber,
  researchFactor: finiteNumber,
  powerFactor: finiteNumber,
  thermalFactor: finiteNumber,
  memoryFactor: finiteNumber,
  interconnectFactor: finiteNumber,
  suitabilityFactor: finiteNumber,
  stabilityFactor: finiteNumber,
  usefulComputeFlops: finiteNumber,
  bottlenecks: z.array(breakdownEntrySchema),
});
const snapshotSchema = z.strictObject({
  revision: nonnegativeSafeInteger,
  tick: nonnegativeSafeInteger,
  header: z.strictObject({
    eraNameKey: nonemptyText,
    year: z.number().int(),
    objectiveKey: nonemptyText,
    paused: z.boolean(),
    speed: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    cashUsd: finiteNumber,
    usefulComputeFlops: finiteNumber,
    theoreticalComputeFlops: finiteNumber,
    powerDrawWatts: finiteNumber,
    powerCapacityWatts: finiteNumber,
    averageTemperatureC: finiteNumber,
    maxTemperatureC: finiteNumber,
  }),
  tasks: z.array(taskCardSchema),
  alerts: z.array(alertSchema),
  telemetry: z.strictObject({
    memoryCapacityBytes: finiteNumber.nullable(),
    memoryUsedBytes: finiteNumber.nullable(),
    memoryBandwidthBytesPerSecond: finiteNumber.nullable(),
    memoryBandwidthUsedBytesPerSecond: finiteNumber.nullable(),
    researchData: finiteNumber,
    reputation: finiteNumber,
    retryRate: finiteNumber.nullable(),
    powerHeadroomWatts: finiteNumber,
    bottleneck: breakdownEntrySchema.nullable(),
    seriesRevision: nonnegativeSafeInteger,
  }),
  inspector: z.strictObject({
    selectedEntityId: safeIdentifier.nullable(),
    entityKind: z.enum(["module", "route", "tile", "task"]).nullable(),
    titleKey: nonemptyText.nullable(),
    stats: z.array(
      z.strictObject({
        labelKey: nonemptyText,
        value: z.union([finiteNumber, z.string()]),
        unitKey: nonemptyText.optional(),
        state: z.enum(["normal", "warning", "critical"]).optional(),
      }),
    ),
    computeBreakdown: computeBreakdownSchema.nullable(),
  }),
  research: z.strictObject({
    researchData: finiteNumber,
    activeNodeId: safeIdentifier.nullable(),
    activeProgressRatio: finiteNumber,
    availableNodeIds: z.array(safeIdentifier),
    completedNodeIds: z.array(safeIdentifier),
  }),
  build: z.strictObject({
    designMode: z.boolean(),
    draftRevision: nullableNonnegative,
    inventoryUnitCount: nonnegativeSafeInteger,
    availableDefinitionIds: z.array(safeIdentifier),
  }),
  tutorial: z.strictObject({
    currentStepId: safeIdentifier.nullable(),
    guidanceMode: z.enum(["simple", "engineering", "skip"]),
  }),
  commandAvailability: z.record(z.string().max(256), z.boolean()),
});

const overclockSchema = z.strictObject({
  profile: z.enum(["eco", "balanced", "boost", "manual"]),
  frequencyRatio: finiteNumber,
  voltageRatio: finiteNumber,
});
const moduleViewSchema = z.strictObject({
  id: safeIdentifier,
  definitionId: safeIdentifier,
  spriteKey: nonemptyText,
  position: gridPoint,
  footprint: z.strictObject({ width: positiveSafeInteger, height: positiveSafeInteger }),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  operationalState: z.enum(["offline", "starting", "online", "brownout", "shutdown"]),
  selected: z.boolean(),
  warning: z.enum(["none", "power", "thermal", "route"]),
  temperatureC: finiteNumber.nullable(),
  overclock: overclockSchema,
});
const routeViewSchema = z.strictObject({
  id: safeIdentifier,
  kind: z.enum(["power", "data"]),
  path: z.array(gridPoint),
  utilizationRatio: finiteNumber.nullable(),
  selected: z.boolean(),
});
const gridPublicationSchema = z.strictObject({
  epoch: epochSchema,
  publicationSequence: nonnegativeSafeInteger,
  baseGridRevision: nonnegativeSafeInteger,
  nextGridRevision: nonnegativeSafeInteger,
  viewMode: z.enum(["live", "draft"]),
  source: z.strictObject({
    liveLayoutRevision: nonnegativeSafeInteger,
    draftRevision: nullableNonnegative,
    thermalRevision: nonnegativeSafeInteger,
    viewMode: z.enum(["live", "draft"]),
    width: positiveSafeInteger,
    height: positiveSafeInteger,
  }),
  entities: z.strictObject({
    upsertModules: z.array(moduleViewSchema),
    removeModuleIds: z.array(safeIdentifier),
    upsertRoutes: z.array(routeViewSchema),
    removeRouteIds: z.array(safeIdentifier),
  }),
  heatmap: z.strictObject({
    full: z.boolean(),
    values: z.array(
      z.strictObject({
        x: nonnegativeSafeInteger,
        y: nonnegativeSafeInteger,
        temperatureC: finiteNumber,
      }),
    ),
  }),
});

const presentationEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("COMMAND_REJECTED"),
    commandId: z.uuid(),
    code: z.enum(rejectionCodes),
    messageKey: nonemptyText,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("DESIGN_APPLIED"),
    revision: nonnegativeSafeInteger,
    costUsd: finiteNumber,
    downtimeTicks: nonnegativeSafeInteger,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("MODULE_PURCHASED"),
    definitionId: safeIdentifier,
    quantity: positiveSafeInteger,
    costUsd: finiteNumber,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("MODULE_SHUTDOWN"),
    moduleInstanceId: safeIdentifier,
    temperatureC: finiteNumber,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.enum(["TASK_ACCEPTED", "TASK_COMPLETED", "TASK_FAILED"]),
    taskInstanceId: safeIdentifier,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.enum(["RESEARCH_STARTED", "RESEARCH_COMPLETED"]),
    nodeId: safeIdentifier,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.enum(["BLUEPRINT_SAVED", "BLUEPRINT_INSTANTIATED"]),
    blueprintId: safeIdentifier,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("BENCHMARK_STARTED"),
    runId: safeIdentifier,
    benchmarkId: safeIdentifier,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.enum(["BENCHMARK_COMPLETED", "BENCHMARK_FAILED"]),
    runId: safeIdentifier,
    benchmarkId: safeIdentifier,
    score: finiteNumber,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("MUSEUM_SNAPSHOT_CREATED"),
    snapshotId: safeIdentifier,
  }),
  z.strictObject({
    eventId: safeIdentifier,
    tick: nonnegativeSafeInteger,
    severity: z.enum(["info", "success", "warning", "critical"]),
    kind: z.literal("TRANSISTOR_REVEALED"),
  }),
]);

const slotSummarySchema = z.strictObject({
  slotId,
  revision: nonnegativeSafeInteger,
  tick: nonnegativeSafeInteger,
  savedAtIso: nonemptyText,
  sizeBytes: nonnegativeSafeInteger,
  verification: z.enum(["verified", "unchecked"]),
});
const requestResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("initialized"), tick: nonnegativeSafeInteger }),
  z.strictObject({ kind: z.literal("snapshot"), tick: nonnegativeSafeInteger }),
  z.strictObject({ kind: z.literal("continued"), tick: nonnegativeSafeInteger }),
  z.strictObject({ kind: z.literal("settings-updated"), tick: nonnegativeSafeInteger }),
  z.strictObject({
    kind: z.literal("visibility"),
    visible: z.boolean(),
    tick: nonnegativeSafeInteger,
  }),
  z.strictObject({ kind: z.literal("slots"), slots: z.array(slotSummarySchema).max(20) }),
  z.strictObject({
    kind: z.literal("save"),
    metadata: z.strictObject({
      slotId,
      savedAtIso: nonemptyText,
      tick: nonnegativeSafeInteger,
      sizeBytes: nonnegativeSafeInteger,
    }),
  }),
  z.strictObject({
    kind: z.literal("import-preview"),
    token: nonemptyText.nullable(),
    preview: savePreviewSchema,
    allocatedSlotId: slotId.nullable(),
  }),
  z.strictObject({
    kind: z.literal("import-confirmed"),
    slot: slotSummarySchema,
    appliedSettings: z.boolean(),
    settings: playerSettingsSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal("export"), fileBytes: z.instanceof(ArrayBuffer) }),
  z.strictObject({ kind: z.literal("deleted"), slotId }),
  z.strictObject({
    kind: z.literal("settings"),
    revision: nonnegativeSafeInteger,
    settings: playerSettingsSchema,
  }),
  z.strictObject({ kind: z.literal("report"), report: localReportSchema }),
  z.strictObject({ kind: z.literal("reports"), reportIds: z.array(nonemptyText).max(20) }),
  z.strictObject({ kind: z.literal("report-deleted"), reportId: nonemptyText }),
  z.strictObject({ kind: z.literal("recovered"), nextEpoch: epochSchema }),
  z.strictObject({ kind: z.literal("shutdown") }),
]);

const requestErrorCodes = [
  "INVALID_REQUEST",
  "BUSY",
  "LIMIT_EXCEEDED",
  "UNAVAILABLE",
  "OUTCOME_UNKNOWN",
  "SESSION_REPLACED",
  "INCOMPATIBLE_CONTENT",
  "SEQUENCE_EXHAUSTED",
  "FATAL",
  ...PERSISTENCE_ERROR_CODES,
] as const;
const lifecycleSchema = z.enum([
  "NEW",
  "INITIALIZING",
  "READY_HELD",
  "RUNNING",
  "MAINTENANCE",
  "FATAL",
  "RECOVERING",
  "STOPPED",
]);

const replyBodySchemas = {
  READY: z.strictObject({
    contentVersion: nonemptyText,
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    snapshot: snapshotSchema,
    publication: gridPublicationSchema,
    lifecycle: lifecycleSchema,
    recovery: z
      .strictObject({
        slotId,
        savedAtIso: nonemptyText,
        tick: nonnegativeSafeInteger,
        year: nonnegativeSafeInteger,
        captureSequence: nonnegativeSafeInteger,
        sourceKind: z.enum(["manual", "autosave"]),
        skippedCorruptRecords: nonnegativeSafeInteger,
      })
      .nullable()
      .optional(),
  }),
  COMMAND_RECEIPT: z.strictObject({
    commandId: z.uuid(),
    receipt: z.strictObject({
      commandId: z.uuid(),
      queued: z.boolean(),
      queueSequence: nullableNonnegative,
    }),
  }),
  COMMAND_RESULT: z.strictObject({ commandId: z.uuid(), result: commandResultSchema }),
  SNAPSHOT_PUBLICATION: z.strictObject({
    snapshot: snapshotSchema,
    publication: gridPublicationSchema.nullable(),
  }),
  EVENT_BATCH: z.strictObject({
    firstEventSequence: nonnegativeSafeInteger,
    events: z
      .array(
        z.strictObject({ eventSequence: nonnegativeSafeInteger, event: presentationEventSchema }),
      )
      .max(128),
  }),
  EVENTS_GAP: z.strictObject({ nextEventSequence: nonnegativeSafeInteger }),
  TRANSPORT_DEGRADED: z.strictObject({ publicationSequence: nonnegativeSafeInteger }),
  REQUEST_RESULT: z.strictObject({ result: requestResultSchema }),
  SAVE_COMMITTED: z.strictObject({
    metadata: z.strictObject({
      slotId,
      savedAtIso: nonemptyText,
      tick: nonnegativeSafeInteger,
      sizeBytes: nonnegativeSafeInteger,
    }),
  }),
  REQUEST_ERROR: z.strictObject({
    code: z.enum(requestErrorCodes),
    operation: z.string().max(32).nullable(),
  }),
  HEARTBEAT: z.strictObject({
    tick: nonnegativeSafeInteger,
    lifecycle: lifecycleSchema,
    visible: z.boolean(),
  }),
  SUSPENDED: z.strictObject({
    reason: z.enum(["long-gap", "hidden", "debt", "maintenance"]),
    requiresContinue: z.boolean(),
  }),
  FATAL_ERROR: z.strictObject({
    code: z.enum([
      "SIMULATOR_INVARIANT_VIOLATION",
      "WORKER_ERROR",
      "MESSAGE_ERROR",
      "TRANSPORT_OVERFLOW",
    ]),
    tick: nonnegativeSafeInteger,
    stage: z.string().max(64).nullable(),
    reportId: nonemptyText,
  }),
  RECOVERY_AVAILABLE: z.strictObject({
    reportId: nonemptyText,
    reason: z.enum(["fatal", "worker-lost", "timeout"]),
  }),
  SESSION_REPLACED: z.strictObject({ nextEpoch: epochSchema }),
  SHUTDOWN_COMPLETE: emptyBody,
} as const;

const replySchemas = Object.entries(replyBodySchemas).map(([kind, body]) =>
  z.strictObject({
    protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
    epoch: epochSchema,
    outboundSequence: nonnegativeSafeInteger,
    requestSequence: nonnegativeSafeInteger.nullable(),
    kind: z.literal(kind),
    body,
  }),
);

export const workerReplySchema = z.discriminatedUnion(
  "kind",
  replySchemas as [(typeof replySchemas)[number], ...typeof replySchemas],
);
type ReplyKind = keyof typeof replyBodySchemas;
export const WORKER_REPLY_KINDS = Object.freeze(Object.keys(replyBodySchemas) as ReplyKind[]);
interface ReplyFor<K extends ReplyKind> {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly epoch: string;
  readonly outboundSequence: number;
  readonly requestSequence: number | null;
  readonly kind: K;
  readonly body: ReplyBody<K>;
}
type ReplyBody<K extends ReplyKind> = K extends "READY"
  ? {
      readonly contentVersion: string;
      readonly fingerprint: string;
      readonly snapshot: UiSnapshot;
      readonly publication: GridPublication;
      readonly lifecycle: z.infer<typeof lifecycleSchema>;
      readonly recovery?: {
        readonly slotId: string;
        readonly savedAtIso: string;
        readonly tick: number;
        readonly year: number;
        readonly captureSequence: number;
        readonly sourceKind: "manual" | "autosave";
        readonly skippedCorruptRecords: number;
      } | null;
    }
  : K extends "SNAPSHOT_PUBLICATION"
    ? { readonly snapshot: UiSnapshot; readonly publication: GridPublication | null }
    : K extends "COMMAND_RESULT"
      ? { readonly commandId: string; readonly result: CommandResult }
      : K extends "COMMAND_RECEIPT"
        ? { readonly commandId: string; readonly receipt: CommandReceipt }
        : z.infer<(typeof replyBodySchemas)[K]>;
export type WorkerReply = { [K in ReplyKind]: ReplyFor<K> }[ReplyKind];
export type WorkerReplyKind = ReplyKind;

export class WireProtocolError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "WireProtocolError";
  }
}

export function parseWorkerEnvelope(input: unknown): WorkerRequestEnvelope {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new WireProtocolError("Worker envelope must be a plain exact record.");
  }
  const prototype = Reflect.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WireProtocolError("Worker envelope must use a plain prototype.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const expected = ["body", "epoch", "kind", "protocolVersion", "requestSequence"];
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string") ||
    expected.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    throw new WireProtocolError("Worker envelope must contain exactly its five contract fields.");
  }
  const envelope: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      throw new WireProtocolError("Worker envelope fields must be enumerable data properties.");
    }
    Object.defineProperty(envelope, key, { value: descriptor.value, enumerable: true });
  }
  try {
    return workerEnvelopeSchema.parse(envelope);
  } catch (error) {
    throw new WireProtocolError(
      error instanceof Error ? error.message : "Malformed Worker envelope.",
    );
  }
}

interface CloneLimits {
  readonly allowArrayBuffer: boolean;
  readonly maxBytes: number;
}

function copyExternalWireValue(input: unknown, limits: CloneLimits): unknown {
  const active = new Set<object>();
  let nodes = 0;

  function copy(value: unknown, depth: number): unknown {
    nodes += 1;
    if (nodes > MAX_WIRE_NODES || depth > MAX_WIRE_DEPTH) {
      throw new WireProtocolError("Wire value exceeds the protocol traversal limits.");
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (
        value.length > MAX_WIRE_STRING_UNITS ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
      ) {
        throw new WireProtocolError("Wire strings must be bounded well-formed Unicode.");
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new WireProtocolError("Wire numbers must be finite.");
      return value;
    }
    if (typeof value !== "object")
      throw new WireProtocolError("Wire data must contain JSON values.");
    if (active.has(value)) throw new WireProtocolError("Wire data must not contain cycles.");

    if (value instanceof ArrayBuffer) {
      if (
        !limits.allowArrayBuffer ||
        Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
        Reflect.ownKeys(value).length !== 0
      ) {
        throw new WireProtocolError(
          "Binary data is allowed only for typed import/export requests.",
        );
      }
      if (value.byteLength > limits.maxBytes)
        throw new WireProtocolError("Wire binary payload exceeds its limit.");
      return new Uint8Array(value).slice().buffer;
    }

    active.add(value);
    const prototype = Reflect.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    let owned: unknown;
    if (Array.isArray(value)) {
      const length = descriptors["length"];
      if (
        prototype !== Array.prototype ||
        length === undefined ||
        !Object.hasOwn(length, "value") ||
        length.enumerable ||
        keys.length !== value.length + 1
      ) {
        throw new WireProtocolError(
          "Wire arrays must be dense ordinary arrays without extra properties.",
        );
      }
      const entries: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          !descriptor.enumerable
        ) {
          throw new WireProtocolError("Wire arrays must contain enumerable data entries.");
        }
        entries.push(copy(descriptor.value, depth + 1));
      }
      owned = entries;
    } else {
      if (prototype !== Object.prototype && prototype !== null)
        throw new WireProtocolError("Wire records must use plain prototypes.");
      const record: Record<string, unknown> = {};
      for (const key of keys) {
        if (typeof key !== "string")
          throw new WireProtocolError("Wire records must not contain symbol keys.");
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          !descriptor.enumerable
        ) {
          throw new WireProtocolError("Wire records must contain enumerable data properties only.");
        }
        Object.defineProperty(record, key, {
          value: copy(descriptor.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      owned = record;
    }
    active.delete(value);
    return owned;
  }

  return copy(input, 0);
}

function freezeOwnedWireValue(value: unknown): unknown {
  if (value === null || typeof value !== "object" || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) {
    for (const entry of value) freezeOwnedWireValue(entry);
  } else {
    for (const entry of Object.values(value)) freezeOwnedWireValue(entry);
  }
  return Object.freeze(value);
}

function encodedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function parseWorkerRequest(input: unknown): WorkerRequest {
  let owned: unknown;
  try {
    const envelope = parseWorkerEnvelope(input);
    owned = copyExternalWireValue(envelope, {
      allowArrayBuffer: true,
      maxBytes: MAX_INPUT_FILE_BYTES,
    });
    const request = workerRequestSchema.parse(owned) as WorkerRequest;
    const importBytes = request.kind === "PREVIEW_IMPORT" ? request.body.fileBytes.byteLength : 0;
    const ordinaryBytes = encodedByteLength(request) + importBytes;
    if (request.kind === "PREVIEW_IMPORT") {
      if (importBytes === 0 || importBytes > MAX_INPUT_FILE_BYTES)
        throw new WireProtocolError("Import bytes exceed the save-file limit.");
    } else if (ordinaryBytes > MAX_ORDINARY_REQUEST_BYTES) {
      throw new WireProtocolError("Ordinary request exceeds the 256 KiB wire limit.");
    }
    return freezeOwnedWireValue(request) as WorkerRequest;
  } catch (error) {
    if (error instanceof WireProtocolError) throw error;
    throw new WireProtocolError(
      error instanceof Error ? error.message : "Malformed Worker request.",
    );
  }
}

export function parseWorkerReply(input: unknown): WorkerReply {
  try {
    const owned = copyExternalWireValue(input, {
      allowArrayBuffer: true,
      maxBytes: MAX_INPUT_FILE_BYTES,
    });
    const reply = workerReplySchema.parse(owned) as WorkerReply;
    return freezeOwnedWireValue(reply) as WorkerReply;
  } catch (error) {
    if (error instanceof WireProtocolError) throw error;
    throw new WireProtocolError(error instanceof Error ? error.message : "Malformed Worker reply.");
  }
}

export interface RequestSequencer {
  create<K extends WorkerRequestKind>(kind: K, body: unknown): Extract<WorkerRequest, { kind: K }>;
  isClosed(): boolean;
  getNextSequence(): number | null;
}

export function createRequestSequencer(epoch: string, firstSequence = 0): RequestSequencer {
  const checkedEpoch = epochSchema.parse(epoch);
  if (!nonnegativeSafeInteger.safeParse(firstSequence).success)
    throw new RangeError("Request sequence must be a nonnegative safe integer.");
  let next: number | null = firstSequence;
  return {
    create<K extends WorkerRequestKind>(
      kind: K,
      body: unknown,
    ): Extract<WorkerRequest, { kind: K }> {
      if (next === null)
        throw new WireProtocolError("Request sequence is exhausted; start a new epoch.");
      const request = parseWorkerRequest({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        epoch: checkedEpoch,
        requestSequence: next,
        kind,
        body,
      });
      next = next === Number.MAX_SAFE_INTEGER ? null : next + 1;
      return request as Extract<WorkerRequest, { kind: K }>;
    },
    isClosed: () => next === null,
    getNextSequence: () => next,
  };
}

export type SequenceRejectReason = "stale-epoch" | "sequence-gap" | "sequence-exhausted";
export type SequenceAcceptResult =
  { readonly accepted: true } | { readonly accepted: false; readonly reason: SequenceRejectReason };

export interface InboundSequenceGuard {
  accept(request: Pick<WorkerRequestEnvelope, "epoch" | "requestSequence">): SequenceAcceptResult;
  getExpectedSequence(): number | null;
}

export function createInboundSequenceGuard(epoch: string, firstSequence = 0): InboundSequenceGuard {
  const checkedEpoch = epochSchema.parse(epoch);
  if (!nonnegativeSafeInteger.safeParse(firstSequence).success)
    throw new RangeError("Request sequence must be a nonnegative safe integer.");
  let expected: number | null = firstSequence;
  return {
    accept(request): SequenceAcceptResult {
      if (request.epoch !== checkedEpoch) return { accepted: false, reason: "stale-epoch" };
      if (expected === null) return { accepted: false, reason: "sequence-exhausted" };
      if (request.requestSequence !== expected) return { accepted: false, reason: "sequence-gap" };
      expected = expected === Number.MAX_SAFE_INTEGER ? null : expected + 1;
      return { accepted: true };
    },
    getExpectedSequence: () => expected,
  };
}

export interface ReplySequenceGuard {
  accept(reply: WorkerReply): SequenceAcceptResult;
  getExpectedSequence(): number | null;
}

export function workerRequestByteLength(request: WorkerRequest): number {
  return (
    encodedByteLength(request) +
    (request.kind === "PREVIEW_IMPORT" ? request.body.fileBytes.byteLength : 0)
  );
}

export function workerRequestCategory(request: WorkerRequest): RequestCategory {
  if (request.kind === "PREVIEW_IMPORT") return "import";
  if (
    request.kind === "LOAD_SLOT" ||
    request.kind === "RECOVER" ||
    request.kind === "REQUEST_SAVE" ||
    request.kind === "CONFIRM_IMPORT" ||
    request.kind === "LIST_SLOTS" ||
    request.kind === "EXPORT_SLOT" ||
    request.kind === "DELETE_SLOT" ||
    request.kind === "REQUEST_REPORT" ||
    request.kind === "CREATE_REPORT" ||
    request.kind === "LIST_REPORTS" ||
    request.kind === "DELETE_REPORT"
  ) {
    return "maintenance";
  }
  return "ordinary";
}

export function createReplySequenceGuard(epoch: string, firstSequence = 0): ReplySequenceGuard {
  const checkedEpoch = epochSchema.parse(epoch);
  if (!nonnegativeSafeInteger.safeParse(firstSequence).success)
    throw new RangeError("Outbound sequence must be a nonnegative safe integer.");
  let expected: number | null = firstSequence;
  return {
    accept(reply): SequenceAcceptResult {
      if (reply.epoch !== checkedEpoch) return { accepted: false, reason: "stale-epoch" };
      if (expected === null) return { accepted: false, reason: "sequence-exhausted" };
      if (reply.outboundSequence !== expected) return { accepted: false, reason: "sequence-gap" };
      expected = expected === Number.MAX_SAFE_INTEGER ? null : expected + 1;
      return { accepted: true };
    },
    getExpectedSequence: () => expected,
  };
}

interface PendingCorrelation {
  readonly epoch: string;
  readonly commandId: string | null;
}

export interface RequestCorrelator {
  add(epoch: string, requestSequence: number, commandId?: string): void;
  cancel(epoch: string, requestSequence: number): boolean;
  settle(reply: WorkerReply):
    | { readonly matched: true; readonly commandId: string | null }
    | {
        readonly matched: false;
        readonly reason: "unsolicited" | "unknown" | "stale-epoch" | "nonterminal";
      };
  reset(epoch: string): void;
  size(): number;
}

const NONTERMINAL_REPLY_KINDS = new Set<WorkerReplyKind>([
  "COMMAND_RECEIPT",
  "HEARTBEAT",
  "SUSPENDED",
  "SNAPSHOT_PUBLICATION",
  "EVENT_BATCH",
  "EVENTS_GAP",
  "TRANSPORT_DEGRADED",
]);

export function createRequestCorrelator(): RequestCorrelator {
  const pending = new Map<number, PendingCorrelation>();
  let currentEpoch: string | null = null;
  return {
    add(epoch, requestSequence, commandId) {
      const checkedEpoch = epochSchema.parse(epoch);
      if (!nonnegativeSafeInteger.safeParse(requestSequence).success)
        throw new RangeError("Request sequence must be a nonnegative safe integer.");
      currentEpoch ??= checkedEpoch;
      if (checkedEpoch !== currentEpoch)
        throw new WireProtocolError("Correlation epoch does not match the active client epoch.");
      if (pending.has(requestSequence))
        throw new WireProtocolError("Duplicate pending request sequence.");
      if (pending.size >= MAX_OUTSTANDING_REQUESTS)
        throw new WireProtocolError("Too many outstanding Worker requests.");
      pending.set(requestSequence, {
        epoch: checkedEpoch,
        commandId: commandId === undefined ? null : z.uuid().parse(commandId),
      });
    },
    cancel(epoch, requestSequence) {
      const checkedEpoch = epochSchema.parse(epoch);
      if (!nonnegativeSafeInteger.safeParse(requestSequence).success)
        throw new RangeError("Request sequence must be a nonnegative safe integer.");
      const match = pending.get(requestSequence);
      if (match?.epoch !== checkedEpoch || checkedEpoch !== currentEpoch) {
        return false;
      }
      pending.delete(requestSequence);
      return true;
    },
    settle(reply) {
      if (reply.requestSequence === null) return { matched: false, reason: "unsolicited" };
      if (NONTERMINAL_REPLY_KINDS.has(reply.kind)) return { matched: false, reason: "nonterminal" };
      const match = pending.get(reply.requestSequence);
      if (match === undefined) return { matched: false, reason: "unknown" };
      if (match.epoch !== reply.epoch || currentEpoch !== reply.epoch)
        return { matched: false, reason: "stale-epoch" };
      if (reply.kind === "COMMAND_RESULT") {
        const body = reply.body as { commandId: string; result: CommandResult };
        if (
          match.commandId === null ||
          body.commandId !== match.commandId ||
          body.result.commandId !== match.commandId
        ) {
          throw new WireProtocolError(
            "COMMAND_RESULT commandId does not match its epoch/requestSequence correlation.",
          );
        }
      }
      pending.delete(reply.requestSequence);
      return { matched: true, commandId: match.commandId };
    },
    reset(epoch) {
      currentEpoch = epochSchema.parse(epoch);
      pending.clear();
    },
    size: () => pending.size,
  };
}

export type RequestCategory = "ordinary" | "maintenance" | "import";
export type RequestReserveResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: "BUSY" | "LIMIT_EXCEEDED" };

export interface RequestLedger {
  reserve(
    requestSequence: number,
    byteLength: number,
    category?: RequestCategory,
  ): RequestReserveResult;
  release(requestSequence: number): boolean;
  clear(): void;
  getStatus(): {
    readonly outstanding: number;
    readonly ordinaryBytes: number;
    readonly maintenanceActive: boolean;
  };
}

export function createRequestLedger(): RequestLedger {
  const requests = new Map<
    number,
    { readonly bytes: number; readonly category: RequestCategory }
  >();
  let ordinaryBytes = 0;
  let maintenanceActive = false;
  return {
    reserve(requestSequence, byteLength, category = "ordinary") {
      if (
        !nonnegativeSafeInteger.safeParse(requestSequence).success ||
        !Number.isSafeInteger(byteLength) ||
        byteLength < 0
      ) {
        return { accepted: false, reason: "LIMIT_EXCEEDED" };
      }
      if (requests.has(requestSequence))
        throw new WireProtocolError("Duplicate outstanding request sequence.");
      if (requests.size >= MAX_OUTSTANDING_REQUESTS) return { accepted: false, reason: "BUSY" };
      const isMaintenance = category !== "ordinary";
      if (isMaintenance && maintenanceActive) return { accepted: false, reason: "BUSY" };
      if (category === "import") {
        if (byteLength === 0 || byteLength > MAX_INPUT_FILE_BYTES)
          return { accepted: false, reason: "LIMIT_EXCEEDED" };
      } else {
        if (byteLength > MAX_ORDINARY_REQUEST_BYTES)
          return { accepted: false, reason: "LIMIT_EXCEEDED" };
        if (ordinaryBytes + byteLength > MAX_AGGREGATE_REQUEST_BYTES)
          return { accepted: false, reason: "LIMIT_EXCEEDED" };
      }
      requests.set(requestSequence, { bytes: category === "import" ? 0 : byteLength, category });
      ordinaryBytes += category === "import" ? 0 : byteLength;
      if (isMaintenance) maintenanceActive = true;
      return { accepted: true };
    },
    release(requestSequence) {
      const entry = requests.get(requestSequence);
      if (entry === undefined) return false;
      requests.delete(requestSequence);
      ordinaryBytes -= entry.bytes;
      if (entry.category !== "ordinary") maintenanceActive = false;
      return true;
    },
    clear() {
      requests.clear();
      ordinaryBytes = 0;
      maintenanceActive = false;
    },
    getStatus: () => ({ outstanding: requests.size, ordinaryBytes, maintenanceActive }),
  };
}

export function isCommandResult(value: unknown): value is CommandResult {
  return commandResultSchema.safeParse(value).success;
}

export function commandForRequest(request: WorkerRequest): SimCommand | null {
  return request.kind === "COMMAND" ? request.body.command : null;
}

export function isGridPublication(value: unknown): value is GridPublication {
  return gridPublicationSchema.safeParse(value).success;
}

export function isUiSnapshot(value: unknown): value is UiSnapshot {
  return snapshotSchema.safeParse(value).success;
}
