// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMcpForm, type McpFormState } from "./mcpForm";
import { McpBearerCredentialField } from "./McpBearerCredentialField";

function renderField(overrides: Partial<McpFormState> = {}, storage: "available" | "unavailable" = "available") {
  const form = { ...emptyMcpForm(), ...overrides };
  const onChange = vi.fn<(update: Partial<McpFormState>) => void>();
  render(<McpBearerCredentialField form={form} onChange={onChange} managedCredentialStorage={storage} />);
  return { onChange };
}

afterEach(() => cleanup());

describe("McpBearerCredentialField", () => {
  it("accepts a direct token without rendering it as text", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    const input = screen.getByLabelText("Bearer 令牌");

    await user.type(input, "super-secret-token");

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText("Loom 安全存储")).toBeTruthy();
    expect(screen.queryByText("super-secret-token")).toBeNull();
  });

  it("shows configured state and provides an explicit clear action", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ managedCredentialConfigured: true });

    expect(screen.getByText("凭证已配置，留空将保持不变")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "清除已保存令牌" }));
    expect(onChange).toHaveBeenCalledWith({ clearManagedBearer: true, bearerToken: "" });
  });

  it("disables managed entry when secure storage is unavailable", () => {
    renderField({}, "unavailable");

    expect(screen.getByText("Loom 安全存储当前不可用，请改用环境变量")).toBeTruthy();
    expect((screen.getByLabelText("Bearer 令牌") as HTMLInputElement).disabled).toBe(true);
  });
});
