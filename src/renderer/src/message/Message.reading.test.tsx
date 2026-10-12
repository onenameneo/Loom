// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Message } from "./Message";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("user message reading", () => {
  it("folds layout overflow while retaining complete copy and edit content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(600);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const text = Array(20).fill("完整问题原文").join("\n");
    const { container } = render(<Message role="user" text={text} questionNumber={4} canEdit />);
    expect(container.querySelector('[data-question-number="4"]')).toBeTruthy();
    const expand = screen.getByRole("button", { name: "展开全文" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "收起全文" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    fireEvent.click(screen.getByRole("button", { name: "编辑重发" }));
    expect((screen.getByRole("textbox", { name: "编辑重发" }) as HTMLTextAreaElement).value).toBe(text);
  });
  it("keeps short messages fully visible without a disclosure control", () => {
    render(<Message role="user" text="Short question" />);
    expect(screen.queryByRole("button", { name: "展开全文" })).toBeNull();
    expect(screen.getByText("Short question")).toBeTruthy();
  });

  it.each([0.3, 1.6])("anchors a collapsed message in node-local pixels at canvas zoom %s", async (zoom) => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(600);
    const { container } = render(<div className="card__body"><Message role="user" text="Long question" /></div>);
    const scroll = container.firstElementChild as HTMLElement;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 500 });
    scroll.getBoundingClientRect = () => ({ height: 500 * zoom } as DOMRect);
    const message = scroll.querySelector<HTMLElement>(".m")!;
    let top = 100;
    message.getBoundingClientRect = () => ({ top: top * zoom } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: "展开全文" }));
    scroll.scrollTop = 300;
    fireEvent.click(screen.getByRole("button", { name: "收起全文" }));
    top = 160;
    await waitFor(() => expect(scroll.scrollTop).toBeCloseTo(360));
  });
});
