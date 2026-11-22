import type { Transaction } from './types';
import { incomeOf, isRegular, spendOf, txTypeOf } from './tx-type';
import { monthlyTotals, categoryTotals } from './analytics';

const t = (amountCents: number, txType?: Transaction['txType'], categoryId: number | null = 1): Transaction => ({
  id: Math.random(), profileId: 1, sourceId: 1, postedOn: '2026-05-01', description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType,
});

describe('tx types', () => {
  it('defaults to regular', () => {
    expect(txTypeOf(t(-1))).toBe('regular');
    expect(isRegular(t(-1, 'transfer'))).toBe(false);
  });

  it('counts spend from Regular rows net of refunds, income from Income rows only', () => {
    expect(spendOf(t(-5000))).toBe(5000);
    expect(spendOf(t(1000))).toBe(-1000);
    expect(spendOf(t(-5000, 'transfer'))).toBe(0);
    expect(spendOf(t(300000, 'income'))).toBe(0);
    expect(incomeOf(t(300000, 'income'))).toBe(300000);
    expect(incomeOf(t(2000))).toBe(0);
    expect(incomeOf(t(2000, 'transfer'))).toBe(0);
  });

  it('drives the memory analytics', () => {
    const rows = [t(-5000), t(1000), t(2000, 'regular', null), t(300000, 'income', 9), t(-40000, 'transfer', null)];
    const [m] = monthlyTotals(rows, { from: null, to: null });
    expect(m).toMatchObject({ incomeCents: 300000, expenseCents: 2000 });
    const cats = categoryTotals(rows, { from: null, to: null }, new Map());
    expect(cats.find((c) => c.categoryId === 1)?.totalCents).toBe(4000);
    expect(cats.some((c) => c.categoryId === 9)).toBe(false);
  });
});
