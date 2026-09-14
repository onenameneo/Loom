// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SessionCanvas from "./SessionCanvas";

vi.mock("../titlebar/Titlebar", () => ({ useTitlebarContext: () => undefined }));
vi.mock("./Canvas", () => ({ default: () => null }));
vi.mock("./ChatView", () => ({ default: ({ initialMessages, onTreeChange }: any) => <>
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
