// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SessionCanvas from "./SessionCanvas";

vi.mock("../titlebar/Titlebar", () => ({ useTitlebarContext: () => undefined }));
vi.mock("./Canvas", () => ({ default: () => <span>canvas surface</span> }));
vi.mock("./ChatView", () => ({ default: ({ initialMessages, onTreeChange }: any) => <>
  <span>chat surface</span>
  <button onClick={onTreeChange}>finish turn</button>
  <span>{initialMessages.at(-1)?.artifacts?.[0]?.name ?? "no file"}</span>
</> }));
afterEach(() => { cleanup(); delete (window as any).api; });

it("reloads current chat artifacts when the turn reports a tree change", async () => {
  const node = { id: "n1", sessionId: "s1", projectId: "p1", title: "Root", messages: [] };
  const open = vi.fn().mockResolvedValue([node]);
  const onTreeChange = vi.fn();
  window.api = { canvas: { open } } as any;
  render(<SessionCanvas sessionId="s1" sessionName="Test" noKey={false} goSettings={() => undefined} onTreeChange={onTreeChange} />);
  await screen.findByText("no file");
  open.mockResolvedValue([{ ...node, messages: [{ role: "assistant", text: "created", artifacts: [{ name: "HiNeo.md" }] }] }]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "finish turn" })); });
  await waitFor(() => expect(screen.getByText("HiNeo.md")).toBeTruthy());
  expect(onTreeChange).toHaveBeenCalled();
});

it("keeps the current chat surface when a delegated child is created", async () => {
  const root = { id: "n1", sessionId: "s1", projectId: "p1", title: "Root", messages: [] };
  const child = { id: "n2", sessionId: "s1", projectId: "p1", parentId: "n1", title: "Research", messages: [] };
  const open = vi.fn().mockResolvedValue([root]);
  let onEvent: ((event: any) => void) | undefined;
  window.api = { canvas: { open, onEvent: (listener: (event: any) => void) => { onEvent = listener; return () => undefined; } } } as any;
  render(<SessionCanvas sessionId="s1" sessionName="Test" noKey={false} goSettings={() => undefined} />);
  await screen.findByText("chat surface");
  open.mockResolvedValue([root, child]);
  await act(async () => { onEvent?.({ type: "delegation", payload: { sessionId: "s1", state: "running" } }); });
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(screen.getByText("chat surface")).toBeTruthy();
  expect(screen.queryByText("canvas surface")).toBeNull();
});
