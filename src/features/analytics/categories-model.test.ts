import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Recurring, Transaction } from '@/lib/types';
import { buildCategories } from './categories-model';

const groups: CategoryGroup[] = [
  { id: 1, name: 'Home', emoji: '🏠', color: '#4c85ee', sortOrder: 0 },
  { id: 2, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 1 },
  { id: 3, name: 'Shopping', emoji: '🛍️', color: '#bb45f3', sortOrder: 2 },
  { id: 9, name: 'Transfers', emoji: null, color: '#617598', sortOrder: 9 },
];
const cat = (id: number, groupId: number, name: string, budgetCents: number | null, extra: Partial<Category> = {}): Category => ({
  id, groupId, name, emoji: null, color: null, budgetCents, excluded: false, kind: 'expense', sortOrder: id, archived: false, ...extra,
});
const categories = [
  cat(10, 1, 'Rent', 220000),
  cat(11, 1, 'Internet', 6000),
  cat(20, 2, 'Groceries', 30000),
  cat(21, 2, 'Restaurants', null),
  cat(30, 3, 'Shopping', 50000),
  cat(90, 9, 'Card Payment', null, { excluded: true, kind: 'transfer' }),
  cat(91, 2, 'Old', 1000, { archived: true }),
];
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number | null): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const TODAY = '2026-11-21';
const txs = [
  tx('2026-11-01', -220000, 10),
  tx('2026-11-03', -12000, 20),
  tx('2026-11-04', -4000, 21),
  tx('2026-11-05', -185000, 90), // excluded
  tx('2026-11-06', 500000, null), // income
  tx('2026-10-10', -35000, 20),
  tx('2025-06-10', -24000, 20),
];
const build = (selection: Parameters<typeof buildCategories>[0]['selection'] = { kind: 'all' }) =>
  buildCategories({ transactions: txs, categories, groups, today: TODAY, selection });

describe('buildCategories summary and tree', () => {
  const c = build();

  it('sums this month spent and total budget over regular categories', () => {
    expect(c.summary).toEqual({ spentCents: 236000, budgetCents: 306000, expectedCents: 0 });
  });

  it('lists groups in their own order with every regular, unarchived category', () => {
    expect(c.tree.map((g) => g.group.name)).toEqual(['Home', 'Food & Drink', 'Shopping']);
    expect(c.tree[1].children.map((x) => [x.category.name, x.spentCents, x.budgetCents])).toEqual([
      ['Groceries', 12000, 30000],
      ['Restaurants', 4000, null],
    ]);
    expect(c.tree[1]).toMatchObject({ spentCents: 16000, budgetCents: 30000 });
  });

  it('lists excluded categories separately', () => {
    expect(c.excluded.map((x) => x.category.name)).toEqual(['Card Payment']);
    expect(c.excluded[0].spentCents).toBe(185000);
  });
});

describe('buildCategories detail for a selection', () => {
  it('all categories: title, member pills, spent and left this month', () => {
    const d = build().detail;
    expect(d.title).toBe('All categories');
    expect(d.members.map((m) => m.name)).toEqual(['Home', 'Food & Drink', 'Shopping']);
    expect(d).toMatchObject({ spentCents: 236000, budgetCents: 306000, leftCents: 70000 });
  });

  it('a group covers its categories', () => {
    const d = build({ kind: 'group', id: 2 }).detail;
    expect(d.title).toBe('Food & Drink');
    expect(d.members.map((m) => m.name)).toEqual(['Groceries', 'Restaurants']);
    expect(d.spentCents).toBe(16000);
    expect(d.rows.map((r) => r.name)).toEqual(['Groceries', 'Restaurants']);
  });

  it('a category covers itself', () => {
    const d = build({ kind: 'category', id: 20 }).detail;
    expect(d.title).toBe('Groceries');
    expect(d).toMatchObject({ spentCents: 12000, budgetCents: 30000, leftCents: 18000 });
    expect(d.rows.map((r) => r.name)).toEqual(['Groceries']);
  });

  it('gives 24 months of spend against the current budget, ending this month', () => {
    const h = build({ kind: 'category', id: 20 }).detail.history;
    expect(h).toHaveLength(24);
    expect(h[23]).toEqual({ month: '2026-11', spentCents: 12000, budgetCents: 30000 });
    expect(h[22]).toEqual({ month: '2026-10', spentCents: 35000, budgetCents: 30000 });
  });

  it('has no budget line for a selection without budgets', () => {
    expect(build({ kind: 'category', id: 21 }).detail.history[23].budgetCents).toBeNull();
  });

  it('reports spend per year and average per month', () => {
    const years = build({ kind: 'category', id: 20 }).detail.years;
    expect(years.map((y) => [y.year, y.spendCents])).toEqual([[2026, 47000], [2025, 24000]]);
    expect(years[1].avgMonthlySpendCents).toBe(2000);
  });

  it('table rows show spent, budget and left, with groups then their categories for all', () => {
    const rows = build().detail.rows;
    expect(rows.slice(0, 3).map((r) => [r.name, r.depth, r.leftCents])).toEqual([
      ['Home', 0, 6000],
      ['Rent', 1, 0],
      ['Internet', 1, 6000],
    ]);
    expect(rows.find((r) => r.name === 'Restaurants')?.leftCents).toBeNull();
  });
});

