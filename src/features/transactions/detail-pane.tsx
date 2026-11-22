import { useEffect, useMemo, useState } from 'react';
import { TagPill } from '@/components/tag-pill';
import { useTagsStore } from '@/lib/stores/tags-store';
import { useDisplayStore } from '@/lib/stores/display-store';
import { TagPicker } from './tag-picker';
import { statementClues } from '@/lib/statement-clues';
import { CategoryPill } from '@/components/category-pill';
import { ipc } from '@/lib/ipc';
import type { Category, NewRecurring, SplitPart, StatementInfo, Transaction } from '@/lib/types';
import { dayHeaderLabel, formatSignedMoney, groupByDay } from '@/lib/format';
import { Money } from '@/components/money';
import { ToolbarButton } from '@/components/toolbar-button';
import { IconCalendar, IconCard, IconCheck, IconTag, IconTrash } from '@/components/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DuplicateBox } from './duplicate-box';
import { displayMerchant, TransactionRow, TransferPill } from './transaction-row';
import { similarTransactions } from './similar';
import { RecategorizeOffer } from './recategorize-offer';
import { Modal, RecurringForm } from '@/features/recurrings/recurring-form';
import { displayName } from '@/features/analytics/recurrings-model';
import { txTypeOf } from '@/lib/tx-type';
import type { TxType } from '@/lib/types';

