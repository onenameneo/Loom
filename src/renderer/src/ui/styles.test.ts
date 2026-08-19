import { describe, expect, it } from "vitest";
import { buttonClassName, cn, fieldClassName, iconButtonClassName } from "./styles";

describe("shared Loom UI styles", () => {
  it("combines optional classes without empty fragments", () => {
    expect(cn("base", false, undefined, "extra")).toBe("base extra");
  });

  it("uses semantic tokens for button variants and states", () => {
    const primary = buttonClassName("primary");
    const danger = buttonClassName("danger");

    expect(primary).toContain("bg-loom-accent");
    expect(primary).toContain("text-loom-on-accent");
    expect(primary).toContain("hover:bg-loom-accent-hover");
    expect(danger).toContain("border-loom-border-strong");
    expect(danger).toContain("bg-transparent");
    expect(danger).toContain("text-loom-muted");
    expect(danger).toContain("hover:border-loom-err/60");
    expect(danger).toContain("hover:bg-loom-err/10");
    expect(danger).toContain("hover:text-loom-err");
    expect(primary).toContain("focus-visible:outline-loom-accent");
  });

  it("provides shared field and icon button contracts", () => {
    expect(fieldClassName).toContain("bg-loom-surface-2");
    expect(fieldClassName).toContain("focus:border-loom-accent");
    expect(iconButtonClassName("danger")).toContain("hover:text-loom-err");
  });
});
