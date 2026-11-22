import { formatSignedMoney, relativeDayLabel } from '@/lib/format';
import { CategoryPill } from '@/components/category-pill';
import type { Category, Transaction } from '@/lib/types';

/** Shared result rows for both the palette and the standalone search window. */
export function SearchResults({ results, categoriesById, query, onPick }: {
  results: Transaction[];
  categoriesById: Record<number, Category>;
  query: string;
  onPick?: (t: Transaction) => void;
}) {
  if (query.trim() === '') {
    return <p className="px-4 py-6 text-sm" style={{ color: 'var(--muted)' }}>Try “starbucks over $5 last month” or “groceries in January”.</p>;
  }
  if (results.length === 0) {
    return <p className="px-4 py-6 text-sm" style={{ color: 'var(--muted)' }}>No matches.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {results.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onPick?.(t)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{t.description}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{relativeDayLabel(t.postedOn)}</span>
            </span>
            <span className="flex items-center gap-3">
              {t.categoryId != null && <CategoryPill category={categoriesById[t.categoryId]} />}
              <span className="tabular-nums text-sm" style={{ color: t.amountCents < 0 ? 'var(--text)' : 'var(--pos)' }}>
                {formatSignedMoney(t.amountCents, t.currency)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
