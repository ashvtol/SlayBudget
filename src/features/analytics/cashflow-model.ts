import { incomeOf, isRegular, spendOf, txTypeOf } from '@/lib/tx-type';
import { cleanMerchant } from '@/lib/merchant';
// Everything the Copilot-style Cash flow screen and its "View more" drawer show.
// Pure: built from a list of transactions so it can be tested without the UI.

import type { Category, CategoryGroup, Transaction } from '@/lib/types';

export type CashflowPeriod = 'month' | 'ytd' | 'last12' | 'last3' | 'last4w';
/** 'none' hides the comparison (Copilot lets you hide it). */
export type Comparison = 'previousPeriod' | 'previousYear' | 'none';

export interface Totals {
  incomeCents: number;
  spendCents: number;
  netCents: number;
}
export interface DayRange {
  from: string;
  to: string;
  label: string;
}
export interface MonthPoint extends Totals {
  month: string; // YYYY-MM
  label: string;
  /** Same month one year earlier, for the dashed comparison line. */
  previous: Totals;
}
export interface SpendSeries {
  name: string;
  color: string;
  /** The category's emoji, for the hover card (none for Uncategorized and Other). */
  emoji: string | null;
  values: number[];
}
export interface YearMetrics {
  year: number;
  spendCents: number;
  incomeCents: number;
  avgMonthlySpendCents: number;
  avgMonthlyIncomeCents: number;
}
export interface CategorySpend {
  name: string;
  color: string;
  emoji: string | null;
  spendCents: number;
}
export interface Cashflow {
  range: DayRange;
  previousRange: DayRange;
  current: Totals;
  previous: Totals;
  months: MonthPoint[];
  nowIndex: number;
  spendSeries: SpendSeries[];
  history: MonthPoint[];
  years: YearMetrics[];
  thisMonthCategories: CategorySpend[];
  /** Each history month's spend and income by category, largest first, with who it went to or came from. */
  sourcesByMonth: { spend: Record<string, Source[]>; income: Record<string, Source[]> };
  /** Every category with spend or income, including hidden ones, to choose which count. */
  categoriesUsed: { spend: CategoryChoice[]; income: CategoryChoice[] };
}

/** A category to count or hide: its id as text, or 'uncat'. */
export interface CategoryChoice {
  key: string;
  name: string;
  color: string;
  emoji: string | null;
}

