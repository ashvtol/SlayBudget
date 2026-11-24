import { useEffect, useMemo, useRef } from 'react';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import type { Transaction } from '@/lib/types';
import { SearchResults } from './search-results';
import { useSearchStore } from './search-store';
import { openSearchWindow } from './open-window';

/** Command-palette search overlay. Opens on Cmd/Ctrl+K or Cmd/Ctrl+F. */
export function SearchPalette() {
  const { open, query, results, loading, setQuery, closePalette } = useSearchStore();
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const go = useNavStore((s) => s.go);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pick = useMemo(
    () => (t: Transaction) => {
      go('transactions');
      void useTransactionsStore.getState().focusById(t.id);
      closePalette();
    },
    [go, closePalette],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={closePalette}
      role="presentation"
    >
      <div
        className="w-[36rem] max-w-[92vw] overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search transactions"
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closePalette();
              if (e.key === 'Enter' && results[0]) pick(results[0]);
            }}
            placeholder="Search transactions…"
            aria-label="Search query"
            className="field-bare flex-1 bg-transparent text-base outline-none"
            style={{ color: 'var(--text)' }}
          />
          {loading && <span className="text-xs" style={{ color: 'var(--muted)' }}>…</span>}
          <button
            type="button"
            onClick={() => void openSearchWindow()}
            aria-label="Open search in a new window"
            title="Open in new window"
            className="rounded-md px-1.5 text-sm"
            style={{ color: 'var(--muted)' }}
          >
            ⧉
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          <SearchResults results={results} categoriesById={categoriesById} query={query} onPick={pick} />
        </div>
      </div>
    </div>
  );
}
