import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Pin, Trash2 } from "lucide-react";
import type { CanvasNodeDto, SettingsPayload, WorkspaceMeta } from "./env";
import { IconMoon, IconPlus, IconSun } from "./icons";
import { SURFACES, type SurfaceCtx } from "./surfaces";
import { ConfirmDialog, RenameDialog, Tip } from "./ui/dialogs";

// 由某会话的节点列表推导「主线→分支」的缩进行（父子关系，深度优先）。
function outlineRows(nodes: CanvasNodeDto[]): Array<{ node: CanvasNodeDto; depth: number }> {
  const byParent = new Map<string | undefined, CanvasNodeDto[]>();
  for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const rows: Array<{ node: CanvasNodeDto; depth: number }> = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      rows.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

export default function Sidebar({
  activeSurface,
  setSurface,
  ctx,
  onSelectWorkspace,
  onFocusNode,
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
  onFocusNode: (workspaceId: string, nodeId: string) => void;
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
  // 每个会话独立展开：expanded 记哪些会话展开，outlines 存各自的节点列表。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [outlines, setOutlines] = useState<Record<string, CanvasNodeDto[]>>({});

  // 活跃会话自动展开（切到它时把它的树打开）
  useEffect(() => {
    if (ctx.activeWorkspaceId) {
      setExpanded((prev) => (prev.has(ctx.activeWorkspaceId!) ? prev : new Set(prev).add(ctx.activeWorkspaceId!)));
    }
  }, [ctx.activeWorkspaceId]);

  // 为所有「已展开」的会话拉取各自的节点（树变化时 treeVersion 触发重取）
  useEffect(() => {
    if (!window.api || activeSurface !== "workspace") return;
    let alive = true;
    const ids = [...expanded];
    Promise.all(
      ids.map((id) => window.api!.canvas.list(id).then((nodes) => [id, nodes] as const)),
    ).then((entries) => {
      if (alive) setOutlines(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [expanded, activeSurface, ctx.treeVersion]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span className="sb-mark" />
        <span className="sb-word">
          Loom<small>思考工作台</small>
        </span>
        <Tip label="切换明暗">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? <IconMoon /> : <IconSun />}
          </button>
        </Tip>
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
            会话
            <Tip label="新建会话 (⌘N)">
              <button className="sb-add" onClick={onCreateWorkspace}>
                <IconPlus />
              </button>
            </Tip>
          </div>
          {ctx.workspaces.length === 0 && <div className="sb-hint">（还没有，点 + 新建）</div>}
          {ctx.workspaces.map((w: WorkspaceMeta) => {
            const isExp = expanded.has(w.id);
            const rows = isExp ? outlineRows(outlines[w.id] ?? []) : [];
            return (
              <Fragment key={w.id}>
                <div
                  className={`sb-ws ${ctx.activeWorkspaceId === w.id ? "active" : ""}`}
                  onClick={() => onSelectWorkspace(w.id)}
                  onDoubleClick={() => setRenaming(w)}
                >
                  <button
                    className="sb-ws-chev"
                    title={isExp ? "收起" : "展开分支"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(w.id);
                    }}
                  >
                    {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
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
                {isExp && rows.length > 0 && (
                  <div className="sb-outline">
                    {rows.map(({ node, depth }) => (
                      <button
                        key={node.id}
                        className="sb-branch"
                        style={{ paddingLeft: 30 + depth * 14 }}
                        onClick={() => onFocusNode(w.id, node.id)}
                        title={node.title}
                      >
                        <span className="branch-dot" />
                        <span>{depth === 0 ? "主线" : node.title || "分支"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
        </>
      )}

      <RenameDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="重命名会话"
        initial={renaming?.name ?? ""}
        onSubmit={(name) => renaming && onRenameWorkspace(renaming.id, name)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除会话「${deleting?.name ?? ""}」？`}
        description="此操作不可撤销。"
        onConfirm={() => {
          if (deleting) onDeleteWorkspace(deleting.id);
          setDeleting(null);
        }}
      />
    </aside>
  );
}
