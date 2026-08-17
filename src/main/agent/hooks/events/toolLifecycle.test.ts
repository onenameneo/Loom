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

  it("keeps project coding tool lifecycle events on the existing stream", () => {
    const emitted: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
    const hook = createToolLifecycleHook({ emit: (nodeId, type, payload) => emitted.push({ nodeId, type, payload }) });

    hook.onEvent?.("n1", {
      type: "tool_execution_end",
      toolCallId: "tc-project",
      toolName: "project_grep",
      isError: false,
      result: { content: [{ type: "text", text: "src/file.ts:1: needle" }], details: { matches: 1 } },
    } as AgentEvent);

    expect(emitted).toEqual([expect.objectContaining({
      nodeId: "n1",
      type: "tool",
      payload: expect.objectContaining({ state: "end", toolName: "project_grep" }),
    })]);
  });

  it("keeps project mutation tool lifecycle events bounded on the existing stream", () => {
    const emitted: Array<{ nodeId: string; type: string; payload?: unknown }> = [];
    const hook = createToolLifecycleHook({ emit: (nodeId, type, payload) => emitted.push({ nodeId, type, payload }) });

    hook.onEvent?.("n1", {
      type: "tool_execution_end",
      toolCallId: "tc-write",
      toolName: "write",
      isError: false,
      result: { content: [{ type: "text", text: "Project file created" }], details: { diff: "x".repeat(5000) } },
    } as AgentEvent);

    expect(emitted[0]).toMatchObject({
      nodeId: "n1",
      type: "tool",
      payload: expect.objectContaining({ state: "end", toolName: "write" }),
    });
    expect(JSON.stringify((emitted[0].payload as any).details).length).toBeLessThan(2200);
  });
});
