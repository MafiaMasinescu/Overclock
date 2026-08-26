import type { ModuleInstanceState, ModulePowerDeliveryState } from "../core/types.ts";

export function applyPowerOperationalTransitions(
  modules: Readonly<Record<string, ModuleInstanceState>>,
  deliveries: Readonly<Record<string, ModulePowerDeliveryState>>,
  stableModuleIds?: readonly string[],
  inputUsesStableModuleOrder = false,
): Record<string, ModuleInstanceState> {
  const currentModuleIds = inputUsesStableModuleOrder ? stableModuleIds : Object.keys(modules);
  if (currentModuleIds === undefined) throw new Error("Power transition module IDs are missing.");
  const moduleIds = stableModuleIds ?? currentModuleIds.toSorted();
  let transitioned: Record<string, ModuleInstanceState> | undefined;
  if (
    !inputUsesStableModuleOrder &&
    currentModuleIds.some((moduleId, index) => moduleId !== moduleIds[index])
  ) {
    transitioned = {};
    for (const moduleId of moduleIds) {
      const module = modules[moduleId];
      if (module === undefined) throw new Error("Power transition module coverage is incomplete.");
      transitioned[moduleId] = module;
    }
  }
  for (const moduleId of moduleIds) {
    const module = modules[moduleId];
    const delivery = deliveries[moduleId];
    if (module?.id !== moduleId || delivery === undefined) {
      throw new Error("Power transition records must cover matching module IDs.");
    }
    let nextStartupTicksRemaining = module.startupTicksRemaining;
    if (module.operationalState === "shutdown") {
      continue;
    }
    let nextOperationalState: ModuleInstanceState["operationalState"];
    if (
      delivery.requestedPowerWatts > 0 &&
      delivery.deliveredPowerWatts < delivery.minimumPowerWatts
    ) {
      nextOperationalState = "brownout";
    } else {
      nextStartupTicksRemaining = Math.max(0, module.startupTicksRemaining - 1);
      nextOperationalState = nextStartupTicksRemaining === 0 ? "online" : "starting";
    }
    if (
      nextOperationalState !== module.operationalState ||
      nextStartupTicksRemaining !== module.startupTicksRemaining
    ) {
      transitioned ??= { ...modules };
      transitioned[moduleId] = {
        ...module,
        operationalState: nextOperationalState,
        startupTicksRemaining: nextStartupTicksRemaining,
      };
    }
  }
  return transitioned ?? modules;
}
