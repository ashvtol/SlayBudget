import { useState } from 'react';
import type { Category, Transaction } from '@/lib/types';
import { CategoryPill } from '@/components/category-pill';
import { Money } from '@/components/money';
import { shortDate } from '@/lib/format';
import { DetailsButton, InfoButton, StatementBox, useOpenRows } from './statement-box';

export interface MatchRow {
  transaction: Transaction;
  /** Its category is locked: shown, never ticked. */
  locked?: boolean;
  /** Only a similar name, not the same one. */
  similar?: boolean;
}

/** The transactions a rule or a category change would take: how many, behind an ⓘ; each with a checkbox, Select all
 *  and Select none, and its own ⓘ for the statement details. Used by Make recurring and Apply to other transactions. */
export function MatchList({
  rows,
  ticked,
  onChange,
  categoriesById,
  startOpen = false,
}: {
  rows: MatchRow[];
  ticked: Set<number>;
  onChange: (next: Set<number>) => void;
  categoriesById: Record<number, Category>;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const details = useOpenRows();
  const selectable = rows.filter((m) => !m.locked).map((m) => m.transaction.id);
  const count = rows.filter((m) => !m.locked && ticked.has(m.transaction.id)).length;

  if (rows.length === 0) {
    return <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>No other transactions match</p>;
  }
  const toggle = (id: number) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
        <span>Matches {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}</span>
        <InfoButton
          label={open ? 'Hide the matching transactions' : 'Show the matching transactions'}
          title={open ? 'Hide the matching transactions' : 'Show the matching transactions'}
          open={open}
          onToggle={() => setOpen(!open)}
        />
        {open && (
          <span className="ml-auto flex items-center gap-3">
            <span className="tabular-nums">
              {count} of {rows.length} selected
            </span>
            <button type="button" onClick={() => onChange(new Set(selectable))} className="font-semibold" style={{ color: 'var(--accent)' }}>
              Select all
            </button>
            <button type="button" onClick={() => onChange(new Set())} className="font-semibold" style={{ color: 'var(--accent)' }}>
              Select none
            </button>
          </span>
        )}
      </div>
      {open && (
        <ul aria-label="Matching transactions" className="m-0 max-h-64 list-none overflow-y-auto border-t p-0 pt-1 text-[13px]" style={{ borderColor: 'var(--line)' }}>
          {rows.map((m) => {
            const t = m.transaction;
            const current = t.categoryId != null ? categoriesById[t.categoryId] : undefined;
            return (
              <li key={t.id} style={{ opacity: m.locked ? 0.5 : 1 }}>
                <div className="flex min-h-8 items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Include ${t.description} on ${t.postedOn}`}
                    checked={!m.locked && ticked.has(t.id)}
                    disabled={m.locked}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="w-14 shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>{shortDate(t.postedOn)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description}</span>
                  {m.similar && <span className="text-[11px]" style={{ color: 'var(--warn)' }}>similar</span>}
                  {m.locked && <span className="text-[11px]" style={{ color: 'var(--muted)' }}>locked</span>}
                  <CategoryPill category={current} />
                  <span className="w-20 shrink-0 text-right">
                    <Money cents={t.amountCents} currency={t.currency} />
                  </span>
                  <DetailsButton tx={t} open={details.isOpen(t.id)} onToggle={() => details.toggle(t.id)} />
                </div>
                {details.isOpen(t.id) && (
                  <div className="mb-2 ml-7">
                    <StatementBox tx={t} named onClose={() => details.toggle(t.id)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
