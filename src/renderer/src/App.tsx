import { useCallback, useEffect, useState } from "react";
import type { SettingsPayload, WorkspaceMeta } from "./env";
import Sidebar from "./Sidebar";
import { SURFACES, type SurfaceCtx } from "./surfaces";

export default function App() {
  const [activeSurface, setActiveSurface] = useState("workspace");
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const reloadSettings = useCallback(async () => {
    if (!window.api) {
      // 浏览器预览（无 Electron 桥）：用假数据渲染外壳
      setSettings({
        access: { provider: "anthropic", baseUrl: "", model: "" },
        appearance: { theme: "light", density: "comfortable" },
        sources: { baseUrl: "default", model: "default", key: "none" },
        hasKey: false,
        encryptionAvailable: true,
        resolvedModel: "claude-sonnet-4-5",
        resolvedTheme: "light",
      });
      setTheme("light");
      return;
    }
    const s = await window.api.settings.get();
    setSettings(s);
    setTheme(s.resolvedTheme);
  }, []);

  const reloadWorkspaces = useCallback(async () => {
    if (!window.api) {
      const demo: WorkspaceMeta[] = [
        { id: "ws_demo", name: "理解 Transformer", createdAt: 0, updatedAt: 0, pinned: true, order: 0 },
        { id: "ws_demo2", name: "freqtrade 策略研究", createdAt: 0, updatedAt: 0, pinned: false, order: 1 },
      ];
      setWorkspaces(demo);
      setActiveWorkspaceId((cur) => cur ?? demo[0].id);
      return demo;
    }
    const list = await window.api.workspaces.list();
    setWorkspaces(list);
    setActiveWorkspaceId((cur) => cur ?? list[0]?.id ?? null);
    return list;
  }, []);

  useEffect(() => {
    reloadSettings();
    reloadWorkspaces();
  }, [reloadSettings, reloadWorkspaces]);

  const createWorkspace = useCallback(async () => {
    if (!window.api) return;
    const ws = await window.api.workspaces.create();
    await reloadWorkspaces();
    setActiveWorkspaceId(ws.id);
    setActiveSurface("workspace");
  }, [reloadWorkspaces]);

  // 原生菜单动作
  useEffect(() => {
    if (!window.api) return;
    return window.api.onMenu((action) => {
      if (action === "new-workspace") createWorkspace();
      else if (action === "settings") setActiveSurface("settings");
      else if (action === "surface:workspace") setActiveSurface("workspace");
      else if (action === "surface:observatory") setActiveSurface("observatory");
    });
  }, [createWorkspace]);

  const toggleTheme = useCallback(async () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (!window.api) return;
    await window.api.settings.set({ appearance: { theme: next } });
    reloadSettings();
  }, [theme, reloadSettings]);

  const ctx: SurfaceCtx = {
    workspaces,
    activeWorkspaceId,
    createWorkspace,
    goSettings: () => setActiveSurface("settings"),
    settings,
    reloadSettings,
    theme,
    focusNodeId,
    clearFocusNode: () => setFocusNodeId(null),
    treeVersion,
    bumpTreeVersion: () => setTreeVersion((v) => v + 1),
  };

  const Active = SURFACES.find((s) => s.id === activeSurface) ?? SURFACES[0];

  return (
    <div className="app" data-theme={theme}>
      <div className="wallpaper" />
      <Sidebar
        activeSurface={activeSurface}
        setSurface={setActiveSurface}
        ctx={ctx}
        onSelectWorkspace={(id) => {
          setActiveWorkspaceId(id);
          setFocusNodeId(null);
        }}
        onFocusNode={(workspaceId, nodeId) => {
          setActiveWorkspaceId(workspaceId);
          setActiveSurface("workspace");
          setFocusNodeId(nodeId);
        }}
        onCreateWorkspace={createWorkspace}
        onRenameWorkspace={async (id, name) => {
          await window.api.workspaces.rename(id, name);
          reloadWorkspaces();
        }}
        onDeleteWorkspace={async (id) => {
          await window.api.workspaces.delete(id);
          setActiveWorkspaceId((cur) => (cur === id ? null : cur));
          reloadWorkspaces();
        }}
        onPinWorkspace={async (id, pinned) => {
          await window.api.workspaces.pin(id, pinned);
          reloadWorkspaces();
        }}
        theme={theme}
        toggleTheme={toggleTheme}
        settings={settings}
      />
      <main className="main">
        <Active.Panel ctx={ctx} />
      </main>
    </div>
  );
}
