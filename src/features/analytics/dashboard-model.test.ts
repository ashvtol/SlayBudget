import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Recurring, Transaction } from '@/lib/types';
import { buildDashboard } from './dashboard-model';

const groups: CategoryGroup[] = [
  { id: 1, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 0 },
  { id: 2, name: 'Home', emoji: '🏠', color: '#4c85ee', sortOrder: 1 },
  { id: 3, name: 'Transfers', emoji: '🔁', color: '#617598', sortOrder: 2 },
];
const cat = (id: number, groupId: number, name: string, budgetCents: number | null, excluded = false): Category => ({
  id, groupId, name, emoji: null, color: null, budgetCents, excluded, kind: excluded ? 'transfer' : 'expense', sortOrder: id, archived: false,
});
const categories = [
  cat(10, 1, 'Groceries', 30000),
  cat(11, 1, 'Restaurants', 20000),
  cat(12, 1, 'Coffee', null),
  cat(20, 2, 'Rent', 220000),
  cat(99, 3, 'Card Payment', null, true),
];
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number | null): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: amountCents > 0 ? 'income' : 'regular',
});

const today = '2026-11-05';
const txs = [
  tx('2026-10-02', -300, 10), // previous period (Oct 1-5)
  tx('2026-10-30', -999, 10), // previous month, outside the comparison span
  tx('2026-11-01', -1000, 10),
  tx('2026-11-03', -500, 11),
  tx('2026-11-03', 9000, null), // income
  tx('2026-11-04', -200, 99), // excluded
  tx('2026-11-04', -50, 12), // no budget
  tx('2026-11-05', -70, null), // uncategorized spend
];
const recurring = (merchant: string, nextDate: string): Recurring => ({
  merchant, categoryId: null, typicalAmountCents: -1000, cadence: 'monthly', lastDate: '2026-10-01', nextDate, occurrences: 3,
});

describe('buildDashboard: monthly spending', () => {
  const d = buildDashboard({ transactions: txs, categories, groups, recurring: [], today });

  it('sums money out this month, skipping income, excluded categories and earlier months', () => {
    expect(d.month.spentCents).toBe(1620);
  });

  it('gives a cumulative spend for each day so far', () => {
    expect(d.month.daily).toEqual([1000, 1000, 1500, 1550, 1620]);
    expect(d.month.daysInMonth).toBe(30);
  });

  it('budget is the sum of budgets of counted categories; left is budget minus spent', () => {
    expect(d.month.budgetCents).toBe(270000);
    expect(d.month.leftCents).toBe(270000 - 1620);
  });
});

describe('buildDashboard: net this month', () => {
  const d = buildDashboard({ transactions: txs, categories, groups, recurring: [], today });

  it('nets income against spending this month', () => {
    expect(d.net).toMatchObject({ incomeCents: 9000, spendCents: 1620, netCents: 7380 });
  });

  it('compares with the same days of last month', () => {
    expect(d.net.previousNetCents).toBe(-300);
    expect(d.net.previousLabel).toBe('Oct 1 - Oct 5, 2026');
  });
});

describe('buildDashboard: top categories', () => {
  const d = buildDashboard({ transactions: txs, categories, groups, recurring: [], today });

  it('groups spend by category group, largest first, without excluded or uncategorized', () => {
    expect(d.topCategories.map((g) => g.group.name)).toEqual(['Food & Drink', 'Home']);
  });

  it('sums children into the group and keeps budgeted categories even with no spend', () => {
    const food = d.topCategories[0];
    expect(food.spentCents).toBe(1550);
    expect(food.budgetCents).toBe(50000);
    expect(food.children.map((c) => [c.category.name, c.spentCents])).toEqual([['Groceries', 1000], ['Restaurants', 500], ['Coffee', 50]]);
    const home = d.topCategories[1];
    expect(home.spentCents).toBe(0);
    expect(home.children.map((c) => c.category.name)).toEqual(['Rent']);
  });
});

describe('buildDashboard: next two weeks', () => {
  it('lists recurring charges due from today through 14 days out, soonest first', () => {
    const d = buildDashboard({
      transactions: [],
      categories,
      groups,
      recurring: [recurring('Netflix', '2026-11-15'), recurring('Rent', '2026-12-01'), recurring('Spotify', '2026-11-05'), recurring('Gym', '2026-11-19')],
      today,
    });
    expect(d.upcoming.map((r) => r.merchant)).toEqual(['Spotify', 'Netflix', 'Gym']);
  });
});

