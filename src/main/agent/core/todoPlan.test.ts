import { describe, expect, it } from "vitest";
import { clearTodoPlan, createTodoPlan, deriveTodoPlanStatus, isTodoPlanStale, validateTodoItems, type TodoItem } from "./todoPlan";

const item = (overrides: Partial<TodoItem> = {}): TodoItem => ({ id: "one", content: "Do one thing", status: "pending", ...overrides });

describe("todo plan core", () => {
  it("validates and normalizes a bounded plan", () => {
    expect(validateTodoItems([item({ content: "  Do one thing  " })])).toEqual({
      ok: true,
      todos: [{ id: "one", content: "Do one thing", status: "pending" }],
    });
  });

  it("rejects malformed, duplicate, and unknown dependency items", () => {
    expect(validateTodoItems([item(), item({ id: "one" })])).toMatchObject({ ok: false });
    expect(validateTodoItems([item({ dependsOn: ["missing"] })])).toMatchObject({ ok: false });
    expect(validateTodoItems([item({ status: "done" as never })])).toMatchObject({ ok: false });
  });

  it("derives completion and blocking states", () => {
    expect(deriveTodoPlanStatus([{ ...item(), status: "completed" as const }])).toBe("completed");
    expect(deriveTodoPlanStatus([{ ...item(), status: "blocked" as const }])).toBe("blocked");
    expect(deriveTodoPlanStatus([{ ...item(), status: "in_progress" as const }])).toBe("active");
  });

  it("creates and clears immutable snapshots", () => {
    const result = createTodoPlan({
      planId: "plan-1",
      nodeId: "node-1",
      sessionId: "session-1",
      turnId: "turn-1",
      revision: 1,
      todos: [item()],
      updatedAt: 10,
    });
    expect(result).toMatchObject({ ok: true, snapshot: { status: "active", revision: 1 } });
    expect(clearTodoPlan({ nodeId: "node-1", sessionId: "session-1", turnId: "turn-2", revision: 2, updatedAt: 20 })).toMatchObject({
      status: "cleared",
      todos: [],
      revision: 2,
    });
  });

  it("detects a stale turn", () => {
    expect(isTodoPlanStale({ currentTurnId: "turn-2", currentGeneration: 2, turnId: "turn-1", generation: 1 })).toBe(true);
    expect(isTodoPlanStale({ currentTurnId: "turn-1", currentGeneration: 1, turnId: "turn-1", generation: 1 })).toBe(false);
  });
});
