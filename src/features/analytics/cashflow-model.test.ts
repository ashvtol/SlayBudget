import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { buildCashflow, periodRange } from './cashflow-model';

const groups: CategoryGroup[] = [
  { id: 1, name: 'Food', emoji: null, color: '#e8743b', sortOrder: 0 },
  { id: 9, name: 'Transfers', emoji: null, color: '#617598', sortOrder: 9 },
];
const cat = (id: number, name: string, color: string | null = null, excluded = false): Category => ({
  id, groupId: excluded ? 9 : 1, name, emoji: null, color, budgetCents: null, excluded, kind: excluded ? 'transfer' : 'expense', sortOrder: id, archived: false,
});
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number | null = null): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: amountCents > 0 ? 'income' : 'regular',
});
const TODAY = '2026-11-21';

describe('periodRange', () => {
  it('year to date, compared with the same dates last year', () => {
    const r = periodRange('ytd', 'previousPeriod', TODAY);
    expect(r.label).toBe('Jan 1, 2026 - Nov 21, 2026');
    expect(r.previous.label).toBe('Jan 1, 2025 - Nov 21, 2025');
  });

  it('this month, compared with the same days of last month or of last year', () => {
    expect(periodRange('month', 'previousPeriod', TODAY).previous.label).toBe('Oct 1, 2026 - Oct 21, 2026');
    expect(periodRange('month', 'previousYear', TODAY).previous.label).toBe('Nov 1, 2025 - Nov 21, 2025');
    expect(periodRange('month', 'previousPeriod', TODAY).label).toBe('Nov 1, 2026 - Nov 21, 2026');
  });

  it('last 12 months starts on the first of the month a year ago', () => {
    const r = periodRange('last12', 'previousPeriod', TODAY);
    expect(r.label).toBe('Dec 1, 2025 - Nov 21, 2026');
    expect(r.previous.label).toBe('Dec 1, 2024 - Nov 21, 2025');
  });

  it('clamps to shorter months', () => {
    expect(periodRange('month', 'previousPeriod', '2026-03-31').previous.label).toBe('Feb 1, 2026 - Feb 28, 2026');
  });
});

describe('buildCashflow totals', () => {
  const categories = [cat(10, 'Groceries', '#00ff00'), cat(99, 'Card Payment', null, true)];
  const txs = [
    tx('2026-02-01', 400000), // income
    tx('2026-03-05', -10000, 10),
    tx('2026-03-06', -185000, 99), // excluded
    tx('2025-04-01', -5000, 10), // last year, in the comparison span
    tx('2025-12-01', -7000, 10), // last year, outside the YTD comparison span
  ];

  it('sums income, spend and net for the period without excluded categories', () => {
    const c = buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'ytd', compare: 'previousPeriod', includeExcluded: false });
    expect(c.current).toEqual({ incomeCents: 400000, spendCents: 10000, netCents: 390000 });
    expect(c.previous).toEqual({ incomeCents: 0, spendCents: 5000, netCents: -5000 });
  });

  it('includes excluded spend when asked', () => {
    const c = buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'ytd', compare: 'previousPeriod', includeExcluded: true });
    expect(c.current.spendCents).toBe(195000);
  });
});

describe('buildCashflow chart months', () => {
  const categories = [cat(10, 'Groceries', '#00ff00')];
  const txs = [tx('2026-01-10', -1000, 10), tx('2026-11-02', 5000), tx('2025-01-15', -300, 10)];

  it('year to date shows Jan to Dec of this year with Now on the current month', () => {
    const c = buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'ytd', compare: 'previousPeriod', includeExcluded: false });
    expect(c.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(c.months[0].label).toBe('Jan 2026');
    expect(c.months[1].label).toBe("Feb '26");
    expect(c.nowIndex).toBe(10);
    expect(c.months[0]).toMatchObject({ spendCents: 1000, incomeCents: 0, netCents: -1000 });
    expect(c.months[10]).toMatchObject({ incomeCents: 5000, netCents: 5000 });
  });

  it('pairs each month with the same month a year earlier for the dashed line', () => {
    const c = buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'ytd', compare: 'previousPeriod', includeExcluded: false });
    expect(c.months[0].previous).toMatchObject({ spendCents: 300, netCents: -300 });
  });

  it('last 12 months ends on the current month', () => {
    const c = buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'last12', compare: 'previousPeriod', includeExcluded: false });
    expect(c.months[0].month).toBe('2025-12');
    expect(c.nowIndex).toBe(11);
  });
});

