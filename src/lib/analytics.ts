import { incomeOf, isRegular, spendOf } from './tx-type';
// Pure analytics over in-memory transactions, mirroring crates/core/src/analytics.
// The desktop app runs the Rust versions over SQLite; these back the memory IPC
// double and give the UI a tested, dependency-free implementation for charts.

import type {
  BudgetStatus,
  CashFlow,
  CategoryMeta,
  CategoryTotal,
  MonthlyTotal,
  Recurring,
  TimeRange,
  Transaction,
} from './types';

export interface DateRange {
  from: string | null; // YYYY-MM-DD inclusive
  to: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parse(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Shift a date by whole months, clamping the day to the target month length. */
export function shiftMonths(date: string, delta: number): string {
  const d = parse(date);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + delta;
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), lastDayOfMonth(year, month0 + 1));
  return ymd(new Date(Date.UTC(year, month0, day)));
}
function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function dayDiff(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}

export function resolveRange(range: TimeRange, today: string): DateRange {
  switch (range) {
    case 'week': return { from: addDays(today, -6), to: today };
    case 'month': return { from: shiftMonths(today, -1), to: today };
    case 'threeMonths': return { from: shiftMonths(today, -3), to: today };
    case 'sixMonths': return { from: shiftMonths(today, -6), to: today };
    case 'ytd': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'year': return { from: shiftMonths(today, -12), to: today };
    case 'all': return { from: null, to: null };
  }
}

function inRange(t: Transaction, r: DateRange): boolean {
  if (r.from && t.postedOn < r.from) return false;
  if (r.to && t.postedOn > r.to) return false;
  return true;
}

/** Split-aware effective rows: drop split parents, keep their children. */
function effectiveRows(txs: Transaction[], children: Map<number, Transaction[]>): Transaction[] {
  const out: Transaction[] = [];
  for (const t of txs) {
    const kids = children.get(t.id);
    if (kids && kids.length) out.push(...kids);
    else out.push(t);
  }
  return out;
}

export function monthlyTotals(txs: Transaction[], range: DateRange): MonthlyTotal[] {
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const t of txs) {
    if (!inRange(t, range)) continue;
    const m = t.postedOn.slice(0, 7);
    const acc = byMonth.get(m) ?? { income: 0, expense: 0 };
    acc.income += incomeOf(t);
    acc.expense += spendOf(t);
    byMonth.set(m, acc);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, incomeCents: v.income, expenseCents: v.expense, netCents: v.income - v.expense }));
}

export function categoryTotals(
  txs: Transaction[],
  range: DateRange,
  children: Map<number, Transaction[]>,
): CategoryTotal[] {
  const rows = effectiveRows(txs, children).filter((t) => isRegular(t) && inRange(t, range));
  const byCat = new Map<number | null, { total: number; count: number }>();
  for (const t of rows) {
    const key = t.categoryId;
    const acc = byCat.get(key) ?? { total: 0, count: 0 };
    acc.total += spendOf(t);
    acc.count += 1;
    byCat.set(key, acc);
  }
  return [...byCat.entries()]
    .map(([categoryId, v]) => ({ categoryId, totalCents: v.total, count: v.count }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export function budgetStatus(
  txs: Transaction[],
  categories: CategoryMeta[],
  today: string,
  children: Map<number, Transaction[]>,
): BudgetStatus[] {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const range: DateRange = { from: firstOfMonth, to: today };
  const spent = new Map<number | null, number>();
  for (const c of categoryTotals(txs, range, children)) spent.set(c.categoryId, c.totalCents);

  const [y, m] = today.split('-').map(Number);
  const day = Number(today.slice(8, 10));
  const totalDays = lastDayOfMonth(y, m);

  return categories
    .filter((c) => c.budgetCents != null && c.budgetCents > 0 && !c.excluded)
    .map((c) => {
      const spentCents = spent.get(c.id) ?? 0;
      const budgetCents = c.budgetCents as number;
      return {
        categoryId: c.id,
        budgetCents,
        spentCents,
        remainingCents: budgetCents - spentCents,
        projectedCents: day > 0 ? Math.trunc((spentCents * totalDays) / day) : spentCents,
        overBudget: spentCents > budgetCents,
      };
    })
    .sort((a, b) => b.spentCents - a.spentCents);
}

function flowBetween(txs: Transaction[], from: string, to: string) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.postedOn < from || t.postedOn > to) continue;
    income += incomeOf(t);
    expense += spendOf(t);
  }
  return { incomeCents: income, expenseCents: expense, netCents: income - expense };
}

export function cashFlow(txs: Transaction[], range: DateRange): CashFlow {
  // An open range ("All") spans the data itself: first to last transaction (as the core does).
  const days = txs.map((t) => t.postedOn).sort();
  const to = range.to ?? days[days.length - 1] ?? '1970-01-01';
  const from = range.from ?? days[0] ?? to;
  const span = dayDiff(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -span);
  const current = flowBetween(txs, from, to);
  const previous = flowBetween(txs, prevFrom, prevTo);
  return { current, previous, netDeltaCents: current.netCents - previous.netCents };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : Math.trunc((s[n / 2 - 1] + s[n / 2]) / 2);
}

function classifyCadence(gap: number): Recurring['cadence'] | null {
  if (gap >= 5 && gap <= 9) return 'weekly';
  if (gap >= 12 && gap <= 16) return 'biweekly';
  if (gap >= 26 && gap <= 33) return 'monthly';
  if (gap >= 83 && gap <= 97) return 'quarterly';
  if (gap >= 350 && gap <= 380) return 'yearly';
  return null;
}

export function detectRecurring(txs: Transaction[]): Recurring[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amountCents >= 0 || !t.merchant) continue;
    const list = byMerchant.get(t.merchant) ?? [];
    list.push(t);
    byMerchant.set(t.merchant, list);
  }

  const out: Recurring[] = [];
  for (const [merchant, all] of byMerchant) {
    all.sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id - b.id);
    // The same charge twice on one day counts once (a zero-day gap breaks the cadence).
    const series = all.filter((t, i) => i === 0 || t.postedOn !== all[i - 1].postedOn || t.amountCents !== all[i - 1].amountCents);
    if (series.length < 3) continue;
    const gaps = series.slice(1).map((t, i) => dayDiff(series[i].postedOn, t.postedOn));
    const medianGap = median(gaps);
    const cadence = classifyCadence(medianGap);
    if (!cadence) continue;
    const tol = Math.max(Math.trunc(medianGap / 4), 4);
    if (gaps.filter((g) => Math.abs(g - medianGap) <= tol).length < gaps.length * 0.6) continue;

    const amounts = series.map((t) => -t.amountCents);
    const typical = median(amounts);
    if (typical <= 0) continue;
    const band = Math.max(Math.trunc((typical / 100) * 35), 500);
    if (amounts.filter((a) => Math.abs(a - typical) <= band).length < amounts.length * 0.6) continue;

    const counts = new Map<number | null, number>();
    for (const t of series) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const last = series[series.length - 1].postedOn;
    const nextDate =
      cadence === 'weekly' ? addDays(last, 7)
      : cadence === 'biweekly' ? addDays(last, 14)
      : cadence === 'monthly' ? shiftMonths(last, 1)
      : cadence === 'quarterly' ? shiftMonths(last, 3)
      : shiftMonths(last, 12);

    out.push({ merchant, categoryId, typicalAmountCents: typical, cadence, lastDate: last, nextDate, occurrences: series.length });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.merchant.localeCompare(b.merchant));
}
