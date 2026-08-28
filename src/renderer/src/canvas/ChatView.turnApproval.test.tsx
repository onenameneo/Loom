// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatView from "./ChatView";
import type { CanvasEvent } from "../env";
import { resetWorkspaceStore, useWorkspaceStore } from "../workspace/store";
import "./canvas.css";

vi.mock("../titlebar/Titlebar", () => ({ useTitlebarActions: vi.fn() }));

let eventHandler: ((event: CanvasEvent) => void) | undefined;
let send: ReturnType<typeof vi.fn>;
let decideApproval: ReturnType<typeof vi.fn>;
let compact: ReturnType<typeof vi.fn>;
let abort: ReturnType<typeof vi.fn>;
let reset: ReturnType<typeof vi.fn>;

function installApi() {
  send = vi.fn(async () => ({ ok: true }));
  decideApproval = vi.fn(async () => ({ ok: true }));
  compact = vi.fn(async () => ({ ok: false, reason: "not_needed" }));
  abort = vi.fn(async () => ({ ok: true }));
  reset = vi.fn(async () => ({ ok: true }));
  (window as any).api = {
    canvas: {
      budget: vi.fn(async () => ({ withoutAncestors: 0, withAncestors: 0, estimated: true })),
      send,
      abort,
      regenerate: vi.fn(async () => ({ ok: true })),
      editResend: vi.fn(async () => ({ ok: true })),
      setMount: vi.fn(async () => ({ ok: true, budget: { withoutAncestors: 0, withAncestors: 0, estimated: true } })),
      reset,
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
  resetWorkspaceStore();
  vi.restoreAllMocks();
  delete (window as any).api;
});

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceStore();
  eventHandler = undefined;
  installApi();
});

