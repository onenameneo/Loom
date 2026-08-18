// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TodoProgressPanel } from "./TodoProgressPanel";
import type { TodoPlanSnapshot } from "../env";

const plan: TodoPlanSnapshot = {
  planId: "p1", nodeId: "n1", sessionId: "s1", turnId: "t1", revision: 1, status: "active", updatedAt: 1,
  todos: [
    { id: "a", content: "Inspect the project", status: "completed" },
    { id: "b", content: "Implement the change", status: "in_progress" },
  ],
};

describe("TodoProgressPanel", () => {
  it("keeps an empty DOM anchor and renders accessible progress", () => {
    const { container, rerender } = render(<TodoProgressPanel />);
    expect(container.firstElementChild?.classList.contains("todo-progress-panel--empty")).toBe(true);
    rerender(<TodoProgressPanel plan={plan} />);
    expect(screen.getByRole("region", { name: "执行计划" })).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const content = container.querySelector(".todo-progress-content");
    expect(content?.getAttribute("data-state")).toBe("open");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(content?.getAttribute("data-state")).toBe("closed");
  });
});
