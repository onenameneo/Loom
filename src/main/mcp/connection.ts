import { Client, SSEClientTransport, StreamableHTTPClientTransport, type AuthProvider, type OAuthClientProvider, type Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { redactMcpText, createMcpSecretStore, type McpSecretStore } from "./secrets";
import type { McpServerConfig, McpSecretReference } from "./config";
import type { McpConnectionConsent, McpConnectionState, McpDiagnostic, McpServerRuntimeStatus } from "./types";

export type McpTransportKind = "stdio" | "streamable-http" | "sse";

export interface McpToolListPage {
  tools: unknown[];
  nextCursor?: string;
}

export interface McpClientLike {
  connect(transport: McpTransportLike): Promise<void>;
  close(): Promise<void>;
  listTools(params?: { cursor?: string }, options?: { signal?: AbortSignal }): Promise<McpToolListPage>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }, options?: { signal?: AbortSignal }): Promise<unknown>;
  getServerCapabilities?(): Record<string, unknown> | undefined;
  getServerVersion?(): { name?: string; version?: string } | undefined;
}

export interface McpTransportLike {
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  pid?: number | null;
}

export interface McpClientFactoryContext {
  server: McpServerConfig;
  transportKind: McpTransportKind;
  onToolsChanged?: (error?: Error) => void;
}

export interface McpClientFactoryResult {
  client: McpClientLike;
  transport: McpTransportLike;
  transportKind: McpTransportKind;
}

export type McpClientFactory = (context: McpClientFactoryContext) => Promise<McpClientFactoryResult>;

export interface McpConnectionHandle {
  readonly serverId: string;
  readonly client: McpClientLike;
  readonly transport: McpTransportLike;
  readonly transportKind: McpTransportKind;
  readonly state: McpConnectionState;
  listTools(options?: { signal?: AbortSignal }): Promise<McpToolListPage>;
  callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpConnectionManagerOptions {
  create?: McpClientFactory;
  requestConsent?: (consent: McpConnectionConsent) => boolean | Promise<boolean>;
  isConsentPersisted?: (serverId: string, configRevision: number) => boolean;
  persistConsent?: (serverId: string, configRevision: number) => void;
  onStatus?: (status: McpServerRuntimeStatus) => void;
  onToolsChanged?: (serverId: string, error?: Error) => void;
  timeoutMs?: number;
  reconnectBaseMs?: number;
  maxReconnectAttempts?: number;
  redact?: (value: string) => string;
}

export interface McpConnectionManager {
  connect(server: McpServerConfig, options?: { force?: boolean; signal?: AbortSignal }): Promise<McpConnectionHandle | undefined>;
  approveConsent(serverId: string, configRevision: number): void;
  status(serverId: string): McpServerRuntimeStatus;
  close(serverId: string): Promise<void>;
  closeAll(): Promise<void>;
}

interface ConnectionRecord {
  server: McpServerConfig;
  state: McpConnectionState;
  client?: McpClientLike;
  transport?: McpTransportLike;
  transportKind?: McpTransportKind;
  handle?: McpConnectionHandle;
  connectPromise?: Promise<McpConnectionHandle | undefined>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectAttempts: number;
  closed: boolean;
  diagnostics: McpDiagnostic[];
  consentRevision?: number;
  updatedAt: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  const error = new Error("MCP operation was cancelled.");
  error.name = "AbortError";
  return error;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new Error(`MCP operation timed out after ${timeoutMs}ms.`))), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}

function diagnostic(code: McpDiagnostic["code"], message: string, retryable: boolean, at: number): McpDiagnostic {
  return { code, message: message.slice(0, 500), retryable, at };
}

function configuredSecretReferences(transport: McpServerConfig["transport"]): McpSecretReference[] {
  if (transport.type === "stdio") return Object.values(transport.env ?? {});
  return Object.values(transport.headers ?? {}).filter((value): value is McpSecretReference => typeof value === "object");
}

