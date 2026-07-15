import { useCallback, useEffect, useState } from "react";
import type { CanvasNodeDto } from "../env";
import Canvas from "./Canvas";
import ChatView from "./ChatView";

// 工作区主视图：对话优先、按需成画布。
//   · 只有根节点（无分支）→ 居中聊天视图（ChatView）。
//   · 划词岔出第一个分支，或手动「展开画布」→ 切成 React Flow 画布（Canvas）。
// 两个视图共用 window.api.canvas；root 节点消息主进程有镜像，切换不丢历史。
export default function Workspace({
  workspaceId,
  workspaceName,
  model,
  isDark,
  noKey,
  goSettings,
}: {
  workspaceId: string;
  workspaceName: string;
  model?: string;
  isDark: boolean;
  noKey: boolean;
  goSettings: () => void;
}) {
  const [root, setRoot] = useState<CanvasNodeDto | null>(null);
  const [nodeCount, setNodeCount] = useState(1);
  const [forceCanvas, setForceCanvas] = useState(false);

  const reload = useCallback(async () => {
    let dtos: CanvasNodeDto[];
    if (window.api) dtos = await window.api.canvas.open(workspaceId);
    else dtos = [{ id: "root", title: "根节点", mountAncestors: false, messages: [] }];
    setRoot(dtos.find((d) => !d.parentId) ?? dtos[0] ?? null);
    setNodeCount(dtos.length);
  }, [workspaceId]);

  useEffect(() => {
    setForceCanvas(false);
    reload();
  }, [workspaceId, reload]);

  const isCanvas = forceCanvas || nodeCount > 1;

  const branchFromChat = useCallback(
    async (seedText: string) => {
      if (!root) return;
      if (window.api) {
        await window.api.canvas.create({
          workspaceId,
          parentId: root.id,
          seed: { text: seedText, from: workspaceName, parent: root.id },
        });
      }
      setForceCanvas(true); // 切到画布；Canvas 会自行 open 载入 root+新分支
    },
    [root, workspaceId, workspaceName],
  );

  return (
    <div className="surface-fill">
      <div className="surface-head">
        <span className="ws-title">{workspaceName}</span>
        <span className="ws-mode mono">{isCanvas ? "画布" : "对话"}</span>
        {!isCanvas && (
          <button className="head-btn" onClick={() => setForceCanvas(true)} title="把这段对话摊到无限画布上">
            展开画布
          </button>
        )}
        {noKey && (
          <button className="chip-warn" onClick={goSettings}>
            未配置 API key · 去设置
          </button>
        )}
      </div>
      {isCanvas || !root ? (
        <div className="canvas-wrap">
          <Canvas workspaceId={workspaceId} model={model} isDark={isDark} />
        </div>
      ) : (
        <ChatView nodeId={root.id} initialMessages={root.messages} onBranch={branchFromChat} />
      )}
    </div>
  );
}
