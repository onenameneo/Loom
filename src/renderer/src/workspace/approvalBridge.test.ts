import { describe, expect, it, vi } from "vitest";
import type { ApprovalCenterEvent, ApprovalRequestPayload } from "../env";
import { resetWorkspaceStore, useWorkspaceStore } from "./store";
import { connectApprovalBridge } from "./approvalBridge";

const request = (revision: number): ApprovalRequestPayload => ({
  requestId: "r1", nodeId: "n1", turnId: "t1", toolCallId: "tc1", toolName: "write", target: "src/a.ts",
  preview: { title: "Write src/a.ts" }, defaultScope: "once", createdAt: 1, expiresAt: 100, revision,
});

describe("approval bridge", () => {
  it("subscribes before replaying and preserves a newer live removal", async () => {
    resetWorkspaceStore();
    let listener!: (event: ApprovalCenterEvent) => void;
    let resolveList!: (items: ApprovalRequestPayload[]) => void;
    const list = new Promise<ApprovalRequestPayload[]>((resolve) => { resolveList = resolve; });
    const api = {
      onApproval: vi.fn((next: (event: ApprovalCenterEvent) => void) => { listener = next; return vi.fn(); }),
      listApprovals: vi.fn(() => list),
    };

    const stop = connectApprovalBridge(api);
    listener({ type: "upsert", request: request(1) });
    listener({ type: "remove", requestId: "r1", revision: 2 });
    resolveList([request(1)]);
    await list;
    await Promise.resolve();

    expect(useWorkspaceStore.getState().approvalsById.r1).toBeUndefined();
    expect(api.onApproval).toHaveBeenCalledOnce();
    stop();
  });
});
