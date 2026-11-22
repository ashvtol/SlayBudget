import { useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { cleanMerchant } from '@/lib/merchant';
import { MIN_CONTAINS, isPaymentPlatform, normalizeDescription } from '@/lib/recategorize';
import type { Category, RecatMatch, RecatTarget } from '@/lib/types';
import { CategoryPill } from '@/components/category-pill';
import { Money } from '@/components/money';
import { Switch } from '@/components/switch';
import { shortDate } from '@/lib/format';

type Choice = 'one' | 'merchant' | 'contains';

export interface RecategorizeOfferProps {
  /** Merchant key of the changed transaction (or of a Clean up Other group). */
  merchant: string;
  sampleDescription: string;
  categoryId: number;
  categoriesById: Record<number, Category>;
  /** Called with how many transactions moved, or null when nothing changed. */
  onDone: (moved: number | null) => void;
  /** Clean up Other: list only rows still in Other (or uncategorized). */
  onlyOther?: boolean;
}

/** "Apply to other transactions?" after a category change: choose a match, see the rows, apply. */
export function RecategorizeOffer({ merchant, sampleDescription, categoryId, categoriesById, onDone, onlyOther = false }: RecategorizeOfferProps) {
  const category = categoriesById[categoryId];
  const platform = isPaymentPlatform(merchant);
  const [choice, setChoice] = useState<Choice>('merchant');
  const [text, setText] = useState(merchant);
  const [exact, setExact] = useState<RecatMatch[] | null>(null);
  const [contains, setContains] = useState<RecatMatch[]>([]);
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [future, setFuture] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (platform) return;
    let live = true;
    void ipc()
      .previewRecategorize({ kind: 'merchant', value: merchant }, categoryId)
      .then((m) => {
        if (!live) return;
        if (m.length === 0) onDone(null);
        else {
          setExact(m);
          setUnticked(new Set(m.filter((x) => x.similar).map((x) => x.transaction.id)));
        }
      });
    return () => {
      live = false;
    };
    // onDone is a callback from the parent; re-running on its identity would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, categoryId, platform]);

  useEffect(() => {
    if (platform || choice !== 'contains') return;
    let live = true;
    const target: RecatTarget = { kind: 'contains', value: text };
    void ipc()
      .previewRecategorize(target, categoryId)
      .then((m) => live && setContains(m));
    return () => {
      live = false;
    };
  }, [platform, choice, text, categoryId]);

  const shown = useMemo(() => {
    const rows = choice === 'merchant' ? exact ?? [] : choice === 'contains' ? contains : [];
    if (!onlyOther) return rows;
    return rows.filter((m) => m.transaction.categoryId == null || categoriesById[m.transaction.categoryId]?.isOther);
  }, [choice, exact, contains, onlyOther, categoriesById]);
  const ticked = shown.filter((m) => !m.locked && !unticked.has(m.transaction.id));
  const title = `Apply “${category?.name ?? 'this category'}” to other transactions?`;
  const name = cleanMerchant(merchant);

  async function apply() {
    setBusy(true);
    try {
      const moved = await ipc().applyRecategorize(ticked.map((m) => m.transaction.id), categoryId);
      if (future && choice !== 'one') {
        const pattern = choice === 'merchant' ? merchant : normalizeDescription(text);
        await ipc().saveRule({ kind: choice, pattern, categoryId });
      }
      onDone(moved);
    } finally {
      setBusy(false);
    }
  }

  const shell = (body: React.ReactNode) => (
    <section
      role="region"
      aria-label={title}
      className="rounded-xl border p-4 text-[13px]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' }}
    >
      <h3 className="m-0 mb-3 text-[14px] font-semibold">{title}</h3>
      {body}
    </section>
  );

  if (platform) {
    const label = cleanMerchant(sampleDescription).split(' ')[0] || 'These';
    return shell(
      <div className="flex items-center justify-between gap-4">
        <p className="m-0" style={{ color: 'var(--muted)' }}>{label} payments are categorized one at a time.</p>
        <button type="button" onClick={() => onDone(null)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
          OK
        </button>
      </div>,
    );
  }
  if (exact == null) return null;

  const option = (value: Choice, label: React.ReactNode, count?: number) => (
    <label className="flex min-h-8 items-center gap-2.5">
      <input type="radio" name="recat-choice" checked={choice === value} onChange={() => setChoice(value)} aria-label={typeof label === 'string' ? label : undefined} />
      <span className="flex-1">{label}</span>
      {count != null && <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{count}</span>}
    </label>
  );

  return shell(
    <>
      <div className="flex flex-col">
        {option('one', 'Just this one')}
        {option('merchant', `All named “${name}”`, choice === 'merchant' ? shown.length : exact.length)}
        <label className="flex min-h-8 items-center gap-2.5">
          <input type="radio" name="recat-choice" checked={choice === 'contains'} onChange={() => setChoice('contains')} aria-label="Names containing" />
          <span>Names containing</span>
          <input
            value={text}
            onFocus={() => setChoice('contains')}
            onChange={(e) => setText(e.target.value)}
            aria-label="Name contains"
            className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-[12px]"
            style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
          />
          {choice === 'contains' && <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{shown.length}</span>}
        </label>
        {choice === 'contains' && normalizeDescription(text).length < MIN_CONTAINS && (
          <p className="m-0 pl-6 text-[12px]" style={{ color: 'var(--muted)' }}>Type at least {MIN_CONTAINS} characters.</p>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="-mx-4 mt-3 max-h-64 overflow-y-auto border-t px-4 pt-2" style={{ borderColor: 'var(--line)' }}>
          {shown.map((m) => {
            const t = m.transaction;
            const current = t.categoryId != null ? categoriesById[t.categoryId] : undefined;
            const checked = !m.locked && !unticked.has(t.id);
            return (
              <li key={t.id} className="flex min-h-8 items-center gap-3" style={{ opacity: m.locked ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  aria-label={`Include ${t.description} on ${t.postedOn}`}
                  checked={checked}
                  disabled={m.locked}
                  onChange={() =>
                    setUnticked((s) => {
                      const next = new Set(s);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    })
                  }
                />
                <span className="w-14 shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>{shortDate(t.postedOn)}</span>
                <span className="min-w-0 flex-1 truncate">{t.description}</span>
                {m.similar && <span className="text-[11px]" style={{ color: 'var(--warn)' }}>similar</span>}
                {m.locked && <span className="text-[11px]" style={{ color: 'var(--muted)' }}>locked</span>}
                <CategoryPill category={current} />
                <span className="w-16 shrink-0 text-right">
                  <Money cents={t.amountCents} currency={t.currency} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        {choice !== 'one' ? <Switch label="Also file future transactions this way" checked={future} onChange={setFuture} /> : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={() => onDone(null)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
            Not now
          </button>
          {choice === 'one' ? (
            <button type="button" onClick={() => onDone(null)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              Done
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || ticked.length === 0}
              onClick={() => void apply()}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              Apply to {ticked.length}
            </button>
          )}
        </div>
      </div>
    </>,
  );
}
