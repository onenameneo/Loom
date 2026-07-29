import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("piEngine hook contract", () => {
  it("keeps approval behavior behind the generic beforeToolCall dispatcher path", () => {
    const src = readFileSync(join(process.cwd(), "src/main/agent/adapters/piEngine.ts"), "utf-8");

    expect(src).toContain("beforeToolCall");
    expect(src).toContain("dispatcher.toolCall");
    expect(src).toContain("turnId: getCurrentTurnId?.(nodeId)");
    expect(src).not.toMatch(/approvalGate|ApprovalBroker|approval policy|createApproval/i);
  });

  it("captures each completed assistant message so tool-call decisions appear in trace", () => {
    const src = readFileSync(join(process.cwd(), "src/main/agent/adapters/piEngine.ts"), "utf-8");

    expect(src).toContain('case "message_end"');
    expect(src).toContain('captureTrace?.(nodeId, "response", { message: event.message })');
    expect(src).not.toContain("[...(agent.state.messages as AgentMessage[])].reverse()");
  });
});
