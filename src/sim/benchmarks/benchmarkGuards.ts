import type { CommandHandlerRejection } from "../commands/commandHandlers.ts";
import type { GameState } from "../core/types.ts";

export const BENCHMARK_CONFIGURATION_LOCKED_REJECTION = {
  code: "BENCHMARK_CONFIGURATION_LOCKED",
  messageKey: "errors.benchmark-configuration-locked",
} as const satisfies CommandHandlerRejection;

export function rejectIfBenchmarkConfigurationLocked(
  state: Readonly<GameState>,
): CommandHandlerRejection | undefined {
  return state.benchmarks.active === null ? undefined : BENCHMARK_CONFIGURATION_LOCKED_REJECTION;
}
