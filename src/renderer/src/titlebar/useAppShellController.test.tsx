// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_STORAGE_KEY } from "./sidebarState";
import { useAppShellController, type ShellCommandSource } from "./useAppShellController";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function ControllerHarness({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const shellElementRef = useRef<HTMLDivElement>(null);
  const controller = useAppShellController({ toggleRef, sidebarContentRef, reducedMotion });
  const inTransition = controller.shell.phase === "collapsing" || controller.shell.phase === "expanding";
  const inertProps = inTransition ? ({ inert: "" } as Record<string, string>) : {};
  return (
    <div>
      <button ref={toggleRef} onClick={() => controller.requestToggle("button")}>
        persistent toggle
      </button>
      <button>outside</button>
      {controller.shell.phase !== "collapsed" && (
        <div ref={sidebarContentRef} data-testid="sidebar-content" {...inertProps}>
          <button>inside</button>
        </div>
      )}
      <div
        ref={shellElementRef}
        data-testid="shell"
        data-phase={controller.shell.phase}
        data-version={controller.shell.version}
        onTransitionEnd={(event) => controller.completeTransition(event, controller.shell.version)}
      />
      {(["menu", "browser"] as ShellCommandSource[]).map((source) => (
        <button key={source} onClick={() => controller.requestToggle(source)}>
          {source}
        </button>
      ))}
      <button
        onClick={() => {
          const shellElement = shellElementRef.current!;
          controller.completeTransition(
            {
              currentTarget: shellElement,
              target: shellElement,
              propertyName: "--sidebar-width",
            },
            0,
          );
        }}
      >
        stale completion
      </button>
      <button
        onClick={() => {
          const shellElement = shellElementRef.current!;
          controller.completeTransition(
            {
              currentTarget: shellElement,
              target: shellElement,
              propertyName: "--sidebar-width",
            },
            controller.shell.version,
          );
        }}
      >
        current completion
      </button>
    </div>
  );
}

function phase() {
  return screen.getByTestId("shell").getAttribute("data-phase");
}

function commandButton(source: ShellCommandSource) {
  return screen.getByRole("button", {
    name: source === "button" ? "persistent toggle" : source,
  });
}

function finish(propertyName = "--sidebar-width", target?: Element) {
  const shell = screen.getByTestId("shell");
  fireEvent.transitionEnd(target ?? shell, { propertyName });
}

describe("useAppShellController", () => {
  it("lazily initializes from the persisted collapsed preference", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "1");
    render(<ControllerHarness />);
    expect(phase()).toBe("collapsed");
  });

  it.each(["button", "menu", "browser"] as const)(
    "routes an accepted %s request through the same transition and immediately persists its target",
    (source) => {
      const write = vi.spyOn(Storage.prototype, "setItem");
      render(<ControllerHarness />);

      fireEvent.click(commandButton(source));

      expect(phase()).toBe("collapsing");
      expect(write).toHaveBeenCalledWith(SIDEBAR_STORAGE_KEY, "1");
    },
  );

  it("persists expansion target as zero as soon as it is accepted", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "1");
    const write = vi.spyOn(Storage.prototype, "setItem");
    render(<ControllerHarness />);
    write.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "browser" }));

    expect(phase()).toBe("expanding");
    expect(write).toHaveBeenCalledWith(SIDEBAR_STORAGE_KEY, "0");
  });

  it("ignores rapid re-entry from every source without writing another preference", () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    render(<ControllerHarness />);
    fireEvent.click(commandButton("button"));
    expect(write).toHaveBeenCalledTimes(1);

    fireEvent.click(commandButton("button"));
    fireEvent.click(commandButton("menu"));
    fireEvent.click(commandButton("browser"));

    expect(phase()).toBe("collapsing");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("ignores a bubbled child transition and an unrelated property", () => {
    render(<ControllerHarness />);
    fireEvent.click(commandButton("button"));
    finish("--sidebar-width", screen.getByRole("button", { name: "inside" }));
    expect(phase()).toBe("collapsing");

    finish("opacity");
    expect(phase()).toBe("collapsing");
  });

  it("ignores a stale completion version and settles only the current matching event", () => {
    render(<ControllerHarness />);
    fireEvent.click(commandButton("button"));
    fireEvent.click(screen.getByRole("button", { name: "stale completion" }));
    expect(phase()).toBe("collapsing");

    fireEvent.click(screen.getByRole("button", { name: "current completion" }));
    expect(phase()).toBe("collapsed");
  });

  it("keeps button focus on the persistent toggle", () => {
    render(<ControllerHarness />);
    const toggle = screen.getByRole("button", { name: "persistent toggle" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
  });

  it("moves focus from SidebarContent to the persistent toggle before menu collapse", () => {
    render(<ControllerHarness />);
    const inside = screen.getByRole("button", { name: "inside" });
    const toggle = screen.getByRole("button", { name: "persistent toggle" });
    inside.focus();

    fireEvent.click(screen.getByRole("button", { name: "menu" }));

    expect(document.activeElement).toBe(toggle);
    expect(screen.getByTestId("sidebar-content").hasAttribute("inert")).toBe(true);
  });

  it("preserves outside focus for menu collapse", () => {
    render(<ControllerHarness />);
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    expect(document.activeElement).toBe(outside);
  });

  it("moves directly between settled states under reduced motion", () => {
    render(<ControllerHarness reducedMotion />);
    fireEvent.click(screen.getByRole("button", { name: "browser" }));
    expect(phase()).toBe("collapsed");
    expect(screen.queryByTestId("sidebar-content")).toBeNull();
  });
});
