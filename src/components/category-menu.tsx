import { useEffect, useMemo, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import type { Category, CategoryGroup } from '@/lib/types';

/** A searchable list of categories: type to narrow it (by name or group), Return picks the first match, a click
 *  outside or Escape closes it without a change. Emoji show without getting in the way of typing. */
export function CategoryMenu({
  categories,
  onPick,
  onClose,
  onCreate,
  noneLabel,
  className = '',
}: {
  categories: Category[];
  onPick: (id: number | null) => void;
  onClose: () => void;
  /** Offer "Create “…”" for a name that matches nothing. */
  onCreate?: (name: string) => void;
  /** A first choice meaning "no category" (picks null). */
  noneLabel?: string;
  className?: string;
}) {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ipc().listCategoryGroups().then(setGroups);
    inputRef.current?.focus();
  }, []);

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

  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = categories.filter((c) => !c.archived);
    const hits = q ? list.filter((c) => c.name.toLowerCase().includes(q) || (groupName[c.groupId] ?? '').toLowerCase().includes(q)) : list;
    // Names that start with what you typed come first, so "s" leads with Shopping and Subscriptions.
    const starts = (c: Category) => (q && c.name.toLowerCase().startsWith(q) ? 0 : 1);
    return [...hits].sort((a, b) => starts(a) - starts(b) || (groupName[a.groupId] ?? '').localeCompare(groupName[b.groupId] ?? '') || a.sortOrder - b.sortOrder);
  }, [categories, groupName, query]);

  const name = query.trim();
  const row = 'flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]';
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Choose category"
      className={`z-30 flex max-h-[60vh] w-72 flex-col overflow-hidden rounded-xl border shadow-xl ${className}`.trim()}
      style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault();
            onPick(matches[0].id);
          }
        }}
        placeholder="Search categories"
        aria-label="Search categories"
        className="field-bare m-2 rounded-lg border bg-transparent px-3 py-2 text-sm"
        style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
      />
      <ul className="m-0 flex-1 list-none overflow-y-auto px-1 pb-1">
        {noneLabel && !name && (
          <li>
            <button type="button" onClick={() => onPick(null)} className={row} style={{ color: 'var(--muted)' }}>
              {noneLabel}
            </button>
          </li>
        )}
        {matches.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c.id)} className={row}>
              {c.emoji && <span aria-hidden="true">{c.emoji}</span>}
              <span>{c.name}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{groupName[c.groupId]}</span>
            </button>
          </li>
        ))}
        {onCreate && name && !matches.some((c) => c.name.toLowerCase() === name.toLowerCase()) && (
          <li>
            <button type="button" onClick={() => onCreate(name)} className="min-h-9 w-full rounded-lg px-3 text-left text-sm" style={{ color: 'var(--accent)' }}>
              Create “{name}”
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
