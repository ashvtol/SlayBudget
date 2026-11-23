import { useScreen } from '@/app/shell/screen';
import { CategoryIcon } from '@/components/category-icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SplitPage } from '@/app/shell/page';
import { useNavStore } from '@/lib/stores/nav-store';
import { CategoryPill } from '@/components/category-pill';
import { Money } from '@/components/money';
import { IconCheck, IconMore, IconPlus, IconTriangleDown, IconTriangleRight } from '@/components/icons';
import { ToolbarButton } from '@/components/toolbar-button';
import { Button } from '@/components/button';
import { Modal, NewRecurringDialog, RecurringForm } from '@/features/recurrings/recurring-form';
import { Ring } from '@/features/charts/mini-charts';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { cleanMerchant } from '@/lib/merchant';
import { ipc } from '@/lib/ipc';
import { withGroupColors } from '@/lib/category-colors';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { BillPriceChange, Category, NewRecurring, PriceChange, PriceCheck, Recurring, Source, Transaction } from '@/lib/types';
import { PriceCheckBox } from '@/features/recurrings/price-check-box';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/features/currency/currency-store';
import { useAnalyticsStore } from './analytics-store';
import { buildRecurrings, ordinalDay, type RecurringItem } from './recurrings-model';

const CADENCE_LABEL: Record<Recurring['cadence'], string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Annually',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Source_ {
  recurring: Recurring[];
  suggestions: Recurring[];
  categories: Category[];
  transactions: Transaction[];
  categoriesById: Record<number, Category>;
  sourcesById: Record<number, Source>;
  /** Charges that may be a bill at a new price, each bill's latest price change, and bills that look alike. */
  checks: PriceCheck[];
  changes: BillPriceChange[];
  lookAlikes: [number, number][];
}

/** A price change is highlighted on its bill for this long. */
const HIGHLIGHT_DAYS = 30;
const dayNumber = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
const recentChange = (src: Source_, id: number | undefined, today: string) => {
  const c = id == null ? undefined : src.changes.find((x) => x.recurringId === id);
  return c && dayNumber(today) - dayNumber(c.changedOn) <= HIGHLIGHT_DAYS && c.toCents !== c.fromCents ? c : undefined;
};

function useRecurringSource() {
  const profileId = useProfileStore((s) => s.activeProfileId);
  const today = useAnalyticsStore((s) => s.today);
  const { activation } = useScreen();
  const [src, setSrc] = useState<Source_ | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const from = `${Number(today.slice(0, 4)) - 2}-01-01`;
    void Promise.all([
      ipc().listRecurring(profileId),
      ipc().recurringSuggestions(profileId),
      ipc().listTransactions({ profileId, from, to: today }),
      ipc().listCategories(),
      ipc().listSources(),
      ipc().listCategoryGroups(),
      ipc().priceChecks(),
      ipc().latestPriceChanges(),
      ipc().lookAlikeRecurrings(),
    ]).then(([recurring, suggestions, transactions, categories, sources, groups, checks, changes, lookAlikes]) => {
      if (!live) return;
      setSrc({
        recurring,
        suggestions,
        categories,
        transactions,
        categoriesById: Object.fromEntries(withGroupColors(categories, groups).map((c) => [c.id, c])),
        sourcesById: Object.fromEntries(sources.map((s) => [s.id, s])),
        checks,
        changes,
        lookAlikes,
      });
    });
    return () => {
      live = false;
    };
  }, [profileId, today, activation, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { src, today, reload };
}

