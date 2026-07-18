import { PanelLeft } from "lucide-react";
import type {
  CSSProperties,
  ReactNode,
  RefObject,
} from "react";
import { useLayoutEffect, useRef } from "react";
import { useResolvedTitlebar } from "./TitlebarContext";
import type { ShellState } from "./shellState";
import type { ShellTransitionEvent } from "./useAppShellController";

type RendererPlatform = NodeJS.Platform | "browser";

function isTransitioning(shell: ShellState): boolean {
  return shell.phase === "collapsing" || shell.phase === "expanding";
}

function targetsExpanded(shell: ShellState): boolean {
  return shell.phase === "expanded" || shell.phase === "expanding";
}

export function WindowControlsChrome({
  shell,
  platform,
  toggleRef,
  onToggleSidebar,
}: {
  shell: ShellState;
  platform: RendererPlatform;
  toggleRef: RefObject<HTMLButtonElement>;
  onToggleSidebar: () => void;
}) {
  const isMacElectron = platform === "darwin";
  const transitioning = isTransitioning(shell);
  const expandedTarget = targetsExpanded(shell);
  const label = expandedTarget ? "折叠侧栏" : "展开侧栏";
  const shortcut =
    platform === "darwin" ? "⌘\\" : platform === "browser" ? "Cmd/Ctrl+\\" : "Ctrl+\\";

  return (
    <div
      className={`window-controls-chrome ${isMacElectron ? "mac-window-controls" : ""} ${shell.phase === "collapsed" ? "uses-content-surface" : ""}`}
    >
      {isMacElectron && (
        <>
          <span className="window-controls-backdrop" aria-hidden="true" />
          <span className="chrome-drag-region" aria-hidden="true" />
        </>
      )}
      <button
        ref={toggleRef}
        className="titlebar-button window-sidebar-toggle chrome-no-drag"
        type="button"
        onClick={() => {
          if (!transitioning) onToggleSidebar();
        }}
        aria-label={label}
        aria-expanded={expandedTarget}
        aria-disabled={transitioning ? "true" : undefined}
        title={`${label} (${shortcut})`}
      >
        <PanelLeft size={16} />
      </button>
    </div>
  );
}

export function AppTitlebar({
  collapsed,
  platform,
}: {
  collapsed: boolean;
  platform: RendererPlatform;
}) {
  const { context, actions } = useResolvedTitlebar();
  const isMacElectron = platform === "darwin";

  return (
    <header
      className={`app-titlebar content-titlebar ${collapsed ? "unified-titlebar" : ""} ${isMacElectron ? "mac-content-titlebar" : ""}`}
    >
      <div className="titlebar-context chrome-no-drag">
        {context.icon && (
          <span className="titlebar-icon" aria-hidden="true">
            {context.icon}
          </span>
        )}
        <span className="titlebar-title">{context.title}</span>
        {context.mode && <span className="titlebar-mode">{context.mode}</span>}
        {context.subtitle && <span className="titlebar-subtitle">{context.subtitle}</span>}
      </div>
      <span className={isMacElectron ? "titlebar-drag-space" : "titlebar-flex-space"} aria-hidden="true" />
      {actions && <div className="titlebar-interactive titlebar-actions chrome-no-drag">{actions}</div>}
    </header>
  );
}

export function AppChrome({
  shell,
  platform,
  toggleRef,
  sidebarContentRef,
  onToggleSidebar,
  onTransitionComplete,
  sidebar,
  main,
}: {
  shell: ShellState;
  platform: RendererPlatform;
  toggleRef: RefObject<HTMLButtonElement>;
  sidebarContentRef: RefObject<HTMLDivElement>;
  onToggleSidebar: () => void;
  onTransitionComplete: (event: ShellTransitionEvent, version: number) => void;
  sidebar: ReactNode;
  main: ReactNode;
}) {
  const transitioning = isTransitioning(shell);
  const sidebarMounted = shell.phase !== "collapsed";
  const shellRef = useRef<HTMLDivElement>(null);
  const shellStyle = {
    "--window-controls-width": platform === "darwin" ? "104px" : "44px",
    "--sidebar-width": targetsExpanded(shell) ? "244px" : "0px",
  } as CSSProperties;
  const inertProps = transitioning ? ({ inert: "" } as Record<string, string>) : {};

  useLayoutEffect(() => {
    const shellElement = shellRef.current;
    if (!shellElement || !transitioning) return;
    const transitionVersion = shell.version;
    const completeBoundTransition = (event: Event) => {
      const transitionEvent = event as TransitionEvent;
      onTransitionComplete(
        {
          currentTarget: shellElement,
          target: event.target ?? shellElement,
          propertyName: transitionEvent.propertyName,
        },
        transitionVersion,
      );
    };
    shellElement.addEventListener("transitionend", completeBoundTransition);
    shellElement.addEventListener("transitioncancel", completeBoundTransition);
    return () => {
      shellElement.removeEventListener("transitionend", completeBoundTransition);
      shellElement.removeEventListener("transitioncancel", completeBoundTransition);
    };
  }, [onTransitionComplete, shell.phase, shell.version, transitioning]);

  return (
    <div
      ref={shellRef}
      className={`app-shell shell-${shell.phase} platform-${platform}`}
      data-shell-phase={shell.phase}
      data-transition-version={transitioning ? shell.version : undefined}
      style={shellStyle}
    >
      <WindowControlsChrome
        shell={shell}
        platform={platform}
        toggleRef={toggleRef}
        onToggleSidebar={onToggleSidebar}
      />
      {sidebarMounted && (
        <aside className="sidebar-column">
          <div className="sidebar-chrome" aria-hidden="true" />
          <div
            ref={sidebarContentRef}
            className="sidebar-content"
            aria-hidden={transitioning ? "true" : undefined}
            {...inertProps}
          >
            {sidebar}
          </div>
        </aside>
      )}
      <section className="content-column">
        <AppTitlebar collapsed={shell.phase === "collapsed"} platform={platform} />
        <main className="main">{main}</main>
      </section>
    </div>
  );
}
