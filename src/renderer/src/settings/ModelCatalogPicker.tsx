import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
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
  const selectedModels = models.filter((model) => selectedIds.includes(model.id));
  return (
    <div className="field settings-grid__wide">
      <div className="model-picker__heading">
        <span>Model</span>
        {(models.length > 1 || (!editing && models.length > 0)) && (
          <div className="model-picker__toolbar">
            {models.length > 1 && <button type="button" onClick={onSelectAll}>{selectAllLabel}</button>}
            {models.length > 1 && <button type="button" onClick={onClear}>{clearLabel}</button>}
            {!editing && <button type="button" onClick={onAddCustom}>{addCustomLabel}</button>}
          </div>
        )}
      </div>
      <div className="model-picker" role="group" aria-label="Model">
        <div className="model-picker__search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清除搜索" title="清除搜索"><X size={14} /></button>}
        </div>
        <div className="model-picker__list">
          {filteredModels.map((model) => {
            const checked = selectedIds.includes(model.id);
            return (
              <label key={model.id} className={`model-option ${checked ? "selected" : ""}`} aria-selected={checked}>
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
          {filteredModels.length === 0 && <div className="model-picker__empty">没有匹配的模型，试试名称或 ID。</div>}
        </div>
        <div className="model-picker__selection" aria-live="polite">
          <strong>{selectedIds.length ? `${selectedIds.length} 个模型已选择` : "尚未选择模型"}</strong>
          {selectedModels.length > 0 && <span>{selectedModels.slice(0, 3).map((model) => model.name).join("、")}{selectedModels.length > 3 ? ` 等 ${selectedModels.length} 个` : ""}</span>}
        </div>
      </div>
    </div>
  );
}
