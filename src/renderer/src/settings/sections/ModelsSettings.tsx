import { useEffect, useState } from "react";
import type { SurfaceCtx } from "../../surfaces";
import { useI18n } from "../../i18n/I18nProvider";
import { buttonClassName } from "../../ui/styles";
import { ModelSettingsPanel } from "../ModelSettingsPanel";
import { SettingsSaveBar } from "../components/SettingsSection";

export function ModelsSettings({ ctx }: { ctx: SurfaceCtx }) {
  const { t } = useI18n();
  const settings = ctx.settings;
  const [selectedModel, setSelectedModel] = useState("");
  const [saved, setSaved] = useState(false);
  const currentModel = settings?.globalDefaultModel ? `${settings.globalDefaultModel.providerId}/${settings.globalDefaultModel.modelId}` : "";

  useEffect(() => setSelectedModel(currentModel), [currentModel]);

  async function saveDefaultModel() {
    if (!selectedModel || selectedModel === currentModel) return;
    const [providerId, modelId] = selectedModel.split("/");
    if (!providerId || !modelId || !window.api?.settings?.setGlobalModel) return;
    await window.api.settings.setGlobalModel({ providerId, modelId });
    ctx.reloadSettings();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  if (!settings) return null;
  const dirty = selectedModel !== currentModel;
  return (
    <>
      <ModelSettingsPanel ctx={ctx} settings={settings} selectedModel={selectedModel} onDefaultModelChange={setSelectedModel} showHeader={false} />
      <div className="settings-save-bar">
        <div className="settings-save-bar__status" aria-live="polite">{saved && <span className="settings-save-bar__saved">{t("settings.saved")}</span>}</div>
        <button className={buttonClassName("primary")} type="button" onClick={() => void saveDefaultModel()} disabled={!dirty}>{t("settings.saveDefaultModel")}</button>
      </div>
    </>
  );
}
