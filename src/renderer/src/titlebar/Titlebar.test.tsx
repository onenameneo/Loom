// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppTitlebar,
  TitlebarProvider,
  useResolvedTitlebar,
  useTitlebar,
  useTitlebarActions,
  useTitlebarContext,
} from "./Titlebar";

const titlebarProps = {
  collapsed: false,
  onToggleSidebar: () => {},
  platform: "browser" as const,
};

afterEach(cleanup);

function ResolvedTitlebar() {
  const { context, actions } = useResolvedTitlebar();

  return (
    <>
      <span data-testid="resolved-title">{context.title}</span>
      <span data-testid="resolved-actions">{actions}</span>
    </>
  );
}

describe("global titlebar", () => {
  it("shows parent context with child actions from independent slots", () => {
    function Parent() {
      useTitlebarContext({ title: "研究 Transformer", mode: "画布" });
      return <Child />;
    }

    function Child() {
      useTitlebarActions(<button>整理</button>);
      return null;
    }

    render(
      <TitlebarProvider defaultDescriptor={{ title: "会话" }}>
        <AppTitlebar {...titlebarProps} />
        <Parent />
      </TitlebarProvider>,
    );

    expect(screen.getByText("研究 Transformer")).toBeTruthy();
    expect(screen.getByText("画布")).toBeTruthy();
    expect(screen.getByText("整理").closest(".titlebar-interactive")).toBeTruthy();
  });

  it("keeps the active top context when a non-top token cleans up", () => {
    function Context({ title }: { title: string }) {
      useTitlebarContext({ title });
      return null;
    }

    function Stack({ showFirst }: { showFirst: boolean }) {
      return (
        <>
          {showFirst && <Context title="first" />}
          <Context title="second" />
        </>
      );
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Stack showFirst />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("second");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Stack showFirst={false} />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("second");
  });

  it("reveals the previous context when the top token cleans up", () => {
    function Context({ title }: { title: string }) {
      useTitlebarContext({ title });
      return null;
    }

    function Stack({ showTop }: { showTop: boolean }) {
      return (
        <>
          <Context title="parent" />
          {showTop && <Context title="child" />}
        </>
      );
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Stack showTop />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("child");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Stack showTop={false} />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("parent");
  });

  it("does not let stale action cleanup change the active context", () => {
    function Context() {
      useTitlebarContext({ title: "current context" });
      return null;
    }

    function Actions({ label }: { label: string }) {
      useTitlebarActions(<button>{label}</button>);
      return null;
    }

    function Slots({ showStale }: { showStale: boolean }) {
      return (
        <>
          <Context />
          {showStale && <Actions label="stale action" />}
          <Actions label="active action" />
        </>
      );
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
        <Slots showStale />
      </TitlebarProvider>,
    );
    expect(screen.getByText("active action")).toBeTruthy();

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
        <Slots showStale={false} />
      </TitlebarProvider>,
    );
    expect(screen.getByText("current context")).toBeTruthy();
    expect(screen.getByText("active action")).toBeTruthy();
  });

  it("immediately renders a new provider fallback while the context stack is empty", () => {
    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "first fallback" }}>
        <AppTitlebar {...titlebarProps} />
      </TitlebarProvider>,
    );
    expect(screen.getByText("first fallback")).toBeTruthy();

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "updated fallback" }}>
        <AppTitlebar {...titlebarProps} />
      </TitlebarProvider>,
    );
    expect(screen.getByText("updated fallback")).toBeTruthy();
  });

  it("keeps one StrictMode registration and restores the current fallback on unmount", () => {
    function Page() {
      useTitlebarContext({ title: "registered once" });
      return null;
    }

    const view = render(
      <StrictMode>
        <TitlebarProvider defaultDescriptor={{ title: "first fallback" }}>
          <ResolvedTitlebar />
          <Page />
        </TitlebarProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("registered once");

    view.rerender(
      <StrictMode>
        <TitlebarProvider defaultDescriptor={{ title: "updated fallback" }}>
          <ResolvedTitlebar />
        </TitlebarProvider>
      </StrictMode>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("updated fallback");
  });

  it("registers context and actions independently and AppTitlebar renders the resolved result", () => {
    function Context() {
      useTitlebarContext({ title: "resolved context", subtitle: "metadata" });
      return null;
    }

    function Actions() {
      useTitlebarActions(<button>resolved action</button>);
      return null;
    }

    render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
        <Context />
        <Actions />
      </TitlebarProvider>,
    );
    expect(screen.getByText("resolved context")).toBeTruthy();
    expect(screen.getByText("metadata")).toBeTruthy();
    expect(screen.getByText("resolved action")).toBeTruthy();
  });

  it("keeps useTitlebar as a compatibility wrapper for both slots", () => {
    function LegacyPage() {
      useTitlebar({ title: "legacy context", actions: <button>legacy action</button> });
      return null;
    }

    render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
        <LegacyPage />
      </TitlebarProvider>,
    );
    expect(screen.getByText("legacy context")).toBeTruthy();
    expect(screen.getByText("legacy action")).toBeTruthy();
  });
});
