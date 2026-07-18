import { createContext, useContext, useState, type ReactNode } from "react";
import { CanvasLayoutStore } from "./layoutStore";

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
