import type { ComponentType, ReactNode } from 'react';

/** Small outlined button used in page and panel header bars. */
export function ToolbarButton({
  icon: Icon,
  children,
  onClick,
  active = false,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  title,
  disabled = false,
}: {
  icon?: ComponentType<{ size?: number }>;
  children?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  /** Tooltip, mainly for icon-only buttons. */
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      title={title}
      disabled={disabled}
      className={`disabled:cursor-default disabled:opacity-40 inline-flex h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border text-[12px] font-semibold transition-colors hover:brightness-125 ${children ? 'px-2.5' : 'w-[28px] justify-center'}`}
      style={{
        borderColor: 'var(--line-strong)',
        background: active ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--panel)',
        color: active ? 'var(--accent)' : 'var(--text)',
      }}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}