describe("ChatView turn and approval controls", () => {
  it("shows agent loading before the live turn has its first output", async () => {
    useWorkspaceStore.getState().applyLiveTurn({
      type: "upsert",
      snapshot: {
        nodeId: "n1", sessionId: "session-a", turnId: "turn-a", operation: "send",
        state: "running", revision: 1, assistantText: "",
      },
    });

    renderChat();

    expect(await screen.findByText("思考中…")).toBeTruthy();
  });

  it("shows a navigation notice at the copied branch boundary", () => {
    const onReturnToBranch = vi.fn();
    render(
      <ChatView
        nodeId="branch-root"
        initialMessages={[
          { role: "user", text: "question", seq: 0 },
          { role: "assistant", text: "answer", seq: 1 },
          { role: "user", text: "follow-up", seq: 2 },
        ]}
        hasFrozenContext={false}
        branchSource={{ projectId: "p1", sessionId: "source", nodeId: "source-node", messageSeq: 1 }}
        onReturnToBranch={onReturnToBranch}
        onBranch={vi.fn()}
        onExpandCanvas={vi.fn()}
        noKey={false}
        goSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "从聊天中继续" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "从聊天中继续" }));
    expect(onReturnToBranch).toHaveBeenCalledOnce();
  });

  it("locks the current Node's stop action until its abort request settles", async () => {
    let resolveAbort: (() => void) | undefined;
    abort.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAbort = () => resolve({ ok: true });
    }));
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());
    act(() => {
      eventHandler?.({ nodeId: "n1", type: "turn", payload: { nodeId: "n1", turnId: "t1", operation: "send", state: "running" } });
    });

    const stop = screen.getByTitle("停止生成");
    fireEvent.click(stop);
    fireEvent.click(stop);
    expect(abort).toHaveBeenCalledTimes(1);
    expect((stop as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolveAbort?.());
    expect((stop as HTMLButtonElement).disabled).toBe(false);
  });

  it("reattaches a child Node's current assistant tail from workspace state after visiting another Session", async () => {
    useWorkspaceStore.getState().applyLiveTurn({
      type: "upsert",
      snapshot: {
        nodeId: "node-child", sessionId: "session-a", turnId: "turn-a", operation: "send",
        state: "running", revision: 1, assistantText: "background tail",
      },
    });
    const props = {
      initialMessages: [], hasFrozenContext: false, onBranch: vi.fn(), onExpandCanvas: vi.fn(), noKey: false, goSettings: vi.fn(),
    };
    const view = render(<ChatView nodeId="node-child" {...props} />);

    await waitFor(() => expect(screen.getByText("background tail")).toBeTruthy());
    view.rerender(<ChatView nodeId="node-other" {...props} />);
    view.rerender(<ChatView nodeId="node-child" {...props} />);

    await waitFor(() => expect(screen.getAllByText("background tail")).toHaveLength(1));
  });

  it("keeps parent context included and offers selected text notes", async () => {
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
    const addNote = await screen.findByRole("button", { name: "添加到当前对话" });
    expect(document.querySelector(".seltb small")).toBeNull();
    expect(document.querySelectorAll(".selection-toolbar-actions > *")).toHaveLength(2);
    await userEvent.setup().click(addNote);
    expect(screen.queryByRole("button", { name: "添加到当前对话" })).toBeNull();
    expect(screen.getByText("注释（可选）")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "取消" }));
    await userEvent.setup().click(screen.getByRole("button", { name: /从这里展开/ }));
    expect(onBranch).toHaveBeenCalledWith("parent response", true);
    expect(screen.queryByRole("button", { name: /从这里展开/ })).toBeNull();
  });

  it("adds an empty-annotation selection to the current Composer draft", async () => {
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
    await userEvent.setup().click(screen.getByRole("button", { name: "添加到当前对话" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "确认" }));

    expect(screen.getByRole("button", { name: "查看 1 条注释" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "添加到当前对话" })).toBeNull();
  });

  it("keeps pending selection notes isolated per node", () => {
    localStorage.setItem("loom:selection-notes:node-a", JSON.stringify([{ id: "a", text: "A", annotation: "" }]));
    localStorage.setItem("loom:selection-notes:node-b", JSON.stringify([{ id: "b", text: "B", annotation: "" }]));
    const props = {
      initialMessages: [], hasFrozenContext: false, onBranch: vi.fn(), onExpandCanvas: vi.fn(), noKey: false, goSettings: vi.fn(),
    };
    const view = render(<ChatView nodeId="node-a" {...props} />);
    expect(screen.getByRole("button", { name: "查看 1 条注释" })).toBeTruthy();

    view.rerender(<ChatView nodeId="node-b" {...props} />);
    expect(screen.getByRole("button", { name: "查看 1 条注释" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看 1 条注释" }));
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.queryByText("A")).toBeNull();
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
    expect(screen.getByRole("button", { name: "添加到当前对话" })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "添加到当前对话" })).toBeNull();
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

  it("sends slash-prefixed text when no command matches", async () => {
    renderChat();
    await waitFor(() => expect(eventHandler).toBeTruthy());

    const input = screen.getByPlaceholderText(/随心输入/);
    fireEvent.change(input, { target: { value: "/xxxxxx" } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(send).toHaveBeenCalledWith("n1", "/xxxxxx", [], []);
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

  it("keeps the conversation and reports an error when slash clear cannot reset the node", async () => {
    reset.mockRejectedValueOnce(new Error("reset failed"));
    render(
      <ChatView
        nodeId="n1"
        initialMessages={[{ role: "user", text: "keep this", seq: 0 } as any]}
        hasFrozenContext={false}
        onBranch={vi.fn()}
        onExpandCanvas={vi.fn()}
        noKey={false}
        goSettings={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/随心输入/);
    fireEvent.change(input, { target: { value: "/clear" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(reset).toHaveBeenCalledWith("n1");
    expect(await screen.findByText("keep this")).toBeTruthy();
    expect(await screen.findByText("reset failed")).toBeTruthy();
  });

  it("coalesces repeated slash clear requests while the first reset is pending", async () => {
    let resolveReset: ((value: { ok: boolean }) => void) | undefined;
    reset.mockImplementationOnce(() => new Promise((resolve) => {
      resolveReset = resolve;
    }));
    render(
      <ChatView
        nodeId="n1"
        initialMessages={[{ role: "user", text: "keep this", seq: 0 } as any]}
        hasFrozenContext={false}
        onBranch={vi.fn()}
        onExpandCanvas={vi.fn()}
        noKey={false}
        goSettings={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/随心输入/);
    fireEvent.change(input, { target: { value: "/clear" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "/clear" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(reset).toHaveBeenCalledTimes(1);
    await act(async () => resolveReset?.({ ok: true }));
    await waitFor(() => expect(screen.queryByText("keep this")).toBeNull());
  });
});
