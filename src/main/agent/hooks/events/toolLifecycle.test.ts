import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { createToolLifecycleHook, normalizeToolEvent } from "./toolLifecycle";
import type { EventSinkPort } from "../../ports";

describe("normalizeToolEvent", () => {
  it("normalizes tool start events", () => {
    const result = normalizeToolEvent({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "now",
      args: {},
    } as AgentEvent);
    expect(result).toMatchObject({ state: "start", toolCallId: "tc-1", toolName: "now" });
  });

  it("normalizes and bounds tool end events", () => {
    const result = normalizeToolEvent({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "web_fetch",
      isError: false,
      result: { content: [{ type: "text", text: "x".repeat(2000) }], details: { ok: true } },
    } as AgentEvent);
    expect(result).toMatchObject({ state: "end", toolCallId: "tc-1", toolName: "web_fetch", isError: false });
    expect(result?.summary).toBeDefined();
    expect(result?.summary?.length).toBeLessThanOrEqual(900);
  });
});

describe("createToolLifecycleHook", () => {
  it("emits stable Loom tool events", () => {
    const emitted: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
    const sink: EventSinkPort = { emit: (nodeId, type, payload) => emitted.push({ nodeId, type, payload }) };
    const hook = createToolLifecycleHook(sink);

    hook.onEvent?.("n1", {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "calc",
      args: { expression: "1+1" },
    } as AgentEvent);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ nodeId: "n1", type: "tool" });
    expect(emitted[0].payload).toMatchObject({ state: "start", toolName: "calc" });
  });
});
