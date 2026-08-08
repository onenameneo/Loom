import { describe, expect, it } from "vitest";
import {
  applyTraceEvent,
  buildSpanTree,
  traceSnapshotToState,
  type TraceEventDto,
  type TraceSpanDto,
} from "./traceState";

function turnStart(overrides: Partial<TraceEventDto & { turnId: string; revision: number }> = {}): TraceEventDto {
  return {
    type: "turn_start",
    nodeId: "node-1",
    turnId: "turn-1",
    operation: "send",
    revision: 1,
    startedAt: 100,
    span: { spanId: "turn", kind: "turn", name: "send", startedAt: 100, status: "pending", attributes: { operation: "send" } },
    ...overrides,
  } as TraceEventDto;
}

describe("traceSnapshotToState", () => {
  it("indexes records by turnId and keeps start order", () => {
    const state = traceSnapshotToState({
      nodeId: "node-1",
      revision: 5,
      records: [
        { nodeId: "node-1", turnId: "t2", operation: "send", status: "ok", startedAt: 200, spans: [] },
        { nodeId: "node-1", turnId: "t1", operation: "send", status: "ok", startedAt: 100, spans: [] },
      ],
    });
    expect(state.order).toEqual(["t2", "t1"]);
    expect(state.revision).toBe(5);
  });
});

describe("applyTraceEvent", () => {
  it("rejects stale revisions and foreign nodes", () => {
    const state = traceSnapshotToState({ nodeId: "node-1", revision: 4, records: [] });
    expect(applyTraceEvent(state, { ...turnStart(), revision: 3 }, "node-1")).toBe(state);
    expect(applyTraceEvent(state, { ...turnStart(), nodeId: "node-2", revision: 9 }, "node-1")).toBe(state);
  });

  it("builds a record from turn_start then appends spans and ends them", () => {
    let state = applyTraceEvent(null, turnStart(), "node-1");
    expect(state?.order).toEqual(["turn-1"]);
    expect(state?.recordsByTurnId["turn-1"]).toMatchObject({ status: "pending", spans: [{ spanId: "turn", kind: "turn" }] });

    const span: TraceSpanDto = { spanId: "s1", kind: "llm_call", name: "p/m", startedAt: 101, status: "pending", attributes: {} };
    state = applyTraceEvent(state, { type: "span", nodeId: "node-1", turnId: "turn-1", span, revision: 2 }, "node-1");
    expect(state?.recordsByTurnId["turn-1"].spans.map((s) => s.spanId)).toEqual(["turn", "s1"]);

    state = applyTraceEvent(state, { type: "span_end", nodeId: "node-1", turnId: "turn-1", spanId: "s1", status: "ok", endedAt: 150, attributes: { usage: { totalTokens: 10 } }, revision: 3 }, "node-1");
    expect(state?.recordsByTurnId["turn-1"].spans.find((s) => s.spanId === "s1")).toMatchObject({ status: "ok", endedAt: 150, attributes: { usage: { totalTokens: 10 } } });
  });

  it("applies turn_end to the record and its root span, and rejects duplicate spans", () => {
    let state = applyTraceEvent(null, turnStart(), "node-1");
    state = applyTraceEvent(state, { type: "span", nodeId: "node-1", turnId: "turn-1", span: { spanId: "s1", kind: "llm_call", name: "m", startedAt: 101, status: "pending", attributes: {} }, revision: 2 }, "node-1");
    state = applyTraceEvent(state, { type: "turn_end", nodeId: "node-1", turnId: "turn-1", status: "ok", endedAt: 200, revision: 3 }, "node-1");

    const record = state?.recordsByTurnId["turn-1"];
    expect(record).toMatchObject({ status: "ok", endedAt: 200 });
    expect(record?.spans[0]).toMatchObject({ status: "ok", endedAt: 200 });
  });

  it("merges turn attributes via turn_update into the root span", () => {
    let state = applyTraceEvent(null, turnStart(), "node-1");
    state = applyTraceEvent(state, { type: "turn_update", nodeId: "node-1", turnId: "turn-1", attributes: { approval: { requestId: "r1" } }, revision: 2 }, "node-1");
    expect(state?.recordsByTurnId["turn-1"].spans[0].attributes).toMatchObject({ approval: { requestId: "r1" } });
  });
});

describe("buildSpanTree", () => {
  it("projects flat spans into a nested tree with fallback roots", () => {
    const spans: TraceSpanDto[] = [
      { spanId: "turn", kind: "turn", name: "send", startedAt: 0, status: "ok", attributes: {} },
      { spanId: "llm1", parentSpanId: "turn", kind: "llm_call", name: "p/m", startedAt: 1, status: "ok", attributes: {} },
      { spanId: "tool1", parentSpanId: "llm1", kind: "tool", name: "calc", startedAt: 2, status: "ok", attributes: {} },
      { spanId: "orphan", parentSpanId: "missing", kind: "tool", name: "webfetch", startedAt: 3, status: "ok", attributes: {} },
    ];
    const tree = buildSpanTree(spans);
    expect(tree.map((node) => node.spanId)).toEqual(["turn", "orphan"]);
    expect(tree[0].children.map((node) => node.spanId)).toEqual(["llm1"]);
    expect(tree[0].children[0].children.map((node) => node.spanId)).toEqual(["tool1"]);
  });
});
