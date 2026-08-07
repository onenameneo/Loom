// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatView from "./ChatView";
import type { CanvasEvent } from "../env";
import "./canvas.css";

vi.mock("../titlebar/Titlebar", () => ({ useTitlebarActions: vi.fn() }));

let eventHandler: ((event: CanvasEvent) => void) | undefined;
let send: ReturnType<typeof vi.fn>;
let decideApproval: ReturnType<typeof vi.fn>;
let compact: ReturnType<typeof vi.fn>;

function installApi() {
  send = vi.fn(async () => ({ ok: true }));
  decideApproval = vi.fn(async () => ({ ok: true }));
  compact = vi.fn(async () => ({ ok: false, reason: "not_needed" }));
  (window as any).api = {
    canvas: {
      budget: vi.fn(async () => ({ withoutAncestors: 0, withAncestors: 0, estimated: true })),
      send,
      abort: vi.fn(async () => ({ ok: true })),
      regenerate: vi.fn(async () => ({ ok: true })),
      editResend: vi.fn(async () => ({ ok: true })),
      setMount: vi.fn(async () => ({ ok: true, budget: { withoutAncestors: 0, withAncestors: 0, estimated: true } })),
      reset: vi.fn(async () => ({ ok: true })),
      setSystemPrompt: vi.fn(async () => ({ ok: true })),
      setModel: vi.fn(async () => ({ ok: true })),
      compact,
      models: vi.fn(async () => []),
      decideApproval,
      onEvent: (cb: (event: CanvasEvent) => void) => {
        eventHandler = cb;
        return () => {
          eventHandler = undefined;
        };
      },
    },
  };
}

function renderChat() {
  return render(
    <ChatView
      nodeId="n1"
      initialMessages={[]}
      hasFrozenContext={false}
      onBranch={vi.fn()}
      onExpandCanvas={vi.fn()}
      noKey={false}
      goSettings={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).api;
});

beforeEach(() => {
  localStorage.clear();
  eventHandler = undefined;
  installApi();
});

describe("ChatView turn and approval controls", () => {
  it("defaults the selection toolbar to mounted ancestors", async () => {
    const onBranch = vi.fn();
    render(
      <ChatView
        nodeId="n1"
        initialMessages={[{ role: "assistant", text: "parent response", seq: 0 } as any]}
        hasFrozenContext={false}
        onBranch={onBranch}
        onExpandCanvas={vi.fn()}
        noKey={false}
        goSettings={vi.fn()}
      />,
    );

    const thread = document.querySelector(".thread")!;
    const target = screen.getByText("parent response");
    const range = {
      commonAncestorContainer: target,
      getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "parent response",
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    } as any);

    fireEvent.mouseUp(target);
    const toggle = await screen.findByRole("button", { name: "创建时包含父级上下文" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(screen.getByRole("button", { name: /从这里展开/ }));
    expect(onBranch).toHaveBeenCalledWith("parent response", true);
  });

  it("closes the selection toolbar on an external pointer or focus event", async () => {
    render(
      <ChatView
        nodeId="n1"
        initialMessages={[{ role: "assistant", text: "parent response", seq: 0 } as any]}
        hasFrozenContext={false}
        onBranch={vi.fn()}
        onExpandCanvas={vi.fn()}
        noKey={false}
        goSettings={vi.fn()}
      />,
    );

    const target = screen.getByText("parent response");
    const range = {
      commonAncestorContainer: target,
      getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "parent response",
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    } as any);

    fireEvent.mouseUp(target);
    expect(screen.getByRole("button", { name: "创建时包含父级上下文" })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "创建时包含父级上下文" })).toBeNull();
  });

  it("runs /compact and reports when there is nothing to compact", async () => {
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());

    const input = screen.getByPlaceholderText(/随心输入/);
    fireEvent.change(input, { target: { value: "/compact" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(compact).toHaveBeenCalledWith("n1"));
    expect(screen.getByText("压缩未执行：当前上下文还不需要压缩。")).toBeTruthy();
  });

  it("reloads and shows the checkpoint summary after successful /compact", async () => {
    compact.mockResolvedValueOnce({
      ok: true,
      node: {
        id: "n1",
        messages: [{
          role: "checkpoint",
          text: "## Goal\nCompressed history",
          seq: 2,
          checkpoint: {
            id: "cp-1",
            kind: "context",
            reason: "manual",
            createdAt: 1,
            coverage: { fromSeq: 0, toSeq: 1 },
            retainedTail: { fromSeq: 2, toSeq: 2 },
            diagnostics: { before: { tokens: 12000, exact: false }, after: { tokens: 800, exact: false } },
          },
        }],
      },
    });
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());

    const input = screen.getByPlaceholderText(/随心输入/);
    fireEvent.change(input, { target: { value: "/compact" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(compact).toHaveBeenCalledWith("n1"));
    expect(screen.getByText("Compressed history")).toBeTruthy();
    expect(screen.getByText("压缩完成。已插入压缩摘要。")).toBeTruthy();
  });

  it("suppresses sends while a turn event says the node is busy", async () => {
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());

    act(() => {
      eventHandler?.({ nodeId: "n1", type: "turn", payload: { nodeId: "n1", turnId: "t1", operation: "send", state: "running" } });
    });
    fireEvent.change(screen.getByPlaceholderText(/生成中/), { target: { value: "blocked" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/生成中/), { key: "Enter" });

    expect(send).not.toHaveBeenCalled();
  });

  it("renders current approval and dispatches allow/deny decisions", async () => {
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());

    act(() => {
      eventHandler?.({
        nodeId: "n1",
        type: "approval",
        payload: {
          requestId: "r1",
          nodeId: "n1",
          turnId: "t1",
          toolCallId: "tc1",
          toolName: "write_file",
          target: "/tmp/a",
          preview: { title: "Write /tmp/a" },
          defaultScope: "once",
          createdAt: 1,
          expiresAt: 2,
        },
      });
      eventHandler?.({ nodeId: "n1", type: "turn", payload: { nodeId: "n1", turnId: "t1", operation: "send", state: "awaiting_approval" } });
    });

    const approvalGroup = screen.getByRole("group", { name: "工具审批" });
    expect(approvalGroup.closest(".composer-wrap")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "允许工具调用" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "允许一次" }));
    expect(decideApproval).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", action: "allow", scope: "once" }));

    act(() => {
      eventHandler?.({
        nodeId: "n1",
        type: "approval",
        payload: {
          requestId: "r2",
          nodeId: "n1",
          turnId: "t1",
          toolCallId: "tc2",
          toolName: "write_file",
          target: "/tmp/b",
          preview: { title: "Write /tmp/b" },
          defaultScope: "once",
          createdAt: 1,
          expiresAt: 2,
        },
      });
      eventHandler?.({ nodeId: "n1", type: "turn", payload: { nodeId: "n1", turnId: "t1", operation: "send", state: "awaiting_approval" } });
    });
    fireEvent.click(screen.getByRole("button", { name: "拒绝工具调用" }));
    expect(decideApproval).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r2", action: "deny", scope: undefined }));
  });

  it("resets terminal turn state and preserves ordinary no-tool chat submission", async () => {
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());

    act(() => {
      eventHandler?.({ nodeId: "n1", type: "turn", payload: { nodeId: "n1", turnId: "t1", operation: "send", state: "completed" } });
    });
    const input = screen.getByPlaceholderText(/随心输入/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(send).toHaveBeenCalledWith("n1", "hello", [], []);
  });
});
