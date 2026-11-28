import { useEffect, useMemo, useState } from 'react';
import { TagPill } from '@/components/tag-pill';
import { useTagsStore } from '@/lib/stores/tags-store';
import { useDisplayStore } from '@/lib/stores/display-store';
import { TagPicker } from './tag-picker';
import { CategoryPill } from '@/components/category-pill';
import { CategoryMenu } from '@/components/category-menu';
import { RecategorizeOffer } from './recategorize-offer';
import { StatementBox } from './statement-box';
import { ipc } from '@/lib/ipc';
import type { Category, NewRecurring, PriceCheck, SplitPart, Transaction } from '@/lib/types';
import { PriceCheckBox } from '@/features/recurrings/price-check-box';
import { dayHeaderLabel, formatSignedMoney, groupByDay } from '@/lib/format';
import { Money } from '@/components/money';
import { ToolbarButton } from '@/components/toolbar-button';
import { IconCalendar, IconCard, IconTag, IconTrash } from '@/components/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DuplicateBox } from './duplicate-box';
import { displayMerchant, TransactionRow, TransferPill } from './transaction-row';
import { similarTransactions } from './similar';
import { Modal, RecurringForm } from '@/features/recurrings/recurring-form';
import { displayName } from '@/features/analytics/recurrings-model';
import { creditsFrom } from '@/features/recurrings/bill-credits';
import { txTypeOf } from '@/lib/tx-type';
import type { TxType } from '@/lib/types';

const TYPES: [TxType, string][] = [
  ['regular', 'Regular'],
  ['income', 'Income'],
  ['transfer', 'Internal transfer'],
];
import { useTransactionsStore } from './transactions-store';
import { Select } from '@/components/select';
import { Button } from '@/components/button';

/** Parse a signed dollar string into integer cents. NaN when unparseable. */
export function dollarsToCents(input: string): number {
  const trimmed = input.trim().replace(/[$,]/g, '');
  if (trimmed === '' || trimmed === '-' || !/^-?\d*(\.\d{0,2})?$/.test(trimmed)) return NaN;
  return Math.round(parseFloat(trimmed) * 100);
}

interface Part {
  amount: string; // signed dollars, as typed
  categoryId: number | null;
}