describe('buildCashflow spend by category', () => {
  const many = Array.from({ length: 8 }, (_, i) => cat(20 + i, `C${i}`, `#00000${i}`));
  const txs = many.map((c, i) => tx('2026-05-01', -(1000 * (i + 1)), c.id));

  it('stacks the top six categories and folds the rest into Other', () => {
    const c = buildCashflow({ transactions: txs, categories: many, groups, today: TODAY, period: 'ytd', compare: 'previousPeriod', includeExcluded: false });
    expect(c.spendSeries.map((s) => s.name)).toEqual(['C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'Other']);
    expect(c.spendSeries[0].color).toBe('#000007');
    expect(c.spendSeries[6].values[4]).toBe(3000); // C1 + C0 in May
  });

  it('uses the group color when a category has none, and Uncategorized for no category', () => {
    const c = buildCashflow({
      transactions: [tx('2026-05-01', -100, 30), tx('2026-05-02', -50)],
      categories: [cat(30, 'Plain', null)],
      groups,
      today: TODAY,
      period: 'ytd',
      compare: 'previousPeriod',
      includeExcluded: false,
    });
    expect(c.spendSeries.find((s) => s.name === 'Plain')?.color).toBe('#e8743b');
    expect(c.spendSeries.map((s) => s.name)).toContain('Uncategorized');
  });

  it("carries each category's emoji for the Spend hover card (none for Uncategorized and Other)", () => {
    const c = buildCashflow({
      transactions: [tx('2026-05-01', -100, 30), tx('2026-05-02', -50)],
      categories: [{ ...cat(30, 'Plain', null), emoji: '🛒' }],
      groups,
      today: TODAY,
      period: 'ytd',
      compare: 'previousPeriod',
      includeExcluded: false,
    });
    expect(c.spendSeries.map((s) => [s.name, s.emoji])).toEqual([['Plain', '🛒'], ['Uncategorized', null]]);
  });
});

describe('buildCashflow drawer details', () => {
  const categories = [cat(10, 'Groceries', '#00ff00'), cat(11, 'Rent', '#0000ff')];
  const txs = [
    tx('2025-03-01', -120000, 11),
    tx('2026-11-03', -2000, 10),
    tx('2026-11-04', -220000, 11),
    tx('2026-10-01', -1000, 10),
  ];
  const c = buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'ytd', compare: 'previousPeriod', includeExcluded: false });

  it('keeps 24 months of history ending this month', () => {
    expect(c.history).toHaveLength(24);
    expect(c.history[23].month).toBe('2026-11');
    expect(c.history[23].spendCents).toBe(222000);
  });

  it('reports per-year totals and average per month (partial current year by days)', () => {
    expect(c.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(c.years[1]).toMatchObject({ spendCents: 120000, avgMonthlySpendCents: 10000 });
    expect(c.years[1].avgMonthlyIncomeCents).toBe(Math.round(c.years[1].incomeCents / 12));
    // 2026: Jan-Oct full (10) + 21/30 of November
    expect(c.years[0].avgMonthlySpendCents).toBe(Math.round(223000 / (10 + 21 / 30)));
  });

  it("lists this month's spend by category, largest first", () => {
    expect(c.thisMonthCategories.map((x) => [x.name, x.spendCents])).toEqual([['Rent', 220000], ['Groceries', 2000]]);
  });

  it("keeps every history month's categories, with the current month matching this month's", () => {
    const months = Object.keys(c.sourcesByMonth.spend);
    expect(months).toEqual(c.history.map((h) => h.month));
    expect(c.sourcesByMonth.spend[months.at(-1)!].map((x) => [x.name, x.cents])).toEqual(c.thisMonthCategories.map((x) => [x.name, x.spendCents]));
    for (const h of c.history) {
      expect(c.sourcesByMonth.spend[h.month].reduce((s, x) => s + x.cents, 0)).toBe(h.spendCents);
      expect(c.sourcesByMonth.income[h.month].reduce((s, x) => s + x.cents, 0)).toBe(h.incomeCents);
    }
  });
});

describe('more Cash flow ranges (Copilot)', () => {
  it('covers the last 3 months, compared with the 3 months before or a year earlier', () => {
    const r = periodRange('last3', 'previousPeriod', '2026-11-21');
    expect(r.label).toBe('Sep 1, 2026 - Nov 21, 2026');
    expect(r.previous.label).toBe('Jun 1, 2026 - Aug 21, 2026');
    expect(periodRange('last3', 'previousYear', '2026-11-21').previous.label).toBe('Sep 1, 2025 - Nov 21, 2025');
  });

  it('covers the last 4 weeks (28 days), compared with the 28 days before', () => {
    const r = periodRange('last4w', 'previousPeriod', '2026-11-21');
    expect(r.label).toBe('Oct 25, 2026 - Nov 21, 2026');
    expect(r.previous.label).toBe('Sep 27, 2026 - Oct 24, 2026');
    expect(periodRange('last4w', 'previousYear', '2026-11-21').previous.label).toBe('Oct 25, 2025 - Nov 21, 2025');
  });

  it('crosses a year boundary for the last 4 weeks', () => {
    expect(periodRange('last4w', 'previousPeriod', '2026-01-10').label).toBe('Dec 14, 2025 - Jan 10, 2026');
  });
});

describe('choosing which categories Cash flow counts, and who each month came from', () => {
  const categories = [
    cat(10, 'Groceries', '#00ff00'),
    cat(20, 'Restaurants', '#ff0000'),
    { ...cat(30, 'Paycheck'), kind: 'income' as const },
    { ...cat(31, 'Reimbursements'), kind: 'income' as const },
  ];
  const row = (postedOn: string, cents: number, categoryId: number, merchant: string) => ({ ...tx(postedOn, cents, categoryId), merchant, description: merchant.toUpperCase() });
  const txs = [
    row('2026-11-01', 400000, 30, 'acme corp'),
    row('2026-11-15', 400000, 30, 'acme corp'),
    row('2026-11-10', 25000, 31, 'work expenses'),
    row('2026-11-03', -6000, 10, 'whole foods'),
    row('2026-11-05', -2000, 10, 'trader joes'),
    row('2026-11-07', -4500, 20, 'sweetgreen'),
  ];
  const build = (hidden?: { spend: string[]; income: string[] }) =>
    buildCashflow({ transactions: txs, categories, groups, today: TODAY, period: 'month', compare: 'previousPeriod', includeExcluded: false, hidden });

  it('lists each month\'s categories with who the money went to or came from, largest first', () => {
    const c = build();
    expect(c.sourcesByMonth.income['2026-11'].map((x) => [x.name, x.cents, x.people.map((p) => `${p.name} ${p.cents}`)])).toEqual([
      ['Paycheck', 800000, ['Acme Corp 800000']],
      ['Reimbursements', 25000, ['Work Expenses 25000']],
    ]);
    expect(c.sourcesByMonth.spend['2026-11'].map((x) => [x.name, x.cents, x.people.map((p) => p.name)])).toEqual([
      ['Groceries', 8000, ['Whole Foods', 'Trader Joes']],
      ['Restaurants', 4500, ['Sweetgreen']],
    ]);
  });

  it('leaves a hidden category out of the totals, the charts and net income, but still offers it to choose', () => {
    const c = build({ spend: ['20'], income: ['31'] });
    expect(c.current).toMatchObject({ incomeCents: 800000, spendCents: 8000, netCents: 792000 });
    expect(c.history.at(-1)).toMatchObject({ incomeCents: 800000, spendCents: 8000 });
    expect(c.sourcesByMonth.income['2026-11'].map((x) => x.name)).toEqual(['Paycheck']);
    expect(c.categoriesUsed.income.map((x) => [x.key, x.name])).toEqual([['30', 'Paycheck'], ['31', 'Reimbursements']]);
    expect(c.categoriesUsed.spend.map((x) => x.name)).toEqual(['Groceries', 'Restaurants']);
  });
});
