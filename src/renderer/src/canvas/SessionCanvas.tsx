import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasNodeDto, ModelSelection } from "../env";
import { useTitlebarContext } from "../titlebar/Titlebar";
import Canvas from "./Canvas";
import ChatView from "./ChatView";

// 会话主视图：对话优先、按需成画布。
//   · 只有主线（无分支）→ 居中聊天视图（ChatView）。
//   · 划词岔出第一个分支，或手动「展开画布」→ 切成 React Flow 画布（Canvas）。
// 两个视图共用 window.api.canvas；root 节点消息主进程有镜像，切换不丢历史。
export default function SessionCanvas({
  sessionId,
  sessionName,
  model,
  noKey,
  goSettings,
  activeNodeId,
  onNodeChange,
  onModeChange,
  onTreeChange,
}: {
  sessionId: string;
  sessionName: string;
  model?: ModelSelection;
  noKey: boolean;
  goSettings: () => void;
  activeNodeId?: string | null;
  onNodeChange?: (nodeId: string | null) => void;
  onModeChange?: (mode: "chat" | "canvas") => void;
  onTreeChange?: () => void;
}) {
  const [nodeList, setNodeList] = useState<CanvasNodeDto[]>([]);
  const [nodeCount, setNodeCount] = useState(1);
  const [viewMode, setViewMode] = useState<"auto" | "chat" | "canvas">("auto");

  const reload = useCallback(async () => {
    let dtos: CanvasNodeDto[];
    if (window.api) dtos = await window.api.canvas.open(sessionId);
    else dtos = [{ id: "root", sessionId, projectId: "project_demo", title: "主线", mountAncestors: false, messages: [] }];
    setNodeList(dtos);
    setNodeCount(dtos.length);
  }, [sessionId]);

  useEffect(() => {
    setViewMode("auto");
    reload();
  }, [sessionId, reload]);

  const isCanvas = viewMode === "canvas" || (viewMode === "auto" && nodeCount > 1);
  const root = nodeList.find((d) => !d.parentId) ?? nodeList[0] ?? null;
  const chatNode = nodeList.find((d) => d.id === activeNodeId) ?? root;

  useEffect(() => {
    onModeChange?.(isCanvas ? "canvas" : "chat");
  }, [isCanvas, onModeChange]);

  // 普通对话会在未选中节点时回退显示根节点；把实际渲染节点同步给共享状态，
  // 因而标题栏、侧栏、Trace 与 ChatView 始终使用同一个 node id。
  useEffect(() => {
    if (!isCanvas && chatNode && activeNodeId !== chatNode.id) onNodeChange?.(chatNode.id);
  }, [isCanvas, chatNode, activeNodeId, onNodeChange]);

  const titlebarContext = useMemo(
    () => ({
      title: sessionName,
      mode: isCanvas ? ("画布" as const) : ("对话" as const),
    }),
    [isCanvas, sessionName],
  );
  useTitlebarContext(titlebarContext);

  const expandCanvas = useCallback(() => {
    setViewMode("canvas");
  }, []);

  const returnChat = useCallback(async (nodeId?: string) => {
    onNodeChange?.(nodeId ?? null);
    await reload();
    setViewMode("chat");
  }, [onNodeChange, reload]);

  const branchFromChat = useCallback(
    async (seedText: string, mountAncestors: boolean) => {
      if (!chatNode) return;
      if (window.api) {
        await window.api.canvas.create({
          sessionId: sessionId,
          parentId: chatNode.id,
          seed: { text: seedText, from: chatNode.title || "主线", parent: chatNode.id },
          mountAncestors,
        });
      }
      setViewMode("canvas"); // 切到画布；Canvas 会自行 open 载入 root+新分支
      onTreeChange?.();
    },
    [chatNode, sessionId, onTreeChange],
  );

  return (
    <div className="surface-fill">
      {isCanvas || !chatNode ? (
        <div className="canvas-wrap">
          <Canvas
            sessionId={sessionId}
            model={model}
            focusNodeId={activeNodeId}
            onFocused={() => onNodeChange?.(null)}
            onSelectedNode={onNodeChange}
            onReturnChat={returnChat}
            onTreeChange={onTreeChange}
          />
        </div>
      ) : (
        <ChatView
          nodeId={chatNode.id}
          initialMessages={chatNode.messages}
          initialMount={chatNode.mountAncestors}
          systemPrompt={chatNode.systemPrompt}
          model={chatNode.model || model}
          onBranch={branchFromChat}
          onExpandCanvas={expandCanvas}
          noKey={noKey}
          goSettings={goSettings}
        />
      )}
    </div>
  );
}
