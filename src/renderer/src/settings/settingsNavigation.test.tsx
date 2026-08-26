// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsNav } from "./SettingsNav";
import { DEFAULT_SETTINGS_SECTION, isSettingsSection, readStoredSettingsSection, SETTINGS_SECTION_STORAGE_KEY } from "./settingsNavigation";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("settings navigation", () => {
  it("uses Models as the default and rejects invalid stored ids", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe("models");
    expect(isSettingsSection("mcp")).toBe(true);
    expect(isSettingsSection("unknown")).toBe(false);
    localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, "unknown");
    expect(readStoredSettingsSection()).toBe("models");
  });

  it("renders grouped sections and supports keyboard section movement", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<SettingsNav value="models" onValueChange={onValueChange} />);

    expect(screen.getByText("常规")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("扩展")).toBeTruthy();
    expect(screen.getByRole("button", { name: "模型配置" }).getAttribute("aria-current")).toBe("page");

    const models = screen.getByRole("button", { name: "模型配置" });
    models.focus();
    await user.keyboard("{ArrowDown}");
    expect(onValueChange).toHaveBeenCalledWith("permissions");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agent 权限" }));
  });
});