describe('buildDashboard: comparison period edges', () => {
  it('compares January with December of the previous year', () => {
    const d = buildDashboard({ transactions: [], categories, groups, recurring: [], today: '2026-01-10' });
    expect(d.net.previousLabel).toBe('Dec 1 - Dec 10, 2025');
  });
  it('clamps to the end of a shorter previous month', () => {
    const d = buildDashboard({ transactions: [], categories, groups, recurring: [], today: '2026-03-31' });
    expect(d.net.previousLabel).toBe('Feb 1 - Feb 28, 2026');
    expect(d.month.daily).toHaveLength(31);
  });
});

describe('buildDashboard: next two weeks skips excluded', () => {
  it('leaves out recurring charges in excluded categories', () => {
    const d = buildDashboard({
      transactions: [],
      categories,
      groups,
      recurring: [{ ...recurring('Amex Payment', '2026-11-10'), categoryId: 99 }, recurring('Netflix', '2026-11-15')],
      today,
    });
    expect(d.upcoming.map((r) => r.merchant)).toEqual(['Netflix']);
  });
});

describe('buildDashboard with a budget plan', () => {
  it("counts this month's overrides and a shared group budget once", () => {
    const plan = { months: [{ categoryId: 20, month: '2026-11', amountCents: 250000 }], groups: [{ groupId: 1, amountCents: 60000 }], rollovers: [] };
    const m = buildDashboard({ transactions: txs, categories, groups, recurring: [], today, plan });
    expect(m.month.budgetCents).toBe(250000 + 60000);
    const food = m.topCategories.find((g) => g.group.id === 1)!;
    expect(food.budgetCents).toBe(60000);
    expect(food.children.every((c) => c.budgetCents == null)).toBe(true);
  });
});

describe('buildDashboard free to spend (Copilot)', () => {
  const recurringRent = (nextDate: string): Recurring => ({
    merchant: 'landlord', name: 'Rent', cadence: 'monthly', typicalAmountCents: 220000, nextDate, lastDate: '2026-10-01', count: 3,
    categoryId: 20, saved: { id: 1, status: 'active', name: 'Rent', matchKind: 'merchant', pattern: 'landlord', minCents: 210000, maxCents: 230000, frequency: 'monthly', dayOfMonth: 1, categoryId: 20 },
  } as unknown as Recurring);

  it('sets this month\'s bills aside: paid ones and ones still due', () => {
    const paid = { ...tx('2026-11-01', -220000, 20), recurringId: 1 };
    const coffee = tx('2026-11-02', -1500, 12);
    const m = buildDashboard({ transactions: [paid, coffee], categories, groups, recurring: [], today, plan: undefined });
    // Budget 300 + 200 + 2200 = 2700; rent (paid, recurring) is set aside.
    expect(m.month.billsCents).toBe(220000);
    expect(m.month.freeBudgetCents).toBe(50000);
    expect(m.month.freeLeftCents).toBe(50000 - 1500);
    expect(m.month.daily.at(-1)).toBe(1500);

    const due = buildDashboard({ transactions: [coffee], categories, groups, recurring: [recurringRent('2026-11-20')], today, plan: undefined });
    expect(due.month.billsCents).toBe(220000);
    expect(due.month.freeLeftCents).toBe(50000 - 1500);
    // A bill due next month is not set aside.
    const later = buildDashboard({ transactions: [coffee], categories, groups, recurring: [recurringRent('2026-12-01')], today, plan: undefined });
    expect(later.month.billsCents).toBe(0);
  });
});

describe('buildDashboard weekly bills', () => {
  it('sets aside every weekly charge still due this month', () => {
    const weekly = { merchant: 'gym', name: 'Gym', cadence: 'weekly', typicalAmountCents: 1000, nextDate: '2026-11-08', lastDate: '2026-11-01', occurrences: 3, categoryId: 10, saved: { status: 'active' } } as unknown as Recurring;
    // Today Nov 5: due Nov 8, 15, 22, 29.
    const m = buildDashboard({ transactions: [], categories, groups, recurring: [weekly], today, plan: undefined });
    expect(m.month.billsCents).toBe(4000);
  });
});
