// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelCapabilitySummary } from "./ModelCapabilitySummary";
import { ModelCatalogRefreshButton } from "./ModelCatalogRefreshButton";
import { ModelProviderPicker } from "./ModelProviderPicker";
import { ToastProvider } from "../ui/ToastProvider";

const provider = {
  id: "anthropic",
  name: "Anthropic",
  source: "models-dev",
  availability: "available",
  diagnostics: [],
  hasAuthentication: false,
  hasPlaintextSecret: false,
  models: [],
};

describe("model settings components", () => {
  afterEach(cleanup);

  it("filters providers by name or id", async () => {
    const user = userEvent.setup();
    render(<ModelProviderPicker providers={[provider, { ...provider, id: "openai", name: "OpenAI" }]} value="" onChange={vi.fn()} placeholder="choose" ariaLabel="Provider" />);
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.type(screen.getByRole("textbox", { name: "搜索 Provider" }), "open");
    expect(screen.getByRole("option", { name: /OpenAI/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Anthropic/ })).toBeNull();
  });

  it("renders capability summary and exposes refresh status", async () => {
    const refresh = vi.fn(async () => ({ status: "updated" as const }));
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ModelCapabilitySummary models={[]} emptyLabel="select one" sharedLabel="shared" />
        <ModelCatalogRefreshButton onRefresh={refresh} label="refresh catalog" />
      </ToastProvider>,
    );
    expect(screen.getByText("select one")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "refresh catalog" }));
    expect((await screen.findByRole("status")).textContent).toContain("模型目录已更新");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
