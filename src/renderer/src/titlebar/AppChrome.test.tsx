// @vitest-environment jsdom
import { createRef } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitlebarProvider } from "./TitlebarContext";
import { AppChrome } from "./AppChrome";
import type { ShellState } from "./shellState";

afterEach(cleanup);

const expanded: ShellState = { phase: "expanded", version: 0 };
const collapsed: ShellState = { phase: "collapsed", version: 1 };

function renderChrome(shell: ShellState, platform: NodeJS.Platform | "browser" = "browser") {
  const toggleRef = createRef<HTMLButtonElement>();
  const sidebarContentRef = createRef<HTMLDivElement>();
  const onToggleSidebar = vi.fn();
  const onTransitionComplete = vi.fn();
  const view = render(
    <TitlebarProvider defaultDescriptor={{ title: "研究 Transformer", subtitle: "/tmp/loom" }}>
      <AppChrome
        shell={shell}
        platform={platform}
        toggleRef={toggleRef}
        sidebarContentRef={sidebarContentRef}
        onToggleSidebar={onToggleSidebar}
        onTransitionComplete={onTransitionComplete}
        sidebar={<nav>导航</nav>}
        main={<section>主内容</section>}
      />
    </TitlebarProvider>,
  );
  return { ...view, onToggleSidebar, onTransitionComplete, sidebarContentRef, toggleRef };
}

describe("adaptive AppChrome", () => {
  it("keeps the fixed geometry, animated leading reserve, and 800px action constraints in shell CSS", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/renderer/src/shell.css"),
      "utf8",
    );

    expect(css).toContain("@property --sidebar-width");
    expect(css).toMatch(/\.window-controls-chrome\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0 auto auto 0;/s);
    expect(css).toContain("max(0px, calc(var(--window-controls-width) - var(--sidebar-width)))");
    expect(css).toContain("transition: --sidebar-width var(--panel-motion-duration) var(--panel-motion-curve)");
    expect(css).toMatch(/@media \(max-width: 800px\)[\s\S]*?\.titlebar-subtitle\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/\.titlebar-actions\s*\{[^}]*flex:\s*none;/);
  });

  it("renders one sidebar column and a content titlebar while expanded", () => {
    const { container } = renderChrome(expanded);

    expect(container.querySelectorAll(".sidebar-column")).toHaveLength(1);
    expect(container.querySelectorAll(".sidebar-chrome")).toHaveLength(1);
    expect(container.querySelectorAll(".content-titlebar")).toHaveLength(1);
    expect(container.querySelectorAll(".window-controls-chrome")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "折叠侧栏" })).toHaveLength(1);
  });

  it("omits the sidebar column when collapsed and keeps the unified content titlebar", () => {
    const { container } = renderChrome(collapsed);

    expect(container.querySelector(".sidebar-column")).toBeNull();
    expect(container.querySelector(".content-titlebar")?.classList.contains("unified-titlebar")).toBe(true);
    expect(screen.getByRole("button", { name: "展开侧栏" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves the persistent toggle DOM node across shell rerenders", () => {
    const toggleRef = createRef<HTMLButtonElement>();
    const sidebarContentRef = createRef<HTMLDivElement>();
    const props = {
      platform: "browser" as const,
      toggleRef,
      sidebarContentRef,
      onToggleSidebar: vi.fn(),
      onTransitionComplete: vi.fn(),
      sidebar: <nav>导航</nav>,
      main: <section>主内容</section>,
    };
    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "Loom" }}>
        <AppChrome {...props} shell={expanded} />
      </TitlebarProvider>,
    );
    const first = screen.getByRole("button", { name: "折叠侧栏" });

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "Loom" }}>
        <AppChrome {...props} shell={{ phase: "collapsing", version: 1 }} />
      </TitlebarProvider>,
    );

    expect(screen.getByRole("button", { name: "展开侧栏" })).toBe(first);
    expect(toggleRef.current).toBe(first);
  });

  it.each(["collapsing", "expanding"] as const)(
    "makes only SidebarContent inert and hidden while %s",
    (phase) => {
      const { container } = renderChrome({ phase, version: 2 });
      const sidebarContent = container.querySelector(".sidebar-content") as HTMLDivElement;
      const toggle = screen.getByRole("button", { hidden: true });

      expect(sidebarContent.hasAttribute("inert")).toBe(true);
      expect(sidebarContent.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelector(".sidebar-chrome")?.hasAttribute("inert")).toBe(false);
      expect(toggle.getAttribute("aria-disabled")).toBe("true");
      expect(toggle.hasAttribute("disabled")).toBe(false);
      expect(toggle.tabIndex).toBe(0);
    },
  );

  it("reports the settled target through aria-expanded and ignores clicks while transitioning", () => {
    const { onToggleSidebar } = renderChrome({ phase: "expanding", version: 2 });
    const toggle = screen.getByRole("button", { name: "折叠侧栏" });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggleSidebar).not.toHaveBeenCalled();
  });

  it.each([
    { platform: "darwin" as const, width: "104px", mac: true },
    { platform: "win32" as const, width: "44px", mac: false },
    { platform: "linux" as const, width: "44px", mac: false },
    { platform: "browser" as const, width: "44px", mac: false },
  ])("uses $width controls geometry on $platform", ({ platform, width, mac }) => {
    const { container } = renderChrome(expanded, platform);
    const shell = container.querySelector(".app-shell") as HTMLElement;
    const chrome = container.querySelector(".window-controls-chrome") as HTMLElement;

    expect(shell.style.getPropertyValue("--window-controls-width")).toBe(width);
    expect(chrome.classList.contains("mac-window-controls")).toBe(mac);
    expect(Boolean(container.querySelector(".window-controls-backdrop"))).toBe(mac);
    expect(Boolean(container.querySelector(".chrome-drag-region"))).toBe(mac);
  });

  it("switches the macOS safe backdrop to content material only when settled collapsed", () => {
    const { container, rerender } = renderChrome(expanded, "darwin");
    const chrome = container.querySelector(".window-controls-chrome")!;
    expect(chrome.classList.contains("uses-content-surface")).toBe(false);

    rerender(
      <TitlebarProvider defaultDescriptor={{ title: "Loom" }}>
        <AppChrome
          shell={collapsed}
          platform="darwin"
          toggleRef={createRef<HTMLButtonElement>()}
          sidebarContentRef={createRef<HTMLDivElement>()}
          onToggleSidebar={() => {}}
          onTransitionComplete={() => {}}
          sidebar={<nav>导航</nav>}
          main={<section>主内容</section>}
        />
      </TitlebarProvider>,
    );
    expect(chrome.classList.contains("uses-content-surface")).toBe(true);
  });

  it("forwards only shell transition events with the render's captured version", () => {
    const { container, onTransitionComplete } = renderChrome({ phase: "collapsing", version: 7 });
    const shell = container.querySelector(".app-shell")!;
    const event = new Event("transitionend", { bubbles: true });
    Object.defineProperty(event, "propertyName", { value: "--sidebar-width" });
    shell.dispatchEvent(event);

    expect(onTransitionComplete).toHaveBeenCalledTimes(1);
    expect(onTransitionComplete.mock.calls[0][1]).toBe(7);
  });
});
