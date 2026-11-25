import { useEffect, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { todayStr } from '@/features/analytics/analytics-store';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { Category, Transaction } from '@/lib/types';
import { SearchResults } from './search-results';

/** Standalone search view rendered in its own window (index.html?view=search). */
export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Transaction[]>([]);
  const [categoriesById, setCategoriesById] = useState<Record<number, Category>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const activeProfile = useProfileStore((s) => s.activeProfileId);
  const seq = useRef(0);

  useEffect(() => {
    void useProfileStore.getState().load();
    void ipc().listCategories().then((cats) => {
      const map: Record<number, Category> = {};
      for (const c of cats) map[c.id] = c;
      setCategoriesById(map);
    });
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    if (query.trim() === '') return;
    void ipc().searchTransactions(activeProfile, query, todayStr(), 200).then((r) => {
      if (mine === seq.current) setResults(r);
    });
  }, [query, activeProfile]);

  const shown = query.trim() === '' ? [] : results;

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions…"
          aria-label="Search query"
          className="field-bare w-full bg-transparent text-lg outline-none"
          style={{ color: 'var(--text)' }}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <SearchResults results={shown} categoriesById={categoriesById} query={query} />
      </div>
    </div>
  );
}
