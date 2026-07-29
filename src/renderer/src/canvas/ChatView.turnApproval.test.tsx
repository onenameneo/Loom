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

function installApi() {
  send = vi.fn(async () => ({ ok: true }));
  decideApproval = vi.fn(async () => ({ ok: true }));
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
      initialMount={false}
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
