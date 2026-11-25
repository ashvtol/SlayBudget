import { CategoryPopup } from '@/components/category-popup';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { useScreen } from '@/app/shell/screen';
import { cleanMerchant } from '@/lib/merchant';
import type { Category, OtherGroup, Transaction } from '@/lib/types';
import { InfoButton, StatementBox } from '@/features/transactions/statement-box';
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
  const details = useOpenKeys();

  const refresh = useCallback(() => void ipc().otherGroups().then(setGroups), []);
  // The screen stays open in the background: read again each time it's shown, so rows fixed elsewhere are gone.
  const { activation } = useScreen();
  useEffect(refresh, [refresh, activation]);

  const rows = useMemo(() => (groups ? toRows(groups) : []), [groups]);
  const left = rows.reduce((n, r) => n + r.count, 0);
  const choices = useMemo(() => categories.filter((c) => !c.isOther && !c.archived).sort((a, b) => a.name.localeCompare(b.name)), [categories]);

  return (
    <section role="region" aria-label="Clean up Other" className="flex flex-col gap-4 px-8 py-6">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[18px] font-semibold">Clean up Other</h2>
        <span className="text-[13px]" style={{ color: 'var(--muted)' }}>{groups == null ? '…' : `${left.toLocaleString()} left in Other`}</span>
      </div>

      {groups != null && rows.length === 0 && <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>Nothing left in Other.</p>}

      <div role="table" aria-label="Other by name">
        {rows.map((r) => (
          <Fragment key={r.key}>
          <div role="row" className="flex min-h-10 items-center gap-3 border-b text-[13px]" style={{ borderColor: 'var(--line)' }}>
            <span role="cell" className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{r.name}</span>
                {!r.platform && <InfoButton label={`Statement details for ${r.name}`} open={details.isOpen(r.key)} onToggle={() => details.toggle(r.key)} />}
              </span>
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
                <CategoryPopup
                  className="w-44"
                  label={`Category for ${r.name}`}
                  categories={choices}
                  value={null}
                  placeholder="Choose category"
                  onChange={(id) => id != null && setOffer({ row: r, categoryId: id })}
                />
              )}
            </span>
          </div>
          {offer?.row.key === r.key && (
            // Opens under the row it is for, not at the top of a long list.
            <div className="py-3">
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
            </div>
          )}
          {details.isOpen(r.key) && <GroupDetails merchant={r.merchant} categoriesById={categoriesById} onClose={() => details.toggle(r.key)} />}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

/** Which groups have their details open. */
function useOpenKeys() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { isOpen: (key: string) => open.has(key), toggle };
}

/** The statement details of each transaction in a group that is still in Other. */
function GroupDetails({ merchant, categoriesById, onClose }: { merchant: string; categoriesById: Record<number, Category>; onClose: () => void }) {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  useEffect(() => {
    let live = true;
    void ipc()
      .listTransactions({ merchants: [merchant] })
      .then((all) => live && setRows(all.filter((t) => t.categoryId == null || categoriesById[t.categoryId]?.isOther)));
    return () => {
      live = false;
    };
  }, [merchant, categoriesById]);
  if (!rows) return null;
  return (
    <div className="flex flex-col gap-2 border-b py-2.5" style={{ borderColor: 'var(--line)' }}>
      {/* One × on the first box closes the group's details. */}
      {rows.map((t, i) => (
        <StatementBox key={t.id} tx={t} named onClose={i === 0 ? onClose : undefined} />
      ))}
    </div>
  );
}
