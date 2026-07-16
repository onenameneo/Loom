import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasNodeDto } from "../env";
import { IconRefresh } from "../icons";
import { ChatThreadNode } from "./ChatThreadNode";
import { BranchContext } from "./branch";

const nodeTypes = { chatThread: ChatThreadNode };
const defaultEdgeOptions = { type: "default" as const };

const ROOT_X = 240;
const ROOT_Y = 48;
const CARD_W = 360;
const NODE_H = 440; // 卡片默认高度（更高；可经 NodeResizer 拖拽改）
const GAP_X = 150; // 父子之间的水平间距（子节点在父的右侧，拉开距离）
const ROW_H = 300; // 兄弟/叶子之间的纵向间距（配合更高的卡片）

// 从左到右生长的树布局：子节点在父的右侧、拉开水平距离；兄弟节点纵向错开，
// 父节点纵向对齐到其子节点的中点。位置是纯 renderer 关注点（图存储不落盘位置）。
function layout(dtos: CanvasNodeDto[]): Record<string, { x: number; y: number }> {
  const byId = new Set(dtos.map((d) => d.id));
  const childrenOf = new Map<string, CanvasNodeDto[]>();
  const roots: CanvasNodeDto[] = [];
  for (const d of dtos) {
    if (d.parentId && byId.has(d.parentId)) {
      (childrenOf.get(d.parentId) ?? childrenOf.set(d.parentId, []).get(d.parentId)!).push(d);
    } else {
      roots.push(d);
    }
  }
  const pos: Record<string, { x: number; y: number }> = {};
  let cursorY = ROOT_Y;
  const place = (node: CanvasNodeDto, depth: number) => {
    const x = ROOT_X + depth * (CARD_W + GAP_X);
    const kids = childrenOf.get(node.id) ?? [];
    if (kids.length === 0) {
      pos[node.id] = { x, y: cursorY };
      cursorY += ROW_H;
      return;
    }
    for (const k of kids) place(k, depth + 1);
    const ys = kids.map((k) => pos[k.id].y);
    pos[node.id] = { x, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  for (const r of roots) place(r, 0);
  return pos;
}

function toNode(
  dto: CanvasNodeDto,
  pos: { x: number; y: number },
  fallbackModel?: string,
  fresh = false,
  actions?: Record<string, unknown>,
): Node {
  return {
    id: dto.id,
    type: "chatThread",
    position: pos,
    dragHandle: ".card__head", // 只有标题栏可拖，正文/输入框正常交互
    style: { width: CARD_W, height: NODE_H },
    data: {
      workspaceId: dto.workspaceId,
      parentId: dto.parentId,
      title: dto.title,
      seed: dto.seed,
      messages: dto.messages,
      mountAncestors: dto.mountAncestors,
      systemPrompt: dto.systemPrompt,
      model: dto.model || fallbackModel,
      fresh,
      isRoot: !dto.parentId,
      ...actions,
    },
  };
}

function edgesFrom(dtos: CanvasNodeDto[]): Edge[] {
  return dtos
    .filter((d) => d.parentId)
    .map((d) => ({
      id: `e-${d.parentId}-${d.id}`,
      source: d.parentId!,
      target: d.id,
      label: d.seed ? (d.seed.text.length > 14 ? `${d.seed.text.slice(0, 14)}…` : d.seed.text) : undefined,
    }));
}

function classNames(...items: Array<string | false | null | undefined>) {
  const value = items.filter(Boolean).join(" ");
  return value || undefined;
}

export default function Canvas({
  workspaceId,
  model,
  isDark,
  focusNodeId,
  onFocused,
  onTreeChange,
}: {
  workspaceId: string;
  model?: string;
  isDark: boolean;
  focusNodeId?: string | null;
  onFocused?: () => void;
  onTreeChange?: () => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const titleRef = useRef(new Map<string, string>());
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const pathIds = useCallback((targetId: string) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    let current = byId.get(targetId);
    while (current) {
      nodeIds.add(current.id);
      const parentId = (current.data as any)?.parentId;
      if (!parentId || !byId.has(parentId)) break;
      edgeIds.add(`e-${parentId}-${current.id}`);
      current = byId.get(parentId);
    }
    return { nodeIds, edgeIds };
  }, [nodes]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, string[]>();
    const ids = new Set(nodes.map((n) => n.id));
    for (const node of nodes) {
      const parentId = (node.data as any)?.parentId;
      if (typeof parentId === "string" && ids.has(parentId)) {
        (map.get(parentId) ?? map.set(parentId, []).get(parentId)!).push(node.id);
      }
    }
    return map;
  }, [nodes]);

  const descendantCounts = useMemo(() => {
    const count = new Map<string, number>();
    const visit = (id: string): number => {
      const kids = childrenOf.get(id) ?? [];
      const total = kids.reduce((sum, childId) => sum + 1 + visit(childId), 0);
      count.set(id, total);
      return total;
    };
    for (const node of nodes) visit(node.id);
    return count;
  }, [childrenOf, nodes]);

  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    const mark = (id: string) => {
      for (const childId of childrenOf.get(id) ?? []) {
        hidden.add(childId);
        mark(childId);
      }
    };
    for (const id of collapsed) mark(id);
    return hidden;
  }, [childrenOf, collapsed]);

  const ancestorIds = useCallback(
    (id: string) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const ids: string[] = [];
      let current = byId.get(id);
      while (current) {
        const parentId = (current.data as any)?.parentId;
        if (!parentId || !byId.has(parentId)) break;
        ids.push(parentId);
        current = byId.get(parentId);
      }
      return ids;
    },
    [nodes],
  );

  const onToggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedNodeId = useMemo(
    () => nodes.find((n) => n.selected)?.id ?? null,
    [nodes],
  );

  const highlightTargetId = selectedNodeId ?? hoverId;
  const highlightPath = useMemo(
    () => (highlightTargetId ? pathIds(highlightTargetId) : null),
    [highlightTargetId, pathIds],
  );

  const displayNodes = useMemo<Node[]>(
    () =>
      nodes.filter((node) => !hiddenNodeIds.has(node.id)).map((node) => {
        const onPath = highlightPath?.nodeIds.has(node.id) ?? false;
        const dimmed = Boolean(highlightPath) && !onPath;
        const collapsedCount = descendantCounts.get(node.id) ?? 0;
        return {
          ...node,
          data: {
            ...node.data,
            hasChildren: collapsedCount > 0,
            isTreeCollapsed: collapsed.has(node.id),
            collapsedCount,
            onToggleCollapse,
          },
          className: classNames(
            node.className,
            onPath && "is-onpath",
            dimmed && "is-dimmed",
            flashId === node.id && "is-flash",
          ),
        };
      }),
    [collapsed, descendantCounts, flashId, hiddenNodeIds, highlightPath, nodes, onToggleCollapse],
  );

  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.filter((edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target)).map((edge) => {
        const onPath = highlightPath?.edgeIds.has(edge.id) ?? false;
        const dimmed = Boolean(highlightPath) && !onPath;
        return {
          ...edge,
          className: classNames(edge.className, onPath && "is-onpath", dimmed && "is-dimmed"),
        };
      }),
    [edges, hiddenNodeIds, highlightPath],
  );

  const removeIds = useCallback(
    (ids: string[]) => {
      const dead = new Set(ids);
      setNodes((nds) => nds.filter((n) => !dead.has(n.id)));
      setEdges((eds) => eds.filter((e) => !dead.has(e.source) && !dead.has(e.target)));
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      for (const id of ids) titleRef.current.delete(id);
    },
    [setNodes, setEdges],
  );

  const focusNode = useCallback(
    (id: string, opts?: { flash?: boolean }) => {
      const collapsedAncestors = ancestorIds(id).filter((ancestorId) => collapsed.has(ancestorId));
      if (collapsedAncestors.length) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const ancestorId of collapsedAncestors) next.delete(ancestorId);
          return next;
        });
      }
      setNodes((nds) => {
        const target = nds.find((n) => n.id === id);
        if (target && flowRef.current) {
          flowRef.current.setCenter(target.position.x + CARD_W / 2, target.position.y + 120, {
            zoom: 1,
            duration: 260,
          });
        }
        return nds.map((n) => ({ ...n, selected: n.id === id }));
      });
      if (opts?.flash) {
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        setFlashId(id);
        flashTimerRef.current = window.setTimeout(() => {
          setFlashId((current) => (current === id ? null : current));
          flashTimerRef.current = null;
        }, 1200);
      }
    },
    [ancestorIds, collapsed, setNodes],
  );

  useEffect(
    () => () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const actions = useCallback(
    () => ({
      onTreeChange,
      onSelect: (id: string) => {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      },
      onRename: async (id: string, title: string) => {
        if (window.api) await window.api.canvas.update(id, { title });
        titleRef.current.set(id, title);
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n)),
        );
        onTreeChange?.();
      },
      onDelete: async (id: string) => {
        if (!confirm("删除这个分支及其后代？")) return;
        if (window.api) {
          const r = await window.api.canvas.delete(id);
          if (r.ok) removeIds(r.deletedIds);
        } else {
          removeIds([id]);
        }
        onTreeChange?.();
      },
    }),
    [onTreeChange, removeIds, setNodes],
  );

  // 载入（或初始化）本会话的节点树
  useEffect(() => {
    let alive = true;
    (async () => {
      let dtos: CanvasNodeDto[] = [];
      if (window.api) {
        // 原子「打开」：主进程串行处理，避免 StrictMode 双挂载建出两个根。
        dtos = await window.api.canvas.open(workspaceId);
      } else {
        // 浏览器预览：本地起一条主线，画布仍可渲染
        dtos = [{ id: "root", workspaceId, title: "主线", mountAncestors: false, messages: [] }];
      }
      if (!alive) return;
      const pos = layout(dtos);
      titleRef.current = new Map(dtos.map((d) => [d.id, d.title]));
      const nodeActions = actions();
      setNodes(dtos.map((d) => toNode(d, pos[d.id] ?? { x: ROOT_X, y: ROOT_Y }, model, false, nodeActions)));
      setEdges(edgesFrom(dtos));
    })();
    return () => {
      alive = false;
    };
  }, [workspaceId, model, setNodes, setEdges, actions]);

  useEffect(() => {
    if (!focusNodeId) return;
    focusNode(focusNodeId);
    onFocused?.();
  }, [focusNode, focusNodeId, onFocused]);

  const onBranch = useCallback(
    async (sourceId: string, seedText: string) => {
      const from = titleRef.current.get(sourceId) ?? "";
      const seed = { text: seedText, from, parent: sourceId };
      let id: string;
      if (window.api) {
        const dto = await window.api.canvas.create({ workspaceId, parentId: sourceId, seed });
        id = dto.id;
      } else {
        id = `local_${Math.round(performance.now())}`;
      }
      titleRef.current.set(id, "新分支");
      const nodeActions = actions();
      setNodes((nds) => {
        const src = nds.find((n) => n.id === sourceId);
        const baseX = src ? src.position.x : ROOT_X;
        const baseY = src ? src.position.y : ROOT_Y;
        const siblings = nds.filter((n) => (n.data as any)?.seed?.parent === sourceId).length;
        const newNode: Node = {
          id,
          type: "chatThread",
          dragHandle: ".card__head",
          style: { width: CARD_W, height: NODE_H },
          // 出现在来源节点的右侧、拉开距离；多个兄弟纵向错开
          position: { x: baseX + CARD_W + GAP_X, y: baseY + siblings * ROW_H },
          data: {
            workspaceId,
            parentId: sourceId,
            title: "新分支",
            seed,
            messages: [],
            mountAncestors: false,
            model,
            fresh: true,
            isRoot: false,
            ...nodeActions,
          },
        };
        return nds.concat(newNode);
      });
      const label = seedText.length > 14 ? `${seedText.slice(0, 14)}…` : seedText;
      setEdges((eds) => eds.concat({ id: `e-${sourceId}-${id}`, source: sourceId, target: id, label }));
      onTreeChange?.();
    },
    [workspaceId, model, setNodes, setEdges, actions, onTreeChange],
  );

  const tidyLayout = useCallback(() => {
    const dtos = nodes.map((node) => ({
      id: node.id,
      workspaceId: String((node.data as any)?.workspaceId ?? workspaceId),
      parentId: (node.data as any)?.parentId,
      title: String((node.data as any)?.title ?? ""),
      seed: (node.data as any)?.seed,
      mountAncestors: Boolean((node.data as any)?.mountAncestors),
      systemPrompt: (node.data as any)?.systemPrompt,
      model: (node.data as any)?.model,
      messages: ((node.data as any)?.messages ?? []) as CanvasNodeDto["messages"],
    }));
    const pos = layout(dtos);
    setNodes((nds) => nds.map((node) => ({ ...node, position: pos[node.id] ?? node.position })));
  }, [nodes, setNodes, workspaceId]);

  const branchContext = useMemo(() => ({ onBranch, onFocusNode: focusNode }), [focusNode, onBranch]);

  return (
    <BranchContext.Provider value={branchContext}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeMouseEnter={(_, node) => setHoverId(node.id)}
        onNodeMouseLeave={() => setHoverId(null)}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-right" className="canvas-tools">
          <button className="canvas-tool-btn nodrag" type="button" onClick={tidyLayout} title="整理布局">
            <IconRefresh size={14} /> 整理布局
          </button>
        </Panel>
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1}
          color={isDark ? "rgba(255,255,255,0.07)" : "rgba(28,26,20,0.10)"}
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={() => (isDark ? "rgba(51,156,255,0.55)" : "rgba(1,105,204,0.45)")}
          nodeStrokeWidth={0}
          maskColor={isDark ? "rgba(24,24,24,0.7)" : "rgba(233,232,228,0.6)"}
          style={{ background: isDark ? "#202020" : "#ffffff", borderRadius: 12, border: "1px solid var(--border)" }}
        />
      </ReactFlow>
    </BranchContext.Provider>
  );
}
