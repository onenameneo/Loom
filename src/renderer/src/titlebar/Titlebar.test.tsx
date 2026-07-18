// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as module from "./Titlebar";

const workspace = { title: "研究 Transformer", mode: "画布" as const, actions: <button>整理</button> };

describe("global titlebar", () => {
  it("registers page context and restores the default on unmount", () => {
    const Provider = (module as any).TitlebarProvider;
    const Titlebar = (module as any).AppTitlebar;
    const useTitlebar = (module as any).useTitlebar;
    expect(Provider).toBeTypeOf("function");

    function Page() {
      useTitlebar(workspace);
      return null;
    }

    const view = render(
      <Provider defaultDescriptor={{ title: "会话" }}>
        <Titlebar collapsed={false} onToggleSidebar={() => {}} platform="browser" />
        <Page />
      </Provider>,
    );
    expect(screen.getByText("研究 Transformer")).toBeTruthy();
    expect(screen.getByText("画布")).toBeTruthy();
    expect(screen.getByText("整理").closest(".titlebar-interactive")).toBeTruthy();

    view.rerender(
      <Provider defaultDescriptor={{ title: "会话" }}>
        <Titlebar collapsed={false} onToggleSidebar={() => {}} platform="browser" />
      </Provider>,
    );
    expect(screen.getByText("会话")).toBeTruthy();
  });
});
