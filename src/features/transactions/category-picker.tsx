import { useEffect, useMemo, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import type { Category, CategoryGroup } from '@/lib/types';
import { useTransactionsStore } from './transactions-store';

/** Popover to assign a category to a transaction: search, grouped list, create new. */
export function CategoryPicker({ transactionId, onClose }: { transactionId: number; onClose: () => void }) {
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const setCategory = useTransactionsStore((s) => s.setCategory);
  const reload = useTransactionsStore((s) => s.load);
  const filter = useTransactionsStore((s) => s.filter);

  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ipc().listCategoryGroups().then(setGroups);
    inputRef.current?.focus();
  }, []);

  // Like the other popovers: a click outside or Escape (from anywhere) closes it without a change.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const categories = useMemo(() => Object.values(categoriesById).filter((c) => !c.archived), [categoriesById]);
  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? categories.filter((c) => c.name.toLowerCase().includes(q) || (groupName[c.groupId] ?? '').toLowerCase().includes(q))
      : categories;
    return [...list].sort((a, b) => (groupName[a.groupId] ?? '').localeCompare(groupName[b.groupId] ?? '') || a.sortOrder - b.sortOrder);
  }, [categories, groupName, query]);

  async function pick(id: number) {
    await setCategory(transactionId, id);
    onClose();
  }

  async function createAndPick() {
    const name = query.trim();
    if (!name) return;
    const id = await ipc().createCategory({ group: 'Other', name });
    await reload(filter.profileId ?? null, filter);
    await pick(id);
  }

  return (
    <div ref={panelRef} role="dialog" aria-label="Choose category" className="absolute right-6 top-20 z-20 flex max-h-[70vh] w-72 flex-col overflow-hidden rounded-xl border shadow-xl" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search categories"
        aria-label="Search categories"
        className="m-2 rounded-lg border bg-transparent px-3 py-2 text-sm"
        style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
      />
      <ul className="flex-1 overflow-y-auto px-1 pb-1">
        {matches.map((c: Category) => (
          <li key={c.id}>
            <button type="button" onClick={() => void pick(c.id)} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
              {c.emoji && <span aria-hidden="true">{c.emoji}</span>}
              <span>{c.name}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{groupName[c.groupId]}</span>
            </button>
          </li>
        ))}
        {query.trim() && !matches.some((c) => c.name.toLowerCase() === query.trim().toLowerCase()) && (
          <li>
            <button type="button" onClick={() => void createAndPick()} className="min-h-9 w-full rounded-lg px-3 text-left text-sm" style={{ color: 'var(--accent)' }}>
              Create “{query.trim()}”
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
