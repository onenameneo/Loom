import { describe, expect, it } from "vitest";
import { migrateLegacyModelRef, parseStoredModelRef } from "./modelRef";

const registry = {
  listProviders: () => [
    { id: "anthropic", models: [{ id: "claude-sonnet-4-5" }] },
    { id: "openai", models: [{ id: "gpt-5.2" }, { id: "shared" }] },
    { id: "local", models: [{ id: "shared" }] },
  ],
};

describe("stored model references", () => {
  it("accepts provider-qualified refs unchanged", () => {
    expect(parseStoredModelRef({ providerId: "openai", modelId: "gpt-5.2" })).toEqual({
      kind: "ref",
      ref: { providerId: "openai", modelId: "gpt-5.2" },
    });
  });

  it("migrates unique legacy string refs deterministically", () => {
    expect(migrateLegacyModelRef("gpt-5.2", registry)).toEqual({
      kind: "ref",
      ref: { providerId: "openai", modelId: "gpt-5.2" },
    });
  });

  it("preserves ambiguous and unknown legacy strings as unresolved diagnostics", () => {
    expect(migrateLegacyModelRef("shared", registry)).toMatchObject({
      kind: "unresolved",
      legacyModel: "shared",
      diagnostic: { code: "ambiguous-legacy-model" },
    });
    expect(migrateLegacyModelRef("missing", registry)).toMatchObject({
      kind: "unresolved",
      legacyModel: "missing",
      diagnostic: { code: "unknown-legacy-model" },
    });
  });
});
