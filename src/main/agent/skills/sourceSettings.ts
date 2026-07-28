import { shell } from "electron";
import { existsSync, realpathSync } from "fs";
import { resolve } from "path";
import type { Store } from "../../store/store";

function normalizePath(path: string): string {
  const clean = path.trim();
  if (!clean) throw new Error("Path is required.");
  return existsSync(clean) ? realpathSync(clean) : resolve(clean);
}

export function addGlobalSkillSource(store: Store, path: string) {
  const root = normalizePath(path);
  const current = store.getSettings().skills?.globalSources ?? [];
  store.patchSettings({ skills: { globalSources: [...new Set([...current, root])] } });
  return { ok: true, path: root };
}

export function removeGlobalSkillSource(store: Store, path: string) {
  const root = normalizePath(path);
  const current = store.getSettings().skills?.globalSources ?? [];
  store.patchSettings({ skills: { globalSources: current.filter((item) => normalizePath(item) !== root) } });
  return { ok: true, path: root };
}

export async function openSkillSource(path: string) {
  const root = normalizePath(path);
  const error = await shell.openPath(root);
  return { ok: !error, path: root, error: error || undefined };
}
