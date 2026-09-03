import { describe, expect, it } from "vitest";
import { agentMessage } from "./agentMessages";

describe("agent messages", () => {
  it("returns Chinese messages by default", () => {
    expect(agentMessage("nodeNotFound")).toBe("节点不存在。");
  });

  it("returns English messages for the English locale", () => {
    expect(agentMessage("apiKeyMissing", "en")).toBe("No API key configured. Add a provider and model credential in Settings.");
    expect(agentMessage("contextOverflow", "en")).toBe("The context still exceeds the model window. Automatic retry has been stopped.");
    expect(agentMessage("nodeNotFound", "en")).toBe("Node not found.");
  });
});