/** Split editor: divide a transaction into parts whose amounts sum to the whole. */
function SplitEditor({ tx, categories, onChanged }: { tx: Transaction; categories: Category[]; onChanged: () => void }) {
  const [children, setChildren] = useState<Transaction[]>([]);
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void ipc().transactionChildren(tx.id).then((c) => { if (live) setChildren(c); });
    return () => { live = false; };
  }, [tx.id]);

  const startEditing = () => {
    const seed: Part[] = children.length
      ? children.map((c) => ({ amount: (c.amountCents / 100).toFixed(2), categoryId: c.categoryId }))
      : [
          { amount: (tx.amountCents / 100).toFixed(2), categoryId: tx.categoryId },
          { amount: '0.00', categoryId: null },
        ];
    setParts(seed);
    setError(null);
    setEditing(true);
  };

  const sumCents = parts.reduce((acc, p) => acc + (Number.isNaN(dollarsToCents(p.amount)) ? 0 : dollarsToCents(p.amount)), 0);
  const remaining = tx.amountCents - sumCents;
  const valid = parts.length >= 2 && parts.every((p) => !Number.isNaN(dollarsToCents(p.amount))) && remaining === 0;

  const save = async () => {
    if (!valid) { setError('Parts must sum to the transaction total.'); return; }
    const payload: SplitPart[] = parts.map((p) => ({ amountCents: dollarsToCents(p.amount), categoryId: p.categoryId }));
    await ipc().splitTransaction(tx.id, payload);
    setChildren(await ipc().transactionChildren(tx.id));
    setEditing(false);
    onChanged();
  };

  const removeSplit = async () => {
    await ipc().unsplitTransaction(tx.id);
    setChildren([]);
    setEditing(false);
    onChanged();
  };

  return (
    <section aria-label="Split" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-base font-semibold">Split</h3>
        {!editing && (
          <Button onClick={startEditing}>
            {children.length ? 'Edit split' : 'Split transaction'}
          </Button>
        )}
      </div>

      {!editing && children.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {children.map((c) => (
            <li key={c.id} className="flex items-center justify-between text-sm">
              <span className="truncate">{c.categoryId != null ? categories.find((x) => x.id === c.categoryId)?.name ?? 'Category' : 'Uncategorized'}</span>
              <span className="tabular-nums">{formatSignedMoney(c.amountCents, c.currency)}</span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="flex flex-col gap-2.5">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Part ${i + 1} amount`}
                value={p.amount}
                onChange={(e) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                inputMode="decimal"
                className="w-24 rounded-lg border bg-transparent px-2 py-1.5 text-sm tabular-nums"
                style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
              />
              <Select className="min-w-0 flex-1" aria-label={`Part ${i + 1} category`} value={p.categoryId ?? ''} onChange={(e) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, categoryId: e.target.value === '' ? null : Number(e.target.value) } : x)))}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              {parts.length > 2 && (
                <button type="button" aria-label={`Remove part ${i + 1}`} onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))} className="rounded-md px-1.5 text-base leading-none" style={{ color: 'var(--muted)' }}>×</button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between text-xs" style={{ color: remaining === 0 ? 'var(--muted)' : 'var(--neg)' }}>
            <button type="button" onClick={() => setParts((prev) => [...prev, { amount: (remaining / 100).toFixed(2), categoryId: null }])} className="rounded-md text-sm" style={{ color: 'var(--accent)' }}>+ Add part</button>
            <span className="tabular-nums">{remaining === 0 ? 'Balanced' : `${formatSignedMoney(remaining, tx.currency)} left`}</span>
          </div>
          {error && <p className="m-0 text-xs" style={{ color: 'var(--neg)' }}>{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={() => void save()} disabled={!valid}>Save split</Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            {children.length > 0 && <Button variant="destructive" onClick={() => void removeSplit()} className="ml-auto">Remove split</Button>}
          </div>
        </div>
      )}
    </section>
  );
}

/** Notes box, keyed by transaction id so it resets without an effect. */
function NotesEditor({ initial, onSave }: { initial: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <textarea
      aria-label="Notes"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== initial && onSave(draft)}
      rows={3}
      className="w-full resize-none rounded-md border p-2.5 text-[13px] outline-none"
      style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text)' }}
    />
  );
}

const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Saturday, Nov 21, 2026" */
function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = LONG_WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${SHORT_MONTHS[m - 1]} ${d}, ${y}`;
}

/** What the statement said: the raw line, clues read from it, extra columns, and the file. */
function StatementField({ tx }: { tx: Transaction }) {
  return (
    <div role="group" aria-label="Statement">
      <FieldLabel>Statement</FieldLabel>
      <StatementBox tx={tx} />
    </div>
  );
}

/** Copilot's Tags section: the row's tags, then "Add tag" opening the tag picker. */
function TagsField({ id, tagIds }: { id: number; tagIds: number[] | undefined }) {
  const byId = useTagsStore((s) => s.byId);
  const [open, setOpen] = useState(false);
  const tags = (tagIds ?? []).map((t) => byId[t]).filter((t) => t != null);
  return (
    <div role="group" aria-label="Tags">
      <FieldLabel>Tags</FieldLabel>
      <div className="relative flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <TagPill key={t.id} tag={t} size="md" />
        ))}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex h-[24px] items-center gap-1.5 rounded-md px-1.5 text-[12px] font-semibold hover:bg-[var(--hover)]"
          style={{ color: 'var(--muted)' }}
        >
          <IconTag size={12} />
          Add tag
        </button>
        {open && <TagPicker ids={[id]} onClose={() => setOpen(false)} className="left-0 top-[30px]" />}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[13px]" style={{ color: 'var(--muted)' }}>{children}</div>;
}

/** Review toggle for the detail header bar. */
export function ReviewButton({ id }: { id: number }) {
  const tx = useTransactionsStore((s) => s.byId(id));
  const toggleReviewed = useTransactionsStore((s) => s.toggleReviewed);
  if (!tx) return null;
  // A macOS-style toggle: the label says what a click does, and a reviewed transaction shows green at a glance.
  return (
    <button
      type="button"
      aria-pressed={tx.reviewed}
      title={tx.reviewed ? 'Mark as Not Reviewed' : 'Mark as Reviewed'}
      onClick={() => void toggleReviewed([tx.id])}
      className="inline-flex h-[28px] shrink-0 items-center whitespace-nowrap rounded-md border px-2.5 text-[12px] font-semibold transition-colors hover:brightness-125"
      style={
        tx.reviewed
          ? { color: 'var(--pos)', borderColor: 'color-mix(in oklab, var(--pos) 45%, transparent)', background: 'color-mix(in oklab, var(--pos) 16%, transparent)' }
          : { color: 'var(--text)', borderColor: 'var(--line-strong)', background: 'transparent' }
      }
    >
      {tx.reviewed ? 'Reviewed' : 'Mark as Reviewed'}
    </button>
  );
}

/** Delete (trash, with a confirm) and the review toggle, for the detail header bar. */
export function DetailActions({ id }: { id: number }) {
  const tx = useTransactionsStore((s) => s.byId(id));
  const deleteTransactions = useTransactionsStore((s) => s.deleteTransactions);
  const [confirm, setConfirm] = useState(false);
  if (!tx) return null;
  return (
    <>
      <ToolbarButton icon={IconTrash} aria-label="Delete transaction" title="Delete transaction" onClick={() => setConfirm(true)} />
      <ReviewButton id={id} />
      {confirm && (
        <ConfirmDialog
          title="Delete this transaction?"
          body="Its category, notes and tags go too. A backup of your data is made first."
          confirmLabel="Delete"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void deleteTransactions([tx.id]);
          }}
        />
      )}
    </>
  );
}

