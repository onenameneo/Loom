import { describe, expect, it } from "vitest";
import { emptyMcpForm, mcpFormToConfig, validateMcpForm } from "./mcpForm";

describe("MCP settings form", () => {
  it("uses a global screenshot-shaped form without project fields", () => {
    const form = emptyMcpForm();
    expect(form).toMatchObject({
      name: "",
      transport: "stdio",
      args: [""],
      env: [{ key: "", value: "" }],
      inheritEnv: [""],
      headers: [{ key: "", value: "" }],
      headerEnv: [{ key: "", value: "" }],
    });
    expect(form).not.toHaveProperty("scope");
    expect(form).not.toHaveProperty("displayName");
    expect(form).not.toHaveProperty("credentialName");
  });

  it("emits repeatable secret references, never credential values", () => {
    const form = { ...emptyMcpForm(), id: "notes", name: "Notes", command: "npx", env: [{ key: "MCP_TOKEN", value: "TOKEN_ENV" }] };
    const config = mcpFormToConfig(form, 4);
    expect(config).toMatchObject({ revision: 4, name: "Notes", transport: { env: { MCP_TOKEN: { source: "environment", name: "TOKEN_ENV" } } } });
    expect(JSON.stringify(config)).not.toContain("secret-value");
  });

  it("rejects shell expressions and non-local HTTP", () => {
    expect(validateMcpForm({ ...emptyMcpForm(), id: "notes", name: "Notes", command: "node && rm -rf" })).toBe("invalid-command");
    expect(validateMcpForm({ ...emptyMcpForm(), id: "notes", name: "Notes", transport: "streamable-http", url: "http://remote.example/mcp" })).toBe("invalid-url");
  });

  it("requires sensitive HTTP headers to be configured as references", () => {
    const form = { ...emptyMcpForm(), id: "remote", name: "Remote", transport: "streamable-http" as const, url: "https://mcp.example.com/mcp", headers: [{ key: "Authorization", value: "Bearer plaintext" }] };
    expect(validateMcpForm(form)).toBe("invalid-env-ref");
    expect(validateMcpForm({ ...form, transport: "stdio", command: "npx" })).not.toBe("invalid-env-ref");
    expect(mcpFormToConfig({ ...form, headers: [{ key: "X-Client", value: "loom" }], bearerTokenEnv: "MCP_BEARER_TOKEN" }).transport).toMatchObject({ headers: { Authorization: { source: "environment", name: "MCP_BEARER_TOKEN" } } });
    const inlineReference = { ...form, headers: [{ key: "Authorization", value: "MCP_BEARER_TOKEN" }] };
    expect(validateMcpForm(inlineReference)).toBeUndefined();
    expect(mcpFormToConfig(inlineReference).transport).toMatchObject({ headers: { Authorization: { source: "environment", name: "MCP_BEARER_TOKEN" } } });
    const duplicateAuthorization = { ...form, bearerTokenEnv: "MCP_BEARER_TOKEN", headers: [{ key: "Authorization", value: "Bearer ctx7sk-token" }] };
    expect(validateMcpForm(duplicateAuthorization)).toBeUndefined();
    expect(mcpFormToConfig(duplicateAuthorization).transport).toMatchObject({ headers: { Authorization: { source: "environment", name: "MCP_BEARER_TOKEN" } } });
    const referenced = { ...form, headers: [{ key: "", value: "" }], headerEnv: [{ key: "Authorization", value: "MCP_BEARER_TOKEN" }] };
    expect(validateMcpForm(referenced)).toBeUndefined();
    expect(mcpFormToConfig(referenced).transport).toMatchObject({ headers: { Authorization: { source: "environment", name: "MCP_BEARER_TOKEN" } } });
  });
});
