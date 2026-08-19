import { useId, type ReactNode } from "react";
import { Checkbox, Select } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
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
