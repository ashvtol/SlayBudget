import { useState } from 'react';
import { Button } from '@/components/button';
import { ipc } from '@/lib/ipc';
import { formatMoney, shortDate } from '@/lib/format';
import { useCurrencyStore } from '@/features/currency/currency-store';
import type { Category, NewRecurring, PriceCheck } from '@/lib/types';
import { Modal, RecurringForm } from './recurring-form';

/** "+353%" or "-55%". */
export function percentChange(from: number, to: number): string {
  if (from <= 0) return '';
  const pct = Math.round(((to - from) * 100) / from);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/**
 * "Is this Anthropic Claude at a new price?": a charge outside its bill's range, asked once, with three answers. "A separate
 * subscription" opens the new recurring form, prefilled. `onDone` runs after any answer (and after the form is saved or closed).
 */
export function PriceCheckBox({
  check,
  billName,
  categories,
  date,
  onDone,
}: {
  check: PriceCheck;
  billName: string;
  categories: Category[];
  /** The charge's day, shown when the box is away from the charge (on the bill). */
  date?: string;
  onDone: () => void;
}) {
  const currency = useCurrencyStore((s) => s.displayCurrency);
  const [draft, setDraft] = useState<NewRecurring | null>(null);
  const [busy, setBusy] = useState(false);
  const color = check.direction === 'up' ? 'var(--warn)' : 'var(--pos)';
  const answer = async (a: 'new_price' | 'one_off' | 'separate') => {
    setBusy(true);
    const form = await ipc().answerPriceCheck(check.id, a);
    if (form) setDraft(form);
    else onDone();
  };
  return (
    <section
      aria-label="Possible new price"
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 7%, transparent)` }}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        Is this {billName} at a new price?
      </div>
      <p className="m-0 text-[12px]">
        {date && <span style={{ color: 'var(--muted)' }}>{shortDate(date)} · </span>}
        It was {formatMoney(check.oldCents, currency)}, this is {formatMoney(check.newCents, currency)} ({percentChange(check.oldCents, check.newCents)}).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void answer('new_price')}>Yes, new price</Button>
        <Button disabled={busy} onClick={() => void answer('one_off')}>No, a one-off</Button>
        <Button disabled={busy} onClick={() => void answer('separate')}>A separate subscription</Button>
      </div>
      {draft && (
        <Modal
          label="New recurring"
          onClose={() => {
            setDraft(null);
            onDone();
          }}
        >
          <RecurringForm
            initial={draft}
            categories={categories}
            preview
            onCancel={() => {
              setDraft(null);
              onDone();
            }}
            onSave={async (rule) => {
              await ipc().createRecurring(rule);
              setDraft(null);
              onDone();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
