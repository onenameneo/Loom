import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
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
const CARD_W = 344;
const GAP_X = 150; // 父子之间的水平间距（子节点在父的右侧，拉开距离）
const ROW_H = 240; // 兄弟/叶子之间的纵向间距

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

function toNode(dto: CanvasNodeDto, pos: { x: number; y: number }, model?: string, fresh = false): Node {
  return {
    id: dto.id,
    type: "chatThread",
    position: pos,
    dragHandle: ".card__head", // 只有标题栏可拖，正文/输入框正常交互
    data: { title: dto.title, seed: dto.seed, messages: dto.messages, mountAncestors: dto.mountAncestors, model, fresh },
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
}: {
  workspaceId: string;
  model?: string;
  isDark: boolean;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const titleRef = useRef(new Map<string, string>());

  // 载入（或初始化）本工作区的节点树
  useEffect(() => {
    let alive = true;
    (async () => {
      let dtos: CanvasNodeDto[] = [];
      if (window.api) {
        // 原子「打开」：主进程串行处理，避免 StrictMode 双挂载建出两个根。
        dtos = await window.api.canvas.open(workspaceId);
      } else {
        // 浏览器预览：本地起一个根节点，画布仍可渲染
        dtos = [{ id: "root", title: "根节点", mountAncestors: false, messages: [] }];
      }
      if (!alive) return;
      const pos = layout(dtos);
      titleRef.current = new Map(dtos.map((d) => [d.id, d.title]));
      setNodes(dtos.map((d) => toNode(d, pos[d.id] ?? { x: ROOT_X, y: ROOT_Y }, model)));
      setEdges(edgesFrom(dtos));
    })();
    return () => {
      alive = false;
    };
  }, [workspaceId, model, setNodes, setEdges]);

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
      setNodes((nds) => {
        const src = nds.find((n) => n.id === sourceId);
        const baseX = src ? src.position.x : ROOT_X;
        const baseY = src ? src.position.y : ROOT_Y;
        const siblings = nds.filter((n) => (n.data as any)?.seed?.parent === sourceId).length;
        const newNode: Node = {
          id,
          type: "chatThread",
          dragHandle: ".card__head",
          // 出现在来源节点的右侧、拉开距离；多个兄弟纵向错开
          position: { x: baseX + CARD_W + GAP_X, y: baseY + siblings * ROW_H },
          data: { title: "新分支", seed, messages: [], mountAncestors: false, model, fresh: true },
        };
        return nds.concat(newNode);
      });
      const label = seedText.length > 14 ? `${seedText.slice(0, 14)}…` : seedText;
      setEdges((eds) => eds.concat({ id: `e-${sourceId}-${id}`, source: sourceId, target: id, label }));
    },
    [workspaceId, model, setNodes, setEdges],
  );

  return (
    <BranchContext.Provider value={onBranch}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
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
