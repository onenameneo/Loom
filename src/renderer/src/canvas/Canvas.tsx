import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  type ResizeParams,
  type NodeChange,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasNodeDto } from "../env";
import { useTitlebarActions } from "../titlebar/Titlebar";
import { CanvasTitlebarActions, CanvasZoomControls } from "./CanvasControls";
import { useCanvasLayoutStore } from "./CanvasLayoutContext";
import { ChatThreadNode } from "./ChatThreadNode";
import { BranchContext } from "./branch";
import { applyTidyPositions, readNodeLayout, resolveNodeLayout } from "./layout";
import { finishResizeInteraction, guardResizeNodeChanges } from "./resizeLifecycle";
import { ResizeSession } from "./resizeSession";

const nodeTypes = { chatThread: ChatThreadNode };
const defaultEdgeOptions = { type: "default" as const };

const ROOT_X = 240;
const ROOT_Y = 48;
const CARD_W = 360;
const NODE_H = 440; // 卡片默认高度（更高；可经 NodeResizer 拖拽改）
const GAP_X = 150; // 父子之间的水平间距（子节点在父的右侧，拉开距离）
const ROW_H = 300; // 兄弟/叶子之间的纵向间距（配合更高的卡片）

function viewportDuration() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
}

type CanvasInteraction =
  | { kind: "idle" }
  | { kind: "dragging"; nodeId: string }
  | { kind: "resizing"; nodeId: string };

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
  dirtyLayout?: { x: number; y: number; width: number; height: number },
): Node {
  const resolved = resolveNodeLayout(
    dto,
    { x: pos.x, y: pos.y, width: CARD_W, height: NODE_H },
    dirtyLayout,
  );
  return {
    id: dto.id,
    type: "chatThread",
    position: { x: resolved.x, y: resolved.y },
    dragHandle: ".card__head", // 只有标题栏可拖，正文/输入框正常交互
    style: { width: resolved.width, height: resolved.height },
    data: {
      workspaceId: dto.workspaceId,
      parentId: dto.parentId,
      title: dto.title,
      seed: dto.seed,
      messages: dto.messages,
      mountAncestors: dto.mountAncestors,
      systemPrompt: dto.systemPrompt,
      model: dto.model || fallbackModel,
      color: dto.color,
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
  focusNodeId,
  onFocused,
  onTreeChange,
}: {
  workspaceId: string;
  model?: string;
  focusNodeId?: string | null;
  onFocused?: () => void;
  onTreeChange?: () => void;
}) {
  const [nodes, setNodes, applyNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: "idle" });
  const [zoom, setZoom] = useState(1);
  const titleRef = useRef(new Map<string, string>());
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const treeChangeRef = useRef(onTreeChange);
  const modelRef = useRef(model);
  const layoutStore = useCanvasLayoutStore();
  const resizeSessionRef = useRef(new ResizeSession());
  treeChangeRef.current = onTreeChange;
  modelRef.current = model;

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      applyNodesChange(guardResizeNodeChanges(changes, resizeSessionRef.current));
    },
    [applyNodesChange],
  );

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

  // 路径高亮只跟随 hover（探索性）；选中只显示光晕，不淡化其他节点——
  // 否则选一个节点会把整条祖先链点亮，看起来像“多选”。
  const highlightTargetId = interaction.kind === "idle" ? hoverId : null;
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
            interaction.kind === "dragging" && interaction.nodeId === node.id && "is-dragging",
            interaction.kind === "resizing" && interaction.nodeId === node.id && "is-resizing",
          ),
        };
      }),
    [collapsed, descendantCounts, flashId, hiddenNodeIds, highlightPath, interaction, nodes, onToggleCollapse],
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
      layoutStore.remove(workspaceId, ids);
    },
    [layoutStore, setNodes, setEdges, workspaceId],
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

  const applyResizeLayout = useCallback(
    (id: string, next: ResizeParams) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                position: { x: next.x, y: next.y },
                style: { ...node.style, width: next.width, height: next.height },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  useEffect(() => {
    const cancelResize = () => {
      const cancelled = resizeSessionRef.current.cancel();
      if (cancelled) {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === cancelled.nodeId
              ? {
                  ...node,
                  position: { x: cancelled.layout.x, y: cancelled.layout.y },
                  style: {
                    ...node.style,
                    width: cancelled.layout.width,
                    height: cancelled.layout.height,
                  },
                  data: { ...node.data, resizeControlEpoch: cancelled.token },
                }
              : node,
          ),
        );
        layoutStore.enqueue(workspaceId, cancelled.nodeId, cancelled.layout);
      }
      setInteraction({ kind: "idle" });
    };
    window.addEventListener("blur", cancelResize);
    return () => {
      window.removeEventListener("blur", cancelResize);
      cancelResize();
    };
  }, [layoutStore, setNodes, workspaceId]);

  const actions = useCallback(
    () => ({
      onTreeChange: () => treeChangeRef.current?.(),
      onSelect: (id: string) => {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      },
      onResizeStart: (id: string, params: ResizeParams) =>
        resizeSessionRef.current.start(id, params),
      shouldResize: (id: string, token: number) =>
        resizeSessionRef.current.accepts(token, id),
      onResize: (id: string, token: number, params: ResizeParams) => {
        const next = resizeSessionRef.current.update(token, id, params);
        if (next) {
          applyResizeLayout(id, next);
          setInteraction({ kind: "resizing", nodeId: id });
          return;
        }
        const recovered = resizeSessionRef.current.recover(token, id);
        if (recovered) applyResizeLayout(id, recovered);
      },
      onResizeEnd: (id: string, token: number, params: ResizeParams) => {
        const next = finishResizeInteraction({
          session: resizeSessionRef.current,
          token,
          nodeId: id,
          layout: params,
          apply: applyResizeLayout,
          enqueue: (nodeId, layout) => layoutStore.enqueue(workspaceId, nodeId, layout),
        });
        if (!next) {
          const recovered = resizeSessionRef.current.recover(token, id);
          if (recovered) applyResizeLayout(id, recovered);
          return;
        }
        setInteraction({ kind: "idle" });
      },
      onRename: async (id: string, title: string) => {
        if (window.api) await window.api.canvas.update(id, { title });
        titleRef.current.set(id, title);
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n)),
        );
        treeChangeRef.current?.();
      },
      onSetColor: async (id: string, color: string) => {
        if (window.api) await window.api.canvas.update(id, { color });
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, color: color || undefined } } : n)),
        );
      },
      onDelete: async (id: string) => {
        if (!confirm("删除这个分支及其后代？")) return;
        if (window.api) {
          const r = await window.api.canvas.delete(id);
          if (r.ok) removeIds(r.deletedIds);
        } else {
          removeIds([id]);
        }
        treeChangeRef.current?.();
      },
    }),
    [applyResizeLayout, layoutStore, removeIds, setNodes, workspaceId],
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
      setNodes(
        dtos.map((d) =>
          toNode(
            d,
            pos[d.id] ?? { x: ROOT_X, y: ROOT_Y },
            modelRef.current,
            false,
            nodeActions,
            layoutStore.getDirty(workspaceId, d.id),
          ),
        ),
      );
      setEdges(edgesFrom(dtos));
    })();
    return () => {
      alive = false;
    };
  }, [workspaceId, setNodes, setEdges, actions, layoutStore]);

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
      const src = nodes.find((n) => n.id === sourceId);
      const baseX = src ? src.position.x : ROOT_X;
      const baseY = src ? src.position.y : ROOT_Y;
      const siblings = nodes.filter((n) => (n.data as any)?.seed?.parent === sourceId).length;
      const initialLayout = {
        x: baseX + CARD_W + GAP_X,
        y: baseY + siblings * ROW_H,
        width: CARD_W,
        height: NODE_H,
      };
      setNodes((nds) => {
        const newNode: Node = {
          id,
          type: "chatThread",
          dragHandle: ".card__head",
          style: { width: initialLayout.width, height: initialLayout.height },
          // 出现在来源节点的右侧、拉开距离；多个兄弟纵向错开
          position: { x: initialLayout.x, y: initialLayout.y },
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
      layoutStore.enqueue(workspaceId, id, initialLayout);
      const label = seedText.length > 14 ? `${seedText.slice(0, 14)}…` : seedText;
      setEdges((eds) => eds.concat({ id: `e-${sourceId}-${id}`, source: sourceId, target: id, label }));
      treeChangeRef.current?.();
    },
    [workspaceId, model, nodes, setNodes, setEdges, actions, layoutStore],
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
    setNodes((nds) => {
      const tidied = applyTidyPositions(nds, pos);
      layoutStore.enqueueMany(
        workspaceId,
        tidied.map((node) => ({ id: node.id, layout: readNodeLayout(node) })),
      );
      return tidied;
    });
  }, [nodes, setNodes, workspaceId, layoutStore]);

  const titlebarCallbacksRef = useRef({ onFit: () => {}, onTidy: () => {} });
  titlebarCallbacksRef.current.onFit = () => {
    void flowRef.current?.fitView({ padding: 0.28, maxZoom: 1, duration: viewportDuration() });
  };
  titlebarCallbacksRef.current.onTidy = tidyLayout;
  const titlebarActions = useMemo(
    () => (
      <CanvasTitlebarActions
        onFit={() => titlebarCallbacksRef.current.onFit()}
        onTidy={() => titlebarCallbacksRef.current.onTidy()}
      />
    ),
    [],
  );
  useTitlebarActions(titlebarActions);

  const branchContext = useMemo(() => ({ onBranch, onFocusNode: focusNode }), [focusNode, onBranch]);

  return (
    <BranchContext.Provider value={branchContext}>
      <ReactFlow
        className={classNames(
          "loom-canvas",
          interaction.kind === "dragging" && "is-dragging",
          interaction.kind === "resizing" && "is-resizing",
        )}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={interaction.kind !== "resizing"}
        panOnDrag={interaction.kind !== "resizing"}
        onPaneClick={() => {
          setNodes((nds) => nds.map((node) => (node.selected ? { ...node, selected: false } : node)));
        }}
        onNodeMouseEnter={(_, node) => setHoverId(node.id)}
        onNodeMouseLeave={() => setHoverId(null)}
        onNodeDragStart={(_, node) => {
          setInteraction({ kind: "dragging", nodeId: node.id });
        }}
        onNodeDragStop={(_, node) => {
          layoutStore.enqueue(workspaceId, node.id, readNodeLayout(node));
          setInteraction({ kind: "idle" });
        }}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasZoomControls
          zoom={zoom}
          onZoomOut={() => void flowRef.current?.zoomOut({ duration: viewportDuration() })}
          onZoomIn={() => void flowRef.current?.zoomIn({ duration: viewportDuration() })}
          onResetZoom={() => void flowRef.current?.zoomTo(1, { duration: viewportDuration() })}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1}
          color="var(--canvas-dot)"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => (node.selected ? "var(--accent)" : "var(--minimap-node)")}
          nodeStrokeWidth={0}
          maskColor="var(--minimap-mask)"
        />
      </ReactFlow>
    </BranchContext.Provider>
  );
}
