import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon } from '@/components/category-icon';
import { ipc } from '@/lib/ipc';
import { displayName } from '@/features/analytics/recurrings-model';
import { sourceDotColors } from '@/lib/source-colors';
import type { CategoryGroup, Recurring, TxType } from '@/lib/types';
import { monthLabel, monthsByYear, TYPE_LABELS, type FilterValue } from './filter-model';
import { useTransactionsStore } from './transactions-store';
import { useTagsStore } from '@/lib/stores/tags-store';

type Item = 'Account' | 'Category' | 'Date' | 'Keywords' | 'Recurring' | 'Review status' | 'Tags' | 'Type';
const ITEMS: Item[] = ['Account', 'Category', 'Date', 'Keywords', 'Recurring', 'Review status', 'Tags', 'Type'];

const panelClass = 'absolute z-30 w-[220px] rounded-lg border p-1.5 shadow-2xl';
const panelStyle = { background: 'var(--panel)', borderColor: 'var(--line-strong)' } as const;
const rowClass = 'flex h-[28px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]';

function Chevron() {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="ml-auto" style={{ color: 'var(--muted)' }}>
      <path d="M3.5 2 L6.5 5 L3.5 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Copilot's Filter menu: one item per kind, each opening a submenu to its right. Escape closes one level. */
export function FilterMenu({ onClose }: { onClose: () => void }) {
  const filter = useTransactionsStore((s) => s.filter);
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const sourcesById = useTransactionsStore((s) => s.sourcesById);
  const toggleFilter = useTransactionsStore((s) => s.toggleFilter);
  const tags = useTagsStore((s) => s.tags);
  const profileId = filter.profileId ?? null;

  const [open, setOpen] = useState<Item | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([ipc().listCategoryGroups(), ipc().listRecurring(profileId), ipc().listTransactions({ profileId })]).then(([g, r, all]) => {
      if (!live) return;
      setGroups(g);
      setRecurring(r);
      setDays(all.map((t) => t.postedOn));
    });
    return () => {
      live = false;
    };
  }, [profileId]);

  // Escape closes the deepest open level; a click outside closes everything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (year) setYear(null);
      else if (open) setOpen(null);
      else onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, year, onClose]);

  const pick = (v: FilterValue) => {
    void toggleFilter(v);
    onClose();
  };
  const show = (item: Item) => {
    setOpen(item);
    setYear(null);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const sources = useMemo(() => Object.values(sourcesById), [sourcesById]);
  const dots = useMemo(() => sourceDotColors(sources), [sources]);
  const years = useMemo(() => monthsByYear(days), [days]);
  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
  const groupColor = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.color])), [groups]);
  const categories = useMemo(
    () =>
      Object.values(categoriesById)
        .filter((c) => !c.archived)
        .sort((a, b) => (groupName[a.groupId] ?? '').localeCompare(groupName[b.groupId] ?? '') || a.name.localeCompare(b.name)),
    [categoriesById, groupName],
  );

  const check = (label: React.ReactNode, checked: boolean, onClick: () => void, key: string | number, name?: string) => (
    <button key={key} type="button" role="menuitemcheckbox" aria-checked={checked} aria-label={name} onClick={onClick} className={rowClass} style={{ color: checked ? 'var(--accent)' : 'var(--text)' }}>
      {label}
    </button>
  );
  const search = (item: Item) => (
    <input
      autoFocus
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search..."
      aria-label={`Search ${item}`}
      className="mb-1 w-full rounded-md border bg-transparent px-2 py-1 text-[12px]"
      style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
    />
  );

  const submenu = (item: Item) => {
    switch (item) {
      case 'Account':
        return (
          <>
            {search(item)}
            {sources
              .filter((s) => matches(s.name))
              .map((s) =>
                check(
                  <>
                    <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: dots[s.id] }} />
                    {s.name}
                  </>,
                  (filter.sourceIds ?? []).includes(s.id),
                  () => pick({ kind: 'account', value: s.id }),
                  s.id,
                  s.name,
                ),
              )}
          </>
        );
      case 'Category': {
        const shown = categories.filter((c) => matches(c.name));
        return (
          <>
            {search(item)}
            <div className="max-h-[50vh] overflow-y-auto">
              {shown.map((c, i) => (
                <div key={c.id}>
                  {!q && groupName[c.groupId] !== groupName[shown[i - 1]?.groupId] && groupName[c.groupId] !== c.name && (
                    <div className="label-caps px-2 pb-0.5 pt-1.5" style={{ color: 'var(--subtle)' }}>{groupName[c.groupId]}</div>
                  )}
                  {check(
                    <>
                      <CategoryIcon emoji={c.emoji} color={c.color ?? groupColor[c.groupId]} />
                      {c.name}
                    </>,
                    (filter.categoryIds ?? []).includes(c.id),
                    () => pick({ kind: 'category', value: c.id }),
                    c.id,
                    c.name,
                  )}
                </div>
              ))}
            </div>
          </>
        );
      }
      case 'Date':
        return (
          <>
            {years.map((y) => (
              <div key={y.year} className="relative">
                <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={year === y.year} onClick={() => setYear(y.year)} onMouseEnter={() => setYear(y.year)} className={rowClass}>
                  {y.year}
                  <Chevron />
                </button>
                {year === y.year && (
                  <div role="menu" aria-label={y.year} className={`${panelClass} left-full top-0 ml-1.5 max-h-[60vh] overflow-y-auto`} style={panelStyle}>
                    {y.months.map((m) =>
                      check(monthLabel(m).split(' ')[0], (filter.months ?? []).includes(m), () => pick({ kind: 'month', value: m }), m),
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        );
      case 'Keywords':
        return (
          <input
            autoFocus
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && keyword.trim()) pick({ kind: 'keyword', value: keyword });
            }}
            placeholder="Name or note, then Enter"
            aria-label="Keyword"
            className="w-full rounded-md border bg-transparent px-2 py-1 text-[12px]"
            style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
          />
        );
      case 'Recurring':
        return (
          <>
            {search(item)}
            {recurring.length === 0 && <p className="m-0 px-2 py-1 text-[12px]" style={{ color: 'var(--muted)' }}>No recurring bills found.</p>}
            <div className="max-h-[50vh] overflow-y-auto">
              {recurring
                .filter((r) => r.saved && r.saved.status !== 'archived' && matches(displayName(r)))
                .map((r) => {
                  const c = r.categoryId != null ? categoriesById[r.categoryId] : undefined;
                  const name = displayName(r);
                  const id = r.saved!.id;
                  return check(
                    <>
                      <CategoryIcon emoji={c?.emoji} color={c?.color} />
                      {name}
                    </>,
                    (filter.recurringIds ?? []).includes(id),
                    () => pick({ kind: 'recurring', value: id }),
                    id,
                    name,
                  );
                })}
            </div>
          </>
        );
      case 'Type':
        return (
          <>
            {(Object.keys(TYPE_LABELS) as TxType[]).map((t) =>
              check(TYPE_LABELS[t], (filter.types ?? []).includes(t), () => pick({ kind: 'type', value: t }), t),
            )}
          </>
        );
      case 'Tags':
        return (
          <>
            {search(item)}
            {tags.length === 0 && <p className="m-0 px-2 py-1 text-[12px]" style={{ color: 'var(--muted)' }}>No tags yet.</p>}
            <div className="max-h-[50vh] overflow-y-auto">
              {tags
                .filter((t) => matches(t.name))
                .map((t) =>
                  check(
                    <>
                      <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: t.color }} />
                      {t.name}
                    </>,
                    (filter.tagIds ?? []).includes(t.id),
                    () => pick({ kind: 'tag', value: t.id }),
                    t.id,
                    t.name,
                  ),
                )}
            </div>
          </>
        );
      case 'Review status':
        return (
          <>
            {check('Reviewed', filter.reviewed === true, () => pick({ kind: 'review', value: true }), 'r')}
            {check('Not reviewed', filter.reviewed === false, () => pick({ kind: 'review', value: false }), 'n')}
          </>
        );
    }
  };

  return (
    <div ref={ref} role="menu" aria-label="Filters" className={`${panelClass} left-0 top-[34px] w-[200px]`} style={panelStyle}>
      {ITEMS.map((item) => (
        <div key={item} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === item}
            onClick={() => show(item)}
            onMouseEnter={() => open !== item && show(item)}
            className={rowClass}
            style={{ background: open === item ? 'var(--hover)' : undefined }}
          >
            {item}
            <Chevron />
          </button>
          {open === item && (
            <div role="menu" aria-label={item} className={`${panelClass} left-full top-0 ml-1.5`} style={panelStyle}>
              {submenu(item)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
