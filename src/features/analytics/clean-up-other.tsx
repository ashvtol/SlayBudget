import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { cleanMerchant } from '@/lib/merchant';
import type { Category, OtherGroup } from '@/lib/types';
import { Money } from '@/components/money';
import { RecategorizeOffer } from '@/features/transactions/recategorize-offer';

interface Row {
  key: string;
  name: string;
  count: number;
  totalCents: number;
  /** Payment platforms: one row per platform, reviewed one transaction at a time. */
  platform: string | null;
  merchant: string;
  sampleDescription: string;
  bankCategory: string | null;
  suggestedCategoryId: number | null;
}

/** Payment-platform groups (one per payment) fold into one row per platform. */
function toRows(groups: OtherGroup[]): Row[] {
  const rows: Row[] = [];
  const platforms = new Map<string, Row>();
  for (const g of groups) {
    if (!g.platform) {
      rows.push({
        key: g.merchant,
        name: cleanMerchant(g.merchant),
        count: g.count,
        totalCents: g.totalCents,
        platform: null,
        merchant: g.merchant,
        sampleDescription: g.sampleDescription,
        bankCategory: g.bankCategory ?? null,
        suggestedCategoryId: g.suggestedCategoryId ?? null,
      });
      continue;
    }
    const word = g.merchant.split(' ')[0];
    const row = platforms.get(word) ?? { key: `platform:${word}`, name: cleanMerchant(word), count: 0, totalCents: 0, platform: word, merchant: g.merchant, sampleDescription: g.sampleDescription, bankCategory: null, suggestedCategoryId: null };
    row.count += g.count;
    row.totalCents += g.totalCents;
    platforms.set(word, row);
  }
  return [...rows, ...platforms.values()].sort((a, b) => b.count - a.count || b.totalCents - a.totalCents || a.name.localeCompare(b.name));
}

/** What is left in Other, grouped by name, with a category to pick per group. */
export function CleanUpOther({
  categories,
  categoriesById,
  onChanged,
  onReviewEach,
}: {
  categories: Category[];
  categoriesById: Record<number, Category>;
  onChanged: () => void;
  onReviewEach: (platform: string) => void;
}) {
  const [groups, setGroups] = useState<OtherGroup[] | null>(null);
  const [offer, setOffer] = useState<{ row: Row; categoryId: number } | null>(null);

  const refresh = useCallback(() => void ipc().otherGroups().then(setGroups), []);
  useEffect(refresh, [refresh]);

  const rows = useMemo(() => (groups ? toRows(groups) : []), [groups]);
  const left = rows.reduce((n, r) => n + r.count, 0);
  const choices = useMemo(() => categories.filter((c) => !c.isOther && !c.archived).sort((a, b) => a.name.localeCompare(b.name)), [categories]);

  return (
    <section role="region" aria-label="Clean up Other" className="flex flex-col gap-4 px-8 py-6">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[18px] font-semibold">Clean up Other</h2>
        <span className="text-[13px]" style={{ color: 'var(--muted)' }}>{groups == null ? '…' : `${left.toLocaleString()} left in Other`}</span>
      </div>

      {offer && (
        <RecategorizeOffer
          key={`${offer.row.key}-${offer.categoryId}`}
          merchant={offer.row.merchant}
          sampleDescription={offer.row.sampleDescription}
          categoryId={offer.categoryId}
          categoriesById={categoriesById}
          onlyOther
          onDone={(moved) => {
            setOffer(null);
            if (moved) {
              refresh();
              onChanged();
            }
          }}
        />
      )}

      {groups != null && rows.length === 0 && <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>Nothing left in Other.</p>}

      <div role="table" aria-label="Other by name">
        {rows.map((r) => (
          <div key={r.key} role="row" className="flex min-h-10 items-center gap-3 border-b text-[13px]" style={{ borderColor: 'var(--line)' }}>
            <span role="cell" className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{r.name}</span>
              {r.bankCategory && (
                <span className="flex min-w-0 items-center gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
                  <span className="truncate" title={r.bankCategory}>
                    Bank: {r.bankCategory.split('-').slice(1).join('-') || r.bankCategory}
                  </span>
                  {r.suggestedCategoryId != null && categoriesById[r.suggestedCategoryId] && (
                    <button
                      type="button"
                      onClick={() => setOffer({ row: r, categoryId: r.suggestedCategoryId! })}
                      className="shrink-0 font-semibold"
                      style={{ color: 'var(--accent)' }}
                      title={`Your bank calls this ${r.bankCategory}`}
                    >
                      Use {categoriesById[r.suggestedCategoryId].name}
                    </button>
                  )}
                </span>
              )}
            </span>
            <span role="cell" className="w-10 text-right tabular-nums" style={{ color: 'var(--muted)' }}>{r.count}</span>
            <span role="cell" className="w-24 text-right">
              <Money cents={r.totalCents} />
            </span>
            <span role="cell" className="w-48 shrink-0 text-right">
              {r.platform ? (
                <button type="button" onClick={() => onReviewEach(r.platform!)} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                  Review each
                </button>
              ) : (
                <select
                  aria-label={`Category for ${r.name}`}
                  value=""
                  onChange={(e) => e.target.value && setOffer({ row: r, categoryId: Number(e.target.value) })}
                  className="w-44 rounded-md border px-1.5 py-1 text-[12px]"
                  style={{ borderColor: 'var(--line)', color: 'var(--text)', background: 'var(--panel)' }}
                >
                  <option value="">Choose category</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
                  ))}
                </select>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
