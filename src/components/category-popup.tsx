import { useState } from 'react';
import type { Category } from '@/lib/types';
import { CategoryMenu } from './category-menu';

/** A pop-up button for choosing a category, in place of a native menu: the native one jumps by the first character
 *  typed, which is the emoji, so typing "S" never reached Subscriptions. This one opens the searchable menu. */
export function CategoryPopup({
  label,
  categories,
  value,
  onChange,
  placeholder,
  noneLabel,
  className = '',
  buttonClassName = 'h-[26px]',
}: {
  /** Accessible name of the button. */
  label: string;
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  noneLabel?: string;
  className?: string;
  /** Height of the button: a list row (default) or a form field. */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = value != null ? categories.find((c) => c.id === value) : undefined;
  return (
    <span className={`relative inline-block ${className}`.trim()}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex ${buttonClassName} w-full items-center gap-1.5 rounded-md border px-2 text-left text-[13px]`}
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: chosen ? 'var(--text)' : 'var(--muted)' }}
      >
        <span className="min-w-0 flex-1 truncate">{chosen ? `${chosen.emoji ? `${chosen.emoji} ` : ''}${chosen.name}` : value == null && noneLabel ? noneLabel : placeholder}</span>
        <svg aria-hidden="true" width="8" height="11" viewBox="0 0 8 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)' }}>
          <path d="M1.5 4 4 1.5 6.5 4M1.5 7 4 9.5 6.5 7" />
        </svg>
      </button>
      {open && (
        <CategoryMenu
          className="absolute right-0 top-[30px]"
          categories={categories}
          noneLabel={noneLabel}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            onChange(id);
          }}
        />
      )}
    </span>
  );
}
