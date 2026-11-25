import { Money } from '@/components/money';
import { Change, ShareRing, YearRows } from './money-summary';
import type { CategoriesModel } from './categories-model';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The top of Categories: this month against the budget and last month, and the year. (Each month against the budget
 *  is in the detail pane beside it.) */
export function BudgetSummary({ model, today }: { model: CategoriesModel; today: string }) {
  const { summary, trend } = model;
  const left = summary.budgetCents - summary.spentCents;
  const over = summary.budgetCents > 0 && left < 0;
  return (
    <section aria-label="Budget summary" className="flex flex-col gap-5 rounded-[10px] border px-8 py-6" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="label-caps" style={{ color: 'var(--muted)' }}>{MONTH_NAMES[Number(today.slice(5, 7)) - 1]}</div>
          <div className="whitespace-nowrap text-[22px] font-semibold">
            <Money cents={summary.spentCents} decimals={false} />
            <span className="text-[14px] font-normal" style={{ color: 'var(--muted)' }}> spent</span>
          </div>
          {summary.budgetCents > 0 && (
            <div className="text-[12px]" style={{ color: over ? 'var(--warn)' : 'var(--muted)' }}>
              <Money cents={Math.abs(left)} decimals={false} /> {over ? 'over' : 'left'} of <Money cents={summary.budgetCents} decimals={false} /> budget
            </div>
          )}
          {summary.expectedCents > 0 && (
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              + <Money cents={summary.expectedCents} decimals={false} /> in bills expected
            </div>
          )}
          <div className="text-[12px]">
            <Change now={trend.months[trend.months.length - 1]?.paidCents ?? 0} before={trend.lastMonthSoFarCents} against={`${trend.lastMonthName} so far`} none={`Nothing in ${trend.lastMonthName} to compare`} />
          </div>
        </div>
        <ShareRing value={summary.spentCents} total={summary.budgetCents} label="Spent vs budget" word="spent" part="spent" color={over ? 'var(--warn)' : 'var(--pos)'} />
      </div>
      <YearRows label="Spending by year" trend={trend} year={Number(today.slice(0, 4))} />
    </section>
  );
}
