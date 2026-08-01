import { createContext } from "react";

export interface BranchContextValue {
  onBranch: (sourceId: string, seed: string, mountAncestors: boolean, titleCandidate?: string) => void;
  onFocusNode?: (nodeId: string, opts?: { flash?: boolean }) => void;
}

// 由 Canvas 提供、被每个 ChatThreadNode 消费。
// 用户在节点里划选文字并点「从这里展开」时调用，带上来源节点 id 与片段文本。
export const BranchContext = createContext<BranchContextValue | null>(null);
