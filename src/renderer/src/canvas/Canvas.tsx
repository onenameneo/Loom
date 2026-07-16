import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasNodeDto } from "../env";
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
  const titleRef = useRef(new Map<string, string>());
  const flowRef = useRef<ReactFlowInstance | null>(null);

  const removeIds = useCallback(
    (ids: string[]) => {
      const dead = new Set(ids);
      setNodes((nds) => nds.filter((n) => !dead.has(n.id)));
      setEdges((eds) => eds.filter((e) => !dead.has(e.source) && !dead.has(e.target)));
      for (const id of ids) titleRef.current.delete(id);
    },
    [setNodes, setEdges],
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
    setNodes((nds) => {
      const target = nds.find((n) => n.id === focusNodeId);
      if (target && flowRef.current) {
        flowRef.current.setCenter(target.position.x + CARD_W / 2, target.position.y + 120, {
          zoom: 1,
          duration: 260,
        });
      }
      return nds.map((n) => ({ ...n, selected: n.id === focusNodeId }));
    });
    onFocused?.();
  }, [focusNodeId, onFocused, setNodes]);

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

  return (
    <BranchContext.Provider value={onBranch}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
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
