import { useScreen } from '@/app/shell/screen';
import { useEffect, useMemo, useState } from 'react';
import { Switch } from '@/components/switch';
import { Page } from '@/app/shell/page';
import { Card } from '@/components/card';
import { Drawer } from '@/components/drawer';
import { Money } from '@/components/money';
import { DeltaBadge, percentChange } from '@/components/delta-badge';
import { monthInitial } from '@/features/charts/budget-history';
import { BarChart } from '@/features/charts/svg/bar-chart';
import { StackedBars } from '@/features/charts/svg/stacked-bars';
import { ipc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { useAnalyticsStore } from './analytics-store';
import { buildCashflow, type Cashflow, type CashflowPeriod, type Comparison } from './cashflow-model';
import { Select as PopUp } from '@/components/select';

const PERIODS: { id: CashflowPeriod; label: string }[] = [
  { id: 'ytd', label: 'Year to date' },
  { id: 'month', label: 'This month' },
  { id: 'last12', label: 'Last 12 months' },
  { id: 'last3', label: 'Last 3 months' },
  { id: 'last4w', label: 'Last 4 weeks' },
];
const COMPARISONS: { id: Comparison; label: string }[] = [
  { id: 'previousPeriod', label: 'Previous period' },
  { id: 'previousYear', label: 'Previous year' },
  { id: 'none', label: 'No comparison' },
];

type Kind = 'net' | 'spend' | 'income';
const KIND_TITLE: Record<Kind, string> = { net: 'Net income', spend: 'Spend', income: 'Income' };

const pad = (n: number) => String(n).padStart(2, '0');

/** Three years of transactions (enough for 24 months of history and their comparisons). */
function useCashflowSource() {
  const profileId = useProfileStore((s) => s.activeProfileId);
  const today = useAnalyticsStore((s) => s.today);
  const { activation } = useScreen();
  const [src, setSrc] = useState<{ transactions: Transaction[]; categories: Category[]; groups: CategoryGroup[] } | null>(null);
  useEffect(() => {
    let live = true;
    const [y, m] = today.split('-').map(Number);
    const from = `${y - 3}-${pad(m)}-01`;
    void Promise.all([ipc().listTransactions({ profileId, from, to: today }), ipc().listCategories(), ipc().listCategoryGroups()]).then(
      ([transactions, categories, groups]) => live && setSrc({ transactions, categories, groups }),
    );
    return () => {
      live = false;
    };
  }, [profileId, today, activation]);
  return { src, today };
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <PopUp aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </PopUp>
  );
}

export function CashflowPage() {
  const { src, today } = useCashflowSource();
  const [period, setPeriod] = useState<CashflowPeriod>('ytd');
  const [compare, setCompare] = useState<Comparison>('previousPeriod');
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [drawer, setDrawer] = useState<Kind | null>(null);

  const cf = useMemo(
    () => (src ? buildCashflow({ ...src, today, period, compare, includeExcluded }) : null),
    [src, today, period, compare, includeExcluded],
  );

  return (
    <Page
      title="Cash flow"
      toolbar={
        <>
          <Select label="Period" value={period} options={PERIODS} onChange={setPeriod} />
          {cf && <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{cf.range.label}</span>}
          <span className="ml-2 text-[12px]" style={{ color: 'var(--muted)' }}>compared to</span>
          <Select label="Compared to" value={compare} options={COMPARISONS} onChange={setCompare} />
        </>
      }
      actions={<Switch label="Show excluded spend" checked={includeExcluded} onChange={setIncludeExcluded} />}
    >
      {cf && (
        <>
          <FlowCard compare={compare !== 'none'} kind="net" cf={cf} onMore={() => setDrawer('net')} />
          <div className="grid grid-cols-2 gap-8">
            <FlowCard compare={compare !== 'none'} kind="spend" cf={cf} onMore={() => setDrawer('spend')} />
            <FlowCard compare={compare !== 'none'} kind="income" cf={cf} onMore={() => setDrawer('income')} />
          </div>
          <Drawer open={drawer != null} title={drawer ? KIND_TITLE[drawer] : ''} onClose={() => setDrawer(null)}>
            {drawer && <FlowDetails kind={drawer} cf={cf} />}
          </Drawer>
        </>
      )}
    </Page>
  );
}

const valueOf = (kind: Kind, t: { incomeCents: number; spendCents: number; netCents: number }) =>
  kind === 'net' ? t.netCents : kind === 'spend' ? t.spendCents : t.incomeCents;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep 2026" from "2026-09". */
