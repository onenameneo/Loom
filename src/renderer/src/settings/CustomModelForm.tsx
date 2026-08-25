import { LoomCheckboxField, LoomSelect, LoomSelectItem } from "../ui/controls";
import { useI18n } from "../i18n/I18nProvider";

export function CustomModelForm({
  api,
  modelId,
  modelName,
  contextWindow,
  maxTokens,
  reasoning,
  images,
  editing,
  onApiChange,
  onModelIdChange,
  onModelNameChange,
  onContextWindowChange,
  onMaxTokensChange,
  onReasoningChange,
  onImagesChange,
}: {
  api: string;
  modelId: string;
  modelName: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  images: boolean;
  editing: boolean;
  onApiChange: (value: string) => void;
  onModelIdChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
  onContextWindowChange: (value: string) => void;
  onMaxTokensChange: (value: string) => void;
  onReasoningChange: (value: boolean) => void;
  onImagesChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="field">
        <span>API type</span>
        <LoomSelect value={api} onValueChange={onApiChange} placeholder={t("settings.chooseApiType")} ariaLabel="API type">
          <LoomSelectItem value="openai-completions">openai-completions</LoomSelectItem>
          <LoomSelectItem value="openai-responses">openai-responses</LoomSelectItem>
          <LoomSelectItem value="anthropic-messages">anthropic-messages</LoomSelectItem>
          <LoomSelectItem value="google-generative-ai">google-generative-ai</LoomSelectItem>
          <LoomSelectItem value="mistral-conversations">mistral-conversations</LoomSelectItem>
        </LoomSelect>
      </label>
      <label className="field"><span>Model</span><input value={modelId} onChange={(event) => onModelIdChange(event.target.value)} placeholder="gpt-5.2 / claude-sonnet-4-5 / llama" disabled={editing} /></label>
      <label className="field"><span>Model name</span><input value={modelName} onChange={(event) => onModelNameChange(event.target.value)} placeholder={t("settings.optionalDisplayName")} /></label>
      <label className="field"><span>Context window</span><input inputMode="numeric" value={contextWindow} onChange={(event) => onContextWindowChange(event.target.value)} /></label>
      <label className="field"><span>Max output</span><input inputMode="numeric" value={maxTokens} onChange={(event) => onMaxTokensChange(event.target.value)} /></label>
      <div className="settings-checks settings-grid__wide">
        <LoomCheckboxField checked={reasoning} onCheckedChange={onReasoningChange} label={t("settings.supportsReasoning")} />
        <LoomCheckboxField checked={images} onCheckedChange={onImagesChange} label={t("settings.supportsImages")} />
      </div>
    </>
  );
}
