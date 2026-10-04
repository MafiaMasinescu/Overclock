export interface KeyedScene {
  readonly modules: ReadonlyMap<string, string>;
  readonly routes: ReadonlyMap<string, string>;
}

interface EntityChanges {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
}

export interface SceneReconciliation {
  readonly scene: KeyedScene;
  readonly changes: {
    readonly modules: EntityChanges;
    readonly routes: EntityChanges;
  };
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reconcileEntries(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): { readonly map: Map<string, string>; readonly changes: EntityChanges } {
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  for (const [key, value] of next) {
    const oldValue = previous.get(key);
    if (oldValue === undefined) created.push(key);
    else if (oldValue !== value) updated.push(key);
  }
  for (const key of previous.keys()) {
    if (!next.has(key)) removed.push(key);
  }
  return {
    map: new Map(next),
    changes: {
      created: created.toSorted(compareKeys),
      updated: updated.toSorted(compareKeys),
      removed: removed.toSorted(compareKeys),
    },
  };
}

export function reconcileKeyedScene(previous: KeyedScene, next: KeyedScene): SceneReconciliation {
  const modules = reconcileEntries(previous.modules, next.modules);
  const routes = reconcileEntries(previous.routes, next.routes);
  return {
    scene: { modules: modules.map, routes: routes.map },
    changes: { modules: modules.changes, routes: routes.changes },
  };
}
