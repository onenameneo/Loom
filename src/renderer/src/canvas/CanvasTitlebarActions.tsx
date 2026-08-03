import { CircleHelp, Focus, RefreshCw } from "lucide-react";
import { ClickTip } from "../ui/dialogs";

export function CanvasTitlebarActions({
  onFit,
  onTidy,
}: {
  onFit: () => void;
  onTidy: () => void;
}) {
  return (
    <div className="canvas-titlebar-actions chrome-no-drag" aria-label="画布工具">
      <button
        className="titlebar-button canvas-titlebar-action"
        type="button"
        onClick={onFit}
        aria-label="适配全部节点"
        title="适配全部节点"
      >
        <Focus size={15} />
      </button>
      <button
        className="titlebar-button canvas-titlebar-action"
        type="button"
        onClick={onTidy}
        aria-label="整理布局"
        title="整理布局"
      >
        <RefreshCw size={15} />
      </button>
      <ClickTip
        label="画布帮助"
        content="拖动节点标题栏移动，选中后从右下角调整大小；滚轮或触控板缩放画布。"
        className="click-tip canvas-help chrome-no-drag"
      >
        <button
          className="titlebar-button canvas-titlebar-action"
          type="button"
          aria-label="画布帮助"
          title="画布帮助"
        >
          <CircleHelp size={15} />
        </button>
      </ClickTip>
    </div>
  );
}
