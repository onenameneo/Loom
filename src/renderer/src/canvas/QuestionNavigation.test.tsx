// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionNavigation } from "./QuestionNavigation";

const questions = [{ text: "First question" }, { text: "Second question" }, { text: "Third question" }];

function Harness({ onNavigate, zoom = 1 }: { onNavigate: () => void; zoom?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current!;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 2_200 });
    scroll.getBoundingClientRect = () => ({ top: 44, height: 600 * zoom } as DOMRect);
    scroll.querySelectorAll<HTMLElement>("[data-question-number]").forEach((element, index) => {
      element.getBoundingClientRect = () => ({ top: 44 + (80 + index * 600 - scroll.scrollTop) * zoom, bottom: 44 + (120 + index * 600 - scroll.scrollTop) * zoom, height: 40 * zoom } as DOMRect);
    });
  }, [zoom]);
  return <>
    <QuestionNavigation questions={questions} scrollRef={scrollRef} threadRef={threadRef} resetKey="node" onNavigate={onNavigate} />
    <div ref={scrollRef} data-testid="scroll"><div ref={threadRef}>{questions.map((question, i) => <div key={i} data-question-number={i + 1}>{question.text}</div>)}</div></div>
  </>;
}

afterEach(cleanup);

describe("QuestionNavigation", () => {
  it.each([0.3, 1, 1.6])("jumps and highlights the chosen question at canvas zoom %s", async (zoom) => {
    const onNavigate = vi.fn();
    const { container } = render(<Harness onNavigate={onNavigate} zoom={zoom} />);
    fireEvent.click(screen.getByRole("button", { name: "问题目录" }));
    fireEvent.click(screen.getByRole("button", { name: /03 Third question/ }));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.getByText("问题 3 / 3")).toBeTruthy();
    expect(container.querySelector('[data-question-number="3"]')?.getAttribute("data-question-highlighted")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("scroll").scrollTop).toBe(1268));
    fireEvent.click(screen.getByRole("button", { name: "上一问" }));
    expect(screen.getByText("问题 2 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一问" }));
    expect(screen.getByText("问题 3 / 3")).toBeTruthy();
  });

  it.each([0.3, 1, 1.6])("tracks the current question preview at canvas zoom %s", async (zoom) => {
    const onNavigate = vi.fn();
    render(<Harness onNavigate={onNavigate} zoom={zoom} />);
    const scroll = screen.getByTestId("scroll");
    scroll.scrollTop = 900;
    fireEvent.scroll(scroll);
    const preview = await screen.findByRole("button", { name: "当前问题 · Second question" });
    expect(screen.getByText("问题 2 / 3")).toBeTruthy();
    fireEvent.click(preview);
    expect(onNavigate).toHaveBeenCalledOnce();
    await waitFor(() => expect(scroll.scrollTop).toBe(668));
  });

  it.each([0.3, 1, 1.6])("uses a consistent current-question threshold at canvas zoom %s", async (zoom) => {
    render(<Harness onNavigate={vi.fn()} zoom={zoom} />);
    const scroll = screen.getByTestId("scroll");
    scroll.scrollTop = 648;
    fireEvent.scroll(scroll);
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(screen.getByText("问题 1 / 3")).toBeTruthy();
    scroll.scrollTop = 668;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(screen.getByText("问题 2 / 3")).toBeTruthy());
  });
});
