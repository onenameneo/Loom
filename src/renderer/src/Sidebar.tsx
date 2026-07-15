import { useState } from "react";
import { Pencil, Pin, Trash2 } from "lucide-react";
import type { SettingsPayload, WorkspaceMeta } from "./env";
import { IconMoon, IconPlus, IconSun } from "./icons";
import { SURFACES, type SurfaceCtx } from "./surfaces";
import { ConfirmDialog, RenameDialog, Tip } from "./ui/dialogs";

export default function Sidebar({
  activeSurface,
  setSurface,
  ctx,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onPinWorkspace,
  theme,
  toggleTheme,
}: {
  activeSurface: string;
  setSurface: (id: string) => void;
  ctx: SurfaceCtx;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onPinWorkspace: (id: string, pinned: boolean) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  settings?: SettingsPayload | null;
}) {
  const [renaming, setRenaming] = useState<WorkspaceMeta | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceMeta | null>(null);

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span className="sb-mark" />
        <span className="sb-word">
          Loom<small>思考工作台</small>
        </span>
      </div>

      {SURFACES.map((s) => {
        const badge = s.badge?.(ctx);
        return (
          <div
            key={s.id}
            className={`sb-item ${activeSurface === s.id ? "active" : ""}`}
            onClick={() => setSurface(s.id)}
          >
            <s.icon />
            {s.label}
            {badge != null && <span className="badge-num">{badge}</span>}
          </div>
        );
      })}

      {activeSurface === "workspace" && (
        <>
          <div className="sb-label">
            工作区
            <Tip label="新建工作区 (⌘N)">
              <button className="sb-add" onClick={onCreateWorkspace}>
                <IconPlus />
              </button>
            </Tip>
          </div>
          {ctx.workspaces.length === 0 && <div className="sb-hint">（还没有，点 + 新建）</div>}
          {ctx.workspaces.map((w: WorkspaceMeta) => (
            <div
              key={w.id}
              className={`sb-ws ${ctx.activeWorkspaceId === w.id ? "active" : ""}`}
              onClick={() => onSelectWorkspace(w.id)}
              onDoubleClick={() => setRenaming(w)}
            >
              <span className={`sq ${w.pinned ? "pinned" : ""}`} />
              <span className="ws-name">{w.name}</span>
              <span className="ws-actions">
                <Tip label={w.pinned ? "取消置顶" : "置顶"}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinWorkspace(w.id, !w.pinned);
                    }}
                  >
                    <Pin size={13} fill={w.pinned ? "currentColor" : "none"} />
                  </button>
                </Tip>
                <Tip label="重命名">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(w);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                </Tip>
                <Tip label="删除">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(w);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tip>
              </span>
            </div>
          ))}
        </>
      )}

      <div className="sb-foot">
        <span className="sb-ava" />
        <span className="sb-name">
          Neo<small>本地 · pi-mono</small>
        </span>
        <Tip label="切换明暗">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? <IconMoon /> : <IconSun />}
          </button>
        </Tip>
      </div>

      <RenameDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        initial={renaming?.name ?? ""}
        onSubmit={(name) => renaming && onRenameWorkspace(renaming.id, name)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除工作区「${deleting?.name ?? ""}」？`}
        description="此操作不可撤销。"
        onConfirm={() => {
          if (deleting) onDeleteWorkspace(deleting.id);
          setDeleting(null);
        }}
      />
    </aside>
  );
}
