import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon } from '@/components/category-icon';
import { useScreen } from '@/app/shell/screen';
import { Money } from '@/components/money';
import { SpendTreemap } from '@/features/charts/svg/treemap';
import { resolveRange } from '@/lib/analytics';
import { ipc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { useAnalyticsStore } from './analytics-store';
import { buildSpendMap, previousWindow } from './spend-map';
import { RangeSelector } from './range-selector';

const HIDDEN_KEY = 'insights.hiddenCategories';
const keyOf = (categoryId: number | null) => (categoryId == null ? 'none' : String(categoryId));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}${d.slice(0, 4) !== new Date().getFullYear().toString() ? `, ${d.slice(0, 4)}` : ''}`;

/** "Where your money went": a treemap of spending by category for the selected range, colored by
 *  change against the previous period; hovering a tile shows the details. */
export function SpendingMap() {
  const profileId = useProfileStore((s) => s.activeProfileId);
  const range = useAnalyticsStore((s) => s.range);
  const today = useAnalyticsStore((s) => s.today);
  const { activation } = useScreen();
  const window = useMemo(() => resolveRange(range, today), [range, today]);
  const previous = useMemo(() => previousWindow(window), [window]);
  const [src, setSrc] = useState<{ transactions: Transaction[]; categories: Category[]; groups: CategoryGroup[]; dataStart: string | null } | null>(null);

  // Read everything once per visit (a few hundred KB at most) and work out every range in memory,
  // so switching 1M / 1Y / All needs no database trip. Refreshed when the screen is shown again.
  useEffect(() => {
    let live = true;
    void Promise.all([ipc().listTransactions({ profileId }), ipc().listCategories(), ipc().listCategoryGroups()]).then(
      ([transactions, categories, groups]) => {
        if (!live) return;
        const dataStart = transactions.reduce<string | null>((min, t) => (min == null || t.postedOn < min ? t.postedOn : min), null);
        setSrc({ transactions, categories, groups, dataStart });
      },
    );
    return () => {
      live = false;
    };
  }, [profileId, activation]);

  // Categories hidden from the map (saved): their spending is set aside and named in the header.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // The map waits for the saved choices, so it is never drawn once with them and again without.
  const [hiddenLoaded, setHiddenLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void ipc()
      .getSetting(HIDDEN_KEY)
      .then((raw) => {
        if (!live) return;
        if (raw) {
          try {
            setHidden(new Set(JSON.parse(raw) as string[]));
          } catch {
            // An unreadable setting just means nothing is hidden.
          }
        }
        setHiddenLoaded(true);
      })
      .catch(() => live && setHiddenLoaded(true));
    return () => {
      live = false;
    };
  }, []);
  const toggleHidden = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    void ipc().setSetting(HIDDEN_KEY, JSON.stringify([...next].sort()));
  };
  const [menuOpen, setMenuOpen] = useState(false);
  // Full window: the map fills the app; Escape or Close returns to Insights.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !menuOpen) setExpanded(false);
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [expanded, menuOpen]);

  // Everything spent in the period (before hiding), for the Hide menu.
  const everything = useMemo(() => (src ? buildSpendMap({ ...src, window, previous }) : null), [src, window, previous]);
  const map = useMemo(() => (src && hiddenLoaded ? buildSpendMap({ ...src, window, previous, hidden }) : null), [src, hiddenLoaded, window, previous, hidden]);
  const choices = useMemo(
    () => (everything ? everything.groups.flatMap((g) => g.children).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [everything],
  );
  const other = src?.categories.find((c) => c.isOther);
  const otherSpent = other != null && choices.some((t) => t.categoryId === other.id);
  const firstDay = window.from ?? src?.transactions.reduce<string | null>((min, t) => (min == null || t.postedOn < min ? t.postedOn : min), null);
  const period = firstDay ? `${shortDay(firstDay)} – ${shortDay(window.to ?? today)}` : '';

  return (
    <section
      aria-label="Where your money went"
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      className={expanded ? 'fixed inset-0 z-50 flex flex-col p-6' : 'mb-6 rounded-[10px] border p-5'}
      style={{ background: expanded ? 'var(--bg)' : 'var(--panel)', borderColor: 'var(--line)' }}
    >
      <div
        data-tauri-drag-region={expanded ? true : undefined}
        className={`mb-3 flex items-baseline justify-between gap-4 ${expanded ? 'pl-[72px]' : ''}`}
      >
        <div className="flex items-center gap-4">
          <h2 className="m-0 text-[15px] font-semibold">Where your money went</h2>
          {expanded && <RangeSelector />}
        </div>
        <div className="flex items-baseline gap-3 text-[12px]" style={{ color: 'var(--muted)' }}>
          {otherSpent && other && (
            <button
              type="button"
              onClick={() => toggleHidden(String(other.id))}
              className="text-[12px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              {hidden.has(String(other.id)) ? `Show ${other.name}` : `Hide ${other.name}`}
            </button>
          )}
          {choices.length > 0 && (
            <HideMenu
              open={menuOpen}
              onOpen={setMenuOpen}
              items={choices.map((t) => ({ key: keyOf(t.categoryId), name: t.name, emoji: t.emoji, color: t.color }))}
              hidden={hidden}
              onToggle={toggleHidden}
            />
          )}
          <span>
            {map && <span className="mr-2 text-[15px] font-semibold" style={{ color: 'var(--text)' }}><Money cents={map.totalCents} /></span>}
            {period}
          </span>
          <button
            type="button"
            aria-label={expanded ? 'Close map' : 'Expand map'}
            title={expanded ? 'Close (Esc)' : 'Fill the window'}
            onClick={() => setExpanded(!expanded)}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-md border text-[13px]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
          >
            {expanded ? '✕' : '⤢'}
          </button>
        </div>
      </div>
      {map && map.hiddenCents > 0 && (
        <p className="m-0 mb-2 text-[12px]" style={{ color: 'var(--muted)' }}>
          <Money cents={map.hiddenCents} /> hidden: {map.hiddenNames.join(', ')}
        </p>
      )}
      {map && map.totalCents === 0 && <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>No spending in this period.</p>}
      {map && map.totalCents > 0 && (
        <>
          <div className={expanded ? 'min-h-0 flex-1' : ''}>
            {/* Hiding categories starts the map from the top again. */}
            <SpendTreemap key={[...hidden].sort().join(',')} map={map} compared={map.compared} height={expanded ? Math.max(300, globalThis.innerHeight - 190) : 340} />
          </div>
          <div className="mt-2 flex gap-4 text-[11px]" style={{ color: 'var(--muted)' }}>
            {map.compared ? (
              <>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--neg)' }} />Spent more than before</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--pos)' }} />Spent less</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--accent)' }} />New</span>
                <span>Click a tile to look inside.</span>
              </>
            ) : (
              <span>
                {previous ? 'Not enough history to compare with the period before, so colors are category colors.' : 'Colors are category colors (nothing to compare against).'} Click a tile to look inside.
              </span>
            )}
          </div>
          <table aria-label="Spending by category" className="sr-only">
            <thead>
              <tr>
                <th>Category</th>
                <th>Spent</th>
                <th>Share</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {map.groups.flatMap((g) => g.children).sort((a, b) => b.valueCents - a.valueCents).map((t) => (
                <tr key={`${t.groupName}-${t.name}`}>
                  <td>{t.name}</td>
                  <td><Money cents={t.valueCents} /></td>
                  <td>{Math.round(t.share * 100)}%</td>
                  <td>{t.changePct == null ? (map.compared ? 'new' : '') : `${t.changePct >= 0 ? '+' : ''}${t.changePct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** "Hide categories": a checklist of the period's categories to leave off the map. */
function HideMenu({
  open,
  onOpen,
  items,
  hidden,
  onToggle,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  items: { key: string; name: string; emoji: string | null; color: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpen(false);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onOpen]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Hide categories" aria-expanded={open} onClick={() => onOpen(!open)} className="text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
        Hide{hidden.size > 0 ? ` (${hidden.size})` : ''} ▾
      </button>
      {open && (
        <div role="menu" aria-label="Hide categories" className="absolute right-0 top-6 z-30 max-h-[50vh] w-[220px] overflow-y-auto rounded-lg border p-1.5 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={hidden.has(i.key)}
              aria-label={i.name}
              onClick={() => onToggle(i.key)}
              className="flex h-[28px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]"
              style={{ color: 'var(--text)' }}
            >
              <span aria-hidden="true" className="w-3">{hidden.has(i.key) ? '✓' : ''}</span>
              <CategoryIcon emoji={i.emoji} color={i.color} />
              {i.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
