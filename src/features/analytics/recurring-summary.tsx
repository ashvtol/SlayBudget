import { useState } from 'react';
import { Money } from '@/components/money';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/features/currency/currency-store';
import { BudgetHistoryChart } from '@/features/charts/svg/budget-history-chart';
import { InfoButton } from '@/features/transactions/statement-box';
import { Change, ShareRing, YearRows, monthLabel } from './money-summary';
import type { RecurringsModel } from './recurrings-model';

/** The top of Recurrings: this month (paid, left, against last month), 12 months on the Categories chart against the
 *  average, and the year against last. */
export function RecurringSummary({ model, today }: { model: RecurringsModel; today: string }) {
  const { summary, trend } = model;
  const currency = useCurrencyStore((s) => s.displayCurrency);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<number | null>(null);
  const [legend, setLegend] = useState(false);
  const thisMonthPaid = trend.months[trend.months.length - 1]?.paidCents ?? 0;
  // The average of the months with bills is the chart's line, as a budget is on Categories.
  const withBills = trend.months.filter((m) => m.paidCents > 0);
  const avg = withBills.length ? Math.round(withBills.reduce((s, m) => s + m.paidCents, 0) / withBills.length) : 0;
  const chartMonths = trend.months.map((m) => ({ month: m.month, spentCents: m.paidCents, budgetCents: avg > 0 ? avg : null }));
  const shown = hovered ?? (picked ? trend.months.findIndex((m) => m.month === picked) : -1);
  return (
    <section aria-label="Recurring summary" className="flex flex-col gap-5 rounded-[10px] border px-8 py-6" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="label-caps" style={{ color: 'var(--muted)' }}>This month</div>
          <div className="whitespace-nowrap text-[22px] font-semibold">
            <Money cents={summary.paidCents} decimals={false} />
            <span className="text-[14px] font-normal" style={{ color: 'var(--muted)' }}> paid</span>
          </div>
          <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
            <Money cents={summary.leftToPayCents} decimals={false} /> left to pay
          </div>
          <div className="text-[12px]">
            <Change now={thisMonthPaid} before={trend.lastMonthSoFarCents} against={`${trend.lastMonthName} so far`} none={`Nothing in ${trend.lastMonthName} to compare`} />
          </div>
        </div>
        <ShareRing value={summary.paidCents} total={summary.paidCents + summary.leftToPayCents} label="Paid vs due this month" word="paid" part="paid" color="var(--pos)" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="label-caps" style={{ color: 'var(--muted)' }}>Last 12 months</div>
          <InfoButton label="What the colors mean" title="What the colors mean" open={legend} onToggle={() => setLegend(!legend)} />
          <div className="ml-auto text-[12px]" style={{ color: 'var(--muted)' }}>
            {shown >= 0
              ? `${monthLabel(trend.months[shown].month)}: ${formatMoney(trend.months[shown].paidCents, currency)}`
              : avg > 0 && `Average ${formatMoney(avg, currency)} a month`}
          </div>
        </div>
        {legend && (
          <p className="m-0 rounded-md border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--line)', background: 'var(--bg)', color: 'var(--muted)' }}>
            <span style={{ color: 'var(--pos)' }}>Green</span>: at or under the average.{' '}
            <span style={{ color: 'var(--warn)' }}>Orange</span>: above the average.{' '}
            <span style={{ color: 'var(--current)' }}>Yellow</span>: this month so far. The line and its tag are the average of the
            months with bills. Click a month to see its total.
          </p>
        )}
        <BudgetHistoryChart
          label="What bills cost each month, last 12 months"
          months={chartMonths}
          picked={picked}
          onPick={(m) => setPicked(picked === m ? undefined : m)}
          onHover={setHovered}
          height={110}
        />
      </div>
      <YearRows label="Bills by year" trend={trend} year={Number(today.slice(0, 4))} />
    </section>
  );
}
