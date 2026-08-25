import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { SettingsPayload } from "../env";
import type { SurfaceCtx } from "../surfaces";
import { ConfirmDialog, Modal } from "../ui/dialogs";
import { LoomSelect, LoomSelectGroup, LoomSelectItem } from "../ui/controls";
import { iconButtonClassName } from "../ui/styles";
import { useI18n } from "../i18n/I18nProvider";
import { CustomModelForm } from "./CustomModelForm";
import { ModelAuthenticationFields } from "./ModelAuthenticationFields";
import { ModelCapabilitySummary } from "./ModelCapabilitySummary";
import { ModelCatalogPicker } from "./ModelCatalogPicker";
import { ModelCatalogRefreshButton, type CatalogRefreshResult } from "./ModelCatalogRefreshButton";
import { ModelProviderPicker } from "./ModelProviderPicker";
import { configuredProviders, isCatalogSource, type RendererModel, type RendererProvider } from "./modelCatalogState";

type ModelEntryMode = "registry" | "custom";

function defaultApiForProvider(providerId: string) {
  if (providerId.includes("anthropic")) return "anthropic-messages";
  if (providerId.includes("google")) return "google-generative-ai";
  if (providerId.includes("mistral")) return "mistral-conversations";
  return "openai-completions";
}

function isProviderCatalogModel(model: RendererModel) {
  return isCatalogSource(model.source);
}

