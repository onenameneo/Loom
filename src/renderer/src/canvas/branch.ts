import { createContext } from "react";

// 由 Canvas 提供、被每个 ChatThreadNode 消费。
// 用户在节点里划选文字并点「岔出分支」时调用，带上来源节点 id 与片段文本。
export const BranchContext = createContext<
  ((sourceId: string, seed: string) => void) | null
>(null);
