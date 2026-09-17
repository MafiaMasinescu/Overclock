// Frozen projection source mapping (Phase 2 §4 gate: Task 18.3 freezes
// the projection mapping; built incrementally by 18.1/18.2).
//
// Every view-model field names its exact authoritative source or the
// documented read-only definition used when no stored value exists.
// Anything not listed here must not appear in a publication.

import { deepFreeze } from "../../content/loader/deepFreeze.ts";

// Section 18.1: pure projector fields (snapshot + grid view models).
const PROJECTOR_SOURCES: Readonly<Record<string, string>> = {
  revision: "Reserved 0; owned by the publication/host boundary (Task 19).",
  tick: "state.tick (direct).",
  "header.eraNameKey": "content.era.nameKey (direct).",
  "header.year": "state.campaign.currentYear (direct).",
  "header.objectiveKey": "state.campaign.objectiveKey (direct).",
  "header.paused": "state.clock.paused (direct).",
  "header.speed": "state.clock.speed (direct).",
  "header.cashUsd": "state.economy.cashUsd (direct).",
  "header.usefulComputeFlops":
    "state.facility.compute.totalAllocatedUsefulComputeFlops (stored facility total).",
  "header.theoreticalComputeFlops":
    "state.facility.compute.totalTheoreticalComputeFlops (stored facility total).",
  "header.powerDrawWatts": "state.facility.power.totalDeliveredPowerWatts (stored).",
  "header.powerCapacityWatts": "state.facility.contractedPowerWatts (contracted facility value).",
  "header.averageTemperatureC":
    "Mean over all authoritative facility.thermalTiles (row-major, every tile).",
  "header.maxTemperatureC": "Maximum over all authoritative facility.thermalTiles.",
  "tasks[].taskInstanceId": "state.tasks.instances key, lexical order (direct).",
  "tasks[].definitionId": "Task instance definitionId (direct).",
  "tasks[].nameKey": "content.tasks[definitionId].nameKey (existing label).",
  "tasks[].status": "Task instance status (direct).",
  "tasks[].tags": "content.tasks[definitionId].tags (existing tags, copied).",
  "tasks[].progressRatio":
    "Read-only definition: totalCompletedOperations / sum(definition.phases.operations), clamped to [0, 1]. No forecast formula.",
  "tasks[].phaseIndex": "Task instance currentPhaseIndex (direct).",
  "tasks[].phaseCount": "content.tasks[definitionId].phases.length (direct).",
  "tasks[].deadlineTick": "Task instance deadlineTick (direct, nullable).",
  "tasks[].projectedCompletionTick": "Always null: no accepted forecast exists (P2-D20).",
  "tasks[].deadlineRisk": "Always null: no accepted forecast exists (P2-D20).",
  "tasks[].allocatedUsefulComputeFlops":
    "Task instance allocation.deliveredUsefulComputeFlops, or 0 when unallocated (stored delivery).",
  alerts: "Always empty: semantic alerts remain null/empty until their later UI contract (§7.1).",
  "telemetry.memoryCapacityBytes":
    "Always null: no authoritative facility memory aggregate is recorded by Compute.",
  "telemetry.memoryUsedBytes":
    "Always null: no authoritative facility memory aggregate is recorded by Compute.",
  "telemetry.memoryBandwidthBytesPerSecond":
    "Always null: no authoritative facility bandwidth aggregate is recorded by Compute.",
  "telemetry.memoryBandwidthUsedBytesPerSecond":
    "Always null: no authoritative facility bandwidth aggregate is recorded by Compute.",
  "telemetry.researchData": "state.research.researchData (direct).",
  "telemetry.reputation": "state.campaign.reputation (direct).",
  "telemetry.retryRate":
    "Always null: per-module retry rates are stored but no facility aggregate is.",
  "telemetry.powerHeadroomWatts": "state.facility.power.headroomWatts (stored).",
  "telemetry.bottleneck":
    "Stored breakdown entry with greatest lostComputeFlops (factor lexical tie-break) from the inspected task entity; null without selection.",
  "telemetry.seriesRevision": "Always 0 until a later chart contract supplies data (§7.1).",
  "inspector.selectedEntityId":
    "Echo of the validated presentation context id when resolved, else null.",
  "inspector.entityKind":
    "Resolved record family (module/route/tile/task); null when absent/stale.",
  "inspector.titleKey":
    "Module/task content nameKey; null for routes/tiles without a content label.",
  "inspector.stats":
    "Stored reads only (power delivery, live tile temperature, available compute, task status) with existing ui.* label keys; empty when absent/stale.",
  "inspector.computeBreakdown":
    "Copied stored TaskComputeResultState.breakdown for inspected tasks; null otherwise (modules carry no breakdown).",
  "research.researchData": "state.research.researchData (direct).",
  "research.activeNodeId": "state.research.active.nodeId, or null (direct).",
  "research.activeProgressRatio":
    "Read-only definition: active.completedOperations / requiredOperations, clamped to [0, 1]; 0 without active research.",
  "research.availableNodeIds":
    "Statuses equal to available, ordered by content (sortOrder, id) using existing pure status reads.",
  "research.completedNodeIds":
    "Statuses equal to completed, ordered by content (sortOrder, id) using existing pure status reads.",
  "build.designMode": "state.facility.designDraft !== null (direct).",
  "build.draftRevision":
    "state.facility.designDraft.revision, or null outside design mode (direct).",
  "build.inventoryUnitCount":
    "Presentation-local derivation: total inventory units across stacks (no authoritative counter exists; non-authoritative).",
  "build.availableDefinitionIds":
    "Lexical module ids passing the existing pure isModuleUnlocked rule (content/research).",
  "tutorial.currentStepId":
    "state.tutorial.currentStepId (direct, stored state, no progression invented).",
  "tutorial.guidanceMode": "state.tutorial.guidanceMode (direct).",
  commandAvailability:
    "Conservative pure-guard hints per command kind (draft presence, stack lengths, offers, availability statuses); never a substitute for validation; unknown kinds omitted; dev-only commands excluded.",
  "grid.revision": "Reserved 0; owned by the 18.2 publisher (base/next grid revisions).",
  "grid.mode":
    "Explicit live (no draft) or draft (draft present); selects the geometry source (§7.1).",
  "grid.layoutRevision":
    "Live mode: facility.liveLayoutRevision. Draft mode: designDraft.revision (direct).",
  "grid.thermalRevision": "state.facility.thermalRevision (direct; always the live field).",
  "grid.gridSize": "state.facility.size (copied).",
  "grid.modules[].id": "Layout module record id, lexical order (direct).",
  "grid.modules[].definitionId": "Layout module record definitionId (direct).",
  "grid.modules[].spriteKey":
    "Presentation-local derivation module-<category>; no renderer consumer exists yet (Phase 3 owns sprite keys).",
  "grid.modules[].position": "Layout module record position (copied).",
  "grid.modules[].footprint":
    "Existing pure resolveRotatedFootprintSize(definition.footprint, rotation) (no duplication).",
  "grid.modules[].rotation": "Layout module record rotation (direct).",
  "grid.modules[].operationalState": "Layout module record operationalState (stored, direct).",
  "grid.modules[].selected": "Membership in the validated presentation context selectedIds.",
  "grid.modules[].warning":
    "Priority thermal > power > route > none from stored overclock shutdownReason, stored power limitingReason, and invalid-route diagnostics on the viewed layout; never guessed thresholds.",
  "grid.modules[].temperatureC":
    "Mean temperature of the live occupied tiles (row-major authoritative field); null for draft-only entities without a live footprint.",
  "grid.modules[].overclock": "Layout module record overclock settings (stored, copied).",
  "grid.routes[].id": "Layout route record id, lexical order (direct).",
  "grid.routes[].kind": "Layout route record kind (direct).",
  "grid.routes[].path": "Layout route record path (copied points).",
  "grid.routes[].utilizationRatio":
    "Stored Power byRoute utilization for power routes (null without a stored delivery); always null for data routes until authoritative evidence exists.",
  "grid.routes[].selected": "Membership in the validated presentation context selectedIds.",
  "grid.heatmap": "Always null on the pure path; heatmap deltas are publisher-owned (18.2).",
  "grid.placementPreview": "Always null until the later placement-preview UI contract.",
  "grid.diagnosticHighlights": "Always empty until the later semantic-alert UI contract.",
};