describe('buildCategories dates', () => {
  it('ignores transactions dated after today', () => {
    const c = buildCategories({ transactions: [...txs, tx('2026-11-28', -9900, 20)], categories, groups, today: TODAY, selection: { kind: 'category', id: 20 } });
    expect(c.detail.spentCents).toBe(12000);
  });
});

describe('buildCategories without any budgets', () => {
  it('treats a zero total as no budget for all categories', () => {
    const noBudgets = categories.map((c) => ({ ...c, budgetCents: null }));
    const d = buildCategories({ transactions: txs, categories: noBudgets, groups, today: TODAY, selection: { kind: 'all' } }).detail;
    expect(d.budgetCents).toBeNull();
    expect(d.leftCents).toBeNull();
    expect(d.history[23].budgetCents).toBeNull();
  });
});

describe('buildCategories top-level categories', () => {
  it('shows a category alone in a group of its own name as one row, not group plus child', () => {
    const rows = build().detail.rows;
    expect(rows.filter((r) => r.name === 'Shopping').map((r) => [r.depth, r.selection.kind])).toEqual([[0, 'category']]);
  });
});

describe('expected bills this month', () => {
  const bill = (categoryId: number, nextDate: string, status: 'active' | 'paused', typicalAmountCents = 5000): Recurring => ({
    merchant: 'bill', categoryId, typicalAmountCents, cadence: 'monthly', lastDate: '2026-10-25', nextDate, occurrences: 3,
    saved: { id: categoryId, name: 'Bill', categoryId, matchKind: 'merchant', pattern: 'bill', minCents: 0, maxCents: 9999, frequency: 'monthly', dayOfMonth: 25, status, createdOn: '2026-01-01', alsoMatches: [], paidBackBy: null },
  });

  it('counts active unpaid bills due this month as expected, and subtracts them from what is left', () => {
    const base = build({ kind: 'all' });
    const withBill = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'all' }, recurring: [bill(10, `${TODAY.slice(0, 7)}-25`, 'active')] });
    const line = withBill.tree.flatMap((g) => g.children).find((c) => c.category.id === 10)!;
    expect(line.expectedCents).toBe(5000);
    expect(withBill.summary.expectedCents).toBe(5000);
    expect(withBill.detail.leftCents).toBe((base.detail.leftCents ?? 0) - 5000);
  });

  it('ignores paused bills and bills due next month', () => {
    const next = TODAY.slice(0, 4) + '-' + String(Number(TODAY.slice(5, 7)) + 1).padStart(2, '0') + '-05';
    const m = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'all' }, recurring: [bill(10, `${TODAY.slice(0, 7)}-25`, 'paused'), bill(10, next, 'active')] });
    expect(m.summary.expectedCents).toBe(0);
  });
});

