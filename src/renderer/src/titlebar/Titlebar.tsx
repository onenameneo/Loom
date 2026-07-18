import { PanelLeft } from "lucide-react";
import { useResolvedTitlebar } from "./TitlebarContext";

export {
  TitlebarProvider,
  useResolvedTitlebar,
  useTitlebar,
  useTitlebarActions,
  useTitlebarContext,
} from "./TitlebarContext";
export type {
  TitlebarActions,
  TitlebarContextDescriptor,
  TitlebarDescriptor,
} from "./TitlebarContext";

export function AppTitlebar({
  collapsed,
  onToggleSidebar,
  platform,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
  platform: NodeJS.Platform | "browser";
}) {
  const { context, actions } = useResolvedTitlebar();
  const isMacElectron = platform === "darwin";

  return (
    <header
      className={`app-titlebar ${isMacElectron ? "is-mac-electron" : ""} ${collapsed ? "is-sidebar-collapsed" : ""}`}
    >
      {isMacElectron && <span className="titlebar-native-space" aria-hidden="true" />}
      <div className="titlebar-interactive titlebar-nav">
        <button
          className="titlebar-button"
          type="button"
          onClick={onToggleSidebar}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开侧栏 (⌘\\)" : "折叠侧栏 (⌘\\)"}
        >
          <PanelLeft size={16} />
        </button>
      </div>
      <div className="titlebar-context">
        {context.icon && <span className="titlebar-icon">{context.icon}</span>}
        <span className="titlebar-title">{context.title}</span>
        {context.mode && <span className="titlebar-mode">{context.mode}</span>}
        {context.subtitle && <span className="titlebar-subtitle">{context.subtitle}</span>}
      </div>
      {actions && (
        <div className="titlebar-interactive titlebar-actions">{actions}</div>
      )}
    </header>
  );
}