const TYPES: [TxType, string][] = [
  ['regular', 'Regular'],
  ['income', 'Income'],
  ['transfer', 'Internal transfer'],
];
import { useTransactionsStore } from './transactions-store';

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
          <button type="button" onClick={startEditing} className="min-h-8 rounded-lg border px-2.5 text-sm" style={{ borderColor: 'var(--line)', color: 'var(--accent)' }}>
            {children.length ? 'Edit split' : 'Split transaction'}
          </button>
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
              <select
                aria-label={`Part ${i + 1} category`}
                value={p.categoryId ?? ''}
                onChange={(e) => setParts((prev) => prev.map((x, j) => (j === i ? { ...x, categoryId: e.target.value === '' ? null : Number(e.target.value) } : x)))}
                className="min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1.5 text-sm"
                style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
            <button type="button" onClick={() => void save()} disabled={!valid} className="min-h-9 rounded-lg px-3 text-sm font-medium" style={{ background: valid ? 'var(--accent)' : 'var(--line)', color: valid ? '#fff' : 'var(--muted)' }}>Save split</button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-lg border px-3 text-sm" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>Cancel</button>
            {children.length > 0 && <button type="button" onClick={() => void removeSplit()} className="ml-auto min-h-9 rounded-lg px-3 text-sm" style={{ color: 'var(--neg)' }}>Remove split</button>}
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
  const [info, setInfo] = useState<StatementInfo | null>(null);
  useEffect(() => {
    let live = true;
    void ipc()
      .statementInfo(tx.id)
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [tx.id]);
  const clues = useMemo(() => statementClues(tx.description), [tx.description]);
  const fields = info?.fields ?? [];
  const imported = info?.importedAt ? new Date(info.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return (
    <div role="group" aria-label="Statement">
      <FieldLabel>Statement</FieldLabel>
      <div className="rounded-md border px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
        <div className="text-[11px]" style={{ color: 'var(--subtle)' }}>Appears on statement as</div>
        <div className="mt-0.5 select-text whitespace-pre-wrap break-words font-mono text-[12px]" style={{ color: 'var(--text)' }}>{tx.description}</div>
        {(clues.length > 0 || fields.length > 0) && (
          <dl className="m-0 mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            {[...clues.map((c) => [c.label, c.value] as const), ...fields].map(([label, value], i) => (
              <div key={`${label}-${i}`} data-row className="contents">
                <dt style={{ color: 'var(--muted)' }}>{label}</dt>
                <dd className="m-0 select-text whitespace-pre-wrap break-words" style={{ color: 'var(--text)' }}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {info?.fileName && (
          <div className="mt-2.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
            Imported from {info.fileName} ({info.sourceName}){imported ? `, ${imported}` : ''}
          </div>
        )}
      </div>
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
  return (
    <ToolbarButton icon={IconCheck} active={tx.reviewed} aria-pressed={tx.reviewed} onClick={() => void toggleReviewed([tx.id])}>
      {tx.reviewed ? 'Reviewed' : 'Review'}
    </ToolbarButton>
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

/** The detail panel body for one transaction (Copilot layout). Renders nothing when `id` is null. */
export function DetailPane({ id, onPickCategory, onOpen }: { id: number | null; onClose?: () => void; onPickCategory: (id: number) => void; onOpen?: (id: number) => void }) {
  const tx = useTransactionsStore((s) => (id != null ? s.byId(id) : undefined));
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const sourcesById = useTransactionsStore((s) => s.sourcesById);
  const transactions = useTransactionsStore((s) => s.transactions);
  const setNotes = useTransactionsStore((s) => s.setNotes);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  const offer = useTransactionsStore((s) => s.offer);
  const notice = useTransactionsStore((s) => s.notice);
  const closeOffer = useTransactionsStore((s) => s.closeOffer);
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
        <span data-testid="detail-amount" className="shrink-0 text-[24px] font-semibold">
          <Money cents={tx.amountCents} currency={tx.currency} tone={tx.amountCents > 0 ? 'pos' : 'default'} sign={signs ? 'always' : 'none'} />
        </span>
      </header>
      <DuplicateBox tx={tx} onOpen={onOpen} />

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

      {offer && offer.transactionId === tx.id && (
        <RecategorizeOffer
          key={`${offer.transactionId}-${offer.categoryId}`}
          merchant={tx.merchant}
          sampleDescription={tx.description}
          categoryId={offer.categoryId}
          categoriesById={categoriesById}
          onDone={(moved) => void closeOffer(moved)}
        />
      )}
      {notice && (
        <p role="status" className="m-0 -mt-3 text-[12px]" style={{ color: 'var(--pos)' }}>{notice}</p>
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

/** Which recurring bill this charge belongs to, with "Not recurring"; or "Make recurring". */
function RecurringField({ tx }: { tx: Transaction }) {
  const recurring = useTransactionsStore((s) => (tx.recurringId != null ? s.recurringsById[tx.recurringId] : undefined));
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const applyFilter = useTransactionsStore((s) => s.applyFilter);
  const [draft, setDraft] = useState<NewRecurring | null>(null);
  const button = 'h-[26px] rounded-md border px-2.5 text-[12px] font-semibold';
  return (
    <div>
      <FieldLabel>Recurring</FieldLabel>
      {tx.recurringId != null ? (
        <div className="flex items-center gap-3 text-[13px]">
          <span data-testid="recurring-name" className="font-semibold">{recurring ? displayName(recurring) : 'Recurring'}</span>
          <button
            type="button"
            onClick={() => void ipc().unlinkRecurring(tx.id).then(() => applyFilter({}))}
            className={button}
            style={{ borderColor: 'var(--line-strong)', color: 'var(--muted)' }}
          >
            Not recurring
          </button>
        </div>
      ) : (
        tx.amountCents < 0 && (
          <button type="button" onClick={() => void ipc().draftRecurring(tx.id).then(setDraft)} className={button} style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
            Make recurring
          </button>
        )
      )}
      {draft && (
        <Modal label="New recurring" onClose={() => setDraft(null)}>
          <RecurringForm
            initial={draft}
            categories={Object.values(categoriesById)}
            preview
            onCancel={() => setDraft(null)}
            onSave={async (rule) => {
              await ipc().createRecurring(rule);
              setDraft(null);
              await applyFilter({});
            }}
          />
        </Modal>
      )}
    </div>
  );
}
