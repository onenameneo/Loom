import { PanelLeft, PanelRight } from "lucide-react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { useLayoutEffect, useRef, useState } from "react";
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

function readStoredPanelWidth(key: string, fallback: number, min: number, max: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const saved = Number(raw);
  return Number.isFinite(saved) ? Math.min(max, Math.max(min, saved)) : fallback;
}

const ENDPOINT_EPSILON_PX = 0.5;
const SHELL_TRANSITION_FALLBACK_MS = 360;

function readPixelValue(value: string): number | null {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : null;
}

function isAtShellTransitionEndpoint(shellElement: HTMLElement, expandedTarget: boolean): boolean {
  const computed = window.getComputedStyle(shellElement);
  const currentWidth = readPixelValue(computed.getPropertyValue("--sidebar-width"));
  const targetWidth = expandedTarget
    ? readPixelValue(computed.getPropertyValue("--sidebar-expanded-width"))
    : 0;
  return (
    currentWidth !== null &&
    targetWidth !== null &&
    Math.abs(currentWidth - targetWidth) <= ENDPOINT_EPSILON_PX
  );
}

export function WindowControlsChrome({
  shell,
  platform,
  fullscreen = false,
  toggleRef,
  onToggleSidebar,
}: {
  shell: ShellState;
  platform: RendererPlatform;
  fullscreen?: boolean;
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
      className={`window-controls-chrome ${isMacElectron ? "mac-window-controls" : ""} ${isMacElectron && fullscreen ? "fullscreen" : ""} ${shell.phase === "collapsed" ? "uses-content-surface" : ""}`}
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
  trailing,
}: {
  collapsed: boolean;
  platform: RendererPlatform;
  trailing?: ReactNode;
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
        {context.subtitle && <span className="titlebar-subtitle">{context.subtitle}</span>}
      </div>
      <span className={isMacElectron ? "titlebar-drag-space" : "titlebar-flex-space"} aria-hidden="true" />
      {(actions || trailing) && <div className="titlebar-interactive titlebar-actions chrome-no-drag">{actions}{trailing}</div>}
    </header>
  );
}

