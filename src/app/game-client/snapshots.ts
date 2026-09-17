// App-level snapshot imports (Phase 0 shell compatibility path).
//
// Canonical view-model contracts live in the simulator-neutral selectors
// boundary (`src/sim/selectors/presentationTypes.ts`, Phase 2 §4); this
// module re-exports them so shell consumers keep a stable import path.
// `src/sim` never imports `src/app`.

export type {
  AlertViewModel,
  GridModuleViewModel,
  GridRouteViewModel,
  GridViewMode,
  GridViewModel,
  HeaderViewModel,
  HeatmapPatch,
  InspectorViewModel,
  PlacementPreviewViewModel,
  PresentationBreakdown,
  ResearchSummaryViewModel,
  TaskCardViewModel,
  TelemetryViewModel,
  UiSnapshot,
} from "../../sim/selectors/presentationTypes.ts";
