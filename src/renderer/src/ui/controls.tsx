import { useId, type ReactNode } from "react";
import { Checkbox, Select } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

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
      <Select.Trigger className="loom-select__trigger" aria-label={ariaLabel}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="loom-select__icon"><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="loom-select__content" position="popper" sideOffset={6}>
          <Select.Viewport className="loom-select__viewport">{children}</Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function LoomSelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Select.Item value={value} className="loom-select__item">
      <Select.ItemText>{children}</Select.ItemText>
      <Select.ItemIndicator className="loom-select__indicator"><Check size={14} /></Select.ItemIndicator>
    </Select.Item>
  );
}

export function LoomSelectGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Select.Group>
      <Select.Label className="loom-select__label">{label}</Select.Label>
      {children}
    </Select.Group>
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
    <div className={`loom-checkbox-field ${disabled ? "is-disabled" : ""}`}>
      <Checkbox.Root
        id={id}
        className="loom-checkbox"
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
      >
        <Checkbox.Indicator className="loom-checkbox__indicator"><Check size={14} /></Checkbox.Indicator>
      </Checkbox.Root>
      <div className="loom-checkbox-field__copy">
        <label htmlFor={id}>{label}</label>
        {description && <span>{description}</span>}
      </div>
    </div>
  );
}
