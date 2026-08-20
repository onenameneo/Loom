// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./I18nProvider";

function Probe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span>{locale}</span>
      <span>{t("nav.project")}</span>
      <span>{t("settings.languageChinese")}</span>
      <span>{t("settings.languageEnglish")}</span>
      <button onClick={() => setLocale("en")}>switch</button>
    </div>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "language", { configurable: true, value: "zh-CN" });
  });

  it("switches the active dictionary and persists the choice", async () => {
    const user = userEvent.setup();
    render(<I18nProvider><Probe /></I18nProvider>);

    expect(screen.getByText("项目")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("简体中文")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(localStorage.getItem("loom:locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
