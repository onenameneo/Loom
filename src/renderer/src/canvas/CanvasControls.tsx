import { useState } from "react";
import { CircleHelp, Focus, Minus, Plus, RefreshCw } from "lucide-react";

export function CanvasControls({
  zoom,
  onFit,
  onTidy,
  onZoomOut,
  onZoomIn,
  onResetZoom,
}: {
  zoom: number;
  onFit: () => void;
  onTidy: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <div className="canvas-control-group canvas-actions nodrag" aria-label="画布工具">
        <button type="button" onClick={onFit} aria-label="适配全部节点" title="适配全部节点">
          <Focus size={15} />
        </button>
        <button type="button" onClick={onTidy} aria-label="整理布局" title="整理布局">
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen((current) => !current)}
          aria-label="画布帮助"
          aria-expanded={helpOpen}
          title="画布帮助"
        >
          <CircleHelp size={15} />
        </button>
        {helpOpen && (
          <div className="canvas-help" role="status">
            拖动节点标题栏移动，选中后从右下角调整大小；滚轮或触控板缩放画布。
          </div>
        )}
      </div>

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
        <button className="canvas-zoom-reset" type="button" onClick={onResetZoom} aria-label="回到 100%" title="回到 100%">
          100
        </button>
      </div>
    </>
  );
}