// Section 18.2: revision-aware publication envelope (§7.2). Epochs are
// opaque host values; every other envelope field derives from the
// acknowledged baseline plus the current projection.
const PUBLICATION_SOURCES: Readonly<Record<string, string>> = {
  "publication.epoch":
    "Opaque host epoch stamped at publisher creation; a new epoch takes a fresh publisher (load/recovery).",
  "publication.publicationSequence":
    "Publisher-local monotonic sequence starting at 0; correlation only, never gameplay.",
  "publication.baseGridRevision":
    "Last acknowledged grid revision; the store must hold exactly this revision to apply.",
  "publication.nextGridRevision":
    "Acknowledged revision plus one when presented content changed or the snapshot is full; unchanged on source-only advances.",
  "publication.viewMode": "Viewed layout mode (live/draft) of the projected grid.",
  "publication.source":
    "Live/draft/thermal source revisions plus dimensions of the projected state; a decrease observes a load and forces a full snapshot.",
  "publication.entities.upsertModules":
    "Lexically ordered new/changed module view models since the acknowledged baseline (canonical comparison); every module on a full snapshot.",
  "publication.entities.removeModuleIds":
    "Lexically ordered module ids absent since the acknowledged baseline; explicit removals only.",
  "publication.entities.upsertRoutes":
    "Lexically ordered new/changed route view models since the acknowledged baseline; every route on a full snapshot.",
  "publication.entities.removeRouteIds":
    "Lexically ordered route ids absent since the acknowledged baseline; explicit removals only.",
  "publication.heatmap.full":
    "True on full snapshots (exact values for every tile, row-major); false on deltas.",
  "publication.heatmap.values":
    "Tiles whose absolute change since the last acknowledged transmission reached dirtyEpsilonC (balancing.thermal.dirtyEpsilonC), with exact current values; cumulative sub-epsilon drift is never lost.",
  "presentation.thermalTiles":
    "Authoritative frozen thermal array shared by reference with the narrow read (never mutated by receivers); feeds heatmap deltas without a save serialization.",
  "presentation.source":
    "Live/draft/thermal revisions, view mode and dimensions carried with the read so the host assembles publication inputs directly.",
};
export const PROJECTION_SOURCE_MAPPING: Readonly<Record<string, string>> = deepFreeze({
  ...PROJECTOR_SOURCES,
  ...PUBLICATION_SOURCES,
});
