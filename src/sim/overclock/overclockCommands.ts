import type { ContentBundle } from "../../content/schemas/contentSchemas.ts";
import { compareStableStrings } from "../../grid/domain/stableOrdering.ts";
import type {
  CommandHandlerRejection,
  CommandHandlerRegistry,
} from "../commands/commandHandlers.ts";
import type { GameState, ModuleInstanceState, OverclockProfile } from "../core/types.ts";
import { createDirtyOverclockState } from "./overclockState.ts";

export type OverclockCommandHandlers = Pick<
  CommandHandlerRegistry,
  "SET_OVERCLOCK_PROFILE" | "SET_MANUAL_OVERCLOCK"
>;

const REJECTIONS = {
  invalidPayload: { code: "INVALID_PAYLOAD", messageKey: "errors.invalid-payload" },
  targetInvalid: {
    code: "OVERCLOCK_TARGET_INVALID",
    messageKey: "errors.overclock-target-invalid",
  },
  unsupported: { code: "OVERCLOCK_UNSUPPORTED", messageKey: "errors.overclock-unsupported" },
  unavailableInDesignMode: {
    code: "OVERCLOCK_UNAVAILABLE_IN_DESIGN_MODE",
    messageKey: "errors.overclock-unavailable-in-design-mode",
  },
  outOfRange: { code: "OVERCLOCK_OUT_OF_RANGE", messageKey: "errors.overclock-out-of-range" },
} as const satisfies Record<string, CommandHandlerRejection>;

function sortedDistinctTargets(targets: readonly string[]): readonly string[] | undefined {
  if (targets.length === 0) return undefined;
  const sorted = [...targets].toSorted(compareStableStrings);
  return sorted.some((target, index) => index > 0 && target === sorted[index - 1])
    ? undefined
    : sorted;
}

function hasExactSettings(
  module: Readonly<ModuleInstanceState>,
  profile: OverclockProfile,
  frequencyRatio: number,
  voltageRatio: number,
): boolean {
  return (
    module.overclock.profile === profile &&
    module.overclock.frequencyRatio === frequencyRatio &&
    module.overclock.voltageRatio === voltageRatio
  );
}

function validateTargets(
  state: GameState,
  content: ContentBundle,
  targets: readonly string[],
): CommandHandlerRejection | undefined {
  for (const moduleId of targets) {
    const module = state.facility.modules[moduleId];
    if (module === undefined) return REJECTIONS.targetInvalid;
    const definition = content.modules[module.definitionId];
    if (definition?.overclockable !== true) return REJECTIONS.unsupported;
  }
  return undefined;
}

function applySettings(
  state: GameState,
  targets: readonly string[],
  profile: OverclockProfile,
  frequencyRatio: number,
  voltageRatio: number,
): void {
  if (
    targets.every((moduleId) => {
      const module = state.facility.modules[moduleId];
      return (
        module !== undefined && hasExactSettings(module, profile, frequencyRatio, voltageRatio)
      );
    })
  ) {
    return;
  }
  const modules = { ...state.facility.modules };
  for (const moduleId of targets) {
    const module = modules[moduleId];
    if (module === undefined) throw new Error("Validated Overclock target is missing.");
    if (!hasExactSettings(module, profile, frequencyRatio, voltageRatio)) {
      modules[moduleId] = {
        ...module,
        overclock: { profile, frequencyRatio, voltageRatio },
      };
    }
  }
  state.facility.modules = modules;
  state.facility.overclock = createDirtyOverclockState();
}

function validateManualRatios(
  content: ContentBundle,
  frequencyRatio: number,
  voltageRatio: number,
): CommandHandlerRejection | undefined {
  const { manual } = content.balancing.overclock;
  if (
    !Number.isFinite(frequencyRatio) ||
    !Number.isFinite(voltageRatio) ||
    frequencyRatio < manual.frequencyRatioMin ||
    frequencyRatio > manual.frequencyRatioMax ||
    voltageRatio < manual.voltageRatioMin ||
    voltageRatio > manual.voltageRatioMax
  ) {
    return REJECTIONS.outOfRange;
  }
  return undefined;
}

export function createOverclockCommandHandlers(content: ContentBundle): OverclockCommandHandlers {
  return Object.freeze({
    SET_OVERCLOCK_PROFILE({ state }, command) {
      if (state.facility.designDraft !== null) return REJECTIONS.unavailableInDesignMode;
      const targets = sortedDistinctTargets(command.moduleInstanceIds);
      if (targets === undefined) return REJECTIONS.invalidPayload;
      const rejection = validateTargets(state, content, targets);
      if (rejection !== undefined) return rejection;
      const preset = content.balancing.overclock[command.profile];
      applySettings(state, targets, command.profile, preset.frequencyRatio, preset.voltageRatio);
    },

    SET_MANUAL_OVERCLOCK({ state }, command) {
      if (state.facility.designDraft !== null) return REJECTIONS.unavailableInDesignMode;
      const targets = sortedDistinctTargets(command.moduleInstanceIds);
      if (targets === undefined) return REJECTIONS.invalidPayload;
      const rangeRejection = validateManualRatios(
        content,
        command.frequencyRatio,
        command.voltageRatio,
      );
      if (rangeRejection !== undefined) return rangeRejection;
      const rejection = validateTargets(state, content, targets);
      if (rejection !== undefined) return rejection;
      applySettings(state, targets, "manual", command.frequencyRatio, command.voltageRatio);
    },
  });
}