function createStatus(record: ConnectionRecord): McpServerRuntimeStatus {
  return {
    serverId: record.server.id,
    state: record.state,
    transport: record.server.transport.type,
    catalogRevision: 0,
    toolCount: 0,
    configuredSecretRefs: configuredSecretReferences(record.server.transport),
    diagnostics: [...record.diagnostics],
    consentRevision: record.consentRevision,
    updatedAt: record.updatedAt,
  };
}

function consentFor(server: McpServerConfig): McpConnectionConsent {
  if (server.transport.type !== "stdio") {
    return {
      serverId: server.id,
      configRevision: server.revision,
      environmentNames: [],
      privilegeWarning: "This MCP server can access data and services available to Loom.",
    };
  }
  return {
    serverId: server.id,
    configRevision: server.revision,
    command: server.transport.command,
    args: [...server.transport.args],
    cwd: server.transport.cwd,
    environmentNames: [...new Set([...Object.keys(server.transport.env ?? {}), ...(server.transport.inheritEnv ?? [])])].sort(),
    privilegeWarning: "This local MCP server runs with the client's operating-system privileges.",
  };
}

export function createMcpConnectionManager(options: McpConnectionManagerOptions = {}): McpConnectionManager {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  const redact = options.redact ?? ((value: string) => redactMcpText(value));
  const connections = new Map<string, ConnectionRecord>();
  const consented = new Set<string>();

  const emit = (record: ConnectionRecord) => {
    record.updatedAt = Date.now();
    options.onStatus?.(createStatus(record));
  };

  const setState = (record: ConnectionRecord, state: McpConnectionState, nextDiagnostic?: McpDiagnostic) => {
    record.state = state;
    if (nextDiagnostic) record.diagnostics = [...record.diagnostics.slice(-7), nextDiagnostic];
    emit(record);
  };

  const closeCreated = async (created: McpClientFactoryResult | undefined) => {
    if (!created) return;
    await Promise.allSettled([created.client.close(), created.transport.close()]);
  };

  const scheduleReconnect = (record: ConnectionRecord) => {
    if (record.closed || record.reconnectTimer || record.reconnectAttempts >= maxReconnectAttempts || !record.server.enabled) return;
    const delay = Math.min(reconnectBaseMs * 2 ** record.reconnectAttempts, 30_000);
    record.reconnectAttempts += 1;
    record.reconnectTimer = setTimeout(() => {
      record.reconnectTimer = undefined;
      void manager.connect(record.server, { force: true }).catch(() => undefined);
    }, delay);
  };

  const attachTransport = (record: ConnectionRecord, created: McpClientFactoryResult) => {
    record.client = created.client;
    record.transport = created.transport;
    record.transportKind = created.transportKind;
    created.transport.onclose = () => {
      if (record.closed || record.state === "stopped") return;
      setState(record, "degraded", diagnostic("server-exit", "MCP transport closed unexpectedly.", true, Date.now()));
      scheduleReconnect(record);
    };
    created.transport.onerror = (error) => {
      if (record.closed || record.state === "stopped") return;
      setState(record, "degraded", diagnostic("transport", redact(errorMessage(error)), true, Date.now()));
    };
    if (created.transport.stderr?.on) {
      created.transport.stderr.on("data", (chunk) => {
        const text = redact(String(chunk)).trim();
        if (text) setState(record, record.state, diagnostic("transport", `stdio: ${text}`, true, Date.now()));
      });
    }
  };

  const connectRecord = async (record: ConnectionRecord, signal?: AbortSignal): Promise<McpConnectionHandle | undefined> => {
    if (!record.server.enabled) {
      setState(record, "disabled");
      return undefined;
    }

    if (record.server.transport.type === "stdio") {
      const consentKey = `${record.server.id}:${record.server.revision}`;
      const persistedConsent = options.isConsentPersisted?.(record.server.id, record.server.revision) === true;
      if (persistedConsent) record.consentRevision = record.server.revision;
      if (!consented.has(consentKey) && !persistedConsent) {
        setState(record, "pending-consent", diagnostic("consent-required", "Connection consent is required before starting this local MCP server.", false, Date.now()));
        const approved = await options.requestConsent?.(consentFor(record.server));
        if (!approved) return undefined;
        consented.add(consentKey);
        record.consentRevision = record.server.revision;
        options.persistConsent?.(record.server.id, record.server.revision);
      }
    }

    setState(record, "connecting");
    let created: McpClientFactoryResult | undefined;
    try {
      const transportKind: McpTransportKind = record.server.transport.type === "stdio" ? "stdio" : "streamable-http";
      created = await withTimeout((options.create ?? createMcpSdkClientFactory())({ server: record.server, transportKind, onToolsChanged: (error) => options.onToolsChanged?.(record.server.id, error) }), timeoutMs, signal);
      attachTransport(record, created);
      await withTimeout(created.client.connect(created.transport), timeoutMs, signal);
    } catch (firstError) {
      await closeCreated(created);
      const message = redact(errorMessage(firstError));
      const timedOut = message.includes("timed out");
      setState(record, "failed", diagnostic(timedOut ? "timeout" : "initialization", message, true, Date.now()));
      throw new Error(`MCP connection failed: ${message}`, { cause: firstError });
    }

    if (!created) throw new Error("MCP connection factory returned no connection.");
    record.reconnectAttempts = 0;
    setState(record, "connected");
    const handle: McpConnectionHandle = {
      serverId: record.server.id,
      client: created.client,
      transport: created.transport,
      transportKind: created.transportKind,
      get state() {
        return record.state;
      },
      listTools: (callOptions) => withTimeout(created!.client.listTools(undefined, callOptions), timeoutMs, callOptions?.signal),
      callTool: (name, args, callOptions) => withTimeout(created!.client.callTool({ name, arguments: args }, callOptions), timeoutMs, callOptions?.signal),
      close: () => manager.close(record.server.id),
    };
    record.handle = handle;
    return handle;
  };

  const manager: McpConnectionManager = {
    approveConsent(serverId, configRevision) {
      consented.add(`${serverId}:${configRevision}`);
      options.persistConsent?.(serverId, configRevision);
    },
    async connect(server, connectOptions = {}) {
      let record = connections.get(server.id);
      if (record && record.state === "connected" && !connectOptions.force) {
        return record.handle;
      }
      if (record?.connectPromise && !connectOptions.force) return record.connectPromise;
      if (record) await manager.close(server.id);
      record = {
        server,
        state: server.enabled ? "stopped" : "disabled",
        reconnectAttempts: 0,
        closed: false,
        diagnostics: [],
        updatedAt: Date.now(),
      };
      connections.set(server.id, record);
      record.connectPromise = connectRecord(record, connectOptions.signal);
      return record.connectPromise;
    },
    status(serverId) {
      const record = connections.get(serverId);
      if (record) return createStatus(record);
      return {
        serverId,
        state: "stopped",
        transport: "stdio",
        catalogRevision: 0,
        toolCount: 0,
        configuredSecretRefs: [],
        diagnostics: [],
        updatedAt: Date.now(),
      };
    },
    async close(serverId) {
      const record = connections.get(serverId);
      if (!record) return;
      record.closed = true;
      if (record.reconnectTimer) clearTimeout(record.reconnectTimer);
      record.reconnectTimer = undefined;
      setState(record, "stopped");
      await Promise.allSettled([record.client?.close(), record.transport?.close()]);
      record.client = undefined;
      record.transport = undefined;
      record.handle = undefined;
    },
    async closeAll() {
      await Promise.all([...connections.values()].map((record) => manager.close(record.server.id)));
    },
  };

  return manager;
}

