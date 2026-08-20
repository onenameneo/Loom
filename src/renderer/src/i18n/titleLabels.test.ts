import { describe, expect, it } from "vitest";
import { localizedNodeTitle, localizedSessionTitle } from "./titleLabels";

const t = (key: string) => ({
  "title.defaultSession": "New session",
  "title.root": "Root",
  "title.branch": "New branch",
}[key] ?? key);

describe("localized default titles", () => {
  it("uses the active locale for stored default titles", () => {
    expect(localizedSessionTitle("新会话", t)).toBe("New session");
    expect(localizedNodeTitle("起点", t)).toBe("Root");
    expect(localizedNodeTitle("新分支", t)).toBe("New branch");
  });

  it("preserves manual titles", () => {
    expect(localizedSessionTitle("新会话", t, "manual")).toBe("新会话");
    expect(localizedNodeTitle("起点", t, "manual")).toBe("起点");
  });
});
