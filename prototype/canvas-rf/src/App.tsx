import { useCallback, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { ChatThreadNode } from "./nodes/ChatThreadNode";
import { BranchContext } from "./branch";
import { initialEdges, initialNodes } from "./data";

const nodeTypes = { chatThread: ChatThreadNode };
const defaultEdgeOptions = { type: "default" as const }; // stroke comes from CSS var

/* thin line icons (stroke=currentColor) */
const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l.9-4.5A8 8 0 1 1 21 12Z" />
  </svg>
);
const IconCanvas = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="7" height="6" rx="1.4" />
    <rect x="14" y="14" width="7" height="6" rx="1.4" />
    <path d="M10 7h4a2 2 0 0 1 2 2v5" />
  </svg>
);
const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
);
const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

function Sidebar({
  theme,
  onToggle,
}: {
  theme: "light" | "dark";
  onToggle: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span className="sb-mark" />
        <span className="sb-word">
          Canvas<small>思考工作台</small>
        </span>
      </div>

      <div className="sb-item">
        <IconChat />
        对话
      </div>
      <div className="sb-item active">
        <IconCanvas />
        画布
      </div>
      <div className="sb-item">
        <IconEye />
        观察哨
        <span className="badge" title="1 个 agent 运行中" />
      </div>
      <div className="sb-item">
        <IconSearch />
        搜索
      </div>

      <div className="sb-label">工作区</div>
      <div className="sb-ws">
        <span className="sq" style={{ background: "var(--accent)" }} />
        理解 Transformer
      </div>
      <div className="sb-ws">
        <span className="sq" style={{ background: "var(--warn)" }} />
        freqtrade 策略研究
      </div>
      <div className="sb-ws">
        <span className="sq" style={{ background: "var(--ok)" }} />
        ETF 因子笔记
      </div>

      <div className="sb-foot">
        <span className="sb-ava" />
        <span className="sb-name">
          Neo
          <small>本地 · pi-mono</small>
        </span>
        <button
          className="theme-toggle"
          onClick={onToggle}
          title={theme === "light" ? "切到暗色" : "切到亮色"}
        >
          {theme === "light" ? <IconMoon /> : <IconSun />}
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const idRef = useRef(1);
  const isDark = theme === "dark";

  const onBranch = useCallback(
    (sourceId: string, seedText: string) => {
      const id = `n${idRef.current++}`;
      setNodes((nds) => {
        const src = nds.find((n) => n.id === sourceId);
        const baseX = src ? src.position.x : 200;
        const baseY = src ? src.position.y : 200;
        const siblings = nds.filter(
          (n) => (n.data as any)?.seed?.parent === sourceId,
        ).length;
        const newNode = {
          id,
          type: "chatThread",
          position: { x: baseX + 40 + siblings * 56, y: baseY + 392 },
          data: {
            title: "新分支",
            model: "opus-4.8",
            seed: {
              text: seedText,
              from: (src?.data as any)?.title ?? "",
              parent: sourceId,
            },
            messages: [],
            fresh: true,
          },
        };
        return nds.concat(newNode as any);
      });
      const label = seedText.length > 14 ? `${seedText.slice(0, 14)}…` : seedText;
      setEdges((eds) =>
        eds.concat({ id: `e-${sourceId}-${id}`, source: sourceId, target: id, label }),
      );
    },
    [setNodes, setEdges],
  );

  return (
    <div className="app" data-theme={theme}>
      <div className="wallpaper" />
      <Sidebar theme={theme} onToggle={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />
      <main className="main">
        <BranchContext.Provider value={onBranch}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.22 }}
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
              nodeColor={() => (isDark ? "rgba(111,181,171,0.55)" : "rgba(47,111,104,0.5)")}
              nodeStrokeWidth={0}
              maskColor={isDark ? "rgba(10,11,13,0.7)" : "rgba(233,232,228,0.6)"}
              style={{
                background: isDark ? "#141619" : "#ffffff",
                borderRadius: 12,
                border: "1px solid var(--border)",
              }}
            />
          </ReactFlow>
        </BranchContext.Provider>
      </main>
    </div>
  );
}
