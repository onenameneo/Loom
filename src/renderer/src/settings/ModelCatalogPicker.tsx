import { useMemo, useState } from "react";
import { LoomCheckbox } from "../ui/controls";
import type { RendererModel } from "./modelCatalogState";

export function ModelCatalogPicker({
  models,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  onAddCustom,
  editing,
  selectedCountLabel,
  selectAllLabel,
  clearLabel,
  addCustomLabel,
  searchPlaceholder = "搜索模型",
}: {
  models: RendererModel[];
  selectedIds: string[];
  onToggle: (modelId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onAddCustom: () => void;
  editing: boolean;
  selectedCountLabel: string;
  selectAllLabel: string;
  clearLabel: string;
  addCustomLabel: string;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return models;
    return models.filter((model) => `${model.name} ${model.id} ${model.api}`.toLowerCase().includes(normalized));
  }, [models, query]);
  return (
    <div className="field settings-grid__wide">
      <span>
        Model <em className="src">{selectedIds.length}/{models.length} {selectedCountLabel}</em>
      </span>
      <div className="model-picker" role="group" aria-label="Model">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
        {(models.length > 1 || (!editing && models.length > 0)) && (
          <div className="model-picker__toolbar">
            {models.length > 1 && <button type="button" onClick={onSelectAll}>{selectAllLabel}</button>}
            {models.length > 1 && <button type="button" onClick={onClear}>{clearLabel}</button>}
            {!editing && <button type="button" onClick={onAddCustom}>{addCustomLabel}</button>}
          </div>
        )}
        <div className="model-picker__list">
          {filteredModels.map((model) => {
            const checked = selectedIds.includes(model.id);
            return (
              <label key={model.id} className={`model-option ${checked ? "selected" : ""}`}>
                <LoomCheckbox id={`model-option-${model.id}`} checked={checked} onCheckedChange={() => onToggle(model.id)} ariaLabel={model.name} />
                <span className="model-option__main"><strong>{model.name}</strong><em>{model.id}</em></span>
                <span className="model-option__tags">
                  <span>{model.api}</span>
                  <span>{model.capabilities.contextWindow.toLocaleString()} ctx</span>
                  <span>{model.capabilities.maxOutputTokens.toLocaleString()} out</span>
                  {model.capabilities.reasoning && <span>reasoning</span>}
                  {model.capabilities.images && <span>image</span>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
