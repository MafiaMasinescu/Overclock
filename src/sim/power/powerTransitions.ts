import type { ModuleInstanceState, ModulePowerDeliveryState } from "../core/types.ts";

export function applyPowerOperationalTransitions(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  deliveries: Readonly<Record<string, ModulePowerDeliveryState>>,
): Record<string, ModuleInstanceState> {
  const transitioned: Record<string, ModuleInstanceState> = {};
  for (const moduleId of Object.keys(modules).toSorted()) {
    const module = modules[moduleId];
    const delivery = deliveries[moduleId];
    if (module?.id !== moduleId || delivery === undefined) {
      throw new Error("Power transition records must cover matching module IDs.");
    }
    const next = { ...module };
    if (module.operationalState === "shutdown") {
      transitioned[moduleId] = next;
      continue;
    }
    if (
      delivery.requestedPowerWatts > 0 &&
      delivery.deliveredPowerWatts < delivery.minimumPowerWatts
    ) {
      next.operationalState = "brownout";
      transitioned[moduleId] = next;
      continue;
    }
    if (module.startupTicksRemaining > 0) {
      next.startupTicksRemaining = module.startupTicksRemaining - 1;
      next.operationalState = next.startupTicksRemaining === 0 ? "online" : "starting";
    } else {
      next.operationalState = "online";
    }
    transitioned[moduleId] = next;
  }
  return transitioned;
}
