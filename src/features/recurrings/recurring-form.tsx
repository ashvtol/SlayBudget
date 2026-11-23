import { useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { cleanMerchant } from '@/lib/merchant';
import type { Cadence, Category, NewRecurring, Transaction } from '@/lib/types';
import { Select } from '@/components/select';

const FREQUENCIES: [Cadence, string][] = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['yearly', 'Annually'],
];

const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
/** Dollars typed in a field as cents; empty or negative is not an amount (NaN). */
const toCents = (text: string) => {
  const t = text.replace(/[$,\s]/g, '');
  const n = Number(t);
  return t === '' || !Number.isFinite(n) || n < 0 ? Number.NaN : Math.round(n * 100);
};

// One fixed height: WebKit draws a select at its own height and ignores vertical padding.
const fieldClass = 'h-[34px] w-full rounded-md border bg-transparent px-2 text-[13px]';
const fieldStyle = { borderColor: 'var(--line-strong)', color: 'var(--text)', background: 'var(--panel)' } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--muted)' }}>
      {label}
      {children}
    </label>
  );
}

/** A recurring bill's rules: name, what it matches, amount range, frequency, day, category.
 *  With `preview`, says how many past transactions the rules would claim. */
export function RecurringForm({
  initial,
  categories,
  preview = false,
  onSave,
  onCancel,
}: {
  initial: NewRecurring;
  categories: Category[];
  preview?: boolean;
  onSave: (rule: NewRecurring) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [matchKind, setMatchKind] = useState(initial.matchKind);
  const [pattern, setPattern] = useState(initial.pattern);
  const [min, setMin] = useState(dollars(initial.minCents));
  const [max, setMax] = useState(dollars(initial.maxCents));
  const [frequency, setFrequency] = useState<Cadence>(initial.frequency);
  const [day, setDay] = useState(initial.dayOfMonth == null ? '' : String(initial.dayOfMonth));
  const [categoryId, setCategoryId] = useState<number | null>(initial.categoryId);
  const [matches, setMatches] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rule = useMemo<NewRecurring | null>(() => {
    const minCents = toCents(min);
    const maxCents = toCents(max);
    const dayNum = day.trim() === '' ? null : Number(day);
    if (!name.trim() || !pattern.trim() || Number.isNaN(minCents) || Number.isNaN(maxCents) || maxCents < minCents) return null;
    if (dayNum != null && (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31)) return null;
    return { name: name.trim(), categoryId, matchKind, pattern: pattern.trim(), minCents, maxCents, frequency, dayOfMonth: dayNum };
  }, [name, categoryId, matchKind, pattern, min, max, frequency, day]);

  useEffect(() => {
    if (!preview || !rule) return;
    let live = true;
    void ipc().previewRecurring(rule).then((n) => live && setMatches(n));
    return () => {
      live = false;
    };
  }, [preview, rule]);

  async function save() {
    if (!rule) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(rule);
    } catch (e) {
      setError(`Couldn’t save: ${(e as Error).message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const sortedCategories = [...categories].filter((c) => !c.archived && c.kind === 'expense').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} style={fieldStyle} />
      </Field>
      <div className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--muted)' }}>
        Matches
        <div className="flex gap-3" role="radiogroup" aria-label="Match by">
          <label className="flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
            <input type="radio" checked={matchKind === 'merchant'} onChange={() => setMatchKind('merchant')} /> Exact name
          </label>
          <label className="flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
            <input type="radio" checked={matchKind === 'contains'} onChange={() => setMatchKind('contains')} /> Name contains
          </label>
        </div>
        <input aria-label="Match text" value={pattern} onChange={(e) => setPattern(e.target.value)} className={fieldClass} style={fieldStyle} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From ($)">
          <input aria-label="Minimum amount" value={min} onChange={(e) => setMin(e.target.value)} className={fieldClass} style={fieldStyle} />
        </Field>
        <Field label="To ($)">
          <input aria-label="Maximum amount" value={max} onChange={(e) => setMax(e.target.value)} className={fieldClass} style={fieldStyle} />
        </Field>
        <Field label="Frequency">
          <Select className="w-full" selectClassName="h-[34px]" aria-label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as Cadence)}>
            {FREQUENCIES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Day of month (blank = any)">
          <input aria-label="Day of month" value={day} onChange={(e) => setDay(e.target.value)} className={fieldClass} style={fieldStyle} />
        </Field>
      </div>
      <Field label="Category">
        <Select className="w-full" selectClassName="h-[34px]" aria-label="Category" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">From its transactions</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
          ))}
        </Select>
      </Field>
      {preview && matches != null && (
        <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
          Matches {matches} {matches === 1 ? 'transaction' : 'transactions'} so far.
        </p>
      )}
      {!rule && <p className="m-0 text-[12px]" style={{ color: 'var(--warn)' }}>Fill in a name, what to match, and an amount range (from is at most to).</p>}
      {error && <p className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
          Cancel
        </button>
        <button type="button" disabled={!rule || busy} onClick={() => void save()} className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
          Save
        </button>
      </div>
    </div>
  );
}

/** Centered modal frame used by the recurring dialogs. */
export function Modal({ label, role = 'dialog', onClose, children }: { label: string; role?: 'dialog' | 'alertdialog'; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}>
      <div role={role} aria-modal="true" aria-label={label} className="w-[440px] rounded-xl border p-5 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
        <h2 className="m-0 mb-4 text-[16px] font-semibold">{label}</h2>
        {children}
      </div>
    </div>
  );
}

/** "+" on Recurrings: search a transaction by name, then confirm its prefilled rules. */
export function NewRecurringDialog({
  transactions,
  categories,
  onCreated,
  onClose,
}: {
  transactions: Transaction[];
  categories: Category[];
  onCreated: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<NewRecurring | null>(null);
  const latestByMerchant = useMemo(() => {
    const seen = new Map<string, Transaction>();
    for (const t of [...transactions].sort((a, b) => b.postedOn.localeCompare(a.postedOn))) {
      if (t.amountCents < 0 && !seen.has(t.merchant)) seen.set(t.merchant, t);
    }
    return [...seen.values()];
  }, [transactions]);
  const q = query.trim().toLowerCase();
  const results = q ? latestByMerchant.filter((t) => cleanMerchant(t.merchant).toLowerCase().includes(q)).slice(0, 8) : [];

  return (
    <Modal label="New recurring" onClose={onClose}>
      {draft ? (
        <RecurringForm
          initial={draft}
          categories={categories}
          preview
          onCancel={onClose}
          onSave={async (rule) => onCreated(await ipc().createRecurring(rule))}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            aria-label="Search transactions"
            placeholder="Search a name, e.g. Netflix"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={fieldClass}
            style={fieldStyle}
          />
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void ipc().draftRecurring(t.id).then(setDraft)}
              className="flex h-[30px] items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]"
            >
              <span>{cleanMerchant(t.merchant)}</span>
              <span style={{ color: 'var(--muted)' }}>{t.postedOn}</span>
            </button>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
