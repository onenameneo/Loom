import { describe, expect, it } from "vitest";
import { attributeModelError } from "./errors";

describe("model error attribution", () => {
  it("adds provider and model identity to request errors once", () => {
    const error = attributeModelError(new Error("401 unauthorized"), { providerId: "anthropic", modelId: "claude-sonnet-4-5" });

    expect(error.message).toBe("[anthropic/claude-sonnet-4-5] 401 unauthorized");
    expect(attributeModelError(error, { providerId: "anthropic", modelId: "claude-sonnet-4-5" }).message).toBe(error.message);
  });
});
