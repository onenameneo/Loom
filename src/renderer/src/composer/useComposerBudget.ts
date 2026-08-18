import { useEffect, useRef, useState } from "react";
import type { ComposerBudgetPreviewInput } from "../../../common/composerBudget";
import type { NodeBudget } from "../env";

export function useComposerBudget(
  nodeId: string,
  preview: ComposerBudgetPreviewInput,
  refreshKey = "",
) {
  const [budget, setBudget] = useState<NodeBudget | null>(null);
  const [pending, setPending] = useState(false);
  const revisionRef = useRef(0);

  useEffect(() => {
    const revision = ++revisionRef.current;
    const timer = window.setTimeout(() => {
      const api = window.api?.canvas;
      if (!api?.budget) {
        setPending(false);
        return;
      }
      setPending(true);
      void api.budget(nodeId, preview).then((next) => {
        if (revision !== revisionRef.current) return;
        setBudget(next);
      }).catch(() => {
        if (revision === revisionRef.current) setBudget((current) => current);
      }).finally(() => {
        if (revision === revisionRef.current) setPending(false);
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [nodeId, preview, refreshKey]);

  return { budget, pending };
}
