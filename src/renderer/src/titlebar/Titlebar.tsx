import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";

export type TitlebarDescriptor = {
  title: string;
  mode?: "对话" | "画布";
  actions?: ReactNode;
  subtitle?: string;
};

type TitlebarContextValue = {
  descriptor: TitlebarDescriptor;
  register: (descriptor: TitlebarDescriptor) => () => void;
};

const TitlebarContext = createContext<TitlebarContextValue | null>(null);

export function TitlebarProvider({
  defaultDescriptor,
  children,
}: {
  defaultDescriptor: TitlebarDescriptor;
  children: ReactNode;
}) {
  const defaultRef = useRef(defaultDescriptor);
  defaultRef.current = defaultDescriptor;
  const tokenRef = useRef(0);
  const currentTokenRef = useRef(0);
  const [descriptor, setDescriptor] = useState(defaultDescriptor);

  const register = useCallback((next: TitlebarDescriptor) => {
    const token = ++tokenRef.current;
    currentTokenRef.current = token;
    setDescriptor(next);
    return () => {
      if (currentTokenRef.current !== token) return;
      currentTokenRef.current = 0;
      setDescriptor(defaultRef.current);
    };
  }, []);

  const value = useMemo(() => ({ descriptor, register }), [descriptor, register]);
  return <TitlebarContext.Provider value={value}>{children}</TitlebarContext.Provider>;
}

export function useTitlebar(descriptor: TitlebarDescriptor): void {
  const context = useContext(TitlebarContext);
  if (!context) throw new Error("useTitlebar must be used within TitlebarProvider");
  useLayoutEffect(() => context.register(descriptor), [context.register, descriptor]);
}

export function AppTitlebar({
  collapsed,
  onToggleSidebar,
  platform,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
  platform: NodeJS.Platform | "browser";
}) {
  const context = useContext(TitlebarContext);
  if (!context) throw new Error("AppTitlebar must be used within TitlebarProvider");
  const { descriptor } = context;
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
        <span className="titlebar-title">{descriptor.title}</span>
        {descriptor.mode && <span className="titlebar-mode">{descriptor.mode}</span>}
        {descriptor.subtitle && <span className="titlebar-subtitle">{descriptor.subtitle}</span>}
      </div>
      {descriptor.actions && (
        <div className="titlebar-interactive titlebar-actions">{descriptor.actions}</div>
      )}
    </header>
  );
}
