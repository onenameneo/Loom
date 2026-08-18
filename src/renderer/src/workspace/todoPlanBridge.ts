import type { CanvasEvent, TodoPlanEventPayload, TodoPlanSnapshot } from "../env";
import { useWorkspaceStore } from "./store";

type TodoPlanApi = {
  onEvent?: (listener: (event: CanvasEvent) => void) => () => void;
};

export function connectTodoPlanBridge(api: TodoPlanApi, store: Pick<typeof useWorkspaceStore, "getState"> = useWorkspaceStore) {
  let active = true;
  if (!api.onEvent) return () => { active = false; };
  const unsubscribe = api.onEvent((event) => {
    if (!active || event.type !== "todo" || !event.payload || typeof event.payload !== "object") return;
    const payload = event.payload as TodoPlanEventPayload;
    if (payload.snapshot?.nodeId) store.getState().applyTodoPlan(payload);
  });
  return () => { active = false; unsubscribe(); };
}
