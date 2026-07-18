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
    <div className="canvas-control-group canvas-zoom nodrag" aria-label="画布缩放">
      <button type="button" onClick={onZoomOut} aria-label="缩小画布" title="缩小画布">
        <Minus size={15} />
      </button>
      <output className="canvas-zoom-value" aria-label={`当前缩放 ${Math.round(zoom * 100)}%`}>
        {Math.round(zoom * 100)}%
      </output>
      <button type="button" onClick={onZoomIn} aria-label="放大画布" title="放大画布">
        <Plus size={15} />
      </button>
      <button
        className="canvas-zoom-reset"
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
