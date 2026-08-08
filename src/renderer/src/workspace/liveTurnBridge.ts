import type { LiveTurnEvent, LiveTurnSnapshot } from "../env";
import { useWorkspaceStore } from "./store";

type LiveTurnApi = {
  liveTurns: () => Promise<LiveTurnSnapshot[]>;
  onLiveTurn: (listener: (event: LiveTurnEvent) => void) => () => void;
};

type LiveTurnStore = Pick<typeof useWorkspaceStore, "getState">;

export function connectLiveTurnBridge(api: LiveTurnApi, store: LiveTurnStore = useWorkspaceStore) {
  let active = true;
  const apply = (event: LiveTurnEvent) => store.getState().applyLiveTurn(event);
  const unsubscribe = api.onLiveTurn((event) => {
    if (active) apply(event);
  });
  void api.liveTurns().then((snapshots) => {
    if (!active) return;
    for (const snapshot of snapshots) apply({ type: "upsert", snapshot });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
