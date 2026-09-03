import { useCallback, useEffect, useState } from "react";
import type { McpSafeServerDto, McpSettingsSnapshot } from "../../../../common/mcp";
import { emptyMcpForm, formFromMcpServer, mcpFormToConfig, validateMcpForm, type McpFormState } from "../mcpForm";
import { useI18n, type TranslationKey } from "../../i18n/I18nProvider";

export function useMcpSettings() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<McpSettingsSnapshot | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<McpFormState>(() => emptyMcpForm());
  const [editing, setEditing] = useState<McpSafeServerDto | null>(null);
  const [pendingRemove, setPendingRemove] = useState<McpSafeServerDto | null>(null);
  const [pendingConsent, setPendingConsent] = useState<McpSafeServerDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!window.api?.mcp) {
      setSnapshot(null);
      return;
    }
    try {
      setSnapshot(await window.api.mcp.list());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
    return window.api?.mcp?.onStatus(() => void reload());
  }, [reload]);

  function openForm(server?: McpSafeServerDto) {
    setEditing(server ?? null);
    setForm(server ? formFromMcpServer(server) : emptyMcpForm());
    setError(null);
    setFormOpen(true);
  }

  async function save() {
    const validation = validateMcpForm(form);
    if (validation) {
      setError(t(`settings.mcpValidation.${validation}` as TranslationKey));
      return;
    }
    const servers = snapshot?.servers ?? [];
    const config = mcpFormToConfig(form);
    const existing = servers.find((server) => server.config.id === config.id);
    setBusyId(form.id || "new");
    try {
      const result = await window.api.mcp.save(mcpFormToConfig(form, existing ? existing.config.revision + 1 : 1), {
        preserveSensitiveHeaders: form.apiKeyConfigured && !form.apiKey.trim() && !form.clearApiKey ? [form.apiKeyHeader] : [],
        clearSensitiveHeaders: form.clearApiKey ? [form.apiKeyHeader] : [],
        preserveEnvironmentNames: form.transport === "stdio" ? form.configuredEnvironmentNames.filter((name) => form.env.some((row) => row.key.trim().toUpperCase() === name && !row.value.trim())) : [],
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
    setBusyId(server.config.id);
    try {
      await window.api.mcp.setEnabled(server.config.id, !server.config.enabled);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function connect(server: McpSafeServerDto, reconnect = false) {
    setBusyId(server.config.id);
    setError(null);
    try {
      const result = reconnect ? await window.api.mcp.reconnect(server.config.id) : await window.api.mcp.test(server.config.id);
      if ((result.status as { state?: string } | undefined)?.state === "pending-consent") setPendingConsent(server);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function refresh(server: McpSafeServerDto) {
    setBusyId(server.config.id);
    setError(null);
    try {
      const result = await window.api.mcp.refresh(server.config.id);
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
    setBusyId(pendingConsent.config.id);
    try {
      await window.api.mcp.consent(pendingConsent.config.id, pendingConsent.config.revision);
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
    await window.api.mcp.remove(pendingRemove.config.id);
    setPendingRemove(null);
    await reload();
  }

  return { snapshot, formOpen, setFormOpen, form, setForm, editing, pendingRemove, setPendingRemove, pendingConsent, setPendingConsent, busyId, error, openForm, save, toggle, connect, refresh, consent, remove };
}