/** A month's money in one category, with the top merchants or payers. */
export interface Source extends CategoryChoice {
  cents: number;
  people: { name: string; cents: number }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OTHER_COLOR = '#56677b';
const UNCATEGORIZED_COLOR = '#7e8a9c';
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Shift a YYYY-MM-DD by whole months, clamping the day to the target month. */
function shiftMonths(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysIn(ny, nm)))}`;
}

const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;
function shiftMonthKey(month: string, delta: number): string {
  return shiftMonths(`${month}-01`, delta).slice(0, 7);
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
const rangeOf = (from: string, to: string): DayRange => ({ from, to, label: `${dayLabel(from)} - ${dayLabel(to)}` });

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function periodRange(period: CashflowPeriod, compare: Comparison, today: string): DayRange & { previous: DayRange } {
  const [y, m] = today.split('-').map(Number);
  const byYear = compare === 'previousYear';
  if (period === 'last4w') {
    // 28 days ending today; the period before is the 28 days before that.
    const from = addDays(today, -27);
    const previous = byYear ? rangeOf(shiftMonths(from, -12), shiftMonths(today, -12)) : rangeOf(addDays(from, -28), addDays(from, -1));
    return { ...rangeOf(from, today), previous };
  }
  let from: string;
  let shift = 12;
  if (period === 'month') {
    from = `${y}-${pad(m)}-01`;
    if (!byYear) shift = 1;
  } else if (period === 'ytd') {
    from = `${y}-01-01`;
  } else if (period === 'last3') {
    from = shiftMonths(`${y}-${pad(m)}-01`, -2);
    if (!byYear) shift = 3;
  } else {
    from = shiftMonths(`${y}-${pad(m)}-01`, -11);
  }
  return { ...rangeOf(from, today), previous: rangeOf(shiftMonths(from, -shift), shiftMonths(today, -shift)) };
}

function totalsOf(txs: Transaction[]): Totals {
  let income = 0;
  let spend = 0;
  for (const t of txs) {
    income += incomeOf(t);
    spend += spendOf(t);
  }
  return { incomeCents: income, spendCents: spend, netCents: income - spend };
}

export function buildCashflow(input: {
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  today: string;
  period: CashflowPeriod;
  compare: Comparison;
  includeExcluded: boolean;
  /** Categories you chose not to count, as spend and as income (ids as text, or 'uncat'). */
  hidden?: { spend: string[]; income: string[] };
}): Cashflow {
  const { categories, groups, today, period, compare, includeExcluded } = input;
  const excluded = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
  const counted = includeExcluded ? input.transactions : input.transactions.filter((t) => t.categoryId == null || !excluded.has(t.categoryId));
  const keyOfTx = (t: Transaction) => (t.categoryId == null ? 'uncat' : String(t.categoryId));
  const hiddenSpend = new Set(input.hidden?.spend ?? []);
  const hiddenIncome = new Set(input.hidden?.income ?? []);
  const kindOf = (t: Transaction) => (txTypeOf(t) === 'income' ? 'income' : isRegular(t) ? 'spend' : null);
  const txs = counted.filter((t) => {
    const kind = kindOf(t);
    return kind === 'income' ? !hiddenIncome.has(keyOfTx(t)) : kind === 'spend' ? !hiddenSpend.has(keyOfTx(t)) : true;
  });
  const between = (from: string, to: string) => txs.filter((t) => t.postedOn >= from && t.postedOn <= to);

  const range = periodRange(period, compare, today);
  const [y, m, day] = today.split('-').map(Number);
  const thisMonth = monthKey(y, m);

  // Monthly buckets.
  const byMonth = new Map<string, Transaction[]>();
  for (const t of txs) {
    const k = t.postedOn.slice(0, 7);
    const list = byMonth.get(k);
    if (list) list.push(t);
    else byMonth.set(k, [t]);
  }
  const point = (month: string, first: boolean): MonthPoint => {
    const [my, mm] = month.split('-').map(Number);
    return {
      month,
      label: first ? `${MONTHS[mm - 1]} ${my}` : `${MONTHS[mm - 1]} '${String(my).slice(2)}`,
      ...totalsOf(byMonth.get(month) ?? []),
      previous: totalsOf(byMonth.get(shiftMonthKey(month, -12)) ?? []),
    };
  };
  const firstChartMonth = period === 'ytd' ? `${y}-01` : shiftMonthKey(thisMonth, -11);
  const chartKeys = Array.from({ length: 12 }, (_, i) => shiftMonthKey(firstChartMonth, i));
  const months = chartKeys.map((k, i) => point(k, i === 0));
  const history = Array.from({ length: 24 }, (_, i) => point(shiftMonthKey(thisMonth, i - 23), i === 0));

  // Spend stacked by category over the chart window.
  const catById = new Map(categories.map((c) => [c.id, c]));
  const groupColor = new Map(groups.map((g) => [g.id, g.color]));
  const keyOf = (t: Transaction) => (t.categoryId == null ? 'uncat' : String(t.categoryId));
  const describe = (key: string): Omit<CategorySpend, 'spendCents'> => {
    if (key === 'uncat') return { name: 'Uncategorized', color: UNCATEGORIZED_COLOR, emoji: null };
    const c = catById.get(Number(key));
    return { name: c?.name ?? 'Category', color: c?.color ?? (c ? groupColor.get(c.groupId) : undefined) ?? '#77a5f2', emoji: c?.emoji ?? null };
  };
  const perCat = new Map<string, number[]>();
  chartKeys.forEach((k, i) => {
    for (const t of byMonth.get(k) ?? []) {
      if (!isRegular(t)) continue;
      const key = keyOf(t);
      const row = perCat.get(key) ?? new Array<number>(12).fill(0);
      row[i] += spendOf(t);
      perCat.set(key, row);
    }
  });
  const ranked = [...perCat.entries()].sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0));
  const keep = ranked.length > 7 ? ranked.slice(0, 6) : ranked;
  const spendSeries: SpendSeries[] = keep.map(([key, values]) => ({ ...describe(key), values }));
  if (ranked.length > 7) {
    const other = new Array<number>(12).fill(0);
    for (const [, values] of ranked.slice(6)) values.forEach((v, i) => (other[i] += v));
    spendSeries.push({ name: 'Other', color: OTHER_COLOR, emoji: null, values: other });
  }

  // Per-year metrics: last year over 12 months, this year over months elapsed (by days).
  const yearTotals = (year: number) => totalsOf(between(`${year}-01-01`, `${year}-12-31`));
  const elapsed = m - 1 + day / daysIn(y, m);
  const years: YearMetrics[] = [y, y - 1].map((year) => {
    const t = yearTotals(year);
    const months = year === y ? elapsed : 12;
    return {
      year,
      spendCents: t.spendCents,
      incomeCents: t.incomeCents,
      avgMonthlySpendCents: Math.round(t.spendCents / months),
      avgMonthlyIncomeCents: Math.round(t.incomeCents / months),
    };
  });

  // A month's spend by category.
  const categoriesOf = (month: string): CategorySpend[] => {
    const monthSpend = new Map<string, number>();
    for (const t of byMonth.get(month) ?? []) {
      if (isRegular(t)) monthSpend.set(keyOf(t), (monthSpend.get(keyOf(t)) ?? 0) + spendOf(t));
    }
    return [...monthSpend.entries()].map(([key, spendCents]) => ({ ...describe(key), spendCents })).sort((a, b) => b.spendCents - a.spendCents);
  };
  const thisMonthCategories = categoriesOf(thisMonth);

  // Each month's spend and income by category, with the top three merchants or payers.
  const sourcesOf = (month: string, kind: 'spend' | 'income'): Source[] => {
    const byCat = new Map<string, Map<string, number>>();
    for (const t of byMonth.get(month) ?? []) {
      if (kindOf(t) !== kind) continue;
      const cents = kind === 'income' ? incomeOf(t) : spendOf(t);
      const people = byCat.get(keyOf(t)) ?? new Map<string, number>();
      const who = cleanMerchant(t.merchant || t.description);
      people.set(who, (people.get(who) ?? 0) + cents);
      byCat.set(keyOf(t), people);
    }
    return [...byCat.entries()]
      .map(([key, people]) => ({
        key,
        ...describe(key),
        cents: [...people.values()].reduce((a, b) => a + b, 0),
        people: [...people.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents).slice(0, 3),
      }))
      .sort((a, b) => b.cents - a.cents);
  };
  const sourcesByMonth = {
    spend: Object.fromEntries(history.map((h) => [h.month, sourcesOf(h.month, 'spend')])),
    income: Object.fromEntries(history.map((h) => [h.month, sourcesOf(h.month, 'income')])),
  };
  // Every category with money in the two years, hidden or not, largest first.
  const usedOf = (kind: 'spend' | 'income'): CategoryChoice[] => {
    const since = `${history[0].month}-01`;
    const totals = new Map<string, number>();
    for (const t of counted) {
      if (t.postedOn < since || kindOf(t) !== kind) continue;
      totals.set(keyOfTx(t), (totals.get(keyOfTx(t)) ?? 0) + (kind === 'income' ? incomeOf(t) : spendOf(t)));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => ({ key, ...describe(key) }));
  };
  const categoriesUsed = { spend: usedOf('spend'), income: usedOf('income') };

  return {
    range: { from: range.from, to: range.to, label: range.label },
    previousRange: range.previous,
    current: totalsOf(between(range.from, range.to)),
    previous: totalsOf(between(range.previous.from, range.previous.to)),
    months,
    nowIndex: chartKeys.indexOf(thisMonth),
    spendSeries,
    history,
    years,
    thisMonthCategories,
    sourcesByMonth,
    categoriesUsed,
  };
}
