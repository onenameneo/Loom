import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type ReactFlowInstance,
  type ResizeParams,
  type NodeChange,
  useEdgesState,
  useNodesState,
  useStoreApi,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasNodeDto, ModelSelection } from "../env";
import { useTitlebarActions } from "../titlebar/Titlebar";
import { CanvasTitlebarActions, CanvasZoomControls } from "./CanvasControls";
import { useCanvasLayoutPersistence, useCanvasLayoutStore } from "./CanvasLayoutContext";
import { ChatThreadNode } from "./ChatThreadNode";
import { BranchContext } from "./branch";
import { applyTidyPositions, findBranchPlacement, readNodeLayout, resolveNodeLayout } from "./layout";
import { finishResizeInteraction, guardResizeNodeChanges } from "./resizeLifecycle";
import { ResizeSession } from "./resizeSession";
import { branchTitleFromCandidates, DEFAULT_BRANCH_TITLE, DEFAULT_ROOT_TITLE } from "../../../common/titleDefaults";

const nodeTypes = { chatThread: ChatThreadNode };
const defaultEdgeOptions = { type: "default" as const };
const proOptions = { hideAttribution: true };

const ROOT_X = 240;
const ROOT_Y = 48;
const CARD_W = 360;
const NODE_H = 440; // 卡片默认高度（更高；可经 NodeResizer 拖拽改）
const GAP_X = 150; // 父子之间的水平间距（子节点在父的右侧，拉开距离）
const ROW_H = 520; // 兄弟/叶子之间的纵向间距（默认卡片高 440，留出阅读和工具条空间）
const READABLE_FIT_ZOOM = 0.82;

function viewportDuration() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
}

function latestUserPrompt(node: Node | undefined): string {
  const messages = ((node?.data as any)?.messages ?? []) as CanvasNodeDto["messages"];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user" && messages[i].text.trim()) return messages[i].text;
  }
  return "";
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
  fallbackModel?: ModelSelection,
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
      sessionId: dto.sessionId,
      projectId: dto.projectId,
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

type CanvasProps = {
  sessionId: string;
  model?: ModelSelection;
  focusNodeId?: string | null;
  onSelectedNode?: (nodeId: string | null) => void;
  onReturnChat?: (nodeId: string) => void;
  onTreeChange?: () => void;
};

export default function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasContent {...props} />
    </ReactFlowProvider>
  );
}

