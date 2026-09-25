import { useCallback, useRef, useSyncExternalStore } from "react";

import type { GameClient } from "./contracts.ts";
import type { GameClientStore, StoreState } from "./store.ts";
import type { GridViewModel, UiSnapshot } from "../../sim/selectors/presentationTypes.ts";

export function useGameClientSnapshot(client: GameClient) {
  const lastSnapshot = useRef<UiSnapshot | null>(null);
  const getSnapshot = useCallback((): UiSnapshot | null => {
    try {
      lastSnapshot.current = client.getSnapshot();
    } catch {
      // Keep the last accepted publication while an epoch transition awaits READY.
    }
    return lastSnapshot.current;
  }, [client]);
  return useSyncExternalStore((listener) => client.subscribe(listener), getSnapshot, getSnapshot);
}

// Store-backed hooks (Task 18.3). Selectors must return stable references
// (the named selectors in selectors.ts do); derived per-render values
// would defeat useSyncExternalStore caching.
export function useStoreSelector<T>(
  store: GameClientStore,
  selector: (state: StoreState) => T,
  equality: (left: T, right: T) => boolean = Object.is,
): T {
  return useSyncExternalStore(
    (onChange) => {
      const subscription = store.select(
        selector,
        () => {
          onChange();
        },
        equality,
      );
      return () => {
        subscription.unsubscribe();
      };
    },
    () => {
      return store.select(selector).value;
    },
    () => {
      return store.select(selector).value;
    },
  );
}

export function useStoreSnapshot(store: GameClientStore): UiSnapshot | null {
  return useStoreSelector(store, (state) => state.snapshot);
}

export function useStoreGridViewModel(store: GameClientStore): GridViewModel | null {
  return useStoreSelector(store, (state) => state.grid);
}
