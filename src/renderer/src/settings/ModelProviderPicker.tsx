import { useMemo, useState } from "react";
import { LoomSelect, LoomSelectItem } from "../ui/controls";
import type { RendererProvider } from "./modelCatalogState";

export function ModelProviderPicker({
  providers,
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  searchPlaceholder = "搜索 Provider",
}: {
  providers: RendererProvider[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return providers;
    return providers.filter((provider) => `${provider.name} ${provider.id}`.toLowerCase().includes(normalized));
  }, [providers, query]);
  return (
    <div className="grid gap-loom-1">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} disabled={disabled} />
      <LoomSelect value={value} onValueChange={onChange} disabled={disabled} placeholder={placeholder} ariaLabel={ariaLabel}>
        {filteredProviders.map((provider) => (
          <LoomSelectItem key={provider.id} value={provider.id}>
            {provider.name} · {provider.id}
          </LoomSelectItem>
        ))}
      </LoomSelect>
    </div>
  );
}