const monthTitle = (month: string) => `${SHORT_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** "2025-09" from "2026-09". */
const yearBefore = (month: string) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;

function FlowCard({ kind, cf, onMore, compare }: { kind: Kind; cf: Cashflow; onMore: () => void; compare: boolean }) {
  const [hovered, setHovered] = useState<number | null>(null);
  // While you scrub across the chart the header changes at once (no rolling digits), until the data changes.
  const [scrubbed, setScrubbed] = useState(false);
  const [seen, setSeen] = useState(cf);
  if (seen !== cf) {
    setSeen(cf);
    setScrubbed(false);
    setHovered(null);
  }
  const month = hovered != null ? cf.months[hovered] : undefined;
  const header = month
    ? { label: monthTitle(month.month), current: valueOf(kind, month), previous: valueOf(kind, month.previous), previousLabel: monthTitle(yearBefore(month.month)) }
    : { label: cf.range.label, current: valueOf(kind, cf.current), previous: valueOf(kind, cf.previous), previousLabel: cf.previousRange.label };
  const prev = compare ? cf.months.map((m) => valueOf(kind, m.previous)) : undefined;
  const onHover = (i: number | null) => {
    setHovered(i);
    if (i != null) setScrubbed(true);
  };

  return (
    <Card title={KIND_TITLE[kind]} linkLabel="View more" onLink={onMore}>
      <div className="text-[12px]" style={{ color: 'var(--muted)' }}>{header.label}</div>
      <div className="mt-1 text-[22px] font-semibold">
        <Money cents={header.current} sign="negative" tone={kind === 'spend' ? 'default' : header.current < 0 ? 'neg' : 'pos'} still={scrubbed} />
      </div>
      {compare && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
          <DeltaBadge pct={percentChange(header.current, header.previous)} upIsGood={kind !== 'spend'} />
          <span>
            vs <Money cents={header.previous} sign="negative" className="font-semibold" still={scrubbed} /> in {header.previousLabel}
          </span>
        </div>
      )}
      <div className="mt-4">
        {kind === 'spend' ? (
          <StackedBars
            label="Spend by month"
            labels={cf.months.map((m) => m.label)}
            titles={cf.months.map((m) => monthTitle(m.month))}
            series={cf.spendSeries}
            previous={prev}
            nowIndex={cf.nowIndex}
            height={150}
            onHover={onHover}
          />
        ) : (
          <BarChart
            label={`${KIND_TITLE[kind]} by month`}
            valueLabel={KIND_TITLE[kind]}
            labels={cf.months.map((m) => m.label)}
            values={cf.months.map((m) => valueOf(kind, m))}
            color={kind === 'net' ? 'sign' : 'var(--income)'}
            previous={prev}
            nowIndex={cf.nowIndex}
            height={kind === 'net' ? 150 : 130}
            onHover={onHover}
          />
        )}
      </div>
    </Card>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function FlowDetails({ kind, cf }: { kind: Kind; cf: Cashflow }) {
  const last = cf.history[cf.history.length - 1];
  const [, mm] = last.month.split('-').map(Number);
  return (
    <div className="flex flex-col gap-7 px-8 py-6">
      <div className="flex items-start justify-between">
        <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>Monthly {KIND_TITLE[kind].toLowerCase()} over the last two years</p>
        <div className="text-right">
          <div className="text-[12px] font-semibold">{MONTH_NAMES[mm - 1]} {last.month.slice(0, 4)}</div>
          <div className="text-[18px] font-semibold">
            <Money cents={valueOf(kind, last)} sign="negative" />
          </div>
        </div>
      </div>
      <BarChart
        label={`${KIND_TITLE[kind]} over two years`}
        valueLabel={KIND_TITLE[kind]}
        labels={cf.history.map((m) => monthInitial(m.month))}
        values={cf.history.map((m) => valueOf(kind, m))}
        color={kind === 'net' ? 'sign' : kind === 'spend' ? 'var(--spend)' : 'var(--income)'}
        nowIndex={cf.history.length - 1}
        height={130}
      />

      <table aria-label="Key metrics" className="w-full border-t pt-4 text-[13px]" style={{ borderColor: 'var(--line)' }}>
        <thead>
          <tr style={{ color: 'var(--muted)' }}>
            <th className="py-3 text-left font-semibold">Key metrics</th>
            <th className="py-3 text-right font-medium">{kind === 'income' ? 'Income' : 'Spend'} per year</th>
            <th className="py-3 text-right font-medium">Avg monthly spend</th>
          </tr>
        </thead>
        <tbody>
          {cf.years.map((y) => (
            <tr key={y.year}>
              <td className="py-1.5" style={{ color: 'var(--accent)' }}>{y.year}</td>
              <td className="py-1.5 text-right font-semibold"><Money cents={kind === 'income' ? y.incomeCents : y.spendCents} /></td>
              <td className="py-1.5 text-right font-semibold"><Money cents={y.avgMonthlySpendCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t pt-5" style={{ borderColor: 'var(--line)' }}>
        <div className="mb-3 text-[13px]" style={{ color: 'var(--muted)' }}>Categories</div>
        <ul aria-label="Categories" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {cf.thisMonthCategories.map((c) => (
            <li key={c.name} className="flex h-[26px] items-center gap-2.5 text-[13px]">
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: c.color }} />
              <span
                className="rounded-md px-2 py-0.5 text-[12px] font-semibold"
                style={{ background: `color-mix(in srgb, ${c.color} 26%, transparent)`, color: `color-mix(in srgb, ${c.color} var(--pill-tint), var(--pill-ink))` }}
              >
                {c.emoji ? `${c.emoji} ` : ''}
                {c.name}
              </span>
              <Money cents={c.spendCents} className="ml-auto font-semibold" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
