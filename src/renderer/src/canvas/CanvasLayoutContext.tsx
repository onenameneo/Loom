import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CanvasLayoutStore, type LayoutPersistenceState } from "./layoutStore";

const CanvasLayoutContext = createContext<CanvasLayoutStore | null>(null);

export function CanvasLayoutProvider({ children }: { children: ReactNode }) {
  const [store] = useState(
    () =>
      new CanvasLayoutStore({
        updateLayouts: async (items) => {
          if (!window.api) return { ok: true, updatedIds: items.map((item) => item.id) };
          return window.api.canvas.updateLayouts(items);
        },
      }),
  );
  return <CanvasLayoutContext.Provider value={store}>{children}</CanvasLayoutContext.Provider>;
}

export function useCanvasLayoutStore(): CanvasLayoutStore {
  const store = useContext(CanvasLayoutContext);
  if (!store) throw new Error("useCanvasLayoutStore must be used within CanvasLayoutProvider");
  return store;
}

export type CanvasLayoutPersistence = LayoutPersistenceState & {
  retry: () => Promise<void>;
};

export function useCanvasLayoutPersistence(sessionId: string): CanvasLayoutPersistence {
  const store = useCanvasLayoutStore();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(sessionId, listener),
    [store, sessionId],
  );
  const getSnapshot = useCallback(
    () => store.getPersistenceState(sessionId),
    [store, sessionId],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const retry = useCallback(() => store.retry(sessionId), [store, sessionId]);

  return useMemo(() => ({ ...state, retry }), [retry, state]);
}
