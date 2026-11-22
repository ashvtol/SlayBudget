import { useEffect, useMemo, useRef } from 'react';
import { sourceDotColors } from '@/lib/source-colors';
import { filterPills } from './filter-model';
import { useTagsStore } from '@/lib/stores/tags-store';
import { displayName } from '@/features/analytics/recurrings-model';
import { IconClose, IconSearch } from '@/components/icons';
import { useTransactionsStore, type TxSort } from './transactions-store';

/** Copilot pills for the active filters, under the toolbar: category pills in the category's color with
 * emoji, account pills with the account's dot, others neutral; "Clear all" when two or more. */
export function FilterChips() {
  const filter = useTransactionsStore((s) => s.filter);
  const sourcesById = useTransactionsStore((s) => s.sourcesById);
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const removePill = useTransactionsStore((s) => s.removePill);
  const clearAllFilters = useTransactionsStore((s) => s.clearAllFilters);
  const recurringsById = useTransactionsStore((s) => s.recurringsById);
  const sourceColors = useMemo(() => sourceDotColors(Object.values(sourcesById)), [sourcesById]);
  const recurringNames = useMemo(() => Object.fromEntries(Object.entries(recurringsById).map(([id, r]) => [id, displayName(r)])), [recurringsById]);
  const tagsById = useTagsStore((s) => s.byId);
  const pills = filterPills(filter, { categoriesById, sourcesById, sourceColors, recurringNames, tagsById });
  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-6 py-2.5" style={{ borderColor: 'var(--line)' }}>
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-label={`Remove ${p.label} filter`}
          onClick={() => void removePill(p)}
          className="inline-flex h-[24px] items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold"
          style={p.color ? { background: p.color, color: '#fff' } : { background: 'var(--hover)', color: 'var(--text)', border: '1px solid var(--line-strong)' }}
        >
          {p.dot && <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ background: p.dot }} />}
          {p.emoji && <span aria-hidden="true">{p.emoji}</span>}
          {p.label}
          <IconClose size={11} />
        </button>
      ))}
      {pills.length >= 2 && (
        <button type="button" onClick={() => void clearAllFilters()} className="ml-1 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
          Clear all
        </button>
      )}
    </div>
  );
}

/** The search row revealed by the toolbar's search button. */
export function SearchField() {
  const text = useTransactionsStore((s) => s.filter.text);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  return (
    <div className="flex items-center gap-2 border-b px-8 py-2" style={{ borderColor: 'var(--line)' }}>
      <IconSearch size={13} style={{ color: 'var(--muted)' }} />
      <input
        type="search"
        autoFocus
        value={text ?? ''}
        onChange={(e) => void applyFilter({ text: e.target.value || undefined })}
        placeholder="Search transactions"
        aria-label="Search transactions"
        className="h-[24px] flex-1 bg-transparent text-[13px] outline-none"
        style={{ color: 'var(--text)' }}
      />
    </div>
  );
}

export const SORT_OPTIONS: { id: TxSort; label: string }[] = [
  { id: 'newest', label: 'Sort by date' },
  { id: 'amountDesc', label: 'Sort by amount (high to low)' },
  { id: 'amountAsc', label: 'Sort by amount (low to high)' },
];

export function SortMenu({ onClose }: { onClose: () => void }) {
  const sort = useTransactionsStore((s) => s.sort);
  const setSort = useTransactionsStore((s) => s.setSort);
  return (
    <Popover label="Sort" onClose={onClose} role="menu">
      {SORT_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="menuitemradio"
          aria-checked={sort === o.id}
          onClick={() => {
            setSort(o.id);
            onClose();
          }}
          className="flex h-[28px] w-full items-center rounded-md px-2 text-left text-[13px]"
          style={{ background: sort === o.id ? 'var(--hover)' : 'transparent', color: 'var(--text)' }}
        >
          {o.label}
        </button>
      ))}
    </Popover>
  );
}

/** Small floating panel under a toolbar button; Escape or an outside click closes it. */
function Popover({ label, onClose, role = 'dialog', children }: { label: string; onClose: () => void; role?: 'dialog' | 'menu'; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className="absolute left-0 top-[34px] z-30 w-[240px] rounded-lg border p-1.5 shadow-2xl"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {children}
    </div>
  );
}
