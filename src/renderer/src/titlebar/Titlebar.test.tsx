// @vitest-environment jsdom
import { StrictMode, useMemo } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppTitlebar,
  TitlebarProvider,
  useResolvedTitlebar,
  useTitlebar,
  useTitlebarActions,
  useTitlebarContext,
} from "./Titlebar";
import SessionCanvas from "../canvas/SessionCanvas";

vi.mock("../canvas/Canvas", () => ({ default: () => <div>canvas</div> }));
vi.mock("../canvas/ChatView", async () => {
  const { useMemo } = await import("react");
  const { useTitlebarActions } = await import("./Titlebar");
  return {
    default: function MockChatView() {
      const actions = useMemo(() => <button>child titlebar action</button>, []);
      useTitlebarActions(actions);
      return <div>chat</div>;
    },
  };
});

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
  it("keeps child actions active while Workspace updates its context", async () => {
    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
        <SessionCanvas
          sessionId="session-1"
          sessionName="first workspace"
          noKey={false}
          goSettings={() => {}}
        />
      </TitlebarProvider>,
    );

    await waitFor(() => expect(screen.getByText("child titlebar action")).toBeTruthy());
    expect(screen.getByText("first workspace")).toBeTruthy();

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
        <SessionCanvas
          sessionId="session-1"
          sessionName="renamed workspace"
          noKey={false}
          goSettings={() => {}}
        />
      </TitlebarProvider>,
    );

    await waitFor(() => expect(screen.getByText("renamed workspace")).toBeTruthy());
    expect(screen.getByText("child titlebar action")).toBeTruthy();

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <AppTitlebar {...titlebarProps} />
      </TitlebarProvider>,
    );
    await waitFor(() => expect(screen.getByText("fallback")).toBeTruthy());
    expect(screen.queryByText("child titlebar action")).toBeNull();
  });

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
    expect(screen.queryByText("画布")).toBeNull();
    expect(screen.getByText("整理").closest(".titlebar-interactive")).toBeTruthy();
  });

  it("cleans context and action stacks without leaving stale entries", () => {
    function Context({ title }: { title: string }) {
      useTitlebarContext({ title });
      return null;
    }

    function Actions({ label }: { label: string }) {
      const actions = useMemo(() => <button>{label}</button>, [label]);
      useTitlebarActions(actions);
      return null;
    }

    function Slots({
      showFirstContext,
      showFirstActions,
      showTopContext,
      showTopActions,
    }: {
      showFirstContext: boolean;
      showFirstActions: boolean;
      showTopContext: boolean;
      showTopActions: boolean;
    }) {
      return (
        <>
          {showFirstContext && <Context key="first-context" title="first context" />}
          {showFirstActions && <Actions key="first-actions" label="first action" />}
          {showTopContext && <Context key="top-context" title="top context" />}
          {showTopActions && <Actions key="top-actions" label="top action" />}
        </>
      );
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots
          showFirstActions
          showFirstContext
          showTopActions
          showTopContext
        />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("top context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("top action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots
          showFirstActions={false}
          showFirstContext={false}
          showTopActions
          showTopContext
        />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("top context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("top action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots
          showFirstActions={false}
          showFirstContext={false}
          showTopActions={false}
          showTopContext
        />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("top context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots
          showFirstActions={false}
          showFirstContext={false}
          showTopActions={false}
          showTopContext={false}
        />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("fallback");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("");
  });

  it("reveals still-mounted context and actions when the top entries clean up", () => {
    function Context({ title }: { title: string }) {
      useTitlebarContext({ title });
      return null;
    }

    function Actions({ label }: { label: string }) {
      const actions = useMemo(() => <button>{label}</button>, [label]);
      useTitlebarActions(actions);
      return null;
    }

    function Slots({
      showTopActions,
      showTopContext,
    }: {
      showTopActions: boolean;
      showTopContext: boolean;
    }) {
      return (
        <>
          <Context key="previous-context" title="previous context" />
          <Actions key="previous-actions" label="previous action" />
          {showTopContext && <Context key="top-context" title="top context" />}
          {showTopActions && <Actions key="top-actions" label="top action" />}
        </>
      );
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showTopActions showTopContext />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("top context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("top action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showTopActions={false} showTopContext />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("top context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("previous action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showTopActions={false} showTopContext={false} />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("previous context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("previous action");
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

  it("keeps useTitlebar registrations stable when only its caller rerenders", () => {
    const legacyActions = <button>legacy action</button>;
    const childContext = { title: "newer child context" };

    function Child() {
      useTitlebarContext(childContext);
      return null;
    }

    function LegacyPage({ revision }: { revision: number }) {
      useTitlebar({ title: "legacy context", actions: legacyActions });
      return <span>{revision}</span>;
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <LegacyPage revision={1} />
        <Child />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("newer child context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("legacy action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <LegacyPage revision={2} />
        <Child />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("newer child context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("legacy action");
  });

  it("keeps useTitlebar compatibility registrations in both slots through child cleanup", () => {
    function Legacy() {
      const actions = useMemo(() => <button>legacy action</button>, []);
      useTitlebar({ title: "legacy context", actions });
      return null;
    }

    function Child() {
      const actions = useMemo(() => <button>child action</button>, []);
      useTitlebarContext({ title: "child context" });
      useTitlebarActions(actions);
      return null;
    }

    function Slots({ showChild, showLegacy }: { showChild: boolean; showLegacy: boolean }) {
      return (
        <>
          {showLegacy && <Legacy key="legacy" />}
          {showChild && <Child key="child" />}
        </>
      );
    }

    const view = render(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showChild={false} showLegacy />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("legacy context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("legacy action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showChild showLegacy />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("child context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("child action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showChild={false} showLegacy />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("legacy context");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("legacy action");

    view.rerender(
      <TitlebarProvider defaultDescriptor={{ title: "fallback" }}>
        <ResolvedTitlebar />
        <Slots showChild={false} showLegacy={false} />
      </TitlebarProvider>,
    );
    expect(screen.getByTestId("resolved-title").textContent).toBe("fallback");
    expect(screen.getByTestId("resolved-actions").textContent).toBe("");
  });
});
