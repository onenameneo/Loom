import { useCallback, useEffect, useRef, useState } from "react";
import type { McpSafeServerDto, McpSettingsSnapshot } from "../../../../common/mcp";
import { emptyMcpForm, formFromMcpServer, mcpFormToConfig, validateMcpForm, type McpFormState } from "../mcpForm";
import { useI18n, type TranslationKey } from "../../i18n/I18nProvider";

export function useMcpSettings(activeProjectId?: string) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<McpSettingsSnapshot | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<McpFormState>(() => emptyMcpForm());
  const [editing, setEditing] = useState<McpSafeServerDto | null>(null);
  const [pendingRemove, setPendingRemove] = useState<McpSafeServerDto | null>(null);
  const [pendingConsent, setPendingConsent] = useState<McpSafeServerDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!window.api?.mcp) {
      setSnapshot(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    try {
      const nextSnapshot = await window.api.mcp.list(activeProjectId);
      if (requestId !== requestIdRef.current) return;
      setSnapshot(nextSnapshot);
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [activeProjectId]);

  useEffect(() => {
    void reload();
    return window.api?.mcp?.onStatus(() => void reload());
  }, [reload]);

  useEffect(() => {
    setPendingRemove(null);
    setPendingConsent(null);
  }, [activeProjectId]);

  function openForm(server?: McpSafeServerDto) {
    setEditing(server ?? null);
    setForm(server ? formFromMcpServer(server) : emptyMcpForm());
    setError(null);
    setFormOpen(true);
  }

  const contextFor = (server: McpSafeServerDto) => ({
    scope: server.scope,
    projectId: server.scope === "project" ? (server.projectId ?? activeProjectId) : undefined,
  });
  const keyFor = (server: Pick<McpSafeServerDto, "scope" | "config">) => `${server.scope}:${server.config.id}`;

  async function save() {
    const validation = validateMcpForm(form);
    if (validation) {
      setError(t(`settings.mcpValidation.${validation}` as TranslationKey));
      return;
    }
    const servers = snapshot?.servers ?? [];
    const config = mcpFormToConfig(form);
    if (form.scope === "project" && !activeProjectId) {
      setError(t("settings.mcpProjectRequired"));
      return;
    }
    const existing = servers.find((server) => server.config.id === config.id && server.scope === form.scope);
    setBusyId(`${form.scope}:${form.id || "new"}`);
    try {
      const result = await window.api.mcp.save(mcpFormToConfig(form, existing ? existing.config.revision + 1 : 1), {
        preserveSensitiveHeaders: form.apiKeyConfigured && !form.apiKey.trim() && !form.clearApiKey ? [form.apiKeyHeader] : [],
        clearSensitiveHeaders: form.clearApiKey ? [form.apiKeyHeader] : [],
        preserveEnvironmentNames: form.transport === "stdio" ? form.configuredEnvironmentNames.filter((name) => form.env.some((row) => row.key.trim().toUpperCase() === name && !row.value.trim())) : [],
        scope: form.scope,
        projectId: form.scope === "project" ? activeProjectId : undefined,
      });
      if (!result.ok) {
        setError(result.issues?.map((issue) => `${issue.path}: ${issue.message}`).join(" · ") || t("settings.mcpConnectionFailed"));
        return;
      }
      setFormOpen(false);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(server: McpSafeServerDto) {
    setBusyId(keyFor(server));
    try {
      if (server.scope === "project") await window.api.mcp.setEnabled(server.config.id, !server.config.enabled, contextFor(server));
      else await window.api.mcp.setEnabled(server.config.id, !server.config.enabled);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function connect(server: McpSafeServerDto, reconnect = false) {
    setBusyId(keyFor(server));
    setError(null);
    try {
      const result = reconnect
        ? server.scope === "project" ? await window.api.mcp.reconnect(server.config.id, undefined, contextFor(server)) : await window.api.mcp.reconnect(server.config.id)
        : server.scope === "project" ? await window.api.mcp.test(server.config.id, undefined, contextFor(server)) : await window.api.mcp.test(server.config.id);
      if ((result.status as { state?: string } | undefined)?.state === "pending-consent") setPendingConsent(server);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function refresh(server: McpSafeServerDto) {
    setBusyId(keyFor(server));
    setError(null);
    try {
      const result = server.scope === "project" ? await window.api.mcp.refresh(server.config.id, undefined, contextFor(server)) : await window.api.mcp.refresh(server.config.id);
      if ((result.status as { state?: string } | undefined)?.state === "pending-consent") setPendingConsent(server);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function consent() {
    if (!pendingConsent) return;
    setBusyId(keyFor(pendingConsent));
    try {
      if (pendingConsent.scope === "project") await window.api.mcp.consent(pendingConsent.config.id, pendingConsent.config.revision, contextFor(pendingConsent));
      else await window.api.mcp.consent(pendingConsent.config.id, pendingConsent.config.revision);
      setPendingConsent(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!pendingRemove) return;
    if (pendingRemove.scope === "project") await window.api.mcp.remove(pendingRemove.config.id, contextFor(pendingRemove));
    else await window.api.mcp.remove(pendingRemove.config.id);
    setPendingRemove(null);
    await reload();
  }

  return { snapshot, formOpen, setFormOpen, form, setForm, editing, pendingRemove, setPendingRemove, pendingConsent, setPendingConsent, busyId, error, openForm, save, toggle, connect, refresh, consent, remove };
}
