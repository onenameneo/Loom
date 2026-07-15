import { createContext } from "react";

// Provided by App, consumed by each ChatThreadNode.
// Called when the user selects text inside a node and clicks "岔出新节点".
export const BranchContext = createContext<
  ((sourceId: string, seed: string) => void) | null
>(null);