function CanvasContent({
  sessionId,
  model,
  focusNodeId,
  onSelectedNode,
  onReturnChat,
  onTreeChange,
}: CanvasProps) {
  const [nodes, setNodes, applyNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: "idle" });
  const interactionRef = useRef<CanvasInteraction>({ kind: "idle" });
  const [zoom, setZoom] = useState(1);
  const titleRef = useRef(new Map<string, string>());
  const flashTimerRef = useRef<number | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const pendingZoomRef = useRef(1);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ id: string; next: ResizeParams } | null>(null);
  const displayNodeCacheRef = useRef(
    new Map<
      string,
      {
        source: Node;
        dataSource: Node["data"];
        hasChildren: boolean;
        isTreeCollapsed: boolean;
        collapsedCount: number;
        className?: string;
        display: Node;
      }
    >(),
  );
  const treeChangeRef = useRef(onTreeChange);
  const modelRef = useRef(model);
  const layoutStore = useCanvasLayoutStore();
  const layoutPersistence = useCanvasLayoutPersistence(sessionId);
  const resizeSessionRef = useRef(new ResizeSession());
  const flowStore = useStoreApi<Node, Edge>();
  treeChangeRef.current = onTreeChange;
  modelRef.current = model;

  const setCanvasInteraction = useCallback((next: CanvasInteraction) => {
    interactionRef.current = next;
    setInteraction(next);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const guarded = guardResizeNodeChanges(changes, resizeSessionRef.current);
      if (interactionRef.current.kind === "dragging") {
        const current = flowStore.getState().nodes;
        flowStore.getState().setNodes(applyNodeChanges(guarded, current));
        return;
      }
      applyNodesChange(guarded);
    },
    [applyNodesChange, flowStore],
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
        const dimmed = Boolean(highlightPath) && !onPath && !node.selected;
        const collapsedCount = descendantCounts.get(node.id) ?? 0;
        const isResizing = interaction.kind === "resizing" && interaction.nodeId === node.id;
        const className = classNames(
          node.className,
          node.selected && "is-selected",
          onPath && "is-onpath",
          dimmed && "is-dimmed",
          flashId === node.id && "is-flash",
          interaction.kind === "dragging" && interaction.nodeId === node.id && "is-dragging",
          interaction.kind === "resizing" && interaction.nodeId === node.id && "is-resizing",
        );
        const isTreeCollapsed = collapsed.has(node.id);
        const cached = displayNodeCacheRef.current.get(node.id);
        if (
          cached &&
          cached.source === node &&
          cached.hasChildren === collapsedCount > 0 &&
          cached.isTreeCollapsed === isTreeCollapsed &&
          cached.collapsedCount === collapsedCount &&
          cached.className === className
        ) {
          return cached.display;
        }
        const displayData =
          cached &&
          cached.dataSource === node.data &&
          cached.hasChildren === collapsedCount > 0 &&
          cached.isTreeCollapsed === isTreeCollapsed &&
          cached.collapsedCount === collapsedCount &&
          cached.className === className
            ? cached.display.data
            : {
                ...node.data,
                hasChildren: collapsedCount > 0,
                isTreeCollapsed,
                collapsedCount,
                isResizing,
                onToggleCollapse,
              };
        const display = {
          ...node,
          data: displayData,
          className,
        };
        displayNodeCacheRef.current.set(node.id, {
          source: node,
          dataSource: node.data,
          hasChildren: collapsedCount > 0,
          isTreeCollapsed,
          collapsedCount,
          className,
          display,
        });
        return display;
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

  // Structural changes are projected into React Flow explicitly, while the
  // engine keeps transient pointer positions in its own internal store.
  const flowRef = useRef<ReactFlowInstance | null>(null);

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
      layoutStore.remove(sessionId, ids);
    },
    [layoutStore, setNodes, setEdges, sessionId],
  );

  const focusNode = useCallback(
    (id: string, opts?: { flash?: boolean; duration?: number }) => {
      const collapsedAncestors = ancestorIds(id).filter((ancestorId) => collapsed.has(ancestorId));
      if (collapsedAncestors.length) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const ancestorId of collapsedAncestors) next.delete(ancestorId);
          return next;
        });
      }
      const target = nodes.find((node) => node.id === id);
      if (target && flowRef.current) {
        flowRef.current.setCenter(target.position.x + CARD_W / 2, target.position.y + 120, {
          zoom: 1,
          duration: opts?.duration ?? 260,
        });
      }
      setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === id })));
      if (opts?.flash) {
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        setFlashId(id);
        flashTimerRef.current = window.setTimeout(() => {
          setFlashId((current) => (current === id ? null : current));
          flashTimerRef.current = null;
        }, 1200);
      }
    },
    [ancestorIds, collapsed, nodes, setNodes],
  );

  useEffect(
    () => () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (zoomFrameRef.current) window.cancelAnimationFrame(zoomFrameRef.current);
      if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
    },
    [],
  );

  const onViewportMove = useCallback((_: unknown, viewport: { zoom: number }) => {
    pendingZoomRef.current = viewport.zoom;
    if (zoomFrameRef.current) return;
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      setZoom(pendingZoomRef.current);
    });
  }, []);

  const applyResizeLayout = useCallback(
    (id: string, next: ResizeParams) => {
      const update = (current: Node[]) => current.map((node) =>
        node.id === id
          ? {
              ...node,
              position: { x: next.x, y: next.y },
              style: { ...node.style, width: next.width, height: next.height },
            }
          : node,
      );
      if (interactionRef.current.kind === "resizing") {
        pendingResizeRef.current = { id, next };
        if (resizeFrameRef.current) return;
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          const pending = pendingResizeRef.current;
          pendingResizeRef.current = null;
          if (!pending) return;
          const store = flowStore.getState();
          store.setNodes(store.nodes.map((node) =>
            node.id === pending.id
              ? {
                  ...node,
                  position: { x: pending.next.x, y: pending.next.y },
                  style: {
                    ...node.style,
                    width: pending.next.width,
                    height: pending.next.height,
                  },
                }
              : node,
          ));
        });
        return;
      }
      setNodes(update);
    },
    [flowStore, setNodes],
  );

  useEffect(() => {
    const cancelResize = () => {
      if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
      pendingResizeRef.current = null;
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
        layoutStore.enqueue(sessionId, cancelled.nodeId, cancelled.layout);
      }
      setCanvasInteraction({ kind: "idle" });
    };
    window.addEventListener("blur", cancelResize);
    return () => {
      window.removeEventListener("blur", cancelResize);
      cancelResize();
    };
  }, [layoutStore, setCanvasInteraction, setNodes, sessionId]);

  const actions = useCallback(
    () => ({
      onTreeChange: () => treeChangeRef.current?.(),
      onSelect: (id: string) => {
        setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === id })));
      },
      onResizeStart: (id: string, params: ResizeParams) =>
        resizeSessionRef.current.start(id, params),
      shouldResize: (id: string, token: number) =>
        resizeSessionRef.current.accepts(token, id),
      onResize: (id: string, token: number, params: ResizeParams) => {
        const next = resizeSessionRef.current.update(token, id, params);
        if (next) {
          applyResizeLayout(id, next);
          setCanvasInteraction({ kind: "resizing", nodeId: id });
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
          enqueue: (nodeId, layout) => layoutStore.enqueue(sessionId, nodeId, layout),
        });
        if (!next) {
          const recovered = resizeSessionRef.current.recover(token, id);
          if (recovered) applyResizeLayout(id, recovered);
          return;
        }
        if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
        pendingResizeRef.current = null;
        setNodes((nds) => nds.map((node) =>
          node.id === id
            ? {
                ...node,
                position: { x: next.x, y: next.y },
                style: { ...node.style, width: next.width, height: next.height },
              }
            : node,
        ));
        setCanvasInteraction({ kind: "idle" });
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
      onReturnChat: (id: string) => onReturnChat?.(id),
    }),
    [applyResizeLayout, layoutStore, onReturnChat, removeIds, setNodes, sessionId],
  );

  // 载入（或初始化）本会话的节点树
  useEffect(() => {
    let alive = true;
    (async () => {
      let dtos: CanvasNodeDto[] = [];
      if (window.api) {
        // 原子「打开」：主进程串行处理，避免 StrictMode 双挂载建出两个根。
        dtos = await window.api.canvas.open(sessionId);
      } else {
        // 浏览器预览：本地起一个根节点，画布仍可渲染
        dtos = [{ id: "root", sessionId, projectId: "project_demo", title: DEFAULT_ROOT_TITLE, mountAncestors: false, messages: [] }];
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
            layoutStore.getDirty(sessionId, d.id),
          ),
        ),
      );
      setEdges(edgesFrom(dtos));
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, setNodes, setEdges, actions, layoutStore]);

  // 进入画布时的取景：把主节点（root）或指定聚焦节点以 1:1(100%) 居中，
  // 而不是缩放到能装下整棵树——多节点时那样每张卡片都太小。首帧瞬时定位（不动画），
  // 之后来自侧栏等的显式聚焦请求再带平移动画。
  const didInitialFrameRef = useRef(false);
  const lastFramedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!flowRef.current || nodes.length === 0) return;

    if (!didInitialFrameRef.current) {
      if (focusNodeId) {
        if (!nodes.some((n) => n.id === focusNodeId)) return; // 等指定节点载入再取景
        didInitialFrameRef.current = true;
        lastFramedRef.current = focusNodeId;
        focusNode(focusNodeId, { duration: 0 });
      } else {
        const root = nodes.find((n) => (n.data as { isRoot?: boolean })?.isRoot) ?? nodes[0];
        didInitialFrameRef.current = true;
        flowRef.current.setCenter(root.position.x + CARD_W / 2, root.position.y + 120, {
          zoom: 1,
          duration: 0,
        });
      }
      return;
    }

    // 首帧之后的显式聚焦：只在 focusNodeId 真正变化时平移过去，避免流式更新触发抖动。
    if (focusNodeId && focusNodeId !== lastFramedRef.current && nodes.some((n) => n.id === focusNodeId)) {
      lastFramedRef.current = focusNodeId;
      focusNode(focusNodeId);
    }
  }, [nodes, focusNodeId, focusNode]);

  const onBranch = useCallback(
    async (sourceId: string, seedText: string, mountAncestors: boolean, titleCandidate?: string) => {
      const from = titleRef.current.get(sourceId) ?? "";
      const src = nodes.find((n) => n.id === sourceId);
      const branchTitle = branchTitleFromCandidates({
        selectedText: titleCandidate ?? seedText,
        currentPrompt: latestUserPrompt(src),
        fallback: DEFAULT_BRANCH_TITLE,
      });
      const seed = { text: seedText, from, parent: sourceId };
      let id: string;
      let createdDto: CanvasNodeDto | undefined;
      if (window.api) {
        const dto = await window.api.canvas.create({ sessionId, parentId: sourceId, seed, title: branchTitle, mountAncestors });
        id = dto.id;
        createdDto = dto;
      } else {
        id = `local_${Math.round(performance.now())}`;
      }
      const title = createdDto?.title ?? branchTitle;
      titleRef.current.set(id, title);
      const nodeActions = actions();
      const baseX = src ? src.position.x : ROOT_X;
      const baseY = src ? src.position.y : ROOT_Y;
      const siblings = nodes.filter((n) => (n.data as any)?.seed?.parent === sourceId).length;
      const preferredLayout = {
        x: baseX + CARD_W + GAP_X,
        y: baseY + siblings * ROW_H,
        width: CARD_W,
        height: NODE_H,
      };
      const initialLayout = findBranchPlacement({
        existing: nodes.map(readNodeLayout),
        preferred: preferredLayout,
        gapX: GAP_X,
        rowH: ROW_H,
      });
      setNodes((nds) => {
        const newNode = toNode(
          createdDto ?? {
            id,
            sessionId,
            projectId: String((src?.data as any)?.projectId ?? "project_demo"),
            parentId: sourceId,
            title,
            seed,
            messages: [],
            mountAncestors,
            model,
          },
          { x: initialLayout.x, y: initialLayout.y },
          model,
          true,
          nodeActions,
          initialLayout,
        );
        return nds.concat(newNode);
      });
      layoutStore.enqueue(sessionId, id, initialLayout);
      const label = seedText.length > 14 ? `${seedText.slice(0, 14)}…` : seedText;
      setEdges((eds) => eds.concat({ id: `e-${sourceId}-${id}`, source: sourceId, target: id, label }));
      treeChangeRef.current?.();
    },
    [sessionId, model, nodes, setNodes, setEdges, actions, layoutStore],
  );

  const tidyLayout = useCallback(() => {
    const dtos = nodes.map((node) => ({
      id: node.id,
      sessionId: String((node.data as any)?.sessionId ?? sessionId),
      projectId: String((node.data as any)?.projectId ?? "project_demo"),
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
        sessionId,
        tidied.map((node) => ({ id: node.id, layout: readNodeLayout(node) })),
      );
      return tidied;
    });
  }, [nodes, setNodes, sessionId, layoutStore]);

  const titlebarCallbacksRef = useRef({ onFit: () => {}, onTidy: () => {} });
  titlebarCallbacksRef.current.onFit = () => {
    void flowRef.current?.fitView({
      padding: 0.28,
      minZoom: READABLE_FIT_ZOOM,
      maxZoom: 1,
      duration: viewportDuration(),
    });
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

  // React Flow calls these handlers during high-frequency pointer updates.
  // Keep their identities stable so a controlled drag does not also look like
  // a complete prop configuration change to React Flow.
  const onPaneClick = useCallback(() => {
    setNodes((nds) => nds.map((node) => (node.selected ? { ...node, selected: false } : node)));
    onSelectedNode?.(null);
  }, [onSelectedNode, setNodes]);
  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setNodes((current) => current.map((candidate) => ({
      ...candidate,
      selected: candidate.id === node.id,
    })));
    onSelectedNode?.(node.id);
  }, [onSelectedNode, setNodes]);
  const onNodeMouseEnter = useCallback((_: unknown, node: Node) => {
    if (interactionRef.current.kind === "dragging") return;
    setHoverId(node.id);
  }, []);
  const onNodeMouseLeave = useCallback(() => {
    if (interactionRef.current.kind === "dragging") return;
    setHoverId(null);
  }, []);
  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    setCanvasInteraction({ kind: "dragging", nodeId: node.id });
  }, [setCanvasInteraction]);
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    layoutStore.enqueue(sessionId, node.id, readNodeLayout(node));
    setNodes((current) => current.map((candidate) => (
      candidate.id === node.id
        ? { ...candidate, position: node.position }
        : candidate
    )));
    setCanvasInteraction({ kind: "idle" });
  }, [layoutStore, sessionId, setCanvasInteraction, setNodes]);
  return (
    <BranchContext.Provider value={branchContext}>
      {layoutPersistence.error && (
        <div
          className="canvas-layout-notice nodrag"
          role="status"
          aria-label="布局保存状态"
        >
          <span>布局尚未保存</span>
          <button
            type="button"
            className="canvas-layout-retry"
            onClick={() => void layoutPersistence.retry()}
            aria-label="重试保存布局"
          >
            重试
          </button>
        </div>
      )}
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
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        selectionOnDrag={false}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        onMove={onViewportMove}
        defaultEdgeOptions={defaultEdgeOptions}
        minZoom={0.55}
        maxZoom={1.6}
        onlyRenderVisibleElements
        proOptions={proOptions}
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
