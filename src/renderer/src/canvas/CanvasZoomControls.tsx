import { Minus, Plus } from "lucide-react";

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
  return (
    <div className="canvas-control-group canvas-zoom nodrag absolute bottom-loom-4 left-loom-4 z-[8] inline-flex items-center rounded-loom-md border border-loom-border bg-loom-surface p-[3px] shadow-loom-soft" aria-label="画布缩放">
      <button className="grid size-[30px] place-items-center rounded-loom-sm border-0 bg-transparent text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:text-loom-accent" type="button" onClick={onZoomOut} aria-label="缩小画布" title="缩小画布">
        <Minus size={15} />
      </button>
      <output className="canvas-zoom-value min-w-[44px] text-center font-loom-mono text-[10.5px] text-loom-muted" aria-label={`当前缩放 ${Math.round(zoom * 100)}%`}>
        {Math.round(zoom * 100)}%
      </output>
      <button className="grid size-[30px] place-items-center rounded-loom-sm border-0 bg-transparent text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:text-loom-accent" type="button" onClick={onZoomIn} aria-label="放大画布" title="放大画布">
        <Plus size={15} />
      </button>
      <button
        className="grid h-[30px] w-[38px] place-items-center rounded-bl-none rounded-tl-none border-0 border-l border-loom-border bg-transparent font-loom-mono text-[10px] text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] focus-visible:text-loom-accent"
        type="button"
        onClick={onResetZoom}
        aria-label="回到 100%"
        title="回到 100%"
      >
        100
      </button>
    </div>
  );
}
