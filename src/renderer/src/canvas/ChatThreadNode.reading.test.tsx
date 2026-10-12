// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatThreadNode } from "./ChatThreadNode";
import { resetWorkspaceStore } from "../workspace/store";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, Handle: () => null };
});

const messages = [
  { seq: 1, role: "user", text: "第一问" }, { seq: 2, role: "assistant", text: "第一段回答" },
  { seq: 3, role: "user", text: "第二问" }, { seq: 4, role: "assistant", text: "第二段回答" },
  { seq: 5, role: "user", text: "第三问" }, { seq: 6, role: "assistant", text: "最后的回答" },
];

function setGeometry(card: HTMLElement) {
  const body = card.querySelector<HTMLElement>(".card__body")!;
  Object.defineProperty(body, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(body, "scrollHeight", { configurable: true, value: 1_600 });
  body.getBoundingClientRect = () => ({ top: 44, height: 600 } as DOMRect);
  card.querySelectorAll<HTMLElement>("[data-question-number]").forEach((element, index) => {
    element.getBoundingClientRect = () => ({ top: 124 + index * 600 - body.scrollTop, bottom: 164 + index * 600 - body.scrollTop, height: 40 } as DOMRect);
  });
  body.scrollTop = 0;
  fireEvent.scroll(body);
  return body;
}

afterEach(() => { cleanup(); resetWorkspaceStore(); localStorage.clear(); delete (window as any).api; });

describe("canvas conversation reading", () => {
  it("provides a separate question directory and navigation for each node", async () => {
    const { container } = render(<>
      <ChatThreadNode id="one" data={{ title: "One", messages }} />
      <ChatThreadNode id="two" data={{ title: "Two", messages: messages.slice(0, 2) }} />
    </>);
    const cards = container.querySelectorAll<HTMLElement>(".card");
    const body = setGeometry(cards[0]);
    const secondBody = setGeometry(cards[1]);
    fireEvent.click(within(cards[0]).getByRole("button", { name: "问题目录" }));
    expect(document.querySelectorAll(".question-directory li")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /02 第二问/ }));
    await waitFor(() => expect(body.scrollTop).toBe(668));
    expect(secondBody.scrollTop).toBe(0);
    expect(within(cards[1]).getByText("问题 1 / 1")).toBeTruthy();
    fireEvent.click(within(cards[0]).getByRole("button", { name: "下一问" }));
    await waitFor(() => expect(body.scrollTop).toBe(1_268));
  });

  it("preserves history near the bottom during refresh until explicitly returning to latest", async () => {
    const view = render(<ChatThreadNode id="one" data={{ title: "One", messages }} />);
    const card = view.container.querySelector<HTMLElement>(".card")!;
    const body = setGeometry(card);
    const question = card.querySelector('[data-question-number="3"]');
    fireEvent.click(screen.getByRole("button", { name: "问题目录" }));
    fireEvent.click(screen.getByRole("button", { name: /03 第三问/ }));
    await waitFor(() => expect(body.scrollTop).toBe(1_268));
    fireEvent.scroll(body);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 2_400 });
    view.rerender(<ChatThreadNode id="one" data={{ title: "One", messages: [...messages.slice(0, -1), { ...messages[5], text: "新增输出" }] }} />);
    await waitFor(() => expect(screen.getByText("新增输出")).toBeTruthy());
    expect(body.scrollTop).toBe(1_268);
    expect(card.querySelector('[data-question-number="3"]')).toBe(question);
    fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
    await waitFor(() => expect(body.scrollTop).toBe(2_400));
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
  });

  it("uses pasted cards and the larger editor in the canvas composer, then submits the full text", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    (window as any).api = { canvas: {
      send,
      models: vi.fn(async () => []),
      budget: vi.fn(async () => ({ withoutAncestors: 0, withAncestors: 0, estimated: true })),
      onEvent: () => () => {},
    } };
    render(<ChatThreadNode id="one" data={{ title: "One", messages }} />);
    const input = document.querySelector<HTMLTextAreaElement>("textarea.ask")!;
    const source = Array(14).fill("完整的粘贴原文").join("\n");
    fireEvent.change(input, { target: { value: "请分析：\n" } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.paste(input, { clipboardData: { items: [], getData: () => source } });
    expect(input.value).toBe("请分析：\n");
    const toggle = screen.getByRole("button", { name: /文本片段 1.*字符/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "展开编辑" }));
    expect((screen.getByRole("textbox", { name: "展开编辑" }) as HTMLTextAreaElement).value).toBe("请分析：\n");
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /文本片段 1.*字符/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledWith("one", `请分析：\n${source}`, [], []));
  });

  it("reattaches navigation after the node resize preview closes", async () => {
    const data = { title: "One", messages };
    const view = render(<ChatThreadNode id="one" data={data} />);
    view.rerender(<ChatThreadNode id="one" data={{ ...data, isResizing: true }} />);
    expect(screen.queryByRole("navigation", { name: "问题导航" })).toBeNull();
    view.rerender(<ChatThreadNode id="one" data={data} />);
    const body = setGeometry(view.container.querySelector<HTMLElement>(".card")!);
    fireEvent.click(screen.getByRole("button", { name: "下一问" }));
    await waitFor(() => expect(body.scrollTop).toBe(668));
  });
});
