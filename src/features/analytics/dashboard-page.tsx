import { useState } from 'react';
import { CategoryIcon } from '@/components/category-icon';
import { Page } from '@/app/shell/page';
import { Card } from '@/components/card';
import { Money } from '@/components/money';
import { DeltaBadge, percentChange } from '@/components/delta-badge';
import { PaceLine } from '@/features/charts/svg/pace-line';
import { useAnalyticsStore } from './analytics-store';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { cleanMerchant } from '@/lib/merchant';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { useNavStore } from '@/lib/stores/nav-store';
import type { Recurring } from '@/lib/types';
import type { DashboardModel, TopGroup } from './dashboard-model';
import { useDashboardData, type DashboardData } from './use-dashboard-data';
import { CategoryLine } from './category-line';
import { DashboardTips } from '@/features/habits/dashboard-tips';

export function DashboardPage() {
  const data = useDashboardData();
  const go = useNavStore((s) => s.go);

  return (
    <Page title="Dashboard">
      {data && (
        <div className="grid grid-cols-2 items-start gap-8">
          <div className="flex flex-col gap-8">
            <MonthlySpending month={data.model.month} onLink={() => go('transactions')} />
            <ToReview data={data} onLink={() => go('transactions')} />
            <NetThisMonth net={data.model.net} onLink={() => go('cashflow')} />
            <NextTwoWeeks upcoming={data.model.upcoming} categoriesById={data.categoriesById} onLink={() => go('recurring')} />
          </div>
          <div className="flex flex-col gap-8">
            <DashboardTips />
            <TopCategories groups={data.model.topCategories} onLink={() => go('categories')} />
          </div>
        </div>
      )}
    </Page>
  );
}

