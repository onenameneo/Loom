import { CircleHelp, Focus, RefreshCw } from "lucide-react";
import { ClickTip } from "../ui/dialogs";
import { useI18n } from "../i18n/I18nProvider";

export function CanvasTitlebarActions({
  onFit,
  onTidy,
}: {
  onFit: () => void;
  onTidy: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="canvas-titlebar-actions chrome-no-drag" aria-label={t("canvas.tools")}>
      <button
        className="titlebar-button canvas-titlebar-action"
        type="button"
        onClick={onFit}
        aria-label={t("canvas.fit")}
        title={t("canvas.fit")}
      >
        <Focus size={15} />
      </button>
      <button
        className="titlebar-button canvas-titlebar-action"
        type="button"
        onClick={onTidy}
        aria-label={t("canvas.organize")}
        title={t("canvas.organize")}
      >
        <RefreshCw size={15} />
      </button>
      <ClickTip
        label={t("canvas.help")}
        content={t("canvas.helpDescription")}
        className="click-tip canvas-help chrome-no-drag"
      >
        <button
          className="titlebar-button canvas-titlebar-action"
          type="button"
          aria-label={t("canvas.help")}
          title={t("canvas.help")}
        >
          <CircleHelp size={15} />
        </button>
      </ClickTip>
    </div>
  );
}
