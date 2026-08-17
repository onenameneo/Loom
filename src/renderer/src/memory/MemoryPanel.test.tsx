// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MemoryPanel from "./MemoryPanel";

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

describe("MemoryPanel", () => {
  it("lists lifecycle metadata and refreshes from typed memory IPC", async () => {
    const onEvent = vi.fn(() => vi.fn());
    const list = vi.fn(async () => ({
      records: [{
        id: "mem_1",
        type: "user",
        scope: { kind: "user" },
        status: "candidate",
        confidence: 0.8,
        description: "Use Chinese",
        content: "Use Chinese by default.",
        source: { trigger: "extracted", sessionId: "s1" },
        updatedAt: 1,
      }],
      issues: [],
      stats: { active: 0, candidates: 1, archived: 0, stale: 0, conflicted: 0, issues: 0 },
    }));
    (window as any).api = {
      memory: {
        list,
        onEvent,
        approve: vi.fn(async () => undefined),
        reject: vi.fn(async () => undefined),
        forget: vi.fn(async () => undefined),
        autodreamRun: vi.fn(async () => undefined),
        remember: vi.fn(async () => undefined),
      },
    };
    render(<MemoryPanel project={{ id: "project-1", name: "Loom", createdAt: 1, updatedAt: 1, pinned: false, order: 0 }} />);
    await waitFor(() => expect(screen.getByText("Use Chinese")).toBeTruthy());
    expect(screen.getAllByText("candidate").length).toBeGreaterThan(0);
    expect(onEvent).toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ projectId: "project-1", includeArchived: true });
  });
});
