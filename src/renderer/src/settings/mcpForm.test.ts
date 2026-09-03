import { describe, expect, it } from "vitest";
import { emptyMcpForm, formFromMcpServer, mcpFormToConfig, validateMcpForm } from "./mcpForm";

describe("MCP settings form", () => {
  it("uses a global screenshot-shaped form without project fields", () => {
    const form = emptyMcpForm();
    expect(form).toMatchObject({
      name: "",
      transport: "stdio",
      args: [""],
      env: [{ key: "", value: "" }],
      envRefs: [{ key: "", value: "" }],
      inheritEnv: [""],
      headers: [{ key: "", value: "" }],
      headerEnv: [{ key: "", value: "" }],
      bearerTokenEnv: "",
      apiKey: "",
      apiKeyHeader: "Authorization",
      apiKeyConfigured: false,
    });
    expect(form).not.toHaveProperty("bearerToken");
    expect(form).not.toHaveProperty("bearerCredentialSource");
    expect(form).not.toHaveProperty("scope");
    expect(form).not.toHaveProperty("displayName");
    expect(form).not.toHaveProperty("credentialName");
  });

  it("emits repeatable environment references, never credential values", () => {
    const form = { ...emptyMcpForm(), id: "notes", name: "Notes", command: "npx", envRefs: [{ key: "MCP_TOKEN", value: "TOKEN_ENV" }] };
    const config = mcpFormToConfig(form, 4);
    expect(config).toMatchObject({ revision: 4, name: "Notes", transport: { env: { MCP_TOKEN: { source: "environment", name: "TOKEN_ENV" } } } });
    expect(JSON.stringify(config)).not.toContain("secret-value");
  });

  it("emits direct stdio environment values from the APP form", () => {
    const form = { ...emptyMcpForm(), id: "notes", name: "Notes", command: "npx", env: [{ key: "MCP_TOKEN", value: "secret-value" }] };
    const config = mcpFormToConfig(form);
    expect(config.transport).toMatchObject({ env: { MCP_TOKEN: "secret-value" } });
  });

  it("rejects shell expressions and non-local HTTP", () => {
    expect(validateMcpForm({ ...emptyMcpForm(), id: "notes", name: "Notes", command: "node && rm -rf" })).toBe("invalid-command");
    expect(validateMcpForm({ ...emptyMcpForm(), id: "notes", name: "Notes", transport: "streamable-http", url: "http://remote.example/mcp" })).toBe("invalid-url");
  });

  it("accepts a direct HTTP API key and emits a bearer authorization header", () => {
    const form = { ...emptyMcpForm(), id: "remote", name: "Remote", transport: "streamable-http" as const, url: "https://mcp.example.com/mcp", apiKey: "plaintext" };
    expect(validateMcpForm(form)).toBeUndefined();
    expect(mcpFormToConfig(form).transport).toMatchObject({ headers: { Authorization: "Bearer plaintext" } });
  });

  it("accepts an API key header without forcing an environment reference", () => {
    const form = { ...emptyMcpForm(), id: "remote", name: "Remote", transport: "streamable-http" as const, url: "https://mcp.example.com/mcp", apiKeyHeader: "X-Api-Key" as const, apiKey: "plaintext" };
    expect(validateMcpForm(form)).toBeUndefined();
    expect(mcpFormToConfig(form).transport).toMatchObject({ headers: { "X-Api-Key": "plaintext" } });
  });

  it("keeps environment references as an advanced option", () => {
    const form = { ...emptyMcpForm(), id: "remote", name: "Remote", transport: "streamable-http" as const, url: "https://mcp.example.com/mcp", bearerTokenEnv: "MCP_BEARER_TOKEN" };
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

  it("uses an environment variable for HTTP Bearer auth, matching Codex config", () => {
    const form = { ...emptyMcpForm(), id: "remote", name: "Remote", transport: "streamable-http" as const, url: "https://mcp.example.com/mcp", bearerTokenEnv: "MCP_BEARER_TOKEN" };
    expect(mcpFormToConfig(form).transport).toMatchObject({ headers: { Authorization: { source: "environment", name: "MCP_BEARER_TOKEN" } } });
  });

  it("does not require re-entering a configured API key when editing", () => {
    const server = {
      config: {
        version: 1,
        id: "remote",
        name: "Remote",
        enabled: true,
        revision: 1,
        exposure: { mode: "all", allow: [], deny: [] },
        approval: { mode: "on-request", defaultScope: "once" },
        transport: {
          type: "streamable-http" as const,
          url: "https://mcp.example.com/mcp",
          headerNames: ["Authorization"],
          headerValues: [],
          credentialReferences: [],
        },
      },
      runtime: { serverId: "remote", state: "stopped", transport: "streamable-http", catalogRevision: 0, toolCount: 0, diagnostics: [], updatedAt: 1 },
      secrets: [],
    } as never;
    expect(formFromMcpServer(server).apiKey).toBe("");
    expect(formFromMcpServer(server).apiKeyConfigured).toBe(true);
  });
});