/** A saved bill's rules from a detected series (as the core seeds them). */
function ruleFromSuggestion(r: Recurring): NewRecurring {
  const band = Math.max(Math.trunc(r.typicalAmountCents / 100) * 35, 500);
  const monthly = r.cadence !== 'weekly' && r.cadence !== 'biweekly';
  return {
    name: cleanMerchant(r.merchant),
    categoryId: r.categoryId,
    matchKind: 'merchant',
    pattern: r.merchant,
    minCents: Math.max(0, r.typicalAmountCents - band),
    maxCents: r.typicalAmountCents + band,
    frequency: r.cadence,
    dayOfMonth: monthly ? Number(r.lastDate.slice(8, 10)) : null,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function RecurringPage() {
  const { src, today, reload } = useRecurringSource();
  const model = useMemo(() => (src ? buildRecurrings({
            recurring: src.recurring,
            transactions: src.transactions,
            today,
            excludedCategoryIds: new Set(Object.values(src.categoriesById).filter((c) => c.excluded).map((c) => c.id)),
          }) : null), [src, today]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'edit' | 'delete' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The actions menu closes with Escape or a click elsewhere, like the app's other menus.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menuOpen]);
  const all = model ? [...model.thisMonth, ...model.future, ...model.stale, ...model.paused, ...model.archived] : [];
  // A notification asked for a bill: select it once the list is in.
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  const [handledIntent, setHandledIntent] = useState(0);
  if (model && intent?.target.kind === 'recurring' && intent.seq !== handledIntent) {
    const id = intent.target.id;
    const item = all.find((i) => i.recurring.saved?.id === id);
    setHandledIntent(intent.seq);
    if (item) {
      setSelected(item.key);
      if (model.archived.includes(item)) setShowArchived(true);
    }
  }
  useEffect(() => {
    if (intent?.target.kind === 'recurring' && intent.seq === handledIntent) clearIntent();
  }, [intent, handledIntent, clearIntent]);
  const current = all.find((i) => i.key === selected) ?? all[0];
  const saved = current?.recurring.saved ?? null;

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setMenuOpen(false);
    if (current) setSelected(current.key);
    try {
      await fn();
      setFailure(null);
      setNotice(message ?? null);
    } catch (e) {
      setNotice(null);
      setFailure(`Couldn't do that: ${e instanceof Error ? e.message : String(e)}`);
    }
    reload();
  };

  const actions = saved && (
    <>
      <ToolbarButton onClick={() => setDialog('edit')}>Edit rules</ToolbarButton>
      <div ref={menuRef} className="relative">
        <ToolbarButton aria-label="Recurring actions" icon={IconMore} active={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
        {menuOpen && (
          <div role="menu" aria-label="Recurring actions" className="absolute right-0 top-[34px] z-30 w-[160px] rounded-lg border p-1.5 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            {saved.status === 'active' && <MenuItem onClick={() => void act(() => ipc().setRecurringStatus(saved.id, 'paused'), `${saved.name} is paused.`)}>Pause</MenuItem>}
            {saved.status !== 'active' && <MenuItem onClick={() => void act(() => ipc().setRecurringStatus(saved.id, 'active'), `${saved.name} is active again.`)}>Activate</MenuItem>}
            {saved.status !== 'archived' && <MenuItem onClick={() => void act(() => ipc().setRecurringStatus(saved.id, 'archived'), `${saved.name} is archived.`)}>Archive</MenuItem>}
            <MenuItem danger onClick={() => { setMenuOpen(false); setDialog('delete'); }}>Delete…</MenuItem>
          </div>
        )}
      </div>
    </>
  );

  return (
    <SplitPage
      title="Recurrings"
      toolbar={<ToolbarButton aria-label="Add recurring" icon={IconPlus} onClick={() => setDialog('new')} />}
      list={
        src && model && (
          <div className="flex flex-col gap-7 px-8 py-8">
            {notice && <p role="status" className="m-0 text-[12px]" style={{ color: 'var(--pos)' }}>{notice}</p>}
            {failure && <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{failure}</p>}
            {all.length === 0 && src.suggestions.length === 0 ? (
              <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
                No recurring charges detected yet. Import a few months of statements and they will show up here.
              </p>
            ) : (
              <>
                <section aria-label="Recurring summary" className="flex items-center justify-between rounded-[10px] border px-8 py-6" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
                  <div>
                    <div className="text-[18px] font-semibold"><Money cents={model.summary.leftToPayCents} decimals={false} /></div>
                    <div className="text-[12px]" style={{ color: 'var(--muted)' }}>left to pay</div>
                  </div>
                  <Ring value={model.summary.paidCents} total={model.summary.paidCents + model.summary.leftToPayCents} label="Paid vs due this month" />
                  <div className="text-right">
                    <div className="text-[18px] font-semibold"><Money cents={model.summary.paidCents} decimals={false} /></div>
                    <div className="text-[12px]" style={{ color: 'var(--muted)' }}>paid so far</div>
                  </div>
                </section>
                {src.lookAlikes.length > 0 && (
                  <LookAlikes
                    pairs={src.lookAlikes}
                    names={Object.fromEntries(src.recurring.flatMap((r) => (r.saved ? [[r.saved.id, r.saved.name]] : [])))}
                    onMerge={(a, b, name) => void act(() => ipc().mergeRecurrings(a, b), `Merged into ${name}.`)}
                    onKeepApart={(a, b) => void act(() => ipc().keepRecurringsApart(a, b))}
                  />
                )}
                <BillList title="This month" items={model.thisMonth} src={src} today={today} selected={current} onSelect={setSelected} emptyText="Nothing due this month." />
                {model.future.length > 0 && <BillList title="In the future" items={model.future} src={src} today={today} selected={current} onSelect={setSelected} />}
                {model.stale.length > 0 && <BillList title="Not seen lately" items={model.stale} src={src} today={today} selected={current} onSelect={setSelected} stale thisYear={today.slice(0, 4)} />}
                {model.paused.length > 0 && <BillList title="Paused" items={model.paused} src={src} today={today} selected={current} onSelect={setSelected} />}
                {src.suggestions.length > 0 && (
                  <Suggestions
                    items={src.suggestions}
                    onAdd={(r) => void act(() => ipc().createRecurring(ruleFromSuggestion(r)), `${cleanMerchant(r.merchant)} added.`)}
                    onDismiss={(r) => void act(() => ipc().dismissSuggestion(r.merchant))}
                  />
                )}
                {model.archived.length > 0 && (
                  <section>
                    <button type="button" onClick={() => setShowArchived(!showArchived)} className="m-0 mb-2 flex items-center gap-1.5 text-[14px] font-semibold">
                      {showArchived ? <IconTriangleDown size={11} style={{ color: 'var(--muted)' }} /> : <IconTriangleRight size={11} style={{ color: 'var(--muted)' }} />}
                      Archived ({model.archived.length})
                    </button>
                    {showArchived && <BillList title="Archived" items={model.archived} src={src} today={today} selected={current} onSelect={setSelected} hideTitle />}
                  </section>
                )}
              </>
            )}
            {dialog === 'new' && (
              <NewRecurringDialog
                transactions={src.transactions}
                categories={src.categories}
                onClose={() => setDialog(null)}
                onCreated={(id) => {
                  setDialog(null);
                  setSelected(String(id));
                  setNotice('Recurring added.');
                  reload();
                }}
              />
            )}
            {dialog === 'edit' && saved && (
              <Modal label="Edit recurring" onClose={() => setDialog(null)}>
                <RecurringForm
                  initial={saved}
                  categories={src.categories}
                  onCancel={() => setDialog(null)}
                  onSave={async (rule) => {
                    const r = await ipc().updateRecurring(saved.id, rule);
                    setDialog(null);
                    setSelected(String(saved.id));
                    const parts = [r.added > 0 && `${plural(r.added, 'more transaction matches', 'more transactions match')}.`, r.removed > 0 && `${plural(r.removed, 'transaction no longer matches', 'transactions no longer match')}.`].filter(Boolean);
                    setNotice(parts.length ? parts.join(' ') : 'Rules saved.');
                    reload();
                  }}
                />
              </Modal>
            )}
            {dialog === 'delete' && saved && (
              <Modal label={`Delete ${saved.name}?`} role="alertdialog" onClose={() => setDialog(null)}>
                <p className="m-0 mb-4 text-[13px]" style={{ color: 'var(--muted)' }}>
                  Its transactions stay as they are; only the recurring and its schedule go. This can’t be undone.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDialog(null)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialog(null);
                      void act(() => ipc().deleteRecurring(saved.id), `${saved.name} deleted.`);
                    }}
                    className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
                    style={{ background: 'var(--neg)', color: '#fff' }}
                  >
                    Delete
                  </button>
                </div>
              </Modal>
            )}
          </div>
        )
      }
      detailTitle={current ? `${CADENCE_LABEL[current.recurring.cadence]} recurring` : undefined}
      detailActions={actions || undefined}
      detail={src && current && <BillDetail item={current} src={src} today={today} onChanged={reload} />}
    />
  );
}

function MenuItem({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex h-[28px] w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]" style={{ color: danger ? 'var(--neg)' : 'var(--text)' }}>
      {children}
    </button>
  );
}

