import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  cashFlow,
  categoryTotals,
  detectRecurring,
  monthlyTotals,
  resolveRange,
  shiftMonths,
} from './analytics';
import type { CategoryMeta, Transaction } from './types';

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'amountCents'>): Transaction {
  return {
    profileId: 1, sourceId: 1, description: 'X', merchant: 'x', currency: 'USD',
    categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: over.amountCents > 0 ? 'income' : 'regular', ...over,
  };
}

describe('date math', () => {
  it('shiftMonths clamps the day', () => {
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftMonths('2026-11-15', 1)).toBe('2026-12-15');
  });
  it('resolveRange builds windows', () => {
    expect(resolveRange('week', '2026-11-17').from).toBe('2026-11-11');
    expect(resolveRange('ytd', '2026-11-17').from).toBe('2026-01-01');
    expect(resolveRange('all', '2026-11-17')).toEqual({ from: null, to: null });
  });
});

describe('monthlyTotals', () => {
  it('groups income and expense by month', () => {
    const rows = [
      tx({ id: 1, postedOn: '2026-10-05', amountCents: 500000 }),
      tx({ id: 2, postedOn: '2026-10-20', amountCents: -20000 }),
      tx({ id: 3, postedOn: '2026-11-02', amountCents: -15000 }),
    ];
    const out = monthlyTotals(rows, { from: null, to: null });
    expect(out).toEqual([
      { month: '2026-10', incomeCents: 500000, expenseCents: 20000, netCents: 480000 },
      { month: '2026-11', incomeCents: 0, expenseCents: 15000, netCents: -15000 },
    ]);
  });
});

describe('categoryTotals', () => {
  it('is split-aware and expenses only, largest first', () => {
    const rows = [
      tx({ id: 1, postedOn: '2026-11-01', amountCents: -5000, categoryId: 10 }),
      tx({ id: 2, postedOn: '2026-11-02', amountCents: 9000, categoryId: 10 }),
      tx({ id: 3, postedOn: '2026-11-03', amountCents: -10000, categoryId: 10 }),
    ];
    const children = new Map<number, Transaction[]>([
      [3, [
        tx({ id: 101, postedOn: '2026-11-03', amountCents: -6000, categoryId: 10 }),
        tx({ id: 102, postedOn: '2026-11-03', amountCents: -4000, categoryId: 20 }),
      ]],
    ]);
    const out = categoryTotals(rows, { from: null, to: null }, children);
    expect(out[0]).toEqual({ categoryId: 10, totalCents: 11000, count: 2 });
    expect(out.find((c) => c.categoryId === 20)).toEqual({ categoryId: 20, totalCents: 4000, count: 1 });
  });
});

describe('budgetStatus', () => {
  it('projects to month end and flags over-budget', () => {
    const rows = [
      tx({ id: 1, postedOn: '2026-11-05', amountCents: -10000, categoryId: 10 }),
      tx({ id: 2, postedOn: '2026-11-12', amountCents: -20000, categoryId: 10 }),
    ];
    const meta: CategoryMeta[] = [{ id: 10, budgetCents: 60000, excluded: false }];
    const out = budgetStatus(rows, meta, '2026-11-15', new Map());
    expect(out[0].spentCents).toBe(30000);
    expect(out[0].projectedCents).toBe(60000);
    expect(out[0].overBudget).toBe(false);
  });
});

describe('cashFlow', () => {
  it('compares to the preceding window', () => {
    const rows = [
      tx({ id: 1, postedOn: '2026-10-10', amountCents: 100000 }),
      tx({ id: 2, postedOn: '2026-10-20', amountCents: -120000 }),
      tx({ id: 3, postedOn: '2026-11-10', amountCents: 150000 }),
      tx({ id: 4, postedOn: '2026-11-20', amountCents: -140000 }),
    ];
    const cf = cashFlow(rows, { from: '2026-11-01', to: '2026-11-30' });
    expect(cf.current.netCents).toBe(10000);
    expect(cf.previous.netCents).toBe(-20000);
    expect(cf.netDeltaCents).toBe(30000);
  });
});

describe('detectRecurring', () => {
  it('finds a monthly subscription and projects next date', () => {
    const rows = ['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15'].map((d, i) =>
      tx({ id: i + 1, postedOn: d, amountCents: -1599, merchant: 'netflix' }),
    );
    const out = detectRecurring(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: 'netflix', cadence: 'monthly', typicalAmountCents: 1599, nextDate: '2026-12-15', occurrences: 4 });
  });
  it('ignores irregular merchants', () => {
    const rows = [
      tx({ id: 1, postedOn: '2026-08-02', amountCents: -12000, merchant: 'costco' }),
      tx({ id: 2, postedOn: '2026-08-09', amountCents: -3000, merchant: 'costco' }),
      tx({ id: 3, postedOn: '2026-10-28', amountCents: -24000, merchant: 'costco' }),
    ];
    expect(detectRecurring(rows)).toHaveLength(0);
  });
});

describe('detectRecurring with same-day repeats', () => {
  it('counts the same charge twice on one day once, keeping the monthly cadence', () => {
    const days = ['2026-02-03', '2026-03-03', '2026-03-03', '2026-04-03', '2026-05-03', '2026-05-03', '2026-06-03'];
    const rows = days.map((postedOn, i) => tx({ id: i + 1, postedOn, amountCents: -14200, merchant: 'geico auto' }));
    const out = detectRecurring(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cadence: 'monthly', occurrences: 5, nextDate: '2026-07-03' });
  });
});

describe('cashFlow over all time', () => {
  it('spans first to last transaction and has nothing before it', () => {
    const rows = [
      { id: 1, profileId: 1, sourceId: 1, postedOn: '2025-03-10', description: 'X', merchant: 'x', amountCents: 100000, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: 'income' as const },
      { id: 2, profileId: 1, sourceId: 1, postedOn: '2026-10-20', description: 'Y', merchant: 'y', amountCents: -40000, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: 'regular' as const },
    ];
    const cf = cashFlow(rows, { from: null, to: null });
    expect(cf.current).toEqual({ incomeCents: 100000, expenseCents: 40000, netCents: 60000 });
    expect(cf.previous.netCents).toBe(0);
    expect(cashFlow([], { from: null, to: null }).current.netCents).toBe(0);
  });
});