/** Why the category was chosen (a transfer links to its other side), and a suggested category to accept or reject. */
function WhyCategory({ tx, categoriesById, onOpen }: { tx: Transaction; categoriesById: Record<number, Category>; onOpen?: (id: number) => void }) {
  const accept = useTransactionsStore((s) => s.acceptSuggestions);
  const reject = useTransactionsStore((s) => s.rejectSuggestions);
  const setCategory = useTransactionsStore((s) => s.setCategory);
  const [choosing, setChoosing] = useState(false);
  const pair = tx.transferPairId ?? null;
  const suggested = tx.suggestedCategoryId != null ? categoriesById[tx.suggestedCategoryId] : undefined;
  if (!tx.categoryReason && tx.suggestedCategoryId == null) return null;
  return (
    <div className="-mt-4 flex flex-col gap-3 text-[12px]">
      {tx.categoryReason &&
        (pair != null && tx.categorySource === 'transfer' ? (
          <button type="button" onClick={() => onOpen?.(pair)} className="w-fit font-semibold" style={{ color: 'var(--accent)' }}>
            {tx.categoryReason}
          </button>
        ) : (
          <p className="m-0" style={{ color: 'var(--muted)' }}>{tx.categoryReason}</p>
        ))}
      {tx.suggestedCategoryId != null && (
        <div role="group" aria-label="Suggested category" className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <span style={{ color: 'var(--muted)' }}>Suggested</span>
          <CategoryPill category={suggested} size="sm" />
          {tx.suggestedReason && <span style={{ color: 'var(--muted)' }}>{tx.suggestedReason}</span>}
          <span className="relative ml-auto flex gap-2">
            <button type="button" onClick={() => setChoosing(!choosing)} className="h-[24px] rounded-md px-2.5 font-semibold" style={{ background: 'var(--hover)', color: 'var(--text)' }}>
              Choose another
            </button>
            {choosing && (
              <CategoryMenu
                className="absolute right-0 top-[30px]"
                categories={Object.values(categoriesById)}
                onClose={() => setChoosing(false)}
                onPick={(id) => {
                  setChoosing(false);
                  if (id != null) void setCategory(tx.id, id);
                }}
              />
            )}
            <button type="button" onClick={() => void reject([tx.id])} className="h-[24px] rounded-md px-2.5 font-semibold" style={{ background: 'var(--hover)', color: 'var(--text)' }}>
              Reject
            </button>
            <button type="button" onClick={() => void accept([tx.id])} className="h-[24px] rounded-md px-2.5 font-semibold" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              Accept
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** The detail panel body for one transaction (Copilot layout). Renders nothing when `id` is null. */
export function DetailPane({ id, onPickCategory, onOpen }: { id: number | null; onClose?: () => void; onPickCategory: (id: number) => void; onOpen?: (id: number) => void }) {
  const tx = useTransactionsStore((s) => (id != null ? s.byId(id) : undefined));
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const sourcesById = useTransactionsStore((s) => s.sourcesById);
  const transactions = useTransactionsStore((s) => s.transactions);
  const setNotes = useTransactionsStore((s) => s.setNotes);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  const moveNote = useTransactionsStore((s) => s.moveNote);
  const undoMove = useTransactionsStore((s) => s.undoMove);
  const onlyThisOne = useTransactionsStore((s) => s.onlyThisOne);
  const platformOffer = useTransactionsStore((s) => s.platformOffer);
  const closePlatformOffer = useTransactionsStore((s) => s.closePlatformOffer);
  const refresh = useTransactionsStore((s) => s.refresh);
  const setType = useTransactionsStore((s) => s.setType);
  const signs = useDisplayStore((s) => s.signs);

  const similar = useMemo(() => (tx ? similarTransactions(transactions, tx) : []), [transactions, tx]);
  const categoryList = useMemo(
    () => Object.values(categoriesById).sort((a, b) => a.name.localeCompare(b.name)),
    [categoriesById],
  );

  if (id == null || !tx) return null;
  const category = tx.categoryId != null ? categoriesById[tx.categoryId] : undefined;
  const source = sourcesById[tx.sourceId];

  return (
    <article aria-label="Transaction detail" className="flex flex-col gap-7 px-8 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
            <IconCalendar size={13} />
            <span>{longDate(tx.postedOn)}</span>
            {!tx.reviewed && <span style={{ color: 'var(--accent)' }}>• <span>To review</span></span>}
          </div>
          <h2 className="m-0 truncate text-[24px] font-semibold">{displayMerchant(tx)}</h2>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span data-testid="detail-amount" className="text-[24px] font-semibold">
            <Money cents={tx.amountCents} currency={tx.currency} tone={tx.amountCents > 0 ? 'pos' : 'default'} sign={signs ? 'always' : 'none'} />
          </span>
          {tx.originalCurrency && tx.originalAmountCents != null && (
            <span data-testid="detail-original" className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Originally {formatSignedMoney(tx.originalAmountCents, tx.originalCurrency)}
            </span>
          )}
        </span>
      </header>
      <DuplicateBox tx={tx} onOpen={onOpen} />
      <PriceCheckFor tx={tx} />

      <div className="flex flex-wrap gap-10">
        <div>
          <FieldLabel>Category</FieldLabel>
          {txTypeOf(tx) === 'transfer' ? <TransferPill /> : <CategoryPill category={category} size="md" onClick={() => onPickCategory(tx.id)} />}
        </div>
        <div role="group" aria-label="Account">
          <FieldLabel>Account</FieldLabel>
          <span className="inline-flex h-[26px] items-center gap-2 rounded-md px-2.5 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, var(--spend) 55%, var(--panel))', color: 'var(--text)' }}>
            <IconCard size={13} />
            {source?.name ?? 'Unknown'}
          </span>
        </div>
      </div>

      <WhyCategory tx={tx} categoriesById={categoriesById} onOpen={onOpen} />

      <RecurringField tx={tx} />

      <div>
        <FieldLabel>Type</FieldLabel>
        <div role="radiogroup" aria-label="Type" className="inline-flex rounded-md border p-0.5" style={{ borderColor: 'var(--line-strong)' }}>
          {TYPES.map(([value, label]) => {
            const on = txTypeOf(tx) === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && void setType([tx.id], value)}
                className="h-[24px] rounded-[5px] px-2.5 text-[12px] font-semibold"
                style={{ background: on ? 'var(--hover)' : 'transparent', color: on ? 'var(--text)' : 'var(--muted)' }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {platformOffer && platformOffer.transactionId === tx.id && (
        // A payment app (Wise, Zelle): nothing moved by itself; the same choices as any merchant, nothing ticked.
        <RecategorizeOffer
          key={`${platformOffer.transactionId}-${platformOffer.categoryId}`}
          merchant={platformOffer.merchant}
          categoryId={platformOffer.categoryId}
          categoriesById={categoriesById}
          onDone={(moved) => {
            closePlatformOffer();
            if (moved) void refresh();
          }}
        />
      )}
      {moveNote && moveNote.transactionId === tx.id && (
        <div role="status" className="-mt-3 flex flex-wrap items-center gap-3 text-[12px]">
          <span style={{ color: 'var(--pos)' }}>{moveNote.text}</span>
          <button type="button" onClick={() => void undoMove()} className="font-semibold" style={{ color: 'var(--accent)' }}>
            Undo
          </button>
          <button type="button" onClick={() => void onlyThisOne()} className="font-semibold" style={{ color: 'var(--accent)' }}>
            Only this one
          </button>
        </div>
      )}

      <div>
        <FieldLabel>Notes</FieldLabel>
        <NotesEditor key={tx.id} initial={tx.notes ?? ''} onSave={(v) => void setNotes(tx.id, v)} />
      </div>

      <TagsField key={`tags-${tx.id}`} id={tx.id} tagIds={tx.tagIds} />

      <StatementField key={`statement-${tx.id}`} tx={tx} />

      <SplitEditor key={`split-${tx.id}`} tx={tx} categories={categoryList} onChanged={() => void applyFilter({})} />

      {similar.length > 0 && (
        <section aria-label="Similar transactions" className="-mx-8 border-t pt-7" style={{ borderColor: 'var(--line)' }}>
          <h3 className="m-0 mb-5 px-8 text-[15px] font-semibold">Similar transactions</h3>
          {similar.map((group) => (
            <div key={group.month} className="mb-5">
              <div className="flex items-center justify-between px-8 pb-1 text-[14px] font-semibold">
                <span>{group.label}</span>
                <Money cents={Math.abs(group.totalCents)} currency={tx.currency} tone={group.totalCents > 0 ? 'pos' : 'default'} />
              </div>
              {groupByDay(group.transactions).map((d) => (
                <div key={d.day}>
                  <div className="label-caps px-8 pb-1 pt-2" style={{ color: 'var(--subtle)' }}>{dayHeaderLabel(d.day)}</div>
                  {d.transactions.map((t) => (
                    <TransactionRow
                      key={t.id}
                      tx={t}
                      category={t.categoryId != null ? categoriesById[t.categoryId] : undefined}
                      source={sourcesById[t.sourceId]}
                      selected={false}
                      active={false}
                      onToggleSelect={() => {}}
                      onOpen={() => onOpen?.(t.id)}
                      onPickCategory={() => onPickCategory(t.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

/** "Is this <bill> at a new price?" for a charge that may be a bill at a new price. */
function PriceCheckFor({ tx }: { tx: Transaction }) {
  const [check, setCheck] = useState<PriceCheck | null>(null);
  const recurringsById = useTransactionsStore((s) => s.recurringsById);
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  useEffect(() => {
    let live = true;
    void ipc().priceCheckFor(tx.id).then((c) => live && setCheck(c));
    return () => {
      live = false;
    };
  }, [tx.id, tx.recurringId]);
  if (!check) return null;
  const bill = recurringsById[check.recurringId];
  return (
    <PriceCheckBox
      check={check}
      billName={bill ? displayName(bill) : 'this bill'}
      categories={Object.values(categoriesById)}
      onDone={() => {
        setCheck(null);
        void applyFilter({});
      }}
    />
  );
}

/** Money in: which bill this credit pays back (a card's statement credit for a subscription), or link it to one. */
function PaysBackField({ tx }: { tx: Transaction }) {
  const recurringsById = useTransactionsStore((s) => s.recurringsById);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  const [picking, setPicking] = useState(false);
  const bills = Object.values(recurringsById).filter((r) => r.saved && r.saved.status !== 'archived');
  const paysBack = bills.filter((r) => creditsFrom([tx], r.saved!.paidBackBy ?? []).length > 0);
  const name = tx.merchant.trim().toLowerCase();
  const setNames = async (id: number, names: string[]) => {
    await ipc().setRecurringPaidBackBy(id, names);
    await applyFilter({});
  };
  return (
    <div>
      <FieldLabel>Recurring</FieldLabel>
      {paysBack.length > 0 ? (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="font-semibold">Pays back {paysBack.map(displayName).join(', ')}</span>
          <Button
            onClick={() =>
              void Promise.all(paysBack.map((r) => setNames(r.saved!.id, (r.saved!.paidBackBy ?? []).filter((n) => creditsFrom([tx], [n]).length === 0))))
            }
          >
            Not a payback
          </Button>
        </div>
      ) : (
        bills.length > 0 && <Button onClick={() => setPicking(true)}>Pays back a bill</Button>
      )}
      {picking && (
        <Modal label="Pays back a bill" onClose={() => setPicking(false)}>
          <div className="flex flex-col gap-1">
            <p className="m-0 mb-2 text-[12px]" style={{ color: 'var(--muted)' }}>
              Credits named {displayMerchant(tx)} will be shown with this bill's charges.
            </p>
            {bills
              .sort((a, b) => displayName(a).localeCompare(displayName(b)))
              .map((r) => (
                <button
                  key={r.saved!.id}
                  type="button"
                  onClick={() => {
                    setPicking(false);
                    void setNames(r.saved!.id, [...(r.saved!.paidBackBy ?? []), name]);
                  }}
                  className="rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]"
                >
                  {displayName(r)}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Which recurring bill this charge belongs to, with "Not recurring"; or "Make recurring". */
function RecurringField({ tx }: { tx: Transaction }) {
  const recurring = useTransactionsStore((s) => (tx.recurringId != null ? s.recurringsById[tx.recurringId] : undefined));
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  const [draft, setDraft] = useState<NewRecurring | null>(null);
  if (tx.amountCents > 0 && txTypeOf(tx) !== 'transfer') return <PaysBackField tx={tx} />;
  return (
    <div>
      <FieldLabel>Recurring</FieldLabel>
      {tx.recurringId != null ? (
        <div className="flex items-center gap-3 text-[13px]">
          <span data-testid="recurring-name" className="font-semibold">{recurring ? displayName(recurring) : 'Recurring'}</span>
          <Button onClick={() => void ipc().unlinkRecurring(tx.id).then(() => applyFilter({}))}>Not recurring</Button>
        </div>
      ) : (
        tx.amountCents < 0 && (
          <Button onClick={() => void ipc().draftRecurring(tx.id).then(setDraft)}>
            Make recurring
          </Button>
        )
      )}
      {draft && (
        <Modal label="New recurring" onClose={() => setDraft(null)}>
          <RecurringForm
            initial={draft}
            categories={Object.values(categoriesById)}
            preview
            onCancel={() => setDraft(null)}
            onSave={async (rule, exclude) => {
              await ipc().createRecurring(rule, exclude);
              setDraft(null);
              await applyFilter({});
            }}
          />
        </Modal>
      )}
    </div>
  );
}
