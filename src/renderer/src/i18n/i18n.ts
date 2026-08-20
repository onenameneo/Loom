export const I18N_STORAGE_KEY = "loom:locale";

export type Locale = "zh-CN" | "en";

export const DEFAULT_LOCALE: Locale = "zh-CN";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  if (value.toLowerCase().startsWith("zh")) return "zh-CN";
  if (value.toLowerCase().startsWith("en")) return "en";
  return null;
}

export function detectLocale(stored: string | null | undefined, browserLocale: string | null | undefined): Locale {
  return normalizeLocale(stored) ?? normalizeLocale(browserLocale) ?? DEFAULT_LOCALE;
}

export function interpolate(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
  ));
}

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredLocale(storage: LocaleStorage): Locale | null {
  return normalizeLocale(storage.getItem(I18N_STORAGE_KEY));
}

export function writeStoredLocale(storage: LocaleStorage, locale: Locale): void {
  storage.setItem(I18N_STORAGE_KEY, locale);
}
