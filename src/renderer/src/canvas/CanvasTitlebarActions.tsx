import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp, Focus, RefreshCw } from "lucide-react";
import { AppOverlayPortal } from "../ui/AppOverlayPortal";

type HelpPosition = {
  top: number;
  right: number;
};

const HELP_GAP = 8;

export function CanvasTitlebarActions({
  onFit,
  onTidy,
}: {
  onFit: () => void;
  onTidy: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPosition, setHelpPosition] = useState<HelpPosition | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpPanelRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const helpButtonId = `canvas-help-button-${reactId}`;
  const helpPanelId = `canvas-help-panel-${reactId}`;

  useEffect(() => {
    if (!helpOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setHelpOpen(false);
      const button = helpButtonRef.current;
      if (button?.isConnected) button.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (helpButtonRef.current?.contains(target) || helpPanelRef.current?.contains(target)) return;
      setHelpOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [helpOpen]);

  const toggleHelp = () => {
    if (helpOpen) {
      setHelpOpen(false);
      return;
    }
    const rect = helpButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setHelpPosition({
        top: rect.bottom + HELP_GAP,
        right: Math.max(HELP_GAP, window.innerWidth - rect.right),
      });
    }
    setHelpOpen(true);
  };

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
      <button
        ref={helpButtonRef}
        id={helpButtonId}
        className="titlebar-button canvas-titlebar-action"
        type="button"
        onClick={toggleHelp}
        aria-label="画布帮助"
        aria-expanded={helpOpen}
        aria-controls={helpPanelId}
        title="画布帮助"
      >
        <CircleHelp size={15} />
      </button>
      {helpOpen && helpPosition && (
        <AppOverlayPortal>
          <div
            ref={helpPanelRef}
            id={helpPanelId}
            className="canvas-help chrome-no-drag"
            role="dialog"
            aria-label="画布帮助"
            aria-labelledby={helpButtonId}
            style={{ position: "fixed", top: helpPosition.top, right: helpPosition.right }}
          >
            拖动节点标题栏移动，选中后从右下角调整大小；滚轮或触控板缩放画布。
          </div>
        </AppOverlayPortal>
      )}
    </div>
  );
}
