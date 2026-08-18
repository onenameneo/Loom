import { describe, expect, it, vi } from "vitest";
import { createWriteTodosTool } from ".";

describe("write_todos", () => {
  it("exposes a bounded sequential tool and delegates valid calls", async () => {
    const update = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }], details: { ok: true } }));
    const tool = createWriteTodosTool(update);
    expect(tool.name).toBe("write_todos");
    expect(tool.readOnly).toBe(true);
    expect(tool.executionMode).toBe("sequential");
    await tool.execute({ toolCallId: "call-1", args: { todos: [] } });
    expect(update).toHaveBeenCalledOnce();
  });
});
