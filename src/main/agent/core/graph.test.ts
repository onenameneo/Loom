import { describe, expect, it } from "vitest";
import { ancestorChain, descendants, type CanvasNodeModel } from "./graph";

function node(id: string, parentId?: string): CanvasNodeModel {
  return { id, parentId, messages: [] };
}

function lookupOf(...nodes: CanvasNodeModel[]) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  return (id: string) => map.get(id);
}

describe("ancestorChain", () => {
  it("collects root→父 order, excluding self", () => {
    const lookup = lookupOf(node("root"), node("a", "root"), node("b", "a"), node("c", "b"));
    expect(ancestorChain("c", lookup).map((n) => n.id)).toEqual(["root", "a", "b"]);
  });

  it("returns empty for a root node", () => {
    expect(ancestorChain("root", lookupOf(node("root")))).toEqual([]);
  });

  it("guards against cycles", () => {
    // a→b→a 人为环：不应无限循环
    const lookup = lookupOf(node("a", "b"), node("b", "a"));
    const chain = ancestorChain("a", lookup).map((n) => n.id);
    expect(chain.length).toBeLessThanOrEqual(2);
  });

  it("stops when an ancestor is missing", () => {
    const lookup = lookupOf(node("a", "ghost"));
    expect(ancestorChain("a", lookup)).toEqual([]);
  });
});

describe("descendants", () => {
  it("enumerates all descendants depth-first", () => {
    const all = [node("root"), node("a", "root"), node("b", "a"), node("c", "root")];
    expect(descendants("root", all).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns empty for a leaf", () => {
    expect(descendants("leaf", [node("leaf")])).toEqual([]);
  });
});
