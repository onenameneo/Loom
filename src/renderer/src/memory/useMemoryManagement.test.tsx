// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMemoryManagement } from "./useMemoryManagement";
import type { MemoryRecord } from "./memoryDomain";

const record: MemoryRecord = {
  id: "mem_1",
  type: "user" as const,
  scope: { kind: "project" as const, projectId: "project-1" },
  status: "candidate" as const,
  confidence: 0.8,
  description: "Use Chinese",
  content: "Use Chinese by default.",
  source: { trigger: "extracted" },
  createdAt: 1,
  updatedAt: 1,
};

function listResult(records = [record]) {
  return {
    records,
    issues: [],
    stats: { active: 0, candidates: records.length, archived: 0, stale: 0, conflicted: 0, issues: 0 },
  };
}

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

describe("useMemoryManagement", () => {
  it("loads the selected project scope and refreshes after a mutation", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(listResult())
      .mockResolvedValueOnce(listResult([{ ...record, status: "active" as const }]));
    const approve = vi.fn(async () => record);
    (window as any).api = {
      memory: {
        list,
        onEvent: vi.fn(() => vi.fn()),
        approve,
        autodreamStatus: vi.fn(async () => ({ status: "idle", gate: { eligible: true, reason: "ready" } })),
      },
    };

    const { result } = renderHook(() => useMemoryManagement({ projectId: "project-1", enabled: true }));
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(list).toHaveBeenCalledWith({ projectId: "project-1", includeArchived: true });

    await act(async () => { await result.current.approve("mem_1"); });
    expect(approve).toHaveBeenCalledWith("mem_1");
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.records[0].status).toBe("active");
  });

  it("exposes a bounded error and keeps the previous records when refresh fails", async () => {
    const message = "x".repeat(500);
    const list = vi.fn().mockResolvedValueOnce(listResult()).mockRejectedValueOnce(new Error(message));
    (window as any).api = {
      memory: {
        list,
        onEvent: vi.fn(() => vi.fn()),
        autodreamStatus: vi.fn(async () => ({ status: "idle" })),
      },
    };

    const { result } = renderHook(() => useMemoryManagement({ enabled: true }));
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    await act(async () => { await result.current.reload(); });
    expect(result.current.records).toHaveLength(1);
    expect(result.current.error).toHaveLength(240);
  });

  it("derives scoped statistics and includes rejected records in the archived filter", async () => {
    const active = { ...record, status: "active" as const };
    const rejected = { ...record, id: "mem_2", status: "rejected" as const, scope: { kind: "user" as const } };
    const list = vi.fn(async () => ({
      records: [active, rejected],
      issues: [],
      stats: { active: 99, candidates: 99, archived: 99, stale: 99, conflicted: 99, issues: 99 },
    }));
    (window as any).api = {
      memory: { list, onEvent: vi.fn(() => vi.fn()), autodreamStatus: vi.fn(async () => ({ status: "idle" })) },
    };

    const { result } = renderHook(() => useMemoryManagement({ projectId: "project-1", enabled: true }));
    await waitFor(() => expect(result.current.records).toHaveLength(2));
    expect(result.current.stats).toEqual(expect.objectContaining({ active: 1, archived: 1, issues: 0 }));
    act(() => result.current.setFilter("archived"));
    expect(result.current.visibleRecords.map((item) => item.id)).toEqual(["mem_2"]);
  });

  it("updates AutoDream progress and removes the event listener on unmount", async () => {
    let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
    const unsubscribe = vi.fn();
    const onEvent = vi.fn((next: typeof listener) => { listener = next; return unsubscribe; });
    (window as any).api = {
      memory: {
        list: vi.fn(async () => listResult([])),
        onEvent,
        autodreamStatus: vi.fn(async () => ({ status: "idle", gate: { eligible: true, reason: "ready" } })),
      },
    };

    const view = renderHook(() => useMemoryManagement({ enabled: true }));
    await waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    act(() => listener?.({ type: "autodream", progress: { status: "running", phase: "gather", progress: 0.5 } }));
    expect(view.result.current.dreamStatus).toEqual(expect.objectContaining({ status: "running", phase: "gather", progress: 0.5 }));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports a no-op mutation instead of treating a missing record as success", async () => {
    const edit = vi.fn(async () => undefined);
    (window as any).api = {
      memory: {
        list: vi.fn(async () => listResult()),
        onEvent: vi.fn(() => vi.fn()),
        edit,
        autodreamStatus: vi.fn(async () => ({ status: "idle" })),
      },
    };
    const { result } = renderHook(() => useMemoryManagement({ enabled: true }));
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    await act(async () => { await result.current.edit("missing", { content: "new" }); });
    expect(result.current.mutationError).toContain("not found");
  });
});
