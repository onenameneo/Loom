import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Checkbox, Popover, Select } from "radix-ui";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  checkboxClassName,
  checkboxCopyClassName,
  checkboxFieldClassName,
  checkboxIndicatorClassName,
  checkboxMarkClassName,
  cn,
  selectContentClassName,
  selectItemClassName,
  selectTriggerClassName,
} from "./styles";

export function LoomSelect({
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  disabled = false,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Select.Root value={value || "__loom_empty__"} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger className={selectTriggerClassName} aria-label={ariaLabel}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="inline-flex shrink-0 text-loom-muted"><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={selectContentClassName} position="popper" sideOffset={6}>
          <Select.Viewport className="p-loom-1">{children}</Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function LoomSelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Select.Item value={value} className={selectItemClassName}>
      <Select.ItemText>{children}</Select.ItemText>
      <Select.ItemIndicator className="absolute right-[10px] inline-flex text-loom-accent"><Check size={14} /></Select.ItemIndicator>
    </Select.Item>
  );
}

export function LoomSelectGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Select.Group>
      <Select.Label className="px-[10px] pb-1 pt-2 font-loom-mono text-[10px] text-loom-faint">{label}</Select.Label>
      {children}
    </Select.Group>
  );
}

export interface LoomSearchableOption {
  value: string;
  label: string;
  secondary?: string;
  keywords?: string;
}

export function LoomSearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: LoomSearchableOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedValue, setHighlightedValue] = useState(value || options[0]?.value || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => `${option.label} ${option.secondary ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedValue(value || options[0]?.value || "");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const choose = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!filteredOptions.length) return;
    const index = Math.max(0, filteredOptions.findIndex((option) => option.value === highlightedValue));
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedValue(filteredOptions[(index + 1) % filteredOptions.length].value);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedValue(filteredOptions[(index - 1 + filteredOptions.length) % filteredOptions.length].value);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedValue(filteredOptions[0].value);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedValue(filteredOptions[filteredOptions.length - 1].value);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(highlightedValue || filteredOptions[0].value);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className={selectTriggerClassName} type="button" role="combobox" disabled={disabled} aria-label={ariaLabel} aria-expanded={open} aria-controls={`${ariaLabel.replace(/\s+/g, "-")}-options`}>
          <span className="min-w-0 truncate">
            {selected ? <><span>{selected.label}</span>{selected.secondary && <span className="ml-loom-2 font-loom-mono text-[11px] text-loom-faint">· {selected.secondary}</span>}</> : <span className="text-loom-muted">{placeholder}</span>}
          </span>
          <ChevronDown size={16} className="shrink-0 text-loom-muted" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="loom-searchable-select__content z-[230] w-[var(--radix-popover-trigger-width)] min-w-[240px] overflow-hidden rounded-loom-md border border-loom-border-strong bg-loom-surface shadow-loom-float"
          sideOffset={6}
          align="start"
          onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
        >
          <div className="flex items-center gap-loom-2 border-b border-loom-border px-loom-2 py-loom-2">
            <Search size={14} className="shrink-0 text-loom-faint" aria-hidden="true" />
            <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] text-loom-text outline-none placeholder:text-loom-faint" placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          </div>
          <div id={`${ariaLabel.replace(/\s+/g, "-")}-options`} className="loom-searchable-select__list p-loom-1" role="listbox" aria-label={ariaLabel} tabIndex={0}>
            {filteredOptions.length === 0 ? <div className="px-loom-2 py-loom-4 text-center text-[12px] text-loom-muted">{emptyLabel}</div> : filteredOptions.map((option) => {
              const selectedOption = option.value === value;
              const highlighted = option.value === highlightedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selectedOption}
                  className={cn("flex min-h-[40px] w-full items-center gap-loom-2 rounded-loom-sm border-0 bg-transparent px-loom-2 text-left text-[12.5px] text-loom-text outline-none", highlighted && "bg-loom-surface-2", "focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]")}
                  onMouseEnter={() => setHighlightedValue(option.value)}
                  onClick={() => choose(option.value)}
                >
                  <span className="min-w-0 flex-1"><span className="block truncate">{option.label}</span>{option.secondary && <span className="block truncate font-loom-mono text-[10.5px] text-loom-faint">{option.secondary}</span>}</span>
                  {selectedOption && <Check size={14} className="shrink-0 text-loom-accent" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function LoomCheckbox({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  ariaLabel,
  className,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Checkbox.Root
      type="button"
      id={id}
      className={cn(checkboxClassName, className)}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <Checkbox.Indicator className={checkboxIndicatorClassName}>
        <svg className={checkboxMarkClassName} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.25 4.75 9 10 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

export function LoomCheckboxField({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn(checkboxFieldClassName, disabled && "opacity-70")}>
      <LoomCheckbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <div className={checkboxCopyClassName}>
        <label className={cn("cursor-pointer text-[13px] leading-normal text-loom-text", disabled && "cursor-not-allowed text-loom-faint")} htmlFor={id}>{label}</label>
        {description && <span className="font-loom-mono text-[10.5px] leading-normal text-loom-faint">{description}</span>}
      </div>
    </div>
  );
}
