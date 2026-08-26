import { useCallback, useEffect, useState } from "react";
import type { SkillCatalogDto } from "../../env";
import type { SurfaceCtx } from "../../surfaces";

export function useSkillsCatalog(ctx: Pick<SurfaceCtx, "activeProjectId" | "reloadSettings">) {
  const [catalog, setCatalog] = useState<SkillCatalogDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!window.api?.settings?.skills) return;
    try {
      setCatalog(await window.api.settings.skills(ctx.activeProjectId ?? undefined));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [ctx.activeProjectId]);

  useEffect(() => { void reload(); }, [reload]);

  const addSource = useCallback(async (path: string) => {
    if (!window.api?.settings?.addSkillSource) return;
    await window.api.settings.addSkillSource(path);
    await ctx.reloadSettings();
    await reload();
  }, [ctx.reloadSettings, reload]);

  const removeSource = useCallback(async (path: string) => {
    if (!window.api?.settings?.removeSkillSource) return;
    await window.api.settings.removeSkillSource(path);
    await ctx.reloadSettings();
    await reload();
  }, [ctx.reloadSettings, reload]);

  return { catalog, error, reload, addSource, removeSource };
}