export function AppChrome({
  shell,
  platform,
  fullscreen = false,
  toggleRef,
  sidebarContentRef,
  onToggleSidebar,
  onTransitionComplete,
  sidebar,
  main,
  right,
  workbenchOpen = false,
  onToggleWorkbench,
}: {
  shell: ShellState;
  platform: RendererPlatform;
  fullscreen?: boolean;
  toggleRef: RefObject<HTMLButtonElement>;
  sidebarContentRef: RefObject<HTMLDivElement>;
  onToggleSidebar: () => void;
  onTransitionComplete: (event: ShellTransitionEvent, version: number) => void;
  sidebar: ReactNode;
  main: ReactNode;
  right?: ReactNode;
  workbenchOpen?: boolean;
  onToggleWorkbench?: () => void;
}) {
  const transitioning = isTransitioning(shell);
  const sidebarMounted = shell.phase !== "collapsed";
  const shellRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return readStoredPanelWidth("loom:ui:sidebar-width", 244, 200, 420);
  });
  const [workbenchWidth, setWorkbenchWidth] = useState(() => {
    return readStoredPanelWidth("loom:ui:workbench-width", 380, 300, 560);
  });
  // macOS 窗口态：116px 预留红绿灯 + 开关（开关 left:80 + 28 + 8）；全屏后红绿灯消失，塌回到只容纳左移开关的 44px（与非 mac 同宽）。
  const workbenchMounted = right !== undefined;
  const workbenchInteractive = workbenchMounted && workbenchOpen;
  const shellStyle = {
    "--window-controls-width": platform === "darwin" && !fullscreen ? "116px" : "44px",
    "--sidebar-width": targetsExpanded(shell) ? "var(--sidebar-expanded-width)" : "0px",
    "--sidebar-expanded-width": `${sidebarWidth}px`,
    "--workbench-width": `${workbenchWidth}px`,
  } as CSSProperties;
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>, side: "sidebar" | "workbench") => {
    event.preventDefault();
    shellRef.current?.classList.add("is-resizing");
    const startX = event.clientX;
    const isSidebar = side === "sidebar";
    const startWidth = isSidebar ? sidebarWidth : workbenchWidth;
    const min = isSidebar ? 200 : 300;
    const max = isSidebar ? 420 : 560;
    const apply = (width: number) => shellRef.current?.style.setProperty(isSidebar ? "--sidebar-expanded-width" : "--workbench-width", `${width}px`);
    let latest = startWidth;
    const onMove = (move: PointerEvent) => { latest = Math.min(max, Math.max(min, startWidth + (isSidebar ? move.clientX - startX : startX - move.clientX))); apply(latest); };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      shellRef.current?.classList.remove("is-resizing");
      if (isSidebar) { setSidebarWidth(latest); localStorage.setItem("loom:ui:sidebar-width", String(latest)); }
      else { setWorkbenchWidth(latest); localStorage.setItem("loom:ui:workbench-width", String(latest)); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
  };
  const inertProps = transitioning ? ({ inert: "" } as Record<string, string>) : {};

  useLayoutEffect(() => {
    const shellElement = shellRef.current;
    if (!shellElement || !transitioning) return;
    const transitionVersion = shell.version;
    const expandedTarget = targetsExpanded(shell);
    let settled = false;
    let frameId: number | null = null;
    let timeoutId: number | null = null;
    // onTransitionComplete 只需要结构化的 { currentTarget, target, propertyName }，
    // 所以三条收尾路径（真实事件 / rAF 即时端点 / 超时兜底）直接传原始值即可，
    // 不必伪造 DOM Event。settled 自身守卫幂等，超时无需再判 !settled。
    const settle = (target: EventTarget, propertyName: string, requireEndpoint: boolean) => {
      if (settled) return;
      if (requireEndpoint && !isAtShellTransitionEndpoint(shellElement, expandedTarget)) return;
      settled = true;
      onTransitionComplete({ currentTarget: shellElement, target, propertyName }, transitionVersion);
    };
    const onShellTransition = (event: Event) => {
      // 只认领 shell 自身的 --sidebar-width 过渡；忽略从 .sidebar-content 冒泡上来的
      // opacity 过渡结束——否则它会提前把 settled 置真，真正的宽度过渡结束反被吞掉、
      // 侧栏卡在 collapsing/expanding 不再落定。
      if (event.target !== shellElement) return;
      if ((event as TransitionEvent).propertyName !== "--sidebar-width") return;
      settle(shellElement, "--sidebar-width", true);
    };
    shellElement.addEventListener("transitionend", onShellTransition);
    shellElement.addEventListener("transitioncancel", onShellTransition);
    frameId = window.requestAnimationFrame(() => settle(shellElement, "--sidebar-width", true));
    timeoutId = window.setTimeout(
      () => settle(shellElement, "--sidebar-width", false),
      SHELL_TRANSITION_FALLBACK_MS,
    );
    return () => {
      shellElement.removeEventListener("transitionend", onShellTransition);
      shellElement.removeEventListener("transitioncancel", onShellTransition);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [onTransitionComplete, shell.phase, shell.version, transitioning]);

  return (
    <div
      ref={shellRef}
      className={`app-shell shell-${shell.phase} platform-${platform}`}
      data-shell-phase={shell.phase}
      data-transition-version={transitioning ? shell.version : undefined}
      data-workbench-open={workbenchInteractive ? "true" : "false"}
      style={shellStyle}
    >
      <WindowControlsChrome
        shell={shell}
        platform={platform}
        fullscreen={fullscreen}
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
          <div className="sidebar-resize-handle" role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical" onPointerDown={(event) => beginResize(event, "sidebar")} />
        </aside>
      )}
      <section className="content-column">
        <AppTitlebar collapsed={shell.phase === "collapsed"} platform={platform} trailing={onToggleWorkbench && <button className="titlebar-button workbench-toggle" type="button" aria-label={workbenchOpen ? "关闭工作台" : "打开工作台"} aria-expanded={workbenchOpen} onClick={onToggleWorkbench}><PanelRight size={16} /></button>} />
        <main className="main">{main}</main>
      </section>
      {workbenchMounted && (
        <aside
          className="workbench-column"
          aria-hidden={workbenchInteractive ? undefined : "true"}
          {...(workbenchInteractive ? {} : ({ inert: "" } as Record<string, string>))}
        >
          <div className="workbench-resize-handle" role="separator" aria-label="调整工作台宽度" aria-orientation="vertical" onPointerDown={(event) => beginResize(event, "workbench")} />
          {right}
        </aside>
      )}
    </div>
  );
}
