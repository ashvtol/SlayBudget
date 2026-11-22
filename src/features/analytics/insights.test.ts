import { describe, expect, it } from 'vitest';
import { deriveInsights } from './insights';
import type { BudgetStatus, CashFlow, Category, CategoryTotal } from '@/lib/types';

const cat = (id: number, name: string): Category => ({
  id, groupId: 1, name, emoji: null, color: '#fff', budgetCents: null, excluded: false, kind: 'expense', sortOrder: 0, archived: false,
});
const flow = (netCents: number, deltaCents: number): CashFlow => ({
  current: { incomeCents: 100000, expenseCents: 100000 - netCents, netCents }, previous: { incomeCents: 0, expenseCents: 0, netCents: 0 }, netDeltaCents: deltaCents,
});

describe('deriveInsights', () => {
  it('flags a negative net and the biggest category', () => {
    const categories: CategoryTotal[] = [{ categoryId: 10, totalCents: 40000, count: 7 }];
    const out = deriveInsights({ monthly: [], categories, budgets: [], cashflow: flow(-5000, -5000), recurring: [], categoryMeta: { 10: cat(10, 'Groceries') } });
    expect(out.find((i) => i.id === 'net-negative')).toBeTruthy();
    const top = out.find((i) => i.id === 'top-category');
    expect(top?.title).toContain('Groceries');
  });

  it('warns on over-budget and projected overspend', () => {
    const budgets: BudgetStatus[] = [
      { categoryId: 10, budgetCents: 10000, spentCents: 12000, remainingCents: -2000, projectedCents: 12000, overBudget: true },
      { categoryId: 20, budgetCents: 10000, spentCents: 6000, remainingCents: 4000, projectedCents: 14000, overBudget: false },
    ];
    const out = deriveInsights({ monthly: [], categories: [], budgets, cashflow: flow(1000, 500), recurring: [], categoryMeta: { 10: cat(10, 'Dining'), 20: cat(20, 'Shopping') } });
    expect(out.find((i) => i.id === 'over-budget')?.detail).toContain('Dining');
    expect(out.find((i) => i.id === 'projected-over')?.detail).toContain('Shopping');
  });

  it('returns nothing notable for an empty, break-even period', () => {
    const out = deriveInsights({ monthly: [], categories: [], budgets: [], cashflow: flow(0, 0), recurring: [], categoryMeta: {} });
    expect(out).toHaveLength(0);
  });
});
