import { Minus, Plus } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";

export function CanvasZoomControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onResetZoom,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="canvas-control-group canvas-zoom nodrag absolute bottom-loom-4 left-loom-4 z-[8] inline-flex items-center rounded-loom-md border border-loom-border bg-loom-surface p-[3px] shadow-loom-soft" aria-label={t("canvas.zoom")}>
      <button className="grid size-[30px] place-items-center rounded-loom-sm border-0 bg-transparent text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:text-loom-accent" type="button" onClick={onZoomOut} aria-label={t("canvas.zoomOut")} title={t("canvas.zoomOut")}>
        <Minus size={15} />
      </button>
      <output className="canvas-zoom-value min-w-[44px] text-center font-loom-mono text-[10.5px] text-loom-muted" aria-label={`${t("canvas.zoom")} ${Math.round(zoom * 100)}%`}>
        {Math.round(zoom * 100)}%
      </output>
      <button className="grid size-[30px] place-items-center rounded-loom-sm border-0 bg-transparent text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:text-loom-accent" type="button" onClick={onZoomIn} aria-label={t("canvas.zoomIn")} title={t("canvas.zoomIn")}>
        <Plus size={15} />
      </button>
      <button
        className="grid h-[30px] w-[38px] place-items-center rounded-bl-none rounded-tl-none border-0 border-l border-loom-border bg-transparent font-loom-mono text-[10px] text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:text-loom-accent"
        type="button"
        onClick={onResetZoom}
        aria-label={t("canvas.zoomReset")}
        title={t("canvas.zoomReset")}
      >
        100
      </button>
    </div>
  );
}