function Suggestions({ items, onAdd, onDismiss }: { items: Recurring[]; onAdd: (r: Recurring) => void; onDismiss: (r: Recurring) => void }) {
  return (
    <section>
      <h2 className="m-0 mb-1 text-[14px] font-semibold">Suggestions</h2>
      <p className="m-0 mb-2 text-[12px]" style={{ color: 'var(--muted)' }}>These look recurring. Add them to track them, or dismiss.</p>
      <ul aria-label="Suggestions" className="m-0 flex list-none flex-col p-0">
        {items.map((r) => {
          const name = cleanMerchant(r.merchant);
          return (
            <li key={r.merchant} className="flex h-[28px] items-center gap-3 px-1 text-[13px]">
              <span className="truncate">{name}</span>
              <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{CADENCE_LABEL[r.cadence]}</span>
              <Money cents={r.typicalAmountCents} className="ml-auto w-[76px] shrink-0 text-right font-semibold" />
              <button type="button" aria-label={`Add ${name}`} onClick={() => onAdd(r)} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>Add</button>
              <button type="button" aria-label={`Dismiss ${name}`} onClick={() => onDismiss(r)} className="text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>Dismiss</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "These look like the same subscription. Merge them?", for bills that share a name (Recurrings page only). */
function LookAlikes({
  pairs,
  names,
  onMerge,
  onKeepApart,
}: {
  pairs: [number, number][];
  names: Record<number, string>;
  onMerge: (a: number, b: number, kept: string) => void;
  onKeepApart: (a: number, b: number) => void;
}) {
  return (
    <section aria-label="Same subscription?" className="flex flex-col gap-2 rounded-[10px] border px-5 py-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      {pairs.map(([a, b]) => (
        <div key={`${a}:${b}`} className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="min-w-0 flex-1">
            <b>{names[a]}</b> and <b>{names[b]}</b> look like the same subscription. Merge them?
          </span>
          <Button variant="primary" onClick={() => onMerge(a, b, names[a])}>Merge</Button>
          <Button onClick={() => onKeepApart(a, b)}>Not the same</Button>
        </div>
      ))}
    </section>
  );
}

/** "Nov 21, 2026". */
function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Price went up: $22.11 → $100.18". */
function changeText(c: PriceChange, currency: string): string {
  return `Price went ${c.toCents > c.fromCents ? 'up' : 'down'}: ${formatMoney(c.fromCents, currency)} → ${formatMoney(c.toCents, currency)}`;
}

/** "May 22nd" this year, "May 22, 2025" otherwise. */
function lastSeen(day: string, thisYear: string): string {
  if (day.startsWith(thisYear)) return ordinalDay(day);
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function BillList({
  title,
  items,
  src,
  selected,
  onSelect,
  stale = false,
  thisYear = '',
  emptyText,
  hideTitle = false,
  today,
}: {
  title: string;
  items: RecurringItem[];
  src: Source_;
  today: string;
  selected?: RecurringItem;
  onSelect: (key: string) => void;
  stale?: boolean;
  thisYear?: string;
  emptyText?: string;
  hideTitle?: boolean;
}) {
  return (
    <section>
      {!hideTitle && (
        <h2 className="m-0 mb-2 flex items-center gap-1.5 text-[14px] font-semibold">
          <IconTriangleDown size={11} style={{ color: 'var(--muted)' }} />
          {title}
        </h2>
      )}
      {items.length === 0 && emptyText && <p className="m-0 px-1 text-[13px]" style={{ color: 'var(--muted)' }}>{emptyText}</p>}
      <ul aria-label={title} className="m-0 flex list-none flex-col p-0">
        {items.map((i) => {
          const cat = i.recurring.categoryId != null ? src.categoriesById[i.recurring.categoryId] : undefined;
          const active = selected?.key === i.key;
          return (
            <li
              key={i.key}
              aria-label={i.rules.name}
              onClick={() => onSelect(i.key)}
              className="flex h-[24px] cursor-default items-center gap-3 rounded-md px-1 text-[13px]"
              style={{ background: active ? 'var(--hover)' : 'transparent' }}
            >
              <span
                className={`${stale ? 'w-[118px]' : 'w-[64px]'} shrink-0 whitespace-nowrap`}
                style={{ color: stale ? 'var(--warn)' : 'var(--muted)' }}
                title={stale ? `Expected ${ordinalDay(i.date)}` : undefined}
              >
                {stale ? `Last ${lastSeen(i.recurring.lastDate, thisYear)}` : ordinalDay(i.date)}
              </span>
              <CategoryIcon emoji={cat?.emoji} color={cat?.color} className="w-4" />
              <span className="truncate">{i.rules.name}</span>
              <span className="truncate text-[12px]" style={{ color: 'var(--muted)' }}>{CADENCE_LABEL[i.recurring.cadence]}</span>
              {(() => {
                const c = recentChange(src, i.recurring.saved?.id, today);
                if (!c) return null;
                const up = c.toCents > c.fromCents;
                return (
                  <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold" style={{ color: up ? 'var(--warn)' : 'var(--pos)' }}>
                    {up ? 'Price went up' : 'Price went down'}
                  </span>
                );
              })()}
              <span className="ml-auto shrink-0">{cat && <CategoryPill category={cat} />}</span>
              <Money cents={i.recurring.typicalAmountCents} className="w-[76px] shrink-0 text-right font-semibold" />
              <span className="flex w-3 shrink-0 justify-center" style={{ color: 'var(--text)' }}>
                {i.paid && <span role="img" aria-label="Paid" className="flex"><IconCheck size={13} /></span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const DOT_STYLE = {
  paid: { background: 'transparent', border: '2px solid var(--accent)' },
  missed: { background: 'transparent', border: '2px solid var(--neg)' },
  upcoming: { background: 'transparent', border: '2px dashed var(--subtle)' },
  none: { background: 'transparent', border: '2px solid var(--track)' },
} as const;

function BillDetail({ item, src, today, onChanged }: { item: RecurringItem; src: Source_; today: string; onChanged: () => void }) {
  const r = item.recurring;
  const billId = r.saved?.id;
  const currency = useCurrencyStore((s) => s.displayCurrency);
  const [loaded, setLoaded] = useState<{ id: number; list: PriceChange[] } | null>(null);
  useEffect(() => {
    if (billId == null) return;
    let live = true;
    void ipc().priceHistory(billId).then((list) => live && setLoaded({ id: billId, list }));
    return () => {
      live = false;
    };
  }, [billId, src]);
  const history = loaded && loaded.id === billId ? loaded.list : [];
  const checks = src.checks.filter((c) => c.recurringId === billId);
  const recent = recentChange(src, billId, today);
  const cat = r.categoryId != null ? src.categoriesById[r.categoryId] : undefined;
  const lastSource = item.lastSourceId != null ? src.sourcesById[item.lastSourceId] : undefined;
  const lastCharge = item.charges[0];
  return (
    <article className="flex flex-col gap-7 px-8 py-8">
      <header className="flex items-start justify-between gap-6">
        <div>
          {cat && <div className="mb-2"><CategoryPill category={cat} /></div>}
          <h2 className="m-0 text-[24px] font-semibold">{item.rules.name}</h2>
        </div>
        <div className="text-right">
          <div className="label-caps" style={{ color: 'var(--muted)' }}>Next payment</div>
          <div className="text-[20px] font-semibold"><Money cents={r.typicalAmountCents} /></div>
          <div className="text-[12px]" style={{ color: 'var(--muted)' }}>around <span className="font-semibold" style={{ color: 'var(--text)' }}>{ordinalDay(r.nextDate)}</span></div>
        </div>
      </header>

      {recent && (
        <p className="m-0 text-[13px] font-semibold" style={{ color: recent.toCents > recent.fromCents ? 'var(--warn)' : 'var(--pos)' }}>
          {changeText(recent, currency)}
        </p>
      )}
      {checks.map((c) => (
        <PriceCheckBox
          key={c.id}
          check={c}
          billName={item.rules.name}
          categories={src.categories}
          date={src.transactions.find((t) => t.id === c.txId)?.postedOn}
          onDone={onChanged}
        />
      ))}

      <div>
        <div className="label-caps mb-2" style={{ color: 'var(--muted)' }}>Rules</div>
        <ul aria-label="Rules" className="m-0 flex list-none flex-wrap gap-2 p-0">
          <Chip>Named <b>{item.rules.name}</b></Chip>
          <Chip>from <b><Money cents={item.rules.minCents} decimals={false} /></b> to <b><Money cents={item.rules.maxCents} decimals={false} /></b></Chip>
          <Chip><b>{item.rules.cadence}</b></Chip>
          {item.rules.day != null && <Chip>on the <b>{ordinal(item.rules.day)}</b></Chip>}
        </ul>
      </div>

      <ul aria-label="Payment history" className="m-0 flex list-none items-start justify-between p-0">
        {item.timeline.map((t, i) => (
          <li key={t.month} className="flex flex-col items-center gap-2" aria-label={`${MONTHS[i]}: ${t.state}`}>
            <span className="h-[12px] w-[12px] rounded-full" style={DOT_STYLE[t.state]} />
            <span className="text-[10px] font-semibold uppercase" style={{ color: t.month === today.slice(0, 7) ? 'var(--text)' : 'var(--muted)' }}>{MONTHS[i]}</span>
          </li>
        ))}
      </ul>

      <table aria-label="Key metrics" className="w-full border-t text-[13px]" style={{ borderColor: 'var(--line)' }}>
        <thead>
          <tr style={{ color: 'var(--muted)' }}>
            <th className="pb-2 pt-5 text-left font-semibold" style={{ color: 'var(--text)' }}>Key metrics</th>
            <th className="pb-2 pt-5 text-right font-medium">Spent per year</th>
            <th className="pb-2 pt-5 text-right font-medium">Avg transaction</th>
          </tr>
        </thead>
        <tbody>
          {item.years.map((y) => (
            <tr key={y.year}>
              <td className="py-1.5" style={{ color: 'var(--accent)' }}>{y.year}</td>
              <td className="py-1.5 text-right font-semibold"><Money cents={y.spendCents} /></td>
              <td className="py-1.5 text-right font-semibold"><Money cents={y.avgChargeCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {history.length > 0 && (
        <div className="border-t pt-5" style={{ borderColor: 'var(--line)' }}>
          <div className="mb-2 text-[14px] font-semibold">Price history</div>
          <ul aria-label="Price history" className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {history.map((h) => (
              <li key={`${h.changedOn}:${h.fromCents}:${h.toCents}`} className="flex items-center justify-between">
                <span style={{ color: 'var(--muted)' }}>{longDay(h.changedOn)}</span>
                <span className="font-semibold tabular-nums">{formatMoney(h.fromCents, currency)} → {formatMoney(h.toCents, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastSource && (
        <div className="border-t pt-5" style={{ borderColor: 'var(--line)' }}>
          <div className="mb-2 text-[14px] font-semibold">Last account used</div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold">{lastSource.name}</span>
            {lastCharge && <span style={{ color: 'var(--muted)' }}>{ordinalDay(lastCharge.postedOn)}</span>}
          </div>
        </div>
      )}

      <div className="-mx-8 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
        <div className="mb-2 px-8 text-[14px] font-semibold">Transactions</div>
        <ul aria-label="Charges" className="m-0 list-none p-0">
          {item.charges.map((t) => (
            <li key={t.id} className="flex items-center">
              <span className="w-[64px] shrink-0 pl-8 text-[12px]" style={{ color: 'var(--muted)' }}>{ordinalDay(t.postedOn).replace(/(st|nd|rd|th)$/, '')}</span>
              <div className="min-w-0 flex-1">
                <TransactionRow
                  tx={t}
                  category={t.categoryId != null ? src.categoriesById[t.categoryId] : undefined}
                  source={src.sourcesById[t.sourceId]}
                  selected={false}
                  active={false}
                  selectable={false}
                  onToggleSelect={() => {}}
                  onOpen={() => {}}
                  onPickCategory={() => {}}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** 1 -> "1st", 22 -> "22nd". */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-md border px-2.5 py-1 text-[12px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}>
      <span className="[&_b]:font-semibold [&_b]:text-[var(--text)]">{children}</span>
    </li>
  );
}
