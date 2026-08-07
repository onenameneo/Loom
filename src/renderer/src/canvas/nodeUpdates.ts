import type { CanvasNodeDto } from "../env";

// 画布、侧栏和对话视图各自持有渲染缓存。节点元数据变更后用这个同窗口事件
// 立即同步缓存；持久化仍然只经由主进程 IPC。
const NODE_UPDATED_EVENT = "loom:node-updated";

export type NodeUpdate = Pick<CanvasNodeDto, "id" | "sessionId"> &
  Partial<Pick<CanvasNodeDto, "title" | "color">>;

export function publishNodeUpdate(update: NodeUpdate) {
  window.dispatchEvent(new CustomEvent<NodeUpdate>(NODE_UPDATED_EVENT, { detail: update }));
}

export function subscribeNodeUpdates(listener: (update: NodeUpdate) => void) {
  const onUpdate = (event: Event) => listener((event as CustomEvent<NodeUpdate>).detail);
  window.addEventListener(NODE_UPDATED_EVENT, onUpdate);
  return () => window.removeEventListener(NODE_UPDATED_EVENT, onUpdate);
}
