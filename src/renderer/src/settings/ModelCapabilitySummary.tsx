import type { RendererModel } from "./modelCatalogState";

export function ModelCapabilitySummary({ models, emptyLabel, sharedLabel }: { models: RendererModel[]; emptyLabel: string; sharedLabel: string }) {
  return (
    <div className="model-summary settings-grid__wide">
      {models.length === 1 ? (
        <>
          <span>{models[0].api}</span>
          <span>{models[0].capabilities.contextWindow.toLocaleString()} ctx</span>
          <span>{models[0].capabilities.maxOutputTokens.toLocaleString()} out</span>
          {models[0].capabilities.reasoning && <span>reasoning</span>}
          {models[0].capabilities.images && <span>image</span>}
        </>
      ) : models.length > 1 ? (
        <span>{sharedLabel}</span>
      ) : (
        <span>{emptyLabel}</span>
      )}
    </div>
  );
}
