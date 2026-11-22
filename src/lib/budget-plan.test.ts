import { describe, expect, it } from 'vitest';
import type { BudgetPlan, Category } from './types';
import { budgetsForMonth, proposeRebalance, rolloverCents } from './budget-plan';

const cat = (id: number, groupId: number, budgetCents: number | null): Category => ({
  id, groupId, name: `C${id}`, emoji: null, color: null, budgetCents, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
const empty: BudgetPlan = { months: [], groups: [], rollovers: [] };

describe('budgetsForMonth', () => {
  const cats = [cat(1, 10, 40000), cat(2, 20, 30000), cat(3, 20, 10000), cat(4, 30, null)];

  it("uses a month's override, else the default", () => {
    const plan: BudgetPlan = { ...empty, months: [{ categoryId: 1, month: '2026-12', amountCents: 60000 }] };
    expect(budgetsForMonth(plan, cats, '2026-11').categories.find((c) => c.id === 1)?.budgetCents).toBe(40000);
    expect(budgetsForMonth(plan, cats, '2026-12').categories.find((c) => c.id === 1)?.budgetCents).toBe(60000);
    expect(budgetsForMonth(plan, cats, '2026-12').categories.find((c) => c.id === 4)?.budgetCents).toBeNull();
  });

  it('gives a shared group budget to the group and none to its categories', () => {
    const plan: BudgetPlan = { ...empty, groups: [{ groupId: 20, amountCents: 50000 }] };
    const m = budgetsForMonth(plan, cats, '2026-11');
    expect(m.groupBudgets.get(20)).toBe(50000);
    expect(m.categories.filter((c) => c.groupId === 20).map((c) => c.budgetCents)).toEqual([null, null]);
    expect(m.sharedGroups.has(20)).toBe(true);
    expect(m.categories.find((c) => c.id === 1)?.budgetCents).toBe(40000);
  });
});

describe('rolloverCents', () => {
  const plan: BudgetPlan = { ...empty, months: [{ categoryId: 1, month: '2026-10', amountCents: 50000 }], rollovers: [{ categoryId: 1, since: '2026-09' }] };
  const spent: Record<string, number> = { '2026-09': 30000, '2026-10': 70000, '2026-11': 5000 };
  const cats = [cat(1, 10, 40000)];

  it('carries each month\'s leftover (or overspend) from the start month up to the month before', () => {
    // September +100.00 (400 - 300), October -200.00 (500 - 700): November starts at -100.00.
    expect(rolloverCents(plan, cats, 1, '2026-11', (m) => spent[m] ?? 0)).toBe(-10000);
    expect(rolloverCents(plan, cats, 1, '2026-10', (m) => spent[m] ?? 0)).toBe(10000);
    expect(rolloverCents(plan, cats, 1, '2026-09', (m) => spent[m] ?? 0)).toBe(0);
  });

  it('is zero for categories not rolling over', () => {
    expect(rolloverCents(empty, cats, 1, '2026-11', () => 0)).toBe(0);
  });
});

describe('proposeRebalance', () => {
  it('moves spare budget to lines on track to go over, keeping the total', () => {
    const changes = proposeRebalance([
      { categoryId: 1, budgetCents: 40000, spentCents: 37200, expectedCents: 0, typicalCents: 53000 }, // needs 130.00
      { categoryId: 2, budgetCents: 30000, spentCents: 25200, expectedCents: 0, typicalCents: 36000 }, // needs 60.00
      { categoryId: 3, budgetCents: 10000, spentCents: 4000, expectedCents: 0, typicalCents: 5700 }, // spare 43.00
      { categoryId: 4, budgetCents: 6000, spentCents: 2000, expectedCents: 0, typicalCents: 4000 }, // spare 20.00
      { categoryId: 5, budgetCents: 220000, spentCents: 220000, expectedCents: 0, typicalCents: 220000 }, // on budget
    ]);
    const by = Object.fromEntries(changes.map((c) => [c.categoryId, c.toCents - c.fromCents]));
    expect(Object.values(by).reduce((s, d) => s + d, 0)).toBe(0);
    // 63.00 is moved: all of the spare, shared by need (130 : 60).
    expect(by[3]).toBe(-4300);
    expect(by[4]).toBe(-2000);
    expect(by[1] + by[2]).toBe(6300);
    expect(by[1]).toBe(4300);
    expect(by[5]).toBeUndefined();
    // Whole dollars only.
    for (const c of changes) expect(c.toCents % 100).toBe(0);
  });

  it('counts unpaid bills toward where a line is heading', () => {
    const changes = proposeRebalance([
      { categoryId: 1, budgetCents: 10000, spentCents: 2000, expectedCents: 12000, typicalCents: 0 },
      { categoryId: 2, budgetCents: 10000, spentCents: 0, expectedCents: 0, typicalCents: 1000 },
    ]);
    expect(changes.find((c) => c.categoryId === 1)?.toCents).toBe(14000);
    expect(changes.find((c) => c.categoryId === 2)?.toCents).toBe(6000);
  });

  it('proposes nothing when no line is heading over, or nothing is spare', () => {
    expect(proposeRebalance([{ categoryId: 1, budgetCents: 10000, spentCents: 100, expectedCents: 0, typicalCents: 200 }])).toEqual([]);
    expect(
      proposeRebalance([
        { categoryId: 1, budgetCents: 10000, spentCents: 20000, expectedCents: 0, typicalCents: 0 },
        { categoryId: 2, budgetCents: 10000, spentCents: 12000, expectedCents: 0, typicalCents: 0 },
      ]),
    ).toEqual([]);
  });
});
