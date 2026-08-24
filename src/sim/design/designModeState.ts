import type { GameState } from "../core/types.ts";

export function assertValidDesignModeState(
  state: GameState,
  minimumModuleInstanceSequence?: number,
  minimumRouteSequence?: number,
): void {
  const sequence = state.facility.nextModuleInstanceSequence;
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("The next module instance sequence must be a positive safe integer.");
  }
  if (minimumModuleInstanceSequence !== undefined && sequence < minimumModuleInstanceSequence) {
    throw new Error("The next module instance sequence must never decrease.");
  }
  const routeSequence = state.facility.nextRouteSequence;
  if (!Number.isSafeInteger(routeSequence) || routeSequence <= 0) {
    throw new Error("The next route sequence must be a positive safe integer.");
  }
  if (minimumRouteSequence !== undefined && routeSequence < minimumRouteSequence) {
    throw new Error("The next route sequence must never decrease.");
  }

  const draft = state.facility.designDraft;
  if (draft !== null && (!Number.isSafeInteger(draft.revision) || draft.revision < 0)) {
    throw new Error("The Design Mode revision must be a nonnegative safe integer.");
  }
}
