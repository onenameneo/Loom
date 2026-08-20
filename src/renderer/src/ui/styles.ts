export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]) {
  return values.filter(Boolean).join(" ");
}

export type ButtonVariant = "default" | "primary" | "danger";

const interactiveTransition = "transition-[color,border-color,background-color] duration-150 ease-loom";

const buttonBase = cn(
  "inline-flex min-h-[36px] items-center justify-center gap-loom-2",
  "cursor-pointer rounded-loom-md border border-loom-border-strong",
  "px-[14px] py-2 text-[13px]",
  interactiveTransition,
  "hover:border-loom-accent",
  "focus-visible:outline-2 focus-visible:outline-loom-accent focus-visible:outline-offset-1",
  "disabled:cursor-not-allowed disabled:opacity-[.55]",
  "[&>svg]:h-[14px] [&>svg]:w-[14px] [&>svg]:shrink-0",
);

const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-loom-surface text-loom-text",
  primary: "border-loom-accent bg-loom-accent text-loom-on-accent hover:border-loom-accent-hover hover:bg-loom-accent-hover",
  danger: "border-loom-border-strong bg-transparent text-loom-muted hover:border-loom-err/60 hover:bg-loom-err/10 hover:text-loom-err",
};

export function buttonClassName(variant: ButtonVariant = "default", className?: string) {
  return cn(buttonBase, buttonVariants[variant], className);
}

const iconButtonBase = cn(
  "grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-loom-md border",
  interactiveTransition,
  "focus-visible:outline-2 focus-visible:outline-loom-accent focus-visible:outline-offset-1",
  "disabled:cursor-default disabled:opacity-[.45]",
  "[&>svg]:block [&>svg]:stroke-current",
);

const iconButtonVariants: Record<ButtonVariant, string> = {
  default: "border-loom-border bg-transparent text-loom-muted hover:bg-loom-surface-2 hover:text-loom-text",
  primary: "border-loom-accent bg-loom-accent text-loom-on-accent hover:border-loom-accent-hover hover:bg-loom-accent-hover",
  danger: "border-loom-border bg-transparent text-loom-muted hover:border-loom-err hover:bg-transparent hover:text-loom-err",
};

export function iconButtonClassName(variant: ButtonVariant = "default", className?: string) {
  return cn(iconButtonBase, iconButtonVariants[variant], className);
}

export const fieldClassName = cn(
  "w-full rounded-loom-md border border-loom-border bg-loom-surface-2 px-[11px] py-[9px]",
  "font-loom-ui text-[13px] text-loom-text outline-none",
  "transition-[border-color,box-shadow] duration-150 ease-loom",
  "focus:border-loom-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]",
  "disabled:cursor-not-allowed disabled:text-loom-faint",
);

export const dialogTitleClassName = "m-0 text-[14px] font-semibold leading-[1.4] text-loom-text";
export const dialogDescriptionClassName = "m-0 text-[12.5px] text-loom-muted";
export const dialogActionsClassName = "mt-1 flex justify-end gap-loom-2";

export const selectTriggerClassName = cn(
  "inline-flex min-h-[44px] w-full min-w-0 cursor-pointer items-center justify-between gap-loom-3",
  "rounded-loom-md border border-loom-border bg-loom-surface-2 px-3",
  "text-left font-loom-ui text-[13px] text-loom-text outline-none",
  interactiveTransition,
  "hover:border-loom-border-strong hover:bg-loom-surface",
  "focus-visible:border-loom-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]",
  "data-[disabled]:cursor-not-allowed data-[disabled]:text-loom-faint data-[disabled]:opacity-70",
);

export const selectContentClassName = cn(
  "z-[220] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]",
  "overflow-hidden rounded-loom-md border border-loom-border-strong bg-loom-surface shadow-loom-float",
  "animate-[dlg-fade-in_140ms_var(--panel-motion-curve)]",
);

export const selectItemClassName = cn(
  "relative flex min-h-[36px] cursor-pointer items-center rounded-loom-sm px-[10px] pr-8",
  "text-[12.5px] text-loom-text outline-none",
  "data-[highlighted]:bg-loom-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:text-loom-faint",
);

export const checkboxFieldClassName = "flex min-h-[40px] items-start gap-loom-3 text-loom-text";
export const checkboxClassName = cn(
  "mt-px grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-loom-sm",
  "border border-loom-border-strong bg-loom-surface text-loom-on-accent outline-none",
  "hover:border-loom-accent focus-visible:border-loom-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]",
  "data-[state=checked]:border-loom-accent data-[state=checked]:bg-loom-accent",
  "disabled:cursor-not-allowed disabled:opacity-[.45]",
);
export const checkboxIndicatorClassName = "inline-flex h-2 w-2 items-center justify-center text-loom-on-accent";
export const checkboxMarkClassName = "block h-3 w-3 shrink-0";
export const checkboxCopyClassName = "grid min-w-0 gap-[3px]";
