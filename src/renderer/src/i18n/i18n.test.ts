import { describe, expect, it } from "vitest";
import {
  I18N_STORAGE_KEY,
  detectLocale,
  interpolate,
  normalizeLocale,
  readStoredLocale,
  writeStoredLocale,
  type Locale,
} from "./i18n";

describe("i18n locale helpers", () => {
  it("normalizes supported and unsupported locale values", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("fr-FR")).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });

  it("prefers an explicit stored locale and falls back to the browser locale", () => {
    expect(detectLocale("en", "zh-CN")).toBe("en");
    expect(detectLocale(null, "en-GB")).toBe("en");
    expect(detectLocale(null, "zh-TW")).toBe("zh-CN");
    expect(detectLocale(null, "fr-FR")).toBe("zh-CN");
  });

  it("interpolates named values without changing missing placeholders", () => {
    expect(interpolate("删除项目「{name}」？", { name: "Loom" })).toBe("删除项目「Loom」？");
    expect(interpolate("{count} items · {missing}", { count: 2 })).toBe("2 items · {missing}");
  });

  it("persists only supported locales", () => {
    const writes: string[] = [];
    const storage = {
      getItem: (key: string) => key === I18N_STORAGE_KEY ? "en" : null,
      setItem: (key: string, value: string) => writes.push(`${key}=${value}`),
    };
    expect(readStoredLocale(storage)).toBe("en");
    writeStoredLocale(storage, "zh-CN" satisfies Locale);
    expect(writes).toEqual([`${I18N_STORAGE_KEY}=zh-CN`]);
  });
});