export function ModelSettingsPanel({ ctx, settings, selectedModel, onDefaultModelChange }: {
  ctx: Pick<SurfaceCtx, "reloadSettings">;
  settings: SettingsPayload;
  selectedModel: string;
  onDefaultModelChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const providers = settings.modelRegistry?.providers ?? [];
  const providerOptions = providers;
  const configured = configuredProviders(providers);
  const availableModels = configured.flatMap((provider) => provider.models.filter((model) => model.available));
  const hasPlaintextSecret = providers.some((provider) => provider.hasPlaintextSecret);
  const [addOpen, setAddOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<{ providerId: string; modelId: string } | null>(null);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<{ providerId: string; modelId: string; name: string } | null>(null);
  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [modelEntryMode, setModelEntryMode] = useState<ModelEntryMode>("registry");
  const [modelName, setModelName] = useState("");
  const [api, setApi] = useState("openai-completions");
  const [contextWindow, setContextWindow] = useState("131072");
  const [maxTokens, setMaxTokens] = useState("8192");
  const [reasoning, setReasoning] = useState(false);
  const [images, setImages] = useState(false);

  function applyModelDefaults(model: RendererModel | undefined, fallbackProviderId: string) {
    setModelId(model?.id ?? "");
    setSelectedModelIds(model ? [model.id] : []);
    setModelName(model?.name ?? "");
    setApi(model?.api ?? defaultApiForProvider(fallbackProviderId));
    setContextWindow(String(model?.capabilities.contextWindow ?? 131072));
    setMaxTokens(String(model?.capabilities.maxOutputTokens ?? 8192));
    setReasoning(Boolean(model?.capabilities.reasoning));
    setImages(Boolean(model?.capabilities.images));
  }

  function resetAddForm() {
    setEditingModel(null);
    setProviderId("");
    setBaseUrl("");
    setApiKey("");
    setModelId("");
    setSelectedModelIds([]);
    setModelEntryMode("registry");
    setModelName("");
    setApi("openai-completions");
    setContextWindow("131072");
    setMaxTokens("8192");
    setReasoning(false);
    setImages(false);
  }

  function openAddForm() {
    const firstProvider = providerOptions[0];
    setEditingModel(null);
    setModelEntryMode("registry");
    setProviderId(firstProvider?.id ?? "");
    setBaseUrl(firstProvider?.baseUrl ?? "");
    applyModelDefaults(firstProvider?.models[0], firstProvider?.id ?? "");
    setAddOpen(true);
  }

  function editProviderModel(provider: RendererProvider, model: RendererModel) {
    setEditingModel({ providerId: provider.id, modelId: model.id });
    setModelEntryMode("registry");
    setProviderId(provider.id);
    setBaseUrl(provider.baseUrl ?? "");
    applyModelDefaults(model, provider.id);
    setApiKey("");
    setAddOpen(true);
  }

  function selectProvider(nextProviderId: string) {
    const nextProvider = providerOptions.find((provider) => provider.id === nextProviderId);
    setModelEntryMode("registry");
    setProviderId(nextProviderId);
    setBaseUrl(nextProvider?.baseUrl ?? "");
    applyModelDefaults(nextProvider?.models[0], nextProviderId);
  }

  function setRegistryModelSelection(nextModelIds: string[]) {
    const selectedProvider = providerOptions.find((provider) => provider.id === providerId);
    const selectedModel = selectedProvider?.models.find((model) => model.id === nextModelIds[0]);
    applyModelDefaults(selectedModel, providerId);
    setSelectedModelIds(nextModelIds);
    setModelId(nextModelIds[0] ?? "");
  }

  function openCustomModelForm() {
    setModelEntryMode("custom");
    setSelectedModelIds([]);
    setModelId("");
    setModelName("");
    setApi(defaultApiForProvider(providerId));
    setContextWindow("131072");
    setMaxTokens("8192");
    setReasoning(false);
    setImages(false);
  }

  async function addProviderModel() {
    const cleanProviderId = providerId.trim();
    const cleanModelId = modelId.trim();
    const cleanBaseUrl = baseUrl.trim();
    if (!cleanProviderId || !cleanBaseUrl) return;
    const selectedProvider = providerOptions.find((provider) => provider.id === cleanProviderId);
    const providerModels = selectedProvider?.models ?? [];
    const useRegistryModel = modelEntryMode === "registry" && providerModels.length > 0;
    if (useRegistryModel) {
      const selectedModels = providerModels.filter((model) => selectedModelIds.includes(model.id));
      if (selectedModels.length === 0) return;
      for (const model of selectedModels) {
        await window.api.settings.addProviderModel({
          providerId: cleanProviderId,
          providerName: selectedProvider?.name,
          baseUrl: cleanBaseUrl,
          apiKey: apiKey.trim() || undefined,
          modelId: model.id,
          modelName: model.name,
          api: model.api,
          contextWindow: model.capabilities.contextWindow,
          maxTokens: model.capabilities.maxOutputTokens,
          reasoning: model.capabilities.reasoning,
          images: model.capabilities.images,
          modelFromProvider: isProviderCatalogModel(model),
        });
      }
    } else {
      if (!cleanModelId) return;
      await window.api.settings.addProviderModel({
        providerId: cleanProviderId,
        providerName: selectedProvider?.name,
        baseUrl: cleanBaseUrl,
        apiKey: apiKey.trim() || undefined,
        modelId: cleanModelId,
        modelName: modelName.trim() || cleanModelId,
        api,
        contextWindow: Number(contextWindow) || 0,
        maxTokens: Number(maxTokens) || 0,
        reasoning,
        images,
        modelFromProvider: false,
      });
    }
    setAddOpen(false);
    resetAddForm();
    ctx.reloadSettings();
  }

  async function deleteProviderModel(providerIdToDelete: string, modelIdToDelete: string) {
    await window.api.settings.deleteProviderModel({ providerId: providerIdToDelete, modelId: modelIdToDelete });
    ctx.reloadSettings();
  }

  async function refreshCatalog(): Promise<CatalogRefreshResult | void> {
    if (!window.api?.settings.refreshModelCatalog) return;
    const result = await window.api.settings.refreshModelCatalog();
    ctx.reloadSettings();
    return result;
  }

  const selectedProvider = providerOptions.find((provider) => provider.id === providerId);
  const providerModelOptions = selectedProvider?.models ?? [];
  const selectedModelOption = providerModelOptions.find((model) => model.id === modelId);
  const useRegistryModel = modelEntryMode === "registry" && providerModelOptions.length > 0;
  const selectedRegistryModels = providerModelOptions.filter((model) => selectedModelIds.includes(model.id));
  const canSaveModel = providerOptions.length > 0 && Boolean(providerId.trim()) && Boolean(baseUrl.trim()) && (useRegistryModel ? selectedModelIds.length > 0 : Boolean(modelId.trim()));

  return (
    <>
      <section className="model-config">
        <div className="model-config__head">
          <div>
            <h3>{t("settings.modelConfig")}</h3>
            <p>{t("settings.manageModels")}</p>
          </div>
          <div className="settings-inline">
              <ModelCatalogRefreshButton onRefresh={refreshCatalog} label="刷新模型目录" />
            <button className={iconButtonClassName("primary")} type="button" onClick={openAddForm} aria-label={t("settings.addModel")} title={t("settings.addModel")}><Plus size={17} /></button>
          </div>
        </div>

        <div className="model-config__block">
          <div className="model-config__label">{t("settings.configuredModels")}</div>
          <div className="connection-list">
            {configured.map((provider) => (
              <div key={provider.id} className="connection-row">
                <div className="connection-main">
                  <div className="connection-title-row">
                    <div>
                      <div className="connection-name">{provider.name}</div>
                      <div className="connection-meta">{provider.id} · {provider.source} · {provider.baseUrl || t("settings.defaultBaseUrl")}</div>
                    </div>
                    <span className={`status-pill ${provider.availability}`}>{provider.availability === "available" ? t("settings.connected") : provider.availability}</span>
                  </div>
                  <div className="model-chip-row">
                    {provider.models.map((model) => (
                      <span key={model.id} className={`model-chip ${model.available ? "" : "empty"}`}>
                        <span>{model.name}</span>
                        <button className={iconButtonClassName()} type="button" onClick={() => editProviderModel(provider, model)} aria-label={t("settings.edit")} title={`${t("settings.edit")} ${model.name}`}><Pencil size={13} /></button>
                        <button className={iconButtonClassName("danger")} type="button" onClick={() => setPendingDeleteModel({ providerId: provider.id, modelId: model.id, name: model.name })} aria-label={t("nav.delete")} title={`${t("nav.delete")} ${model.name}`}><Trash2 size={13} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {configured.length === 0 && <div className="empty-state"><div className="empty-state__title">{t("settings.noModels")}</div><div className="empty-state__body">{t("settings.noModelsBody")}</div></div>}
          </div>
        </div>

        <div className="model-config__block">
          <label className="field">
            <span>{t("settings.defaultModel")} <em className="src">{availableModels.length} {t("settings.configuredModels")}</em></span>
            <LoomSelect value={selectedModel || "__auto__"} onValueChange={(value) => onDefaultModelChange(value === "__auto__" ? "" : value)} disabled={availableModels.length === 0} placeholder={availableModels.length === 0 ? t("settings.noAvailableModels") : t("settings.autoFirstModel")} ariaLabel={t("settings.defaultModel")}>
              <LoomSelectItem value="__auto__">{availableModels.length === 0 ? t("settings.noAvailableModels") : t("settings.autoFirstModel")}</LoomSelectItem>
              {configured.map((provider) => {
                const models = provider.models.filter((model) => model.available);
                if (models.length === 0) return null;
                return <LoomSelectGroup key={provider.id} label={provider.name}>{models.map((model) => <LoomSelectItem key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>{model.name} · {model.capabilities.contextWindow.toLocaleString()} ctx · {model.capabilities.maxOutputTokens.toLocaleString()} out</LoomSelectItem>)}</LoomSelectGroup>;
              })}
            </LoomSelect>
          </label>
          {availableModels.length === 0 && <div className="ok-note">{t("settings.successfulModelsOnly")}</div>}
        </div>
        {settings.legacyKeyPresent && <div className="warn-note">{t("settings.legacyKey")}</div>}
        {hasPlaintextSecret && <div className="warn-note">{t("settings.plaintextSecret")}</div>}
      </section>

      <Modal open={addOpen} onOpenChange={setAddOpen} ariaLabel={t("settings.modelDialogAria")}>
        <div className="settings-modal__panel">
          <div className="settings-modal__head">
            <h3>{editingModel ? t("settings.editModel") : t("settings.addModel")}</h3>
            <button className={iconButtonClassName()} type="button" onClick={() => setAddOpen(false)} aria-label={t("settings.close")} title={t("settings.close")}><X size={16} /></button>
          </div>
          {providerOptions.length === 0 && <div className="empty-state compact"><div className="empty-state__title">{t("settings.noProvider")}</div><div className="empty-state__body">{t("settings.emptyRegistry")}</div></div>}
          <div className="settings-grid">
            <label className="field">
              <span>Provider</span>
              <ModelProviderPicker providers={providerOptions} value={providerId} onChange={selectProvider} disabled={providerOptions.length === 0 || Boolean(editingModel)} placeholder={t("settings.chooseProvider")} ariaLabel="Provider" />
            </label>
            <ModelAuthenticationFields baseUrl={baseUrl} apiKey={apiKey} onBaseUrlChange={setBaseUrl} onApiKeyChange={setApiKey} />
            {useRegistryModel ? (
              <>
                {editingModel ? <div className="field model-static"><span>{t("settings.modelConfig")}</span><div className="model-static__value"><strong>{selectedModelOption?.name ?? modelId}</strong><em>{selectedModelOption?.id ?? modelId}</em></div></div> : <ModelCatalogPicker models={providerModelOptions} selectedIds={selectedModelIds} onToggle={(nextId) => setRegistryModelSelection(selectedModelIds.includes(nextId) ? selectedModelIds.filter((id) => id !== nextId) : [...selectedModelIds, nextId])} onSelectAll={() => setRegistryModelSelection(providerModelOptions.map((model) => model.id))} onClear={() => setRegistryModelSelection([])} onAddCustom={openCustomModelForm} editing={Boolean(editingModel)} selectedCountLabel={t("settings.selectedCount")} selectAllLabel={t("settings.selectAll")} clearLabel={t("settings.clear")} addCustomLabel={t("settings.addCustomModel")} />}
                <ModelCapabilitySummary models={selectedRegistryModels} emptyLabel={t("settings.selectAtLeastOne")} sharedLabel={t("settings.modelsWillShare", { count: selectedRegistryModels.length })} />
              </>
            ) : (
              <>
                {providerModelOptions.length > 0 && !editingModel && <div className="model-entry-mode settings-grid__wide"><button type="button" onClick={() => { setModelEntryMode("registry"); applyModelDefaults(providerModelOptions[0], providerId); }}>{t("settings.backToProviderModels")}</button></div>}
                <CustomModelForm api={api} modelId={modelId} modelName={modelName} contextWindow={contextWindow} maxTokens={maxTokens} reasoning={reasoning} images={images} editing={Boolean(editingModel)} onApiChange={setApi} onModelIdChange={setModelId} onModelNameChange={setModelName} onContextWindowChange={setContextWindow} onMaxTokensChange={setMaxTokens} onReasoningChange={setReasoning} onImagesChange={setImages} />
              </>
            )}
          </div>
          <div className="settings-foot"><button className={iconButtonClassName("primary")} type="button" onClick={() => void addProviderModel()} disabled={!canSaveModel} aria-label={t("settings.saveModel")} title={t("settings.saveModel")}><Check size={16} /></button></div>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(pendingDeleteModel)} onOpenChange={(open) => { if (!open) setPendingDeleteModel(null); }} title={t("settings.deleteModel")} description={pendingDeleteModel ? t("settings.deleteModelDescription", { name: pendingDeleteModel.name }) : undefined} onConfirm={() => { if (!pendingDeleteModel) return; void deleteProviderModel(pendingDeleteModel.providerId, pendingDeleteModel.modelId); setPendingDeleteModel(null); }} />
    </>
  );
}
