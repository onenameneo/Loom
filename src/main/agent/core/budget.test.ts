import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { budget, estTokens, ownChars } from "./budget";
import type { CanvasNodeModel } from "./graph";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;

function node(messages: AgentMessage[], seed?: { text: string }): CanvasNodeModel {
  return { id: "n", mountAncestors: false, messages, seed: seed as any };
}

describe("estTokens / ownChars", () => {
  it("estimates ~2 chars per token", () => {
    expect(estTokens(10)).toBe(5);
  });
  it("counts seed + message chars", () => {
    expect(ownChars(node([user("abcd")], { text: "xy" }))).toBe(6);
  });
});

describe("budget", () => {
  it("equals own estimate when no ancestors", () => {
    const b = budget(node([user("abcd")]), []);
    expect(b).toEqual({ withoutAncestors: 2, withAncestors: 2, estimated: true });
  });

  it("adds ancestor chars only into withAncestors", () => {
    const anc: CanvasNodeModel[] = [{ id: "p", mountAncestors: false, messages: [user("efgh")] }];
    const b = budget(node([user("abcd")]), anc);
    expect(b.withoutAncestors).toBe(2); // 4 chars
    expect(b.withAncestors).toBe(4); // 8 chars
    expect(b.estimated).toBe(true);
  });
});