export interface McpSdkClientFactoryOptions {
  secretStore?: McpSecretStore;
  environment?: NodeJS.ProcessEnv;
  clientVersion?: string;
  oauthProvider?: (profile: string) => OAuthClientProvider | undefined;
}

async function resolveReference(store: McpSecretStore, reference: McpSecretReference): Promise<string> {
  const value = await store.resolve(reference);
  if (!value) throw new Error(`Configured MCP secret is missing (${reference.source}).`);
  return value;
}

async function remoteTransportOptions(server: McpServerConfig, options: McpSdkClientFactoryOptions): Promise<{ authProvider?: AuthProvider | OAuthClientProvider; requestInit?: RequestInit }> {
  if (server.transport.type !== "streamable-http") return {};
  const secretStore = options.secretStore ?? createMcpSecretStore({ environment: options.environment });
  const headers: Record<string, string> = {};
  let authProvider: AuthProvider | OAuthClientProvider | undefined;
  for (const [name, value] of Object.entries(server.transport.headers ?? {})) {
    if (typeof value === "string") {
      headers[name] = value;
      continue;
    }
    if (value.source === "oauth") authProvider = options.oauthProvider?.(value.profile);
    if (name.toLowerCase() === "authorization" && authProvider) continue;
    if (name.toLowerCase() === "authorization") {
      authProvider = { token: () => resolveReference(secretStore, value) };
      continue;
    }
    headers[name] = await resolveReference(secretStore, value);
  }
  return { authProvider, ...(Object.keys(headers).length ? { requestInit: { headers } } : {}) };
}

