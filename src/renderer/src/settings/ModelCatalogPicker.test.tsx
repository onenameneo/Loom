// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelCatalogPicker } from "./ModelCatalogPicker";

const model = {
  id: "gpt-5.2",
  providerId: "openai",
  name: "GPT 5.2",
  api: "openai-completions" as const,
  source: "models-dev" as const,
  availability: "available" as const,
  available: true,
  diagnostics: [],
  capabilities: { reasoning: true, images: true, contextWindow: 128000, maxOutputTokens: 16000 },
};

describe("ModelCatalogPicker", () => {
  it("renders catalog capabilities and exposes selection callbacks", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <ModelCatalogPicker
        models={[model]}
        selectedIds={[]}
        onToggle={onToggle}
        onSelectAll={vi.fn()}
        onClear={vi.fn()}
        onAddCustom={vi.fn()}
        editing={false}
        selectAllLabel="select all"
        clearLabel="clear"
        addCustomLabel="custom"
      />,
    );

    expect(screen.getByText("GPT 5.2")).toBeTruthy();
    expect(screen.getByText("128,000 ctx")).toBeTruthy();
    expect(screen.getByText("reasoning")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "GPT 5.2" }));
    expect(onToggle).toHaveBeenCalledWith("gpt-5.2");
  });
});
