// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnProcess } from "./TurnProcess";
import { Message } from "../message/Message";
import type { ToolTimelineMessage } from "./toolTimeline";

type ProcessMessage = ToolTimelineMessage & { id: number };
const messages: ProcessMessage[] = [
  { id: 1, role: "assistant", text: "Checking the message component", seq: 3 },
  { id: 2, role: "tool", text: "", toolCall: {
    id: "call-read", name: "read", state: "end", isError: false, startedAt: 0, updatedAt: 1,
    args: { path: "src/Message.tsx" }, details: { text: "Original file contents" },
  } },
];
const renderMessage = (message: ProcessMessage) => <Message role="assistant" text={message.text} messageSeq={message.seq} showActions={false} />;
afterEach(cleanup);

describe("turn process disclosure", () => {
  it("starts collapsed, supports keyboard expansion, and preserves tool detail state when folded", async () => {
    const user = userEvent.setup();
    const { container } = render(<TurnProcess messages={messages} renderMessage={renderMessage} />);
    const trigger = screen.getByRole("button", { name: /已完成/ });
    const content = container.querySelector(".turn-process > .process-content")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(content.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".m__bar")).toBeNull();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const read = screen.getByRole("button", { name: /读取.*src\/Message.tsx/ });
    fireEvent.click(read);
    expect(screen.getByText("Original file contents")).toBeTruthy();
    expect(screen.getByText("参数")).toBeTruthy();
    expect(screen.getByText("输出")).toBeTruthy();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(read.getAttribute("aria-expanded")).toBe("true");
  });

  it("updates running and approval status in place, then displays completion", () => {
    const active: ProcessMessage[] = [messages[0], { ...messages[1], toolCall: { ...messages[1].toolCall!, state: "start" } }];
    const view = render(<TurnProcess messages={active} running renderMessage={renderMessage} />);
    const trigger = screen.getByRole("button", { name: /进行中/ });
    expect(trigger.textContent).toContain("src/Message.tsx");
    view.rerender(<TurnProcess messages={active} running awaitingApproval renderMessage={renderMessage} />);
    expect(screen.getByRole("button", { name: /等待审批/ })).toBe(trigger);
    view.rerender(<TurnProcess messages={messages} renderMessage={renderMessage} />);
    expect(screen.getByRole("button", { name: /已完成/ })).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps tool failures visible while the process is collapsed", () => {
    const failed: ProcessMessage[] = [{ ...messages[1], toolCall: { ...messages[1].toolCall!, isError: true, summary: "Permission denied" } }];
    render(<TurnProcess messages={failed} renderMessage={renderMessage} outcome="failed" />);
    expect(screen.getByRole("status").textContent).toContain("Permission denied");
    expect(screen.getByRole("button", { name: /执行失败.*1 个错误/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the process when navigation targets an intermediate message", () => {
    render(<TurnProcess messages={messages} renderMessage={renderMessage} focusMessageSeq={3} />);
    expect(screen.getByRole("button", { name: /已完成/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("preserves delegated branch navigation", () => {
    const onOpenChild = vi.fn();
    const task: ProcessMessage[] = [{ id: 1, role: "tool", text: "", toolCall: { ...messages[1].toolCall!, name: "task", details: { childNodeId: "child-1" } } }];
    render(<TurnProcess messages={task} renderMessage={renderMessage} onOpenChild={onOpenChild} />);
    fireEvent.click(screen.getByRole("button", { name: /已完成/ }));
    fireEvent.click(screen.getByRole("button", { name: "打开研究分支" }));
    expect(onOpenChild).toHaveBeenCalledWith("child-1");
  });
});
