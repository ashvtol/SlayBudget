import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { dayHeaderLabel } from '@/lib/format';
import { buildRows } from './row-model';
import { isFiltered, monthLabel } from './filter-model';
import { Money } from '@/components/money';
import { TransactionRow } from './transaction-row';
import { useTransactionsStore } from './transactions-store';

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 40;
const MONTH_HEIGHT = 56;

/** The scrolling, virtualized, keyboard-driven transaction list.
 *  onOpen/onPickCategory/onFilters are wired to the detail pane, picker and filters. */
export function TransactionsList({
  onOpen,
  onPickCategory,
  onFilters,
  activeId,
  paused = false,
}: {
  onOpen: (id: number) => void;
  onPickCategory: (id: number) => void;
  onFilters: () => void;
  /** The row shown in the detail panel; highlighted instead of the keyboard cursor when set. */
  activeId?: number | null;
  /** A menu or picker is open over the list: its single-key shortcuts are off. */
  paused?: boolean;
}) {
  const { transactions, categoriesById, sourcesById, selected, cursor, sort } = useTransactionsStore();
  // Computed here (not in a selector) because ordering returns a new array.
  const ordered = useMemo(() => useTransactionsStore.getState().orderedTransactions(), [transactions, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSelect = useTransactionsStore((s) => s.toggleSelect);
  const toggleReviewed = useTransactionsStore((s) => s.toggleReviewed);
  const moveCursor = useTransactionsStore((s) => s.moveCursor);
  const cursorId = useTransactionsStore((s) => s.cursorId);

  const filtered = useTransactionsStore((s) => isFiltered(s.filter));
  const byDate = sort === 'newest' || sort === 'oldest';
  const rows = useMemo(() => buildRows(ordered, { groupByDay: byDate, months: byDate && filtered }), [ordered, byDate, filtered]);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (i) => rows[i].key,
    estimateSize: (i) => (rows[i].kind === 'month' ? MONTH_HEIGHT : rows[i].kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 10,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (paused) return;
      // A modal dialog (Make recurring, confirmations) owns the keyboard.
      if (document.querySelector('[aria-modal="true"]')) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      // A popover (tag picker, menus) with focus owns the keyboard too.
      if (el.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      const id = cursorId();
      switch (e.key.toLowerCase()) {
        case 'arrowdown':
        case 'arrowup': {
          e.preventDefault();
          moveCursor(e.key.toLowerCase() === 'arrowdown' ? 1 : -1);
          // The detail panel follows the cursor.
          const next = cursorId();
          if (next != null && activeId !== undefined) onOpen(next);
          break;
        }
        case 'x':
          if (id != null) toggleSelect(id);
          break;
        case 'r':
          if (id != null) void toggleReviewed([id]);
          break;
        case 'c':
          if (id != null) onPickCategory(id);
          break;
        case 'f':
          onFilters();
          break;
        case 'enter':
          if (id != null) onOpen(id);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursorId, moveCursor, toggleSelect, toggleReviewed, onPickCategory, onFilters, onOpen, activeId, paused]);

  if (transactions.length === 0) {
    return (
      <p role="status" className="px-3 py-8 text-sm" style={{ color: 'var(--muted)' }}>
        {filtered ? 'No transactions match these filters.' : 'No transactions yet. Import a statement to get started.'}
      </p>
    );
  }

  return (
    <div ref={parentRef} role="grid" aria-label="Transactions" className="relative flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          return (
            <div
              key={row.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
            >
              {row.kind === 'month' ? (
                <h2 className="m-0 flex h-[56px] items-end justify-between px-8 pb-2 text-[18px] font-semibold">
                  <span>{monthLabel(row.month)}</span>
                  <Money cents={Math.abs(row.totalCents)} tone={row.totalCents < 0 ? 'pos' : 'default'} />
                </h2>
              ) : row.kind === 'header' ? (
                <div className="label-caps flex h-[40px] items-end px-8 pb-2" style={{ color: 'var(--subtle)' }}>
                  {dayHeaderLabel(row.day)}
                </div>
              ) : (
                <TransactionRow
                  tx={row.tx}
                  category={row.tx.categoryId != null ? categoriesById[row.tx.categoryId] : undefined}
                  source={sourcesById[row.tx.sourceId]}
                  selected={selected.has(row.tx.id)}
                  active={activeId != null ? row.tx.id === activeId : cursor === row.index}
                  onToggleSelect={() => toggleSelect(row.tx.id)}
                  onOpen={() => onOpen(row.tx.id)}
                  onPickCategory={() => onPickCategory(row.tx.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
