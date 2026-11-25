import { useEffect, useState } from 'react';
import { CategoryPill } from '@/components/category-pill';
import { Money } from '@/components/money';
import { ipc } from '@/lib/ipc';
import { cleanMerchant } from '@/lib/merchant';
import { shortDate } from '@/lib/format';
import type { Category, RecatMatch } from '@/lib/types';
import { DetailsButton, StatementBox, useOpenRows } from './statement-box';

/** After a payment app's category change (Wise, Zelle, PayPal): each payment may differ, so nothing moved by itself.
 *  This asks about the others with the same name: tick the ones that go there too, or keep just this one. */
export function PlatformOffer({
  transactionId,
  categoryId,
  merchant,
  categoriesById,
  onApply,
  onDone,
}: {
  transactionId: number;
  categoryId: number;
  merchant: string;
  categoriesById: Record<number, Category>;
  onApply: (ids: number[], categoryId: number) => Promise<void>;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<RecatMatch[] | null>(null);
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const details = useOpenRows();

  useEffect(() => {
    let live = true;
    void ipc()
      .sameMerchant(transactionId, categoryId)
      .then((m) => {
        if (!live) return;
        if (m.length === 0) onDone();
        else {
          setRows(m);
          // Categories you chose yourself stay unless you tick them.
          setUnticked(new Set(m.filter((x) => x.transaction.categorySource === 'user').map((x) => x.transaction.id)));
        }
      });
    return () => {
      live = false;
    };
    // onDone is the parent's callback; re-running on its identity would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, categoryId]);

  if (!rows) return null;
  const ticked = rows.filter((m) => !m.locked && !unticked.has(m.transaction.id));
  const title = `Also put other ${cleanMerchant(merchant)} transactions in ${categoriesById[categoryId]?.name ?? 'this category'}?`;

  return (
    <section role="region" aria-label={title} className="rounded-xl border p-4 text-[13px]" style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' }}>
      <h3 className="m-0 mb-1 text-[14px] font-semibold">{title}</h3>
      <p className="m-0 mb-3 text-[12px]" style={{ color: 'var(--muted)' }}>
        Payments through an app can each be for something different, so nothing moved. Tick the ones that belong here too.
      </p>
      <ul className="-mx-4 m-0 max-h-64 list-none overflow-y-auto border-t px-4 pt-2" style={{ borderColor: 'var(--line)' }}>
        {rows.map((m) => {
          const t = m.transaction;
          const current = t.categoryId != null ? categoriesById[t.categoryId] : undefined;
          return (
            <li key={t.id} style={{ opacity: m.locked ? 0.5 : 1 }}>
              <div className="flex min-h-8 items-center gap-3">
              <input
                type="checkbox"
                aria-label={`Include ${t.description} on ${t.postedOn}`}
                checked={!m.locked && !unticked.has(t.id)}
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
      <div className="mt-3 flex justify-end gap-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
          Just this one
        </button>
        <button
          type="button"
          disabled={busy || ticked.length === 0}
          onClick={() => {
            setBusy(true);
            void onApply(ticked.map((m) => m.transaction.id), categoryId).finally(onDone);
          }}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          Apply to {ticked.length}
        </button>
      </div>
    </section>
  );
}