describe('buildCategories with a budget plan', () => {
  const plan = (over: Partial<import('@/lib/types').BudgetPlan> = {}) => ({ months: [], groups: [], rollovers: [], ...over });
  const withPlan = (p: import('@/lib/types').BudgetPlan, selection: Parameters<typeof buildCategories>[0]['selection'] = { kind: 'all' }, rollovers = true) =>
    buildCategories({ transactions: txs, categories, groups, today: TODAY, selection, plan: p, rolloversOn: rollovers });

  it("uses this month's override and draws each month's own budget in the history", () => {
    const m = withPlan(plan({ months: [{ categoryId: 20, month: '2026-11', amountCents: 45000 }, { categoryId: 20, month: '2026-09', amountCents: 10000 }] }), { kind: 'category', id: 20 });
    expect(m.detail.budgetCents).toBe(45000);
    const history = Object.fromEntries(m.detail.history.map((h) => [h.month, h.budgetCents]));
    expect(history['2026-11']).toBe(45000);
    expect(history['2026-10']).toBe(30000);
    expect(history['2026-09']).toBe(10000);
  });

  it('shows a shared group budget on the group, none on its categories, counted once in the total', () => {
    const m = withPlan(plan({ groups: [{ groupId: 1, amountCents: 250000 }] }));
    const home = m.tree.find((g) => g.group.id === 1)!;
    expect(home.budgetCents).toBe(250000);
    expect(home.shared).toBe(true);
    expect(home.children.map((c) => c.budgetCents)).toEqual([null, null]);
    expect(m.summary.budgetCents).toBe(250000 + 30000 + 50000);
  });

  it('adds rollover to what is left, only when rollovers are on', () => {
    // Groceries: Oct budget 300 - spent 350 = -50 carried into November.
    const p = plan({ rollovers: [{ categoryId: 20, since: '2026-10' }] });
    const on = withPlan(p, { kind: 'category', id: 20 });
    expect(on.detail.rolloverCents).toBe(-5000);
    expect(on.detail.leftCents).toBe(30000 - 5000 - 12000);
    const off = withPlan(p, { kind: 'category', id: 20 }, false);
    expect(off.detail.rolloverCents).toBe(0);
    expect(off.detail.leftCents).toBe(30000 - 12000);
  });

  it('lists budgeted categories for Rebalance with a typical month, leaving out shared group members', () => {
    const m = withPlan(plan({ groups: [{ groupId: 1, amountCents: 250000 }] }));
    const ids = m.rebalanceLines.map((l) => l.categoryId);
    expect(ids).toEqual([20, 30]);
    // Typical month: Aug, Sep, Oct average (0 + 0 + 350) / 3.
    expect(m.rebalanceLines.find((l) => l.categoryId === 20)).toMatchObject({ budgetCents: 30000, spentCents: 12000, typicalCents: 11667 });
  });
});

describe('buildCategories weekly bills', () => {
  it('expects every weekly charge still due this month', () => {
    const weekly = { merchant: 'gym', cadence: 'weekly', typicalAmountCents: 1000, nextDate: '2026-11-22', lastDate: '2026-11-15', occurrences: 3, categoryId: 20, saved: { status: 'active' } } as unknown as Recurring;
    // Today Nov 21: due Nov 22 and Nov 29.
    const m = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'category', id: 20 }, recurring: [weekly] });
    expect(m.tree.flatMap((g) => g.children).find((c) => c.category.id === 20)?.expectedCents).toBe(2000);
  });
});

describe('buildCategories for a picked month', () => {
  it('shows the picked month in the detail: total, table rows and no bills still due', () => {
    const m = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'category', id: 20 }, month: '2026-10' });
    expect(m.detail.month).toBe('2026-10');
    expect(m.detail.spentCents).toBe(35000);
    expect(m.detail.rows[0]).toMatchObject({ spentCents: 35000, budgetCents: 30000, leftCents: -5000 });
    // The list on the left stays on this month.
    expect(m.tree.flatMap((g) => g.children).find((c) => c.category.id === 20)?.spentCents).toBe(12000);
  });

  it("All categories for a past month lists that month's spending", () => {
    const m = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'all' }, month: '2026-10' });
    expect(m.detail.spentCents).toBe(35000);
    expect(m.detail.rows.find((r) => r.name === 'Rent')?.spentCents).toBe(0);
  });

  it('ignores a future month', () => {
    const m = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'all' }, month: '2027-01' });
    expect(m.detail.month).toBe('2026-11');
  });
});

describe('buildCategories category transactions by month', () => {
  it("lists a category's transactions grouped by month, newest first", () => {
    const m = build({ kind: 'category', id: 20 });
    expect(m.detail.transactionsByMonth.map((g) => g.month)).toEqual(['2026-11', '2026-10', '2025-06']);
    expect(m.detail.transactionsByMonth[0].transactions.map((t) => t.amountCents)).toEqual([-12000]);
  });

  it('shows only the picked month when one is picked', () => {
    const m = buildCategories({ transactions: txs, categories, groups, today: TODAY, selection: { kind: 'category', id: 20 }, month: '2026-10' });
    expect(m.detail.transactionsByMonth.map((g) => g.month)).toEqual(['2026-10']);
  });

  it('has none for All categories or a group', () => {
    expect(build().detail.transactionsByMonth).toEqual([]);
    expect(build({ kind: 'group', id: 2 }).detail.transactionsByMonth).toEqual([]);
  });
});
