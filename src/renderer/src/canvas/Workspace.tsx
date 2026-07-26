import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasNodeDto } from "../env";
import { useTitlebarContext } from "../titlebar/Titlebar";
import Canvas from "./Canvas";
import ChatView from "./ChatView";

// 会话主视图：对话优先、按需成画布。
//   · 只有主线（无分支）→ 居中聊天视图（ChatView）。
//   · 划词岔出第一个分支，或手动「展开画布」→ 切成 React Flow 画布（Canvas）。
// 两个视图共用 window.api.canvas；root 节点消息主进程有镜像，切换不丢历史。
export default function Workspace({
  workspaceId,
  workspaceName,
  model,
  noKey,
  goSettings,
  focusNodeId,
  chatNodeId,
  onFocusedNode,
  onChatNodeChange,
  onModeChange,
  onTreeChange,
}: {
  workspaceId: string;
  workspaceName: string;
  model?: string;
  noKey: boolean;
  goSettings: () => void;
  focusNodeId?: string | null;
  chatNodeId?: string | null;
  onFocusedNode?: () => void;
  onChatNodeChange?: (nodeId: string | null) => void;
  onModeChange?: (mode: "chat" | "canvas") => void;
  onTreeChange?: () => void;
}) {
  const [nodeList, setNodeList] = useState<CanvasNodeDto[]>([]);
  const [nodeCount, setNodeCount] = useState(1);
  const [viewMode, setViewMode] = useState<"auto" | "chat" | "canvas">("auto");

  const reload = useCallback(async () => {
    let dtos: CanvasNodeDto[];
    if (window.api) dtos = await window.api.canvas.open(workspaceId);
    else dtos = [{ id: "root", sessionId: workspaceId, projectId: "project_demo", workspaceId, title: "主线", mountAncestors: false, messages: [] }];
    setNodeList(dtos);
    setNodeCount(dtos.length);
  }, [workspaceId]);

  useEffect(() => {
    setViewMode("auto");
    reload();
  }, [workspaceId, reload]);

  const isCanvas = viewMode === "canvas" || (viewMode === "auto" && nodeCount > 1);
  const root = nodeList.find((d) => !d.parentId) ?? nodeList[0] ?? null;
  const chatNode = nodeList.find((d) => d.id === chatNodeId) ?? root;

  useEffect(() => {
    onModeChange?.(isCanvas ? "canvas" : "chat");
  }, [isCanvas, onModeChange]);

  const titlebarContext = useMemo(
    () => ({
      title: workspaceName,
      mode: isCanvas ? ("画布" as const) : ("对话" as const),
    }),
    [isCanvas, workspaceName],
  );
  useTitlebarContext(titlebarContext);

  const expandCanvas = useCallback(() => {
    setViewMode("canvas");
  }, []);

  const returnChat = useCallback(async (nodeId?: string) => {
    onChatNodeChange?.(nodeId ?? null);
    await reload();
    setViewMode("chat");
  }, [onChatNodeChange, reload]);

  const branchFromChat = useCallback(
    async (seedText: string) => {
      if (!chatNode) return;
      if (window.api) {
        await window.api.canvas.create({
          sessionId: workspaceId,
          parentId: chatNode.id,
          seed: { text: seedText, from: chatNode.title || "主线", parent: chatNode.id },
        });
      }
      setViewMode("canvas"); // 切到画布；Canvas 会自行 open 载入 root+新分支
      onTreeChange?.();
    },
    [chatNode, workspaceId, onTreeChange],
  );

  return (
    <div className="surface-fill">
      {isCanvas || !chatNode ? (
        <div className="canvas-wrap">
          <Canvas
            workspaceId={workspaceId}
            model={model}
            focusNodeId={focusNodeId}
            onFocused={onFocusedNode}
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
