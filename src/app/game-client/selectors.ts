// Named store selectors (Phase 2 §7.2, Task 18.3).
//
// Every selector is a pure read over StoreState and returns a stable
// reference (a stored section or entity) or null when no publication has
// arrived yet. There is intentionally no per-tile selector: tiles are
// consumed in bulk by the renderer through selectHeatmap, never through
// per-tile React subscriptions.

import type { StoreState } from "./store.ts";
import type {
  GridModuleViewModel,
  GridRouteViewModel,
  GridViewModel,
  HeaderViewModel,
  HeatmapPatch,
  InspectorViewModel,
  ResearchSummaryViewModel,
  TaskCardViewModel,
  TelemetryViewModel,
  UiSnapshot,
} from "../../sim/selectors/presentationTypes.ts";

export function selectSnapshot(state: StoreState): UiSnapshot | null {
  return state.snapshot;
}

export function selectGrid(state: StoreState): GridViewModel | null {
  return state.grid;
}

export function selectHeader(state: StoreState): HeaderViewModel | null {
  return state.snapshot?.header ?? null;
}

export function selectTasks(state: StoreState): readonly TaskCardViewModel[] | null {
  return state.snapshot?.tasks ?? null;
}

export function selectTaskById(
  state: StoreState,
  taskInstanceId: string,
): TaskCardViewModel | null {
  return state.snapshot?.tasks.find((task) => task.taskInstanceId === taskInstanceId) ?? null;
}

export function selectTelemetry(state: StoreState): TelemetryViewModel | null {
  return state.snapshot?.telemetry ?? null;
}

export function selectInspector(state: StoreState): InspectorViewModel | null {
  return state.snapshot?.inspector ?? null;
}

export function selectResearch(state: StoreState): ResearchSummaryViewModel | null {
  return state.snapshot?.research ?? null;
}

export function selectBuild(state: StoreState): UiSnapshot["build"] | null {
  return state.snapshot?.build ?? null;
}

export function selectTutorial(state: StoreState): UiSnapshot["tutorial"] | null {
  return state.snapshot?.tutorial ?? null;
}

export function selectCommandAvailability(
  state: StoreState,
): UiSnapshot["commandAvailability"] | null {
  return state.snapshot?.commandAvailability ?? null;
}

export function selectGridModules(state: StoreState): readonly GridModuleViewModel[] | null {
  return state.grid?.modules ?? null;
}

export function selectGridModuleById(
  state: StoreState,
  moduleInstanceId: string,
): GridModuleViewModel | null {
  return state.grid?.modules.find((view) => view.id === moduleInstanceId) ?? null;
}

export function selectGridRoutes(state: StoreState): readonly GridRouteViewModel[] | null {
  return state.grid?.routes ?? null;
}

export function selectGridRouteById(state: StoreState, routeId: string): GridRouteViewModel | null {
  return state.grid?.routes.find((view) => view.id === routeId) ?? null;
}

export function selectHeatmap(state: StoreState): HeatmapPatch | null {
  return state.grid?.heatmap ?? null;
}
