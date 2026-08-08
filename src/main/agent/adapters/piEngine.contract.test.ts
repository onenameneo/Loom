import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { summarizeAssistantResponse } from "./piEngine";

describe("piEngine hook contract", () => {
  it("keeps approval behavior behind the generic beforeToolCall dispatcher path", () => {
    const src = readFileSync(join(process.cwd(), "src/main/agent/adapters/piEngine.ts"), "utf-8");

    expect(src).toContain("beforeToolCall");
    expect(src).toContain("dispatcher.toolCall");
    expect(src).toContain("turnId: getCurrentTurnId?.(nodeId)");
    expect(src).not.toMatch(/approvalGate|ApprovalBroker|approval policy|createApproval/i);
  });

  it("ends the pending llm_call span on each completed assistant message", () => {
    const src = readFileSync(join(process.cwd(), "src/main/agent/adapters/piEngine.ts"), "utf-8");

    expect(src).toContain('case "message_end"');
    expect(src).toContain('trace?.endSpan(nodeId, pendingLlmSpanId, {');
    expect(src).not.toContain("[...(agent.state.messages as AgentMessage[])].reverse()");
  });

  it("captures the LLM request message array instead of the whole context object", () => {
    const src = readFileSync(join(process.cwd(), "src/main/agent/adapters/piEngine.ts"), "utf-8");

    expect(src).toContain("messages: summarizeMessages(context.messages)");
    expect(src).not.toContain("messages: context,");
    expect(src).not.toContain("detail: event");
  });

  it("bounds the completed pi assistant message before it is added to llm_call end attributes", () => {
    const response = summarizeAssistantResponse({
      role: "assistant",
      content: [{ type: "text", text: "x".repeat(700) }, { type: "image", data: "private-binary" }],
    });

    expect(response).toEqual({ text: `${"x".repeat(600)}...`, truncated: true });
  });

  it("adds the completed assistant response to the llm_call end attributes", () => {
    const src = readFileSync(join(process.cwd(), "src/main/agent/adapters/piEngine.ts"), "utf-8");

    expect(src).toContain("const response = summarizeAssistantResponse(event.message)");
    expect(src).toContain("...(response ? { response } : {})");
  });
});
