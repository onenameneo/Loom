import { LoomSearchableSelect } from "../ui/controls";
import type { RendererProvider } from "./modelCatalogState";

export function ModelProviderPicker({
  providers,
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  searchPlaceholder = "搜索 Provider",
  emptyLabel = "没有匹配的 Provider",
}: {
  providers: RendererProvider[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  return (
    <LoomSearchableSelect
      value={value}
      onValueChange={onChange}
      options={providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
        secondary: provider.id,
        keywords: (provider.authMethods ?? []).map((method) => method.label).join(" "),
      }))}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyLabel={emptyLabel}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}
