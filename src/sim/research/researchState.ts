import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import type { GameState, MuseumSnapshot, ResearchStatus } from "../core/types.ts";

export interface ResearchStateIssue {
  readonly path: string;
  readonly message: string;
}

export const FINAL_MUSEUM_SNAPSHOT_ID = "museum-vacuum-tube-final" as const;

const RESEARCH_STATUSES: readonly ResearchStatus[] = [
  "locked",
  "available",
  "active",
  "completed",
  "cancelled",
];

function pushIf(
  issues: ResearchStateIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (condition) issues.push({ path, message });
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isFinitePositiveAtMostOne(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1 && !Object.is(value, -0);
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasLexicalUniqueOrder(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function validateMuseumSnapshot(
  snapshot: Readonly<MuseumSnapshot>,
  index: number,
  issues: ResearchStateIssue[],
): void {
  const path = `museum.snapshots[${index}]`;
  for (const [field, value] of [
    ["createdAtTick", snapshot.createdAtTick],
    ["year", snapshot.year],
    ["moduleCount", snapshot.moduleCount],
    ["theoreticalComputeFlops", snapshot.theoreticalComputeFlops],
    ["usefulComputeFlops", snapshot.usefulComputeFlops],
    ["averagePowerWatts", snapshot.averagePowerWatts],
    ["peakPowerWatts", snapshot.peakPowerWatts],
    ["totalCostUsd", snapshot.totalCostUsd],
  ] as const) {
    pushIf(
      issues,
      !isFiniteNonnegative(value),
      `${path}.${field}`,
      "must be finite and nonnegative",
    );
  }
  for (const [field, value] of [
    ["averageTemperatureC", snapshot.averageTemperatureC],
    ["maxTemperatureC", snapshot.maxTemperatureC],
  ] as const) {
    pushIf(issues, !isFiniteNumber(value), `${path}.${field}`, "must be finite");
  }
  pushIf(
    issues,
    !hasUniqueValues(snapshot.benchmarkRunIds),
    `${path}.benchmarkRunIds`,
    "must contain unique benchmark run IDs",
  );
  pushIf(
    issues,
    !hasUniqueValues(snapshot.completedResearchIds),
    `${path}.completedResearchIds`,
    "must contain unique Research IDs",
  );
}

export function validateStoredResearchState(state: Readonly<GameState>): ResearchStateIssue[] {
  const issues: ResearchStateIssue[] = [];
  const { research } = state;
  pushIf(
    issues,
    !isFiniteNonnegative(research.researchData),
    "research.researchData",
    "must be finite and nonnegative",
  );
  pushIf(
    issues,
    !hasLexicalUniqueOrder(research.evidenceTags),
    "research.evidenceTags",
    "must contain unique evidence tags in lexical order",
  );

  const activeNodeIds: string[] = [];
  for (const [nodeId, status] of Object.entries(research.statuses)) {
    pushIf(
      issues,
      !RESEARCH_STATUSES.includes(status),
      `research.statuses.${nodeId}`,
      "must be a valid Research status",
    );
    if (status === "active") activeNodeIds.push(nodeId);
  }
  pushIf(
    issues,
    activeNodeIds.length > 1,
    "research.statuses",
    "must contain at most one active status",
  );
  pushIf(
    issues,
    (research.active === null) !== (activeNodeIds.length === 0),
    "research.active",
    "must be non-null exactly when one status is active",
  );

  if (research.active !== null) {
    const path = "research.active";
    pushIf(
      issues,
      research.statuses[research.active.nodeId] !== "active",
      `${path}.nodeId`,
      "must match the active Research status",
    );
    pushIf(
      issues,
      !Number.isSafeInteger(research.active.startedAtTick) ||
        research.active.startedAtTick < 0 ||
        research.active.startedAtTick > state.tick,
      `${path}.startedAtTick`,
      "must be a nonnegative safe integer no greater than the state tick",
    );
    pushIf(
      issues,
      !isFiniteNonnegative(research.active.completedOperations),
      `${path}.completedOperations`,
      "must be finite, nonnegative, and not negative zero",
    );
    pushIf(
      issues,
      !isFinitePositiveAtMostOne(research.active.reservedComputeShare),
      `${path}.reservedComputeShare`,
      "must be finite, strictly positive, at most one, and not negative zero",
    );
  }

  const snapshotIds = new Set<string>();
  for (let index = 0; index < state.museum.snapshots.length; index += 1) {
    const snapshot = state.museum.snapshots[index];
    if (snapshot === undefined) continue;
    pushIf(issues, snapshotIds.has(snapshot.id), `museum.snapshots[${index}].id`, "must be unique");
    snapshotIds.add(snapshot.id);
    validateMuseumSnapshot(snapshot, index, issues);
  }

  return issues;
}

function hasSameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function validateContentAwareResearchState(
  state: Readonly<GameState>,
  content: ContentBundle,
): ResearchStateIssue[] {
  const issues = validateStoredResearchState(state);
  const contentResearchIds = Object.keys(content.research).toSorted();
  const stateResearchIds = Object.keys(state.research.statuses).toSorted();
  if (!hasSameIds(stateResearchIds, contentResearchIds)) {
    issues.push({
      path: "research.statuses",
      message: "must contain exactly every content Research ID",
    });
  }

  const active = state.research.active;
  if (active !== null) {
    const node = content.research[active.nodeId];
    if (node === undefined) {
      issues.push({
        path: "research.active.nodeId",
        message: "must reference known Research content",
      });
    } else {
      pushIf(
        issues,
        active.completedOperations >= node.requiredOperations,
        "research.active.completedOperations",
        "must be strictly below the active node required operations",
      );
      pushIf(
        issues,
        active.reservedComputeShare < node.minimumComputeShare,
        "research.active.reservedComputeShare",
        "must be at least the active node minimum Compute share",
      );
    }
  }

  for (let snapshotIndex = 0; snapshotIndex < state.museum.snapshots.length; snapshotIndex += 1) {
    const snapshot = state.museum.snapshots[snapshotIndex];
    if (snapshot === undefined) continue;
    for (const researchId of snapshot.completedResearchIds) {
      if (content.research[researchId] === undefined) {
        issues.push({
          path: `museum.snapshots[${snapshotIndex}].completedResearchIds`,
          message: `must reference known Research node ${researchId}`,
        });
      } else {
        pushIf(
          issues,
          state.research.statuses[researchId] !== "completed",
          `research.statuses.${researchId}`,
          "completed Research nodes must not return to a non-completed status",
        );
      }
    }
  }

  const finalNodes = Object.values(content.research).filter((node) => node.finalReveal);
  if (finalNodes.length === 1) {
    const finalNode = finalNodes[0];
    if (finalNode === undefined) throw new Error("Final Research node is missing.");
    const finalCompleted = state.research.statuses[finalNode.id] === "completed";
    pushIf(
      issues,
      state.campaign.transistorRevealed !== finalCompleted,
      "campaign.transistorRevealed",
      "must match final Research completion",
    );
    pushIf(
      issues,
      state.campaign.verticalSliceCompleted !== finalCompleted,
      "campaign.verticalSliceCompleted",
      "must match final Research completion",
    );

    const finalSnapshots = state.museum.snapshots.filter(
      (snapshot) => snapshot.id === FINAL_MUSEUM_SNAPSHOT_ID,
    );
    pushIf(
      issues,
      finalCompleted ? finalSnapshots.length !== 1 : finalSnapshots.length !== 0,
      "museum.snapshots",
      finalCompleted
        ? "must contain exactly one fixed final Museum snapshot after final Research completion"
        : "must not contain the fixed final Museum snapshot before final Research completion",
    );
    for (const snapshot of finalSnapshots) {
      pushIf(
        issues,
        !snapshot.completedResearchIds.includes(finalNode.id),
        "museum.snapshots",
        "the fixed final Museum snapshot must include the completed final Research node",
      );
    }
  }

  return issues;
}

export function assertValidStoredResearchState(state: Readonly<GameState>): void {
  const issues = validateStoredResearchState(state);
  if (issues.length > 0) {
    throw new Error(
      `Invalid research state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}

export function assertValidContentAwareResearchState(
  state: Readonly<GameState>,
  content: ContentBundle,
): void {
  const issues = validateContentAwareResearchState(state, content);
  if (issues.length > 0) {
    throw new Error(
      `Invalid content-aware research state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}