function MonthlySpending({ month, onLink }: { month: DashboardModel['month']; onLink: () => void }) {
  const today = useAnalyticsStore((s) => s.today);
  const over = month.freeLeftCents < 0;
  const budgeted = month.budgetCents > 0;
  return (
    <Card title="Monthly spending" linkLabel="Transactions" onLink={onLink}>
      <div className="text-center">
        {budgeted ? (
          <>
            <div className="text-[18px] font-semibold">
              <Money cents={Math.abs(month.freeLeftCents)} decimals={false} tone={over ? 'neg' : 'default'} /> {over ? 'over' : 'left'}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              out of <Money cents={month.budgetCents} decimals={false} tone="muted" /> budgeted
              {month.billsCents > 0 && (
                <>
                  {' · '}
                  <Money cents={month.billsCents} decimals={false} tone="muted" /> in bills set aside
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Without a budget there is nothing to be over: show what was spent. */}
            <div className="text-[18px] font-semibold">
              <Money cents={month.spentCents} decimals={false} /> spent
            </div>
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>No budget set · add budgets in Categories</div>
          </>
        )}
      </div>
      <div className="mt-2">
        <PaceLine daily={month.daily} daysInMonth={month.daysInMonth} budgetCents={month.freeBudgetCents} month={today.slice(0, 7)} height={170} />
      </div>
    </Card>
  );
}

function ToReview({ data, onLink }: { data: DashboardData; onLink: () => void }) {
  const focusById = useTransactionsStore((s) => s.focusById);
  const go = useNavStore((s) => s.go);
  return (
    <Card title="Transactions to review" linkLabel="View all" onLink={onLink} padded={false}>
      <div className="pb-3" role="grid" aria-label="Transactions to review">
        {data.toReview.length === 0 ? (
          <p className="m-0 px-5 pb-2 text-[13px]" style={{ color: 'var(--muted)' }}>All caught up.</p>
        ) : (
          data.toReview.map((t) => (
            <TransactionRow
              key={t.id}
              tx={t}
              category={t.categoryId != null ? data.categoriesById[t.categoryId] : undefined}
              source={data.sourcesById[t.sourceId]}
              selected={false}
              active={false}
              selectable={false}
              onToggleSelect={() => {}}
              onOpen={() => {
                go('transactions');
                void focusById(t.id);
              }}
              onPickCategory={() => {
                go('transactions');
                void focusById(t.id);
              }}
            />
          ))
        )}
        {data.otherCount > 0 && <OtherRow count={data.otherCount} />}
      </div>
    </Card>
  );
}

/** "N in Other · Clean up": opens Categories with Clean up Other. */
function OtherRow({ count }: { count: number }) {
  const openCleanUpOther = useNavStore((s) => s.openCleanUpOther);
  return (
    <div className="mx-5 mt-2 flex items-center justify-between border-t pt-3 text-[12px]" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
      <span>{count.toLocaleString()} in Other</span>
      <button type="button" aria-label="Clean up Other" onClick={openCleanUpOther} className="font-semibold" style={{ color: 'var(--accent)' }}>
        Clean up
      </button>
    </div>
  );
}

function NetThisMonth({ net, onLink }: { net: DashboardModel['net']; onLink: () => void }) {
  const total = net.incomeCents + net.spendCents;
  const incomeShare = total > 0 ? (net.incomeCents / total) * 100 : 0;
  return (
    <Card title="Net this month" linkLabel="Cash flow" onLink={onLink}>
      <div className="text-[22px] font-semibold">
        <Money cents={net.netCents} sign="negative" tone={net.netCents < 0 ? 'neg' : 'default'} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
        <DeltaBadge pct={percentChange(net.netCents, net.previousNetCents)} />
        <span>
          vs <Money cents={net.previousNetCents} sign="negative" className="font-semibold" /> in {net.previousLabel}
        </span>
      </div>
      <div className="mt-5 flex h-[6px] overflow-hidden rounded-full" style={{ background: 'var(--track)' }} aria-hidden="true">
        <div style={{ width: `${incomeShare}%`, background: 'var(--income)' }} />
        <div style={{ width: `${100 - incomeShare}%`, background: total > 0 ? 'var(--spend)' : 'transparent', opacity: 0.6 }} />
      </div>
      <div className="mt-4 flex gap-8 text-[12px]">
        <div>
          <div style={{ color: 'var(--muted)' }}>Income</div>
          <div className="mt-1 flex items-center gap-1.5 font-semibold">
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--income)' }} />
            <Money cents={net.incomeCents} tone="pos" />
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--muted)' }}>Spend</div>
          <div className="mt-1 flex items-center gap-1.5 font-semibold">
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--spend)' }} />
            <Money cents={net.spendCents} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function TopCategories({ groups, onLink }: { groups: TopGroup[]; onLink: () => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <Card title="Top categories" linkLabel="View all" onLink={onLink}>
      {groups.length === 0 ? (
        <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>No spending yet this month.</p>
      ) : (
        <div role="table" aria-label="Top categories" className="flex flex-col">
          {groups.map((g) => {
            const isOpen = open[g.group.id] ?? true;
            const single = g.children.length === 1 && g.children[0].category.name === g.group.name;
            return (
              <div key={g.group.id} role="rowgroup">
                <CategoryLine
                  depth={0}
                  name={g.group.name}
                  emoji={g.group.emoji}
                  color={g.group.color}
                  badge={single ? undefined : g.children.length}
                  spentCents={g.spentCents}
                  budgetCents={g.budgetCents}
                  toggle={single ? undefined : () => setOpen({ ...open, [g.group.id]: !isOpen })}
                  open={isOpen}
                />
                {!single && isOpen &&
                  g.children.map((c) => (
                    <CategoryLine
                      key={c.category.id}
                      depth={1}
                      name={c.category.name}
                      emoji={c.category.emoji}
                      color={c.category.color ?? g.group.color}
                      spentCents={c.spentCents}
                      budgetCents={c.budgetCents}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function NextTwoWeeks({ upcoming, categoriesById, onLink }: { upcoming: Recurring[]; categoriesById: DashboardData['categoriesById']; onLink: () => void }) {
  return (
    <Card title="Next two weeks" linkLabel="Recurrings" onLink={onLink}>
      {upcoming.length === 0 ? (
        <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>Nothing due in the next two weeks.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {upcoming.map((r) => {
            const [, m, d] = r.nextDate.split('-').map(Number);
            const cat = r.categoryId != null ? categoriesById[r.categoryId] : undefined;
            return (
              <li key={`${r.merchant}-${r.nextDate}`} className="flex h-[24px] items-center gap-3 text-[13px]">
                <span className="w-[52px] shrink-0" style={{ color: 'var(--muted)' }}>{SHORT_MONTHS[m - 1]} {d}</span>
                <CategoryIcon emoji={cat?.emoji} color={cat?.color} className="w-4" />
                <span className="min-w-0 flex-1 truncate">{cleanMerchant(r.merchant)}</span>
                <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{r.cadence[0].toUpperCase() + r.cadence.slice(1)}</span>
                <Money cents={Math.abs(r.typicalAmountCents)} className="w-[72px] text-right font-semibold" />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
