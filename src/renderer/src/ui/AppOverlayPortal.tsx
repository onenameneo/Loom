import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AppOverlayPortal({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("app-overlay-root"),
  );

  useLayoutEffect(() => {
    if (!root) setRoot(document.getElementById("app-overlay-root"));
  }, [root]);

  return root ? createPortal(children, root) : null;
}