export function createMcpSdkClientFactory(options: McpSdkClientFactoryOptions = {}): McpClientFactory {
  const version = options.clientVersion ?? "0.0.0";
  return async (context) => {
    const onToolsChanged = context.onToolsChanged;
    const sdkClient = new Client(
      { name: "loom", version },
      { listChanged: { tools: { autoRefresh: false, onChanged: (error) => onToolsChanged?.(error ?? undefined) } } },
    );
    let sdkTransport: Transport;
    if (context.transportKind === "stdio") {
      const transport = context.server.transport;
      if (transport.type !== "stdio") throw new Error("stdio transport requested for a non-stdio MCP server.");
      const secretStore = options.secretStore ?? createMcpSecretStore({ environment: options.environment });
      const env: Record<string, string> = {};
      for (const name of transport.inheritEnv ?? []) {
        const value = (options.environment ?? process.env)[name];
        if (value !== undefined) env[name] = value;
      }
      for (const [name, reference] of Object.entries(transport.env ?? {})) env[name] = await resolveReference(secretStore, reference);
      sdkTransport = new StdioClientTransport({ command: transport.command, args: transport.args, ...(transport.cwd ? { cwd: transport.cwd } : {}), env, stderr: "pipe" });
    } else {
      if (context.server.transport.type !== "streamable-http") throw new Error("HTTP transport requested for a non-HTTP MCP server.");
      const auth = await remoteTransportOptions(context.server, options);
      const url = new URL(context.server.transport.url);
      sdkTransport = context.transportKind === "sse"
        ? new SSEClientTransport(url, auth)
        : new StreamableHTTPClientTransport(url, { ...auth, onInsufficientScope: "throw" });
    }
    const client: McpClientLike = {
      connect: (transport) => sdkClient.connect(transport as unknown as Transport),
      close: () => sdkClient.close(),
      listTools: async (params, callOptions) => {
        const result = await sdkClient.listTools(params, callOptions);
        return { tools: result.tools as unknown[], nextCursor: result.nextCursor };
      },
      callTool: (params, callOptions) => sdkClient.callTool(params, callOptions),
      getServerCapabilities: () => sdkClient.getServerCapabilities() as Record<string, unknown> | undefined,
      getServerVersion: () => sdkClient.getServerVersion(),
    };
    return { client, transport: sdkTransport, transportKind: context.transportKind };
  };
}
