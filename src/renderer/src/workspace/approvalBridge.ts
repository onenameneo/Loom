import type { ApprovalCenterEvent, ApprovalRequestPayload } from "../env";
import { useWorkspaceStore } from "./store";

type ApprovalApi = {
  listApprovals: () => Promise<ApprovalRequestPayload[]>;
  onApproval: (listener: (event: ApprovalCenterEvent) => void) => () => void;
};

export function connectApprovalBridge(
  api: ApprovalApi,
  store: Pick<typeof useWorkspaceStore, "getState"> = useWorkspaceStore,
) {
  let active = true;
  const unsubscribe = api.onApproval((event) => {
    if (active) store.getState().applyApproval(event);
  });
  void api.listApprovals().then((requests) => {
    if (active) store.getState().hydrateApprovals(requests);
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
